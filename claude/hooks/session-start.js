#!/usr/bin/env node
// SessionStart orientation injection.
//
// Puts the live state of the work into context at session start, so it is
// something the agent HAS rather than something it must remember to fetch:
// open PRs for the current repo, with dependabot collapsed to a count so a
// dozen bot PRs don't bury the one or two that represent live work.
//
// Cached for 30 minutes and fully fail-safe: any error means no output at
// all, never a blocked or slow session start.
//
// DELIBERATELY NOT INCLUDED: a project-board snapshot. Measured 2026-08-14
// on a real board, `gh project item-list <n> --owner <o> --limit 1000` cost
// 44 seconds and 2.4MB to return 1000 rows (843 of them Done) and still
// truncated at the limit. Anything on a session-start path has to be cheap;
// fetch board state on demand instead. If you add sections here, time them
// first — this hook runs before every session.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const CACHE = path.join(__dirname, '..', 'state', 'session-brief.json');
// 30 minutes was fine when this brief carried only PR titles, which barely
// move. It stopped being fine when a check-state claim was added on
// 2026-08-28: a push re-triggers checks, and re-reading a half-hour-old
// "GREEN" right after pushing is the single most likely way to read it.
// Five minutes still collapses a burst of session starts (the reason the
// cache exists) while bounding how wrong the freshest claim can be. Cost of
// a miss, measured: ~1.0s.
const CACHE_MS = 5 * 60 * 1000;

let input = {};
try {
  input = JSON.parse(fs.readFileSync(0, 'utf8') || '{}');
} catch {
  /* defaults */
}
const cwd = input.cwd || process.cwd();

function gh(args, timeout = 8000) {
  return execFileSync('gh', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
    timeout,
  });
}

// One short annotation per PR, and ONLY when it carries information the bare
// title does not. The anomaly worth naming is a PR that is finished but not
// merged: its contents are not live, however done the work looks.
//
// Order matters. A conflicted PR runs ZERO checks, so an empty rollup means
// "conflicted", not "no CI" — mergeStateStatus is therefore read FIRST.
function note(p) {
  if (p.isDraft) return ''; // a draft is meant to sit; that is not an anomaly

  if (p.mergeStateStatus === 'DIRTY') return '  <- CONFLICTING, needs a rebase; not live';

  const rollup = Array.isArray(p.statusCheckRollup) ? p.statusCheckRollup : [];
  if (!rollup.length) return '';

  const verdicts = rollup.map((c) => String(c.conclusion || c.state || '').toUpperCase());
  const running = rollup.some(
    (c) => c.status && !['COMPLETED'].includes(String(c.status).toUpperCase())
  );
  const failed = verdicts.some((v) =>
    ['FAILURE', 'TIMED_OUT', 'ACTION_REQUIRED', 'STARTUP_FAILURE', 'ERROR'].includes(v)
  );

  if (failed) return '  <- checks RED';
  if (running) return ''; // mid-run is the normal state, not news
  if (!verdicts.every((v) => ['SUCCESS', 'NEUTRAL', 'SKIPPED'].includes(v))) return '';

  const hours = Math.floor((Date.now() - new Date(p.createdAt).getTime()) / 3.6e6);
  const age = Number.isFinite(hours)
    ? hours < 48
      ? `${hours}h`
      : `${Math.floor(hours / 24)}d`
    : 'unknown age';
  // Stamped, not asserted. This whole brief is cached (see CACHE_MS), so a
  // bare "checks GREEN" can be up to a full cache window old — and a push
  // re-triggers checks, which is exactly when someone reads this. On the
  // source project the banner reported three PRs green while two had checks
  // re-running; a fresh session caught it. The observation time is the
  // difference between a claim and a reading.
  const at = new Date().toISOString().slice(11, 16);
  return `  <- checks GREEN at ${at}, unmerged ${age}; nothing in it is live yet`;
}

// A project can ship its own re-check harness at `.claude/probes/run-all.js`.
// If one exists, run it and report the verdict at session start.
//
// This runs OUTSIDE the cache below, deliberately. A probe result is a
// freshness check, and a cached freshness check reports a stale verdict as
// current — which is the exact failure the harness exists to catch.
//
// The contract is kept minimal so the kit does not own the harness's format:
//   exit 0           every claim holds
//   exit non-zero    something needs attention; the full output is shown
//   last stdout line a one-line summary
//
// A harness that cannot run is REPORTED, never silent. "No probes here" and
// "the probes are broken" must not look the same, or the second one hides
// behind the first for as long as it takes someone to notice.
// Overridable so the selftest can exercise the timeout path in milliseconds
// instead of stalling CI for twenty seconds. A timeout branch that has never
// run is not a branch you have.
const PROBE_TIMEOUT_MS = Number(process.env.CLAUDE_PROBE_TIMEOUT_MS) || 20000;
const PROBE_UNVERIFIED = 'Treat every behavioural note as unverified.';

// The transcript archiver (scripts/archive-claude-transcripts.ps1) stamps
// <claudeHome>/.last-transcript-archive on every SUCCESSFUL run. This section
// reads that stamp and warns when the archive has gone quiet. The archiver
// runs from a scheduled task, and a scheduled task that stopped firing looks
// exactly like one that is fine unless something consumes its absence —
// session start is the one place consumption is guaranteed. Like probes,
// this runs OUTSIDE the brief's cache: a cached freshness check reports a
// stale verdict as current, which is the failure it exists to catch.
//
// A machine that never adopted the archiver (no stamp, no config file) stays
// silent — the warning is opt-in by configuring the archiver, not a nag on
// every install of the kit. Once adopted, every failure mode is REPORTED:
// configured-but-never-ran and stale must not read like healthy, for the
// same reason "no probes here" and "the probes are broken" must not look
// the same.
const ARCHIVE_STALE_MS = 48 * 3.6e6;

function archiveSection(claudeHome) {
  const stamp = path.join(claudeHome, '.last-transcript-archive');
  const config = path.join(claudeHome, 'transcript-archive-path.txt');

  let stampAge = null;
  try {
    stampAge = Date.now() - fs.statSync(stamp).mtimeMs;
  } catch {
    stampAge = null; // no stamp on this machine (or it cannot be read)
  }

  if (stampAge === null) {
    if (!fs.existsSync(config)) return ''; // archiver not adopted here
    return (
      'TRANSCRIPT ARCHIVE: configured but no successful run is on record. ' +
      'Run scripts/archive-claude-transcripts.ps1 by hand and check its scheduled task.'
    );
  }

  if (stampAge <= ARCHIVE_STALE_MS) return '';

  const hours = Math.floor(stampAge / 3.6e6);
  const age = hours < 48 ? `${hours}h` : `${Math.floor(hours / 24)}d`;
  return (
    `TRANSCRIPT ARCHIVE STALE: last successful run ${age} ago (limit 48h). ` +
    'The source tree prunes itself, so a quiet archiver is quietly losing data. ' +
    'Check the scheduled task, then run scripts/archive-claude-transcripts.ps1.'
  );
}

// The state backup (scripts/backup-claude-state.ps1) writes one 'started'
// line and one verdict line per run to <claudeHome>/hooks-backup.log, and
// stamps <claudeHome>/.last-state-backup only when the snapshot was verified
// on the remote. Same contract as the archive section above, and found the
// same way: on the source machine a lock file left by a killed run blocked
// every commit for seven weeks (2026-09-13 to 2026-11-02). The exit code
// went to a scheduler nobody opened and 109 failure lines went to a log
// nobody read. This is the named reader.
//
// Four verdicts, in order of urgency. A failure newer than the last success
// is reported at the NEXT session, not after 48 hours: an age check alone
// hides a failure from an hour ago behind yesterday's success. A 'started'
// with no verdict after it, older than BACKUP_ORPHAN_MS, is a run that was
// killed or hung; nothing else can log a kill. A stamp older than 48 hours
// is the backstop for runs that never happened. Not adopted (no stamp, no
// log) is silent. Each line carries the leftover index.lock if the repo
// named in the stamp has one, so the agent can say what is wrong without
// opening anything.
const BACKUP_STALE_MS = 48 * 3.6e6;
const BACKUP_OVERDUE_MS = 30 * 60 * 1000;
const BACKUP_SKEW_MS = 5 * 60 * 1000;
const BACKUP_NEXT = 'Say so in your first message. Then check the scheduled task and run scripts/backup-claude-state.ps1.';

// [{ at, verdict, rest }], oldest first, from the script's own lines only;
// the hook's FIRED/skipped lines have another shape and are ignored.
// 'ok-local' is listed before 'ok' and the verdict must end at whitespace or
// end of line: with a bare \b, 'ok' matched the first two letters of
// 'ok-local' (reproduced in review, 2026-11-02).
function backupRuns(log) {
  const runs = [];
  let text;
  try {
    text = fs.readFileSync(log, 'utf8');
  } catch {
    return runs;
  }
  for (const line of text.split(/\r?\n/)) {
    const m = /^(\S+)\s+backup-claude-state (started|trigger-failed|ok-local|ok|FAILED|busy)(?=\s|$)\s*(.*)$/.exec(line);
    if (!m) continue;
    const at = Date.parse(m[1]);
    if (!Number.isFinite(at)) continue;
    runs.push({ at, verdict: m[2], rest: m[3].trim() });
  }
  return runs;
}

// The success record is trusted only when it parses: a stored time that is
// a date and not in the future, a repo path, a 40-hex commit and a ref. The
// STORED time is what counts, not the file's mtime, which a copy or a touch
// refreshes without any backup having happened.
function readBackupStamp(stampPath) {
  let text;
  try {
    text = fs.readFileSync(stampPath, 'utf8');
  } catch {
    return { state: 'absent' };
  }
  const [when = '', repo = '', commit = '', ref = ''] = text.split(/\r?\n/).map((l) => l.trim());
  const at = Date.parse(when);
  if (!Number.isFinite(at) || !repo || !/^[0-9a-f]{40}$/i.test(commit) || !ref) return { state: 'malformed' };
  if (at > Date.now() + BACKUP_SKEW_MS) return { state: 'future', at };
  return { state: 'ok', at, repo, commit, ref };
}

function backupSection(claudeHome) {
  const stampPath = path.join(claudeHome, '.last-state-backup');
  const log = path.join(claudeHome, 'hooks-backup.log');
  const stamp = readBackupStamp(stampPath);
  if (stamp.state === 'absent' && !fs.existsSync(log)) return ''; // backup not adopted here

  const ageText = (ms) => {
    const hours = Math.floor(ms / 3.6e6);
    return hours < 48 ? `${hours}h` : `${Math.floor(hours / 24)}d`;
  };
  const when = (ms) => new Date(ms).toISOString().slice(0, 16).replace('T', ' ');

  if (stamp.state === 'malformed' || stamp.state === 'future') {
    const why = stamp.state === 'future' ? 'dated in the future' : 'missing fields or unreadable';
    return `STATE BACKUP UNKNOWN: the success record ${stampPath} is ${why}, so no backup can be trusted from it. ` + BACKUP_NEXT;
  }

  const verifiedAt = stamp.state === 'ok' ? stamp.at : null;
  const lastSuccess =
    verifiedAt === null ? 'No verified success is recorded.' : `Last verified snapshot ${ageText(Date.now() - verifiedAt)} ago.`;

  // Presence, not a diagnosis: a live git process can own this file. Only
  // the operator can establish that nothing does.
  let lockNote = '';
  const lock = stamp.state === 'ok' ? path.join(stamp.repo, '.git', 'index.lock') : '';
  try {
    if (lock && fs.existsSync(lock)) {
      const st = fs.statSync(lock);
      lockNote =
        ` ${lock} is present (since ${when(st.mtimeMs)}). A live git process may own it; if none does, a killed run left it, and git add fails until it is removed.`;
    }
  } catch {
    /* the lock is a detail; the verdict is the message */
  }

  // Every run after the last verified success, in LOG ORDER. The record's
  // own 'ok' line is located first (same stored time) and the window is
  // everything after it, so two events in one second keep their order. If
  // that line is gone (log rotated), the window is strictly later times. A
  // failure in the window is unresolved until a verified success follows
  // it: a retry that started, a run that stayed local, a launch that found
  // the lock busy, or a failed trigger does not clear it. (Reproduced in
  // review, 2026-11-02, twice: a later 'started' or 'ok-local' erased a
  // failure; then an equal-second failure was dropped by a '>' filter.)
  const runs = backupRuns(log).filter((r) => r.verdict !== 'busy');
  let anchor = -1;
  if (verifiedAt !== null) {
    for (let i = runs.length - 1; i >= 0; i--) {
      if (runs[i].verdict === 'ok' && runs[i].at === verifiedAt) {
        anchor = i;
        break;
      }
    }
  }
  const since = anchor >= 0 ? runs.slice(anchor + 1) : runs.filter((r) => verifiedAt === null || r.at > verifiedAt);
  const newest = since.length ? since[since.length - 1] : null;
  const failures = since.filter((r) => r.verdict === 'FAILED' || r.verdict === 'trigger-failed');

  // Serial-run pairing: a 'started' is closed by the next worker verdict
  // after it. A 'started' followed by another 'started' stays open, because
  // the first run never reported. (Reproduced in review: a second start
  // reset the overdue check for an older interrupted run.)
  const openStarts = [];
  for (const r of since) {
    if (r.verdict === 'started') openStarts.push(r);
    else if (r.verdict === 'ok' || r.verdict === 'ok-local' || r.verdict === 'FAILED') openStarts.pop();
  }

  if (failures.length) {
    const f = failures[failures.length - 1];
    let later = '';
    if (newest && newest !== f) {
      const what = newest.verdict === 'started' ? 'started' : `ended ${newest.verdict}`;
      later = ` A later run ${what} at ${when(newest.at)} and has not verified a snapshot.`;
    }
    if (f.verdict === 'trigger-failed') {
      return (
        `STATE BACKUP TRIGGER FAILED: the session-end request to start the backup task at ${when(f.at)} did not report success ` +
        `(${f.rest.slice(0, 160)}); the worker launch is unconfirmed.${later} ` + lastSuccess + lockNote + ' ' + BACKUP_NEXT
      );
    }
    return (
      `STATE BACKUP FAILED: the run at ${when(f.at)} failed (${f.rest.slice(0, 160)}).${later} ` +
      lastSuccess + lockNote + ' ' + BACKUP_NEXT
    );
  }

  const overdue = openStarts.find((s) => Date.now() - s.at > BACKUP_OVERDUE_MS);
  if (overdue) {
    const minutes = Math.floor(BACKUP_OVERDUE_MS / 60000);
    const more = openStarts.length > 1 ? ` ${openStarts.length} starts have no completion.` : '';
    return (
      `STATE BACKUP OVERDUE: a run started at ${when(overdue.at)} and has recorded no completion after ${minutes} minutes, ` +
      'so it was interrupted or is still running.' + more + ' ' + lastSuccess + lockNote + ' ' + BACKUP_NEXT
    );
  }

  if (verifiedAt === null) {
    return (
      'STATE BACKUP: runs are on record but no verified success is. ' +
      `Run scripts/backup-claude-state.ps1 by hand and read ${log}.`
    );
  }

  const age = Date.now() - verifiedAt;
  if (age <= BACKUP_STALE_MS) return '';

  return (
    `STATE BACKUP STALE: last verified snapshot ${ageText(age)} ago (limit 48h). ` +
    'Work since then is not confirmed backed up.' + lockNote + ' ' + BACKUP_NEXT
  );
}

function probeSection(dir) {
  const probes = path.join(dir, '.claude', 'probes', 'run-all.js');
  if (!fs.existsSync(probes)) return '';

  let r;
  try {
    r = spawnSync(process.execPath, [probes], {
      cwd: dir,
      encoding: 'utf8',
      timeout: PROBE_TIMEOUT_MS,
    });
  } catch {
    return 'Probes: the harness could not be started. ' + PROBE_UNVERIFIED;
  }

  // status === null means killed, which for spawnSync means the timeout.
  if (r.error || r.status === null) {
    const why = r.status === null ? 'timed out' : 'did not complete';
    return 'Probes: the harness ' + why + '. ' + PROBE_UNVERIFIED;
  }

  const out = String(r.stdout || '').trimEnd();
  const lines = out.split('\n').filter((l) => l.trim());
  if (r.status === 0) {
    return 'Probes: ' + (lines.length ? lines[lines.length - 1].trim() : '(no output)');
  }
  return `PROBES NEED ATTENTION (exit ${r.status}):\n${out || '(no output)'}`;
}

// Memory notes live outside the project, so a file link to one cannot open:
// the preview pane resolves a link only INSIDE the session working directory.
// claude/scripts/link-memory-notes.ps1 hard-links them into .claude/memory so
// they resolve. Bootstrap runs that script ONCE, which is not enough:
//
//   - a note written later has no link, and
//   - EDITING a note breaks its link, because most editors write a temp file
//     and rename it over the target, which creates a new file record.
//
// Both failures are invisible. The stale path still opens and still shows
// plausible content, and a broken link is indistinguishable from a live one in
// a directory listing. So this repairs at session start, BEFORE an agent starts
// writing links into messages. Repairing afterwards is too late to help.
//
// Detection is pure Node and exact: two names for one file record share an
// inode, so a differing `ino` IS a broken link. PowerShell is spawned only when
// something actually needs repair, which keeps the common path free.
//
// Adopted-but-broken is REPORTED; not-adopted is silent. Same rule the probe
// and archive sections follow, and for the same reason.
const MEMLINK_TIMEOUT_MS = Number(process.env.CLAUDE_MEMLINK_TIMEOUT_MS) || 15000;

function memoryLinkDrift(sourceDir, destDir) {
  const mds = (d) => {
    try {
      return fs.readdirSync(d).filter((f) => f.endsWith('.md'));
    } catch {
      return [];
    }
  };
  const notes = mds(sourceDir);
  const links = mds(destDir);
  const drift = { missing: [], broken: [], orphans: [] };

  for (const n of notes) {
    let ls;
    try {
      ls = fs.statSync(path.join(destDir, n));
    } catch {
      drift.missing.push(n);
      continue;
    }
    let ss;
    try {
      ss = fs.statSync(path.join(sourceDir, n));
    } catch {
      continue; // vanished mid-scan; the next session sees it
    }
    // String(): inode values exceed 2^53 on NTFS, so compare as text.
    if (String(ls.ino) !== String(ss.ino)) drift.broken.push(n);
  }
  for (const l of links) if (!notes.includes(l)) drift.orphans.push(l);

  return drift;
}

function memoryLinkSection(dir) {
  // .claude/scripts/ in a bootstrapped project; claude/scripts/ in the kit itself.
  const script = [
    path.join(dir, '.claude', 'scripts', 'link-memory-notes.ps1'),
    path.join(dir, 'claude', 'scripts', 'link-memory-notes.ps1'),
  ].find((p) => fs.existsSync(p));
  if (!script) return ''; // not adopted here

  const home = process.env.CLAUDE_MEMLINK_HOME || path.join(os.homedir(), '.claude');
  const sourceDir = path.join(home, 'projects', dir.replace(/[:\\/]/g, '-'), 'memory');
  if (!fs.existsSync(sourceDir)) return ''; // no notes for this project yet

  const destDir = path.join(dir, '.claude', 'memory');
  const drift = memoryLinkDrift(sourceDir, destDir);
  const count = drift.missing.length + drift.broken.length + drift.orphans.length;
  if (count === 0) return ''; // healthy: say nothing, spawn nothing

  // Adopted (the script is here) but unrunnable. Reported, not swallowed: the
  // links silently stop tracking the notes, which looks exactly like healthy.
  if (process.platform !== 'win32') {
    return (
      `MEMORY LINKS: ${count} note(s) need relinking, but link-memory-notes.ps1 ` +
      'is Windows-only (fsutil). Reference memory notes by plain path here, not as links.'
    );
  }

  let r;
  try {
    r = spawnSync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, '-ProjectDir', dir],
      { cwd: dir, encoding: 'utf8', timeout: MEMLINK_TIMEOUT_MS }
    );
  } catch {
    return `MEMORY LINKS: ${count} note(s) need relinking and the repair could not start.`;
  }
  if (r.error || r.status === null || r.status !== 0) {
    const why = r.status === null ? 'timed out' : 'failed';
    return `MEMORY LINKS: ${count} note(s) need relinking and the repair ${why}.`;
  }

  // Re-check rather than trust the exit code: the script reporting success and
  // the links actually being current are two different claims (principle 3).
  const after = memoryLinkDrift(sourceDir, destDir);
  const left = after.missing.length + after.broken.length + after.orphans.length;
  if (left) {
    return `MEMORY LINKS: repair ran but ${left} of ${count} are still wrong. Run ${path.basename(script)} by hand.`;
  }

  const parts = [];
  if (drift.missing.length) parts.push(`${drift.missing.length} new`);
  if (drift.broken.length) parts.push(`${drift.broken.length} broken by an edit`);
  if (drift.orphans.length) parts.push(`${drift.orphans.length} orphaned`);
  return `Memory links: repaired ${count} (${parts.join(', ')}).`;
}

function build() {
  let repo;
  try {
    repo = JSON.parse(gh(['repo', 'view', '--json', 'nameWithOwner'])).nameWithOwner;
  } catch {
    return null; // not a GitHub repo — nothing useful to say
  }

  const out = [];

  try {
    // statusCheckRollup + mergeStateStatus cost ~0.33s extra over the bare
    // field set (measured 2026-08-28, 0.67s -> 1.00s on a 2-PR repo), paid
    // once per 30-minute cache window. Worth it: without them an open PR
    // reads as "work in flight" when it may actually be finished work that
    // nobody merged — and an unmerged PR's contents are NOT live, which is
    // exactly the inference that was missed on the source project when a PR
    // sat green and conflicted while its own mechanism was described as
    // shipped.
    const prs = JSON.parse(
      gh([
        'pr',
        'list',
        '--json',
        'number,title,headRefName,isDraft,mergeStateStatus,statusCheckRollup,createdAt',
        '--limit',
        '50',
      ])
    );
    const bot = prs.filter((p) => /^dependabot\//.test(p.headRefName));
    const real = prs.filter((p) => !/^dependabot\//.test(p.headRefName));
    const tail = bot.length ? ` (+${bot.length} dependabot)` : '';
    if (real.length) {
      out.push(
        `Open PRs on ${repo}${tail}:\n` +
          real
            .map(
              (p) =>
                `  #${p.number} ${p.title}${p.isDraft ? ' [draft]' : ''} (${p.headRefName})` +
                note(p)
            )
            .join('\n')
      );
    } else {
      out.push(`Open PRs on ${repo}: none${tail ? `, ${bot.length} dependabot only` : ''}.`);
    }
  } catch {
    /* skip this section */
  }

  if (!out.length) return null;
  return (
    out.join('\n\n') +
    '\n\nThis snapshot is from session start and can go stale; re-check before relying on it.'
  );
}

// Importable for the selftest; the hook body runs only when invoked directly.
if (require.main !== module) {
  module.exports = { note, probeSection, archiveSection, backupSection, backupRuns, readBackupStamp };
  return;
}

try {
  let cache = {};
  try {
    cache = JSON.parse(fs.readFileSync(CACHE, 'utf8'));
  } catch {
    /* cold cache */
  }

  const hit = cache[cwd];
  let text;
  if (hit && Date.now() - hit.ts < CACHE_MS) {
    text = hit.text;
  } else {
    text = build();
    cache[cwd] = { ts: Date.now(), text };
    try {
      fs.mkdirSync(path.dirname(CACHE), { recursive: true });
      fs.writeFileSync(CACHE, JSON.stringify(cache));
    } catch {
      /* non-fatal */
    }
  }

  // The PR brief is cached; the probe verdict is not. Compose them here so
  // a project with no GitHub remote still gets its probe line.
  const sections = [];
  if (text) sections.push(text);
  const probes = probeSection(cwd);
  if (probes) sections.push(probes);
  // Before the probes' output is read, not after: this repairs the links an
  // agent is about to write into its messages. Uncached, like the probes:
  // a cached "links are fine" is the exact verdict this exists to catch.
  const memlinks = memoryLinkSection(cwd);
  if (memlinks) sections.push(memlinks);
  // The hooks install machine-global into <claudeHome>/hooks, so the parent
  // directory IS the Claude home this hook is running from.
  const archive = archiveSection(path.join(__dirname, '..'));
  if (archive) sections.push(archive);
  const backup = backupSection(path.join(__dirname, '..'));
  if (backup) sections.push(backup);
  if (sections.length) process.stdout.write(sections.join('\n\n') + '\n');
} catch {
  /* never block session start */
}

process.exit(0);

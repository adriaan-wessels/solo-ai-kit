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
// writing links into messages — repairing afterwards is too late to help.
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
  module.exports = { note, probeSection, archiveSection };
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
  // agent is about to write into its messages. Uncached, like the probes —
  // a cached "links are fine" is the exact verdict this exists to catch.
  const memlinks = memoryLinkSection(cwd);
  if (memlinks) sections.push(memlinks);
  // The hooks install machine-global into <claudeHome>/hooks, so the parent
  // directory IS the Claude home this hook is running from.
  const archive = archiveSection(path.join(__dirname, '..'));
  if (archive) sections.push(archive);
  if (sections.length) process.stdout.write(sections.join('\n\n') + '\n');
} catch {
  /* never block session start */
}

process.exit(0);

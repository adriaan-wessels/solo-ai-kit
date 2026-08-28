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
const path = require('path');
const { execFileSync } = require('child_process');

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
  module.exports = { note };
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

  if (text) process.stdout.write(text + '\n');
} catch {
  /* never block session start */
}

process.exit(0);

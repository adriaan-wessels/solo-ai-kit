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
const CACHE_MS = 30 * 60 * 1000;

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

function build() {
  let repo;
  try {
    repo = JSON.parse(gh(['repo', 'view', '--json', 'nameWithOwner'])).nameWithOwner;
  } catch {
    return null; // not a GitHub repo — nothing useful to say
  }

  const out = [];

  try {
    const prs = JSON.parse(
      gh(['pr', 'list', '--json', 'number,title,headRefName,isDraft', '--limit', '50'])
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
                `  #${p.number} ${p.title}${p.isDraft ? ' [draft]' : ''} (${p.headRefName})`
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

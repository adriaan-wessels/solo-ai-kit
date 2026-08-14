#!/usr/bin/env node
// PreToolUse(Bash) guardrail.
//
// Blocks command shapes that cause real damage — especially ones that FAIL
// SILENTLY, where a no-op reports success. A PreToolUse hook can deny a call
// and hand the reason back to the agent as text, so it self-corrects in the
// same turn. That is the point of this file: it converts "please don't do X"
// prompt boilerplate, which agents reliably ignore under load, into
// something mechanically impossible.
//
// TUNE THE RULES BELOW PER PROJECT. The set shipped here is the portable
// core (destructive or silently-failing shapes that apply to most repos);
// add project-specific ones as you discover them, and delete any that don't
// apply. A rule earns its place when it has actually cost you something.
//
// Escape hatch: set CLAUDE_GUARDRAIL_OFF=1 to disable every rule.

const fs = require('fs');
const { execFileSync } = require('child_process');

if (process.env.CLAUDE_GUARDRAIL_OFF === '1') process.exit(0);

let input = {};
try {
  input = JSON.parse(fs.readFileSync(0, 'utf8') || '{}');
} catch {
  process.exit(0); // never block on a parse failure
}

const cmd = input?.tool_input?.command;
if (typeof cmd !== 'string' || !cmd.trim()) process.exit(0);

const cwd = input.cwd || process.cwd();

function currentBranch() {
  try {
    return execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 3000,
    }).trim();
  } catch {
    return '';
  }
}

const rules = [
  {
    // Windows only. Git Bash mangles the path argument, so the batch file
    // never runs and the call exits 0 — a test gate that reports green
    // without having executed anything. Silent success is the worst failure
    // mode there is, which is why this one is first.
    name: 'batch-file-false-green',
    test: (c) =>
      /\.(bat|cmd)\b/i.test(c) &&
      /\bcmd(\.exe)?\s+\/c/i.test(c) &&
      !/MSYS_NO_PATHCONV/.test(c),
    reason:
      'Invoking a .bat/.cmd via `cmd /c` from Git Bash silently no-ops — it exits 0 without running, producing a FALSE GREEN. ' +
      'Use: MSYS_NO_PATHCONV=1 cmd.exe /c ".\\your-script.bat"',
  },
  {
    // `list`/`show` are read-only and safe; everything else mutates.
    // Patterns allow intervening global options, so `git -C <path> stash`
    // is caught too — matching only `git\s+stash` is a trivial bypass.
    name: 'git-stash-ban',
    test: (c) => /\bgit\b[^&|;]*\bstash\b/.test(c) && !/\bstash\s+(list|show)\b/.test(c),
    reason:
      'git stash is banned when agents run in parallel: refs/stash is shared across ALL worktrees of a repo, so concurrent agents race it and silently destroy each other\'s work. ' +
      'Commit to a scratch branch instead (git checkout -b wip/<topic> && git commit -am wip).',
  },
  {
    name: 'blanket-process-kill',
    test: (c) =>
      /\btaskkill\b[^&|;]*\/IM\b/i.test(c) ||
      /\bkillall\b/.test(c) ||
      /\bpkill\b/.test(c),
    reason:
      'Blanket process kills are banned — they take down unrelated work (other agent sessions, emulators, your editor). ' +
      'Target one PID: taskkill /F /PID <pid>, or kill <pid>.',
  },
  {
    name: 'release-asset-clobber',
    test: (c) => /\bgh\s+release\b[^&|;]*--clobber\b/.test(c),
    reason:
      '`--clobber` overwrites a release asset in place, destroying build provenance — you can no longer tell whether the artifact actually changed. ' +
      'Cut a new tag per build instead.',
  },
  {
    name: 'push-to-default-branch',
    test: (c) => {
      if (!/\bgit\b[^&|;]*\bpush\b/.test(c) || /--dry-run/.test(c)) return false;
      const at = c.search(/\bpush\b/);
      const args = c.slice(at + 4);
      // Explicitly naming master/main as the destination refspec.
      if (/\b(HEAD:)?(master|main)\b/.test(args)) return true;
      // A bare push (flags only, no refspec) while sitting on the default.
      const bare = /^\s*(--?\S+\s*)*$/.test(args);
      return bare && /^(master|main)$/.test(currentBranch());
    },
    reason:
      'Direct pushes to master/main are banned. Branch, push the branch, open a PR: ' +
      'git checkout -b <branch> && git push -u origin <branch> && gh pr create',
  },
];

for (const rule of rules) {
  let hit = false;
  try {
    hit = rule.test(cmd);
  } catch {
    hit = false; // a broken rule must never block work
  }
  if (hit) {
    process.stdout.write(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'deny',
          permissionDecisionReason: `[guardrail: ${rule.name}] ${rule.reason}`,
        },
      })
    );
    process.exit(0);
  }
}

process.exit(0);

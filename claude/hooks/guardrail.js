#!/usr/bin/env node
// PreToolUse(Bash|PowerShell) guardrail: it reads the incoming command
// text generically, so it guards both shells (see settings.json's matcher).
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
// Escape hatch: set CLAUDE_GUARDRAIL_OFF=1 to disable every rule. It disables
// enforcement, not the record: the override still writes its own log line
// below. An override you cannot see is the same as no guard at all.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

// Telemetry. One line per invocation, on every outcome path, per the kit's
// guard-telemetry pattern (claude/README.md, "Guard telemetry"). Grammar and
// outcome vocabulary match pr-merge-gate.js so one parser reads every guard's
// log: `timestamp|guard|outcome|target|reason`.
//
// The line that matters most here is `clean`, the common path. This guard sees
// every shell command, so its log is the only evidence that it runs at all —
// and the only way to tell a working guard from a dead one during the
// decommission test.
//
// The path follows agent-ledger.js rather than pr-merge-gate.js on purpose.
// Both hooks install machine-global (claude/README.md, "Two install modes"),
// so resolving the log next to the hook keeps a global install writing to
// ~/.claude/state/ instead of creating a stray .claude/ inside whatever repo
// the command happens to run in. A repo that never ran bootstrap.ps1 has no
// .claude/ ignore rule, and a later `git add -A` would commit that directory.
const LOG = path.join(__dirname, '..', 'state', 'guardrail.log');
const LOG_MAX_BYTES = 512 * 1024;

function log(outcome, target, reason) {
  try {
    fs.mkdirSync(path.dirname(LOG), { recursive: true });
    // Field separators and newlines cannot survive inside a field.
    const clean = (s) => String(s).replace(/[|\t\r\n]/g, ' ');
    fs.appendFileSync(
      LOG,
      `${new Date().toISOString()}|guardrail|${clean(outcome)}|${clean(target)}|${clean(reason)}\n`
    );
    // Every other guard in the kit logs once per session or once per merge.
    // This one logs once per shell command, so it is the first log here that
    // can grow without bound. Keep the recent half once it passes the cap.
    const { size } = fs.statSync(LOG);
    if (size > LOG_MAX_BYTES) {
      const kept = fs.readFileSync(LOG, 'utf8').slice(-Math.floor(LOG_MAX_BYTES / 2));
      fs.writeFileSync(LOG, kept.slice(kept.indexOf('\n') + 1));
    }
  } catch {
    /* logging is best-effort; it must never block a command */
  }
}

// Commands are long and often hold secrets in flags. Log a bounded prefix:
// enough to identify the shape, not enough to make the log a credential store.
const brief = (c) => {
  const oneLine = String(c).replace(/\s+/g, ' ').trim();
  return oneLine.length > 160 ? `${oneLine.slice(0, 160)}…` : oneLine;
};

let input = {};
try {
  input = JSON.parse(fs.readFileSync(0, 'utf8') || '{}');
} catch {
  // Read stdin before the override check, so an override records what it let
  // through. A parse failure means this guard inspected nothing at all.
  log('open:parse-failure', '-', 'stdin was not valid JSON; command not inspected');
  process.exit(0); // never block on a parse failure
}

const cmd = input?.tool_input?.command;

if (process.env.CLAUDE_GUARDRAIL_OFF === '1') {
  log('override', '-', `CLAUDE_GUARDRAIL_OFF=1; ${brief(cmd ?? '(no command)')}`);
  process.exit(0);
}

if (typeof cmd !== 'string' || !cmd.trim()) {
  // Rare by construction: the matcher restricts this hook to Bash/PowerShell,
  // which always carry a command. If this line ever becomes common, the
  // matcher and the payload shape have drifted apart, and that is the finding.
  log('open:no-command', '-', 'tool_input.command absent or empty');
  process.exit(0);
}

const cwd = input.cwd || process.cwd();

// True when this git command targets the claude-state backup repo — either
// via an explicit `git -C <path-to-claude-state>` or because the directory the
// command runs in has claude-state as its origin. Resolving the remote (rather
// than pattern-matching the path alone) means a differently-located clone is
// still recognised, and a repo that merely happens to sit in a folder of that
// name is not.
//
// This one is pre-populated (rather than left for you to discover) because
// the kit itself ships a claude-state backup flow: its backup script commits
// dated snapshots of Claude memory + config and pushes them straight to
// master on a repo named claude-state. Master IS the delivery target there —
// a PR per daily backup would be pure ceremony — so the push-to-default-branch
// rule below needs an exemption for it, the same way it would need one for
// any repo you designate as a direct-to-master automation target. Adjust the
// pattern (or delete the carve-out) if your fork uses a different repo name.
function isBackupRepo(command) {
  const BACKUP_REMOTE = /claude-state(\.git)?\/?$/;
  const dashC = command.match(/-C\s+["']?([^"'\s]+)/);
  const dir = dashC ? dashC[1] : cwd;
  try {
    const origin = execFileSync('git', ['remote', 'get-url', 'origin'], {
      cwd: dir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 3000,
    }).trim();
    return BACKUP_REMOTE.test(origin);
  } catch {
    return false;
  }
}

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
      // Carve-out: the claude-state backup repo (see isBackupRepo above).
      // This rule exists to protect CODE repos, where master is
      // branch-protected and every change belongs in a reviewed PR. A
      // dated-snapshot backup repo is different: master IS the delivery
      // target and a PR per daily backup is meaningless ceremony. Ship this
      // kit without the exemption and you get the failure it was added to
      // fix — backups committed locally and never pushed, so the off-machine
      // copy silently drifts stale for days. Scoped to that one repo by
      // remote URL or an explicit -C path; every other repo still hits the
      // ban.
      if (isBackupRepo(c)) return false;
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

// A rule whose test throws fails open, silently, for as long as nobody
// notices. Collect those names so the one log line for this invocation can
// carry them, whatever the final outcome turns out to be.
const broken = [];

for (const rule of rules) {
  let hit = false;
  try {
    hit = rule.test(cmd);
  } catch (err) {
    hit = false; // a broken rule must never block work
    broken.push(`${rule.name}: ${err?.message || 'threw'}`);
  }
  if (hit) {
    const note = broken.length ? ` [rules failing open: ${broken.join('; ')}]` : '';
    log('blocked', rule.name, `${brief(cmd)}${note}`);
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

// One line per invocation: a rule that failed open makes this pass `open:...`,
// never `clean`. Reporting it clean would be the exact false confidence this
// telemetry exists to remove.
if (broken.length) {
  log('open:rule-error', broken.map((b) => b.split(':')[0]).join(','), `${brief(cmd)} [${broken.join('; ')}]`);
} else {
  log('clean', '-', brief(cmd));
}

process.exit(0);

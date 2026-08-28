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
  // Quoted first, so a path with a space resolves whole. The previous pattern
  // stopped at the first space, so `-C "C:/My Files/claude-state"` resolved to
  // `C:/My`, the lookup failed, and the carve-out silently stopped applying —
  // re-arming the push ban against the backup repo on any machine whose home
  // path has a space in it, which on Windows is most of them.
  const dashC = command.match(/-C\s+(?:"([^"]+)"|'([^']+)'|([^\s"']+))/);
  const dir = dashC ? (dashC[1] ?? dashC[2] ?? dashC[3]) : cwd;
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

// Blank out the contents of quoted runs, preserving length and offsets, so a
// rule never fires on text that only exists inside a quoted argument.
// `echo "git push origin master"` pushes nothing and must not be blocked.
//
// Backported verbatim from pr-merge-gate.js, which solved this first and
// pointed at this file as the convention it was matching. Leaving the fix in
// only the newer hook is how the older, higher-traffic one kept the bug.
//
// Deliberately simple: still a regex pass, not a shell parser (no backtick or
// escape-aware PowerShell handling). Extended just enough to close the
// demonstrated gap, which is the same bar every rule here is held to.
function maskQuoted(s) {
  const out = s.split('');
  let q = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      out[i] = ' ';
      if (c === q && s[i - 1] !== '\\') q = null;
    } else if (c === '"' || c === "'") {
      q = c;
      out[i] = ' ';
    }
  }
  return out.join('');
}

// Blank out heredoc BODIES, preserving length, offsets and line breaks, for
// the same reason maskQuoted exists: text a command merely carries is not text
// the command runs. A PR body written with `<<'EOF' ... EOF` reached the rules
// as command text and tripped push-to-default-branch on its own prose (#6).
// An unbalanced quote in such a body also desynchronised maskQuoted for the
// whole rest of the command, so this runs first.
//
// Newlines survive the blanking, so rules that split on command separators
// still see the real line structure.
//
// Same deliberate limits as maskQuoted: a regex pass, not a shell parser. It
// handles `<<TAG`, `<<-TAG` and a quoted `<<'TAG'`, and leaves `<<<` alone.
function maskHeredocs(s) {
  const out = s.split('');
  const start = /<<-?[ \t]*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\1/g;
  let m;
  while ((m = start.exec(s)) !== null) {
    const nl = s.indexOf('\n', m.index);
    if (nl === -1) continue;
    const term = new RegExp('^[ \t]*' + m[2] + '[ \t]*$', 'm');
    const after = s.slice(nl + 1);
    const hit = after.match(term);
    // An UNTERMINATED heredoc masks nothing. Masking to end-of-string here
    // was a total disarm (#48): `<<WORD` with no matching terminator line
    // blanked the entire rest of the command, so EVERY rule saw whitespace
    // and nothing could match. `MASK=$((1<<BITS))` on a preceding line was
    // enough, and so was a `<<` inside a quoted string, because this pass
    // runs on the raw command. Measured: push-to-default-branch,
    // git-stash-ban and the force-push case all switched off.
    //
    // Masking nothing is the safe direction and costs nothing real: a
    // heredoc with no terminator is not a valid command, so there is no
    // legitimate body to protect. The failure mode flips from "guard is
    // off" to "guard reads text it could have ignored".
    if (!hit) continue;
    const end = nl + 1 + hit.index;
    for (let i = nl + 1; i < end; i++) {
      if (out[i] !== '\n' && out[i] !== '\r') out[i] = ' ';
    }
  }
  return out.join('');
}

// Every rule receives the MASKED command as its first argument, so quote
// safety is the default and no rule can forget it. The raw command comes
// second, for the rare case that must read a quoted value back (see
// push-to-default-branch, which resolves a `-C "<path>"` argument).
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
    test: (c, raw) => {
      const m = c.match(/\bgit\b[^&|;]*\bpush\b/);
      if (!m) return false;
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
      // The raw command, not the masked one: this reads a path back out of
      // `-C "<path>"`, and masking would blank the very value it needs.
      if (isBackupRepo(raw)) return false;
      // This push's own arguments, and nothing after the next command
      // separator. Reading to the end of the string is how a following
      // `gh pr create --base master` used to be read as this push's refspec,
      // denying the exact branch-and-PR workflow the reason line below tells
      // you to run (#6). `--dry-run` is scoped the same way, so a later
      // command mentioning it cannot exempt a real push.
      const args = c.slice(m.index + m[0].length).split(/[&|;\r\n]/)[0];
      if (/--dry-run/.test(args)) return false;
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
const masked = maskQuoted(maskHeredocs(cmd));

for (const rule of rules) {
  let hit = false;
  try {
    hit = rule.test(masked, cmd);
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

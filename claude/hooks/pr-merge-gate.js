#!/usr/bin/env node
// pr-merge-gate.js
//
// A PreToolUse(Bash|PowerShell) guard. It blocks an explicit `gh pr merge`
// (and a merge wrapper script such as `scripts/safe_merge.sh`) when the
// target PR's most recent review-gate comment is not a clean, current
// arming disposition.
//
// It reads the gate protocol in the kit's
// `templates/adversarial-review-gate.md`. The wiring is in
// `claude/settings.json`. This hook is project-level only. Do not install
// it machine-global: it reads one repo's PRs and writes that repo's audit
// log.
//
// ----------------------------------------------------------------------
// WHAT IT PROTECTS, AND WHAT IT DOES NOT. READ THIS BEFORE YOU ADOPT IT.
// ----------------------------------------------------------------------
//
// It protects EXPLICIT merge commands, and the record shows it does that
// well. It does NOT protect against a standing auto-merge that fires
// later.
//
// `gh pr merge --auto` turns on GitHub's native auto-merge. That is a
// standing instruction, not a one-shot approval of the diff a reviewer
// cleared. It stays live across every later push. When a fix lands after
// the arm and the checks go green, GitHub merges that new commit on its
// own servers. No tool call happens at that moment. A PreToolUse hook
// only sees commands the agent runs, so it never runs and cannot object.
//
// This matters more than it sounds. Across a five-day window on the
// source project, about 23 PRs merged and only about 11 merge commands
// reached this hook. The rest merged server-side. Expect that ratio. Do
// not treat this hook as full coverage of a merge policy.
//
// The mechanism that closes the gap is a SHA-scoped `review-gate` commit
// status, added to the branch protection rules. It puts the check where
// the merge happens. That is the known next step. It is analysed but not
// yet proven in practice, so this kit does not ship it.
//
// ----------------------------------------------------------------------
// WHY IT IS STILL WORTH INSTALLING
// ----------------------------------------------------------------------
//
// Five days live on the source project, 19 logged invocations: 2 blocks,
// 6 clean passes, 6 fail-opens, 1 disarm passthrough, 0 overrides.
//
// Both blocks were correct. Each refused a merge whose most recent gate
// comment announced a fix round instead of an approval. Each PR merged
// less than a minute later, after a clean arming comment was posted. No
// legitimate merge was stopped, and no override was recorded.
//
// This is the two-strikes rule's first shipped mechanism (kit README,
// principle 1). The lesson "arming a merge ends the review" was written
// down as prose, it recurred 11 days later, and it became this hook.
//
// ----------------------------------------------------------------------
// DETECTION
// ----------------------------------------------------------------------
//
// The hook stays cheap. A plain-text pre-filter runs before any masking
// or `gh` work. Only a hit causes a `gh pr view` call.
//
// It reads the PR comments whose first non-blank line is a
// `## ...gate...` heading, which is the gate protocol's own convention.
// It takes the MOST RECENT one. It classifies the disposition from the
// HEADING LINE ALONE, plus an explicit `**Disposition:** ...` line if the
// comment has one.
//
// Heading-only is a deliberate correction, and it is the tuning most
// worth keeping if you adapt this. The first design classified the
// heading AND the closing line of the comment body. That denied clean
// arming comments whose prose only said a non-blocking finding was
// "routed" to a follow-up issue. A review protocol that mandates the word
// "routed" for confirmed findings then fights its own merge gate.
// Classify from the heading, where the author states one disposition on
// purpose. Do not classify from free body prose.
//
// Give the heading one disposition and nothing else. Put fix-round
// history in the body. A heading that announces a fix round AND an arm on
// the same line is ambiguous, so this hook denies it, by design. That
// convention is written into `templates/adversarial-review-gate.md`.
//
// The round is UNRESOLVED, and the hook blocks, when either holds:
//
//   1. The classified disposition reads BLOCK or fix round, not ARM. A
//      MIXED heading counts as unresolved, deliberately.
//
//   2. The comment IS an arm, but the code that would merge right now is
//      not the code it reviewed. That is checked two ways:
//
//      (a) SHA cited, which is the common case, because nearly every real
//          heading names one. Find that commit's POSITION in the PR's own
//          commit list. Then check whether anything after it, BY POSITION
//          and not by timestamp, is more than a routine `Merge branch` or
//          `Merge remote-tracking branch` or `Merge pull request` resync.
//          Position is immune to a `git rebase` that rewrites every
//          committer date to "now". It is also immune to a commit that was
//          authored before the arm but pushed after it. Both of those
//          defeat a timestamp-only check. Neither changes graph position.
//          If the cited SHA is no longer in the list at all, because
//          history was rewritten past it, fall through to (b) instead of
//          assuming the worst.
//
//      (b) No usable citation: a rebase-aware timestamp fallback. A commit
//          counts as new work only if its committedDate is after the arm,
//          AND its message is not a routine resync, AND its authoredDate
//          is also after the arm. A rebase replay keeps the original
//          author time and moves committedDate to "now". A genuinely new
//          commit has both at about "now". So this excludes a clean rebase
//          to sync with the default branch, and it does not mask real
//          post-arm work.
//
// Everything else FAILS OPEN with a warning, never a block: no gate
// comment on the PR, a disposition that is neither ARM nor BLOCK, `gh`
// failing, or no resolvable PR number. A guard that blocks legitimate
// merges gets disabled, and then it protects nothing (kit README,
// principle 2).
//
// Know how that warning is delivered. Fail-open notices use a
// `systemMessage`. That field is shown to the founder in the transcript.
// It is NOT added to Claude's context, so a fail-open does not make
// Claude self-correct. Fail-open is the COMMON path, not the rare one,
// because most PRs are mid-round, or cite no SHA, or the gate does not
// apply to them. Silence toward Claude on the majority path is a
// disclosed trade-off, not an oversight.
//
// ----------------------------------------------------------------------
// GUARD-PATH REVIEW
// ----------------------------------------------------------------------
//
// A PR that changes the verification machinery is approved by that same
// machinery: hook sources, their settings wiring, the install and
// bootstrap scripts, workflows, the gate template, probes, and test
// files all live in the repo, and agent review of such a diff is
// self-review moved one level up. Nobody human reads diffs in this
// operating model, so the tracker issue "A diff that changes the
// verification machinery is approved by the machinery it changes" asked
// for a mechanical requirement instead. This is its hook-scoped half.
//
// When the PR's changed files touch a guard path (GUARD_PATH_RES), the
// gate tightens in two ways:
//
//   1. The usual fail-opens become denies. No gate comment at all, or a
//      heading with no recognizable disposition, blocks instead of
//      warning. Guard paths change rarely and deliberately, so the
//      false-positive cost of hard-blocking is one the precision can
//      sustain (kit README, principle 6).
//
//   2. A clean, current ARM is not enough. The arming comment must also
//      carry a `**Guard-path review:** <substrate>` line, recording an
//      independent review on a model substrate different from the
//      authoring agents, run to the frozen protocol in
//      `templates/adversarial-review-gate.md` ("Guard-path review").
//      The line is accepted in plain, bold, bulleted, numbered, or
//      quoted form, with the colon inside or outside the bold. Values
//      that record no review are rejected: '<'-opening template
//      placeholders, values with no letter in any script, and a
//      leading clause (before the first ';' or ',') that is a bare
//      marker (none/n-a/TBD/todo/pending/x) or a skip-statement.
//      "Sonnet; none found" stays valid: "none found" is a finding,
//      "skipped" is a confession. Named residual: a confession carried
//      only in trailing words passes; the line is a disclosure, not
//      proof.
//
// State plainly what this measures and what it cannot. The hook checks
// that the line EXISTS on a current arm. It cannot verify that the
// named substrate really reviewed anything: that claim is judged-side
// evidence, a disclosure and not a proof. What the mechanism buys is
// that the disclosure must exist, be attached to the arm, and be
// current, so skipping the review becomes a visible false statement in
// the record rather than a silent omission.
//
// Detection edges, closed by the PR's own guard-path review round: a
// RENAME counts as guard-touching wholesale, because GitHub reports
// only the new path and a move out of a guard directory would
// otherwise be invisible; and a changed-file list gh TRUNCATES (the
// 100-file cap of `--json files`, cli/cli#5368) is demoted to
// unreadable by comparing `changedFiles` against the list length, so a
// guard file hiding past the cap reads as "could not check", never as
// "not touched". The demotion applies only to a NEGATIVE result: a
// guard file gh did report is positive evidence and keeps its deny
// even when the list is incomplete. Round 2 of the review caught the
// first cut of this fix discarding exactly that evidence.
//
// The known limit is the hook's own: this protects explicit merge
// commands only. The server-side half (auto-merge firing on a later
// green) is the ruleset-required status the tracker issue holds as its
// blocked item. And if the changed-file list cannot be read in full,
// this check fails open with a warning (logged as
// open:guard-files-unreadable), like every other unreadable input
// here.
//
// ----------------------------------------------------------------------
// TRIGGER MATCHING
// ----------------------------------------------------------------------
//
// Matching `gh pr merge` anywhere in the command TEXT is wrong, and it
// was demonstrated live against the first version of this hook. It fired
// on a `git commit -m "...explains that gh pr merge --auto is..."` and on
// a `grep -R 'gh pr merge' .claude/hooks`. A guard that reads the whole
// command string sees quoted text as if it were a command.
//
// The fix: mask the quoted spans first. Single-quoted and double-quoted
// spans are blanked out, with the length preserved. The match must then
// land on a real command boundary IN THE MASKED STRING: the start of the
// string, or right after `;` `&` `|` or a newline. A boundary character
// that exists only inside a quoted argument does not count either.
//
// A merge wrapper script is matched the same way, as a second trigger
// shape. The shipped pattern matches `safe_merge.sh`. Change the name in
// SAFE_MERGE_RE if your project's wrapper is called something else. The
// wrapper needs its own trigger because the `gh pr merge` inside it runs
// in the script's own process, where this hook cannot see it as text.
//
// ----------------------------------------------------------------------
// OVERRIDE
// ----------------------------------------------------------------------
//
// bash: run `export CLAUDE_MERGE_GATE_OVERRIDE=1;` and the merge command
// together, in one call.
//
// Do NOT use the inline `CLAUDE_MERGE_GATE_OVERRIDE=1 <command>` prefix. A
// command that starts with an inline env-var assignment never reaches the
// trigger, because the match has to land on a command boundary (see TRIGGER
// MATCHING above). The merge then runs unchecked AND unlogged, which is a
// silent bypass, not an audited override. Any inline assignment does this,
// not only this variable: `GH_TOKEN=... gh pr merge` is invisible to the
// hook in the same way. Widening BOUNDARY to accept a leading run of
// assignments closes it. That change is not made here, because it also
// widens what the hook blocks, and this hook's record was measured without
// it.
//
// PowerShell: prefix with `$env:CLAUDE_MERGE_GATE_OVERRIDE = '1'`. The
// `env:` part is case-insensitive and the quotes are optional. PowerShell
// needs its own form, because bash's env-var syntax is not valid
// PowerShell. The first version of this hook accepted only the bash form,
// and a founder who copied the deny message verbatim into PowerShell got a
// syntax error. If PowerShell is your primary shell,
// check that the deny message names a form your shell can run.
//
// The hook also honours `process.env.CLAUDE_MERGE_GATE_OVERRIDE === '1'`
// set on its own process.
//
// Every override that reaches the hook is appended to
// `.claude/state/pr-merge-gate.log` at the repo root, resolved through
// `CLAUDE_PROJECT_DIR` and not through the tool call's cwd. A subagent
// working in a worktree then does not write its audit row into a directory
// that dies with the worktree.
//
// Escape hatch for the whole hook, which matches guardrail.js's
// convention: CLAUDE_GUARDRAIL_OFF=1.
//
// ----------------------------------------------------------------------
//
// The classifier helpers are exported, so you can replay this hook
// against your own PR history before you change its rules. See
// claude/README.md, "Corpus replay for guards that classify text". The
// CLI logic below runs only when this file is invoked directly.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const GATE_HEADING = /^#{1,6}\s.*\bgate\b/i;
const BLOCK_RE = /\brouted\b|\bBLOCK\b|\bfix round\b|\bbefore (arming|merge)\b/i;
const ARM_RE = /\barm(ing)?\b/i;
const DISPOSITION_LINE_RE = /^\**Disposition:/i;
const SYNC_COMMIT_RE = /^Merge (branch|remote-tracking branch|pull request)\b/i;
const SHA_CITE_RE = /`([0-9a-f]{6,40})`/i;

// Guard paths. The tracker issue's list, widened once by the PR's own
// guard-path review round: the wiring file (claude/settings.json) and
// the machine-global installer joined it, because an edit that disarms
// the gate must not meet less resistance than an edit to the gate
// itself. Test-file patterns cover the suffixes downstream projects
// actually use. Paths come from `gh pr view --json files` and use
// forward slashes; isGuardPath() normalizes backslashes anyway. Honesty
// note for this repo: `.claude/` is untracked here (.gitignore), so the
// `.claude/` clause binds only downstream projects that commit it.
const GUARD_PATH_RES = [
  /^claude\/hooks\//i,
  /^claude\/settings\.json$/i,
  /^scripts\/install-global-hooks\.ps1$/i,
  /^scripts\/bootstrap\.ps1$/i,
  /^\.github\//i,
  /^templates\/adversarial-review-gate\.md$/i,
  /^\.claude\//i,
  /\.(test|spec|selftest)\.[a-z0-9]+$/i,
  /_test\.[a-z0-9]+$/i,
  /(^|\/)test_[^/]+\.py$/i,
];
// The review line is matched on a normalized copy of each body line
// (leading list/quote markers and every '*' stripped), so the bullet
// form the template itself renders is accepted, and so is the colon
// outside the bold. Placeholder values that state no review happened
// are rejected: the line records a review, and "none" is not one.
const GUARD_REVIEW_VALUE_RE = /^Guard-path review:\s*(\S.*)$/i;

// isPlaceholderReviewValue(v) -> true when the review line's value does
// not record a review. '<'-opening values are unfilled template
// placeholders (parentheses, brackets, and markdown links are
// legitimate substrate spellings); a value with no letter in any
// script is punctuation; and the LEADING CLAUSE (before the first ';'
// or ',', where the substrate-first format names the reviewer) must
// not be a bare marker or a skip-statement. "Sonnet 5; one residual
// deferred to a follow-up" is a review whose verdict mentions
// deferral; "deferred to a follow-up" alone is not a review. Round 3's
// catch: the whole-value scan rejected exactly the phrasing this kit's
// own residuals use. Named residual, the deliberate trade: a
// confession carried only in trailing words ("pending a second
// substrate") passes; the line is a disclosure, not proof, and
// content-validating free text past this point buys false positives
// principle 6 cannot sustain. "Sonnet; none found" stays valid: "none
// found" is a finding, "skipped" is a confession.
function isPlaceholderReviewValue(v) {
  const value = String(v).trim();
  if (!/\p{L}/u.test(value)) return true;
  if (/^</.test(value)) return true;
  const lead = value.split(/[;,]/, 1)[0].trim();
  if (/^(none|n\.?\/?a\.?|tbd|todo|pending|x)[.!]?$/i.test(lead)) return true;
  if (/\bskip(ped|s)?\b|\bdeferred\b|fill (me )?in/i.test(lead)) return true;
  return false;
}

const BOUNDARY = '(?:^|[;&|\\r\\n])\\s*';
const GH_MERGE_RE = new RegExp(BOUNDARY + '(gh\\s+pr\\s+merge\\b)', 'i');
const SAFE_MERGE_RE = new RegExp(BOUNDARY + '((?:bash\\s+|sh\\s+|\\.[\\\\/])?\\S*safe_merge\\.sh\\b)', 'i');
const CHEAP_PREFILTER_RE = /gh\s+pr\s+merge|safe_merge\.sh/i;
const STOP_OPERATOR_RE = /&&|\|\||[;|\r\n]/;

const BASH_OVERRIDE_RE = /(?:^|[;&|\r\n])\s*(?:export\s+)?CLAUDE_MERGE_GATE_OVERRIDE=1\b/;
const PWSH_OVERRIDE_RE = /\$env:CLAUDE_MERGE_GATE_OVERRIDE\s*=\s*(['"]?)1\1(?!\d)/i;

function bodyLines(body) {
  return body
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !/^🤖\s*Generated with/i.test(l));
}

function isGateComment(body) {
  if (typeof body !== 'string') return false;
  const lines = bodyLines(body);
  return lines.length > 0 && GATE_HEADING.test(lines[0]);
}

// classify(body) -> 'BLOCKED' | 'ARMED' | 'UNKNOWN'. Heading-only, plus an
// explicit `Disposition:` line if present. See header for why the old
// full-closing-line scan was wrong.
function classify(body) {
  const lines = bodyLines(body);
  const heading = lines[0] || '';
  const dispositionLine = [...lines].reverse().find((l) => DISPOSITION_LINE_RE.test(l));
  const signal = dispositionLine ? `${heading}\n${dispositionLine}` : heading;
  if (BLOCK_RE.test(signal)) return 'BLOCKED';
  if (ARM_RE.test(signal)) return 'ARMED';
  return 'UNKNOWN';
}

// isGuardPath(path) -> does this changed file edit the verification
// machinery. See the GUARD-PATH REVIEW section in the header.
function isGuardPath(p) {
  const norm = String(p || '').replace(/\\/g, '/');
  return GUARD_PATH_RES.some((re) => re.test(norm));
}

// guardTouchedFiles(files) -> labels of the changed files that require
// a guard-path review: every path matching GUARD_PATH_RES, plus every
// rename. GitHub reports only a rename's NEW path, so a move OUT of a
// guard directory is otherwise invisible; renames are rare enough to
// carry the requirement wholesale (kit README, principle 6).
function guardTouchedFiles(files) {
  const out = [];
  for (const f of files || []) {
    if (!f) continue;
    const p = String(f.path || '');
    if (isGuardPath(p)) out.push(p);
    else if (p && String(f.changeType || '').toUpperCase() === 'RENAMED') out.push(`${p} (renamed)`);
  }
  return out;
}

// hasGuardPathReview(body) -> does this gate comment carry a
// `Guard-path review: <substrate>` line whose value names a review
// rather than the absence of one. The line is a disclosure, not proof;
// the header states what that buys.
function hasGuardPathReview(body) {
  if (typeof body !== 'string') return false;
  return bodyLines(body).some((l) => {
    const norm = l
      .replace(/^(?:[-*+]\s+|\d+[.)]\s+|>\s+)*/, '')
      .replace(/\*/g, '')
      .trim();
    const m = norm.match(GUARD_REVIEW_VALUE_RE);
    return !!m && !isPlaceholderReviewValue(m[1]);
  });
}

// resolveGuardTouched(files, changedFiles) -> the guard labels for this
// PR, [] for a definite "none touched", or null for "unreadable". The
// 100-file truncation of `--json files` (cli/cli#5368) demotes only a
// NEGATIVE result: a guard file gh did report is positive evidence and
// keeps its deny even when the list is incomplete. Round 2 of the
// guard-path review caught the first cut discarding that evidence.
function resolveGuardTouched(files, changedFiles) {
  if (!Array.isArray(files)) return null;
  // An entry without a usable path makes the whole list unreliable, so
  // it reads as unreadable (fail open with the warning), never as
  // evidence of anything. Round 3: an empty-path rename had drifted
  // from fail-closed to a definite "not touched".
  for (const f of files) {
    if (!f || typeof f.path !== 'string' || !f.path) return null;
  }
  const visible = guardTouchedFiles(files);
  if (visible.length) return visible;
  const truncated = Number.isFinite(changedFiles) && changedFiles > files.length;
  return truncated ? null : visible;
}

// findStaleness({heading, commits, armTs}) -> a stale commit object, or
// null when the arm is current. See header for the SHA-position vs
// timestamp-fallback design.
function findStaleness({ heading, commits, armTs }) {
  const citedMatch = heading.match(SHA_CITE_RE);
  const cited = citedMatch ? citedMatch[1].toLowerCase() : null;

  if (cited) {
    const idx = commits.findIndex((c) => String(c.oid || '').toLowerCase().startsWith(cited));
    if (idx !== -1) {
      const after = commits.slice(idx + 1);
      return after.find((c) => !SYNC_COMMIT_RE.test(c.messageHeadline || '')) || null;
    }
    // Cited SHA no longer in the list (history rewritten past it, e.g. a
    // rebase) -- fall through to the timestamp heuristic below instead of
    // assuming the worst.
  }

  return (
    commits.find((c) => {
      const committed = Date.parse(c.committedDate);
      if (!Number.isFinite(committed) || committed <= armTs) return false;
      if (SYNC_COMMIT_RE.test(c.messageHeadline || '')) return false;
      const authored = Date.parse(c.authoredDate);
      if (Number.isFinite(authored) && authored <= armTs) return false;
      return true;
    }) || null
  );
}

// Blank out quoted spans (same length preserved) so boundary/anchor
// matching never fires on text that only exists inside a quoted argument.
// Deliberately simple (no backtick/escape-aware PowerShell handling) --
// matches this codebase's existing regex-not-a-shell-parser convention
// (see guardrail.js), just extended enough to close the demonstrated gap.
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

// Slice `original` from `start` to the next unquoted shell operator,
// found via `masked` (same length as `original`) so an operator-looking
// character inside a quoted argument doesn't end the slice early.
function sliceToOperator(original, masked, start) {
  const rel = masked.slice(start).search(STOP_OPERATOR_RE);
  return rel === -1 ? original.slice(start) : original.slice(start, start + rel);
}

module.exports = {
  GATE_HEADING,
  BLOCK_RE,
  ARM_RE,
  SYNC_COMMIT_RE,
  SHA_CITE_RE,
  GUARD_PATH_RES,
  GUARD_REVIEW_VALUE_RE,
  isPlaceholderReviewValue,
  resolveGuardTouched,
  GH_MERGE_RE,
  SAFE_MERGE_RE,
  CHEAP_PREFILTER_RE,
  BASH_OVERRIDE_RE,
  PWSH_OVERRIDE_RE,
  isGateComment,
  classify,
  isGuardPath,
  guardTouchedFiles,
  hasGuardPathReview,
  findStaleness,
  maskQuoted,
  sliceToOperator,
};

if (require.main === module) {
  main();
}

function main() {
  if (process.env.CLAUDE_GUARDRAIL_OFF === '1') process.exit(0);

  let input = {};
  try {
    input = JSON.parse(fs.readFileSync(0, 'utf8') || '{}');
  } catch {
    process.exit(0); // never block on a parse failure
  }

  const cmd = input?.tool_input?.command;
  if (typeof cmd !== 'string' || !cmd.trim()) process.exit(0);

  // Fast exit for the overwhelming majority of calls: cheap substring test
  // before any masking/anchoring work.
  if (!CHEAP_PREFILTER_RE.test(cmd)) process.exit(0);

  const masked = maskQuoted(cmd);
  const ghHit = masked.match(GH_MERGE_RE);
  const safeMergeHit = !ghHit ? masked.match(SAFE_MERGE_RE) : null;
  if (!ghHit && !safeMergeHit) process.exit(0); // matched only inside a quoted string

  const hit = ghHit || safeMergeHit;
  const invocationEnd = hit.index + hit[0].length; // capture group 1 is the tail of the full match
  const isSafeMergeEntry = !ghHit;

  const cwd = input.cwd || process.cwd();
  const projectDir = process.env.CLAUDE_PROJECT_DIR || cwd;
  const STATE = path.join(projectDir, '.claude', 'state');
  const LOG = path.join(STATE, 'pr-merge-gate.log');

  // Log grammar: the kit's guard-telemetry line (claude/README.md, "Guard
  // telemetry"). Pipe-delimited, lowercase outcomes (blocked | clean |
  // open:<slug> | override), hook name as field 2, plus a fifth free-text
  // reason field for this hook's richer diagnostics. Keep one vocabulary
  // across every guard, so a single parser reads all of their logs.
  function log(outcome, prLabel, reason) {
    try {
      fs.mkdirSync(STATE, { recursive: true });
      const clean = (s) => String(s).replace(/[|\t\n]/g, ' ');
      const line = `${new Date().toISOString()}|pr-merge-gate|${clean(outcome)}|${clean(prLabel)}|${clean(reason)}\n`;
      fs.appendFileSync(LOG, line);
    } catch {
      /* logging is best-effort; never let it block */
    }
  }

  function allow(warning, slug) {
    // Telemetry: every engaged outcome leaves a row. A gate whose majority
    // outcome (fail-open) is unrecorded is indistinguishable from an
    // uninstalled one. `clean` = verified current ARM; `open:...` = fail-open
    // (callers may pass a more specific open:<slug>).
    log(
      warning ? (slug || 'open:fail-open') : 'clean',
      prNumber ? `#${prNumber}` : '(unresolved)',
      warning || 'clean current ARM verified; merge allowed'
    );
    if (warning) {
      process.stdout.write(JSON.stringify({ systemMessage: `[pr-merge-gate] ${warning}` }));
    }
    process.exit(0);
  }

  function deny(reason) {
    process.stdout.write(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'deny',
          permissionDecisionReason: `[pr-merge-gate] ${reason}`,
        },
      })
    );
    process.exit(0);
  }

  const OVERRIDE_HELP =
    'bash: export CLAUDE_MERGE_GATE_OVERRIDE=1; <command> ; PowerShell: $env:CLAUDE_MERGE_GATE_OVERRIDE=\'1\'; <command>. ' +
    'Both of those forms are logged to .claude/state/pr-merge-gate.log. ' +
    'Do not use the inline VAR=1 <command> prefix: it skips this hook entirely, so nothing is logged.';

  const override =
    BASH_OVERRIDE_RE.test(cmd) || PWSH_OVERRIDE_RE.test(cmd) || process.env.CLAUDE_MERGE_GATE_OVERRIDE === '1';

  let tail = sliceToOperator(cmd, masked, invocationEnd);

  if (!isSafeMergeEntry) {
    if (/(^|\s)--disable-auto(\s|$)/.test(tail)) {
      log('open:disarm-safe', '(n/a)', '--disable-auto: disarming is always safe');
      process.exit(0);
    }
    if (/(^|\s)(-h|--help)(\s|$)/.test(tail)) process.exit(0);
  }

  // -R/--repo can appear anywhere in the whole `gh ...` invocation.
  const repoMatch = cmd.match(/(?:-R|--repo)[= ]("([^"]+)"|'([^']+)'|(\S+))/);
  const repoFlag = repoMatch ? repoMatch[2] || repoMatch[3] || repoMatch[4] : null;

  const VALUE_FLAGS = new Set([
    '-R', '--repo', '-t', '--title', '-b', '--body', '-F', '--body-file',
    '--match-head-commit', '--author-email',
  ]);

  let prArg = null;
  const tokens = tail.trim().split(/\s+/).filter(Boolean);
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.startsWith('-')) {
      if (!isSafeMergeEntry && VALUE_FLAGS.has(t) && i + 1 < tokens.length && !tokens[i + 1].startsWith('-')) i++;
      continue;
    }
    prArg = t;
    break;
  }

  let prNumber = null;
  if (prArg) {
    if (/^\d+$/.test(prArg)) prNumber = prArg;
    else {
      const m = prArg.match(/\/pull\/(\d+)/);
      if (m) prNumber = m[1];
    }
  }

  function ghCall(args, timeout = 6000) {
    // Budget: at most 2 calls (this one, plus the optional --json number
    // resolution below) at 6s each = 12s worst case, inside the
    // PreToolUse hook's own 15s timeout in .claude/settings.json with a
    // 3s margin for process overhead -- kept in agreement deliberately.
    const finalArgs = repoFlag ? [...args, '-R', repoFlag] : args;
    return execFileSync('gh', finalArgs, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout,
    });
  }

  if (!prNumber) {
    try {
      const view = JSON.parse(ghCall(['pr', 'view', '--json', 'number']));
      prNumber = String(view.number);
    } catch {
      allow(
        'could not resolve a PR number for this merge command (not on a tracked PR branch, or gh failed). Allowing; verify the gate round manually before merging.'
      );
    }
  }

  let data;
  try {
    data = JSON.parse(ghCall(['pr', 'view', prNumber, '--json', 'comments,commits,state,mergedAt,files,changedFiles']));
  } catch {
    allow(
      `could not read PR #${prNumber} (gh failed or PR not found). Allowing; verify the gate round manually before merging.`
    );
  }

  if (data.state === 'MERGED') {
    log('open:already-merged', `#${prNumber}`, 'PR already merged, nothing left to protect');
    process.exit(0);
  }

  const comments = Array.isArray(data.comments) ? data.comments : [];
  const commits = Array.isArray(data.commits) ? data.commits : [];

  // Guard-path detection (see GUARD-PATH REVIEW in the header). null =
  // unreadable, fails open later with a warning; [] = definite "no guard
  // paths touched". Truncation and positive-evidence handling live in
  // resolveGuardTouched, where the suite can reach them.
  const guardTouched = resolveGuardTouched(data.files, data.changedFiles);
  const guardList =
    guardTouched && guardTouched.length
      ? guardTouched.slice(0, 5).join(', ') + (guardTouched.length > 5 ? ` and ${guardTouched.length - 5} more` : '')
      : '';
  // A renamed docs file is not "machinery"; it is watched because GitHub
  // hides its old path. Say so instead of asserting something untrue.
  const renameNote =
    guardTouched && guardTouched.some((l) => l.endsWith('(renamed)'))
      ? ' Renamed files count because GitHub reports only their new path, so a move out of a guard directory is otherwise invisible.'
      : '';

  const gateComments = comments
    .filter((c) => isGateComment(c.body))
    .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));

  if (!gateComments.length) {
    if (guardTouched && guardTouched.length) {
      const reason = `PR #${prNumber} touches the verification machinery (${guardList}) and has no "## ...gate..." comment at all. Guard-path PRs do not fail open.${renameNote}`;
      log('blocked', `#${prNumber}`, 'guard-path: no gate round');
      if (override) {
        log('override', `#${prNumber}`, `guard-path-no-round; command="${cmd}"`);
        allow(`OVERRIDE used on PR #${prNumber}. ${reason} Logged to ${LOG}.`);
      }
      deny(
        `${reason} Run a gate round with an independent guard-path review and post its arming comment first (templates/adversarial-review-gate.md, "Guard-path review"). Deliberate override: ${OVERRIDE_HELP}`
      );
    }
    allow(
      `PR #${prNumber} has no "## ...gate..." comment yet (the pre-merge review gate). Nothing to check against, so allowing. If this PR is meant to go through the pre-merge gate, get a round posted first.`
    );
  }

  const last = gateComments[gateComments.length - 1];
  const heading = bodyLines(last.body)[0] || '';
  const disposition = classify(last.body);

  if (disposition === 'BLOCKED') {
    const reason = `PR #${prNumber}'s most recent gate comment (${last.createdAt}) is not a clean arming disposition: "${heading}".`;
    log('blocked', `#${prNumber}`, reason);
    if (override) {
      log('override', `#${prNumber}`, `not-armed; command="${cmd}"`);
      allow(`OVERRIDE used on PR #${prNumber}. ${reason} Logged to ${LOG}.`);
    }
    deny(`${reason} Finish the round. Get a gate comment posted that confirms ARM for the current HEAD before merging. Deliberate override: ${OVERRIDE_HELP}`);
  }

  if (disposition === 'UNKNOWN') {
    if (guardTouched && guardTouched.length) {
      const reason = `PR #${prNumber} touches the verification machinery (${guardList}), and its most recent gate comment (${last.createdAt}) has no recognizable ARM/BLOCK disposition: "${heading}". Guard-path PRs do not fail open.${renameNote}`;
      log('blocked', `#${prNumber}`, 'guard-path: unknown disposition');
      if (override) {
        log('override', `#${prNumber}`, `guard-path-unknown; command="${cmd}"`);
        allow(`OVERRIDE used on PR #${prNumber}. ${reason} Logged to ${LOG}.`);
      }
      deny(
        `${reason} Post a clean arming comment that carries a "Guard-path review:" line (templates/adversarial-review-gate.md, "Guard-path review"). Deliberate override: ${OVERRIDE_HELP}`
      );
    }
    allow(
      `PR #${prNumber}'s most recent gate comment (${last.createdAt}) has no recognizable ARM/BLOCK disposition: "${heading}". Allowing; verify manually.`
    );
  }

  const armTs = Date.parse(last.createdAt);
  const staleCommit = findStaleness({ heading, commits, armTs });

  if (staleCommit) {
    const shortSha = String(staleCommit.oid || '').slice(0, 9);
    const reason =
      `PR #${prNumber} was armed by a gate comment at ${last.createdAt} ("${heading}"), but commit ${shortSha} ` +
      `("${staleCommit.messageHeadline}") is not accounted for by that arm. The reviewed diff is not the diff that would merge now.`;
    log('blocked', `#${prNumber}`, `stale arm: commit ${shortSha}`);
    if (override) {
      log('override', `#${prNumber}`, `stale-arm; command="${cmd}"`);
      allow(`OVERRIDE used on PR #${prNumber}. ${reason} Logged to ${LOG}.`);
    }
    deny(`${reason} Get a fresh gate comment confirming ARM for the current HEAD before merging. Deliberate override: ${OVERRIDE_HELP}`);
  }

  if (guardTouched && guardTouched.length && !hasGuardPathReview(last.body)) {
    const reason =
      `PR #${prNumber} touches the verification machinery (${guardList}), and its arming gate comment (${last.createdAt}) ` +
      `records no guard-path review. This diff is reviewed by the machinery it changes, so the arm alone is self-review.${renameNote}`;
    log('blocked', `#${prNumber}`, 'guard-path: no review line');
    if (override) {
      log('override', `#${prNumber}`, `guard-path-no-review; command="${cmd}"`);
      allow(`OVERRIDE used on PR #${prNumber}. ${reason} Logged to ${LOG}.`);
    }
    deny(
      `${reason} Get an independent review on a different model substrate and re-post the arm with a ` +
      `"Guard-path review:" line naming the reviewing substrate and its verdict (templates/adversarial-review-gate.md, "Guard-path review"). Deliberate override: ${OVERRIDE_HELP}`
    );
  }

  if (guardTouched === null) {
    allow(
      `PR #${prNumber}: clean current ARM verified, but the changed-file list could not be read in full (gh omitted it, or the PR exceeds the 100-file cap of --json files), so the guard-path review requirement was not checked. Verify manually if this PR touches hooks, workflows, settings, the gate template, or tests.`,
      'open:guard-files-unreadable'
    );
  }

  // Clean: most recent gate comment is an ARM disposition and nothing
  // unaccounted-for has landed since. Let it through, leaving the telemetry
  // row that makes a quiet gate distinguishable from a dead one.
  log(
    'clean',
    `#${prNumber}`,
    guardTouched && guardTouched.length
      ? `clean current ARM with guard-path review verified ("${heading}")`
      : `clean current ARM verified ("${heading}")`
  );
  process.exit(0);
}

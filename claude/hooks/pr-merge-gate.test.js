#!/usr/bin/env node
// Replay harness for pr-merge-gate.js, per claude/README.md ("Corpus replay
// for guards that classify text"). Run it before you change any rule here:
//
//   node claude/hooks/pr-merge-gate.test.js
//
// This hook classifies free text in two places at once, which is why it needs
// this more than most: it decides whether a COMMAND is a merge attempt, and
// it decides whether a PR COMMENT arms or blocks that merge. Either can
// regress silently while the other still looks right.
//
// The hook's own header already invited this ("the classifier helpers are
// exported, so you can replay this hook against your own PR history"). It
// shipped without one. It is the kit's newest guard and, until this file, the
// only text-classifying guard with no replay at all.
//
// WHAT THIS ASSERTS, and one thing it deliberately does NOT fix:
//
// The inline env-var prefix bypass (issue #17) is a KNOWN, DOCUMENTED limit,
// not an oversight. The hook's header says widening BOUNDARY would close it
// and deliberately declines, because widening also widens what the hook
// blocks and the hook's measured record was gathered without that change.
// So this harness ASSERTS THE CURRENT BEHAVIOUR rather than asserting the
// behaviour we might prefer. That turns a limit described in prose into a
// limit measured by a test: if someone widens BOUNDARY, these cases fail and
// force the change to be deliberate, with the record re-measured. A guard's
// documented edge should fail loudly when it moves, not drift quietly.
//
// A KNOWN-GOOD CONTROL runs first. If it stops passing, distrust every other
// result in this file: it means the harness is not exercising the hook.
//
// WHAT THIS DOES NOT COVER, stated plainly because a test suite that hides
// its own gap is the thing this kit warns about. These cases exercise the
// EXPORTED classifiers. They do not run `main()`, so they cannot catch a
// regression in how main() wires those classifiers together. Measured, not
// assumed: replacing `maskQuoted(cmd)` with `cmd` inside main() leaves every
// case below passing. Covering that does NOT need a real PR: two review
// rounds on #61 each built a subprocess harness with a stubbed gh (a
// node -r preload replacing child_process.execFileSync) and drove main()
// offline. An earlier revision of this header claimed offline coverage was
// impossible; that claim was refuted live, twice. The committed version of
// that harness is a named follow-up of the #59 review round; #59 is the
// decision-of-record for it. Until it lands, treat a green run here as
// "the classifiers are right", never as "the hook is right".

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

// --prove points this at a deliberately broken copy. Normal runs use the
// shipped hook.
const HOOK_SRC = path.join(__dirname, 'pr-merge-gate.js');
const HOOK = process.env.PR_MERGE_GATE_PATH || HOOK_SRC;

// ---------------------------------------------------------------------------
// --prove: the suite is evidence only if it can fail.
//
// Reintroduces each defect these cases exist to catch and requires the suite
// to go RED for every one. A suite that has quietly stopped asserting
// anything fails here instead of passing green forever (README, principle 3).
//
// Each mutation carries its own control: if the anchor text is not found, the
// mutation never applied, and an unapplied mutation is indistinguishable from
// a test that missed it. It reports as the REASSURING result, so it is
// treated as a hard failure rather than a pass.
// ---------------------------------------------------------------------------
if (process.argv.includes('--prove')) {
  const src = fs.readFileSync(HOOK_SRC, 'utf8');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-prove-'));
  const MUTATIONS = [
    [
      'widening BOUNDARY to swallow inline assignments (issue #17)',
      String.raw`const BOUNDARY = '(?:^|[;&|\\r\\n])\\s*';`,
      String.raw`const BOUNDARY = '(?:^|[;&|\\r\\n])\\s*(?:[A-Za-z_][A-Za-z0-9_]*=\\S*\\s+)*';`,
    ],
    [
      'a BLOCK disposition no longer beats an arm in the same body',
      String.raw`const BLOCK_RE = /\brouted\b|\bBLOCK\b|\bfix round\b|\bbefore (arming|merge)\b/i;`,
      String.raw`const BLOCK_RE = /\bNEVERMATCHTHIS\b/i;`,
    ],
    [
      'a merge-in from the default branch counts as a new change',
      String.raw`const SYNC_COMMIT_RE = /^Merge (branch|remote-tracking branch|pull request)\b/i;`,
      String.raw`const SYNC_COMMIT_RE = /^NEVERMATCHTHIS/i;`,
    ],
    [
      'the merge trigger becomes case-sensitive',
      String.raw`const GH_MERGE_RE = new RegExp(BOUNDARY + '(gh\\s+pr\\s+merge\\b)', 'i');`,
      String.raw`const GH_MERGE_RE = new RegExp(BOUNDARY + '(gh\\s+pr\\s+merge\\b)');`,
    ],
    [
      'the cheap prefilter stops recognising the wrapper script',
      String.raw`const CHEAP_PREFILTER_RE = /gh\s+pr\s+merge|safe_merge\.sh/i;`,
      String.raw`const CHEAP_PREFILTER_RE = /gh\s+pr\s+merge/i;`,
    ],
    [
      'hook sources stop counting as guard paths: the machinery edits itself unwatched',
      String.raw`  /^claude\/hooks\//i,`,
      String.raw`  /^NEVERMATCHTHIS\//i,`,
    ],
    [
      'the guard-path review line matches anything, so its absence never blocks',
      String.raw`const GUARD_REVIEW_VALUE_RE = /^Guard-path review:\s*(\S.*)$/i;`,
      String.raw`const GUARD_REVIEW_VALUE_RE = /^(.*)$/i;`,
    ],
    [
      'skip-statements start counting as reviews',
      String.raw`  if (/\bskip(ped|s)?\b|\bdeferred\b|fill (me )?in/i.test(lead)) return true;`,
      String.raw`  if (false) return true;`,
    ],
    [
      'the wiring file stops counting: disarming the gate via settings goes unwatched',
      String.raw`  /^claude\/settings\.json$/i,`,
      String.raw`  /^NEVERMATCHTHISTWO$/i,`,
    ],
    [
      'renames stop counting: a move out of a guard directory goes unwatched',
      String.raw`.toUpperCase() === 'RENAMED'`,
      String.raw`.toUpperCase() === 'NEVERRENAMED'`,
    ],
    [
      'truncation stops demoting: a guard file past the 100-file cap reads as not touched',
      String.raw`  const truncated = Number.isFinite(changedFiles) && changedFiles > files.length;`,
      String.raw`  const truncated = false;`,
    ],
    [
      'truncation demotes positive evidence: a visible guard file loses its deny on big PRs',
      String.raw`  if (visible.length) return visible;`,
      String.raw`  if (false) return visible;`,
    ],
  ];

  const runAgainst = (hookPath) => {
    try {
      execFileSync('node', [__filename], {
        encoding: 'utf8',
        env: { ...process.env, PR_MERGE_GATE_PATH: hookPath },
      });
      return 0;
    } catch (e) {
      return e.status === undefined ? 1 : e.status;
    }
  };

  let bad = 0;

  // Control: the suite must PASS against the untouched hook. Without this, a
  // suite broken in some unrelated way would "catch" every mutation and look
  // perfect.
  if (runAgainst(HOOK_SRC) !== 0) {
    console.log('FAIL  CONTROL: the suite does not pass against the unmodified hook');
    bad++;
  } else {
    console.log('PASS  CONTROL: the suite passes against the unmodified hook');
  }

  MUTATIONS.forEach(([label, from, to], i) => {
    if (!src.includes(from)) {
      console.log(`FAIL  mutation ${i + 1} never applied (anchor not found): ${label}`);
      bad++;
      return;
    }
    const file = path.join(dir, `mutant-${i + 1}.js`);
    fs.writeFileSync(file, src.replace(from, to));
    const code = runAgainst(file);
    if (code === 0) {
      console.log(`FAIL  mutation ${i + 1} NOT caught: ${label}`);
      bad++;
    } else {
      console.log(`PASS  mutation ${i + 1} caught: ${label}`);
    }
  });

  console.log(bad ? `\n${bad} problem(s): the suite is not the evidence it claims to be` : '\nALL MUTATIONS CAUGHT');
  process.exit(bad ? 1 : 0);
}

const g = require(HOOK);

let failures = 0;
let passes = 0;
function check(name, cond, detail) {
  if (cond) {
    console.log(`PASS  ${name}`);
    passes++;
  } else {
    console.log(`FAIL  ${name}${detail === undefined ? '' : `\n      got: ${detail}`}`);
    failures++;
  }
}

// The hook matches against quote-masked text, exactly as main() does. Testing
// the raw string instead would pass while the shipped path fails.
const triggers = (cmd) => g.GH_MERGE_RE.test(g.maskQuoted(cmd)) || g.SAFE_MERGE_RE.test(g.maskQuoted(cmd));

// --- 0. Control -------------------------------------------------------------

check('CONTROL: a plain merge command triggers the gate', triggers('gh pr merge 42 --squash'));
check('CONTROL: an unrelated command does not', !triggers('git status'));

// --- 1. Trigger matching: what is a merge attempt ---------------------------

check('trigger: after a semicolon', triggers('git fetch; gh pr merge 42 --squash'));
check('trigger: after &&', triggers('git fetch && gh pr merge 42 --squash'));
check('trigger: after a newline', triggers('git fetch\ngh pr merge 42'));
check('trigger: after a pipe', triggers('echo 42 | gh pr merge --squash'));
check('trigger: extra whitespace between words', triggers('gh   pr   merge 42'));
check('trigger: case insensitive', triggers('GH PR MERGE 42'));
check('trigger: the safe_merge.sh wrapper', triggers('bash scripts/safe_merge.sh 42'));
check('trigger: the wrapper via ./', triggers('./safe_merge.sh 42'));

// The masking exists so that text a command merely CARRIES is not read as
// text it RUNS. A guard that blocks its own documentation gets switched off.
check('near-miss: a quoted mention is not a merge', !triggers('echo "gh pr merge 42"'));
check('near-miss: a single-quoted mention is not a merge', !triggers("echo 'gh pr merge 42'"));
check('near-miss: gh pr create is not a merge', !triggers('gh pr create --base master'));
check('near-miss: gh pr view is not a merge', !triggers('gh pr view 42 --json state'));
check('near-miss: a mid-word match does not trigger', !triggers('echo notgh pr merge'));
check('near-miss: a filename mentioning merge', !triggers('git add docs/gh-pr-merge-notes.md'));

// --- 2. The documented bypass, asserted as it currently behaves -------------
//
// These four are the #17 limit. They are NOT aspirational: each asserts what
// the hook does TODAY. Flip any of them and you have changed the hook's
// measured record, which is a decision, not a bug fix.

check(
  'KNOWN LIMIT (#17): an inline env prefix does NOT trigger the gate',
  !triggers('CLAUDE_MERGE_GATE_OVERRIDE=1 gh pr merge 42'),
  'if this now triggers, BOUNDARY was widened - see issue #17 and re-measure the record'
);
check(
  'KNOWN LIMIT (#17): any inline assignment hides the merge, not just the override var',
  !triggers('GH_TOKEN=abc123 gh pr merge 42'),
  'if this now triggers, BOUNDARY was widened - see issue #17'
);
check(
  'KNOWN LIMIT (#17): the same prefix after a separator is also hidden',
  !triggers('git fetch; GH_TOKEN=abc gh pr merge 42'),
  'if this now triggers, BOUNDARY was widened - see issue #17'
);
check(
  'the SUPPORTED override form does reach the gate',
  triggers('export CLAUDE_MERGE_GATE_OVERRIDE=1; gh pr merge 42'),
  'the documented override must still be visible to the hook, and therefore logged'
);

// --- 3. Override recognition ------------------------------------------------

check('override: bash export form', g.BASH_OVERRIDE_RE.test('export CLAUDE_MERGE_GATE_OVERRIDE=1; gh pr merge 42'));
check('override: bash bare assignment on its own', g.BASH_OVERRIDE_RE.test('CLAUDE_MERGE_GATE_OVERRIDE=1\ngh pr merge 42'));
check('override: PowerShell env form', g.PWSH_OVERRIDE_RE.test("$env:CLAUDE_MERGE_GATE_OVERRIDE = '1'; gh pr merge 42"));
check('override: PowerShell unquoted', g.PWSH_OVERRIDE_RE.test('$env:CLAUDE_MERGE_GATE_OVERRIDE = 1; gh pr merge 42'));
check('override: PowerShell is case-insensitive on env:', g.PWSH_OVERRIDE_RE.test("$ENV:CLAUDE_MERGE_GATE_OVERRIDE='1'"));
check('override: a value other than 1 is not an override', !g.PWSH_OVERRIDE_RE.test("$env:CLAUDE_MERGE_GATE_OVERRIDE = '10'"));
check('override: an unrelated variable is not an override', !g.BASH_OVERRIDE_RE.test('export SOMETHING_ELSE=1; gh pr merge 42'));

// --- 4. Gate-comment classification ----------------------------------------

check('gate comment: a heading naming the gate is recognised', g.isGateComment('## Review gate\nDisposition: ARM'));
check('gate comment: an ordinary comment is not', !g.isGateComment('Looks good to me, merging now.'));
check('gate comment: a non-string body is not', !g.isGateComment(null));

check('classify: an arm reads as ARMED', g.classify('## Gate: round 2\nDisposition: arming auto-merge') === 'ARMED');
check('classify: a routed fix round reads as BLOCKED', g.classify('## Gate: round 1\nDisposition: routed to the builder') === 'BLOCKED');
check('classify: BLOCK wins over an arm mentioned in the same body',
  g.classify('## Gate: round 1\nDisposition: BLOCK, do not arm yet') === 'BLOCKED');
check('classify: an unrelated body is UNKNOWN', g.classify('## Notes\nNothing to see here.') === 'UNKNOWN');

// --- 5. Staleness: has the diff moved since the arm ------------------------
//
// This is the arming lesson mechanised: an arm covers the commit it reviewed,
// and nothing after it.

const armTs = Date.parse('2026-08-01T12:00:00Z');
const commit = (oid, when, headline) => ({ oid, committedDate: when, messageHeadline: headline });

check('staleness: a commit after the arm is stale',
  !!g.findStaleness({
    heading: '## Gate: arming',
    commits: [commit('aaa111', '2026-08-01T13:00:00Z', 'fix: address review')],
    armTs,
  }));

check('staleness: a commit before the arm is not stale',
  !g.findStaleness({
    heading: '## Gate: arming',
    commits: [commit('aaa111', '2026-08-01T11:00:00Z', 'feat: the reviewed work')],
    armTs,
  }));

check('staleness: a merge-in from the default branch is not a new change',
  !g.findStaleness({
    heading: '## Gate: arming',
    commits: [commit('aaa111', '2026-08-01T13:00:00Z', 'Merge branch master into feature')],
    armTs,
  }));

check('staleness: with a cited SHA, only commits AFTER it count',
  !g.findStaleness({
    heading: '## Gate: arming `aaa111`',
    commits: [commit('aaa111aaa', '2026-08-01T13:00:00Z', 'the reviewed commit')],
    armTs,
  }));

check('staleness: with a cited SHA, a later commit is stale',
  !!g.findStaleness({
    heading: '## Gate: arming `aaa111`',
    commits: [
      commit('aaa111aaa', '2026-08-01T13:00:00Z', 'the reviewed commit'),
      commit('bbb222bbb', '2026-08-01T14:00:00Z', 'fix: pushed after arming'),
    ],
    armTs,
  }));

// --- 6. The cheap prefilter must not be cheaper than the rules -------------
//
// main() exits early when the prefilter misses, so anything the real triggers
// catch must survive it, or the rule below it never runs.

for (const cmd of [
  'gh pr merge 42 --squash',
  'git fetch && gh pr merge 42',
  'bash scripts/safe_merge.sh 42',
  'GH  PR  MERGE 42',
]) {
  check(`prefilter: does not drop ${JSON.stringify(cmd).slice(0, 40)}`, g.CHEAP_PREFILTER_RE.test(cmd));
}

// --- 7. Guard paths: the machinery may not approve its own edit -------------
//
// isGuardPath/hasGuardPathReview are the classifiers behind the guard-path
// review requirement (hook header, GUARD-PATH REVIEW). Same scope caveat as
// everything in this file: main()'s wiring of these is not covered here.

check('guard path: a hook source', g.isGuardPath('claude/hooks/pr-merge-gate.js'));
check('guard path: a workflow', g.isGuardPath('.github/workflows/ci.yml'));
check('guard path: the gate template', g.isGuardPath('templates/adversarial-review-gate.md'));
check('guard path: a probe under .claude/', g.isGuardPath('.claude/probes/run-all.js'));
check('guard path: a test file anywhere', g.isGuardPath('scripts/foo.test.sh'));
check('guard path: a selftest file anywhere', g.isGuardPath('anything/deep/x.selftest.js'));
check('guard path: backslash separators still match', g.isGuardPath('claude\\hooks\\guardrail.js'));

// A guard-path list that matches everything blocks all work and gets
// switched off (principle 2), so the near-misses matter as much as the hits.
check('near-miss: the README is not a guard path', !g.isGuardPath('README.md'));
check('near-miss: a skill file is not a guard path', !g.isGuardPath('claude/skills/overnight-review/SKILL.md'));
check('near-miss: docs mentioning hooks are not', !g.isGuardPath('docs/claude/hooks-overview.md'));
check('near-miss: another template is not', !g.isGuardPath('templates/CLAUDE.md'));
check('near-miss: "latest.js" is not a test file', !g.isGuardPath('src/latest.js'));
check('near-miss: an empty path is not', !g.isGuardPath(''));

// The wiring gradient, closed by review round 1: an edit that disarms the
// gate must not meet less resistance than an edit to the gate itself.
check('guard path: the wiring file claude/settings.json', g.isGuardPath('claude/settings.json'));
check('guard path: the machine-global installer', g.isGuardPath('scripts/install-global-hooks.ps1'));
check('guard path: a .spec file', g.isGuardPath('web/app.spec.ts'));
check('guard path: a _test suffix', g.isGuardPath('lib/sync_test.dart'));
check('guard path: a python test_ file', g.isGuardPath('tests/test_gate.py'));
check('near-miss: settings.local.json is not', !g.isGuardPath('claude/settings.local.json'));
check('near-miss: "protest.sh" is not a test file', !g.isGuardPath('scripts/protest.sh'));
check('near-miss: "contest.js" is not', !g.isGuardPath('src/contest.js'));

// Renames: GitHub reports only the NEW path, so a move out of a guard
// directory is invisible by path alone; guardTouchedFiles counts every
// rename wholesale.
check('guard files: a rename counts even to a non-guard path',
  g.guardTouchedFiles([{ path: 'scripts/gate.js', changeType: 'RENAMED' }]).length === 1);
check('guard files: the rename label names the path',
  g.guardTouchedFiles([{ path: 'scripts/gate.js', changeType: 'RENAMED' }])[0] === 'scripts/gate.js (renamed)');
check('guard files: an ordinary non-guard change does not count',
  g.guardTouchedFiles([{ path: 'src/app.js', changeType: 'MODIFIED' }]).length === 0);
check('guard files: a guard path and a rename together yield both',
  g.guardTouchedFiles([
    { path: 'claude/hooks/x.js', changeType: 'MODIFIED' },
    { path: 'docs/y.md', changeType: 'RENAMED' },
  ]).length === 2);
check('guard files: null and sparse input are safe',
  g.guardTouchedFiles(null).length === 0 && g.guardTouchedFiles([null]).length === 0);

check(
  'review line: bold form is recognised',
  g.hasGuardPathReview('## Gate: arming `abc123`\n**Guard-path review:** a different-substrate reviewer, no weakenings found')
);
check(
  'review line: plain form is recognised',
  g.hasGuardPathReview('## Gate: arming\nGuard-path review: a different-substrate reviewer')
);
check(
  'review line: an arm without one is not',
  !g.hasGuardPathReview('## Gate: arming `abc123`\nDisposition: arm')
);
check(
  'review line: an empty value does not count',
  !g.hasGuardPathReview('## Gate: arming\n**Guard-path review:**')
);
check(
  'review line: a prose mention mid-line does not count',
  !g.hasGuardPathReview('## Gate: arming\nWe should add a guard-path review next time.')
);
check('review line: a non-string body is not', !g.hasGuardPathReview(null));

// Forms the template itself renders, accepted since review round 1: a
// guard that denies correct work gets switched off (principle 2).
check(
  'review line: the template bullet form is recognised',
  g.hasGuardPathReview('## Gate: arming\n- **Guard-path review:** a different-substrate reviewer, no weakenings')
);
check(
  'review line: a numbered form is recognised',
  g.hasGuardPathReview('## Gate: arming\n1. **Guard-path review:** reviewer named')
);
check(
  'review line: the colon outside the bold is recognised',
  g.hasGuardPathReview('## Gate: arming\n**Guard-path review**: reviewer named')
);
check(
  'review line: a blockquoted form is recognised',
  g.hasGuardPathReview('## Gate: arming\n> **Guard-path review:** reviewer named')
);

// Placeholder values state that no review happened; they do not count.
check(
  'review line: value "none" does not count',
  !g.hasGuardPathReview('## Gate: arming\n**Guard-path review:** none')
);
check(
  'review line: value "skipped" does not count',
  !g.hasGuardPathReview('## Gate: arming\n**Guard-path review:** skipped this time')
);
check(
  'review line: value "TBD" does not count',
  !g.hasGuardPathReview('## Gate: arming\n**Guard-path review:** TBD')
);
check(
  'review line: a real value starting with "non" still counts',
  g.hasGuardPathReview('## Gate: arming\n**Guard-path review:** non-Claude reviewer via API')
);

// Round 2: the placeholders the stoplist missed, and the legitimate
// phrasings it wrongly fought (the frozen protocol says "state that you
// found none"; a guard must not reject the phrasing its protocol invites).
check(
  'review line: the template\'s own unfilled placeholder does not count',
  !g.hasGuardPathReview('## Gate: arming\n**Guard-path review:** <substrate>, <one-line verdict>')
);
check(
  'review line: punctuation-only values do not count',
  !g.hasGuardPathReview('## Gate: arming\n**Guard-path review:** --') &&
    !g.hasGuardPathReview('## Gate: arming\n**Guard-path review:** ???')
);
check(
  'review line: "n.a." does not count',
  !g.hasGuardPathReview('## Gate: arming\n**Guard-path review:** n.a.')
);
check(
  'review line: "fill me in" does not count',
  !g.hasGuardPathReview('## Gate: arming\n**Guard-path review:** _fill me in_')
);
check(
  'review line: a substrate plus "none found" verdict counts',
  g.hasGuardPathReview('## Gate: arming\n**Guard-path review:** Sonnet 5; none found')
);
check(
  'review line: "None found." as the whole value counts (protocol-invited phrasing)',
  g.hasGuardPathReview('## Gate: arming\n**Guard-path review:** None found.')
);
check(
  'review line: prose starting with "none of" counts',
  g.hasGuardPathReview('## Gate: arming\n**Guard-path review:** none of the checks weakened; reviewed by a second substrate')
);
check(
  'review line: bare "x" does not count, "x-ray team" does',
  !g.hasGuardPathReview('## Gate: arming\n**Guard-path review:** x') &&
    g.hasGuardPathReview('## Gate: arming\n**Guard-path review:** x-ray team, clean')
);

// Round 3: skip-words are judged on the leading clause only. A verdict
// that MENTIONS deferral records a review; a leading clause that IS a
// deferral does not. The whole-value scan rejected the phrasing this
// kit's own residuals use.
check(
  'review line: a verdict mentioning a deferred residual counts',
  g.hasGuardPathReview('## Gate: arming\n**Guard-path review:** Sonnet 5; one residual deferred to the follow-up issue')
);
check(
  'review line: a verdict mentioning skipped hypotheses counts',
  g.hasGuardPathReview('## Gate: arming\n**Guard-path review:** Opus; none found, no hypothesis skipped')
);
check(
  'review line: a leading clause that IS a deferral does not count',
  !g.hasGuardPathReview('## Gate: arming\n**Guard-path review:** deferred to the follow-up issue')
);
check(
  'review line: "skipped, no second substrate available" does not count',
  !g.hasGuardPathReview('## Gate: arming\n**Guard-path review:** skipped, no second substrate available')
);
check(
  'review line: a bare marker in the leading clause does not count',
  !g.hasGuardPathReview('## Gate: arming\n**Guard-path review:** TBD, will do after merge')
);

// Round 3: the placeholder test rejects '<'-openings only; parentheses,
// brackets, and markdown links are legitimate substrate spellings, and
// letters in any script count as letters.
check(
  'review line: a markdown-link substrate counts',
  g.hasGuardPathReview('## Gate: arming\n**Guard-path review:** [Sonnet 5](https://example.com); none found')
);
check(
  'review line: a parenthesised substrate counts',
  g.hasGuardPathReview('## Gate: arming\n**Guard-path review:** (Sonnet 5) none found')
);
check(
  'review line: a non-Latin verdict counts',
  g.hasGuardPathReview('## Gate: arming\n**Guard-path review:** 混元; 未发现问题')
);

// Round 3: a degenerate file entry makes the list unreadable, never a
// definite answer in either direction.
check('resolve: an empty-path entry is unreadable',
  g.resolveGuardTouched([{ path: '', changeType: 'RENAMED' }], 1) === null);
check('resolve: a null entry is unreadable',
  g.resolveGuardTouched([null], 1) === null);

// Round 2: truncation demotes only a negative result.
check('resolve: a visible guard file keeps its deny even when truncated',
  Array.isArray(g.resolveGuardTouched([{ path: 'claude/hooks/x.js' }], 328)) &&
    g.resolveGuardTouched([{ path: 'claude/hooks/x.js' }], 328).length === 1);
check('resolve: an all-clear truncated list is unreadable, not clean',
  g.resolveGuardTouched([{ path: 'docs/a.md' }], 328) === null);
check('resolve: an all-clear complete list is a definite no',
  Array.isArray(g.resolveGuardTouched([{ path: 'docs/a.md' }], 1)) &&
    g.resolveGuardTouched([{ path: 'docs/a.md' }], 1).length === 0);
check('resolve: a missing list is unreadable', g.resolveGuardTouched(undefined, 5) === null);
check('resolve: a missing changedFiles count does not demote',
  Array.isArray(g.resolveGuardTouched([{ path: 'docs/a.md' }], undefined)));

check('guard path: the bootstrap script (round 2, same gradient as the installer)',
  g.isGuardPath('scripts/bootstrap.ps1'));
check('guard files: a rename with an empty path yields no label',
  g.guardTouchedFiles([{ path: '', changeType: 'RENAMED' }]).length === 0);

console.log(`\npassed ${passes}, failed ${failures}`);
if (failures) process.exit(1);
console.log('ALL PASS');

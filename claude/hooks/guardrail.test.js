#!/usr/bin/env node
// Replay harness for guardrail.js, per claude/README.md ("Corpus replay for
// guards that classify text"). Run it before you deploy any rule change:
//
//   node claude/hooks/guardrail.test.js
//
// It asserts two separate things, and the second is the one that rots quietly:
//   1. the rules still classify commands the way you expect, and
//   2. every outcome path still writes exactly one telemetry line.
//
// Guard telemetry is what makes the decommission test possible at all, so a
// silent regression in the logging is as bad as a silent regression in a rule.
//
// The harness copies the hook into an OS temp directory and runs it there. It
// never touches a real state/guardrail.log: the log is the evidence the guard
// works, and a test that deletes its own evidence is worse than no test.
//
// EXTEND THIS as you tune the rules. Every rule you add or change earns a case
// below — one command it must block, and one near-miss it must let through.
// The near-miss matters more: a rule that over-blocks gets switched off, and a
// guard that is switched off protects nothing (kit README, principle 2).

const { execFileSync, spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

// --prove: reintroduce each defect this suite is meant to catch and require
// the suite to go RED for it. A suite that cannot fail is not evidence.
//
// The list came from agents that wrote neither this file nor guardrail.js and
// were blocked from reading any suite, which is what practice 4 asks for (#34).
// Every entry below was verified BOTH ways before being kept: the matching
// assertion passes against the current hook and fails against this mutant.
//
// The applied-control is the important part. A find string that no longer
// matches reports UNPROVEN, never "not caught" — an injection that fails to
// apply is indistinguishable from a test that misses it, and it reports as
// the reassuring one.
if (process.argv.includes('--prove')) {
  const original = fs.readFileSync(path.join(__dirname, 'guardrail.js'), 'utf8');

  const defects = [
  [
    "backup-remote-unanchored",
    "const BACKUP_REMOTE = /claude-state(\\.git)?\\/?$/;",
    "const BACKUP_REMOTE = /claude-state/;",
  ],
  [
    "bare-push-drops-main",
    "return bare && /^(master|main)$/.test(currentBranch());",
    "return bare && /^(master)$/.test(currentBranch());",
  ],
  [
    "stash-rule-narrowed-to-adjacent",
    "/\\bgit\\b[^&|;]*\\bstash\\b/.test(c) && !/\\bstash\\s+(list|show)\\b/.test(c)",
    "/\\bgit\\s+stash\\b/.test(c) && !/\\bstash\\s+(list|show)\\b/.test(c)",
  ],
  [
    "override-any-truthy-value",
    "if (process.env.CLAUDE_GUARDRAIL_OFF === '1') {",
    "if (process.env.CLAUDE_GUARDRAIL_OFF) {",
  ],
  [
    "taskkill-narrowed-to-adjacent-im",
    "/\\btaskkill\\b[^&|;]*\\/IM\\b/i.test(c)",
    "/\\btaskkill\\s+\\/IM\\b/i.test(c)",
  ],
  [
    "batch-rule-requires-cmd-exe",
    "/\\bcmd(\\.exe)?\\s+\\/c/i.test(c)",
    "/\\bcmd\\.exe\\s+\\/c/i.test(c)",
  ],
  [
    "bare-push-or-instead-of-and",
    "return bare && /^(master|main)$/.test(currentBranch());",
    "return bare || /^(master|main)$/.test(currentBranch());",
  ],
  [
    "taskkill-span-narrowed-to-adjacent",
    "      /\\btaskkill\\b[^&|;]*\\/IM\\b/i.test(c) ||",
    "      /\\btaskkill\\s+\\/IM\\b/i.test(c) ||",
  ],
  [
    "heredoc-newline-search-from-string-start",
    "const nl = s.indexOf('\\n', m.index);",
    "const nl = s.indexOf('\\n');",
  ],
  [
    "single-quotes-not-treated-as-quotes",
    "} else if (c === '\"' || c === \"'\") {",
    "} else if (c === '\"') {",
  ],
  ];

  let proven = 0;
  let unproven = 0;
  for (const [name, find, replace] of defects) {
    const occurrences = original.split(find).length - 1;
    if (occurrences !== 1) {
      unproven++;
      console.log(`  UNPROVEN — find occurs ${occurrences}x, cannot inject: ${name}`);
      continue;
    }
    const broken = original.replace(find, replace);
    const tmp = path.join(os.tmpdir(), `guardrail-defect-${proven}-${unproven}.js`);
    fs.writeFileSync(tmp, broken);

    const r = spawnSync(process.execPath, [__filename], {
      env: { ...process.env, GUARDRAIL_MODULE: tmp },
      encoding: 'utf8',
    });
    fs.unlinkSync(tmp);

    if (r.status === 0) {
      console.log(`  NOT CAUGHT — suite stayed green with this defect: ${name}`);
    } else {
      proven++;
      console.log(`  caught — ${name}`);
    }
  }

  console.log('');
  console.log(`${proven}/${defects.length} injected defects caught` + (unproven ? `, ${unproven} UNPROVEN` : ''));
  process.exit(proven === defects.length ? 0 : 1);
}

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'guardrail-test-'));
const HOOK = path.join(SANDBOX, 'hooks', 'guardrail.js');
const LOG = path.join(SANDBOX, 'state', 'guardrail.log');

fs.mkdirSync(path.join(SANDBOX, 'hooks'), { recursive: true });
// Overridable so --prove below can point the whole suite at a mutated copy.
const SRC_HOOK = process.env.GUARDRAIL_MODULE || path.join(__dirname, 'guardrail.js');
fs.copyFileSync(SRC_HOOK, HOOK);

let failures = 0;
function check(name, cond, detail) {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : `\n      got: ${detail}`}`);
  if (!cond) failures++;
}

// The sandbox is not a git repo, so rules that shell out to git see a detached
// or absent repo and simply do not match. Cases below therefore name the
// destination branch explicitly rather than relying on the current branch.
function run(stdin, env = {}, hook = HOOK) {
  try {
    fs.unlinkSync(LOG);
  } catch {}
  let stdout = '';
  try {
    stdout = execFileSync('node', [hook], {
      input: stdin,
      encoding: 'utf8',
      cwd: SANDBOX,
      env: { ...process.env, ...env },
    });
  } catch (e) {
    stdout = e.stdout || '';
  }
  let logged = [];
  try {
    logged = fs.readFileSync(LOG, 'utf8').trim().split('\n').filter(Boolean);
  } catch {}
  const fields = logged.length === 1 ? logged[0].split('|') : [];
  return { stdout, logged, outcome: fields[2], target: fields[3], reason: fields[4], fields };
}

const payload = (command) => JSON.stringify({ cwd: SANDBOX, tool_input: { command } });
const denied = (r) => {
  try {
    return JSON.parse(r.stdout || '{}')?.hookSpecificOutput?.permissionDecision === 'deny';
  } catch {
    return false;
  }
};

// --- 1. Rule classification: what must block, and what must not -------------

const BLOCKS = [
  ['git push origin master', 'push-to-default-branch'],
  // Chaining must not become a bypass. Scoping the refspec check to the push's
  // own span (#6) is only correct if a real push to the default branch still
  // blocks when something follows it.
  ['git push origin master && gh pr create --base master', 'push-to-default-branch'],
  ['echo setting up; git push origin master', 'push-to-default-branch'],
  // `--dry-run` belongs to the push, not to whatever runs after it.
  ['git push origin master && echo --dry-run', 'push-to-default-branch'],
];

for (const [cmd, rule] of BLOCKS) {
  const r = run(payload(cmd));
  check(`blocks: ${cmd}`, denied(r) && r.target === rule, `outcome=${r.outcome} target=${r.target}`);
}

// Pins batch-rule-requires-cmd-exe. `cmd /c` is the ordinary spelling and
// produces exactly the same silent no-op false green under Git Bash as
// `cmd.exe /c`, so the `(\.exe)?` in the rule is load-bearing. The bare
// spelling is the discriminating case: require `.exe` and it alone goes
// unguarded while every other shape still blocks.
for (const cmd of ['cmd /c run-tests.bat', 'cmd.exe /c run-tests.bat', 'cmd /C build.cmd']) {
  const r = run(payload(cmd));
  check(
    `blocks batch false green: ${cmd}`,
    denied(r) && r.target === 'batch-file-false-green',
    `outcome=${r.outcome} target=${r.target}`,
  );
}

// Controls, so the three above cannot pass by blocking everything: the
// documented escape hatch and a bare mention of a .bat must both stay clean.
for (const cmd of ['MSYS_NO_PATHCONV=1 cmd.exe /c run-tests.bat', 'echo run-tests.bat finished']) {
  const r = run(payload(cmd));
  check(
    `allows batch near-miss: ${cmd}`,
    !denied(r) && r.outcome === 'clean',
    `outcome=${r.outcome} target=${r.target}`,
  );
}

// Near-misses. Each of these looks like a blocked shape and must still pass.
const ALLOWS = [
  'git push --dry-run origin master',
  'git push -u origin feat/some-branch',
  'git log --oneline -5',
  'git stash list',
  // Every row from #6. The third is the one that fired three times in one day:
  // it is the exact workflow this rule's own denial message tells you to run,
  // and `--base master` was being read as the push's refspec.
  'git push -u origin my-feature',
  'gh pr create --base master --head my-feature --title x',
  'git push -u origin my-feature && gh pr create --base master --head my-feature --title x',
  'git push -u origin my-feature && echo "see master branch"',
  'git checkout -b feat/x && git push -u origin feat/x && gh pr create --base master',
  // Delimiter shapes the tag alphabet used to reject. Each is ordinary shell,
  // and each writes a PR body or a doc that DESCRIBES the push ban. Before the
  // alphabet was widened, `PR-BODY` parsed as the tag `PR`, no terminator was
  // found, and the body reached the rules as command text. Under the old
  // end-of-string masking the same gap disarmed the guard instead, so these
  // cases guard both faces of it.
  "gh pr create --body-file - <<'PR-BODY'\nDo not run git push origin master.\nPR-BODY",
  'gh pr create --body-file - <<PR-BODY\nDo not run git push origin master.\nPR-BODY',
  'cat <<\\EOF > docs/rules.md\nNever do: git push origin master\nEOF',
  'cat <<EOF.MD > d.md\nnever git push origin master\nEOF.MD',
  // The tag becomes a regex, so it has to be escaped. Unescaped, the `.` in
  // `EOF.MD` also matches `EOFXMD`, the mask ends on that line instead of the
  // real terminator, and the push below it is exposed as command text.
  'cat <<EOF.MD > d.md\nEOFXMD\ngit push origin master\nEOF.MD',
];

// Quoted near-misses, one per rule. Each command CONTAINS a banned shape but
// only inside a quoted argument, so it does nothing dangerous and must pass.
// Writing a PR body that quoted a banned command is what surfaced this class:
// the guard blocked the `gh pr create` describing it.
const QUOTED_NEAR_MISSES = [
  ['batch-file-false-green', 'echo "run it with cmd.exe /c build.bat"'],
  ['git-stash-ban', 'git commit -m "drop git stash from the parallel flow"'],
  ['blanket-process-kill', 'echo "never run killall node here"'],
  ['release-asset-clobber', 'echo "gh release upload x --clobber is banned"'],
  ['push-to-default-branch', 'echo "git push origin master"'],
];

for (const cmd of ALLOWS) {
  const r = run(payload(cmd));
  check(`allows: ${cmd}`, !denied(r) && r.outcome === 'clean', `outcome=${r.outcome} stdout=${r.stdout}`);
}

for (const [rule, cmd] of QUOTED_NEAR_MISSES) {
  const r = run(payload(cmd));
  check(`quoted near-miss (${rule}): ${cmd}`, !denied(r) && r.outcome === 'clean', `blocked by ${r.target}`);
}

// Heredoc near-misses: the other half of #6. A heredoc BODY is text the
// command carries, not text it runs — the same argument as the quoted cases
// above. One real occurrence was a PR body written with `<<'EOF'`, which
// tripped push-to-default-branch on its own prose.
const HEREDOC_NEAR_MISSES = [
  ['push-to-default-branch', "gh pr create --title x --body-file - <<'EOF'\ngit push origin master\nEOF"],
  ['git-stash-ban', "gh pr comment 1 --body-file - <<'EOF'\nnever run git stash here\nEOF"],
  // Unquoted delimiter, and an unbalanced apostrophe in the body: the quote
  // that used to desynchronise maskQuoted for everything after it.
  ['push-to-default-branch', "gh pr create --body-file - <<EOF\ndon't git push origin master\nEOF"],
];

for (const [rule, cmd] of HEREDOC_NEAR_MISSES) {
  const r = run(payload(cmd));
  check(`heredoc near-miss (${rule})`, !denied(r) && r.outcome === 'clean', `blocked by ${r.target}`);
}

// #48: an UNTERMINATED `<<WORD` used to mask to end-of-string, which
// switched off every rule rather than just one. These are the disarm shapes,
// each paired below with a bare control, because "blocked" only means
// something if the same command blocks without the prefix too.
const DISARM_PREFIXES = [
  ['arithmetic left shift', 'MASK=$((1<<BITS))'],
  ['bare unterminated <<WORD', 'cat <<NOPE'],
  // The `<<` here is inside a quoted string. maskHeredocs runs on the RAW
  // command, so quote masking has not removed it yet.
  ['<< inside a quoted string', 'echo "x <<Y"'],
];
const DISARM_TARGETS = [
  ['push-to-default-branch', 'git push origin master'],
  ['git-stash-ban', 'git stash'],
];

for (const [rule, cmd] of DISARM_TARGETS) {
  // Control first. If the bare command does not block, every prefixed case
  // below proves nothing at all.
  const bare = run(payload(cmd));
  check(`disarm control: ${rule} blocks bare`, denied(bare) && bare.target === rule, `outcome=${bare.outcome} target=${bare.target}`);

  for (const [pname, prefix] of DISARM_PREFIXES) {
    const r = run(payload(`${prefix}\n${cmd}`));
    check(
      `#48 no disarm (${rule}) via ${pname}`,
      denied(r) && r.target === rule,
      `outcome=${r.outcome} target=${r.target}`,
    );
  }
}

// The other direction, so the fix cannot be "mask nothing, ever": a properly
// terminated heredoc body must still be ignored. Without these, deleting
// maskHeredocs outright would pass.
{
  const cmd = "git commit --file - <<-EOF\ndescribes git push origin master\n\tEOF";
  const r = run(payload(cmd));
  check('terminated <<-EOF with an indented terminator is still masked', !denied(r) && r.outcome === 'clean', `blocked by ${r.target}`);
}

// Pins `heredoc-newline-search-from-string-start`: the body region has to
// start at the end of the OPENER's line, not at the first newline in the whole
// command. Every heredoc case above opens on line 1, where both readings agree.
// This one opens on line 3 with a real push on line 2, so a search from index 0
// masks from line 2 onward and the push disappears.
{
  const cmd =
    "echo preparing\ngit push origin master\ngh pr create --body-file - <<'EOF'\nsome pr body\nEOF";
  const r = run(payload(cmd));
  check(
    'a push before a heredoc that opens on a later line is still seen',
    denied(r) && r.target === 'push-to-default-branch',
    `outcome=${r.outcome} target=${r.target}`,
  );
}
// Control: same shape, push moved INSIDE the body. Without it the case above
// could not tell a correct fromIndex from a mask that never fires at all.
{
  const cmd = "echo preparing\ngh pr create --body-file - <<'EOF'\ngit push origin master\nEOF";
  const r = run(payload(cmd));
  check(
    'a heredoc body is still masked when the opener is not on line 1',
    !denied(r) && r.outcome === 'clean',
    `blocked by ${r.target}`,
  );
}

// Heredoc masking must not open a hole either: a real push AFTER the
// terminator is outside the body and still blocks.
{
  const cmd = "gh pr create --body-file - <<'EOF'\nsome pr body\nEOF\ngit push origin master";
  const r = run(payload(cmd));
  check(
    'still blocks a real push after a heredoc',
    denied(r) && r.target === 'push-to-default-branch',
    `outcome=${r.outcome} target=${r.target}`,
  );
}

// Pins `stash-rule-narrowed-to-adjacent`. The pattern deliberately tolerates
// intervening global options so `git -C <path> stash` is caught; the rule's own
// comment calls matching only `git\s+stash` a trivial bypass. Every existing
// stash case has `git` sitting directly beside `stash`, so an adjacent-only
// pattern passes all of them — these two shapes are what discriminate.
for (const cmd of ['git -C /some/repo stash push -m wip', 'git --no-pager stash']) {
  const r = run(payload(cmd));
  check(
    `blocks stash behind a global option: ${cmd}`,
    denied(r) && r.target === 'git-stash-ban',
    `outcome=${r.outcome} target=${r.target}`,
  );
}

// Controls. Without these the pair above would also pass against a rule that
// blocked every `git -C` / `git --no-pager` command outright.
for (const cmd of ['git -C /some/repo stash list', 'git --no-pager log --oneline -5']) {
  const r = run(payload(cmd));
  check(
    `allows: ${cmd}`,
    !denied(r) && r.outcome === 'clean',
    `outcome=${r.outcome} target=${r.target}`,
  );
}


// Pins `bare-push-or-instead-of-and`: the bare-push branch must require BOTH
// no refspec AND HEAD on the default branch. Swapping that `&&` for `||` denies
// every push made while HEAD sits on master/main — including the branch-and-PR
// flow this rule's own denial message tells you to run. The existing
// `git push -u origin feat/some-branch` allow-case cannot see it: that one runs
// in the sandbox, which is not a git repo, so currentBranch() is '' and the
// second operand is false either way. HEAD has to really be on master.
{
  const gitm = (args, dir) => execFileSync('git', args, { cwd: dir, stdio: 'ignore' });
  const master = path.join(SANDBOX, 'head-on-master');
  const fromMaster = (command) => JSON.stringify({ cwd: master, tool_input: { command } });
  try {
    fs.mkdirSync(master, { recursive: true });
    gitm(['init', '-q'], master);
    gitm(['checkout', '-q', '-b', 'master'], master);
    gitm(
      ['-c', 'user.email=t@example.invalid', '-c', 'user.name=t', '-c', 'commit.gpgsign=false',
       'commit', '-q', '--allow-empty', '-m', 'x'],
      master
    );

    const a = run(fromMaster('git push -u origin feature/x'));
    check('pushing a feature branch while HEAD is on master is allowed', !denied(a) && a.outcome === 'clean', `blocked by ${a.target}`);

    // Control: from the SAME checkout, a bare push must still block. Without
    // it, a rule that blocked nothing at all would pass the line above.
    const b = run(fromMaster('git push'));
    check('control: bare push from that same master checkout still blocks', denied(b) && b.target === 'push-to-default-branch', `outcome=${b.outcome} target=${b.target}`);
  } catch (e) {
    check('head-on-master fixture: git available to build it', false, e.message);
  }
}

// Masking must not open a hole: the same shapes unquoted still block.
for (const [rule, cmd] of [
  ['git-stash-ban', 'git stash push -m wip'],
  ['blanket-process-kill', 'killall node'],
  ['release-asset-clobber', 'gh release upload v1 a.zip --clobber'],
]) {
  const r = run(payload(cmd));
  check(`still blocks unquoted (${rule}): ${cmd}`, denied(r) && r.target === rule, `outcome=${r.outcome} target=${r.target}`);
}


// Defect: blanket-process-kill narrowed to /IM adjacent to the command name.
// Every real invocation puts flags first, so `taskkill /F /IM node.exe` is the
// form that discriminates: it is the shape a human actually types, and the
// adjacent-only pattern misses it entirely while still matching a contrived
// `taskkill /IM x`. The /PID case is the exact remedy the rule's own reason
// line recommends; without it this pair could not tell a working rule from one
// that blocks every taskkill.
{
  const r = run(payload('taskkill /F /IM node.exe'));
  check(
    'blocks a process kill with flags before the image flag',
    denied(r) && r.target === 'blanket-process-kill',
    `outcome=${r.outcome} target=${r.target}`,
  );

  const c = run(payload('taskkill /F /PID 1234'));
  check(
    'allows the single-PID form the rule tells you to use instead',
    !denied(c) && c.outcome === 'clean',
    `outcome=${c.outcome} target=${c.target}`,
  );
}

// The backup-repo carve-out reads a path back out of `-C "<path>"`, so it is
// the one place that must see the RAW command. Masking it would blank the
// value it needs, silently re-arming the ban against the backup repo — the
// failure the carve-out exists to prevent (backups that never leave the
// machine). A path with a space forces the quotes that make this fail.
{
  const backup = path.join(SANDBOX, 'my backup', 'claude-state');
  fs.mkdirSync(backup, { recursive: true });
  const git = (args, cwd) => execFileSync('git', args, { cwd, stdio: 'ignore' });
  try {
    git(['init', '-q'], backup);
    git(['remote', 'add', 'origin', 'https://example.invalid/me/claude-state.git'], backup);

    const r1 = run(payload(`git -C "${backup}" push origin master`));
    check('backup carve-out: quoted -C path still exempt', !denied(r1) && r1.outcome === 'clean', `blocked by ${r1.target}`);

    // Pins backup-remote-unanchored. The carve-out is for the ONE repo whose
    // name is claude-state; a remote that merely contains that string is a
    // different repo and must still hit the ban. This lookalike is the
    // discriminating case: it differs from the exempt remote above only by a
    // trailing `-notes`, so it passes an unanchored pattern and fails an
    // anchored one.
    const lookalike = path.join(SANDBOX, 'claude-state-notes');
    fs.mkdirSync(lookalike, { recursive: true });
    git(['init', '-q'], lookalike);
    git(['remote', 'add', 'origin', 'https://example.invalid/me/claude-state-notes.git'], lookalike);
    const r3 = run(payload(`git -C "${lookalike}" push origin master`));
    check(
      'backup carve-out: a claude-state lookalike remote is NOT exempt',
      denied(r3) && r3.target === 'push-to-default-branch',
      `outcome=${r3.outcome} target=${r3.target}`,
    );

    // Control, so the case above cannot pass by blocking every backup push:
    // the same URL without the `.git` suffix still ends in claude-state and
    // stays exempt.
    const bare = path.join(SANDBOX, 'bare-remote-clone');
    fs.mkdirSync(bare, { recursive: true });
    git(['init', '-q'], bare);
    git(['remote', 'add', 'origin', 'https://example.invalid/me/claude-state'], bare);
    const r4 = run(payload(`git -C "${bare}" push origin master`));
    check(
      'backup carve-out control: a remote ending in claude-state is still exempt',
      !denied(r4) && r4.outcome === 'clean',
      `blocked by ${r4.target}`,
    );

    // Same shape, a repo that is not the backup target: the ban must hold.
    const other = path.join(SANDBOX, 'some code');
    fs.mkdirSync(other, { recursive: true });
    git(['init', '-q'], other);
    git(['remote', 'add', 'origin', 'https://example.invalid/me/product.git'], other);
    const r2 = run(payload(`git -C "${other}" push origin master`));
    check('backup carve-out: does not leak to other repos', denied(r2) && r2.target === 'push-to-default-branch', `outcome=${r2.outcome}`);
  } catch (e) {
    check('backup carve-out: git available to test it', false, e.message);
  }
}


// Single-quoted near-misses. maskQuoted treats ' and " alike, and it has to:
// a message ABOUT a banned command is normally written in single quotes,
// precisely to keep the shell out of it. Narrow the mask to double quotes and
// every case below is read as live command text and denied, so these are the
// cases that discriminate — the double-quoted set above cannot.
const SINGLE_QUOTED_NEAR_MISSES = [
  ['push-to-default-branch', "echo 'git push origin master'"],
  ['git-stash-ban', "git commit -m 'ban git stash in the parallel flow'"],
  ['blanket-process-kill', "echo 'never run killall node here'"],
];

for (const [rule, cmd] of SINGLE_QUOTED_NEAR_MISSES) {
  const r = run(payload(cmd));
  check(`single-quoted near-miss (${rule}): ${cmd}`, !denied(r) && r.outcome === 'clean', `blocked by ${r.target}`);
}

// Control for the block above: strip the quotes and the same text must still
// block. Without it, a guard that had stopped matching anything would pass.
for (const [rule, cmd] of [
  ['push-to-default-branch', 'git push origin master'],
  ['git-stash-ban', 'git stash pop'],
  ['blanket-process-kill', 'killall node'],
]) {
  const r = run(payload(cmd));
  check(
    `single-quote control: still blocks unquoted (${rule})`,
    denied(r) && r.target === rule,
    `outcome=${r.outcome} target=${r.target}`,
  );
}


// Pins `taskkill-span-narrowed-to-adjacent`. `/IM` counts anywhere in the
// taskkill command's own span, not only straight after the verb — real
// invocations put flags first. Nothing above exercises taskkill at all, so an
// adjacent-only pattern goes unnoticed. The rule's own reason line offers
// `taskkill /F /PID <pid>` as the allowed form, which fixes both sides here.
{
  const kill = run(payload('taskkill /F /IM node.exe'));
  check(
    'blocks: taskkill /F /IM node.exe',
    denied(kill) && kill.target === 'blanket-process-kill',
    `outcome=${kill.outcome} target=${kill.target}`,
  );

  // Controls: the targeted form must stay clean, and so must a quoted mention.
  // Without them the case above would pass against a rule that blocked the
  // bare word `taskkill`.
  const pid = run(payload('taskkill /F /PID 1234'));
  check(
    'allows: taskkill /F /PID 1234',
    !denied(pid) && pid.outcome === 'clean',
    `outcome=${pid.outcome} target=${pid.target}`,
  );

  const quoted = run(payload('echo "taskkill /F /IM node.exe"'));
  check(
    'quoted near-miss (blanket-process-kill): taskkill /F /IM node.exe',
    !denied(quoted) && quoted.outcome === 'clean',
    `blocked by ${quoted.target}`,
  );
}


// Pins `bare-push-drops-main`: the bare-push branch of push-to-default-branch
// must recognise `main`, not only `master`. Every other push case in this file
// names the refspec, so narrowing that branch test to /^master$/ survives all
// of them — only a push carrying NO refspec, from a repo whose HEAD is really
// on `main`, tells the two apart. The sandbox is not a git repo, so these
// fixtures are real repos and their path is passed as the payload cwd, which
// is the directory currentBranch() shells out in.
{
  const gitq = (args, dir) => execFileSync('git', args, { cwd: dir, stdio: 'ignore' });
  const repoOn = (name, branch) => {
    const dir = path.join(SANDBOX, name);
    fs.mkdirSync(dir, { recursive: true });
    gitq(['init', '-q'], dir);
    gitq(['checkout', '-q', '-b', branch], dir);
    gitq(
      ['-c', 'user.email=t@example.invalid', '-c', 'user.name=t', '-c', 'commit.gpgsign=false',
       'commit', '-q', '--allow-empty', '-m', 'x'],
      dir
    );
    return dir;
  };
  const from = (dir, command) => JSON.stringify({ cwd: dir, tool_input: { command } });
  try {
    const onMain = repoOn('head-on-main', 'main');
    const onFeature = repoOn('head-on-feature', 'feat/x');

    const r = run(from(onMain, 'git push'));
    check('bare push with HEAD on main is blocked', denied(r) && r.target === 'push-to-default-branch', `outcome=${r.outcome} target=${r.target}`);

    const rf = run(from(onMain, 'git push --force-with-lease'));
    check('bare push (flags only) with HEAD on main is blocked', denied(rf) && rf.target === 'push-to-default-branch', `outcome=${rf.outcome} target=${rf.target}`);

    // Control: the same bare push from a feature branch must stay clean, or
    // the two assertions above cannot tell this rule from one that blocks
    // every bare push.
    const c = run(from(onFeature, 'git push'));
    check('control: bare push with HEAD on a feature branch stays clean', !denied(c) && c.outcome === 'clean', `blocked by ${c.target}`);
  } catch (e) {
    check('bare-push branch fixtures: git available to build them', false, e.message);
  }
}

// --- 2. Telemetry: one line per invocation, on every outcome path -----------

let r = run(payload('echo hello'));
check('clean: one line, outcome clean', r.logged.length === 1 && r.outcome === 'clean', JSON.stringify(r.logged));

r = run(payload('git push origin master'));
check('blocked: one line, names the rule', r.logged.length === 1 && r.outcome === 'blocked', JSON.stringify(r.logged));
check('blocked: deny still emitted', denied(r), r.stdout);

r = run(payload('git push origin master'), { CLAUDE_GUARDRAIL_OFF: '1' });
check('override: recorded, not enforced', r.outcome === 'override' && !denied(r), JSON.stringify(r.logged));
check('override: log names what it let through', /git push origin master/.test(r.reason || ''), r.reason);

// Pins `override-any-truthy-value`. The escape hatch is documented as
// CLAUDE_GUARDRAIL_OFF=1 (claude/README.md); a truthy test would read a var
// left set to 0/false/no as "off" and silently disarm every rule. `0` is the
// case that discriminates: truthy as a JS string, plainly "on" as intent.
for (const off of ['0', 'false', 'no']) {
  const r = run(payload('git push origin master'), { CLAUDE_GUARDRAIL_OFF: off });
  check(
    `override: CLAUDE_GUARDRAIL_OFF=${off} does not disable the guard`,
    denied(r) && r.outcome === 'blocked' && r.target === 'push-to-default-branch',
    `outcome=${r.outcome} target=${r.target}`,
  );
}
// Control, so the rows above cannot pass on a hook that ignores the variable
// altogether: the documented value still overrides and still logs.
{
  const r = run(payload('git push origin master'), { CLAUDE_GUARDRAIL_OFF: '1' });
  check(
    'override control: the documented =1 still overrides',
    !denied(r) && r.outcome === 'override',
    `outcome=${r.outcome}`,
  );
}

r = run('{not json');
check('parse failure: recorded as open', r.outcome === 'open:parse-failure', JSON.stringify(r.logged));

r = run(JSON.stringify({ cwd: SANDBOX, tool_input: {} }));
check('no command: recorded as open', r.outcome === 'open:no-command', JSON.stringify(r.logged));

// A rule whose test throws must fail open, stay out of the way, and never be
// reported as `clean` — that would be the false confidence this log removes.
{
  const brokenHook = path.join(SANDBOX, 'hooks', 'guardrail-broken.js');
  fs.writeFileSync(
    brokenHook,
    fs
      .readFileSync(HOOK, 'utf8')
      .replace(
        'const broken = [];',
        "const broken = [];\nrules.unshift({ name: 'exploding-rule', test: () => { throw new Error('boom'); }, reason: 'x' });"
      )
  );
  const b = run(payload('echo hello'), {}, brokenHook);
  check('rule error: one line, outcome open:rule-error', b.logged.length === 1 && b.outcome === 'open:rule-error', JSON.stringify(b.logged));
  check('rule error: names the broken rule', /exploding-rule/.test(b.reason || ''), b.reason);
  check('rule error: work still allowed through', !denied(b), b.stdout);
}

// --- 3. Log grammar holds against hostile input ----------------------------

r = run(payload('echo "a|b" | grep x\nsecond line'));
check('grammar: pipes and newlines cannot break the fields', r.fields.length === 5 && r.logged.length === 1, JSON.stringify(r.logged));

r = run(payload(`echo ${'x'.repeat(500)}`));
check('grammar: long commands are truncated', (r.reason || '').length <= 161, String((r.reason || '').length));

// --- 4. Rotation keeps the log bounded and parseable ------------------------

{
  fs.mkdirSync(path.dirname(LOG), { recursive: true });
  fs.writeFileSync(LOG, `OLDEST-MARKER\n${'2026-01-01T00:00:00.000Z|guardrail|clean|-|filler\n'.repeat(12000)}`);
  const before = fs.statSync(LOG).size;
  execFileSync('node', [HOOK], { input: payload('echo after-rotation'), encoding: 'utf8', cwd: SANDBOX });
  const body = fs.readFileSync(LOG, 'utf8');
  check('rotation: shrinks past the cap', fs.statSync(LOG).size < before, `${before} -> ${fs.statSync(LOG).size}`);
  check('rotation: drops oldest, keeps newest', !body.includes('OLDEST-MARKER') && body.includes('after-rotation'), 'boundary wrong');
  check('rotation: leaves no partial first line', body.split('\n')[0].startsWith('2026-01-01T'), body.split('\n')[0].slice(0, 60));
}

fs.rmSync(SANDBOX, { recursive: true, force: true });

console.log(failures ? `\n${failures} FAILURE(S)` : `\nALL PASS`);
process.exit(failures ? 1 : 0);

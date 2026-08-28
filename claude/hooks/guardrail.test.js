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

const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'guardrail-test-'));
const HOOK = path.join(SANDBOX, 'hooks', 'guardrail.js');
const LOG = path.join(SANDBOX, 'state', 'guardrail.log');

fs.mkdirSync(path.join(SANDBOX, 'hooks'), { recursive: true });
fs.copyFileSync(path.join(__dirname, 'guardrail.js'), HOOK);

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

const BLOCKS = [['git push origin master', 'push-to-default-branch']];

for (const [cmd, rule] of BLOCKS) {
  const r = run(payload(cmd));
  check(`blocks: ${cmd}`, denied(r) && r.target === rule, `outcome=${r.outcome} target=${r.target}`);
}

// Near-misses. Each of these looks like a blocked shape and must still pass.
const ALLOWS = [
  'git push --dry-run origin master',
  'git push -u origin feat/some-branch',
  'git log --oneline -5',
];

for (const cmd of ALLOWS) {
  const r = run(payload(cmd));
  check(`allows: ${cmd}`, !denied(r) && r.outcome === 'clean', `outcome=${r.outcome} stdout=${r.stdout}`);
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

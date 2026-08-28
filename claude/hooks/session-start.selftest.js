#!/usr/bin/env node
// Selftest for session-start.js note(): the one-line annotation on each open PR.
//
// The behaviour under test is a judgement, not a fetch, so it is testable
// without the network: note() takes a plain PR object shaped like the JSON
// `gh pr list` returns and yields a string.
//
// Run: node session-start.selftest.js
//
// ADVERSARIAL NOTE (the source project recorded "green tests can encode the
// bug" six times): every assertion below was verified to FAIL against a deliberately
// broken note() before being kept. See the --prove flag, which reintroduces
// four real defects and asserts the suite goes red for each. A selftest that
// cannot fail is not evidence.

const path = require('path');
const SRC = process.env.SESSION_START_MODULE || path.join(__dirname, 'session-start.js');

// --prove: reintroduce each real defect and require the suite to go RED for it.
if (process.argv.includes('--prove')) {
  const fs = require('fs');
  const os = require('os');
  const { spawnSync } = require('child_process');
  const original = fs.readFileSync(path.join(__dirname, 'session-start.js'), 'utf8');

  // Each entry removes one guard the annotation depends on.
  const defects = [
    ['reads the rollup before the conflict state', (s) =>
      s.replace(/if \(p\.mergeStateStatus === 'DIRTY'\)[^\n]*\n/, '')],
    ['treats a still-running check as complete', (s) =>
      s.replace(/if \(running\) return '';[^\n]*\n/, '')],
    ['annotates drafts', (s) => s.replace(/if \(p\.isDraft\) return '';[^\n]*\n/, '')],
    ['claims an unknown conclusion is green', (s) =>
      s.replace(/if \(!verdicts\.every[^\n]*\n/, '')],
  ];

  let proven = 0;
  for (const [name, mutate] of defects) {
    const broken = mutate(original);
    if (broken === original) {
      console.log('  UNPROVEN — could not inject: ' + name);
      continue;
    }
    const tmp = path.join(os.tmpdir(), 'ss-defect-' + proven + '.js');
    fs.writeFileSync(tmp, broken);
    const r = spawnSync(process.execPath, [__filename], {
      env: { ...process.env, SESSION_START_MODULE: tmp },
      encoding: 'utf8',
    });
    fs.unlinkSync(tmp);
    if (r.status === 0) {
      console.log('  NOT CAUGHT — suite stayed green with this defect: ' + name);
    } else {
      proven++;
      console.log('  caught — ' + name);
    }
  }
  console.log('');
  console.log(proven + '/' + defects.length + ' injected defects caught');
  process.exit(proven === defects.length ? 0 : 1);
}

const { note } = require(SRC);

let pass = 0;
let fail = 0;

function ok(name, cond) {
  if (cond) {
    pass++;
    console.log('  ok   — ' + name);
  } else {
    fail++;
    console.log('  FAIL — ' + name);
  }
}

const HOUR = 3.6e6;
const agoHours = (h) => new Date(Date.now() - h * HOUR).toISOString();
const done = (c) => ({ status: 'COMPLETED', conclusion: c });
const running = { status: 'IN_PROGRESS', conclusion: '' };

// A PR that is finished but unmerged — the anomaly this annotation exists for.
const green = {
  isDraft: false,
  mergeStateStatus: 'BLOCKED',
  createdAt: agoHours(26),
  statusCheckRollup: [done('SUCCESS'), done('SUCCESS')],
};

ok('green + unmerged is called out', /GREEN/.test(note(green)));
ok('green + unmerged says it is not live', /nothing in it is live/.test(note(green)));
ok('age is reported in hours under 48h', /unmerged 26h/.test(note(green)));
ok(
  'age rolls over to days at 48h',
  /unmerged 3d/.test(note({ ...green, createdAt: agoHours(74) }))
);

// A draft is meant to sit. Annotating it would be noise, and a noisy line
// gets skimmed — which is how the original silent failure came back.
ok('a draft is never annotated', note({ ...green, isDraft: true }) === '');

// Mid-run is the normal state of a healthy PR, so it is not news.
ok(
  'a PR mid-run is not annotated',
  note({ ...green, statusCheckRollup: [done('SUCCESS'), running] }) === ''
);

// The case that makes the status guard load-bearing. A re-requested check can
// report IN_PROGRESS while `conclusion` still carries its PREVIOUS value, so a
// rollup can look all-SUCCESS while CI is actively re-running. Judging on
// conclusion alone would announce GREEN on a PR whose result is not yet known
// — the exact false "finished" claim this annotation exists to prevent. This
// was live on the source project on a PR that had just been force-pushed.
ok(
  'a re-running check with a stale SUCCESS conclusion is not called green',
  note({
    ...green,
    statusCheckRollup: [done('SUCCESS'), { status: 'IN_PROGRESS', conclusion: 'SUCCESS' }],
  }) === ''
);

// Red checks are worth naming, but they are not the "finished but unmerged" case.
const red = { ...green, statusCheckRollup: [done('SUCCESS'), done('FAILURE')] };
ok('red checks are called out', /RED/.test(note(red)));
ok('red checks are not reported as green', !/GREEN/.test(note(red)));
ok(
  'a timed-out check counts as red',
  /RED/.test(note({ ...green, statusCheckRollup: [done('TIMED_OUT')] }))
);

// Order matters: a conflicted PR runs ZERO checks, so an empty rollup means
// "conflicted", not "no CI". Reading the rollup first would mis-report it.
const dirty = { ...green, mergeStateStatus: 'DIRTY', statusCheckRollup: [] };
ok('a conflicted PR is called out as conflicting', /CONFLICTING/.test(note(dirty)));
ok(
  'conflict wins over a stale green rollup',
  /CONFLICTING/.test(note({ ...dirty, statusCheckRollup: [done('SUCCESS')] }))
);

// Neutral and skipped are successes for this purpose; treating them as
// failures would cry wolf on every PR with a skipped optional job.
ok(
  'skipped and neutral checks still count as green',
  /GREEN/.test(note({ ...green, statusCheckRollup: [done('SUCCESS'), done('SKIPPED'), done('NEUTRAL')] }))
);

// Degrade quietly rather than guess.
ok('no checks at all yields no annotation', note({ ...green, statusCheckRollup: [] }) === '');
ok('a null rollup does not throw', note({ ...green, statusCheckRollup: null }) === '');
ok(
  'an unknown conclusion is not claimed as green',
  note({ ...green, statusCheckRollup: [done('SOMETHING_NEW')] }) === ''
);

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);

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
// twelve real defects and asserts the suite goes red for each. A selftest that
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

    // probeSection defects. Each names the assertion that must report it,
    // so a defect that goes uncaught points at a specific missing test
    // rather than at the suite in general.
    ['probe summary reads the FIRST output line  (-> "the summary is the LAST line")',
      (s) => s.replace(/lines\[lines\.length - 1\]/, 'lines[0]')],
    ['a failing harness is reported as passing  (-> "a failing harness is called out")',
      (s) => s.replace(
        /return `PROBES NEED ATTENTION[^`]*`;/,
        "return 'Probes: ' + (lines.length ? lines[lines.length - 1].trim() : '(no output)');"
      )],
    // \r?\n throughout: this repo checks out CRLF on Windows and LF on the
    // Linux runner. A pattern anchored to a bare \n matches in CI and misses
    // locally, so the injection would go UNPROVEN on one platform only.
    ['a harness that cannot run is swallowed  (-> "a hanging harness is reported")',
      (s) => s.replace(
        / {2}if \(r\.error \|\| r\.status === null\) \{[\s\S]*?\r?\n {2}\}\r?\n/,
        ''
      )],

    // Added from the blind mutation run (#34). These came from agents that
    // wrote neither this file nor session-start.js and could not read any
    // suite, and each was verified both ways before being kept.
    [
      "broken-harness-drops-unverified-warning",
      (s) => s.replace("    return 'Probes: the harness ' + why + '. ' + PROBE_UNVERIFIED;", "    return 'Probes: ' + why + '.';"),
    ],
    [
      "probe-uses-process-cwd-not-hook-cwd",
      (s) => s.replace("  const probes = probeSection(cwd);", "  const probes = probeSection(process.cwd());"),
    ],
    [
      "harness-start-failure-goes-silent",
      (s) => s.replace("    return 'Probes: the harness could not be started. ' + PROBE_UNVERIFIED;", "    return '';"),
    ],
    [
      "cache-window-back-to-thirty-minutes",
      (s) => s.replace("const CACHE_MS = 5 * 60 * 1000;", "const CACHE_MS = 30 * 60 * 1000;"),
    ],
    [
      "probe-timeout-env-override-removed",
      (s) => s.replace("const PROBE_TIMEOUT_MS = Number(process.env.CLAUDE_PROBE_TIMEOUT_MS) || 20000;", "const PROBE_TIMEOUT_MS = 20000;"),
    ],
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

const { note, probeSection } = require(SRC);

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

// ---------------------------------------------------------------------------
// probeSection(): running a project's own re-check harness.
//
// The behaviour that matters here is what happens when the harness does NOT
// simply pass. A harness that cannot run must be reported, because "no probes
// here" and "the probes are broken" reading the same is how a dead check
// survives. Every case below builds a real harness on disk and runs it.

const fsx = require('fs');
const osx = require('os');

function fixture(body) {
  const dir = fsx.mkdtempSync(path.join(osx.tmpdir(), 'probe-fixture-'));
  if (body !== null) {
    fsx.mkdirSync(path.join(dir, '.claude', 'probes'), { recursive: true });
    fsx.writeFileSync(path.join(dir, '.claude', 'probes', 'run-all.js'), body);
  }
  return dir;
}

ok('a project with no harness says nothing', probeSection(fixture(null)) === '');

ok(
  'a passing harness is reported on one line',
  probeSection(fixture('console.log("noise");console.log("Result: every note holds.")')) ===
    'Probes: Result: every note holds.'
);

ok(
  'the summary is the LAST line, not the first',
  !/noise/.test(
    probeSection(fixture('console.log("noise");console.log("Result: every note holds.")'))
  )
);

const failing = probeSection(
  fixture('console.log("bash-heredoc: STALE");process.exit(1)')
);
ok('a failing harness is called out', /PROBES NEED ATTENTION \(exit 1\)/.test(failing));
ok('a failing harness shows its full output', /bash-heredoc: STALE/.test(failing));

ok(
  'a harness that exits 0 silently is not reported as holding',
  probeSection(fixture('process.exit(0)')) === 'Probes: (no output)'
);

// A crash is not a pass. Node exits non-zero on an uncaught throw, so this
// lands in the same branch as a red harness rather than being swallowed.
ok(
  'a harness that crashes is called out',
  /PROBES NEED ATTENTION/.test(probeSection(fixture('throw new Error("boom")')))
);

// Pins `harness-start-failure-goes-silent`. The branches above cover a harness
// that STARTED and then died (r.error, timeout, non-zero exit); this covers one
// that never started at all — the catch around spawnSync. Returning '' there
// makes "no probes here" and "the probes are broken" read identically, which is
// the confusion probeSection's own comment forbids. Reached by swapping
// spawnSync before the module re-binds it, since the module destructures it at
// load — the same re-require trick the timeout case below uses.
{
  const cp = require('child_process');
  const realSpawnSync = cp.spawnSync;
  cp.spawnSync = () => {
    throw new Error('EAGAIN: spawn failed');
  };
  delete require.cache[require.resolve(SRC)];
  const { probeSection: unstartable } = require(SRC);
  const withHarness = unstartable(fixture('console.log("Result: every note holds.")'));
  const withoutHarness = unstartable(fixture(null));
  cp.spawnSync = realSpawnSync;
  delete require.cache[require.resolve(SRC)]; // leave the cache clean for the re-require below

  ok(
    'a harness that cannot be started at all is reported',
    withHarness !== '' && /unverified/i.test(withHarness)
  );
  // Control: silence still has to mean "no harness here", or the assertion
  // above would pass against a probeSection that returned a message for
  // everything.
  ok('no harness still says nothing when spawning is broken', withoutHarness === '');
}

// The timeout branch, exercised for real. Without the env override this test
// would take twenty seconds, so the branch would never be run and would rot.
process.env.CLAUDE_PROBE_TIMEOUT_MS = '250';
delete require.cache[require.resolve(SRC)]; // the constant is read at load
const { probeSection: slowProbe } = require(SRC);
ok(
  'a hanging harness is reported, not silently skipped',
  /timed out/.test(slowProbe(fixture('setTimeout(() => {}, 60000)')))
);

// Pins broken-harness-drops-unverified-warning. A run that produced no verdict
// has to say so in the words the agent acts on: it names the harness and
// carries PROBE_UNVERIFIED. Otherwise the line reads as an ordinary probe
// summary and a dead check hides inside a normal-looking report. Matching only
// /timed out/ cannot tell those two apart, which is what makes this the
// discriminating case.
const timedOut = slowProbe(fixture('setTimeout(() => {}, 60000)'));
ok(
  'a hanging harness is reported as unverified, not as a summary',
  /unverified/.test(timedOut) && /harness/.test(timedOut)
);

// Control: the warning must NOT appear on a healthy run, or the assertion
// above would also pass against a hook that stamps it onto every report.
ok(
  'a passing harness carries no unverified warning',
  !/unverified/.test(probeSection(fixture('console.log("Result: every note holds.")')))
);
delete process.env.CLAUDE_PROBE_TIMEOUT_MS;

console.log('');
// The cache window, asserted as behaviour. CACHE_MS is not exported, so this
// runs the hook for real against a seeded cache file. claude/README.md and the
// constant's own comment both commit to 5 minutes; 30 was abandoned once the
// brief started carrying a check-state claim. 6 minutes against 1 minute is the
// pair that separates the two windows — under 30 minutes both are hits.
{
  const { spawnSync: spawnHook } = require('child_process');
  // Run a COPY, so `state/session-brief.json` resolves inside the sandbox and
  // the real cache is never read or written.
  const box = fsx.mkdtempSync(path.join(osx.tmpdir(), 'session-start-cache-'));
  fsx.mkdirSync(path.join(box, 'hooks'), { recursive: true });
  fsx.mkdirSync(path.join(box, 'state'), { recursive: true });
  const hookCopy = path.join(box, 'hooks', 'session-start.js');
  fsx.copyFileSync(SRC, hookCopy); // SRC, so --prove can inject into this too
  const cacheFile = path.join(box, 'state', 'session-brief.json');

  // The cached cwd is an empty temp dir: on a MISS the rebuild finds no GitHub
  // repo there and prints nothing, so the marker surviving to stdout is the
  // hit/miss signal.
  const seeded = (ageMs, marker) => {
    const dir = fixture(null);
    fsx.writeFileSync(
      cacheFile,
      JSON.stringify({ [dir]: { ts: Date.now() - ageMs, text: marker } })
    );
    const r = spawnHook(process.execPath, [hookCopy], {
      input: JSON.stringify({ cwd: dir }),
      encoding: 'utf8',
    });
    return String(r.stdout || '');
  };

  // Control first: inside the window the brief is served from cache, so a miss
  // below means the window expired rather than that caching never happens.
  ok('a 1-minute-old brief is served from cache', /CACHE-FRESH/.test(seeded(60 * 1000, 'CACHE-FRESH')));
  ok('a 6-minute-old brief is past the window', !/CACHE-STALE/.test(seeded(6 * 60 * 1000, 'CACHE-STALE')));
}



// Defect: the CLAUDE_PROBE_TIMEOUT_MS override dropped, hard-wiring
// PROBE_TIMEOUT_MS to 20000. The timeout assertion above still passes then —
// it just takes twenty real seconds — so nothing catches the loss of the one
// thing that comment promises. Elapsed time is the only discriminator: the
// timed-out verdict has to arrive far inside the default. The fast-harness
// control runs under the SAME small override, so this cannot pass by way of a
// probeSection that reports a timeout for everything.
{
  process.env.CLAUDE_PROBE_TIMEOUT_MS = '1000';
  delete require.cache[require.resolve(SRC)]; // the constant is read at load
  const { probeSection: capped } = require(SRC);

  const started = Date.now();
  const verdict = capped(fixture('setTimeout(() => {}, 60000)'));
  const elapsed = Date.now() - started;
  ok(
    'the timeout override is honoured: a hang is reported well inside the 20s default',
    /timed out/.test(verdict) && elapsed < 8000
  );

  ok(
    'the same small override does not time out a harness that finishes',
    capped(fixture('console.log("Result: fine.")')) === 'Probes: Result: fine.'
  );

  delete process.env.CLAUDE_PROBE_TIMEOUT_MS;
}


// Pins `probe-uses-process-cwd-not-hook-cwd`: the hook must look for the
// harness at the cwd the SessionStart payload supplies, not at whatever
// directory the hook PROCESS happens to be started in — the hooks install
// machine-global, so the payload is the only thing that names the project.
// Every probeSection() case above passes a directory in by hand, so a call site
// that reads process.cwd() instead is invisible to them; only running the hook
// end to end, with the two directories deliberately different, discriminates.
// The hook is copied into a temp tree first so its cache write lands there
// instead of in the repo's own claude/state.
{
  const { spawnSync: spawnHook } = require('child_process');
  const hookHome = fsx.mkdtempSync(path.join(osx.tmpdir(), 'ss-hook-'));
  fsx.mkdirSync(path.join(hookHome, 'hooks'), { recursive: true });
  const hookCopy = path.join(hookHome, 'hooks', 'session-start.js');
  // SRC, not the pristine file: under --prove the module under test is a mutant.
  fsx.writeFileSync(hookCopy, fsx.readFileSync(SRC, 'utf8'));

  const withProbes = fixture('console.log("Result: probes ran in the payload cwd.")');
  const noProbes = fixture(null);
  const runHook = (payloadCwd, processCwd) =>
    spawnHook(process.execPath, [hookCopy], {
      input: JSON.stringify({ cwd: payloadCwd }),
      cwd: processCwd,
      encoding: 'utf8',
    }).stdout || '';

  ok(
    'probes are found at the payload cwd, not the hook process cwd',
    /Probes: Result: probes ran in the payload cwd\./.test(runHook(withProbes, noProbes))
  );

  // Control, the other direction: a harness sitting at the process cwd must NOT
  // be reported when the payload names a project that has none. Without it the
  // assertion above would also hold for a hook that reports any harness it can
  // reach from anywhere.
  ok(
    'a payload cwd with no harness stays silent even when the process cwd has one',
    !/Probes:/.test(runHook(noProbes, withProbes))
  );
}

console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);

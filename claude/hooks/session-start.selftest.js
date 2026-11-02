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
// fourteen real defects and asserts the suite goes red for each. A selftest that
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

    // archiveSection defects: one in each direction. A tripwire that cannot
    // fire loses data silently; one that fires on every machine gets skimmed
    // (and then disabled) — both defeat it.
    ['a stale archive is reported as healthy  (-> "a stale archive is called out")',
      (s) => s.replace("if (stampAge <= ARCHIVE_STALE_MS) return '';", "return '';")],
    ['an unadopted machine is nagged about the archive  (-> "a machine without the archiver stays silent")',
      (s) => s.replace(/if \(!fs\.existsSync\(config\)\) return '';[^\n]*\n/, '')],

    // backupSection defects, the same pair plus the one detail that makes
    // the line actionable: a leftover lock that is not named sends the
    // reader back to the log this line exists to replace.
    ['a stale backup is reported as healthy  (-> "a stale backup is called out")',
      (s) => s.replace("if (age <= BACKUP_STALE_MS) return '';", "return '';")],
    ['an unadopted machine is nagged about the backup  (-> "a machine without the backup stays silent")',
      (s) => s.replace(/if \(stamp\.state === 'absent' && !fs\.existsSync\(log\)\) return '';[^\n]*\n/, '')],
    ['a present index.lock is not reported  (-> "a stale backup reports a present index.lock")',
      (s) => s.replace(/if \(lock && fs\.existsSync\(lock\)\) \{/, 'if (false) {')],
    ['a failure newer than the record waits for the 48h backstop  (-> "a failure newer than a fresh stamp is reported at once")',
      (s) => s.replace("const failures = since.filter((r) => r.verdict === 'FAILED' || r.verdict === 'trigger-failed');", "const failures = [];")],
    ['only the newest line is judged, so a retry erases a failure  (-> "a failure followed by a new start is still reported")',
      (s) => s.replace("const failures = since.filter((r) => r.verdict === 'FAILED' || r.verdict === 'trigger-failed');", "const failures = newest && newest.verdict === 'FAILED' ? [newest] : [];")],
    ['ok-local is parsed as ok  (-> "the parser keeps ok-local distinct from ok")',
      (s) => s.replace("(started|trigger-failed|ok-local|ok|FAILED|busy)(?=\\s|$)", "(started|trigger-failed|ok|ok-local|FAILED|busy)\\b")],
    ['a second start hides an older interrupted run  (-> "a second start does not reset an older interrupted run")',
      (s) => s.replace("const overdue = openStarts.find(", "const overdue = openStarts.slice(-1).find(")],
    ['an equal-second failure is dropped by a strict time filter  (-> "a failure in the same second AFTER the success is reported")',
      (s) => s.replace("anchor >= 0 ? runs.slice(anchor + 1) : ", "")],
    ['a failed trigger has no reader  (-> "a failed trigger is reported at the next session")',
      (s) => s.replace("(started|trigger-failed|ok-local|ok|FAILED|busy)(?=\\s|$)", "(started|ok-local|ok|FAILED|busy)(?=\\s|$)")],
    ['a future-dated record is trusted  (-> "a future-dated record is unknown, not healthy")',
      (s) => s.replace(/if \(at > Date\.now\(\) \+ BACKUP_SKEW_MS\) return \{ state: 'future', at \};[^\n]*\n/, '')],
    ['the record\'s mtime is trusted over its stored time  (-> "readBackupStamp reads the stored time, not the mtime")',
      (s) => s.replace("return { state: 'ok', at, repo, commit, ref };", "return { state: 'ok', at: fs.statSync(stampPath).mtimeMs, repo, commit, ref };")],
    ['an interrupted run is never noticed  (-> "a run that started and recorded no completion is called out")',
      (s) => s.replace("const overdue = openStarts.find((s) => Date.now() - s.at > BACKUP_OVERDUE_MS);", "const overdue = null;")],

    // memoryLinkSection. This one is platform-independent: the assertion that
    // catches it runs everywhere, because a stale COPY needs no hard link to
    // create.
    ['a project without the link script is nagged  (-> "no link script = silent, not a warning")',
      (s) => s.replace("  if (!script) return ''; // not adopted here", "  if (!script) return 'MEMORY LINKS: absent';")],
  ];

  // The repair branches only execute on Windows, so injecting them on the
  // Linux runner produces UNPROVEN rows for defects no assertion there COULD
  // catch — which reads as a hole in the suite rather than a platform limit.
  // Gate them instead, and print the gate: a defect list that silently shrinks
  // by platform is the same failure as a test that silently does not run.
  if (process.platform === 'win32') {
    defects.push(
      ['a link broken by an edit is never detected  (-> "a link broken by an edit is repaired")',
        (s) => s.replace(/if \(String\(ls\.ino\) !== String\(ss\.ino\)\) drift\.broken\.push\(n\);/, '')],
      ['a healthy tree is reported as repaired  (-> "a fully linked tree says nothing")',
        (s) => s.replace(/if \(count === 0\) return '';[^\n]*\r?\n/, '')],
      ['the repair script is believed on its exit code  (-> "a script that exits 0 without repairing is NOT believed")',
        (s) => s.replace(/ {2}const after = memoryLinkDrift\(sourceDir, destDir\);[\s\S]*?\r?\n {2}\}\r?\n/, '')]
    );
  } else {
    console.log('  (3 memory-link repair defects NOT injected: Windows-only branches)');
  }

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

const { note, probeSection, archiveSection, backupSection, backupRuns, readBackupStamp } = require(SRC);

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

// ---------------------------------------------------------------------------
// archiveSection(): the transcript-archive staleness tripwire.
//
// Same contract shape as probes: a machine that never adopted the archiver
// is silent; once adopted, nothing short of a fresh successful run may read
// as healthy. Every case builds a real Claude-home directory on disk; stamp
// age is set through the file's mtime, which is what the hook reads.

function archiveFixture(opts) {
  const dir = fsx.mkdtempSync(path.join(osx.tmpdir(), 'archive-fixture-'));
  if (opts.config) {
    fsx.writeFileSync(path.join(dir, 'transcript-archive-path.txt'), 'D:\\archive');
  }
  if (opts.stampAgeHours !== undefined) {
    const stamp = path.join(dir, '.last-transcript-archive');
    fsx.writeFileSync(stamp, 'stamp');
    const t = new Date(Date.now() - opts.stampAgeHours * HOUR);
    fsx.utimesSync(stamp, t, t);
  }
  return dir;
}

ok('a machine without the archiver stays silent', archiveSection(archiveFixture({})) === '');
ok(
  'configured but never run is reported',
  /TRANSCRIPT ARCHIVE/.test(archiveSection(archiveFixture({ config: true })))
);
ok(
  'a fresh stamp says nothing',
  archiveSection(archiveFixture({ config: true, stampAgeHours: 1 })) === ''
);
ok(
  'a stamp inside the 48h window is healthy',
  archiveSection(archiveFixture({ config: true, stampAgeHours: 47 })) === ''
);
const staleArchive = archiveSection(archiveFixture({ config: true, stampAgeHours: 72 }));
ok('a stale archive is called out', /TRANSCRIPT ARCHIVE STALE/.test(staleArchive));
ok('a stale archive reports its age', /3d/.test(staleArchive));
// Adoption is evidenced by the stamp, not the config: deleting the config
// file after a scheduled task exists must not silence the warning.
ok(
  'a stale stamp warns even when the config file is gone',
  /STALE/.test(archiveSection(archiveFixture({ stampAgeHours: 72 })))
);

// ---------------------------------------------------------------------------
// backupSection(): the state-backup staleness tripwire.
//
// Same contract as the archive, plus two details the line must carry so the
// agent reading it need not open anything: the leftover .git/index.lock in
// the repo the stamp names, and the last failure line from the run log.
// The stamp's second line names the backup repo, so the fixture builds one.

// runs: [[ageHours, verdict, rest], ...] oldest first, written the way the
// script writes them (ISO time, two spaces, the script's name, the verdict).
function backupFixture(opts) {
  const dir = fsx.mkdtempSync(path.join(osx.tmpdir(), 'backup-fixture-'));
  const repo = path.join(dir, 'claude-state');
  fsx.mkdirSync(path.join(repo, '.git'), { recursive: true });
  // h is hours ago, or an exact ISO time for same-second cases.
  if (opts.runs) {
    const lines = opts.runs.map(
      ([h, verdict, rest]) =>
        `${typeof h === 'string' ? h : new Date(Date.now() - h * HOUR).toISOString()}  backup-claude-state ${verdict}${rest ? ' ' + rest : ''}`
    );
    // One hook line in the script's neighbourhood, to prove the parser
    // takes the script's lines only.
    lines.unshift(`${new Date(Date.now() - 99 * HOUR).toISOString()}  FIRED event=SessionEnd tool=- reason=other`);
    fsx.writeFileSync(path.join(dir, 'hooks-backup.log'), lines.join('\n') + '\n');
  }
  // The record the script writes: stored time, repo, 40-hex commit, ref. Its
  // mtime is set to NOW on purpose: the hook must read the stored time, not
  // the file time, or a copy or a touch would read as a fresh backup.
  if (opts.stampAgeHours !== undefined) {
    const at = new Date(Date.now() - opts.stampAgeHours * HOUR).toISOString();
    fsx.writeFileSync(
      path.join(dir, '.last-state-backup'),
      `${at}\n${repo}\n7c489747449e75851b8844d1bf3afeb50d03be0f\norigin/master\n`
    );
  }
  if (opts.stampAt !== undefined) {
    fsx.writeFileSync(
      path.join(dir, '.last-state-backup'),
      `${opts.stampAt}\n${repo}\n7c489747449e75851b8844d1bf3afeb50d03be0f\norigin/master\n`
    );
  }
  if (opts.stampText !== undefined) {
    fsx.writeFileSync(path.join(dir, '.last-state-backup'), opts.stampText);
  }
  if (opts.lock) {
    fsx.writeFileSync(path.join(repo, '.git', 'index.lock'), '');
  }
  return dir;
}

// The parser, exactly. 'ok-local' read as 'ok' was reproduced in review.
{
  const dir = backupFixture({ runs: [[3, 'ok', 'committed, pushed master'], [2, 'ok-local', 'no remote'], [1, 'FAILED', 'x']] });
  const parsed = backupRuns(path.join(dir, 'hooks-backup.log')).map((r) => r.verdict);
  ok('the parser keeps ok-local distinct from ok', parsed.join(',') === 'ok,ok-local,FAILED');
  ok(
    'the parser ignores the hook\'s own lines',
    backupRuns(path.join(dir, 'hooks-backup.log')).length === 3
  );
}

ok('a machine without the backup stays silent', backupSection(backupFixture({})) === '');
ok(
  'runs on record but no success is reported',
  /STATE BACKUP: runs are on record/.test(backupSection(backupFixture({ runs: [[2, 'ok-local', 'no remote']] })))
);
ok(
  'a fresh backup stamp with a clean last run says nothing',
  backupSection(backupFixture({ stampAgeHours: 1, runs: [[1, 'ok', 'committed, pushed master']] })) === ''
);
ok(
  'a backup stamp inside the 48h window is healthy',
  backupSection(backupFixture({ stampAgeHours: 47, runs: [[47, 'ok']] })) === ''
);
const staleBackup = backupSection(backupFixture({ stampAgeHours: 72, runs: [[72, 'ok']] }));
ok('a stale backup is called out', /STATE BACKUP STALE/.test(staleBackup));
ok('a stale backup reports its age', /3d/.test(staleBackup));
// Control for the lock assertion below: without a lock the line must not
// mention one, or naming it would be decoration rather than detection.
ok('a stale backup without a lock does not mention one', !/index\.lock/.test(staleBackup));
const staleWithLock = backupSection(backupFixture({ stampAgeHours: 72, runs: [[72, 'ok']], lock: true }));
ok('a stale backup reports a present index.lock', /index\.lock is present/.test(staleWithLock));
// Presence is reported, abandonment is not asserted: a live writer can own it.
ok('the lock is not diagnosed as abandoned', /may own it/.test(staleWithLock) && !/stale lock/i.test(staleWithLock));
// Adoption is evidenced by the stamp alone: a log rotated away after a
// scheduled task exists must not silence the warning.
ok(
  'a stale backup stamp warns even when the log is gone',
  /STALE/.test(backupSection(backupFixture({ stampAgeHours: 72 })))
);

// The case the age check alone cannot see: yesterday's success is fresh and
// this morning's run failed. That must be reported at the NEXT session.
const freshFail = backupSection(
  backupFixture({ stampAgeHours: 20, runs: [[20, 'ok'], [2, 'FAILED', '(61s) git add failed; check git status by hand']] })
);
ok('a failure newer than a fresh stamp is reported at once', /STATE BACKUP FAILED/.test(freshFail));
ok('the failure line carries the reason', /git add failed/.test(freshFail));
ok('the failure line carries the age of the last success', /Last verified snapshot 20h ago/.test(freshFail));
// Control: a failure OLDER than the last success is history, not news.
ok(
  'a failure older than the last success is not reported',
  backupSection(backupFixture({ stampAgeHours: 1, runs: [[3, 'FAILED', 'old'], [1, 'ok']] })) === ''
);
ok(
  'the newest failure is quoted, not the first',
  (() => {
    const out = backupSection(
      backupFixture({ stampAgeHours: 5, runs: [[5, 'ok'], [2, 'FAILED', 'first reason'], [1, 'FAILED', 'second reason']] })
    );
    return /second reason/.test(out) && !/first reason/.test(out);
  })()
);
// Absence of a record is not evidence that nothing was ever backed up: a
// recovered repo has history older than its first record.
ok(
  'a failure with no record says no verified success is recorded',
  /No verified success is recorded/.test(backupSection(backupFixture({ runs: [[1, 'FAILED', 'coverage: x']] })))
);

// A retry is not recovery. Reproduced in review: a later 'started' or
// 'ok-local' line made a fresh failure vanish from the warning.
const failThenStart = backupSection(
  backupFixture({ stampAgeHours: 5, runs: [[5, 'ok'], [2, 'FAILED', 'git add failed'], [0.05, 'started']] })
);
ok('a failure followed by a new start is still reported', /STATE BACKUP FAILED/.test(failThenStart) && /git add failed/.test(failThenStart));
ok('the later start is mentioned, not mistaken for recovery', /A later run started/.test(failThenStart));
const failThenLocal = backupSection(
  backupFixture({ stampAgeHours: 5, runs: [[5, 'ok'], [2, 'FAILED', 'git add failed'], [1, 'ok-local', '-NoPush']] })
);
ok('a failure followed by a local-only run is still reported', /STATE BACKUP FAILED/.test(failThenLocal) && /ended ok-local/.test(failThenLocal));
// Recovery proper: a verified success after the failure writes a new record,
// and the window closes.
ok(
  'a failure followed by a verified success is cleared',
  backupSection(backupFixture({ stampAgeHours: 1, runs: [[5, 'ok'], [2, 'FAILED', 'x'], [1, 'ok', 'committed, pushed master']] })) === ''
);

// A run that was interrupted writes nothing after 'started'. Nothing else can
// log a kill, so the open 'started' line is the notice; it cannot tell a kill
// from a slow run, and the wording says so.
const overdue = backupSection(backupFixture({ stampAgeHours: 3, runs: [[3, 'ok'], [1, 'started']] }));
ok('a run that started and recorded no completion is called out', /STATE BACKUP OVERDUE/.test(overdue) && /no completion/.test(overdue));
ok('the overdue line does not claim the run is dead', /interrupted or is still running/.test(overdue));
// Control: a run that started five minutes ago is simply running.
ok(
  'a run started minutes ago is not overdue',
  backupSection(backupFixture({ stampAgeHours: 3, runs: [[3, 'ok'], [0.08, 'started']] })) === ''
);
// 'busy' is another launch bouncing off the lock, not a verdict on the run.
ok(
  'a busy line does not hide or fake a verdict',
  backupSection(backupFixture({ stampAgeHours: 1, runs: [[1, 'ok'], [0.5, 'busy', 'another run holds the lock']] })) === ''
);

// Reproduced in review, round 006: a second start reset the overdue check
// for an older run that never reported.
const twoStarts = backupSection(backupFixture({ stampAgeHours: 3, runs: [[3, 'ok'], [2, 'started'], [0.1, 'started']] }));
ok('a second start does not reset an older interrupted run', /STATE BACKUP OVERDUE/.test(twoStarts) && /2 starts/.test(twoStarts));

// Reproduced in review, round 006: the writer records whole seconds, so a
// success and a failure can share one time. Log order must decide, in
// both directions.
{
  const t = new Date(Date.now() - 2 * HOUR);
  t.setMilliseconds(0);
  const same = t.toISOString();
  const okThenFail = backupSection(backupFixture({ stampAt: same, runs: [[same, 'ok', 'committed'], [same, 'FAILED', 'preflight']] }));
  ok('a failure in the same second AFTER the success is reported', /STATE BACKUP FAILED/.test(okThenFail) && /preflight/.test(okThenFail));
  ok(
    'a failure in the same second BEFORE the success is not resurrected',
    backupSection(backupFixture({ stampAt: same, runs: [[same, 'FAILED', 'earlier'], [same, 'ok', 'committed']] })) === ''
  );
}

// Reproduced in review, round 006: the hook's failed request to start the
// worker had no reader. The hook now writes a worker-shaped line.
const trig = backupSection(
  backupFixture({ stampAgeHours: 1, runs: [[1, 'ok'], [0.5, 'trigger-failed', 'ERROR: The system cannot find the file specified.']] })
);
// "Launch is unconfirmed", not "no worker ran": a schtasks timeout can leave
// an accepted launch behind (review, round 008).
ok('a failed trigger is reported at the next session', /STATE BACKUP TRIGGER FAILED/.test(trig) && /launch is unconfirmed/.test(trig));
ok(
  'a later start does not clear a failed trigger',
  /TRIGGER FAILED/.test(backupSection(backupFixture({ stampAgeHours: 1, runs: [[1, 'ok'], [0.5, 'trigger-failed', 'x'], [0.05, 'started']] })))
);
ok(
  'a verified success clears a failed trigger',
  backupSection(backupFixture({ stampAgeHours: 0.2, runs: [[1, 'ok'], [0.5, 'trigger-failed', 'x'], [0.2, 'ok', 'committed']] })) === ''
);

// The record itself can lie. Reproduced in review: an empty file with a
// fresh mtime, and a record dated in 2027, both read as healthy.
ok(
  'an empty record with a fresh mtime is unknown, not healthy',
  /STATE BACKUP UNKNOWN/.test(backupSection(backupFixture({ stampText: '' })))
);
ok(
  'a two-line record is unknown, not healthy',
  /STATE BACKUP UNKNOWN/.test(backupSection(backupFixture({ stampText: '2026-11-02T10:00:00+02:00\nC:\\x\n' })))
);
const future = backupSection(backupFixture({ stampText: `${new Date(Date.now() + 365 * 24 * HOUR).toISOString()}\nC:\\x\n7c489747449e75851b8844d1bf3afeb50d03be0f\norigin/master\n` }));
ok('a future-dated record is unknown, not healthy', /STATE BACKUP UNKNOWN/.test(future) && /future/.test(future));
ok(
  'readBackupStamp reads the stored time, not the mtime',
  (() => {
    const dir = backupFixture({ stampAgeHours: 72 });
    const s = readBackupStamp(path.join(dir, '.last-state-backup'));
    return s.state === 'ok' && Date.now() - s.at > 71 * HOUR;
  })()
);
ok(
  'a stale record says work is not confirmed, not that it is absent',
  /not confirmed backed up/.test(backupSection(backupFixture({ stampAgeHours: 72, runs: [[72, 'ok']] })))
);

console.log('');
// memoryLinkSection. The repair path needs real hard links, so it runs only on
// Windows; CI is ubuntu-latest and exercises the platform branch instead. The
// skip is PRINTED, because "these tests passed" and "these tests never ran"
// must not look the same — the same rule the probe section is held to.
{
  const { spawnSync: spawnHook, execFileSync: exec } = require('child_process');
  // The repair script sits at <kit>/claude/scripts/. That resolves from the KIT
  // tree but not from a machine-global install, where these hooks live in
  // <claudeHome>/hooks/ and there is no sibling scripts/ — the hook itself does
  // not care (it resolves the script per PROJECT), but this suite needs a real
  // copy to seed fixtures with. Found by running the installed copy, where the
  // missing file threw an ENOENT stack trace instead of saying what was wrong.
  // Report and skip, like every other unrunnable-harness path in this file.
  const LINKER = path.join(__dirname, '..', 'scripts', 'link-memory-notes.ps1');
  const haveLinker = fsx.existsSync(LINKER);

  const box = fsx.mkdtempSync(path.join(osx.tmpdir(), 'ss-memlink-'));
  fsx.mkdirSync(path.join(box, 'hooks'), { recursive: true });
  fsx.mkdirSync(path.join(box, 'state'), { recursive: true });
  const hookCopy = path.join(box, 'hooks', 'session-start.js');
  fsx.copyFileSync(SRC, hookCopy); // SRC, so --prove injects into this too

  // script: 'real' | 'liar' (exits 0, repairs nothing) | 'none'
  // dest:   { name: 'link' } for a real hard link, or any string for a stale COPY
  const memFixture = ({ script = 'real', notes = {}, dest = {} }) => {
    const root = fsx.mkdtempSync(path.join(osx.tmpdir(), 'memlink-'));
    const proj = path.join(root, 'proj');
    const home = path.join(root, 'home');
    fsx.mkdirSync(path.join(proj, '.claude', 'scripts'), { recursive: true });
    const sp = path.join(proj, '.claude', 'scripts', 'link-memory-notes.ps1');
    if (script === 'real') fsx.copyFileSync(LINKER, sp);
    else if (script === 'liar') fsx.writeFileSync(sp, 'exit 0\n');

    const src = path.join(home, 'projects', proj.replace(/[:\\/]/g, '-'), 'memory');
    fsx.mkdirSync(src, { recursive: true });
    for (const [n, c] of Object.entries(notes)) fsx.writeFileSync(path.join(src, n), c);

    const dd = path.join(proj, '.claude', 'memory');
    if (Object.keys(dest).length) {
      fsx.mkdirSync(dd, { recursive: true });
      for (const [n, how] of Object.entries(dest)) {
        if (how === 'link') exec('fsutil', ['hardlink', 'create', path.join(dd, n), path.join(src, n)], { stdio: 'ignore' });
        else fsx.writeFileSync(path.join(dd, n), how);
      }
    }
    return { proj, home, src, dd };
  };

  const runMem = (f) =>
    String(
      spawnHook(process.execPath, [hookCopy], {
        input: JSON.stringify({ cwd: f.proj }),
        env: { ...process.env, CLAUDE_MEMLINK_HOME: f.home },
        encoding: 'utf8',
        timeout: 60000,
      }).stdout || ''
    );

  // Platform-independent. A stale COPY needs no fsutil to create.
  ok(
    'no link script = silent, not a warning',
    !/emory link/i.test(runMem(memFixture({ script: 'none', notes: { 'a.md': 'x' }, dest: { 'a.md': 'stale' } })))
  );

  if (!haveLinker) {
    console.log('  (memory-link tests SKIPPED: no link-memory-notes.ps1 at ' + LINKER + ')');
  } else if (process.platform !== 'win32') {
    // The adopted-but-unrunnable branch, which is the real state on this runner.
    const out = runMem(memFixture({ notes: { 'a.md': 'x' }, dest: { 'a.md': 'stale' } }));
    ok('off-Windows, drift is reported rather than silently ignored', /MEMORY LINKS/.test(out));
    ok('off-Windows, the reason names the platform limit', /Windows-only/.test(out));
    console.log('  (memory-link repair tests SKIPPED: need Windows hard links)');
  } else {
    const healthy = memFixture({ notes: { 'a.md': 'x' }, dest: { 'a.md': 'link' } });
    ok('a fully linked tree says nothing', !/emory link/i.test(runMem(healthy)));

    const added = memFixture({ notes: { 'a.md': 'x', 'b.md': 'y' }, dest: { 'a.md': 'link' } });
    const addedOut = runMem(added);
    ok('a new note is repaired', /repaired 1/.test(addedOut) && /1 new/.test(addedOut));
    ok(
      'the repaired note really is one file record',
      String(fsx.statSync(path.join(added.src, 'b.md')).ino) ===
        String(fsx.statSync(path.join(added.dd, 'b.md')).ino)
    );

    // The case this section exists for: an editor renamed over the link, so the
    // project path serves OLD content while looking perfectly current.
    const brk = memFixture({ notes: { 'a.md': 'EDITED' }, dest: { 'a.md': 'stale from a rename' } });
    const brkOut = runMem(brk);
    ok('a link broken by an edit is repaired', /repaired 1/.test(brkOut) && /broken by an edit/.test(brkOut));
    ok('the stale content is gone after repair', fsx.readFileSync(path.join(brk.dd, 'a.md'), 'utf8') === 'EDITED');

    const orph = memFixture({ notes: { 'a.md': 'x' }, dest: { 'a.md': 'link', 'gone.md': 'orphan' } });
    const orphOut = runMem(orph);
    ok('an orphan link is reported', /1 orphaned/.test(orphOut));
    ok('an orphan link is actually removed', !fsx.existsSync(path.join(orph.dd, 'gone.md')));

    // Principle 3: the script's exit code is a claim by the thing under test.
    // A script that exits 0 and repairs nothing must not read as success.
    const liar = memFixture({ script: 'liar', notes: { 'a.md': 'x' }, dest: { 'a.md': 'stale' } });
    ok('a script that exits 0 without repairing is NOT believed', /still wrong/.test(runMem(liar)));

    // Control: if healthy and broken produced the same output, every row above
    // would hold for a section that does nothing at all.
    ok('CONTROL: healthy and broken trees differ', runMem(healthy) !== brkOut);

    // The script's OWN default, which nothing above exercises: session-start.js
    // always passes -ProjectDir, so the default never evaluated and a real bug
    // survived every case here. Under PS 5.1 $PSScriptRoot is empty inside a
    // param() default reached through -File, so a bare run threw. Invoke it the
    // way a person would.
    const bare = spawnHook(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', LINKER],
      { cwd: path.join(__dirname, '..', '..'), encoding: 'utf8', timeout: 60000 }
    );
    const bareOut = String(bare.stdout || '') + String(bare.stderr || '');
    ok('the script runs with no -ProjectDir', bare.status === 0 && !/empty string/i.test(bareOut));
    ok('a bare run resolves the project, not the script folder', /\.claude[\\/]memory/.test(bareOut));
  }
}

console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);

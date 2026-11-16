#!/usr/bin/env node
// Selftest for doc-style-check.js, the kit's doc-style gate.
//
// Run: node scripts/doc-style-check.selftest.js
//
// Three layers. Fixtures prove each rule fires and stays quiet on clean
// text. A temporary git repo proves the scope rule and the commit gate end
// to end. Last, a control proves the suite looks at sentences at all.
//
// ADVERSARIAL NOTE: a selftest that cannot fail is not evidence. The --prove
// flag copies the checker, reintroduces one real defect per rule or per
// guard, and requires this suite to go red for each. Each defect the suite
// misses appears as NOT CAUGHT and fails the run.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ORIGINAL = path.join(__dirname, 'doc-style-check.js');
const SRC = process.env.DOC_STYLE_MODULE || ORIGINAL;

if (process.argv.includes('--prove')) {
  const original = fs.readFileSync(ORIGINAL, 'utf8');

  // Each entry is [name, from, to]. The name says which assertion must
  // report it, so a defect that goes uncaught points at a missing test.
  const defects = [
    ['md em-dash rule never fires  (-> "em dash in markdown")', 'l.includes(EM_DASH) &&', 'false &&'],
    ['code em-dash rule never fires  (-> "em dash in a code comment")', 'it.text.includes(EM_DASH) &&', 'false &&'],
    ['sentence limit raised to 26 words  (-> "26 words is a hit")', 'const MAX_WORDS = 25;', 'const MAX_WORDS = 26;'],
    ['sentence limit raised to 250  (-> "30 words is a hit")', 'const MAX_WORDS = 25;', 'const MAX_WORDS = 250;'],
    ['sentence limit lowered to 24  (-> "25 words passes")', 'const MAX_WORDS = 25;', 'const MAX_WORDS = 24;'],
    ['cluster needs five  (-> "four in a row is a hit")', 'const CLUSTER_MIN = 4;', 'const CLUSTER_MIN = 5;'],
    ['cluster needs three  (-> "three in a row passes")', 'const CLUSTER_MIN = 4;', 'const CLUSTER_MIN = 3;'],
    ['sentence-initial capital counts  (-> "the first word does not count")', '(caps && i > 0)', 'caps'],
    ['cleft rule never fires  (-> "cleft is what")', 'const CLEFT_RE = /\\b(?:is|are|was|were)\\s+what\\b/i;', 'const CLEFT_RE = /\\bnever-matches-this\\b/i;'],
    ['leverage dropped from the list  (-> "banned word leverage")', 'leverag(?:e|es|ed|ing)|', ''],
    ['utilize dropped from the list  (-> "banned word utilize")', 'utiliz(?:e|es|ed|ing|ation)|', ''],
    ['journey dropped from the list  (-> "banned word journey")', 'journeys?|', ''],
    ['code spans count by their inner words  (-> "a code span is one word")', 'codes.push(m[0]);', "codes.push(m[0]); return m[0].replace(/`/g, '');"],
    ['fenced blocks are read as prose  (-> "a fenced block is skipped")', 'if (fence) continue;', ''],
    ['scope ignored, old debt blocks  (-> "old debt on untouched lines passes")', 'if (!inScope(s.line, s.endLine)) continue;', ''],
    ['scope looks at the first line only  (-> "an edit on a later line of a wrapped sentence")', 'for (let l = a; l <= b; l++) if (scope.has(l)) return true;', 'for (let l = a; l <= a; l++) if (scope.has(l)) return true;'],
    ['staged mode reads the working tree  (-> "the check reads the index")', "if (mode === 'staged' || mode === 'wide') diff(['--cached'], [], index);", "if (mode === 'staged' || mode === 'wide') diff(['--cached'], [], tree);"],
    ['exit code is always zero  (-> "a hit exits 1")', 'return { code: total ? 1 : 0,', 'return { code: 0,'],
    ['exempt files are read  (-> "exempt prefix is skipped")', "const EXEMPT_PREFIXES = ['shared-folder-communications-protocol/'];", 'const EXEMPT_PREFIXES = [];'],
    ['the skip is silent  (-> "the summary names the skipped files")', 'exempt && exempt.length ?', 'false ?'],
    ['code headers are not read  (-> "a long sentence in a script header")', 'item.header = header && !item.code;', 'item.header = false;'],
    ['whole code files are read  (-> "a body comment is not checked")', 'item.header = header && !item.code;', 'item.header = !item.code;'],
    ['hook matches quoted text  (-> "a git commit after a quoted semicolon is ignored")', "return { masked: out.join(''), open: q !== null };", 'return { masked: s, open: false };'],
    ['hook matches commit-tree  (-> "git commit-tree is not a commit")', "commit(?![\\\\w-])',", "commit\\\\b',"],
    ['hook never denies  (-> "a bad commit is denied")', "permissionDecision: 'deny',", "permissionDecision: 'allow',"],
    ['hook ignores the bash override  (-> "the bash override lets it through")', 'OVERRIDE_BASH_RE.test(cmd) ||', ''],
    ['hook ignores the PowerShell override  (-> "the PowerShell override lets it through")', 'OVERRIDE_PWSH_RE.test(cmd) ||', ''],
    ['hook ignores the process env override  (-> "the process env override lets it through")', " || process.env.CLAUDE_DOC_STYLE_OVERRIDE === '1';", ';'],
    ['hook misses commit -a  (-> "commit -am checks the working tree")', "if (ch === 'a') out.all = true;", ''],
    ['hook misses commit --all  (-> "commit --all checks the working tree")', "if (a === '--all') out.all = true;", "if (a === '--all') out.all = false;"],
    ['fail-open leaves no trace  (-> "a git failure is logged")', "log(slug, 'git commit', why);", ''],
    ['a block leaves no trace  (-> "a block is logged")', "log('blocked', 'git commit',", "void ('blocked', 'git commit',"],

    // The second round. An independent review found that the first suite
    // shared its author's picture of the hook. Every case staged first, in
    // the same repo. These defects put those blind spots back.
    ['the hook reads only the index when the call stages first  (-> "add and commit in one call is denied")', "const wide = staged !== 'none' || own.length > 0 || takes.unsure;", 'const wide = own.length > 0 || takes.unsure;'],
    ['a commit that names a path is read as an index commit  (-> "a commit that names a path is denied")', "const wide = staged !== 'none' || own.length > 0 || takes.unsure;", "const wide = staged !== 'none' || takes.unsure;"],
    ['untracked files are not read  (-> "a new file added and committed in one call is denied")', "for (const file of others.split('\\0').filter(Boolean)) take(file, null, tree(file));", ''],
    ['commit -a reads untracked files  (-> "commit -a does not read an untracked file")', "mode: wide ? 'wide' : takes.all ? 'worktree' : 'staged',", "mode: wide || takes.all ? 'wide' : 'staged',"],
    ['the paths of git add are ignored  (-> "a path-limited add ignores an unrelated bad file")', 'paths: wide && !everything ? [...paths, ...own] : [],', 'paths: [],'],
    ['a read-only git command makes the check wide  (-> "git status before a commit keeps the index check")', '} else if (verb && !READ_ONLY.has(verb)) {', '} else if (verb) {'],
    ['cd is not followed  (-> "a commit after cd into another worktree is denied")', 'dir = target === undefined ? null : toDir(dir, target);', 'dir = cwd;'],
    ['git -C is not followed  (-> "git -C into another worktree is denied")', "if (w[i] === '-C') at = toDir(at, w[++i] || '');", "if (w[i] === '-C') i++;"],
    ['an unknown folder is allowed unread  (-> "an unknown folder is read as the folder of the session")', 'for (const p of plans) {', 'for (const p of plans.filter((x) => x.dir !== null)) {'],
    ['an assumed folder is logged as clean  (-> "an assumed folder is logged as assumed, not as clean")', "const outcome = assumed ? 'open:dir-assumed' :", "const outcome = false ? 'open:dir-assumed' :"],
    ['the index check is cut down to the added paths  (-> "a staged bad file is read when the call adds another path")', "if (mode === 'staged' || mode === 'wide') diff(['--cached'], [], index);", "if (mode === 'staged' || mode === 'wide') diff(['--cached'], limit, index);"],
    ['a path is not resolved in its folder  (-> "a path given to git -C add is resolved in that folder")', "return p === null ? null : p.replace(/\\\\/g, '/');", 'return p === null ? null : t;'],
    ['a brace is not a command start  (-> "the PowerShell if-block commit is denied")', "'(?:^|[;&|(){}", "'(?:^|[;&|"],
    ['a keyword is not a command start  (-> "a commit in an else branch matches")', 'then|else|elif|do|if|while|until|command|exec|time|env|sudo|nohup', 'never-a-word'],
    ['git.exe is not git  (-> "git.exe commit matches")', "const GIT = 'git(?:\\\\.exe)?';", "const GIT = 'git';"],
    ['an unclosed quote hides the commit  (-> "an unclosed quote does not hide the commit")', "const text = info.open || info.masked.includes('<<') ? cmd : info.masked;", 'const text = info.masked;'],
    ['a backslash escapes a single quote  (-> "a single-quoted path that ends in a backslash closes its quote")', "if (c === q && !(q === '\"' && s[i - 1] === '\\\\')) q = null;", "if (c === q && s[i - 1] !== '\\\\') q = null;"],
    ['zero files is logged as clean  (-> "an empty index is logged as nothing read, not as clean")', "const outcome = assumed ? 'open:dir-assumed' : result.read ? 'clean' : 'open:nothing-read';", "const outcome = assumed ? 'open:dir-assumed' : 'clean';"],
    ['zero files is called clean  (-> "a commit of other file types says nothing read")', ": read.size ? 'clean' : 'nothing read';", ": 'clean';"],
    ['the unread files are not named  (-> "the summary names the files it did not read")', 'const rest = notRead.size ?', 'const rest = false ?'],
    ['more folders are exempt  (-> "files under claude, templates and scripts are read")', "const EXEMPT_PREFIXES = ['shared-folder-communications-protocol/'];", "const EXEMPT_PREFIXES = ['shared-folder-communications-protocol/', 'claude/', 'templates/', 'scripts/'];"],
    ['blockquotes are skipped  (-> "a blockquote is read")', "const body = t.replace(/^\\s*>\\s?/, '').trim();", "if (/^\\s*>/.test(t)) continue;\n    const body = t.trim();"],
    ['the diff prefix is not pinned  (-> "a custom diff prefix does not blind the check")', "'--src-prefix=a/', '--dst-prefix=b/', ", ''],
    ['--base diffs HEAD against itself  (-> "--base finds a bad sentence on the branch")', "diff([arg + '...HEAD'], [], tree);", "diff(['HEAD...HEAD'], [], tree);"],
    ['--base reads no files  (-> "--base finds a bad sentence on the branch")', "if (mode === 'base') {", "if (mode === 'never') {"],
    ['an empty --base diff passes  (-> "--base with an empty diff is a usage error")', "if (o.mode === 'base' && !found.changed) {", 'if (false) {'],
  ];

  // The suite spends its time starting processes, so the defects run in
  // parallel. Each run uses its own temporary files.
  const { spawn } = require('child_process');
  const runOne = ([name, from, to], i) =>
    new Promise((resolve) => {
      if (!original.includes(from)) return resolve({ name, state: 'unproven' });
      const tmp = path.join(os.tmpdir(), `doc-style-defect-${process.pid}-${i}.js`);
      fs.writeFileSync(tmp, original.replace(from, () => to));
      const child = spawn(process.execPath, [__filename], {
        env: { ...process.env, DOC_STYLE_MODULE: tmp },
        stdio: 'ignore',
      });
      child.on('close', (code) => {
        fs.unlinkSync(tmp);
        resolve({ name, state: code === 0 ? 'missed' : 'caught' });
      });
    });
  const results = new Array(defects.length);
  let next = 0;
  const worker = async () => {
    while (next < defects.length) {
      const i = next++;
      results[i] = await runOne(defects[i], i);
    }
  };
  Promise.all(Array.from({ length: 6 }, worker)).then(() => {
    let proven = 0;
    for (const r of results) {
      if (r.state === 'unproven') console.log('  UNPROVEN, could not inject: ' + r.name);
      else if (r.state === 'missed') console.log('  NOT CAUGHT, the suite stayed green with this defect: ' + r.name);
      else {
        proven++;
        console.log('  caught, ' + r.name);
      }
    }
    console.log('');
    console.log(proven + '/' + defects.length + ' injected defects caught');
    process.exit(proven === defects.length ? 0 : 1);
  });
} else {
  main();
}

function main() {

const { lintFile, parseAdded, maskQuoted, COMMIT_RE } = require(SRC);

let pass = 0;
let fail = 0;
function ok(name, cond, detail) {
  if (cond) {
    pass++;
    console.log('  ok   , ' + name);
  } else {
    fail++;
    console.log('  FAIL , ' + name + (detail ? '\n         ' + detail : ''));
  }
}

const EM = String.fromCharCode(0x2014);
// n plain words, first one capitalised, ending in a full stop.
const sentence = (n) => 'Alpha ' + Array(n - 1).fill('item').join(' ') + '.';
const lint = (file, text, scope, rules) => lintFile(file, text, scope || null, rules || null);
const rulesOf = (r) => r.hits.map((h) => h.rule);
const has = (r, rule) => rulesOf(r).includes(rule);

console.log('control');
const cleanDoc = '# Title\n\nA short line. Another short line.\n\n- A list item.\n- Another list item.\n';
const cleanResult = lint('a.md', cleanDoc);
ok('a clean file passes and sentences were read', cleanResult.hits.length === 0 && cleanResult.count === 4, JSON.stringify(cleanResult.hits));
ok('the em dash fixture is found, so the clean pass means something', has(lint('a.md', 'a ' + EM + ' b\n'), 'em-dash'));

console.log('em-dash');
ok('em dash in markdown', has(lint('a.md', 'One ' + EM + ' two.\n'), 'em-dash'));
ok('em dash inside a fenced block still counts', has(lint('a.md', '```\nx ' + EM + ' y\n```\n'), 'em-dash'));
ok('em dash in a code comment', has(lint('a.js', '// a ' + EM + ' b\nconst x = 1;\n'), 'em-dash'));
ok('em dash in a comment far below the header', has(lint('a.sh', '# head\n\necho hi\n# a ' + EM + ' b\n'), 'em-dash'));
ok('em dash in a code string is data, not prose', !has(lint('a.js', "const x = '" + EM + "';\n"), 'em-dash'));

console.log('long-sentence');
ok('26 words is a hit', has(lint('a.md', sentence(26) + '\n'), 'long-sentence'));
ok('30 words is a hit', has(lint('a.md', sentence(30) + '\n'), 'long-sentence'));
ok('25 words passes', !has(lint('a.md', sentence(25) + '\n'), 'long-sentence'));
ok('the hit names its line', lint('a.md', 'Fine.\n\n' + sentence(30) + '\n').hits[0].line === 3);
ok('a wrapped sentence is one sentence', has(lint('a.md', 'Alpha ' + Array(13).fill('item').join(' ') + '\n' + Array(13).fill('item').join(' ') + '.\n'), 'long-sentence'));
ok('two short sentences on one line pass', !has(lint('a.md', sentence(15) + ' ' + sentence(15) + '\n'), 'long-sentence'));
ok('each list item is its own sentence', !has(lint('a.md', '- ' + sentence(15) + '\n- ' + sentence(15) + '\n'), 'long-sentence'));
ok('e.g. does not end a sentence', has(lint('a.md', 'Use it, e.g. ' + sentence(24) + '\n'), 'long-sentence'));
ok('a code span is one word', !has(lint('a.md', 'Run `' + Array(30).fill('item').join(' ') + '` now.\n'), 'long-sentence'));
ok('a fenced block is skipped', !has(lint('a.md', '```\n' + sentence(40) + '\n```\n'), 'long-sentence'));
ok('a table row is skipped', !has(lint('a.md', '| ' + sentence(40) + ' |\n'), 'long-sentence'));
ok('a heading is skipped', !has(lint('a.md', '# ' + sentence(40) + '\n'), 'long-sentence'));
ok('a blockquote is read', has(lint('a.md', '> ' + sentence(30) + '\n'), 'long-sentence'));
ok('a link counts its text, not its address', !has(lint('a.md', 'See [the page](https://example.com/' + 'x'.repeat(200) + ') for more.\n'), 'long-sentence'));
ok('CRLF text gives the same answer', has(lint('a.md', (sentence(30) + '\n').replace(/\n/g, '\r\n')), 'long-sentence'));

console.log('noun-cluster');
ok('four in a row is a hit', has(lint('a.md', 'Use the Alpha Beta Gamma Delta tool.\n'), 'noun-cluster'));
ok('three in a row passes', !has(lint('a.md', 'Use the Alpha Beta Gamma tool.\n'), 'noun-cluster'));
ok('the first word does not count', !has(lint('a.md', 'Alpha Beta Gamma Delta tool.\n'), 'noun-cluster'));
ok('hyphen-joined words count', has(lint('a.md', 'Check the guard-path review-line check-in mutation-clock now.\n'), 'noun-cluster'));
ok('commas break a run', !has(lint('a.md', 'Use Alpha, Beta, Gamma, Delta together.\n'), 'noun-cluster'));

console.log('cleft');
ok('cleft is what', has(lint('a.md', 'That is what made the failure.\n'), 'cleft'));
ok('cleft was what', has(lint('a.md', 'The gap was what let it through.\n'), 'cleft'));
ok('a plain sentence passes', !has(lint('a.md', 'That made the failure.\n'), 'cleft'));

console.log('banned-word');
for (const w of ['leverage', 'leveraged', 'robust', 'seamless', 'delve', 'holistic', 'empower', 'streamline', 'utilize', 'utilizes', 'comprehensive', 'journey', 'landscape']) {
  ok('banned word ' + w, has(lint('a.md', 'We ' + w + ' it here.\n'), 'banned-word'));
}
ok('a banned word inside a code span passes', !has(lint('a.md', 'Call `leverage` here.\n'), 'banned-word'));
ok('a word that only contains one passes', !has(lint('a.md', 'The lever moved the landscaper.\n'), 'banned-word'));

console.log('code headers');
const longHeader = '#!/usr/bin/env node\n// ' + sentence(30) + '\n\nconst x = 1;\n';
ok('a long sentence in a script header', has(lint('a.js', longHeader), 'long-sentence'));
ok('the hit lands on the right line', lint('a.js', longHeader).hits[0].line === 2);
ok('a long sentence in a body comment is not checked', !has(lint('a.js', '// Short.\n\nconst x = 1;\n// ' + sentence(30) + '\n'), 'long-sentence'));
ok('a shell header is read', has(lint('a.sh', '#!/usr/bin/env bash\n# ' + sentence(30) + '\n\necho hi\n'), 'long-sentence'));
ok('a PowerShell help block is read', has(lint('a.ps1', '<#\n.SYNOPSIS\n' + sentence(30) + '\n#>\nparam()\n'), 'long-sentence'));
ok('a PowerShell .EXAMPLE is skipped', !has(lint('a.ps1', '<#\n.SYNOPSIS\nShort.\n.EXAMPLE\n' + sentence(40) + '\n#>\nparam()\n'), 'long-sentence'));
ok('an indented usage line after a colon is code', !has(lint('a.js', '// Usage:\n//   ' + sentence(40) + '\n\nconst x = 1;\n'), 'long-sentence'));
ok('an unsupported file type is skipped', lint('a.txt', sentence(40)).skipped === true);

console.log('scope');
const debt = 'Intro line.\n\n' + 'Alpha ' + Array(14).fill('item').join(' ') + '\n' + Array(14).fill('item').join(' ') + '.\n\nTail line.\n';
ok('old debt on untouched lines passes', lint('a.md', debt, new Set([7])).hits.length === 0);
ok('an edit on the first line of a wrapped sentence is flagged', has(lint('a.md', debt, new Set([3])), 'long-sentence'));
ok('an edit on a later line of a wrapped sentence is flagged', has(lint('a.md', debt, new Set([4])), 'long-sentence'));
ok('no scope means every line', has(lint('a.md', debt, null), 'long-sentence'));
ok('--rules limits what runs', lint('a.md', 'x ' + EM + ' y. ' + sentence(30) + '\n', null, ['em-dash']).hits.every((h) => h.rule === 'em-dash'));

const diff = [
  'diff --git a/README.md b/README.md',
  'index 111..222 100644',
  '--- a/README.md',
  '+++ b/README.md',
  '@@ -3,0 +4,2 @@ context',
  '+one',
  '+two',
  '@@ -10 +12 @@',
  '+three',
  'diff --git a/new.md b/new.md',
  'new file mode 100644',
  '--- /dev/null',
  '+++ b/new.md',
  '@@ -0,0 +1,3 @@',
  '+a',
  '+++ not a header',
  '+c',
].join('\n');
const added = parseAdded(diff);
ok('diff: hunk with a count', [...added.get('README.md')].join() === '4,5,12');
ok('diff: a new file counts every line', [...added.get('new.md')].join() === '1,2,3');

console.log('the commit pattern');
ok('plain git commit matches', COMMIT_RE.test(maskQuoted('git commit -m "x"')));
ok('after cd and && matches', COMMIT_RE.test(maskQuoted('cd foo && git commit -m x')));
ok('git -C dir commit matches', COMMIT_RE.test(maskQuoted('git -C some/dir commit -m x')));
ok('a quoted git commit is ignored', !COMMIT_RE.test(maskQuoted('echo "git commit -m x"')));
ok('a quoted boundary does not start a command', !COMMIT_RE.test(maskQuoted('echo "done; git commit -m x"')));
ok('git log --grep is ignored', !COMMIT_RE.test(maskQuoted('git log --grep="git commit"')));
ok('git commit-tree is not a commit', !COMMIT_RE.test(maskQuoted('git commit-tree abc123')));
ok('a leading variable assignment matches', COMMIT_RE.test(maskQuoted('GIT_AUTHOR_DATE=x git commit -m y')));
ok('a PowerShell if-block commit matches', COMMIT_RE.test(maskQuoted('git add a.md; if ($?) { git commit -m "x" }')));
ok('a commit in an else branch matches', COMMIT_RE.test(maskQuoted('if git diff --cached --quiet; then echo none; else git commit -m x; fi')));
ok('a commit in a subshell matches', COMMIT_RE.test(maskQuoted('(git commit -m x)')));
ok('command git commit matches', COMMIT_RE.test(maskQuoted('command git commit -m x')));
ok('env with a variable matches', COMMIT_RE.test(maskQuoted('env X=y git commit -m x')));
ok('git.exe commit matches', COMMIT_RE.test(maskQuoted('git.exe commit -m x')));
ok('a quoted -c value with a space matches', COMMIT_RE.test(maskQuoted('git -c "user.name=A B" commit -m x')));
ok('a single-quoted path that ends in a backslash closes its quote', COMMIT_RE.test(maskQuoted("Set-Location 'C:\\repo\\'; git commit -m x")));
ok('the bare words after echo are ignored', !COMMIT_RE.test(maskQuoted('echo git commit')));

// ---------------------------------------------------------------------------
// A temporary repo for the scope rule and the commit gate, end to end.
// ---------------------------------------------------------------------------

const env = { ...process.env };
for (const k of Object.keys(env)) if (k.startsWith('GIT_') || k === 'CLAUDE_DOC_STYLE_OVERRIDE' || k === 'CLAUDE_PROJECT_DIR') delete env[k];

const git = (cwd, ...args) => spawnSync('git', args, { cwd, encoding: 'utf8', env });
const cli = (cwd, ...args) => spawnSync(process.execPath, [SRC, ...args], { cwd, encoding: 'utf8', env });
const hook = (cwd, command, extraEnv) =>
  spawnSync(process.execPath, [SRC, '--hook'], {
    cwd,
    input: JSON.stringify({ tool_name: 'Bash', tool_input: { command }, cwd }),
    encoding: 'utf8',
    env: { ...env, CLAUDE_PROJECT_DIR: cwd, ...(extraEnv || {}) },
  });
const decision = (r) => {
  try {
    return JSON.parse(r.stdout).hookSpecificOutput.permissionDecision;
  } catch {
    return null;
  }
};
const lastLine = (r) => r.stdout.trim().split('\n').pop();

const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'doc-style-'));
const write = (rel, text) => {
  fs.mkdirSync(path.dirname(path.join(repo, rel)), { recursive: true });
  fs.writeFileSync(path.join(repo, rel), text);
};
git(repo, 'init', '-q');
git(repo, 'config', 'user.email', 'selftest@example.invalid');
git(repo, 'config', 'user.name', 'selftest');
git(repo, 'config', 'core.autocrlf', 'false');
git(repo, 'config', 'commit.gpgsign', 'false');

const wrappedDebt = 'Alpha ' + Array(14).fill('item').join(' ') + '\n' + Array(14).fill('item').join(' ') + '.\n';
const baseline = '# Title\n\nA short opening line.\n\n' + wrappedDebt + '\nA short closing line.\n';
write('README.md', baseline);
git(repo, 'add', '-A');
git(repo, 'commit', '-q', '-m', 'baseline');
const reset = () => {
  git(repo, 'reset', '-q', '--hard');
  git(repo, 'clean', '-fdq');
};

console.log('staged check');
write('README.md', baseline + '\nA new clean line.\n');
git(repo, 'add', 'README.md');
let r = cli(repo, '--staged');
ok('a clean edit passes although old debt sits in the file', r.status === 0, r.stdout + r.stderr);
ok('the summary says clean and counts sentences', /^doc-style-check: clean \(1 files, \d+ sentences checked/.test(lastLine(r)), lastLine(r));
reset();

write('README.md', baseline + '\n' + sentence(30) + '\n');
git(repo, 'add', 'README.md');
r = cli(repo, '--staged');
ok('a 30-word sentence exits 1', r.status === 1, r.stdout);
ok('the hit names file, line and rule', /^README\.md:10: \[long-sentence\] 30 words, limit 25$/m.test(r.stdout), r.stdout);
ok('the offending sentence is printed', r.stdout.includes('Alpha item item'), r.stdout);
ok('the summary is the last line', /^doc-style-check: 1 hit\(s\) in 1 file\(s\)/.test(lastLine(r)), lastLine(r));

write('README.md', baseline + '\nA new clean line.\n');
r = cli(repo, '--staged');
ok('the check reads the index, not the working tree', r.status === 1, r.stdout);
reset();

write('README.md', baseline.replace('item item item', 'item edited item'));
git(repo, 'add', 'README.md');
r = cli(repo, '--staged');
ok('an edit on a later line of a wrapped sentence is flagged', r.status === 1 && r.stdout.includes('[long-sentence]'), r.stdout);
reset();

write('shared-folder-communications-protocol/README.md', sentence(40) + '\n');
git(repo, 'add', '-A');
r = cli(repo, '--staged');
ok('exempt prefix is skipped', r.status === 0, r.stdout);
ok('the summary names the skipped files', lastLine(r).includes('skipped as exempt: shared-folder-communications-protocol/README.md'), lastLine(r));
reset();

write('tool.sh', '#!/usr/bin/env bash\n# ' + sentence(30) + '\n\necho hi\n');
git(repo, 'add', '-A');
r = cli(repo, '--staged');
ok('a long sentence in a script header is caught at line 2', r.status === 1 && /^tool\.sh:2: \[long-sentence\]/m.test(r.stdout), r.stdout);
reset();

r = cli(repo);
ok('no mode and no path is a usage error', r.status === 2, r.stdout + r.stderr);
r = cli(repo, '--rules', 'nonsense', '--staged');
ok('an unknown rule is a usage error', r.status === 2, r.stdout + r.stderr);

console.log('commit gate');
write('README.md', baseline + '\n' + sentence(30) + '\n');
git(repo, 'add', 'README.md');
r = hook(repo, 'git commit -m "docs: add a line"');
ok('a bad staged commit is denied', decision(r) === 'deny', r.stdout + r.stderr);
ok('the denial carries the check output', /README\.md:10: \[long-sentence\]/.test(r.stdout), r.stdout);
ok('the denial names the override', r.stdout.includes('CLAUDE_DOC_STYLE_OVERRIDE'), r.stdout);
const logPath = path.join(repo, '.claude', 'state', 'doc-style-gate.log');
const logText = () => (fs.existsSync(logPath) ? fs.readFileSync(logPath, 'utf8') : '');
ok('a block is logged', /\|doc-style-gate\|blocked\|/.test(logText()), logText());

r = hook(repo, 'echo "git commit -m x"');
ok('a quoted git commit is ignored', r.stdout === '' && r.status === 0, r.stdout);
r = hook(repo, 'echo "done; git commit -m x"');
ok('a git commit after a quoted semicolon is ignored', r.stdout === '' && r.status === 0, r.stdout);
r = hook(repo, 'git status');
ok('another git command is ignored', r.stdout === '' && r.status === 0, r.stdout);
r = hook(repo, 'git commit-tree abc123');
ok('git commit-tree is ignored', r.stdout === '' && r.status === 0, r.stdout);
r = hook(repo, 'cd ' + repo.replace(/\\/g, '/') + ' && git commit -m x');
ok('git commit after cd is denied', decision(r) === 'deny', r.stdout + r.stderr);

r = hook(repo, 'export CLAUDE_DOC_STYLE_OVERRIDE=1; git commit -m x');
ok('the bash override lets it through', decision(r) !== 'deny' && r.status === 0 && r.stdout.includes('OVERRIDE'), r.stdout + r.stderr);
r = hook(repo, "$env:CLAUDE_DOC_STYLE_OVERRIDE='1'; git commit -m x");
ok('the PowerShell override lets it through', decision(r) !== 'deny' && r.status === 0, r.stdout + r.stderr);
ok('an override is logged', /\|doc-style-gate\|override\|/.test(logText()), logText());
r = hook(repo, 'CLAUDE_DOC_STYLE_OVERRIDE=1 git commit -m x');
ok('an inline override prefix still reaches the gate and is logged', decision(r) !== 'deny' && r.stdout.includes('OVERRIDE'), r.stdout + r.stderr);
r = hook(repo, 'GIT_AUTHOR_NAME=someone git commit -m x');
ok('a leading variable assignment does not bypass the gate', decision(r) === 'deny', r.stdout + r.stderr);
r = hook(repo, 'git commit -m x', { CLAUDE_DOC_STYLE_OVERRIDE: '1' });
ok('the process env override lets it through', decision(r) !== 'deny' && r.stdout.includes('OVERRIDE'), r.stdout + r.stderr);
reset();

// The rows a call adds to the log, so one test cannot pass on an older row.
const rowsOf = (fn) => {
  const before = logText().length;
  const result = fn();
  return { r: result, rows: logText().slice(before) };
};

let t = rowsOf(() => hook(repo, 'git commit -m x'));
ok('an empty index is allowed', t.r.stdout === '' && t.r.status === 0, t.r.stdout);
ok('an empty index is logged as nothing read, not as clean', /\|open:nothing-read\|/.test(t.rows) && !/\|clean\|/.test(t.rows), t.rows);

write('README.md', baseline + '\nA new clean line.\n');
git(repo, 'add', 'README.md');
t = rowsOf(() => hook(repo, 'git commit -m x'));
ok('a clean staged commit is allowed', t.r.stdout === '' && t.r.status === 0, t.r.stdout);
ok('a clean pass is logged with the count of files read', /\|doc-style-gate\|clean\|git commit\|doc-style-check: clean \(1 files/.test(t.rows), t.rows);
reset();

write('README.md', baseline + '\n' + sentence(30) + '\n');
r = hook(repo, 'git commit -m x');
ok('an unstaged edit is not checked by a plain commit', r.stdout === '', r.stdout);
r = hook(repo, 'git commit -am x');
ok('commit -am checks the working tree', decision(r) === 'deny', r.stdout + r.stderr);
r = hook(repo, 'git commit --all -m x');
ok('commit --all checks the working tree', decision(r) === 'deny', r.stdout + r.stderr);

// The hook runs before the command. A call that stages and commits in one
// go shows it an index that does not hold the change yet. The bad line in
// README.md is still unstaged here.
console.log('one call that stages and commits');
r = hook(repo, 'git add README.md && git commit -m x');
ok('add and commit in one call is denied', decision(r) === 'deny', r.stdout + r.stderr);
ok('the denial says how to split the call', r.stdout.includes('stage in one call and commit in the next'), r.stdout);
r = hook(repo, 'git add -A && git commit -m x');
ok('add -A and commit in one call is denied', decision(r) === 'deny', r.stdout + r.stderr);
r = hook(repo, 'git add .; git commit -m x');
ok('add . and commit in one call is denied', decision(r) === 'deny', r.stdout + r.stderr);
r = hook(repo, 'git add README.md; if ($?) { git commit -m "x" }');
ok('the PowerShell if-block commit is denied', decision(r) === 'deny', r.stdout + r.stderr);
r = hook(repo, 'git commit -m x README.md');
ok('a commit that names a path is denied', decision(r) === 'deny', r.stdout + r.stderr);
r = hook(repo, 'git commit -m x -- README.md');
ok('a commit that names a path after -- is denied', decision(r) === 'deny', r.stdout + r.stderr);
r = hook(repo, "cat <<'EOF' > note.txt\nit's a note\nEOF\ngit add README.md\ngit commit -m x");
ok('a commit after a here-document with an apostrophe is denied', decision(r) === 'deny', r.stdout + r.stderr);
r = hook(repo, "echo it's late; git commit -am x");
ok('an unclosed quote does not hide the commit', decision(r) === 'deny', r.stdout + r.stderr);
r = hook(repo, 'git stash pop && git commit -m x');
ok('another staging route makes the check read every change', decision(r) === 'deny', r.stdout + r.stderr);
reset();

write('NEW.md', sentence(30) + '\n');
r = hook(repo, 'git add NEW.md && git commit -m x');
ok('a new file added and committed in one call is denied', decision(r) === 'deny', r.stdout + r.stderr);
r = hook(repo, 'git commit -am x');
ok('commit -a does not read an untracked file', r.stdout === '' && r.status === 0, r.stdout);
reset();

// Precision. The gate must not block on text the commit leaves out.
write('README.md', baseline + '\nA new clean line.\n');
write('OTHER.md', sentence(30) + '\n');
r = hook(repo, 'git add README.md && git commit -m x');
ok('a path-limited add ignores an unrelated bad file', r.stdout === '' && r.status === 0, r.stdout);
git(repo, 'add', 'README.md');
r = hook(repo, 'git status && git commit -m x');
ok('git status before a commit keeps the index check', r.stdout === '' && r.status === 0, r.stdout);
r = hook(repo, 'git commit -m x && git push');
ok('a push after the commit keeps the index check', r.stdout === '' && r.status === 0, r.stdout);
reset();

// Two properties the second review found without a test. A wide check must
// read the whole index, with no cut to the paths of the add. And a path is
// relative to the folder where its git add runs.
write('README.md', baseline + '\n' + sentence(30) + '\n');
git(repo, 'add', 'README.md');
write('docs/a.md', 'A short clean line.\n');
r = hook(repo, 'git add docs/a.md && git commit -m x');
ok('a staged bad file is read when the call adds another path', decision(r) === 'deny', r.stdout + r.stderr);
reset();
write('docs/a.md', sentence(30) + '\n');
r = hook(repo, 'git -C docs add a.md && git commit -m x');
ok('a path given to git -C add is resolved in that folder', decision(r) === 'deny', r.stdout + r.stderr);
write('README.md', baseline + '\n' + sentence(30) + '\n');
write('docs/a.md', 'A short clean line.\n');
r = hook(repo, 'cd docs && git add ../README.md && git commit -m x');
ok('a path that climbs out of the folder of cd is resolved', decision(r) === 'deny', r.stdout + r.stderr);
reset();

// A second worktree. The session sits in the first, the commit runs in the
// second, and only the second holds the bad line.
console.log('the folder of the commit');
const side = fs.mkdtempSync(path.join(os.tmpdir(), 'doc-style-side-'));
git(repo, 'worktree', 'add', '-q', side, '-b', 'side');
fs.writeFileSync(path.join(side, 'README.md'), baseline + '\n' + sentence(30) + '\n');
git(side, 'add', 'README.md');
const sideSlash = side.replace(/\\/g, '/');
r = hook(side, 'git commit -m x');
ok('control: the commit is denied from inside the second worktree', decision(r) === 'deny', r.stdout + r.stderr);
r = hook(repo, 'git commit -m x');
ok('control: the first worktree has nothing staged', r.stdout === '' && r.status === 0, r.stdout);
r = hook(repo, 'cd "' + sideSlash + '" && git commit -m x');
ok('a commit after cd into another worktree is denied', decision(r) === 'deny', r.stdout + r.stderr);
r = hook(repo, 'git -C "' + sideSlash + '" commit -m x');
ok('git -C into another worktree is denied', decision(r) === 'deny', r.stdout + r.stderr);
r = hook(repo, "Set-Location '" + side + path.sep + "'; git commit -m 'x'");
ok('Set-Location with a trailing separator is followed', decision(r) === 'deny', r.stdout + r.stderr);
r = hook(repo, 'pushd "' + sideSlash + '"; git commit -m x');
ok('pushd is followed', decision(r) === 'deny', r.stdout + r.stderr);
// Git Bash writes drive C as /c. Other systems have one form only.
const shellForm = process.platform === 'win32' ? '/' + sideSlash[0].toLowerCase() + sideSlash.slice(2) : sideSlash;
r = hook(repo, 'cd ' + shellForm + ' && git commit -m x');
ok('a path in the form the shell writes is followed', decision(r) === 'deny', r.stdout + r.stderr);
// A folder the hook cannot resolve. The hook must read the folder of the
// session then, and never allow the commit unread. A second review found
// that the first cut of the fix allowed it. In these cases the session sits
// in the second worktree, which holds the bad line.
r = hook(side, 'cd "$PWD" && git commit -m x');
ok('an unknown folder is read as the folder of the session', decision(r) === 'deny', r.stdout + r.stderr);
ok('the denial says the folder was assumed', r.stdout.includes('could not tell which folder'), r.stdout);
r = hook(side, 'cd "$(git rev-parse --show-toplevel)" && git commit -m x');
ok('a command substitution as the folder is read the same way', decision(r) === 'deny', r.stdout + r.stderr);
r = hook(side, "git commit -F - <<'EOF'\nfix: docs\n\ncd into the folder first.\nThen git commit again.\nEOF");
ok('prose in a here-document message cannot switch the gate off', decision(r) === 'deny', r.stdout + r.stderr);
t = rowsOf(() => hook(repo, 'cd "$SOMEWHERE" && git commit -m x'));
ok('an assumed folder with no hit is allowed', t.r.stdout === '' && t.r.status === 0, t.r.stdout + t.r.stderr);
ok('an assumed folder is logged as assumed, not as clean', /\|open:dir-assumed\|/.test(t.rows) && !/\|clean\|/.test(t.rows), t.rows);
t = rowsOf(() => hook(repo, 'cd "' + sideSlash + '" && popd && git commit -m x'));
ok('popd makes the folder unknown', /\|open:dir-assumed\|/.test(t.rows), t.rows);
git(repo, 'worktree', 'remove', '--force', side);

console.log('what the check did not read');
write('conf.yml', 'key: ' + sentence(40) + '\n');
git(repo, 'add', 'conf.yml');
r = cli(repo, '--staged');
ok('a commit of other file types says nothing read', r.status === 0 && /^doc-style-check: nothing read \(0 files/.test(lastLine(r)), lastLine(r));
ok('the summary names the files it did not read', lastLine(r).includes('not read: conf.yml'), lastLine(r));
reset();
write('notes.txt', sentence(40) + '\n');
r = cli(repo, 'notes.txt');
ok('a path of another file type is named as not read', /nothing read/.test(lastLine(r)) && lastLine(r).includes('not read: notes.txt'), lastLine(r));
reset();

write('claude/notes.md', sentence(30) + '\n');
write('templates/notes.md', sentence(30) + '\n');
write('scripts/tool.sh', '#!/usr/bin/env bash\n# ' + sentence(30) + '\n\necho hi\n');
git(repo, 'add', '-A');
r = cli(repo, '--staged');
ok('files under claude, templates and scripts are read', r.status === 1 && ['claude/notes.md:1', 'templates/notes.md:1', 'scripts/tool.sh:2'].every((p) => r.stdout.includes(p)), r.stdout);
reset();

git(repo, 'config', 'diff.mnemonicPrefix', 'true');
write('README.md', baseline + '\n' + sentence(30) + '\n');
git(repo, 'add', 'README.md');
r = cli(repo, '--staged');
ok('a custom diff prefix does not blind the check', r.status === 1, r.stdout + r.stderr);
git(repo, 'config', '--unset', 'diff.mnemonicPrefix');
reset();

// CI runs --base and nothing else, so this mode needs its own end-to-end
// cases. The first suite had none.
console.log('base mode, the one CI runs');
const first = git(repo, 'rev-parse', 'HEAD').stdout.trim();
write('README.md', baseline + '\n' + sentence(30) + '\n');
git(repo, 'commit', '-q', '-am', 'a bad line');
r = cli(repo, '--base', first);
ok('--base finds a bad sentence on the branch', r.status === 1 && /^README\.md:10: \[long-sentence\]/m.test(r.stdout), r.stdout + r.stderr);
write('README.md', baseline + '\nA new clean line.\n');
git(repo, 'commit', '-q', '-am', 'a clean line');
r = cli(repo, '--base', first);
ok('--base passes a clean change and says a file was read', r.status === 0 && /^doc-style-check: clean \(1 files/.test(lastLine(r)), r.stdout + r.stderr);
r = cli(repo, '--base', 'HEAD');
ok('--base with an empty diff is a usage error', r.status === 2, r.stdout + r.stderr);
r = cli(repo, '--base', 'no-such-ref');
ok('--base with an unknown ref is a usage error', r.status === 2, r.stdout + r.stderr);
write('conf.yml', 'key: value\n');
git(repo, 'add', '-A');
git(repo, 'commit', '-q', '-m', 'yml only');
r = cli(repo, '--base', 'HEAD~1');
ok('--base over other file types passes and says nothing read', r.status === 0 && /nothing read/.test(lastLine(r)) && lastLine(r).includes('not read: conf.yml'), r.stdout + r.stderr);
git(repo, 'rm', '-q', 'conf.yml');
git(repo, 'commit', '-q', '-m', 'delete only');
r = cli(repo, '--base', 'HEAD~1');
ok('--base over a delete-only change is not an empty diff', r.status === 0, r.stdout + r.stderr);
git(repo, 'reset', '-q', '--hard', first);

const nowhere = fs.mkdtempSync(path.join(os.tmpdir(), 'doc-style-nowhere-'));
r = hook(nowhere, 'git commit -m x');
ok('outside a repo it fails open with a visible warning', r.status === 0 && decision(r) !== 'deny' && r.stdout.includes('systemMessage'), r.stdout + r.stderr);
ok('a git failure is logged', /\|open:git-failed\|/.test(fs.existsSync(path.join(nowhere, '.claude', 'state', 'doc-style-gate.log')) ? fs.readFileSync(path.join(nowhere, '.claude', 'state', 'doc-style-gate.log'), 'utf8') : ''));

for (const d of [repo, nowhere]) fs.rmSync(d, { recursive: true, force: true });

console.log('');
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
}

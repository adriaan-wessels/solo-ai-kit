#!/usr/bin/env node
// doc-style-check.js
//
// A deterministic gate for the kit's house style (ASD-STE100 plus Zinsser).
// It prints file:line and the offending sentence for each hit. The exit code
// is 1 on any hit, 0 when the text is clean, and 2 on a usage error. One
// summary line always ends the output.
//
// Five rules, each exact and self-contained:
//
//   em-dash        U+2014 anywhere in a markdown file or a code comment.
//   long-sentence  more than 25 words. Code spans count as one word.
//   noun-cluster   four or more capitalised or hyphen-joined words in a row.
//   cleft          "is what" and its kin, as in "X is what made Y".
//   banned-word    the universal AI markers from the Humanizer skill.
//
// What the check reads. It reads markdown files whole. Every rule except
// em-dash skips fenced blocks, tables, headings and indented code. In code
// files (.js, .sh, .ps1) it reads only the leading comment block, plus
// em-dash in any comment line.
//
// Scope. With explicit paths or --all, the check reads whole files. The
// diff modes read the added lines only. A sentence is in scope when the
// diff adds any of its lines. An edit inside an old long sentence makes you
// fix that sentence. Old debt on untouched lines never blocks a commit.
//
// Usage:
//   node scripts/doc-style-check.js FILE...      whole files
//   node scripts/doc-style-check.js --all        every tracked .md file
//   node scripts/doc-style-check.js --staged     the index, added lines only
//   node scripts/doc-style-check.js --worktree   changes since HEAD
//   node scripts/doc-style-check.js --base REF   changes since REF...HEAD
//   node scripts/doc-style-check.js --hook       PreToolUse adapter, stdin JSON
//
// Add --rules a,b to run only the named rules.
//
// The --hook mode denies a `git commit` when the check fails. It runs before
// the command, so it reads what the commit will take. A plain commit takes
// the index. `git commit -a` takes the tracked changes. A call that stages
// first, as in `git add FILE && git commit`, takes the paths it names. When
// the call stages by another route, the hook reads every change in the
// working tree. `cd` and `git -C` lead the hook to the repo of the commit.
//
// The override is CLAUDE_DOC_STYLE_OVERRIDE=1, set with `export` or `$env:`
// in the same call. Each use leaves a row in
// .claude/state/doc-style-gate.log. CI runs the same check with --base and
// ignores the override.
//
// The summary line names the exempt files and the files of other types that
// the check did not read. With no file read, the summary says "nothing read",
// and the hook logs that row as open:nothing-read. A --base diff with no
// changed file is a usage error.
//
// Named residuals. The check measures sentence shape and ignores meaning, so
// a short bad sentence passes. One call that writes a file and commits it
// shows the hook the old text. When the hook cannot resolve the folder of
// the commit, it reads the folder of the session and logs open:dir-assumed.
// Tone still needs the Humanizer pass, which no pattern can score.

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

// Built from code points so this file never holds these characters itself.
const EM_DASH = String.fromCharCode(0x2014);
const Q_OPEN = String.fromCharCode(0x201c);
const Q_CLOSE = String.fromCharCode(0x201d);
const OPENERS = new RegExp('^["\'' + Q_OPEN + '([]+');
const CLOSERS = new RegExp('["\'' + Q_CLOSE + ')\\]]+$');
const SPLIT_RE = new RegExp(
  '(?<=[.!?]["\'' + Q_CLOSE + ')\\]]*)\\s+(?=["\'' + Q_OPEN + '(\\[]*[A-Z0-9\\u0002])',
  'g'
);

const MAX_WORDS = 25;
const CLUSTER_MIN = 4;
const BANNED_RE =
  /\b(?:leverag(?:e|es|ed|ing)|robust(?:ness)?|seamless(?:ly)?|delv(?:e|es|ed|ing)|holistic(?:ally)?|empower(?:s|ed|ing|ment)?|streamlin(?:e|es|ed|ing)|utiliz(?:e|es|ed|ing|ation)|comprehensive(?:ly)?|journeys?|landscapes?)\b/gi;
const CLEFT_RE = /\b(?:is|are|was|were)\s+what\b/i;
const RULES = ['em-dash', 'long-sentence', 'noun-cluster', 'cleft', 'banned-word'];

// Files the gate skips on purpose, listed in the summary line so the skip is
// never silent. The shared-folder protocol is a byte-identical port of an
// upstream text. Style fixes for it go upstream through the findings file.
const EXEMPT_PREFIXES = ['shared-folder-communications-protocol/'];

const KINDS = { '.md': 'md', '.js': 'js', '.cjs': 'js', '.mjs': 'js', '.sh': 'sh', '.ps1': 'ps1' };
const kindOf = (file) => KINDS[path.extname(file).toLowerCase()] || null;
const isExempt = (file) => EXEMPT_PREFIXES.some((p) => file.replace(/\\/g, '/').startsWith(p));

// ---------------------------------------------------------------------------
// Reading prose out of a file
// ---------------------------------------------------------------------------

// One pass over a code file. Each line is a comment, a blank or code. The
// leading run of comments and blanks is the header. Any comment line, header
// or not, goes to the em-dash rule.
function scanCode(text, kind) {
  const lines = text.split(/\r?\n/);
  const out = [];
  let inBlock = false;
  let header = true;
  lines.forEach((raw, i) => {
    const t = raw.trim();
    const item = { line: i + 1, text: '', comment: false, code: false };
    if (inBlock) {
      const close = kind === 'ps1' ? t.indexOf('#>') : t.indexOf('*/');
      const body = close === -1 ? t : t.slice(0, close);
      item.text = body.replace(/^\*\s?/, '');
      item.comment = true;
      if (close !== -1) inBlock = false;
    } else if (!t) {
      item.text = '';
    } else if (i === 0 && /^#!/.test(t)) {
      item.text = '';
    } else if (/^#requires\b/i.test(t) || /^['"]use strict['"];?$/.test(t)) {
      item.text = '';
    } else if (kind === 'js' && t.startsWith('//')) {
      item.text = t.replace(/^\/\/\s?/, '');
      item.comment = true;
    } else if (kind !== 'js' && t.startsWith('#')) {
      item.text = t.replace(/^#+\s?/, '');
      item.comment = true;
    } else if (kind === 'js' && t.startsWith('/*')) {
      const close = t.indexOf('*/');
      item.text = t.slice(2, close === -1 ? undefined : close).replace(/^\*\s?/, '');
      item.comment = true;
      inBlock = close === -1;
    } else if (kind === 'ps1' && t.startsWith('<#')) {
      const close = t.indexOf('#>');
      item.text = t.slice(2, close === -1 ? undefined : close);
      item.comment = true;
      inBlock = close === -1;
    } else {
      item.code = true;
      header = false;
    }
    item.header = header && !item.code;
    out.push(item);
  });
  return out;
}

// Group lines into blocks of running prose. A blank line, a list marker, a
// table row, a heading or a fence ends a block. The same walk serves
// markdown and comment text, so the two follow one set of rules.
function toBlocks(items, opts) {
  const blocks = [];
  let cur = null;
  let fence = false;
  let prevBlank = true;
  let inCode = false;
  let skipHelp = false;
  const flush = () => {
    if (cur) blocks.push(cur);
    cur = null;
  };
  for (const it of items) {
    const t = it.text.replace(/\s+$/, '');
    if (!t.trim()) {
      flush();
      prevBlank = true;
      inCode = false;
      continue;
    }
    if (/^\s*(```|~~~)/.test(t)) {
      flush();
      fence = !fence;
      prevBlank = true;
      continue;
    }
    if (fence) continue;
    if (opts.help && /^\s*\.[A-Z]{3,}\b/.test(t)) {
      flush();
      skipHelp = /^\s*\.EXAMPLE\b/.test(t);
      continue;
    }
    if (skipHelp) continue;
    if (/^\s*([-*_=])(\s*\1){2,}\s*$/.test(t)) {
      flush();
      prevBlank = true;
      continue;
    }
    if (opts.md && /^\s*#{1,6}\s/.test(t)) {
      flush();
      continue;
    }
    if (/^\s*\|/.test(t)) {
      flush();
      continue;
    }
    if (it.single) {
      flush();
      blocks.push({ segs: [{ line: it.line, text: t.trim() }] });
      continue;
    }
    const list = t.match(/^\s*(?:[-*+]|\d+[.)])\s+(.*)$/);
    if (list) {
      flush();
      cur = { segs: [{ line: it.line, text: list[1] }] };
      prevBlank = false;
      inCode = false;
      continue;
    }
    const indent = t.match(/^\s*/)[0].length;
    const afterColon = cur && /:$/.test(cur.segs[cur.segs.length - 1].text);
    if (inCode || ((prevBlank || afterColon) && indent >= opts.codeIndent)) {
      if (afterColon) flush();
      inCode = true;
      continue;
    }
    const body = t.replace(/^\s*>\s?/, '').trim();
    if (!cur) cur = { segs: [] };
    cur.segs.push({ line: it.line, text: body });
    prevBlank = false;
  }
  flush();
  return blocks;
}

// Replace regex matches in text, keeping a parallel array of source lines
// so every character of the result still maps back to a file line.
function sub(str, lines, re, fn) {
  let out = '';
  const ol = [];
  let last = 0;
  for (const m of str.matchAll(re)) {
    for (let k = last; k < m.index; k++) {
      out += str[k];
      ol.push(lines[k]);
    }
    const r = fn(m);
    for (let k = 0; k < r.length; k++) ol.push(lines[m.index]);
    out += r;
    last = m.index + m[0].length;
  }
  for (let k = last; k < str.length; k++) {
    out += str[k];
    ol.push(lines[k]);
  }
  return [out, ol];
}

// Turn one block into sentences. A code span becomes one placeholder word
// and comes back when the check prints the sentence.
function sentencesOf(block) {
  let text = '';
  let lines = [];
  for (const s of block.segs) {
    const piece = s.text + ' ';
    text += piece;
    for (let k = 0; k < piece.length; k++) lines.push(s.line);
  }
  const codes = [];
  [text, lines] = sub(text, lines, /(`+)[^`]*?\1/g, (m) => {
    codes.push(m[0]);
    return '\u0002' + (codes.length - 1) + '\u0003';
  });
  [text, lines] = sub(text, lines, /!\[[^\]]*\]\([^)]*\)/g, () => '');
  [text, lines] = sub(text, lines, /\[([^\]]*)\]\([^)]*\)/g, (m) => m[1]);
  [text, lines] = sub(text, lines, /\[([^\]]*)\]\[[^\]]*\]/g, (m) => m[1]);
  [text, lines] = sub(text, lines, /<https?:\/\/[^>]+>|https?:\/\/[^\s)]+/g, () => 'url');
  [text, lines] = sub(text, lines, /\*+/g, () => '');
  [text, lines] = sub(text, lines, /(^|\s)_+|_+(?=[\s.,;:!?)]|$)/g, (m) => m[1] || '');
  [text, lines] = sub(text, lines, /\b(e)\.(g)\.|\b(i)\.(e)\./gi, (m) => m[0].replace(/\./g, '\u0004'));

  const out = [];
  let from = 0;
  const cuts = [...text.matchAll(SPLIT_RE)].map((m) => m.index);
  cuts.push(text.length);
  const show = (s) => s.replace(/\u0004/g, '.').replace(/\u0002(\d+)\u0003/g, (_, n) => codes[Number(n)]);
  for (const cut of cuts) {
    const raw = text.slice(from, cut);
    const lead = raw.length - raw.trimStart().length;
    const body = raw.trim();
    if (body && /[A-Za-z]/.test(body.replace(/\u0002\d+\u0003/g, ''))) {
      const start = from + lead;
      out.push({
        text: body,
        shown: show(body),
        line: lines[start],
        endLine: lines[Math.min(start + body.length - 1, lines.length - 1)],
        lineAt: (idx) => lines[Math.min(start + idx, lines.length - 1)],
      });
    }
    from = cut;
  }
  return out;
}

// ---------------------------------------------------------------------------
// The sentence rules
// ---------------------------------------------------------------------------

const wordsOf = (s) => s.split(/\s+/).filter((w) => /[A-Za-z0-9\u0002]/.test(w));

// Runs of capitalised or hyphen-joined words with no punctuation between.
// The first word of a sentence is capitalised by position, so it counts
// only when it is an acronym or a hyphen-joined word.
function nounClusters(sentence) {
  const found = [];
  let run = [];
  const close = () => {
    if (run.length >= CLUSTER_MIN) found.push(run.join(' '));
    run = [];
  };
  sentence.split(/\s+/).filter(Boolean).forEach((tok, i) => {
    const core = tok.replace(OPENERS, '').replace(CLOSERS, '');
    const word = core.replace(/[,;:.!?]+$/, '');
    const hyphen = /^[A-Za-z0-9]+(?:-[A-Za-z0-9]+)+$/.test(word);
    const caps = /^[A-Z][A-Za-z0-9]*(?:'s)?$/.test(word);
    const allCaps = /^[A-Z][A-Z0-9]+$/.test(word);
    if (hyphen || allCaps || (caps && i > 0)) run.push(word);
    else close();
    if (/[,;:.!?]$/.test(core)) close();
  });
  close();
  return found;
}

function sentenceHits(s) {
  const hits = [];
  const n = wordsOf(s.text).length;
  if (n > MAX_WORDS) {
    hits.push({ rule: 'long-sentence', line: s.line, msg: `${n} words, limit ${MAX_WORDS}`, sentence: s.shown });
  }
  for (const c of nounClusters(s.text)) {
    hits.push({ rule: 'noun-cluster', line: s.line, msg: `noun cluster "${c}"`, sentence: s.shown });
  }
  const cleft = s.text.match(CLEFT_RE);
  if (cleft) {
    hits.push({ rule: 'cleft', line: s.lineAt(cleft.index), msg: `cleft "${cleft[0]}"`, sentence: s.shown });
  }
  for (const m of s.text.matchAll(BANNED_RE)) {
    hits.push({ rule: 'banned-word', line: s.lineAt(m.index), msg: `banned word "${m[0]}"`, sentence: s.shown });
  }
  return hits;
}

// ---------------------------------------------------------------------------
// One file
// ---------------------------------------------------------------------------

// scope is null (every line counts) or a Set of added line numbers.
function lintFile(file, text, scope, rules) {
  const kind = kindOf(file);
  const on = (r) => !rules || rules.includes(r);
  const inScope = (a, b) => {
    if (!scope) return true;
    for (let l = a; l <= b; l++) if (scope.has(l)) return true;
    return false;
  };
  const hits = [];
  let count = 0;
  if (!kind) return { hits, count, skipped: true };

  let items;
  let opts;
  if (kind === 'md') {
    items = text.split(/\r?\n/).map((t, i) => ({ line: i + 1, text: t }));
    if (items.length && items[0].text.trim() === '---') {
      const end = items.findIndex((it, i) => i > 0 && it.text.trim() === '---');
      if (end > 0) {
        for (let i = 1; i < end; i++) {
          items[i].single = true;
          items[i].text = items[i].text.replace(/^[\w-]+:\s*/, '');
        }
        items[0].text = '';
        items[end].text = '';
      }
    }
    opts = { md: true, codeIndent: 4 };
    if (on('em-dash')) {
      text.split(/\r?\n/).forEach((l, i) => {
        if (l.includes(EM_DASH) && inScope(i + 1, i + 1)) {
          hits.push({ rule: 'em-dash', line: i + 1, msg: 'em dash', sentence: l.trim() });
        }
      });
    }
  } else {
    const code = scanCode(text, kind);
    if (on('em-dash')) {
      for (const it of code) {
        if (it.comment && it.text.includes(EM_DASH) && inScope(it.line, it.line)) {
          hits.push({ rule: 'em-dash', line: it.line, msg: 'em dash', sentence: it.text.trim() });
        }
      }
    }
    items = code.filter((it) => it.header);
    opts = { codeIndent: 2, help: kind === 'ps1' };
  }

  for (const block of toBlocks(items, opts)) {
    for (const s of sentencesOf(block)) {
      if (!inScope(s.line, s.endLine)) continue;
      count++;
      for (const h of sentenceHits(s)) if (on(h.rule)) hits.push(h);
    }
  }
  hits.sort((a, b) => a.line - b.line);
  return { hits, count, skipped: false };
}

// ---------------------------------------------------------------------------
// Git plumbing
// ---------------------------------------------------------------------------

function git(args, cwd) {
  return execFileSync('git', ['-c', 'core.quotepath=off', ...args], {
    cwd,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

// Parse `git diff --unified=0` into a Map of path -> Set of added line numbers.
function parseAdded(diff) {
  const out = new Map();
  let cur = null;
  let header = false;
  for (const line of diff.split('\n')) {
    if (line.startsWith('diff --git ')) {
      header = true;
      cur = null;
      continue;
    }
    if (header && line.startsWith('+++ ')) {
      const p = line.slice(4).replace(/\t.*$/, '').replace(/\r$/, '');
      cur = p === '/dev/null' ? null : p.replace(/^b\//, '');
      if (cur && !out.has(cur)) out.set(cur, new Set());
      continue;
    }
    const m = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/);
    if (m && cur) {
      header = false;
      const start = Number(m[1]);
      const n = m[2] === undefined ? 1 : Number(m[2]);
      for (let k = 0; k < n; k++) out.get(cur).add(start + k);
    }
  }
  return out;
}

// Every diff the check reads uses these. They pin the two prefixes, so a
// user's diff.mnemonicPrefix or diff.dstPrefix cannot blind parseAdded.
const DIFF_OPTS = ['--unified=0', '--no-color', '--no-ext-diff', '--src-prefix=a/', '--dst-prefix=b/', '--diff-filter=ACMR'];

// -> {files: [{file, text, scope}], exempt: [path], unread: [path], changed}
// for the chosen mode. `wide` is the union of the index, the working tree
// and the untracked files. The caller can limit its last two parts to
// `paths`. Only base mode sets `changed`, the number of paths the diff names.
function collect(mode, arg, cwd, paths) {
  const root = git(['rev-parse', '--show-toplevel'], cwd).trim();
  const limit = paths && paths.length ? ['--', ...paths] : [];
  const out = { files: [], exempt: [], unread: [], changed: null };
  const seen = new Set();
  const take = (file, scope, read) => {
    if (isExempt(file)) {
      out.exempt.push(file);
      return;
    }
    if (!kindOf(file)) {
      out.unread.push(file);
      return;
    }
    let text;
    try {
      text = read();
    } catch {
      out.unread.push(file);
      return;
    }
    const key = [file, scope ? [...scope].join(',') : '*', text].join('\n');
    if (seen.has(key)) return;
    seen.add(key);
    out.files.push({ file, text, scope });
  };
  const index = (file) => () => git(['show', ':' + file], root);
  const tree = (file) => () => fs.readFileSync(path.join(root, file), 'utf8');
  const diff = (revs, only, reader) => {
    const added = parseAdded(git(['diff', ...revs, ...DIFF_OPTS, ...only], root));
    for (const [file, scope] of added) take(file, scope, reader(file));
  };
  if (mode === 'staged' || mode === 'wide') diff(['--cached'], [], index);
  if (mode === 'worktree' || mode === 'wide') diff(['HEAD'], limit, tree);
  if (mode === 'base') {
    diff([arg + '...HEAD'], [], tree);
    out.changed = git(['diff', '--name-only', arg + '...HEAD'], root).split('\n').filter(Boolean).length;
  }
  if (mode === 'wide') {
    const others = git(['ls-files', '--others', '--exclude-standard', '-z', ...limit], root);
    for (const file of others.split('\0').filter(Boolean)) take(file, null, tree(file));
  }
  out.exempt = [...new Set(out.exempt)];
  out.unread = [...new Set(out.unread)];
  return out;
}

// ---------------------------------------------------------------------------
// Running and reporting
// ---------------------------------------------------------------------------

function run(files, rules, exempt, unread) {
  const lines = [];
  const shown = new Set();
  let total = 0;
  let sentences = 0;
  const bad = new Set();
  const read = new Set();
  const notRead = new Set(unread || []);
  for (const f of files) {
    const r = lintFile(f.file, f.text, f.scope, rules);
    if (r.skipped) {
      notRead.add(f.file);
      continue;
    }
    read.add(f.file);
    sentences += r.count;
    for (const h of r.hits) {
      const head = `${f.file}:${h.line}: [${h.rule}] ${h.msg}`;
      // A wide check can read one file twice, from the index and from disk.
      if (shown.has(head + '\n' + h.sentence)) continue;
      shown.add(head + '\n' + h.sentence);
      total++;
      bad.add(f.file);
      lines.push(head);
      lines.push(`    ${h.sentence}`);
    }
  }
  const names = (list) => list.slice(0, 5).join(', ') + (list.length > 5 ? ` and ${list.length - 5} more` : '');
  const skip = exempt && exempt.length ? `; skipped as exempt: ${[...new Set(exempt)].join(', ')}` : '';
  const rest = notRead.size ? `; not read: ${names([...notRead])}` : '';
  const counts = `(${read.size} files, ${sentences} sentences checked${skip}${rest})`;
  // "clean" is a claim about text the check read. With no file read, say so.
  const state = total ? `${total} hit(s) in ${bad.size} file(s)` : read.size ? 'clean' : 'nothing read';
  lines.push(`doc-style-check: ${state} ${counts}`);
  return { code: total ? 1 : 0, output: lines.join('\n'), total, read: read.size };
}

function parseArgs(argv) {
  const o = { paths: [], rules: null, mode: null, base: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--staged') o.mode = 'staged';
    else if (a === '--worktree') o.mode = 'worktree';
    else if (a === '--all') o.mode = 'all';
    else if (a === '--hook') o.mode = 'hook';
    else if (a === '--base') {
      o.mode = 'base';
      o.base = argv[++i];
    } else if (a === '--rules') o.rules = String(argv[++i] || '').split(',').filter(Boolean);
    else if (a.startsWith('--')) return { error: `unknown option ${a}` };
    else o.paths.push(a);
  }
  if (o.rules) {
    const unknown = o.rules.filter((r) => !RULES.includes(r));
    if (unknown.length) return { error: `unknown rule ${unknown.join(', ')}; known: ${RULES.join(', ')}` };
  }
  if (o.mode === 'base' && !o.base) return { error: '--base needs a ref' };
  if (!o.mode && !o.paths.length) {
    return { error: 'give file paths or one of --all --staged --worktree --base REF --hook' };
  }
  return o;
}

// ---------------------------------------------------------------------------
// The commit gate (PreToolUse adapter)
// ---------------------------------------------------------------------------

// The hook runs BEFORE the command. It cannot read what the commit holds,
// because the commit does not exist yet. So it works out from the call what
// the commit will take. That needs the folder the commit runs in, and what
// the call stages on the way there. The first version read the index as it
// stood. It passed `git add FILE && git commit` unread and logged it as clean.

const FILL = '\u0001';

// Blank the quoted spans, keeping the length, so a `git commit` that only
// appears inside a quoted argument never matches. The fill is not a space,
// so a quoted argument stays one word. `open` is true when a quote never
// closes, and then the caller cannot trust the mask.
function maskInfo(s) {
  const out = s.split('');
  let q = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      out[i] = FILL;
      // A backslash escapes a double quote. Nothing escapes a single quote.
      if (c === q && !(q === '"' && s[i - 1] === '\\')) q = null;
    } else if (c === '"' || c === "'") {
      q = c;
      out[i] = FILL;
    }
  }
  return { masked: out.join(''), open: q !== null };
}
const maskQuoted = (s) => maskInfo(s).masked;

// Where a command can start. That is the start of the call, or after an
// operator, a bracket, a brace or a word that takes a command.
const START = '(?:^|[;&|(){}\\r\\n]|\\b(?:then|else|elif|do|if|while|until|command|exec|time|env|sudo|nohup)\\s)\\s*';
const ASSIGN = '(?:[A-Za-z_][A-Za-z0-9_]*=\\S*\\s+)*';
const GIT = 'git(?:\\.exe)?';
const COMMIT_RE = new RegExp(
  START + ASSIGN + GIT + '\\s+(?:(?:-C|-c)\\s+\\S+\\s+|--no-pager\\s+|--git-dir=\\S+\\s+|--work-tree=\\S+\\s+)*commit(?![\\w-])',
  'i'
);
// One event per command that moves the folder or runs git, in call order.
const EVENT_RE = new RegExp(
  START + '(?:(cd|chdir|pushd|popd|sl|Set-Location|Push-Location|Pop-Location)(?![\\w-])|' + ASSIGN + GIT + '(?=\\s))',
  'gi'
);
const STOP_RE = /&&|\|\||[;|&)}\r\n]/;
const OVERRIDE_BASH_RE = /(?:^|[;&|\r\n])\s*(?:export\s+)?CLAUDE_DOC_STYLE_OVERRIDE=1\b/;
const OVERRIDE_PWSH_RE = /\$env:CLAUDE_DOC_STYLE_OVERRIDE\s*=\s*(['"]?)1\1(?!\d)/i;

// git commands that leave the index alone. Any other verb before the commit
// counts as staging, and the check goes wide.
const READ_ONLY = new Set(['status', 'diff', 'log', 'show', 'rev-parse', 'rev-list', 'ls-files', 'fetch', 'push', 'describe', 'blame', 'branch', 'remote', 'config', 'tag']);
const VALUE_SHORT = 'mFCct';
const VALUE_LONG = new Set(['--message', '--file', '--reuse-message', '--reedit-message', '--author', '--date', '--template', '--fixup', '--squash', '--cleanup', '--trailer']);

// The words of one simple command, from `from` to the next operator. Each
// word comes from the real command at the same offsets, so its quotes
// survive. A redirection ends the words.
function wordsAt(cmd, text, from) {
  const rel = text.slice(from).search(STOP_RE);
  const seg = text.slice(from, rel === -1 ? text.length : from + rel);
  const out = [];
  for (const m of seg.matchAll(/\S+/g)) {
    if (/[<>]/.test(m[0])) break;
    out.push(cmd.slice(from + m.index, from + m.index + m[0].length));
  }
  return out;
}

// -> the plain text of one shell word, or null when only the shell can say
// what the word expands to.
function literal(word) {
  const m = word.match(/^(['"])([\s\S]*)\1$/);
  const t = m ? m[2] : word;
  return /['"`$%]/.test(t) ? null : t;
}

// -> an absolute path for one shell word, or null. Git Bash writes drive C
// as /c, and node does not know that form.
function toPath(base, word) {
  let t = literal(word);
  if (t === null || t === '' || base === null) return null;
  if (t === '~' || /^~[\\/]/.test(t)) t = os.homedir() + t.slice(1);
  if (process.platform === 'win32') {
    const drive = t.match(/^\/([A-Za-z])(\/.*)?$/);
    if (drive) t = drive[1] + ':' + (drive[2] || '/');
    else if (t.startsWith('/')) return null;
  }
  return path.resolve(base, t);
}

function toDir(base, word) {
  const p = toPath(base, word);
  try {
    return p && fs.statSync(p).isDirectory() ? p : null;
  } catch {
    return null;
  }
}

// -> a pathspec git can take from any folder, or null when the word is a
// glob or pathspec magic. null makes the caller read everything.
function toSpec(base, word) {
  const t = literal(word);
  if (t === null || /^:|[*?[]/.test(t)) return null;
  const p = toPath(base, word);
  return p === null ? null : p.replace(/\\/g, '/');
}

// What one `git commit` takes besides the index.
function commitTakes(args) {
  const out = { all: false, paths: [], unsure: false };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--') {
      out.paths.push(...args.slice(i + 1));
      break;
    }
    if (a === '--all') out.all = true;
    else if (/^--(patch|interactive|pathspec-from-file)\b/.test(a)) out.unsure = true;
    else if (VALUE_LONG.has(a)) i++;
    else if (/^-[A-Za-z]+$/.test(a)) {
      for (const ch of a.slice(1)) {
        if (ch === 'a') out.all = true;
        if (ch === 'p') out.unsure = true;
        if (VALUE_SHORT.includes(ch)) {
          if (ch === a[a.length - 1]) i++;
          break;
        }
      }
    } else if (!a.startsWith('-')) out.paths.push(a);
  }
  return out;
}

// Read the call in order. The result is one plan per `git commit` in it,
// as {dir, mode, paths}. A null dir means that the hook cannot resolve the
// folder, and the caller then reads the folder of the session. The mode is
// staged, worktree or wide (see collect).
function plansOf(cmd, cwd) {
  const info = maskInfo(cmd);
  // An unclosed quote or a here-document can hide a command from the mask.
  // Then read the raw text. That can only find more commits, never fewer.
  const text = info.open || info.masked.includes('<<') ? cmd : info.masked;
  if (!COMMIT_RE.test(text)) return [];
  const plans = [];
  const paths = [];
  let dir = cwd;
  let staged = 'none'; // what the call stages before the commit: none, paths or all
  for (const m of text.matchAll(EVENT_RE)) {
    const w = wordsAt(cmd, text, m.index + m[0].length);
    if (m[1]) {
      const target = /^pop/i.test(m[1]) ? undefined : w.find((t) => !t.startsWith('-'));
      dir = target === undefined ? null : toDir(dir, target);
      continue;
    }
    let at = dir;
    let i = 0;
    for (; i < w.length && w[i].startsWith('-'); i++) {
      if (w[i] === '-C') at = toDir(at, w[++i] || '');
      else if (w[i] === '-c') i++;
      else if (/^--(git-dir|work-tree)\b/.test(w[i])) at = null;
    }
    const verb = (w[i] || '').toLowerCase();
    const args = w.slice(i + 1);
    if (verb === 'commit') {
      const takes = commitTakes(args);
      const own = takes.paths.map((p) => toSpec(at, p));
      const wide = staged !== 'none' || own.length > 0 || takes.unsure;
      const everything = staged === 'all' || takes.unsure || own.includes(null) || takes.all;
      plans.push({
        dir: at,
        mode: wide ? 'wide' : takes.all ? 'worktree' : 'staged',
        paths: wide && !everything ? [...paths, ...own] : [],
      });
      staged = 'all';
    } else if (verb === 'add' || verb === 'stage') {
      const specs = args.filter((a) => a !== '--').map((a) => (a.startsWith('-') ? null : toSpec(at, a)));
      if (specs.includes(null)) staged = 'all';
      else if (specs.length && staged !== 'all') {
        staged = 'paths';
        paths.push(...specs);
      }
    } else if (verb && !READ_ONLY.has(verb)) {
      staged = 'all';
    }
  }
  // COMMIT_RE saw a commit that the walk did not. Read everything.
  if (!plans.length) plans.push({ dir: cwd, mode: 'wide', paths: [] });
  return plans;
}

function hookMain() {
  let input = {};
  try {
    input = JSON.parse(fs.readFileSync(0, 'utf8') || '{}');
  } catch {
    process.exit(0);
  }
  const cmd = input && input.tool_input && input.tool_input.command;
  if (typeof cmd !== 'string' || !/git\b[\s\S]*\bcommit\b/i.test(cmd)) process.exit(0);
  const cwd = input.cwd || process.cwd();
  const plans = plansOf(cmd, cwd);
  if (!plans.length) process.exit(0);

  const projectDir = process.env.CLAUDE_PROJECT_DIR || cwd;
  const LOG = path.join(projectDir, '.claude', 'state', 'doc-style-gate.log');
  const log = (outcome, label, reason) => {
    try {
      fs.mkdirSync(path.dirname(LOG), { recursive: true });
      const clean = (s) => String(s).replace(/[|\t\r\n]/g, ' ');
      fs.appendFileSync(LOG, `${new Date().toISOString()}|doc-style-gate|${clean(outcome)}|${clean(label)}|${clean(reason)}\n`);
    } catch {
      /* logging is best effort and never blocks */
    }
  };
  const warn = (slug, why) => {
    log(slug, 'git commit', why);
    process.stdout.write(JSON.stringify({ systemMessage: `[doc-style-gate] ${why} Allowing the commit unchecked.` }));
    process.exit(0);
  };

  // A folder the hook cannot resolve, as in `cd "$DIR" && git commit`. The
  // hook then reads the folder of the session, which is right when the
  // target is the same repo. An earlier cut of this fix allowed such a commit
  // unread, and that lost a check the version before it had.
  const assumed = plans.some((p) => p.dir === null);
  const found = { files: [], exempt: [], unread: [] };
  try {
    for (const p of plans) {
      const part = collect(p.mode, null, p.dir === null ? cwd : p.dir, p.paths);
      for (const k of Object.keys(found)) found[k].push(...part[k]);
    }
  } catch (e) {
    warn('open:git-failed', `Could not read the commit's changes (${String(e.message).split('\n')[0]}).`);
  }
  const result = run(found.files, null, found.exempt, found.unread);
  if (!result.total) {
    // A row that says clean must mean that the check read the text of the
    // commit and it passed. With an assumed folder that is not certain, so
    // say so.
    const outcome = assumed ? 'open:dir-assumed' : result.read ? 'clean' : 'open:nothing-read';
    log(outcome, 'git commit', result.output.split('\n').pop());
    process.exit(0);
  }
  const wide = plans.some((p) => p.mode === 'wide');
  const override =
    OVERRIDE_BASH_RE.test(cmd) || OVERRIDE_PWSH_RE.test(cmd) || process.env.CLAUDE_DOC_STYLE_OVERRIDE === '1';
  if (override) {
    log('override', 'git commit', `${result.total} hit(s) overridden; command="${cmd.slice(0, 200)}"`);
    process.stdout.write(
      JSON.stringify({ systemMessage: `[doc-style-gate] OVERRIDE used, ${result.total} hit(s) let through. Logged to ${LOG}.` })
    );
    process.exit(0);
  }
  log('blocked', 'git commit', `${result.total} hit(s)`);
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason:
          `[doc-style-gate] The text of this commit breaks the kit's house style. Fix every hit, stage again and retry.\n` +
          `${result.output}\n` +
          (wide
            ? `This call stages and commits in one go, so the gate read every change the commit can take. ` +
              `If a hit is in a file this commit leaves out, stage in one call and commit in the next.\n`
            : '') +
          (assumed ? `The gate could not tell which folder this commit runs in, so it read the folder of the session.\n` : '') +
          `Deliberate override, logged: bash "export CLAUDE_DOC_STYLE_OVERRIDE=1; git commit ..." or PowerShell ` +
          `"$env:CLAUDE_DOC_STYLE_OVERRIDE='1'; git commit ...". CI re-checks the pull request and ignores the override.`,
      },
    })
  );
  process.exit(0);
}

// ---------------------------------------------------------------------------

module.exports = { lintFile, parseAdded, maskQuoted, plansOf, COMMIT_RE, RULES, EXEMPT_PREFIXES };

if (require.main === module) {
  const o = parseArgs(process.argv.slice(2));
  if (o.error) {
    console.error('doc-style-check: ' + o.error);
    process.exit(2);
  }
  if (o.mode === 'hook') hookMain();
  let files = [];
  let exempt = [];
  let unread = [];
  try {
    if (o.mode === 'all') {
      const root = git(['rev-parse', '--show-toplevel'], process.cwd()).trim();
      const tracked = git(['ls-files', '*.md'], root).split('\n').filter(Boolean);
      exempt = tracked.filter(isExempt);
      files = tracked
        .filter((f) => !isExempt(f))
        .map((f) => ({ file: f, text: fs.readFileSync(path.join(root, f), 'utf8'), scope: null }));
      if (!files.length) {
        console.error('doc-style-check: --all found no .md files; a check over nothing proves nothing');
        process.exit(2);
      }
    } else if (o.mode) {
      const found = collect(o.mode, o.base, process.cwd());
      // CI runs this mode. A diff with no changed file means the base is
      // wrong, and a green result over nothing proves nothing.
      if (o.mode === 'base' && !found.changed) {
        console.error(`doc-style-check: --base ${o.base} shows no changed file; a check over nothing proves nothing`);
        process.exit(2);
      }
      ({ files, exempt, unread } = found);
    }
    for (const p of o.paths) files.push({ file: p, text: fs.readFileSync(p, 'utf8'), scope: null });
  } catch (e) {
    console.error('doc-style-check: ' + String(e.message).split('\n')[0]);
    process.exit(2);
  }
  const r = run(files, o.rules, exempt, unread);
  console.log(r.output);
  process.exit(r.code);
}

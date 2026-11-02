#!/usr/bin/env node
// doc-style-check.js
//
// A deterministic gate for the kit's house style: ASD-STE100 plus Zinsser.
// It prints file:line and the offending sentence for each hit. It exits 1 on
// any hit, 0 when the text is clean, and 2 on a usage error. The last line
// of output is always one summary line.
//
// Five rules, each exact and self-contained:
//
//   em-dash        U+2014 anywhere in a markdown file or a code comment.
//   long-sentence  more than 25 words. Code spans count as one word.
//   noun-cluster   four or more capitalised or hyphen-joined words in a row.
//   cleft          "is what" and its kin, as in "X is what made Y".
//   banned-word    the universal AI markers from the Humanizer skill.
//
// What is read. Markdown files are read whole. Fenced blocks, tables,
// headings and indented code are skipped by every rule except em-dash.
// Code files (.js, .sh, .ps1) are read for their leading comment block only,
// plus em-dash in any comment line.
//
// Scope. Explicit paths and --all are checked whole. The diff modes read
// the added lines only. A sentence is in scope when any of its lines was
// added. An edit inside an old long sentence makes you fix that sentence.
// Old debt on untouched lines never blocks a commit.
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
// The --hook mode denies a `git commit` when the staged check fails. Its
// override is CLAUDE_DOC_STYLE_OVERRIDE=1, set with `export` or `$env:` in
// the same call. Every use of it is logged to .claude/state/doc-style-gate.log.
// CI runs the same check with --base and ignores the override.
//
// Named residuals. The check measures sentences, not meaning. A short bad
// sentence passes. The hook sees a commit that names paths, or changes
// directory first, as an index commit. A reader still needs the Humanizer
// pass for tone, which no pattern can score.

'use strict';

const fs = require('fs');
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
// or not, is kept for the em-dash rule.
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

// Turn one block into sentences. Code spans become one placeholder word and
// are restored when a sentence is printed.
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

// -> {files: [{file, text, scope}], exempt: [path]} for the chosen diff mode.
function collect(mode, arg, cwd) {
  const root = git(['rev-parse', '--show-toplevel'], cwd).trim();
  const diffArgs = {
    staged: ['diff', '--cached', '--unified=0', '--no-color', '--diff-filter=ACMR'],
    worktree: ['diff', 'HEAD', '--unified=0', '--no-color', '--diff-filter=ACMR'],
    base: ['diff', arg + '...HEAD', '--unified=0', '--no-color', '--diff-filter=ACMR'],
  }[mode];
  const added = parseAdded(git(diffArgs, root));
  const files = [];
  for (const [file, scope] of added) {
    if (!kindOf(file) || isExempt(file)) continue;
    try {
      const text = mode === 'staged' ? git(['show', ':' + file], root) : fs.readFileSync(path.join(root, file), 'utf8');
      files.push({ file, text, scope });
    } catch {
      /* a file that cannot be read is not in the commit */
    }
  }
  return { files, exempt: [...added.keys()].filter(isExempt) };
}

// ---------------------------------------------------------------------------
// Running and reporting
// ---------------------------------------------------------------------------

function run(files, rules, exempt) {
  const lines = [];
  let total = 0;
  let sentences = 0;
  const bad = new Set();
  for (const f of files) {
    const r = lintFile(f.file, f.text, f.scope, rules);
    sentences += r.count;
    for (const h of r.hits) {
      total++;
      bad.add(f.file);
      lines.push(`${f.file}:${h.line}: [${h.rule}] ${h.msg}`);
      lines.push(`    ${h.sentence}`);
    }
  }
  const skip = exempt && exempt.length ? `; skipped as exempt: ${[...new Set(exempt)].join(', ')}` : '';
  lines.push(
    total
      ? `doc-style-check: ${total} hit(s) in ${bad.size} file(s) (${files.length} files, ${sentences} sentences checked${skip})`
      : `doc-style-check: clean (${files.length} files, ${sentences} sentences checked${skip})`
  );
  return { code: total ? 1 : 0, output: lines.join('\n'), total };
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

// Blank the quoted spans, keeping the length, so a `git commit` that only
// appears inside a quoted argument never matches.
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

const COMMIT_RE = /(?:^|[;&|\r\n])\s*(?:[A-Za-z_][A-Za-z0-9_]*=\S*\s+)*git\s+(?:(?:-C|-c)\s+\S+\s+|--no-pager\s+|--git-dir=\S+\s+|--work-tree=\S+\s+)*commit(?![\w-])/i;
const OVERRIDE_BASH_RE = /(?:^|[;&|\r\n])\s*(?:export\s+)?CLAUDE_DOC_STYLE_OVERRIDE=1\b/;
const OVERRIDE_PWSH_RE = /\$env:CLAUDE_DOC_STYLE_OVERRIDE\s*=\s*(['"]?)1\1(?!\d)/i;

// -> 'worktree' when the commit stages tracked changes itself (-a, --all,
// -am), else 'staged'.
function commitMode(masked) {
  const m = masked.match(COMMIT_RE);
  const tail = masked.slice(m.index + m[0].length).split(/&&|\|\||[;|\r\n]/, 1)[0];
  for (const tok of tail.trim().split(/\s+/)) {
    if (tok === '--all') return 'worktree';
    if (/^-[A-Za-z]+$/.test(tok)) {
      for (const ch of tok.slice(1)) {
        if ('mFCct'.includes(ch)) break;
        if (ch === 'a') return 'worktree';
      }
    }
  }
  return 'staged';
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
  const masked = maskQuoted(cmd);
  if (!COMMIT_RE.test(masked)) process.exit(0);

  const cwd = input.cwd || process.cwd();
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

  let found = null;
  try {
    found = collect(commitMode(masked), null, cwd);
  } catch (e) {
    warn('open:git-failed', `Could not read the commit's changes (${String(e.message).split('\n')[0]}).`);
  }
  const result = run(found.files, null, found.exempt);
  if (!result.total) {
    log('clean', 'git commit', result.output.split('\n').pop());
    process.exit(0);
  }
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
          `[doc-style-gate] The staged text breaks the kit's house style. Fix every hit, stage again and retry.\n` +
          `${result.output}\n` +
          `Deliberate override, logged: bash "export CLAUDE_DOC_STYLE_OVERRIDE=1; git commit ..." or PowerShell ` +
          `"$env:CLAUDE_DOC_STYLE_OVERRIDE='1'; git commit ...". CI re-checks the pull request and ignores the override.`,
      },
    })
  );
  process.exit(0);
}

// ---------------------------------------------------------------------------

module.exports = { lintFile, parseAdded, maskQuoted, commitMode, COMMIT_RE, RULES, EXEMPT_PREFIXES };

if (require.main === module) {
  const o = parseArgs(process.argv.slice(2));
  if (o.error) {
    console.error('doc-style-check: ' + o.error);
    process.exit(2);
  }
  if (o.mode === 'hook') hookMain();
  let files = [];
  let exempt = [];
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
      ({ files, exempt } = collect(o.mode, o.base, process.cwd()));
    }
    for (const p of o.paths) files.push({ file: p, text: fs.readFileSync(p, 'utf8'), scope: null });
  } catch (e) {
    console.error('doc-style-check: ' + String(e.message).split('\n')[0]);
    process.exit(2);
  }
  const r = run(files, o.rules, exempt);
  console.log(r.output);
  process.exit(r.code);
}

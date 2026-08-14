#!/usr/bin/env node
// UserPromptSubmit context injection.
//
// Emits two facts the model otherwise cannot know, as PLAIN STDOUT — which
// for UserPromptSubmit is added to the model's context. This detail is the
// one most write-ups of this technique get wrong: they emit
// {"systemMessage": "..."} instead, which the hooks docs define as a warning
// shown to the USER. It never reaches the model, and it looks like it works
// because you see it echoed in your own terminal.
//
//   1. Elapsed time since the previous message. The session context carries
//      a start date only, so a four-hour gap is indistinguishable from four
//      seconds and gets answered as if mid-thought.
//   2. Subagents that started but never reported completion — i.e. stalls.

const fs = require('fs');
const path = require('path');

const STATE = path.join(__dirname, '..', 'state');
const LOG = path.join(STATE, 'agents.jsonl');
const CLOCK = path.join(STATE, 'last-prompt.json');

const GAP_ANNOUNCE_MIN = 10; // below this, a gap is not worth the tokens
const STALL_MIN = 15; // outstanding longer than this is flagged
const MAX_LISTED = 8;

const now = Date.now();
let input = {};
try {
  input = JSON.parse(fs.readFileSync(0, 'utf8') || '{}');
} catch {
  /* fall through with defaults */
}
const sid = input.session_id || 'unknown';

function human(ms) {
  const m = Math.round(ms / 60000);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `${h}h ${r}m` : `${h}h`;
}

const out = [];

// ---- 1. elapsed gap ---------------------------------------------------
let clock = {};
try {
  clock = JSON.parse(fs.readFileSync(CLOCK, 'utf8'));
} catch {
  /* first run */
}

const stamp = new Date(now).toLocaleString('en-GB', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});

if (clock[sid]) {
  const gap = now - clock[sid];
  if (gap >= GAP_ANNOUNCE_MIN * 60000) {
    out.push(
      `Elapsed since the previous message in this session: ${human(gap)}. ` +
        `It is now ${stamp}. The user has been away and may have shifted direction — ` +
        `reorient before continuing rather than resuming mid-thought.`
    );
  }
} else {
  out.push(`Session clock: first message, ${stamp}.`);
}

clock[sid] = now;
// Drop sessions untouched for a week so the file cannot grow forever.
for (const k of Object.keys(clock)) {
  if (now - clock[k] > 7 * 864e5) delete clock[k];
}
try {
  fs.mkdirSync(STATE, { recursive: true });
  fs.writeFileSync(CLOCK, JSON.stringify(clock));
} catch {
  /* non-fatal */
}

// ---- 2. outstanding subagents ----------------------------------------
try {
  const lines = fs.readFileSync(LOG, 'utf8').split('\n').filter(Boolean);
  const open = new Map();
  const keep = [];

  for (const line of lines) {
    let e;
    try {
      e = JSON.parse(line);
    } catch {
      continue;
    }
    if (now - e.ts > 864e5) continue; // prune entries older than 24h
    keep.push(line);
    if (e.sid !== sid) continue;
    if (e.ev === 'start') open.set(e.key, e);
    else open.delete(e.key);
  }

  if (open.size) {
    const rows = [...open.values()]
      .sort((a, b) => a.ts - b.ts)
      .slice(0, MAX_LISTED)
      .map((e) => {
        const age = now - e.ts;
        const flag = age >= STALL_MIN * 60000 ? '  <-- possible stall' : '';
        return `  - ${e.label} (started ${human(age)} ago, no completion event)${flag}`;
      });
    const extra = open.size > MAX_LISTED ? `\n  ...and ${open.size - MAX_LISTED} more` : '';
    out.push(
      `Subagents started but not yet reported complete (${open.size}):\n` +
        rows.join('\n') +
        extra +
        `\nA stalled agent emits no notification. If one is flagged above, resume it directly rather than waiting.`
    );
  }

  if (keep.length !== lines.length) {
    fs.writeFileSync(LOG, keep.length ? keep.join('\n') + '\n' : '');
  }
} catch {
  // No log yet, or unreadable — nothing to report.
}

if (out.length) process.stdout.write(out.join('\n\n') + '\n');
process.exit(0);

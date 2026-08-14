#!/usr/bin/env node
// Subagent/task ledger writer.
//
// A stalled subagent emits NO completion event, so its failure is invisible:
// absence of a notification looks identical to "still working". This records
// starts and stops to an append-only log; prompt-context.js replays the log
// and surfaces anything still outstanding.
//
// Complements subagent-stall-check.sh rather than duplicating it. That hook
// fires AT SubagentStop and catches an agent that did stop but whose final
// message shows it thinks it's waiting. This ledger catches the other half:
// an agent that never emitted a stop event at all. The stall-check can never
// see that case, because its own trigger never fires.
//
// Append-only JSONL (not read-modify-write JSON) because parallel fan-out
// means many writers at once — concurrent RMW would lose entries.
//
// Usage: node .claude/hooks/agent-ledger.js start|stop

const fs = require('fs');
const path = require('path');

const LOG = path.join(__dirname, '..', 'state', 'agents.jsonl');
const mode = process.argv[2] === 'stop' ? 'stop' : 'start';

let input = {};
try {
  input = JSON.parse(fs.readFileSync(0, 'utf8') || '{}');
} catch {
  process.exit(0);
}

// Different events carry different identifiers; take whichever is present.
const key = input.agent_id || input.task_id || input.tool_use_id;
if (!key) process.exit(0);

const entry = {
  ts: Date.now(),
  ev: mode,
  sid: input.session_id || 'unknown',
  key,
  label:
    input.agent_type ||
    input.subagent_type ||
    input.description ||
    input.hook_event_name ||
    'agent',
};

try {
  fs.mkdirSync(path.dirname(LOG), { recursive: true });
  fs.appendFileSync(LOG, JSON.stringify(entry) + '\n');
} catch {
  // Never let bookkeeping break the session.
}

process.exit(0);

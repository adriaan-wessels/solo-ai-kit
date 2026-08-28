#!/usr/bin/env bash
# SubagentStop hook: a spawned worker agent's final message sometimes says
# it's waiting for a notification that will never come. This is the worker
# side of the coordinator/worker split (see templates/CLAUDE.md, standing
# rule 3): the harness's "you will be notified when it completes" promise is
# only true for the main conversation — nothing ever re-invokes a worker
# that stops to wait.
#
# Delivery (upgraded 2026-08-14): the hook now EXITS 2. On SubagentStop that
# blocks the subagent from stopping and feeds stderr back to THAT AGENT, so
# the worker resumes itself. Previously this hook could only emit a
# `systemMessage`, which the hooks docs confirm is shown to the USER and
# never enters any model's context — detection was automatic but the resume
# depended on the user noticing the warning and telling the coordinator to
# act. Exit 2 closes that gap: no human relay, no coordinator round-trip.
# The systemMessage is still printed as a visible trace (exit 2 blocks
# whether or not JSON is on stdout, and Claude Code still reads valid stdout
# JSON).
#
# This is a general fix for premature subagent termination (MAST-style
# "stopping too early"): a sub-result that looks like a finished answer gets
# mistaken for the task's deliverable. Prose contracts in the dispatch
# prompt reduce it but never eliminate it, because they are advisory; a stop
# hook that exits 2 is a hard gate. If your agents have a checkable
# POSTCONDITION (a row written, a file created, a PR opened), prefer testing
# that over the message-phrase heuristic below — it tests the state of the
# world rather than what the agent said about it. See claude/README.md.
#
# Loop guard: each agent_id is blocked AT MOST ONCE, recorded in
# .claude/state/stall-blocked.txt. Without it, an agent whose next final
# message also matched would be blocked forever. The phrase list is
# deliberately broad, so a false positive costs one extra turn, never a hang.
#
# Telemetry: every invocation writes one line to
# .claude/state/subagent-stall-check.log, and the line records WHICH phrase
# matched. That matters more here than for any other guard in the kit. The
# phrase list is deliberately broad, so an agent whose report merely
# DISCUSSES stalling trips it, and without the phrase in the log a block
# count cannot be told apart from a false-positive count. The log is what
# turns "this hook fired 12 times" into evidence.
#
# Design notes:
#  - Fails quietly (exit 0) at every step — must NEVER wedge a turn.
#  - Cheap local preconditions before any work (python present, stdin non-empty).
#  - Only blocks when a stall phrase actually matches; silent otherwise.
#  - Reads last_assistant_message directly off the hook's own stdin JSON
#    (SubagentStop input includes this field per the Claude Code hooks docs)
#    rather than parsing transcript_path's JSONL, which the docs say can lag
#    the in-memory conversation — the field on stdin is the authoritative one.
# Interpreter discovery: stock Ubuntu/macOS ship python3 with no `python`
# alias, while Windows ships a `python3` App Store stub that resolves on
# PATH but doesn't run — so try both names AND probe that the candidate
# actually executes before trusting it.
HOOKDIR="$(dirname "${BASH_SOURCE[0]}")"
. "$HOOKDIR/hook-log.sh" 2>/dev/null || true
# A missing helper must not stop the guard from guarding. Telemetry is never
# allowed to be the reason a hook fails.
type hook_log >/dev/null 2>&1 || hook_log() { :; }

py=""
for cand in python3 python; do
    p=$(command -v "$cand" 2>/dev/null) || continue
    [ -n "$p" ] || continue
    if "$p" -c "import sys" >/dev/null 2>&1; then py="$p"; break; fi
done
[ -n "$py" ] || { hook_log subagent-stall-check "open:no-python" "-" "-"; exit 0; }
input=$(cat) || { hook_log subagent-stall-check "open:no-stdin" "-" "-"; exit 0; }
[ -n "$input" ] || { hook_log subagent-stall-check "open:empty-stdin" "-" "-"; exit 0; }

STALL_GUARD="${CLAUDE_PROJECT_DIR:-.}/.claude/state/stall-blocked.txt"
export STALL_GUARD

# Relay channel. The python subprocess below knows the fine-grained outcome
# and the matched phrase, but it cannot call the sourced shell function, and
# shelling back out risks resolving a non-functional bash on PATH. So python
# writes one tab-separated row here and this shell reads it back.
# Best-effort: a missing file is handled explicitly after the run, and must
# NOT be reported as a fail-open.
OUTCOME_FILE="${CLAUDE_PROJECT_DIR:-.}/.claude/state/.stall-outcome.$$"
export OUTCOME_FILE

script=$(cat <<'PYEOF'
import json, os, sys


def note(outcome, target="-", reason="-"):
    # Best-effort relay to the outer shell's hook_log call. It must never be
    # able to affect this script's control flow or exit code.
    # The makedirs is load-bearing, not defensive: in a fresh worktree
    # .claude/state may not exist yet, and without it every open() raises,
    # is swallowed, and the relay degrades to permanently silent.
    # Sanitise HERE, at the boundary where the row is written, not only in
    # the shell that reads it back. The reader is a single `read`, which
    # stops at the first newline, so an agent id containing one would
    # truncate the row and silently drop the matched phrase - the one field
    # this hook gained telemetry to record.
    def flat(s):
        out = str(s)
        for ch in ("|", "\t", "\r", "\n"):
            out = out.replace(ch, " ")
        return out

    try:
        of = os.environ.get("OUTCOME_FILE")
        if of:
            os.makedirs(os.path.dirname(of), exist_ok=True)
            with open(of, "w", encoding="utf-8") as fh:
                fh.write(flat(outcome) + "\t" + flat(target) + "\t" + flat(reason))
    except Exception:
        pass


try:
    data = json.load(sys.stdin)
except Exception:
    note("open:parse-failure")
    sys.exit(0)

msg = data.get("last_assistant_message") or ""
if not isinstance(msg, str) or not msg:
    note("clean", "-", "no-message")
    sys.exit(0)

phrases = [
    "will be notified", "waiting for", "notification",
    "monitor", "in the background", "pending completion",
]
low = msg.lower()
hit = next((p for p in phrases if p in low), None)

agent_id = data.get("agent_id") or "unknown-agent"
agent_type = data.get("agent_type") or "unknown-type"
target = agent_type + "/" + agent_id

if hit is None:
    note("clean", target, "no-match")
    sys.exit(0)

# Loop guard: block a given agent at most once, ever.
guard = os.environ.get("STALL_GUARD") or ".claude/state/stall-blocked.txt"
try:
    with open(guard, "r", encoding="utf-8") as fh:
        already = {ln.strip() for ln in fh if ln.strip()}
except Exception:
    already = set()

if agent_id in already:
    # Already nudged once, so let it stop for real. Still logged, and the
    # phrase is still recorded: a repeat match is exactly the signal that
    # tells a broad phrase list apart from a genuine repeat stall.
    note("clean", target, "loop-guard-already-blocked matched:" + hit)
    sys.exit(0)

try:
    os.makedirs(os.path.dirname(guard), exist_ok=True)
    with open(guard, "a", encoding="utf-8") as fh:
        fh.write(agent_id + "\n")
except Exception:
    pass  # guard is best-effort; never let bookkeeping wedge the hook

note("blocked", target, "matched:" + hit)

# Visible trace for the user (user-facing only).
print(json.dumps({"systemMessage": (
    "Subagent " + agent_type + " (" + agent_id + ") tried to stop while "
    "waiting - matched stall phrase: \"" + hit + "\". Blocked its stop and "
    "told it to resume. No action needed from you."
)}))

# The part that actually reaches the stalled agent: stderr + exit 2.
sys.stderr.write(
    "DO NOT STOP. Your final message matched the stall signature \"" + hit +
    "\", which means you ended your turn expecting to be woken up.\n"
    "You are a SUBAGENT, not the coordinator. No notification will ever "
    "reach you and nothing will re-invoke you - the harness's 'you will be "
    "notified when it completes' promise is TRUE for the main conversation "
    "and FALSE for you.\n"
    "Resume now and finish the work yourself in the foreground. If a long "
    "call auto-backgrounded at the tool-call cap, keep foreground-polling "
    "its output across further short calls. Do not spawn sub-agents. Do not "
    "watch CI. End your turn only with the deliverable in hand or a named, "
    "concrete blocker - never to wait.\n"
)
sys.exit(2)
PYEOF
)

printf '%s' "$input" | "$py" -c "$script"
rc=$?

o_outcome=""
o_target="-"
o_reason="-"
if [ -r "$OUTCOME_FILE" ]; then
    IFS=$'\t' read -r o_outcome o_target o_reason <"$OUTCOME_FILE"
    rm -f "$OUTCOME_FILE" 2>/dev/null
else
    # The relay produced nothing at all. A missing relay must NEVER
    # masquerade as a fail-open: "open:*" would claim the guard skipped its
    # check, when in fact it ran and we simply did not hear the detail.
    # Derive what we can from the subprocess's own exit code instead.
    if [ "$rc" = 2 ]; then
        o_outcome="blocked"
    else
        o_outcome="clean"
    fi
    o_reason="relay-missing"
fi
[ -n "$o_outcome" ] || o_outcome="open:unknown"
[ -n "$o_target" ] || o_target="-"
[ -n "$o_reason" ] || o_reason="-"
hook_log subagent-stall-check "$o_outcome" "$o_target" "$o_reason"

[ "$rc" = 2 ] && exit 2
exit 0

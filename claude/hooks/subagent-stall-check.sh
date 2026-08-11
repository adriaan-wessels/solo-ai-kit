#!/usr/bin/env bash
# SubagentStop hook: a spawned worker agent's final message sometimes says
# it's waiting for a notification that will never come. This is the worker
# side of the coordinator/worker split (see templates/CLAUDE.md, standing
# rule 3): the harness's "you will be notified when it completes" promise is
# only true for the main conversation — nothing ever re-invokes a worker
# that stops to wait. This hook scans the just-finished subagent's own final
# message for that stall signature and surfaces a warning so the stall gets
# noticed and the worker resumed. Note the delivery path: a hook's
# systemMessage output is shown to the USER, not injected into the model's
# context — so detection is automatic, but the resume happens via the user
# telling the coordinator to act on the warning.
#
# Design notes (mirrors ci-status.sh):
#  - Fails quietly (exit 0) at every step — must NEVER block a turn.
#  - Cheap local preconditions before any work (python present, stdin non-empty).
#  - Only emits when a stall phrase actually matches; silent otherwise.
#  - Reads last_assistant_message directly off the hook's own stdin JSON
#    (SubagentStop input includes this field per the Claude Code hooks docs)
#    rather than parsing transcript_path's JSONL, which the docs say can lag
#    the in-memory conversation — the field on stdin is the authoritative one.
# Interpreter discovery: stock Ubuntu/macOS ship python3 with no `python`
# alias, while Windows ships a `python3` App Store stub that resolves on
# PATH but doesn't run — so try both names AND probe that the candidate
# actually executes before trusting it.
py=""
for cand in python3 python; do
    p=$(command -v "$cand" 2>/dev/null) || continue
    [ -n "$p" ] || continue
    if "$p" -c "import sys" >/dev/null 2>&1; then py="$p"; break; fi
done
[ -n "$py" ] || exit 0
input=$(cat) || exit 0
[ -n "$input" ] || exit 0

script=$(cat <<'PYEOF'
import json, sys

try:
    data = json.load(sys.stdin)
except Exception:
    sys.exit(0)

msg = data.get("last_assistant_message") or ""
if not isinstance(msg, str) or not msg:
    sys.exit(0)

phrases = [
    "will be notified", "waiting for", "notification",
    "monitor", "in the background", "pending completion",
]
low = msg.lower()
hit = next((p for p in phrases if p in low), None)
if hit is None:
    sys.exit(0)

agent_id = data.get("agent_id") or "unknown-agent"
agent_type = data.get("agent_type") or "unknown-type"
text = (
    "Subagent " + agent_type + " (" + agent_id + ") looks stalled - its final "
    "message matched stall phrase: \"" + hit + "\". A worker is never "
    "re-invoked by any notification (coordinator/worker split, standing "
    "rule 3). Resume " + agent_id + " now with foreground-poll orders."
)
print(json.dumps({"systemMessage": text}))
PYEOF
)

out=$(printf '%s' "$input" | "$py" -c "$script" 2>/dev/null) || exit 0
[ -n "$out" ] || exit 0
printf '%s' "$out"
exit 0

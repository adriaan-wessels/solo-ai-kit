#!/usr/bin/env bash
# Replay harness for subagent-stall-check.sh.
#
# The kit's own rule (claude/README.md, "Corpus replay for guards that
# classify text"): a guard that classifies free text can regress silently
# when you tune its rules, so ship it with a replay. This hook classifies an
# agent's final message against a phrase list, so it needs one.
#
# What this asserts, on every run:
#   1. Every outcome path writes EXACTLY ONE log line. A guard that fails
#      open without a trace is indistinguishable from a dead guard.
#   2. The log line has five fields, even when the agent's message contains
#      pipes and newlines. Hostile input must not break the grammar.
#   3. A block records WHICH phrase matched. Without that, a block count
#      cannot be told apart from a false-positive count, which is the whole
#      reason this hook got telemetry.
#   4. The hook NEVER exits anything but 0 or 2, whatever it is fed. A stop
#      hook that exits wrong wedges an agent.
#   5. The loop guard still blocks a given agent at most once.
#
# Deliberately included: a KNOWN-GOOD control case. A harness that only ever
# runs failing inputs cannot tell "the guard works" from "the harness never
# ran". If the control stops passing, distrust every other result here.
#
# Run: bash claude/hooks/subagent-stall-check.test.sh
set -u

HOOK="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/subagent-stall-check.sh"
pass=0
fail=0

check() {
    if [ "$2" = "1" ]; then
        echo "PASS  $1"
        pass=$((pass + 1))
    else
        echo "FAIL  $1${3:+  -- $3}"
        fail=$((fail + 1))
    fi
}

# Each case runs against a throwaway project dir, so the loop-guard file and
# the log start empty unless a case deliberately reuses one.
new_root() {
    d=$(mktemp -d 2>/dev/null) || d="${TMPDIR:-/tmp}/stallcheck.$$.$RANDOM"
    mkdir -p "$d/.claude/state"
    printf '%s' "$d"
}

# Runs the hook and leaves the results in rc / logline / nlines.
run_hook() {
    root=$1
    payload=$2
    logf="$root/.claude/state/subagent-stall-check.log"
    before=0
    [ -f "$logf" ] && before=$(wc -l <"$logf" | tr -d ' ')
    printf '%s' "$payload" | CLAUDE_PROJECT_DIR="$root" bash "$HOOK" >/dev/null 2>&1
    rc=$?
    after=0
    [ -f "$logf" ] && after=$(wc -l <"$logf" | tr -d ' ')
    nlines=$((after - before))
    logline=""
    [ -f "$logf" ] && logline=$(tail -n 1 "$logf")
}

field() { printf '%s' "$1" | awk -F'|' -v n="$2" '{print $n}'; }
nfields() { printf '%s' "$1" | awk -F'|' '{print NF}'; }

echo "--- 1. The control: a plainly-finished message must pass clean -------------"
root=$(new_root)
run_hook "$root" '{"agent_id":"a1","agent_type":"worker","last_assistant_message":"Done. Opened PR #7 and the tests are green."}'
check "CONTROL: a finished message is not blocked" "$([ "$rc" = 0 ] && echo 1 || echo 0)" "rc=$rc"
check "CONTROL: it still writes exactly one line" "$([ "$nlines" = 1 ] && echo 1 || echo 0)" "wrote $nlines"
check "CONTROL: outcome is clean" "$([ "$(field "$logline" 3)" = "clean" ] && echo 1 || echo 0)" "$logline"

echo "--- 2. A real stall signature blocks, and says which phrase ----------------"
root=$(new_root)
run_hook "$root" '{"agent_id":"a2","agent_type":"builder","last_assistant_message":"I will be notified when the build completes."}'
check "stall: exits 2 so the agent cannot stop" "$([ "$rc" = 2 ] && echo 1 || echo 0)" "rc=$rc"
check "stall: writes exactly one line" "$([ "$nlines" = 1 ] && echo 1 || echo 0)" "wrote $nlines"
check "stall: outcome is blocked" "$([ "$(field "$logline" 3)" = "blocked" ] && echo 1 || echo 0)" "$logline"
check "stall: target carries the agent id" "$(case "$(field "$logline" 4)" in *a2*) echo 1;; *) echo 0;; esac)" "$logline"
check "stall: reason names the matched phrase" "$(case "$(field "$logline" 5)" in *"will be notified"*) echo 1;; *) echo 0;; esac)" "$logline"

echo "--- 3. The loop guard blocks each agent at most once -----------------------"
run_hook "$root" '{"agent_id":"a2","agent_type":"builder","last_assistant_message":"Still waiting for the notification."}'
check "loop guard: second stop is allowed through" "$([ "$rc" = 0 ] && echo 1 || echo 0)" "rc=$rc"
check "loop guard: still logged" "$([ "$nlines" = 1 ] && echo 1 || echo 0)" "wrote $nlines"
check "loop guard: reason says why it passed" "$(case "$(field "$logline" 5)" in *loop-guard*) echo 1;; *) echo 0;; esac)" "$logline"
check "loop guard: repeat match still records the phrase" "$(case "$(field "$logline" 5)" in *matched:*) echo 1;; *) echo 0;; esac)" "$logline"

echo "--- 4. Grammar holds against hostile input ---------------------------------"
root=$(new_root)
run_hook "$root" '{"agent_id":"a|3\nx","agent_type":"w|t","last_assistant_message":"waiting for a|b\nsecond line"}'
check "grammar: pipes and newlines cannot break the fields" "$([ "$(nfields "$logline")" = "5" ] && echo 1 || echo 0)" "fields=$(nfields "$logline") line=$logline"
check "grammar: still exactly one line" "$([ "$nlines" = 1 ] && echo 1 || echo 0)" "wrote $nlines"
# The relay is read back with a single `read`, which stops at the first
# newline. A newline in the agent id must not truncate the row and drop the
# matched phrase, which is the field this hook gained telemetry to record.
check "grammar: a newline in the agent id does not eat the phrase" "$(case "$(field "$logline" 5)" in *"waiting for"*) echo 1;; *) echo 0;; esac)" "$logline"

echo "--- 5. Every fail-open path leaves a trace ---------------------------------"
root=$(new_root)
run_hook "$root" ''
check "empty stdin: exits 0" "$([ "$rc" = 0 ] && echo 1 || echo 0)" "rc=$rc"
check "empty stdin: logs open:empty-stdin" "$([ "$(field "$logline" 3)" = "open:empty-stdin" ] && echo 1 || echo 0)" "$logline"

root=$(new_root)
run_hook "$root" 'this is not json at all'
check "bad JSON: exits 0" "$([ "$rc" = 0 ] && echo 1 || echo 0)" "rc=$rc"
check "bad JSON: logs a fail-open, not a clean" "$([ "$(field "$logline" 3)" = "open:parse-failure" ] && echo 1 || echo 0)" "$logline"

root=$(new_root)
run_hook "$root" '{"agent_id":"a4","agent_type":"worker"}'
check "no message: exits 0" "$([ "$rc" = 0 ] && echo 1 || echo 0)" "rc=$rc"
check "no message: logs clean with a reason" "$([ "$(field "$logline" 3)" = "clean" ] && echo 1 || echo 0)" "$logline"

echo "--- 6. Telemetry can never wedge the guard ---------------------------------"
# An unwritable state directory must not change the hook's exit code. This is
# the contract that lets a guard log at all: logging fails, guarding does not.
root=$(new_root)
chmod 500 "$root/.claude/state" 2>/dev/null
printf '%s' '{"agent_id":"a5","agent_type":"worker","last_assistant_message":"I will be notified later."}' \
    | CLAUDE_PROJECT_DIR="$root" bash "$HOOK" >/dev/null 2>&1
rc=$?
chmod 700 "$root/.claude/state" 2>/dev/null
check "unwritable log dir: hook still blocks correctly" "$([ "$rc" = 2 ] || [ "$rc" = 0 ] && echo 1 || echo 0)" "rc=$rc"

# A missing helper must not stop the guard from guarding.
root=$(new_root)
tmphooks="$root/hooks"
mkdir -p "$tmphooks"
cp "$HOOK" "$tmphooks/subagent-stall-check.sh"
printf '%s' '{"agent_id":"a6","agent_type":"worker","last_assistant_message":"I will be notified later."}' \
    | CLAUDE_PROJECT_DIR="$root" bash "$tmphooks/subagent-stall-check.sh" >/dev/null 2>&1
rc=$?
check "no hook-log.sh present: guard still blocks" "$([ "$rc" = 2 ] && echo 1 || echo 0)" "rc=$rc"

echo
echo "passed $pass, failed $fail"
[ "$fail" = 0 ] || exit 1
echo "ALL PASS"

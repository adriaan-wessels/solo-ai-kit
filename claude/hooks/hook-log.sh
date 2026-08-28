#!/usr/bin/env bash
# Shared guard-telemetry writer for the kit's SHELL hooks. The JS hooks
# (guardrail.js, pr-merge-gate.js) each carry their own inline equivalent;
# this is the same grammar for the .sh side, so one parser reads every
# guard's log.
#
# Why a guard needs this at all: a guard that fails open without a trace is
# indistinguishable from a guard nobody installed. The log is also the
# evidence for both directions of the two-strikes principle (kit README,
# principle 1) - it is how a guard proves it earned its place, and how a
# guard that never fires shows that it has not.
#
# Usage, sourced from another bash hook:
#
#   HOOKDIR="$(dirname "${BASH_SOURCE[0]}")"
#   . "$HOOKDIR/hook-log.sh" 2>/dev/null || true
#   type hook_log >/dev/null 2>&1 || hook_log() { :; }   # no-op fallback
#   hook_log "<guard>" "<outcome>" "<target>" "<reason>"
#
# The no-op fallback matters: a hook whose helper is missing must still run.
# Telemetry is never allowed to be the reason a guard stops working.
#
# Grammar, five fields, documented in claude/README.md:
#
#   timestamp|guard|outcome|target|reason
#
# Separated by a bare pipe with no spaces, because a parser splitting on '|'
# is the cheapest reader there is. Every field is sanitised on the way in:
# pipes, tabs, carriage returns and newlines become spaces, so no input can
# break the grammar. Keep this in step with claude/README.md and with the
# JS hooks; guardrail.test.js asserts the field count, so the test is the
# spec.
#
# Outcome vocabulary, four values:
#   blocked        the guard stopped the action
#   clean          the guard ran, checked, and found nothing to do
#   open:<reason>  the guard failed open or skipped its check
#   override       an explicit human override bypassed the guard
#
# Anything finer belongs in the reason field, not in a new outcome value.
# A vocabulary that grows per-guard stops being parseable.
#
# Log file: .claude/state/<guard>.log, matching the per-guard convention the
# JS hooks already use. Rotation trims to the newest 3000 lines once the file
# passes 4000. The gap between the two is deliberate: rotating at exactly the
# cap would re-trim on every call once a busy run sits at it.
#
# CONTRACT: hook_log must NEVER change the caller's exit code or control
# flow, and must always return 0. Every step is best-effort. An unwritable
# state directory is not the calling guard's problem.
#
# Concurrency: this is a best-effort append, not a transactional log. Two
# hooks logging at the same moment can race and lose a line. That is an
# accepted trade-off for staying lock-free on a hook path, not a guarantee.

hook_log() {
    # Subshell plus the trailing `|| true`: nothing in here can escape to the
    # caller, including a `set -e` in the sourcing hook.
    (
        _hl_guard=${1:-unknown}
        _hl_outcome=${2:-unknown}
        _hl_target=${3:-}
        _hl_reason=${4:-}

        # Field separators and newlines cannot survive inside a field.
        _hl_clean() {
            printf '%s' "$1" | tr '|\t\r\n' '    '
        }

        _hl_guard=$(_hl_clean "$_hl_guard")
        _hl_outcome=$(_hl_clean "$_hl_outcome")
        _hl_target=$(_hl_clean "$_hl_target")
        _hl_reason=$(_hl_clean "$_hl_reason")

        # An empty field would collapse two separators together and shift
        # every later field left, so empties become a placeholder.
        [ -n "$_hl_target" ] || _hl_target="-"
        [ -n "$_hl_reason" ] || _hl_reason="-"

        _hl_state="${CLAUDE_PROJECT_DIR:-.}/.claude/state"
        _hl_log="$_hl_state/$_hl_guard.log"

        mkdir -p "$_hl_state" 2>/dev/null || exit 0

        # One `date` fork per invocation. These hooks already fork an
        # interpreter, so this is not a hot path worth optimising, and a
        # readable timestamp is worth more than the saved microseconds.
        _hl_ts=$(date -u +%Y-%m-%dT%H:%M:%SZ 2>/dev/null) || _hl_ts="unknown"

        printf '%s|%s|%s|%s|%s\n' \
            "$_hl_ts" "$_hl_guard" "$_hl_outcome" "$_hl_target" "$_hl_reason" \
            >>"$_hl_log" 2>/dev/null || exit 0

        # Rotation. Counting lines is cheap next to the interpreter fork the
        # calling hook has already paid for.
        _hl_lines=$(wc -l <"$_hl_log" 2>/dev/null) || exit 0
        _hl_lines=${_hl_lines// /}
        case "$_hl_lines" in
            ''|*[!0-9]*) exit 0 ;;
        esac
        if [ "$_hl_lines" -gt 4000 ]; then
            _hl_tmp="$_hl_log.$$"
            if tail -n 3000 "$_hl_log" >"$_hl_tmp" 2>/dev/null; then
                mv -f "$_hl_tmp" "$_hl_log" 2>/dev/null || rm -f "$_hl_tmp" 2>/dev/null
            else
                rm -f "$_hl_tmp" 2>/dev/null
            fi
        fi
        exit 0
    ) 2>/dev/null || true
    return 0
}

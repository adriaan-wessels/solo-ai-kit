#!/usr/bin/env bash
# Stop hook (project): after a push, surface any NON-green CI run for the
# current HEAD, so a red or in-progress CI can't slip by unnoticed.
#
# This is the "guardrails that convert founder absence into throughput"
# piece from the solo-ai-kit README (practice 5) — it's what makes
# "verify CI after pushing" an enforced habit instead of a rule an agent can
# forget to follow.
#
# Design notes:
#  - Fails quietly (exit 0) at every step — it must NEVER block a turn.
#  - Only does the network call when HEAD is actually pushed (not ahead of
#    upstream) AND the HEAD commit is < 30 min old, so it doesn't run `gh` on
#    every single stop.
#  - Only emits when something is failing / in-progress; all-green stays silent.
#  - Runs from the project root (the hook's working directory).
gh=$(command -v gh 2>/dev/null); [ -n "$gh" ] || gh='/c/Program Files/GitHub CLI/gh.exe'
[ -x "$gh" ] || exit 0
ahead=$(git rev-list --count '@{u}..HEAD' 2>/dev/null) || exit 0
[ "$ahead" = 0 ] || exit 0                         # unpushed / no upstream -> nothing to report yet
ct=$(git log -1 --format=%ct HEAD 2>/dev/null) || exit 0
[ $(( $(date +%s) - ct )) -lt 1800 ] || exit 0     # only within 30 min of the commit
b=$(git rev-parse --abbrev-ref HEAD 2>/dev/null) || exit 0
s=$(git rev-parse --short=7 HEAD 2>/dev/null) || exit 0
out=$("$gh" run list --branch "$b" --limit 10 \
  --json workflowName,status,conclusion,headSha \
  --jq "[.[]|select(.headSha[0:7]==\"$s\")]|group_by(.workflowName)|map(.[0])|map(select(.conclusion!=\"success\"))|map(\"\(.workflowName): \(if .status==\"completed\" then .conclusion else .status end)\")|join(\" | \")" 2>/dev/null) || exit 0
[ -n "$out" ] || exit 0                            # all green for HEAD -> stay silent
printf '{"systemMessage":"⚠ CI for %s @ %s — %s. Verify before treating the push as done."}' "$b" "$s" "$out"

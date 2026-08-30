#!/bin/bash
# Harness for scripts/mutation-clock-check.sh. The red cases are the
# controls: a clock that cannot go red is not a clock.
#
# Fixtures are GENERATED with dates relative to today, never derived
# from the live ledger. Round 3's catch: sed-derived fixtures went
# silently vacuous the moment a new ledger entry landed, and the
# harness then failed in the reassuring direction ("the guards stopped
# working") when only its fixtures had gone stale.
#
# The live ledger appears in exactly ONE case, at a staleness-immune
# budget. The staleness assertion itself lives in mutation-clock.yml,
# where a standing red is the design; the required CI check that runs
# this file must never inherit the clock's red (round 3's other catch:
# the old real-ledger-at-real-budget control would have blocked every
# PR in the repo the day the ledger aged out).
#
# Run from the repo root:  bash scripts/mutation-clock-check.test.sh
set -u

CHECK="${MUTATION_CLOCK_CHECK_PATH:-scripts/mutation-clock-check.sh}"
LEDGER=.github/mutation-ledger.md

TODAY=$(date -u +%F)
OLD=$(date -u -d "-200 days" +%F)
FUTURE=$(date -u -d "+200 days" +%F)
[ -n "$TODAY" ] && [ -n "$OLD" ] && [ -n "$FUTURE" ] || { echo "FAIL  date generation broke; every fixture below would be vacuous"; exit 1; }

fail=0
passes=0

expect() { # expect <green|red> <label> <ledger> <budget>
  want="$1"; label="$2"; ledger="$3"; budget="$4"
  out=$(bash "$CHECK" "$ledger" "$budget" 2>&1)
  rc=$?
  if [ "$rc" -eq 0 ]; then got=green; else got=red; fi
  if [ "$got" = "$want" ]; then
    echo "PASS  $label ($want)"
    passes=$((passes + 1))
  else
    echo "FAIL  $label: wanted $want, got $got"
    printf '%s\n' "$out" | sed 's/^/      /'
    fail=1
  fi
}

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

entry() { # entry <date> -> a complete dated entry with a Result line
  printf '## %s\n\n- Campaign: fixture.\n- Result: fixture result line.\n' "$1"
}
header() {
  printf '# Fixture ledger\n\n## Method\n\nFrozen method text.\n\n'
}

# Control first, plus a generation control: the fresh fixture must carry
# today's heading, or every case below tests nothing.
{ header; entry "$TODAY"; } > "$TMP/fresh.md"
grep -q "^## $TODAY\$" "$TMP/fresh.md" || { echo "FAIL  generation control: fresh fixture lacks today's heading"; exit 1; }
expect green "CONTROL: fresh generated entry" "$TMP/fresh.md" 45

{ header; entry "$OLD"; } > "$TMP/stale.md"
expect red "stale entry" "$TMP/stale.md" 45

: > "$TMP/empty.md"
expect red "empty ledger" "$TMP/empty.md" 45
expect red "missing ledger" "$TMP/does-not-exist.md" 45

{ header; entry "$FUTURE"; } > "$TMP/future.md"
expect red "future-dated entry" "$TMP/future.md" 45

{ header; entry "2026-02-30"; } > "$TMP/impossible.md"
expect red "calendar-impossible date" "$TMP/impossible.md" 45

# A fenced fresh date over a stale entry must not reset the clock.
{ header; entry "$OLD"; printf '\n## How to append\n\n```\n## %s\n- Result: example only\n```\n' "$TODAY"; } > "$TMP/fenced.md"
expect red "fenced example does not reset" "$TMP/fenced.md" 45

# A '## <date> notes' heading is not an entry.
{ header; printf '## %s notes\n\n- Result: on a suffixed heading.\n' "$TODAY"; } > "$TMP/suffixed.md"
expect red "suffixed heading is not an entry" "$TMP/suffixed.md" 45

# A dated entry with no Result line must not reset the clock.
{ header; printf '## %s\n\n- Deferred: no campaign run, nothing was measured.\n' "$TODAY"; } > "$TMP/noresult.md"
expect red "dated entry without evidence" "$TMP/noresult.md" 45

# Round-2 bypass fixtures: a sibling suffixed heading must not donate
# its Result line, and a fenced Result inside the entry must not count.
{ cat "$TMP/noresult.md"; printf '\n## %s notes\n\n- Result: donated by a sibling heading.\n' "$TODAY"; } > "$TMP/sibling.md"
expect red "sibling heading cannot donate a Result" "$TMP/sibling.md" 45

{ header; printf '## %s\n\n```\n- Result: fenced, does not count.\n```\n' "$TODAY"; } > "$TMP/fencedresult.md"
expect red "fenced Result does not count" "$TMP/fencedresult.md" 45

expect red "non-integer budget" "$TMP/fresh.md" abc
expect red "empty budget" "$TMP/fresh.md" ""
expect red "zero budget" "$TMP/fresh.md" 0

# The live ledger, structurally: entry present, Result present, date
# real and not in the future. Budget 3650 keeps this staleness-immune;
# the age-vs-45 assertion belongs to mutation-clock.yml alone.
expect green "real ledger is structurally sound (staleness-immune budget)" "$LEDGER" 3650

echo ""
if [ "$fail" -ne 0 ]; then
  echo "FAILURES above: the clock is not the evidence it claims to be"
  exit 1
fi
echo "passed $passes, failed 0"
echo "ALL PASS"

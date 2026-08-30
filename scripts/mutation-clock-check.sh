#!/bin/bash
# mutation-clock-check.sh [ledger] [budget-days]
#
# The mutation clock's decision logic, extracted from
# .github/workflows/mutation-clock.yml so ONE source feeds the workflow
# and the committed harness (scripts/mutation-clock-check.test.sh). The
# review rounds on the clock PR had to hand-extract this step to test
# it, and a hand extraction drifts; this file removes that class.
#
# Exit 0 = clock green. Any other exit = red, with a ::error:: line.
set -eu

# ${N-default}, not ${N:-default}: an EMPTY argument must reach the
# guards below and go red, not silently become the default. The harness
# caught the :- form turning an empty budget green on its first run.
LEDGER="${1-.github/mutation-ledger.md}"
BUDGET_DAYS="${2-45}"

case "$BUDGET_DAYS" in
  ''|*[!0-9]*|0)
    echo "::error::BUDGET_DAYS='$BUDGET_DAYS' is not a positive integer; a clock with a broken dial must not read green"
    exit 1;;
esac
[ -s "$LEDGER" ] || { echo "::error::$LEDGER is missing or empty; the clock has nothing to read"; exit 1; }

# One fence-stripping pass feeds BOTH scans below. Review round 2 found
# the Result scan fence-blind while the date scan was not; a single
# stripped body closes that class instead of patching one scan.
body=$(awk '/^```/ { fence = !fence; next } !fence' "$LEDGER")

newest=$(printf '%s\n' "$body" | grep -E '^## [0-9]{4}-[0-9]{2}-[0-9]{2}$' | cut -d' ' -f2 | sort | tail -n 1)
[ -n "$newest" ] || { echo "::error::no '## YYYY-MM-DD' entry outside a code fence in $LEDGER; a clock with no start time is vacuous"; exit 1; }

now=$(date -u +%s)
newest_epoch=$(date -u -d "$newest" +%s 2>/dev/null) || { echo "::error::the newest ledger entry ($newest) is not a real calendar date"; exit 1; }
if [ "$newest_epoch" -gt "$now" ]; then
  echo "::error::the newest ledger entry ($newest) is in the future; a forward-dated entry must not quiet the clock"
  exit 1
fi
age=$(( (now - newest_epoch) / 86400 ))
echo "newest blind run: $newest (${age} days ago; budget ${BUDGET_DAYS} days)"

# Exact heading match: a sibling '## <date> notes' heading must not open
# the entry's block and donate its Result line (review round 2's catch;
# the first cut used a prefix match).
printf '%s\n' "$body" | awk -v d="## $newest" '
  $0 == d { in_entry = 1; next }
  /^## / { in_entry = 0 }
  in_entry && /^- Result:/ { found = 1 }
  END { exit found ? 0 : 1 }
' || { echo "::error::the newest entry ($newest) has no '- Result:' line outside a code fence; a date is not evidence and must not reset the clock"; exit 1; }

if [ "$age" -gt "$BUDGET_DAYS" ]; then
  echo "::error::the newest blind mutation run is ${age} days old (budget ${BUDGET_DAYS}). Owner: the next agent session in this repo. Run a fresh campaign per the method in $LEDGER and append its dated entry."
  exit 1
fi

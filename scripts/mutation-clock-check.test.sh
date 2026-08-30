#!/bin/bash
# Harness for scripts/mutation-clock-check.sh. The red cases are the
# controls: a clock that cannot go red is not a clock, and a fixture
# whose mutation never applied reports as the reassuring result, so each
# synthetic fixture carries an applied-control grep.
#
# Run from the repo root:  bash scripts/mutation-clock-check.test.sh
set -u

CHECK="${MUTATION_CLOCK_CHECK_PATH:-scripts/mutation-clock-check.sh}"
LEDGER=.github/mutation-ledger.md
NEWEST_RE='^## 2026-08-28$'

fail=0
passes=0

expect() { # expect <green|red> <label> <ledger> <budget>
  want="$1"; label="$2"; ledger="$3"; budget="$4"
  if bash "$CHECK" "$ledger" "$budget" >/dev/null 2>&1; then got=green; else got=red; fi
  if [ "$got" = "$want" ]; then
    echo "PASS  $label ($want)"
    passes=$((passes + 1))
  else
    echo "FAIL  $label: wanted $want, got $got"
    fail=1
  fi
}

applied() { # applied <label> <pattern> <file>
  if grep -q "$2" "$3"; then return 0; fi
  echo "FAIL  fixture control never applied: $1"
  fail=1
  return 1
}

[ -s "$LEDGER" ] || { echo "FAIL  real ledger missing; harness cannot run"; exit 1; }
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

# Control first: the real ledger must be green, or nothing below means
# anything.
expect green "CONTROL: real ledger, real budget" "$LEDGER" 45

sed 's/^## 2026-08-28$/## 2026-01-01/' "$LEDGER" > "$TMP/stale.md"
applied "stale" '^## 2026-01-01$' "$TMP/stale.md" && expect red "stale entry" "$TMP/stale.md" 45

: > "$TMP/empty.md"
expect red "empty ledger" "$TMP/empty.md" 45
expect red "missing ledger" "$TMP/does-not-exist.md" 45

sed 's/^## 2026-08-28$/## 2099-01-01/' "$LEDGER" > "$TMP/future.md"
applied "future" '^## 2099-01-01$' "$TMP/future.md" && expect red "future-dated entry" "$TMP/future.md" 45

sed 's/^## 2026-08-28$/## 2026-02-30/' "$LEDGER" > "$TMP/impossible.md"
applied "impossible" '^## 2026-02-30$' "$TMP/impossible.md" && expect red "calendar-impossible date" "$TMP/impossible.md" 45

# A fenced doc example carrying a fresh date over a stale real entry: the
# fenced date must not reset the clock.
{ sed 's/^## 2026-08-28$/## 2026-01-01/' "$LEDGER"; printf '\n## How to append\n\n```\n## 2099-12-31\n- Result: example only\n```\n'; } > "$TMP/fenced.md"
applied "fenced" '^## 2099-12-31$' "$TMP/fenced.md" && expect red "fenced example does not reset" "$TMP/fenced.md" 45

# A '## <date> notes' heading is not an entry.
sed 's/^## 2026-08-28$/## 2026-08-28 notes/' "$LEDGER" > "$TMP/suffixed.md"
applied "suffixed" '^## 2026-08-28 notes$' "$TMP/suffixed.md" && expect red "suffixed heading is not an entry" "$TMP/suffixed.md" 45

# A fresh entry with no Result line must not reset the clock.
{ cat "$LEDGER"; printf '\n## 2026-08-30\n\n- Deferred: no campaign run, nothing was measured.\n'; } > "$TMP/noresult.md"
applied "noresult" '^## 2026-08-30$' "$TMP/noresult.md" && expect red "dated entry without evidence" "$TMP/noresult.md" 45

# Round-2 bypass fixtures: a sibling suffixed heading must not donate its
# Result line to the newest entry, and a fenced Result inside the entry
# must not count.
{ cat "$TMP/noresult.md"; printf '\n## 2026-08-30 notes\n\n- Result: donated by a sibling heading.\n'; } > "$TMP/sibling.md"
applied "sibling" '^## 2026-08-30 notes$' "$TMP/sibling.md" && expect red "sibling heading cannot donate a Result" "$TMP/sibling.md" 45

{ cat "$LEDGER"; printf '\n## 2026-08-30\n\n```\n- Result: fenced, does not count.\n```\n'; } > "$TMP/fencedresult.md"
applied "fencedresult" '^- Result: fenced, does not count.$' "$TMP/fencedresult.md" && expect red "fenced Result does not count" "$TMP/fencedresult.md" 45

expect red "non-integer budget" "$LEDGER" abc
expect red "empty budget" "$LEDGER" ""
expect red "zero budget" "$LEDGER" 0
expect green "wide budget stays green on a fresh ledger" "$LEDGER" 3650

echo ""
if [ "$fail" -ne 0 ]; then
  echo "FAILURES above: the clock is not the evidence it claims to be"
  exit 1
fi
echo "passed $passes, failed 0"
echo "ALL PASS"

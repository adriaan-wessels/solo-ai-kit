# Blind mutation-run ledger

One entry per completed blind mutation campaign against the kit's hooks.
The newest entry's date is what `.github/workflows/mutation-clock.yml`
reads. When that date is older than the budget (90 days), the workflow
goes red and stays red until a fresh campaign lands its entry here.

Why a ledger and not a reminder: a note that says "re-run the mutation
campaign sometime" is the form with the proven failure record (README,
principle 1). The workflow makes the cadence mandatory; this file is the
record it reads. Red here is a tripwire with mandatory consumption: a
green baseline, an owner (the next agent session in this repo, routed by
the founder), and a clock (the weekly schedule), which is what principle
6 requires before a non-blocking check counts.

## Method, frozen from the first run (PR #55)

Agents that wrote neither the hook nor its suite write injection lists
from the implementation, its comments, and the READMEs, and are blocked
from reading any test file. The agents that propose injections do not
run them; applying and scoring is mechanical, so no result is
self-reported. Every kept assertion is verified both ways before it
lands: it passes against current code and fails against its mutant.
Four controls, each of which has burned this repo at least once: the
unmutated suite is green first; the mutation must actually change the
file; the find string must be unique; the mutant must still parse.

## 2026-08-28

- Campaign: six blind agents against `guardrail.js` and
  `session-start.js` (PR #55, merged 2026-08-28).
- Result: 55 injections; 29 caught, 15 not caught, 10 unapplied, 1
  syntax-break. 66% of the scorable set caught. Ten of the fifteen
  misses were silent-bypass severity.
- Consumed: all 15 gaps closed as paired assertions. `guardrail.test.js`
  gained a `--prove` mode it never had (10 defects);
  `session-start.selftest.js`'s grew from 7 to 12.
- Not covered: `pr-merge-gate.js` has had no blind campaign yet; its
  `--prove` list is author-written. The next campaign owes it one.

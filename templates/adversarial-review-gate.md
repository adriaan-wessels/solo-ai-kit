# Pre-merge adversarial review gate — trial protocol template

A per-PR review gate that runs before auto-merge arms. Two prompted
reviewers attack the diff from the two angles that per-PR CI cannot
cover. This is different from a periodic review pass (the overnight
review's fleets): the gate is per-PR and blocking; the fleets are
periodic and catch-and-report.

**Run it as a trial first.** The kit's rule applies (kit README,
"Periodic reviews"): a new process idea runs as a bounded trial with a
ledger, and the founder then decides adopt / tune / drop. Do not write
it into `CLAUDE.md` as a standing rule before that decision.

## Why this gate exists

Evidence from the source project: real shipped bugs clustered in two
classes that compile checks and per-PR tests pass over, but a prompted
reviewer can catch.

1. **Feature-interaction effects.** Each feature is individually correct
   and tested. The combination is broken.
2. **Contract-boundary assumptions.** The diff compiles and tests green,
   but it depends on live state nobody checked: a database policy, a
   storage path, a CI assumption, a documented claim.

The source project's trial: two builder waves, five would-ship P1 bugs
stopped, zero false-positive blocks. The founder adopted the gate as a
standing rule on 2026-08-14.

## Protocol

**Scope.** Every PR in a builder wave, and any PR that mutates user data
or a founder-decided surface. Exempt: docs-only, test-only,
dependency-bump, and release-bump PRs.

**Timing.** After the builder's targeted verification is green, and
BEFORE auto-merge is armed. The gate is coordinator work. A builder's
deliverable ends at PR-open plus targeted verification green; builders
never arm auto-merge themselves.

**Reviewers.** The coordinator spawns two strong-model reviewers (high
reasoning effort) against the PR diff plus its issue context:

- **R1 — interaction reviewer (always runs):** "Enumerate every existing
  feature or surface this change interacts with: <PLACEHOLDER: the
  project's interacting surfaces, e.g. filters, saved views, undo, sync,
  widgets, routing>. For each, reason about the COMBINED behavior — the
  product of features, not the diff in isolation — and try to construct
  a concrete broken interleaving. Report only reachable, evidenced
  findings."
- **R2 — boundary reviewer (runs only when the diff touches an external
  contract):** "List every contract this diff depends on outside the
  compile boundary: <PLACEHOLDER: the project's boundaries, e.g. live DB
  columns and policies (name the VERB), storage paths, platform
  channels, preference keys, CI/workflow assumptions, user-facing doc
  claims>. For each: prove it holds (cite where), or flag it as
  unverified."

**Disposition.**

- Confirmed P0/P1 → blocking. The builder fixes before merge. A fix that
  changes behavior gets one verifier re-review before arming.
- P2/P3 or advisory → note on the PR; file an issue if warranted; do not
  block.
- Reviewer disagreement → the coordinator adjudicates.
- Every confirmed finding is filed or routed. Nothing confirmed goes
  unconsumed.

## Trial ledger (the coordinator reports, per wave)

Per PR: findings by severity; confirmed-real vs false-positive after
adjudication; whether it would have reached the default branch otherwise
(did CI and tests also miss it); wall-clock latency added; token cost.
Then wave totals and a one-paragraph recommendation.

## Decision rule

The founder reads the ledger and decides: adopt as a standing
`CLAUDE.md` rule (a normative edit, founder sign-off), tune the prompts,
or drop. Record the decision on the trial's issue. The issue is the
decision-of-record; a standing rule then points at it instead of
restating it.

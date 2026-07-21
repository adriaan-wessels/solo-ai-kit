---
name: overnight-review
description: >-
  Integrated overnight (AFK) hardening pass for <PLACEHOLDER: project name>.
  Lands the safe dev work, gates on the expensive test layer with flake-triage,
  then fans out parallel fleets for <PLACEHOLDER: N>-platform user testing, a
  multi-angle code & product review, and a testing-systems/methodology review
  — catch-and-report to <PLACEHOLDER: the tracker/board, e.g. "the GitHub
  Project board">. Use when you want a thorough unattended review/hardening
  run before daily-driving the product (typically kicked off while the
  founder is AFK/asleep). Optional args: scope=full|review|usertest|testing|
  nomerge, fix=report|tests (see "Arguments"). Sibling to the
  issue-triage-to-milestones workflow.
---

# Overnight integrated review

<!--
  Generalized from Sortomate's overnight-review skill for the solo-ai-playbook
  kit — see claude/README.md for how this fits. Every <PLACEHOLDER: ...> below
  needs a real value for this project before the skill is fully useful; the
  surrounding STRUCTURE (land safe work → gate on the expensive test layer
  with flake triage → fan out user-test/review/testing-methodology fleets →
  catch-and-report to the tracker) is what should carry over unchanged.
-->

A single end-to-end pass, run while the founder is asleep or away, that lands
the safe work and then preemptively catches everything that would add
friction when the founder next uses the product. Three workstreams run
against one integrated <PLACEHOLDER: default branch name, e.g. "main">: (A)
user testing, (B) a multi-angle code & product review, (C) a review of the
testing systems themselves. **Catch-and-report**, leverage-weighted,
evidence-based — not coverage theater, and no unattended changes beyond the
safe merges defined below.

## How this runs

This is the high-level brief; the orchestrator owns the judgment-heavy phases
(merge decisions, test-layer flake-triage, final synthesis) and
**authors/runs sub-agent fan-out for the deterministic phases** — the review
fleet's lens x adversarial-verify x loop-until-dry pattern is a natural
fan-out. The sibling `issue-triage-to-milestones` workflow is the same
Gather -> Lenses -> Synthesis pattern applied to planning instead of review;
if you want this run's fan-out *pinned* (same agents/stages every night),
extract it into a named workflow the same way.

## Arguments

Default (no args) = the **full** integrated run below. Otherwise interpret
loosely:

- `scope=review` — only workstream (B), the code & product review, on
  current <PLACEHOLDER: default branch>.
- `scope=usertest` — only workstream (A), the multi-platform user testing.
- `scope=testing` — only workstream (C), the testing-systems/methodology
  review.
- `scope=nomerge` — skip Phase 1; review/test the current branch as-is.
- `fix=tests` — in addition to catch-and-report, author the highest-leverage
  *missing tests* on branches/PRs (never directly to the default branch).
  Default `fix=report` = report-only.

---

## GOAL

While the founder is away, run an end-to-end pass that lands the safe work
and preemptively catches friction the founder would otherwise hit.
Catch-and-report, leverage-weighted, evidence-based.

## GROUND TRUTH

Verify behavior against the running code (<PLACEHOLDER: source root, e.g.
`src/`>) and the open issues on <PLACEHOLDER: tracker/board> — **NOT** any
historical spec/design docs that the code has since diverged from
intentionally. Don't flag intentional divergence from a stale doc as a bug;
flag the doc as stale instead (and fix it if the divergence is purely
descriptive — see the "don't relitigate" guidance in the kit README, practice
7, for the difference between a descriptive fix and a normative one that
needs the founder's sign-off).

## PHASE 1 — Land the work

Work down the open dev items (in-progress cards on the board, the founder's
open PR branches) and merge what's genuinely safe: CI green, no conflicts,
rebased on <PLACEHOLDER: default branch>, and re-verify the **combined**
state after each merge (parallel PRs that pass alone can red the integration
branch via a shared field/resource).

**Never push the default branch directly. <PLACEHOLDER: any irreversible
manual-only action for this project, e.g. "live production-DB schema
changes"> stays with the founder.** You MAY merge UI/UX work, but ONLY where
the founder previously approved that specific change — i.e. the issue/PR
thread carries the founder's sign-off, or it implements a mockup the founder
already approved (see kit README practice 7). If the approval trail is
unclear or absent, treat it as not approved and leave it for the founder. The
rest of the safe-merge bar still applies (CI green, no conflicts, rebased,
combined-state re-verified).

The result is the **integrated branch**: the canonical artifact every
workstream runs against. List what you couldn't merge (conflicts, red CI,
UI/DDL needing the founder) so the tested build is understood as
"<PLACEHOLDER: default branch> minus those," not all outstanding work.

## PHASE 2 — Expensive-test-layer gate (triage, don't stall)

Run the <PLACEHOLDER: E2E/integration suite name> against the merged,
integrated branch. If it has known reliability constraints (a shared test
account, serialization, credential drift, infra flakiness), triage a red
rather than blocking the whole run on it:

- **green** -> build off the integrated branch, start user testing.
- **flake/infra red** (known, already-tracked flake causes) -> note it,
  proceed with user testing anyway.
- **real regression, safely fixable** (non-UI, non-DDL, clear root cause) ->
  fix, re-run, proceed.
- **real regression, not safely fixable unattended** -> file a P0, test the
  unaffected areas (or hold) and say which. Never silently do nothing.

The code review (B) and testing-systems review (C) **don't wait on this
gate** — start them on the integrated branch immediately, in parallel.

## PHASE 3 — The three workstreams (parallel)

### (A) User testing — <PLACEHOLDER: N> platforms, real flows

Drive what's actually drivable: <PLACEHOLDER: the automated
UI-driving/integration-test harness available for this project and which
platforms/targets it can reach>, plus the unit/widget suite, plus a close
read of the UI code against the open issues. Say explicitly what you
could **not** exercise (e.g. a physical device, a canvas-rendered surface
that automation can't click) and cover those by code-reading instead. Hunt
corner/weird cases, illogical or inconsistent behavior, rough edges, and
anything off the product's stated philosophy. Prioritize the critical
journeys: <PLACEHOLDER: list this project's critical user journeys, e.g.
"create -> primary action -> verify result", "auth/sign-in", "data
export/import">.

### (B) Code & product review — fan out across these lenses (each a distinct angle)

<!-- The lens list below is Sortomate's, generalized. Prune/extend it for
     your own stack and product — the shape (a fixed set of independent,
     named lenses, each producing evidence-based findings) is what matters. -->

1. **Security** — authz/access-control, secrets, injection, any encryption/
   escrow model in use.
2. **Performance** — hot paths, unnecessary re-renders/recomputation, query
   cost.
3. **Correctness & usability** — logic bugs, edge cases, confusing UX.
4. **Data integrity & sync** — if the product is offline-first or
   multi-device: reconcile/merge logic, delete-propagation correctness,
   conflict resolution, migration safety, backup/restore correctness. Weight
   this lens heavily if data loss is the worst possible outcome for users.
5. **Accessibility & input** — keyboard operability, screen-reader semantics,
   contrast; respect that accessibility minimums are defaults a user may opt
   *below*, never hard floors, if that's this project's policy.
6. **Cross-platform parity** — if the product ships to more than one
   platform from one codebase: feature + visual parity, density/layout
   adaptation.
7. **Errors, observability & crash-reporting** — how failures surface,
   graceful degradation, logging hygiene, crash-reporting readiness.
8. **Dependencies & licensing** — outdated/vulnerable packages, license
   compatibility.
9. **Build & release pipeline** — release-build hygiene: signing, any
   test-only code paths staying OUT of production bundles, the actual
   build/deploy scripts.
10. **Privacy & data-handling** — access isolation between users/tenants,
    what's encrypted vs. plaintext at rest, privacy-notice readiness.
11. **Design & philosophy coherence** — does the UI live up to the product's
    stated design principles/style guide (<PLACEHOLDER: link the project's
    style guide or design-principles doc if one exists>). Two failure modes,
    reported differently: (a) the *style guide* is descriptively stale (a
    token/value that shipped isn't reflected in the doc) — fix the guide,
    that's a safe descriptive edit; (b) the *code* violates a normative rule
    in the guide — report the code as the defect; never resolve a normative
    conflict by quietly editing the rule to match the code (that's a founder
    decision).
12. **Docs/help vs. behavior** — does user-facing documentation match shipped
    behavior; copy/terminology consistency.

### (C) Testing-systems & methodology review — the whole pyramid + the process

Be evidence-based: run the fast test layers for timings + failures, generate
coverage if the tooling supports it, inventory tests per layer, grep for
skipped/disabled tests, and read recent CI history for flake rate +
durations. Assess the expensive test layer(s) by design + CI history rather
than full re-runs if re-running them is itself costly/flaky.

**Regression-catch probe (the key test):** for the highest-stakes logic in
the product (<PLACEHOLDER: e.g. "the core scoring/ranking function", "sync/
reconcile", "auth">) — would the suite actually catch a real regression?
Where the environment allows, prove it: mutate the function in a **throwaway
worktree/branch**, run the suite, and see if it reds — then discard, never
touch the integrated branch. Where that's not practical, assess by reading
whether a test actually *asserts* the behavior a break would change, versus
just smoke-testing that it runs without throwing.

**Lenses:** coverage & gaps; pyramid shape & test-level selection (per the
kit README's Definition of Done — prefer cheap unit/widget coverage over
piling onto the slow/brittle top layer); test quality/assertions; reliability
& determinism (known flake sources, anything that poisons the *next* test if
one hangs); CI/CD gaps (anything the main test job doesn't cover that has
shipped a real regression before, PRs that get zero CI due to how the
pipeline is triggered, deploy-ordering if any test hits a live external
system); local feedback loop & fake-vs-real fidelity (a fake/mocked
integration layer vs. what production actually does); methodology/DoD
adherence + bug -> regression-test discipline + brittleness to unrelated
changes (e.g. a test locator that breaks on a copy/label edit that has
nothing to do with what the test is actually checking).

## METHOD (all workstreams)

- **Evidence-based:** ground every claim in something you ran or read.
- **Adversarially verify before it reaches the founder:** an independent
  skeptic challenges each finding/recommendation — real, reproducible, and
  high-leverage, or cargo-cult that adds maintenance burden without reducing
  real risk? Kill the theater. Use diverse lenses per finding (correctness,
  security, reproducibility, product-philosophy-fit) rather than N identical
  checks.
- **Scale to a single-founder project that prizes minimalism:** the bar is
  "would a senior engineer say this materially reduces real risk for where
  this product is," not a coverage percentage or enterprise ceremony.
- **Catch-and-report, don't rewrite unattended:** file survivors to the
  tracker's backlog, deduped against existing open issues, each with a
  severity and the layer/lens. The review/test fleets surface issues — they
  don't edit the product: no new fixes or UI changes from them beyond a
  safely-fixable regression caught in Phase 2. (Merging the founder's
  previously-approved UI dev in Phase 1 is fine; the fleets inventing new UI
  changes is not.) If invoked with `fix=tests`, the fleets may additionally
  author the highest-leverage *missing tests* on branches/PRs, never to the
  default branch.

## BUDGET / MODELS / STOPPING

Budget is not a constraint — optimize for thoroughness and verification
depth, not speed or economy. Go wide and deep: large finder/reviewer pools,
multi-vote adversarial verification per finding, and loop the
find-then-verify cycle until two consecutive rounds surface nothing new. Use
your strongest available model at high reasoning effort for the
judgment-heavy stages — adversarial verification, security/data-integrity
reasoning, the regression-catch and "does this feel off / off-philosophy"
calls, and final synthesis/triage. Use a faster/cheaper tier for the
mechanical sweeps (enumerating files, running suites, collecting logs,
parsing CI timings).

## AFK + DELIVERABLE

The founder is away — use best judgement on sticking points; if stuck, move
on rather than waiting. Keep the tracker/board live as you file. Leave ONE
integrated report:

- Executive summary + a maturity scorecard (one rating + one line per review
  lens and for the testing system).
- P0/P1/P2 findings with evidence and filed-issue links, deduped, grouped by
  workstream/lens, with a "highest-leverage 10" call-out across everything.
- Regression-catch probe results per critical path (protected/unprotected).
- What you couldn't test or assess, and why.

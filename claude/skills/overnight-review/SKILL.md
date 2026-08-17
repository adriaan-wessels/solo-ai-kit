---
name: overnight-review
description: >-
  Integrated overnight (AFK) hardening pass for <PLACEHOLDER: project name>.
  Lands the safe dev work, gates on the expensive test layer with flake-triage,
  then fans out parallel fleets for <PLACEHOLDER: N>-platform user testing, a
  multi-angle code & product review, and an engineering-system review
  (delivery + testing) — catch-and-report to <PLACEHOLDER: the tracker/board,
  e.g. "the GitHub Project board">. Use when you want a thorough unattended
  review/hardening run before daily-driving the product (typically kicked off
  while the founder is AFK/asleep). Opens with a Phase-0 gate asking four
  write-authority questions (merge? fix regressions? author missing tests?
  sweep dead branches?) before the founder goes AFK. Optional args pre-answer
  the gate for scheduled runs: scope=full|review|usertest|testing|nomerge,
  merge=yes|no, regressionfix=yes|no, fix=report|tests|ask,
  hygiene=apply|report|no (see "Arguments"). Sibling to the
  issue-triage-to-milestones workflow.
---

# Overnight integrated review

<!--
  Generalized from Sortomate's overnight-review skill for the solo-ai-playbook
  kit — see claude/README.md for how this fits. Every <PLACEHOLDER: ...> below
  needs a real value for this project before the skill is fully useful; the
  surrounding STRUCTURE (ask the write-authority gate -> land safe work -> gate
  on the expensive test layer with flake triage -> fan out user-test/review/
  engineering-system fleets -> catch-and-report to the tracker -> close with
  the repo-hygiene sweep) is what should carry over unchanged.
-->

A single end-to-end pass, run while the founder is asleep or away, that lands
the safe work and then preemptively catches everything that would add
friction when the founder next uses the product. Three workstreams run
against one integrated <PLACEHOLDER: default branch name, e.g. "main">: (A)
user testing, (B) a multi-angle code & product review, (C) a review of the
engineering system itself — how work gets verified AND how it gets delivered.
**Catch-and-report**, leverage-weighted, evidence-based — not coverage
theater, and no unattended changes beyond what the Phase-0 gate authorizes.

## How this runs

This is the high-level brief; the orchestrator owns the judgment-heavy phases
(the gate, merge decisions, test-layer flake-triage, final synthesis) and
**authors/runs sub-agent fan-out for the deterministic phases** — the review
fleet's lens x adversarial-verify x loop-until-dry pattern is a natural
fan-out. The sibling `issue-triage-to-milestones` workflow is the same
Gather -> Lenses -> Synthesis pattern applied to planning instead of review;
if you want this run's fan-out *pinned* (same agents/stages every night),
extract it into a named workflow the same way.

## Arguments

Default (no args) = the **full** integrated run below, with the Phase-0 gate
asked at kickoff. Otherwise interpret loosely:

**Scope**
- `scope=review` — only workstream (B), the code & product review, on
  current <PLACEHOLDER: default branch>.
- `scope=usertest` — only workstream (A), the multi-platform user testing.
- `scope=testing` — only workstream (C), the engineering-system review
  (C1 testing systems + C2 delivery flow).
- `scope=nomerge` — skip Phase 1; review/test the current branch as-is.

**Gate pre-answers** (supplying one skips that Phase-0 question — this is how
a scheduled/cron run stays unattended):
- `merge=yes|no` — merge PRs that clear the Phase-1 bar. `merge=no` is
  equivalent to `scope=nomerge`.
- `regressionfix=yes|no` — fix a real, safely-fixable regression caught by the
  Phase-2 gate.
- `fix=report|tests|ask` — `report` (report-only), `tests` (author missing
  tests on branches/PRs, never the default branch), `ask` (propose each test
  individually before writing it).
- `hygiene=apply|report|no` — the Phase-4 close-out sweep of provably-dead
  local branches/worktrees. `apply` deletes the SAFE class (SHA-ledgered),
  `report` classifies only, `no` skips the phase.

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

## PHASE 0 — Kickoff gate (ask BEFORE the founder goes AFK)

Four decisions govern everything this run writes, and none of them may be
defaulted silently. **Ask them in ONE question round, as the first thing you
do** — before Phase 1, before spawning anything, while the founder is still
awake and at the keyboard. Skip any question already pre-answered by an
argument, and skip any that a narrowed `scope=` makes moot (e.g. don't ask
about merging under `scope=review`). If every question is pre-answered, run
straight through.

1. **Merge?** — "Merge PRs that clear the Phase-1 safe bar into
   <PLACEHOLDER: default branch> tonight?" - *Yes, merge what clears the bar*
   / *No, review the branch as-is*.
2. **Fix regressions?** — "If the Phase-2 gate goes red on a real,
   safely-fixable regression (non-UI, no manual-only action, clear root
   cause), fix it?" - *Yes, fix on a branch + PR* / *No, file a P0 and carry
   on*.
3. **Author missing tests?** — "Write the highest-leverage missing tests?" -
   *Yes, author them* / *No, report only* / *Ask first for each new test*.
4. **Sweep dead branches?** — "At close-out, delete provably-dead local
   branches and worktrees (`branch-sweep.sh` SAFE class only, every deletion
   SHA-ledgered and restorable)?" - *Yes, apply the sweep* / *Report only* /
   *Skip*.

Echo the answers back in one line before starting, and record them in the
final report so the morning read makes clear which mode the run used.

**If the gate goes unanswered** (a scheduled run with no human, or the founder
walks away mid-question): do **not** block the run and do **not** assume yes.
Fall back to the conservative answers — no merge, no fix, report-only, and a
report-only hygiene sweep — run the rest of the pass in full, and say plainly
at the top of the report that the gate was never answered and which work was
consequently left on the table.

## PHASE 1 — Land the work

**Requires a yes on Phase-0 question 1.** On a no, skip this phase entirely
and run the workstreams against the current branch — still list the
mergeable-but-unmerged PRs in the report so the founder can land them later.

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
UI/manual-only work needing the founder) so the tested build is understood as
"<PLACEHOLDER: default branch> minus those," not all outstanding work.

## PHASE 2 — Expensive-test-layer gate (triage, don't stall)

Run the <PLACEHOLDER: E2E/integration suite name> against the merged,
integrated branch. If it has known reliability constraints (a shared test
account, serialization, credential drift, infra flakiness, or hitting a live
external system), triage a red rather than blocking the whole run on it:

- **green** -> build off the integrated branch, start user testing.
- **flake/infra red** (known, already-tracked flake causes; schema/config
  drift where the code expects something the live system doesn't have yet)
  -> note it, proceed with user testing anyway.
- **real regression, safely fixable** (non-UI, no manual-only action, clear
  root cause) -> fix on a branch + PR, re-run, proceed — **but only on a yes
  to Phase-0 question 2**. On a no, file it as a P0 with the root cause and
  evidence you already have, and carry on.
- **real regression, not safely fixable unattended** -> file a P0, test the
  unaffected areas (or hold) and say which. Never silently do nothing.

The code review (B) and engineering-system review (C) **don't wait on this
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

The lenses are deliberately **not** equal in weight. The lens covering this
project's **worst possible outcome** (for a data-heavy product that's lens 4
— losing the user's data) **always runs at maximum depth, unconditionally,
every run** — that risk does not shrink just because its open-issue count
does. Give a second deep slot to whichever lens the tracker currently points
at (the cluster holding the release gate), and **re-derive that second pick
each run** from the tracker rather than assuming last run's choice still
holds. Say what you chose. Lenses don't own findings exclusively: if a lens
sees something outside its angle, report it and let dedup sort it out.

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
   *below*, never hard floors, if that's this project's policy. Once a
   project's accessibility work is largely landed, run this as a **regression
   check** on what shipped rather than a full discovery sweep, and spend the
   freed depth on the heavier lenses. Beware platform accessibility flags that
   false-positive — never gate UX on one.
6. **Cross-platform parity** — if the product ships to more than one
   platform from one codebase: feature + visual parity, density/layout
   adaptation.
7. **Errors, observability & crash-reporting** — how failures surface,
   graceful degradation, logging hygiene, crash-reporting health. If crash
   reporting is configured but dormant without a key/DSN, check the wiring
   rather than assuming reports flow.
8. **Dependencies & supply chain** — version currency and known
   vulnerabilities, transitive risk, and packages drifting far enough behind
   that the upgrade itself becomes the risk. Licensing is a **mechanical
   one-line check** for a closed-source solo project — note anything
   non-permissive and move on; promote it back to a full lens only if the
   product redistributes or open-sources.
9. **Build & release pipeline** — release-build hygiene: signing, any
   test-only code paths staying OUT of production bundles, the actual
   build/deploy scripts.
10. **PII handling & data-privacy posture** — where user data leaks OUT of
    the intended path: raw exceptions echoed into logs, telemetry or crash
    payloads carrying identifiers/paths/user content, persisted failure
    reasons, debug output surviving into release. Also what's encrypted vs.
    plaintext at rest and whether the shipped privacy/disclaimer copy still
    matches what the app does with data. **Access isolation between
    users/tenants belongs to lens 1** — don't re-derive it here.
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
13. **Entry points, deeplinks & routing integrity** — how the app gets
    ENTERED and what state it lands in. Cover: cold start vs. warm re-entry
    vs. revival after the process is killed; OS-level entry surfaces
    (deeplinks/URLs, home-screen widgets, notifications, shortcuts, share
    targets) and the intents/params they carry; router guards, redirects and
    the back stack; and first-launch/boot routing not re-running on a
    secondary entry. The signature failure to hunt: **a routing mechanism gets
    migrated (new router library, new navigation API) and heuristics built on
    the OLD primitive silently become no-ops — while tests that stubbed the
    old primitive keep passing.** Ask of every routing heuristic: does a test
    exercise the REAL router, or a stub that would keep passing after the
    mechanism moved?
14. **Code health & maintainability** — dead/unreferenced code, duplicated
    constants and helpers, files grown past the point of navigability, lint
    posture gaps (warnings the build tolerates, unawaited async calls), and
    **doc comments that contradict the code they document**. Hold the
    minimalism bar hard here — report what materially impedes changing the
    code, not style preference or speculative abstraction. If this project
    runs a separate "standards" or "tech debt" pass, this lens should absorb
    it rather than duplicate it.

### (C) Engineering system review — delivery + testing

Two halves: **how work gets verified** (the test pyramid, C1) and **how work
gets delivered** (issue to merged, C2). Both are process, and both are where a
solo+AI build loop actually loses time.

**Self-review caveat — read this first:** this workstream reviews the loop
*you are running inside*. That is a conflict of interest, so it operates
report-only: file findings for the founder, never self-apply a process change,
and never soften a rule that this run found inconvenient. Same hard rule as
the freshness reconcile below.

#### (C1) Testing systems — the whole pyramid

Be evidence-based: run the fast test layers for timings + failures, generate
coverage if the tooling supports it, inventory tests per layer, grep for
skipped/disabled tests, and read recent CI history for flake rate +
durations. Assess the expensive test layer(s) by design + CI history rather
than full re-runs if re-running them is itself costly/flaky. Where the local
environment CAN run the full gate, run it rather than assessing from CI alone;
where it can't, say so — and don't call a layer broken just because it won't
build locally.

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
one hangs, resources the suite accumulates against an external quota);
CI/CD gaps (anything the main test job doesn't cover that has shipped a real
regression before, PRs that get zero CI due to how the pipeline is triggered,
deploy-ordering if any test hits a live external system); local feedback loop
& fake-vs-real fidelity (a fake/mocked integration layer vs. what production
actually does); methodology/DoD adherence + bug -> regression-test discipline
+ brittleness to unrelated changes (e.g. a test locator that breaks on a
copy/label edit that has nothing to do with what the test is checking).

#### (C2) Delivery flow — issue to merged

Not "is the code tested" but "does work move." Ground every finding in the
board and the git/CI record, not impressions.

- **Board & issue hygiene** — cards whose state contradicts reality (merged
  PR, card still in progress), issues silently left open by the **per-issue
  close-keyword trap** (a "Fixes #A, #B" PR body closes only `#A`; multi-issue
  PRs strand the rest and leave their cards stale), stale in-progress cards,
  unmilestoned issues, and milestones draining slower than they fill.
- **Merge-flow friction** — auto-merge starvation under a strict
  up-to-date-branch rule (green PRs that stall silently and need a manual
  branch update), PRs sitting green-and-unmerged, stacked non-default-base PRs
  getting zero CI.
- **Cycle-time & CI economics** — how long issues sit in progress, PR
  open->merge time, CI wall-clock and its trend, and whether the local
  pre-push gate is still the fastest honest signal.
- **Workspace sprawl** — accumulated remote branches, worktrees and caches
  that slow down or destabilize parallel work.
- **Delegation & orchestration health** — did sub-agents stall waiting on
  notifications that never arrive, did parallel workers starve the host by
  running full gates concurrently, did any worker end a turn without a
  deliverable or a named blocker. These recur; a recurrence is a finding, not
  a footnote.

**Kit promotion candidates (report-only, never a cross-repo write):** this kit
is what every future project bootstraps from. When a run surfaces a lesson
that would have helped *any* project, propose it for promotion — but apply the
generalization test first, because project lore must NOT be copy-pasted into
new projects:

- **Does it generalize?** Strip every issue number, file path, package name
  and product specific. If what survives is still a useful rule, it's a
  candidate. If the lesson only makes sense with this project's specifics
  attached, it stays in the project.
- **Which destination?** Behavioral rules for how the assistant works -> the
  founder's **global instructions**. Scaffolding a new repo should be *born*
  with (CI skeleton, board columns, branch protection, PR template, the
  skill/workflow copies) -> **this kit**. Say which, and why.
- **Flag drift between the kit's generic copy of a skill and the project's
  own** — each is edited independently and they diverge. Report the delta;
  never silently sync one to the other.
- **Never write to the kit from this run.** It bootstraps every future
  project; an unattended cross-repo edit has the wrong blast radius.
  Candidates go in the report.

**Automation-prompt freshness reconcile (review the brief you are running):**
this skill is itself process tooling and rots the same way a doc does — it
accumulates issue numbers, paths, and environment caveats that were true when
written. Treat **this `SKILL.md`**, the sibling workflow(s), and the
operational claims in the project's `CLAUDE.md` (commands, gotchas, DoD) as
artifacts under review. The check is cheap and mechanical: resolve every cited
issue number against the tracker, confirm every file/script path still exists,
and test every environment claim against what you actually just observed this
run. Mirror the style-guide split:

- **(a) DESCRIPTIVE drift** — an issue cited as live state that has since
  closed, a resolved environment caveat, a moved path, a gotcha superseded by
  a fix -> correct it in place and list the corrections in the report.
- **(b) NORMATIVE change** — adding/removing/reweighting a review lens,
  changing the Phase-1 safe-merge bar, the catch-and-report boundary, the
  budget/model policy, or anything in AFK+DELIVERABLE -> **founder decision**:
  file it with the rationale, never self-edit.

The hard rule, same as a style guide's: **never resolve a divergence by
loosening a constraint on this run's own behavior to match what this run
did.** A prompt that edits its own guardrails to make the run look compliant
is the one failure mode that makes every future run untrustworthy. When in
doubt, it's (b).

## PHASE 4 — Repo hygiene (close-out)

**Follows Phase-0 question 4.** Run after the workstreams complete, so the
sweep sees this run's own merges. Mechanism: `.claude/hooks/branch-sweep.sh`
(documented in the kit's `claude/README.md`). The root cause it exists for:
squash-merge deletes only the remote branch, so every merged PR strands a
local one unless something cleans it up.

- *Apply* — run `bash .claude/hooks/branch-sweep.sh report` first, then
  `... apply`. Only the SAFE class is deleted: the branch head is contained
  in the default branch, or its upstream is gone and a merged PR matches the
  head name with no open PR reusing it. Every deletion lands in
  `.claude/state/branch-sweep.log` with its SHA; restore with
  `git branch <name> <sha>`.
- *Report only* (also the unanswered-gate fallback) — run `report`, delete
  nothing, and put the classification in the morning report.
- *Skip* — do nothing.

FLAGGED rows (WIP branches, local-only work, dirty worktrees) are judgment
cases and are **never deleted by this phase, in any mode** — not even on
*apply*. Verify each against issue/PR state the same way the workstreams
verify their claims, and list the delete-proposals in the morning report for
the founder to approve. (The SubagentStop hook runs the same script's `auto`
mode continuously between runs; this pass is the backstop that also covers
what `auto` must not touch.)

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
  changes is not.) The two **descriptive** reconciles are the narrow
  exceptions — style-guide drift under lens 11 and prompt/doc drift under the
  C2 reconcile may be corrected in place, because they only make a doc match
  shipped reality. Their normative halves never are.
- **Missing tests follow Phase-0 question 3**, never a fleet's own judgment:
  - *Yes* — author the highest-leverage missing tests on branches/PRs, never
    the default branch.
  - *No* — report only: describe the gap, write nothing.
  - *Ask first for each* — propose each test individually (the test, the gap
    it closes, the layer) and write it only on a yes. **If a proposal goes
    unanswered for ~10 minutes, stop asking for the rest of the run** — the
    founder is away. Queue every remaining proposal into the report as a
    one-line "proposed tests" list. Never block the run waiting on an answer,
    and never let an unanswered proposal become a write.

## BUDGET / MODELS / STOPPING

Budget is not a constraint — optimize for thoroughness and verification
depth, not speed or economy. Go wide and deep: large finder/reviewer pools,
multi-vote adversarial verification per finding, and loop the
find-then-verify cycle until two consecutive rounds surface nothing new.

Set the model explicitly per stage rather than letting sub-agents inherit the
session default — a run kicked off from a cheaper session must not silently
review the product at that tier:

- **Judgment-heavy stages -> your strongest available model at high reasoning
  effort:** adversarial verification, security and data-integrity reasoning,
  the regression-catch probe, the "does this feel off / off-philosophy" calls,
  the normative-vs-descriptive splits, and final synthesis/triage. Escalate
  to your very highest effort tier for the **worst-outcome lens
  unconditionally, every run, regardless of tracker state**, and for the
  run's second deep lens — the one the tracker-driven weighting (workstream
  B's intro) named this run, re-derived each time, never assumed.
- **Mechanical sweeps -> a faster/cheaper tier:** enumerating files, running
  suites, collecting logs, parsing CI timings, resolving issue states for the
  freshness reconcile.

State the model/effort actually used per workstream in the report, so a thin
run is distinguishable from a genuinely clean one.

## AFK + DELIVERABLE

The founder is away — use best judgement on sticking points; if stuck, move
on rather than waiting. Keep the tracker/board live as you file. Leave ONE
integrated report:

- Executive summary + a maturity scorecard (one rating + one line per review
  lens and for the engineering system).
- **The Phase-0 gate answers this run used** (merge / regression-fix /
  missing-tests / hygiene, and whether each came from an argument, the
  founder, or the unanswered fallback) — plus the model + effort per
  workstream. First thing in the report: it frames everything below it.
- **The Phase-4 hygiene result:** branches/worktrees deleted (count + ledger
  path) and the FLAGGED delete-proposals awaiting the founder's approval.
- P0/P1/P2 findings with evidence and filed-issue links, deduped, grouped by
  workstream/lens, with a "highest-leverage 10" call-out across everything.
- Regression-catch probe results per critical path (protected/unprotected).
- **Prevention-layer classification:** tag every confirmed finding with the
  earliest layer that could realistically have caught it — a pre-merge
  review, a CI/lint gate, a test at a named level, spec/decision hygiene, or
  **audit-only** (no cheaper layer exists) — and report the distribution.
  This is the feedback loop that turns detection into prevention: a
  recurring escape class is a candidate for a new standing gate. Keep it
  honest: "audit-only" is a legitimate answer, and a proposed layer that
  would cost more than the class it prevents is a finding against the
  proposal, not for it.
- **Prompt-freshness reconcile:** what you corrected in this brief in-place,
  and what needs a founder call (normative changes — never self-applied).
- **Kit promotion candidates:** lessons worth pushing back into this kit or
  the founder's global instructions, each already generalized (no issue
  numbers, no product specifics) with its destination named, plus any drift
  between the kit's generic copy of this skill and the project's own.
  Report-only.
- What you couldn't test or assess, and why.

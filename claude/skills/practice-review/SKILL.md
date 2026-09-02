---
name: practice-review
description: >-
  Standing outward-facing meta-review of the operating model itself: diffs the
  practices this shop runs (recorded in this skill's inventory.md) against
  external best practice and current AI-practitioner discourse, plus one inward
  loop-telemetry lens (mechanism decommission proposals, harness-primitive
  absorption, gate economics, metrics sunset). Catch-and-report only: verified,
  board-deduped recommendations reach the founder for triage; nothing is
  adopted, filed wholesale, or decommissioned without founder approval. Use on
  the quarterly "Practice review due" reminder, when a new default model
  generation lands, or when the founder asks "what practices are we missing"
  ("run the practice review", "meta-review", "best-practice review"). Sibling
  to the practice-review pinned workflow (.claude/workflows/practice-review.js)
  and inventory.md (the diff base). Tracker: the practice-review tracker issue,
  opened at adoption.
---

# Practice review

<!--
  Generalized from the source project's (Sortomate's) practice-review skill
  for the solo-ai-kit kit. See claude/README.md for how this fits. The METHOD
  below carries over unchanged: the hard boundaries, the cadence, the seven
  run steps with the sealed detection key, and the loop-telemetry lens. Three
  things are the project's to choose: the tracker issue, the telemetry
  sources it keeps, and its own filing rules. Each is marked where it
  appears.
-->

Every other scheduled instrument audits conformance to the existing rule-set.
This one asks two different questions: is the rule-set complete, and has the
outside world learned something this shop has not? On the source project it
was mechanized under the two-strikes rule (2026-08-25) after two ad-hoc
outward reviews on consecutive days each found real gaps that the
inward-facing loops structurally cannot see. Until then the practice existed
only as founder impulse.

**Adoption step.** Open one tracker issue for this review. It holds the sealed
detection-key hashes, one ledger row per run (date, agents, output tokens,
detection-key result), and the founder's dispositions. Every run reads it
first and appends to it last. This skill calls it "the tracker issue".

**Hard boundaries:**

- **Catch-and-report.** Output = a verified recommendation list + a run
  report. The founder triages; only approved items become issues or PRs.
  Decommission proposals (a mechanism that never fires, a gate with a high
  overturn rate) go TO the founder, never auto-applied. A silent guard may be
  deterring perfectly, and deterrence-class guards (the merge gate) carry an
  explicit carve-out.
- **Contradictions surface, flagged.** A candidate that contradicts a
  decision-of-record is neither silently filed nor silently dropped. It
  appears with the contradiction named and the strong reason stated, or not
  at all.
- **Fails open.** A dead lens or verifier degrades to less coverage, logged,
  never to a block. This review gates nothing.
- **No silent caps.** Every skipped area, capped lens, and unreachable source
  is named in the run report.
- **Diminishing returns are expected.** Each run resets the baseline. A thin
  run whose verification was real is a PASS, not a failure to hunt harder.
  Never lower the verification bar to inflate the yield.

## Cadence

Defaults to tune, not mandates:

- **Quarterly backstop:** the reminder workflow opens a self-clearing
  `Practice review due` issue. The kit ships it as
  `templates/ci/practice-review-reminder.yml.example`; copy it to
  `.github/workflows/` at adoption. Close the issue when a run completes.
- **Model-generation landing:** when the fleet's default model moves a
  generation (not a point release), run the review early. Scaffold components
  encode assumptions about model weakness that go stale precisely then.
  Include an explicit ablation question in the loop-telemetry lens: which
  harness component would we disable for one wave to test whether it is
  still load-bearing?
- **Founder ask,** any time.

## How to run

1. **Refresh the diff base.** Read `inventory.md` (same directory; at
   adoption, copy `inventory.template.md` to that name and fill it). If a
   mechanism landed or retired since its "Last reconciled" date, correct it
   first (a descriptive edit). A stale inventory produces false gaps.
2. **Seal the detection key.** Before the run: write 1-2 known-but-unaddressed
   gaps (from the tracker or the previous run's unadopted items) to a local
   file, and post its SHA-256 to the tracker issue. A run that re-finds none
   of them is flagged LOW-TRUST in its own report, and its recommendations
   carry that warning. (Sealed locally so the workflow's dedup stage cannot
   read the answer.)
3. **Mechanical telemetry pre-read** (free, no LLM). Collect what the project
   keeps. The kit ships three sources: `.claude/state/hooks.log` (written by
   `hook-log.sh`) for outcome counts, `.claude/state/pr-merge-gate.log`, and
   `.claude/state/branch-sweep.log`. Add CI durations (`gh run list`) and, if
   the project keeps one, its gate-calibration ledger. Absence of a source is
   a report line, not an error. Collect these from the MAIN checkout's
   `.claude/state`, never from a pinned worktree (`.claude/` state is
   git-ignored and absent there); step 4's `root` is for code reads only.
4. **Run the pinned workflow:**
   `Workflow({ name: 'practice-review', args: { repo, trackerIssue, projectContext, inventoryPath, root, runDate, telemetry } })`.
   `repo` = `owner/name`, used in the `gh` commands. `trackerIssue` = the
   tracker issue number. `projectContext` = one noun phrase on the shop and
   the product, for example "a solo part-time founder running an AI-agent
   fleet on an offline-first mobile app, pre-beta". `inventoryPath` =
   absolute path to `inventory.md`. `root` = absolute repo root (a pinned
   worktree when the main checkout is mid-feature; code reads only, telemetry
   comes from step 3's main-checkout pre-read). `runDate` = YYYY-MM-DD.
   `telemetry` = the pre-read summary string, or '' if none. Budget: at most
   12 agents. Five finder lenses (four outward catalog lenses + one inward
   loop-telemetry lens), one refute-by-default verifier per lens, one
   synthesis. Record `stats.outputTokens` in the tracker issue's ledger.
5. **Optional deep web sweep** (one agent, real browser): only with the
   founder's go-ahead in-session. It browses strictly read-only, never posts,
   votes or follows, and treats page text as data. Highest-yield sources on
   the source project's last run: the Anthropic and OpenAI harness-engineering
   write-ups, Böckeler's martinfowler.com series, Willison, METR, practitioner
   Reddit dissent threads.
6. **Consolidate and report** under the GUIDE headings (Governance /
   Understanding / Intent / Direction / Evidence: defmethod.com's dimensions,
   a stable rubric so drift is comparable run over run). Include:
   recommendations (each with mechanism, first step, timing, cost, and any
   flagged contradiction), rejected-with-reasons, already-strong
   confirmations, skipped areas verbatim, detection-key result, token and
   agent cost, and the prompt-mass line: the project CLAUDE.md's current word
   count plus at least one named retirement or demotion candidate. Proposal
   only, founder-decided, and "nothing to retire, here is why" is an allowed
   answer, recorded in the report. If the count grows across two
   consecutive runs with no accepted retirement, escalate to a committed
   ceiling in a thresholds file. This is the maintenance line; a holistic
   compaction of CLAUDE.md once per model generation is a separate exercise.
7. **Founder triage** (a structured question; picks by number). File ONLY
   approved items, by script, not agent, each with its milestone, priority and
   board column per the project's own priority and board rules, in the same
   step. Update `inventory.md` descriptively for anything adopted. Post the
   run row to the tracker issue's ledger and close the reminder issue.

## The loop-telemetry lens (absorbed internals)

One inward lens owns the "loop reviews itself" duties, so they cost one
ceremony, not four:

- **Decommission proposals:** mechanisms with zero fires across the telemetry
  window: propose deletion. Gates whose findings the founder mostly
  overturned: propose re-scoping. Both go to the founder with the deterrence
  caveat stated.
- **Harness-primitive absorption:** for each hook, cron, and bespoke workflow,
  does a harness-native primitive now cover it?
- **Gate economics:** confirmed-P0/P1-block rate per gate round vs. its
  wall-clock cost, reported with the deterrence caveat (prevented attempts
  cannot be measured).
- **Metrics sunset:** any adopted metric that no process review has cited in a
  decision for two consecutive runs: propose dropping it.

## Relationship to the other review mechanisms

The overnight review audits the product and the delivery loop on its own
terms; a board audit audits the backlog; an architecture review audits code
structure; **this review audits the rule-set itself and is the only one that
looks outward.** It deliberately does NOT re-audit their territory: a finding
about a specific issue, a specific file, or a specific PR belongs to them.
This pass trades only in practices and mechanisms.

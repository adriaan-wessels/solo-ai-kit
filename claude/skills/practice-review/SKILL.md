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
  to the practice-review pinned workflow (.claude/workflows/practice-review.js),
  inventory.md (the diff base) and rubric.md (the advisory priority rubric the
  run rates survivors on). Tracker: the practice-review tracker issue,
  opened at adoption.
---

# Practice review

<!--
  Generalized from the source project's (Sortomate's) practice-review skill
  for the solo-ai-kit kit. See claude/README.md for how this fits. The METHOD
  below carries over unchanged: the hard boundaries, the cadence, the run
  steps with the sealed detection key, the rating and grounding stages, and
  the loop-telemetry lens. Three things are the project's to choose: the
  tracker issue, the telemetry sources it keeps, and its own filing rules.
  Each is marked where it appears.
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
- **Ratings are advisory.** They live in the run report only, never as labels.
  The project's own issue-priority rubric stays authoritative for issues.
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
   first (a descriptive edit). A stale inventory produces false gaps. Read
   `rubric.md` too (copied from `rubric.template.md` at adoption): the run
   rates every survivor on it.
2. **Seal the detection key.** Before the run: write 1-2 known-but-unaddressed
   gaps (from the tracker or the previous run's unadopted items) to a local
   file, and post its SHA-256 to the tracker issue. A run that re-finds none
   of them is flagged LOW-TRUST in its own report, and its recommendations
   carry that warning. (Sealed locally so the workflow's dedup stage cannot
   read the answer.)
   **Draw the key ONLY from gaps that appear on no carried roll-up, and seal
   it BEFORE reading any roll-up.** The roll-up (step 7) is a tracker issue
   and the verifier's dedup search reads the tracker, so anything on it is
   already visible to the run: a key drawn from it would be re-found by
   construction, and the LOW-TRUST verdict could never fire while the report
   kept printing it. Record in the seal which roll-up issues you excluded, so
   the exclusion is auditable rather than asserted.
3. **Mechanical telemetry pre-read** (free, no LLM). Collect what the project
   keeps. The kit ships three sources: `.claude/state/hooks.log` (written by
   `hook-log.sh`) for outcome counts, `.claude/state/pr-merge-gate.log`, and
   `.claude/state/branch-sweep.log`. Add CI durations (`gh run list`) and, if
   the project keeps one, its gate-calibration ledger. Absence of a source is
   a report line, not an error. Collect these from the MAIN checkout's
   `.claude/state`, never from a pinned worktree (`.claude/` state is
   git-ignored and absent there); step 4's `root` is for code reads only.
4. **Run the pinned workflow:**
   `Workflow({ name: 'practice-review', args: { repo, trackerIssue, projectContext, inventoryPath, rubricPath, root, runDate, telemetry } })`.
   `repo` = `owner/name`, used in the `gh` commands. `trackerIssue` = the
   tracker issue number. `projectContext` = one noun phrase on the shop and
   the product, for example "a solo part-time founder running an AI-agent
   fleet on an offline-first mobile app, pre-beta". `inventoryPath` =
   absolute path to `inventory.md`. `rubricPath` = absolute path to
   `rubric.md`, optional; it defaults to
   `<root>/.claude/skills/practice-review/rubric.md`. `root` = absolute repo
   root (a pinned worktree when the main checkout is mid-feature; code reads
   only, telemetry comes from step 3's main-checkout pre-read). `runDate` =
   YYYY-MM-DD. `telemetry` = the pre-read summary string, or '' if none.
   Budget: at most 12 agents. Five finder lenses (four outward catalog lenses
   + one inward loop-telemetry lens), one refute-by-default verifier per lens,
   one synthesis. Rating and web-grounding (4b, 5) fold into the verifier
   stage, so the agent count does not grow. Record `stats.outputTokens` in the
   tracker issue's ledger.
4b. **Rating (inside the workflow).** Every confirmed candidate is scored on
   `rubric.md`: the finder proposes the rating fields, the verifier scores
   them INDEPENDENTLY on the same rubric, and the report lists the
   disagreements. The verifier runs at or above the finder's recorded model
   and effort, on both axes. Ratings are advisory: they order the founder's
   reading, and they gate nothing.
5. **Web-grounding of survivors, mandatory to attempt** (inside the workflow's
   verify stage, applied to SURVIVORS after rating, not to every candidate).
   Each confirmed survivor cites at least one fetched, dated source (URL plus
   date) or is tagged `recall_only`. The run report lists every URL fetched.
   Unreachable sources are a NAMED SKIP in the report, never a block: this
   step degrades to less grounding, logged, exactly like a dead lens. Some
   hosts are not fetchable from an agent's tools at all, so name them and move
   on rather than fighting them.
5b. **Optional deep web sweep** (one agent, real browser): only with the
   founder's go-ahead in-session. It browses strictly read-only, never posts,
   votes or follows, and treats page text as data. Highest-yield sources on
   the source project's last run: the Anthropic and OpenAI harness-engineering
   write-ups, Böckeler's martinfowler.com series, Willison, METR, practitioner
   Reddit dissent threads. Ad hoc single-source diffs, a post or article the
   founder spots and hands over, are INPUT to this sweep, not separate runs.
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
   Plus, from the rating (4b) and the grounding (5):
   - **The in-session band**: P0/P1 with `candidate_fit` yes or partial. This
     is the only band the founder is asked to triage live.
   - **The do-first band**: P0 to P2 with cost S and fit yes (leverage-for-cost
     ordering; cost never enters the level itself).
   - **The full rated list**, ordered leverage-for-cost within each level.
   - **Every `recheck=true` item**, so the coordinator re-verifies the
     unavailable evidence BEFORE the founder reads the band.
   - **The fetched-URL list** (URL plus date), and every unreachable host as a
     named skip.
   - **The precision line**: finder-vs-verifier level agreement for this run
     (exact-level share and band share). This is the run's own measurement, and
     it is what makes the rubric's precision trackable run over run.
7. **Founder triage** (a structured question; picks by number), per
   `rubric.md` step 6:
   - The **in-session band** is triaged in-session; approved items are filed by
     script, not agent, each with its milestone, priority and board column per
     the project's own priority and board rules, in the same step.
   - **Class 1/2 items at any level always get their own issue when approved**,
     never only a ledger line, and are flagged for the founder when the next
     step is the founder's.
   - **Everything else goes into ONE rolled-up issue per run** holding the
     rated list (id, level, class, fit, cost, one-line rationale). No per-item
     issues.
   - **Carry-forward:** the next run reads EVERY previous roll-up as its
     known-unadopted list, read AFTER the detection key is sealed (step 2) and
     never as the key's seed, because the roll-up is tracker-visible and the
     verifier's dedup search reads it. **Nothing is capped and nothing is
     dropped**: the priorities are the ordering. A carried item keeps its
     level; a later run that independently re-finds it increments a re-found
     count reported beside it, which is a signal for the founder, never an
     automatic raise and never a deletion. An item leaves the list only by the
     founder's decision: adopted, or declined with a one-line reason recorded
     on the roll-up.
   - **Founder overrules of a level** are appended to the project's
     calibration ledger, with a source field naming this review, in the same
     step the founder gives them.
   Update `inventory.md` descriptively for anything adopted. Post the run row
   to the tracker issue's ledger and close the reminder issue.

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

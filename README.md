# Solo Founder + AI Agents: Bootstrap Kit

> [!TIP]
> **The fastest way to use this kit:** ask your AI assistant to read
> this repo, then discuss with it which practices adapt best to your
> situation, and the pros and cons of each. A ready-made four-step
> version of that exercise is under [Day-one
> bootstrap](#day-one-bootstrap) below.

**Written by the agents it describes.** AI coding agents wrote every
document, script and hook in this kit, under the operating model it
documents. Their drafts pass the same gates the model prescribes: an
agent draft, an agent review, then my sign-off on philosophy,
boundaries, and every call I could not undo. The writing follows the
same pattern, down to the sentence level. Agents draft in Simplified
Technical English plus Zinsser's four rules, then run a Humanizer pass
to catch AI-sounding prose (see "A writing directive for low-bandwidth
days" below). Treat the kit as a worked example of its own method: the
agents write, the agents check, and I approve.

This kit is a portable handbook and starter set for one operating model:
**one founder acts as editor, and AI coding agents act as staff.** The
agents maintain the tracker, write the code, verify it, and merge on
green CI. The founder keeps five recurring jobs: use the product, dump
raw testing notes, answer decision pop-ups, approve UI mockups, and
approve live-DB schema changes (early on, apply them by hand too;
practice 7 shows how that gate matures).

The kit comes from a live process review of the Sortomate project
(2026-07-21). On that project, a product shipping on three platforms,
the model produced:

- 30 merged PRs in less than 5 days, with zero PRs left open;
- 20 of 20 green CI runs on `master`;
- a 600-item GitHub Project board with zero mismatches between the board
  and reality;
- a test pyramid of about 2,000 unit/widget tests, 147 integration
  tests, and only 12 E2E specs, with E2E reserved for flows that cross a
  real cloud boundary.

These numbers show that the model works. They do not show that it is
easy, and they come from weeks on one live project, not years across
many. The leverage comes from the practices below, not from the tools
alone.

---

## The operating model

**The founder is the editor. The agents are the staff.** The agents own
the mechanics. They read and write the issue tracker, implement
features, run and write tests, merge their own PRs when CI is green, and
keep the project board truthful in real time. The founder's recurring
duties stay deliberately narrow:

**"Founder" here means a role, not a job title.** It is whoever holds
final say on what ships and carries the consequences when it breaks. You
do not need to have founded anything. The nearest formal title is
**product owner**, because the role needs change-approval authority over
the work; product manager understates it, since a PM usually advises on
direction without holding that authority. Read "founder" as "product
owner with the keys" throughout, and the model applies unchanged to a
staff engineer running a project alone inside a larger company.

1. **Use the product.** Daily use is the primary QA signal.
2. **Dump raw testing notes.** Write them unstructured, as they occur to
   you. Agents turn them into scoped, deduplicated issues.
3. **Answer decision pop-ups.** Agents ask short, structured questions
   when a call genuinely needs a human: product direction, taste, risk
   tolerance. A pop-up is a question with options, not a status update.
4. **Approve UI mockups** before a visual change ships, not after.
5. **Approve live-DB DDL.** A schema change against a hosted database is
   irreversible against real data, so a human hand stays on the trigger.
   Early on, the founder applies the SQL by hand. As the project
   matures, the founder approves the migration file and automation
   applies it (practice 7). The judgment is the permanent manual part,
   not the keystrokes.

Everything else is agent work: code, tests, bug triage, backlog
grooming, releases, PR merges, and doc upkeep. The founder's time is the
scarcest resource in the system. The practices below keep as much of it
as possible off the critical path, without losing correctness or the
founder's own judgment where that judgment matters.

### A writing directive for low-bandwidth days

On a day when you are tired or short on mental bandwidth, you can hand
your agents a ready-made writing directive instead of composing one
yourself:

> Write in ASD-STE100 (Simplified Technical English) with
> domain-specific extensions, and follow Zinsser's four principles of
> quality writing: Simplicity, Brevity, Clarity and Humanity.

Credit for the directive goes to Martín Ramírez on LinkedIn.
Agent-written prose can still carry recognizable AI patterns. A
de-AI-pattern review pass over the draft helps catch them, and the
Claude Code "Humanizer" skill is one way to run that pass. This README
was rewritten under this directive, as the worked example.

---

## Seven principles behind the practices

These seven ideas sit under most of what follows. State them once, and the
practices below read as instances of a rule instead of an arbitrary list.

1. **A lesson that recurs is a missing mechanism, not a missing
   reminder.** Every lesson that became a mechanism (a hook, a lint, a
   guardrail) stopped recurring. Every lesson left as prose recurred,
   between two and thirteen times, before it did. The working rule is
   two strikes: on the second recorded occurrence of a lesson, install
   it where it acts. Prefer a gate: a hook, a lint, a test that fails
   when the mistake recurs. When no gate is worth building, a standing
   rule or a frozen prompt line at the point of action counts too.
   Sometimes a prompt is the best you can do. The one form with a
   proven failure record is the passive note that waits in a file to
   be re-read. That is the prose that recurred two to thirteen times
   above. Promote the note, or delete it. Every mechanism also carries
   a decommission test: a guard that never fires across a review
   window, or a gate the founder usually overrules, gets proposed for
   deletion or re-scoping. Proposals only; the founder decides; guards
   that work by deterrence get a named carve-out. And before you add a
   rule or a procedure at all, ask: would stating one missing fact fix
   this? A fact costs one line. A procedure costs attention forever.
   The starter `CLAUDE.md` template ships this as standing rule 5.
2. **Guards fail open.** A guard that blocks legitimate work gets
   disabled. Once disabled, it protects nothing. Build every guard to let
   real work through, or it gets switched off at the exact moment it
   would have mattered.
3. **Verification must be adversarial to itself.** A test that passes
   against the bug it claims to catch is worse than no test, because it
   manufactures confidence nobody should have. Four such tests turned up
   in a single week on the source project.
4. **Arming a merge ends the review.** Any change after that point
   reopens it. "Auto-merge is armed" and "this diff was reviewed" are two
   separate facts, not one.
5. **Priority answers one question: does this block the milestone from
   exiting.** Not effort. Not size. A rubric that answers a different
   question stops meaning anything.
6. **Match a mechanism's strength to its precision.** A check may block
   only what its false-positive rate can sustain. Deterministic,
   self-contained checks (lints, unit tests, hooks) may hard-block.
   Noisy or environment-dependent checks (live-cloud E2E) may only trip
   a wire, and a tripwire counts only when consumption is mandatory: a
   green baseline, an owner, and a clock on every red. Escalate or
   demote a check's authority as its measured precision changes; to
   make a check harder, engineer its noise out first. The lesson that
   earned it: a non-blocking check without mandatory consumption decays
   to noise, and a novel failure can hide inside a known red.
7. **Self-verification ends in disclosure, not proof.** A verifier that
   must run the code it judges takes its evidence from that code's
   behaviour, so the verdict can be corrupted by the thing under
   judgement. No malice is needed: an unlucky defect can skew the
   evidence in its own favour, and an agent rewarded for green drifts
   toward whatever produces green. The verifier cannot see intent, so
   never build a control whose correctness depends on telling a
   motivated error from a deliberate one; treat every claim from the
   judged side as a hypothesis. Hardening is the transfer of control
   over the evidence from the judged code to the reviewer: the
   reviewer's own inputs, own instruments, own measurement points. The
   transfer completes only for evidence that never runs the code, which
   is the diff; in a solo operating model every reader of it is an
   agent, and the founder reads measurements and behaviour, never code.
   What stands beyond the agents' reach is therefore not a reader but
   the credential boundary: controls enforced where the agents'
   credentials cannot rewrite them. Expect each repair to relocate the
   weakness rather than remove it; the correct end state is a named
   residual plus the guard that actually holds there. An honestly
   stated limit costs a sentence; a claimed completeness is a defect
   awaiting its ten-line counterexample.

---

## Portable practices

Each practice generalizes beyond the project it was learned on. The list
is roughly in the order a new project should adopt them.

### 1. One machine-readable source of truth, maintained by agents

The issue tracker (GitHub Issues plus a Project board) is the spec, not
a mirror of one. Issue bodies are the requirements. **Issue comments are
the decision-of-record**: when the founder settles a question, the
answer goes into a comment on the issue, not into chat where it will be
forgotten. The board's columns are always live. An agent moves a card
the moment it starts work and the moment a PR merges, never in a batch
at the end of a session. When any written status disagrees with the
board, **the board wins**. Fix the prose; do not trust it over the
tracker.

Two disciplines keep the tracker usable as issue volume grows:

- **File every issue with a milestone.** Send new findings to a
  designated inbox milestone (for example "Code health / tech debt") by
  default, and triage that bucket at each periodic review (see "Periodic
  reviews"). Nothing is ever unmilestoned, and the unsorted pile is
  explicit instead of invisible.
- **Retrieve the existing decision-of-record before you compose a
  decision menu.** Search issue bodies, not only titles, in the
  founder's own vocabulary. Sweep discussion tickets and umbrella issues
  too. Open questions get parked there, and they rarely match keywords.

*Why:* a spec that lives in chat or in a person's memory does not
survive a context switch, a new agent, or a day away. A spec in the
tracker is queryable, diffable, and durable. Tell the agents "the board
wins" once, and they stop relitigating stale status forever.

### 2. `CLAUDE.md` as the project operating manual

One file at the repo root holds the durable facts an agent needs to work
in the codebase: run/test/build commands, the architecture map,
conventions, known gotchas, and the founder's standing rules. It is a
**manual, not a status report**. It says how the codebase reads and how
the team works. It deliberately says nothing about what is in progress
this week. Status belongs in the tracker (practice 1). A `CLAUDE.md`
that accumulates "current sprint" paragraphs goes stale like every
status doc, and agents then trust stale prose over the live board.

The strongest form of the rule: the doc carries a **pointer to the board
and nothing else**, plus an instruction to delete any status prose on
sight. Status prose rots by construction, so the only stable amount of
it is zero. A weaker "keep the status section fresh" version failed
repeatedly before this form was adopted.

*Why:* this is the cheapest possible onboarding for a new agent, and it
compounds. Every gotcha documented once is a gotcha no agent
re-discovers the hard way.

### 3. Correction-capture memory loop

Every founder correction becomes its own small, typed, indexed memory
file: `feedback_*` for how-to-work corrections, `user_*` for founder
facts and preferences, `project_*` for project facts and decisions,
`reference_*` for pointers and tooling notes. An index file lists all of
them, one line each, so a future agent can skim the map before it needs
the detail.

This loop structurally **replaces the human retro**. Instead of a
meeting where the team tries to remember what went wrong, each
correction is captured the moment it happens and is available to every
future session. The same loop keeps a **refuted-findings ledger**: when
a review investigates a suspected bug and finds it is not real, that
result is recorded too. The next review then does not re-spend a cycle
on a lead that is already disproven.

*Why:* without the loop, the same correction repeats across sessions.
The founder re-explains the same preference; agents re-discover the same
false lead. The loop makes each correction a one-time cost.

### 4. Tests as agent-verification infrastructure

The test suite is not there to satisfy a coverage metric. It is the
mechanism that lets an agent merge its own work with confidence, because
no human will eyeball every diff. The pyramid shape matters. Cheap, fast
unit and widget tests carry most of the weight. The expensive, brittle
E2E layer is reserved for flows that cross a boundary a lower layer
cannot reach: auth, sync, payments, any real external service.

The obvious objection: the agents write both the code and the tests
that grade it, so a green suite is the system agreeing with itself, not
an independent check. The model does not pretend otherwise. It
compensates with signals from outside the agents' loop. The founder
uses the product every day and writes raw testing notes no agent
authored; those are the first two duties in the operating model, and
they are load-bearing, not optional. The pre-merge adversarial review
gate (practice 5) adds a second channel: reviewers prompted to break
the work, not to confirm it. And the overnight review's regression-catch
probe mutates code to prove the suite actually goes red. None of this
makes the suite self-justifying. The founder's daily use is the one
check no agent can grade.

The mutation probe has a blind spot of its own. One model writes the
code, then the tests from the same picture of the problem, then the
injection list from that same picture. The three layers are blind in the
same direction, and each one raises confidence in the one below. On the
source project, a classifier caught every injection it wrote for itself,
and one in eight of the injections a reviewing agent wrote against the
same code. One miss was the exact case the classifier existed to catch.
Three habits helped after that. Take the injection list from an agent
that did not write the tests, because a self-run mutation score is
context, not evidence. Where the code parses text that a real system
emits, such as error strings or API responses, take the fixtures from
real logs. Record where each one came from. Invented fixtures encode
what the author assumed the system emits. And score the harness itself.
Make each injected defect name the assertion that must report it.
Otherwise a crash in the mutated copy counts as a catch, and a proof
mode that scores on the exit code alone stops proving.

**Definition of Done means: match the test level to the change.** It
does not mean "add an E2E spec for everything." And when a change
declines a test level, **say so in the PR, never silently**. "Verified
manually, screenshot attached" is a legitimate line in a PR description.
A PR that does not mention testing at all is not.

CI sharding hides one more trap: a sharded run (`jest --shard`,
`pytest-xdist`, or similar) can split one file's tests across separate
OS processes. A variable written in test A and read in test B then
passes in some shard layouts and fails in others, deterministically,
not flakily. Per-test setup fixtures (`setUp`, `beforeEach`, or the
local equivalent) are shard-safe by construction, so put shared state
there instead. Add a lint or convention check if the pattern keeps
recurring.

*Why:* an E2E-only strategy is slow and flaky, and it trains agents and
humans to ignore red runs. An untested strategy means agents cannot
safely self-merge. Matching level to change keeps the suite fast and
trustworthy enough to gate merges on.

### 5. Guardrails that convert founder absence into throughput

The project must not stall because the founder is asleep, offline, or
not looking. The mechanism is a small stack of guardrails:

- **Branch protection** on the default branch: required status checks
  (CI must be green) plus `enforce_admins`, so the rule applies to
  everyone and there is no quiet bypass.
- **Pre-merge adversarial review gate.** Independent reviewer agents try
  to break a feature PR before auto-merge arms on it. A confirmed P0 or
  P1 finding blocks the merge. The protocol is in
  `templates/adversarial-review-gate.md`, with the fuller story under
  "Periodic reviews" below. The kit also ships the one mechanism that
  enforces the gate's hardest rule: `claude/hooks/pr-merge-gate.js`
  refuses an explicit `gh pr merge` when the PR's newest gate comment is
  not a clean, current arm. A PR that edits the verification machinery
  itself (hooks, their settings wiring, the install and bootstrap
  scripts, workflows, the gate template, tests) is held to one line
  more: its arm must record an independent review on a different model
  substrate (the template's "Guard-path review" section). It is the kit's first shipped instance of
  principle 1, and it protects only half the surface. A standing
  `--auto` merge fires on GitHub's servers where no hook can object.
  The hook's own header and the template state that limit.
- **Squash auto-merge on green CI.** A PR that passes its required
  checks merges itself. Nobody has to be awake to click the button.
- **Explicit, scoped AI merge authority.** The founder grants agents
  standing permission to merge their own PRs once green CI plus branch
  protection is the enforced bar. The grant explicitly excludes
  destructive operations, releases, and anything the founder has flagged
  for personal review.
- **Verify CI is actually green before calling a push done.** "I pushed"
  and "I verified it is green" must never get silently conflated. This
  stays a standing rule backed by an explicit check (`gh run watch` or
  equivalent) rather than a background hook; see "Anti-patterns learned
  the hard way" for why the kit tried and retired a hook version of this.
- **Branch-cruft removal: rule first, hook second.** Squash-merge
  deletes only the remote branch, so every merged PR strands a local
  one. On the source project, 74 stranded branches had accumulated by
  2026-08-15. The rule: delete the local branch in the same step that
  confirms the merge. The backstop: a sweep hook (`branch-sweep.sh`)
  deletes only the provably-safe class, writes each deletion's SHA to a
  ledger for easy restores, and never touches judgment cases. A
  session-start tripwire injects the branch and worktree counts, so
  creeping cruft is visible before it becomes a cleanup project.

*Why:* without these, every merge either waits on a human, which drops
throughput to the founder's waking hours, or proceeds on an agent's
unverified say-so, which drops correctness. The guardrails let both hold
at once.

### 6. AI-native ceremonies replacing human ones

Traditional ceremonies synchronize humans. A solo-founder project
staffed by agents does not need the synchronization. It needs the
outcome each ceremony was for, produced a cheaper way:

- **Overnight review ≈ a QA cycle.** A long unattended pass, timed to
  the founder's off-hours. It lands safe work, runs the expensive test
  layer with flake triage, and fans out parallel review fleets: user
  testing, multi-lens code and product review, testing-methodology
  review. The fleets catch-and-report to the tracker; they do not make
  unattended changes.
- **Testing-notes triage ≈ backlog grooming.** The founder dumps raw
  notes from real product use. An agent turns them into scoped,
  deduplicated issues with clear acceptance criteria.
- **Triage-to-milestones ≈ sprint and release planning.** A multi-lens
  panel of agent reviewers scans the whole open-issue set for conflicts,
  overlaps, dependencies, and gaps, then proposes a milestone plan. The
  founder reviews and approves; the plan is never auto-applied.
- **Decision pop-ups ≈ meetings.** Instead of a sync meeting, the agent
  asks a short, structured question with options at the moment a real
  decision is needed. Work continues once it is answered.

*Why:* the ceremonies were never the point. Alignment, quality gates,
and planning were. Most of the leverage in this model comes from
reproducing those outcomes without the human-synchronization cost.

### 7. Human-judgment gates only where judgment lives

Not everything should be automated, and pretending otherwise produces
bad outcomes. The gates that stay manual are the ones where the judgment
is the job:

- **UI sign-off via mockups.** A visual or UX change is shown as a
  mockup and approved before it is built, not shipped and reviewed
  after.
- **Live DDL stays founder-applied.** A schema change against a real,
  populated database is exactly the hard-to-reverse change that warrants
  a human hand on the trigger, even when an agent drafted the SQL.
  Version the schema from day one: a baseline plus versioned migration
  files. Hand-applied ad-hoc DDL is a bootstrap smell. As the project
  matures, the founder gate shifts from typing SQL at a live database to
  approving the migration file before automation applies it.
- **"Do not relitigate" strategy records.** Once the founder has made a
  considered call on a strategic question (what the product is, what it
  is not, a rejected direction), the decision is written down, and
  agents are told not to re-open it without new cause. This gate points
  the other way: it protects spent founder judgment from being silently
  re-spent by an agent that re-derives a worse answer. The lightweight
  per-issue mechanism is an **on-issue fence comment**: a note that says
  "building this re-opens a strategy decision; take it back to a
  planning session first." No special milestone or label taxonomy is
  needed.
- **One explicit exit-gate issue per phase.** A roadmap phase (for
  example "ready to daily-drive the alpha") has exactly one issue that
  answers "is this phase actually done." The founder decides it. The
  alternative is a vibe-based judgment buried across many issues.

*Why:* full automation of judgment calls either produces decisions
nobody made (bad) or burns founder attention on calls that do not need
it (also bad, just less visibly). Naming the specific gates keeps both
failure modes rare.

### 8. Recurring automation, shaped by cost

Scheduled workflows are where an agent-run project quietly accumulates
both its safety net and its bill. These patterns have proved their
value:

- **Consolidate heavy CI lanes onto nightly schedules.** Integration
  suites, platform artifact builds, and full E2E move off the per-PR
  path. Give each nightly **auto-file-an-issue-on-red**, so a failing
  run is a tracked bug by morning instead of a red run nobody saw.
  Per-PR CI keeps only the fast, gating layer. On the source project,
  the first measured day after this consolidation (2026-08-10) cut CI
  spend by more than half against the prior baseline, and the nightlies
  still caught two real breaks that same day. Longer-run numbers were
  still pending when this was written.
- **A daily cost tripwire.** A scheduled job estimates yesterday's CI
  spend and files or updates an issue past a threshold. Keep it
  alert-only. Pair it with a billing budget that alerts, never one that
  hard-stops usage: a mid-sprint spending halt costs more than the
  overage it prevents.
- **Self-clearing reminder crons.** A scheduled workflow that reminds
  you of a periodic ceremony files ONE reminder issue, with idempotency
  guards: skip if the issue is already open, and skip if it closed
  recently. The ceremony itself closes the issue. The reminder never
  nags and never duplicates, and a missed ceremony stays visible as one
  open issue instead of a pile.
- **A live-drift probe.** A weekly read-only cron diffs the live
  backend (schema, policies, grants, purge lists) against the repo's
  declared state, and fails loud on any mismatch. Declared state and
  live state drift apart silently; on the source project the drift
  breached twice before this probe existed.
- **Keepalive pings** for infrastructure that pauses when idle, such as
  free-tier databases. One authenticated read on a weekly cron. Make it
  fail loudly, so a broken keepalive is a red run rather than silence.
- **Destructive scheduled jobs default to dry-run.** Anything that
  prunes test accounts, old artifacts, or stale data reports what it
  would delete by default, and it requires an explicit confirm string
  before it actually deletes.
- **Prefer the platform's built-in automations over scripted
  equivalents.** For example, use GitHub Projects' own auto-add and
  closed-to-Done workflows instead of GraphQL scripts that move cards.
  The built-ins need no token, no CI minutes, and no API quota. Treat
  API rate quota as a shared, exhaustible resource across every agent on
  the project. Keep scripts only for transitions the built-ins cannot
  express.
- **A release freshness gate.** Each release cut runs machine-checkable
  probes (a version marker on every deployed surface) plus a short
  printed checklist for the surfaces a probe cannot reach. "We cut a
  release" and "users actually run it" never silently diverge.

*Why:* recurring automation is the part of the system nobody watches, by
definition. Its failure modes are silent: a schedule that stopped
firing, a cron that deletes the wrong thing, a bill that compounds
daily. Make every scheduled job fail loudly, delete nothing by default,
and cost no more than its signal is worth. That is what makes
"unattended" safe.

### 9. Parallel-agent hygiene

Several coding agents on one repo and one host create failure modes that
single-agent work never surfaces:

- **Ban `git stash` in every parallel-builder prompt.** `refs/stash`
  lives in the shared `.git`, not in the worktree. Concurrent builders
  that stash push/pop silently swap each other's WIP. Use a scratch WIP
  commit plus a soft reset instead. Same class: never force-move a
  branch you did not create (a sibling worktree may have it checked
  out), and put throwaway repro files in a worktree, never in the shared
  checkout.
- **Do not run full local test gates in parallel.** All agents on one
  host share one toolchain lock. Concurrent full gates starve each other
  into timeouts. In a multi-builder wave: targeted suites locally, full
  suite in CI.
- **Assume stalled workers fire no notification.** From the outside, a
  hung background agent looks identical to a working one. Run a periodic
  broadcast-message sweep over the wave's agent IDs. It is a stall
  detector and a mass resume in one. A stop-hook that scans a finished
  subagent's final message for the "waiting for a notification…"
  signature catches the most common trap mechanically; it exits 2, which
  blocks the stop and feeds the warning back to the worker itself, so
  the worker resumes with no human relay (see `claude/hooks/`). And once
  a worker-prompt boilerplate demonstrably prevents or recovers the
  trap, **freeze its wording**. Do not paraphrase a proven incantation.
- **Bound the concurrency of heavyweight agent workflows.** Two large
  parallel fleets can trip provider-side throttling that collapses whole
  waves. Bound the fan-out, and keep a resume path for a half-dead run.
- **After any host crash or reboot, probe server-side truth** (open PRs,
  branches, releases) before you trust any remembered agent status.
  Background agents die silently, and their claimed state dies with
  them.

*Why:* each of these was learned as a multi-hour loss with no error
message: cross-contaminated WIP, waves that starved themselves, workers
stalled all night unnoticed. Parallelism pays only when the coordination
failures are engineered out, not debugged per incident.

### 10. Deliberate omissions

Things this model does **not** adopt, on purpose:

- No `CONTRIBUTING.md`. There are no external contributors to onboard.
- No `CODEOWNERS`. There is one owner; the file would be a no-op.
- No issue templates. Agents write structured issues directly. A
  template optimizes for humans filling out a form. A **pull-request**
  template is a different thing and the kit does ship one
  (`templates/pull_request_template.md`). It carries the
  declined-test-level checkbox that practice 4 depends on, which is a
  claim an agent must make, not a form a human fills in.
- No standups. See practice 6; there is no team to synchronize.
- No estimates and no story points. A solo founder plus agents does not
  need capacity planning against a velocity metric.
- No label taxonomy up front. Add a label only when a real, recurring
  query needs it (for example "show me everything blocking the alpha
  gate"). An empty taxonomy invented on day one is dead weight. A
  one-label-at-a-time taxonomy earned by actual need stays useful.

*Why:* each of these is ceremony that coordinates multiple humans or
sets expectations for outside contributors. Adopting them anyway,
"because a real project has them," is pure overhead here. The
anti-patterns below show what that overhead costs.

---

## Periodic reviews: the process reviews itself

The practices above are themselves a system, and systems drift. Vendors
re-gate features. CI bills creep. Docs diverge from the tracker.
Automation briefs go stale against reality. Two recurring review passes
keep the process honest. The cadences are **defaults to tune, not
mandates**; the low-ceremony rule applies to meta-process too.

### External-tool feature audit (default: quarterly)

Every few months, audit each vendor in the stack (code host, database or
BaaS, CDN and hosting, error tracking, auth, and so on) against its
**current official documentation**:

- Run one doc-cited research agent per vendor. **Never answer
  availability or pricing questions from memory.** Model knowledge of
  vendor tiers is stale by construction. Fetch the current docs, and
  verify plan-gating against the actual account type in use (personal or
  org, free or paid), not against the marketing page's happy path.
- Each agent reports three lists, with a doc URL per claim: **adopt**
  (free, fits, do it), **maybe** (useful but plan-gated or needs a
  decision), and **refuted: do not re-research** (investigated,
  unavailable or not worth it, with the citation that proves it).
- Decisions go to the founder as structured pop-up questions. Adopted
  items are filed to the board. Quick wins are implemented in the same
  session.
- Archive the whole result as a **dated do-not-re-research file** in the
  project.

The refuted list with citations is the high-value half. It stops every
future session from re-hunting the same dead ends. ("Can we buy the
managed merge queue?" No. See the archive.) One pass on the source
project found a zero-config dependency-update gap, free board
automations nobody had enabled, and the root cause of a live
stale-deploy bug.

### Process / best-practices review (default: fortnightly, or scoped pre-milestone)

A recurring pass over the delivery system itself: board hygiene (is the
inbox milestone triaged, do columns match reality), CI cost against
value, doc-vs-tracker drift, dependency freshness, and
**automation-brief freshness**. For that last one, the automation
re-reads its own skill and manual files against observed reality. It
fixes *descriptive* drift in place, and it surfaces *normative* changes
as founder decisions, never self-applied. Each pass also emits **kit
promotion candidates**, report-only: lessons general enough to move
upstream into this kit or the founder's global instructions (see the
delivery-flow workstream, C2, in `claude/skills/overnight-review`).

Two disciplines make these reviews compound instead of merely
accumulate:

- **Prevention-layer classification.** Tag every confirmed finding with
  the earliest layer that could realistically have caught it: a
  pre-merge review, a CI or lint gate, a test at a named level, spec or
  decision hygiene, or **audit-only** (no cheaper layer exists). Report
  the distribution. A recurring escape class is a candidate for a new
  standing gate. "Audit-only" is a legitimate answer. And a proposed
  layer that would cost more than the class it prevents is a finding
  *against* the proposal.
- **New process ideas run as trials with a ledger, not adopted as
  rules.** A candidate practice gets a bounded trial with a per-instance
  ledger: findings, false positives, latency, cost. Then the founder
  makes an explicit call: adopt, tune, or drop. For a new **review**
  mechanism, add a detection test to the trial. Fix the pass and fail
  criteria in writing before the first run. Seal an answer key of known
  defects: hash it, publish the hash, reveal the key after the run. The
  mechanism must independently re-find at least one known defect (the
  detection gate), and the founder must accept a stated share of its
  findings as real work (the usefulness gate). A review mechanism that
  cannot re-find a known defect is theater. This pattern has run three
  times on the source project, and each time it separated real signal
  from plausible noise. Worked example: the
  source project trialed a pre-merge adversarial-review gate on feature
  PRs. Two trial waves stopped five would-ship P1 bugs with zero
  false-positive blocks, and the founder adopted the gate as a standing
  rule on 2026-08-14. The gate's protocol ships as a template:
  `templates/adversarial-review-gate.md`, complete with the trial ledger
  and the decision rule. The same discipline applies to infrastructure
  buy-vs-rent calls. **Re-run those decisions on post-optimization
  numbers**: thresholds written down before a cost optimization are
  stale the moment it lands.

### The unrecoverables audit (default: quarterly)

One class of failure gets its own periodic pass, because it does not
fail toward a rollback. It fails toward permanent loss: a signing key,
an encryption key, the only copy of user data. The checklist is small
and lives in `templates/unrecoverables-audit.md`: prove every escrow by
use, drill a real restore on real data, diff the deletion list against
the live schema, and feed corrupted bytes to every parser that reads
untrusted input. One day of this audit on a mature, heavily reviewed
project found four real gaps of exactly this class.

*Why:* without a scheduled look outward (what did the vendors change?)
and inward (what did our own process quietly become?), the process
calcifies around the constraints of its first month. The audits are
cheap (a few agent-hours on a schedule), and each one pays: it finds
real money or capability on the table, or it produces citations that
permanently stop re-research.

---

## The proving ground

*Dated 2026-08-25. The quarterly practice review (see "Periodic
reviews") reconciles this list: when an entry's condition resolves, the
entry is promoted into the kit, or retired with a reason.*

The kit ships only what survives contact with a real build. The
practices below are adopted and running on Sortomate, the live
production build this kit comes from, but they have not earned a place
in the kit yet. Each entry names its promotion condition, so you can
see what is coming and why it is not here yet.

- **Architecture review.** A periodic structural review of the codebase
  against its own architecture map: drift, boundaries, duplication,
  oversized components. Catch-and-report only; its detection test
  passed on day one. *Promotes when the founder accepts most of its
  baseline findings.*
- **Practice review.** A quarterly meta-review that diffs the operating
  model itself against external best practice, plus an inward lens that
  proposes decommissions. Its first ad-hoc run produced most of this
  section. *Promotes after its first scheduled run.*
- **Red-lane discipline.** For an expensive non-required check such as
  E2E, a workflow maintains one canonical red issue with a normalized
  failure signature and a day counter. A stale red escalates and blocks
  release cuts, not merges, and dismissals are scoped to the recorded
  signature, so a novel failure cannot hide inside a known red.
  *Promotes after it is built and correctly handles one real red-lane
  episode.*
- **Evidence packets.** Builders attach the command, the exit code, and
  the output as proof on every verification claim, and CI warns on
  claims without proof. *Promotes after one wave of report-only
  piloting without false-positive noise.*
- **Agent containment.** A canary token in the secrets file with a
  session-end scan, plus report-only logging of credential-file reads
  and upload-shaped commands. *Promotes after a one-week report-only
  trial.*
- **Size and complexity ratchet.** A lint with per-file ceilings,
  grandfathered at adoption; raising a ceiling requires a recorded
  reason. It caught a real cross-PR break on its first day. *Promotes
  after a week of nobody disabling it.*
- **Run contracts.** A builder posts goal, non-goals, stop condition,
  evidence plan, and retry budget on the issue before coding. *Promotes
  after one wave shows reviewers using the contracts.*
- **Leader's-intent kickoff.** The overnight review asks the founder
  what failure means this round, and the answers become that run's
  grading criteria. Each report states the yield. *Promotes if the
  yield stays above zero.*
- **Autonomy metrics.** Time between interventions, rework rate,
  escapes per gate, founder minutes per change, tokens per accepted
  change. *Carries a sunset instead of a promotion condition: dropped
  if two consecutive reviews cite them in no decision.*
- **Staged for later stages of the source project**, listed for
  completeness: a deletion test (an agent deletes one subsystem in a
  throwaway copy and rebuilds it from tests and docs alone; every
  behavior the rebuild gets wrong becomes a new test), kill switches (a
  runtime off-switch for each surface where a defect is unrecoverable,
  so stopping a bad build does not require shipping a new one), and an
  agent-drivable app (the product exposes a surface agents can drive,
  so agent testers can run real user flows). None has a promotion
  condition yet.

---

## What transfers, and what does not

Every practice above states the mechanism that earned it, and those
mechanisms are GitHub, PowerShell, and a single editor. So each practice
carries two layers: an argument, and a delivery vehicle. They transfer at
different rates. The argument outlives the vehicle. Vendors re-gate
features, and a shell script is only as portable as its shell.

This table separates the two once, so that each reader does not have to.
Use it with the four-step exercise in the top tip. The table tells you
which practices are worth adapting. The exercise adapts them to your
project.

| Layer | Verdict | What it takes |
|---|---|---|
| The seven principles | **Portable** | No tool appears in any of them. |
| 1. One source of truth, agent-maintained | **Adapt** | Any tracker with an API serves. The board is not the point; one truthful source is. |
| 2. `CLAUDE.md` as operating manual | **Portable** | The argument transfers; the filename does not. `AGENTS.md` is the cross-vendor equivalent, read by 25+ tools. Claude Code reads only `CLAUDE.md`, so a repo using both puts `@AGENTS.md` on the first line of `CLAUDE.md` and adds anything Claude-specific below it. On Windows use that import, not a symlink. |
| 3. Correction-capture memory loop | **Portable** | |
| 4. Tests as agent-verification infrastructure | **Portable** | Take the argument about test shape, not the counts. |
| 5. Guardrails | **Adapt** | `guardrail.js`, `prompt-context.js`, and `agent-ledger.js` are Node, and call no `gh`. They run anywhere Node runs. `pr-merge-gate.js` does call `gh`, so it needs a GitHub-shaped host or a rewrite. Branch protection and auto-merge are code-host features, not portable code. |
| 6. AI-native ceremonies | **Solo** | It removes ceremonies that a team still needs. |
| 7. Judgment gates | **Adapt** | A team must name an owner per gate. One editor makes the owner implicit. |
| 8. Automation shaped by cost | **Portable** | It applies to developer seconds as readily as to CI spend. |
| 9. Parallel-agent hygiene | **Portable** | |
| 10. Deliberate omissions | **Inverts** | Each omission is justified by there being one human. |
| Guard telemetry, and the hook delivery facts | **Portable** | See `claude/README.md`. Delivery facts are Claude Code facts, not project facts. |
| The unrecoverables audit | **Portable** | 39 lines, and the least platform-bound thing here. |
| Self-merge on green CI | **Solo** | |
| `.claude/` kept git-ignored | **Inverts** | Above one person, commit the shared hooks and skills. Ignore only local settings. |
| `scripts/*.ps1`, the bootstrap, the board | **Rewrite** | Windows and GitHub throughout. |

One caveat on the evidence for this table. It comes from a single
external reading, on 2026-08-28: a CTO assessed the kit for a
six-developer team, on a stack with no GitHub and no PowerShell in it.
The verdicts above match what survived that reading. One data point sets
the shape of the table. It does not prove every row.

That reading also corrected the kit twice. It named guard telemetry as
something to copy from `guardrail.js`, where it did not exist. And it
read practice 10 as omitting a PR template, which the kit in fact ships.
Both faults were ours: a document that describes a pattern the code does
not implement, and an omission list that reads as longer than it is.

The first of those classes was not a one-off. A later self-review found
four more, all on the day-one path: a bootstrap that substituted nothing
while this file said it did, branch protection this file announced and
the script never applied, a shipped CI workflow that could not trigger
on the branch the script creates, and a review mechanism weaker than the
practice that points at it. Each one is fixed. The class is not, and by
principle 1 that makes it a missing mechanism rather than four more
corrections. The kit does not ship that mechanism yet, and says so here
rather than letting the next reader assume the docs and the code agree.

---

## Where this model stops

This model is built for one context: a solo founder, and a product
whose worst failure is a bug and a rollback. Users are fine; the
verification harness above exists to protect them. What the model does
not cover is any context where a failure cannot be rolled back, or
where someone else's rules govern how software must be verified.

- **Safety-critical, regulated, or externally-liable software.**
  Nothing here substitutes for independent verification or a human
  reviewer of record. Do not carry the self-merge pattern into that
  world.
- **Teams.** The single-editor structure concentrates every judgment
  gate in one person. An organization adopting these practices needs
  named decision owners, human review (a CODEOWNERS file, reversing
  practice 10's omission), and risk tiers that decide which changes an
  agent may merge alone. The table above marks which practices survive
  that change and which invert. The mechanisms and the arguments
  transfer. The delivery vehicle and the gates that assume one person do
  not. One inversion is worth stating on its own: a team should commit
  its shared hooks and skills, and ignore only its local settings. Keep
  them private and each developer rebuilds the same tooling alone, or
  nobody builds it at all.
- **Diligence.** The kit keeps no record of which code an agent
  generated, with which model, reviewed by whom. If provenance will
  ever matter to you, build that record from day one.

The five manual duties shrink in keystrokes as the system matures; see
practice 7. The judgment they carry does not.

---

## Anti-patterns learned the hard way

Do **not** carry these forward. Each one was tried, directly or by
analogy, and cost more than it returned.

- **Label taxonomies nobody queries.** A speculative label set
  (`priority:P1`, `type:bug`, `area:frontend`, …) invented up front
  turns into upkeep with no payoff, because nothing ever filters by it.
  Add a label reactively, the moment a real query needs it. Not before.

- **Status snapshots baked into docs.** A "current sprint" section in
  `CLAUDE.md`, a "what's done so far" paragraph in a handover doc: any
  status stated in prose goes stale at the next merged PR, and then it
  actively misleads the next reader, including a future agent. Status
  lives in exactly one place: the tracker. Docs describe the system, not
  its current state.

- **Copying failure-specific rules from an old project instead of
  re-earning them.** Bulk-importing another project's standing-rules
  file "to save time" is tempting. Resist it. A rule that exists because
  of a specific old failure (one flaky test, one library footgun) is
  noise on a project that never had that failure, and it crowds out the
  rules that do apply. Let the correction-capture loop (practice 3)
  re-earn the new project's rule set from its own corrections. Carry
  forward only the genuinely general practices. This document is exactly
  that kind of transfer; an incident log is not.

- **Heavy milestone/phase structure on day one.** A multi-phase roadmap
  with named phases and exit gates becomes valuable once issue volume
  makes "what's next" non-obvious. Empirically, that point arrived at
  several hundred open issues. Starting there on day one is premature
  process. Start with three buckets, **Now / Next / Later**, and
  introduce formal phases only when the issue count forces it.

- **Building an E2E layer before there is a cloud boundary to test, and
  before its absence has bitten you once.** E2E is the most expensive,
  most brittle layer in the pyramid. It is worth its cost only for flows
  that cross a real external boundary: auth, sync, a hosted database,
  payments. Building it preemptively for pure-local logic buys flakiness
  with no payoff. Once you do have cloud-boundary flows: reserve E2E for
  exactly those, gate it behind a CI path-filter so it does not run on
  unrelated PRs, and use per-run isolated test accounts (a shared test
  account makes E2E a serialization bottleneck and a source of cross-run
  contamination). Run the full suite on a weekly schedule as well, so
  drift is caught between triggering changes.

- **Deploying a static-hosted SPA with no cache-control story.** A web
  app served from a static host or CDN, with no explicit cache headers,
  can leave users on a build many releases stale. The failure is silent:
  every fresh check "works on my machine." Set explicit cache headers
  (long-lived hashed assets, a revalidated entrypoint) and version the
  bootstrap entrypoint from day one. Do not rely on a framework's
  service-worker self-update magic. Support corollary: when a user
  reports long-fixed behavior, suspect a stale client first.

- **Mixing personal backup data into a shareable kit repo.** A repo
  meant to be shared or published (a starter kit, a template, this
  document) must stay generalized: no project-specific facts, no
  personal state. The violation happens by accident. On this project, a
  "back up my agent config" script that committed into the kit's own
  working tree quietly turned a shareable repo into a leak of whatever
  it backed up: cross-project memory files that spanned several
  unrelated clients. Keep the two concerns in physically separate repos from the
  start (see "State backup" below). Do not rely on remembering to scrub
  one out of the other before every publish.

- **A hook shipped by default with no log and no recorded catch.** The
  kit shipped a Stop-hook (`ci-status.sh`) that silently checked CI
  status after every push. It looked cheap and safe, so nobody
  questioned it. An audit found it had produced zero recorded catches,
  kept no log to prove otherwise, and duplicated a duty a standing rule
  already assigns (verify CI is actually green, with an explicit check,
  before calling a push done). Retired 2026-08-22. A hook earns a
  permanent place in the kit once it can point at evidence it caught
  something the rule alone would have missed, the same bar
  `branch-sweep.sh`'s ledger meets. Until a hook has that evidence, keep
  the duty as a rule, not a script. The guard-telemetry pattern in
  `claude/README.md` makes that evidence cheap to collect from day one.

---

## Day-one bootstrap

### Get the kit

```powershell
git clone https://github.com/adriaan-wessels/solo-ai-kit.git
cd solo-ai-kit
```

Before running anything, check the prerequisites:

- **Windows.** The scripts are PowerShell 5.1; there is no macOS or
  Linux port. The practices themselves are tool- and OS-agnostic, so
  the model transfers; porting the automation is on you.
- **`git` and the GitHub CLI (`gh`)**, installed, with `gh auth login`
  done. The board setup also needs the `project` scope:
  `gh auth refresh -s project`.
- **Node.js on PATH, and Git Bash as your `bash`** (not the WSL stub in
  `AppData\Local\Microsoft\WindowsApps`). The hooks under `claude/`
  need both; see `claude/README.md`.
- **An AI coding agent already set up.** The kit is built and tested
  against Claude Code. The same principles apply to other agents, but
  adapting the hooks, skills and settings is on you.
- If PowerShell refuses to run the scripts, unblock them for the
  session: `Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass`.

**The four-step version of the tip at the top:** this kit is written
to be read by agents, not only by people. Point your AI assistant at
the repo and ask it to:

1. Read the handbook.
2. Say which practices adapt best to your situation, and the pros
   and cons of each.
3. Propose an adapted implementation.
4. Discuss the plan with you before it builds anything.

The exercise works on any stack. Not on Claude Code or Windows? It is
also how you port the kit, and adapting it is a good first exercise
in the operating model it teaches.

**Feedback is welcome.** Open a GitHub issue for a bug, a broken step,
or a gap in the kit. I want to hear about it.

A real (non-`-DryRun`) run creates a real private repository and a real
Projects board on your GitHub account. Preview with `-DryRun` first.

### The bootstrap script

`scripts/bootstrap.ps1` automates the repeatable slice of new-project
setup under this model. It is **PowerShell 5.1-compatible** (no `&&`, no
ternary, no null-coalescing), so it runs on a stock Windows machine with
the prerequisites above.

```powershell
# Preview every step without touching anything (local or remote):
.\scripts\bootstrap.ps1 -ProjectName "my-new-project" -DryRun

# Actually run it:
.\scripts\bootstrap.ps1 -ProjectName "my-new-project" -Description "One-line pitch" -Owner "your-gh-username"
```

**What it automates (via `gh` and `git`):**

- Creates the local project directory and initializes a git repo.
- Copies `templates/CLAUDE.md`, `templates/pull_request_template.md`,
  and `templates/ci/generic-ci.yml` into the new project, and
  substitutes the project name where the templates mark it. Every other
  `<PLACEHOLDER: ...>` marker survives the copy on purpose. A marker you
  can see beats a value the script guessed. The copied CI workflow
  triggers on `master` and `main`, because a stock `git init` on Windows
  produces `master` and a workflow that names only `main` never runs.
- Copies `claude/` into the new project's `.claude/` **on disk only**.
  It is never committed (it goes into `.gitignore`). This matches the
  convention that the automation layer is a personal, local tool, not
  project source.
- Makes the first commit and creates the GitHub repo from the local
  directory in one step (`gh repo create --source . --push`), so the
  initial push happens automatically.
- Creates a GitHub Projects (v2) board titled after the project, sets
  its Status field's options to **Backlog / Next / In Progress / Done**,
  and links the board to the new repo. (The GitHub API cannot edit an
  existing single-select field's options in place, so the script deletes
  the default Status field and recreates it: same field name, right
  values.)
- Enables squash auto-merge on the repo.
- Sets branch protection on the default branch: `enforce_admins` on,
  force pushes off, branch deletion off. Those three need no CI run, so
  they go on during the bootstrap run. The required status check is the
  one part that has to wait, because you cannot require a check name
  that no run has produced yet. The script prints that as a follow-up
  and the repo is protected in the meantime.
- Leaves "require branches to be up to date" (`strict`) **off**. On a
  personal private repo the merge queue is unavailable at any price, and
  strict protection then starves a green auto-merge-armed PR silently
  whenever another PR lands first. See "Platform constraints worth
  knowing up front". Turn it on only alongside a merge-train workflow.

Hooks can install two ways: per project (bootstrap's default) or once,
machine-global. When a hook is already installed machine-global, bootstrap
skips wiring it again for the new project. See `claude/README.md` for the
machine-global setup.

**What it prints as a manual step instead of failing.** Each such step
gets a clear, direct instruction, not a silent skip:

- Any step whose `gh` or API call errors (for example the Status-field
  rebuild, if the account lacks the `project` scope). The script prints
  the exact manual fix and, where it can, a direct console URL.
- Filling the real required-status-check name into branch protection
  once the first CI run has produced one. The placeholder cannot be
  resolved before any run exists.
- Anything outside `gh`'s surface entirely: inviting collaborators,
  enabling paid features, org-level policy that needs the GitHub web UI.

The script deliberately automates nothing else, because the rest of the
model is not day-one setup. Writing the first real issues, running the
first testing-notes triage, growing `CLAUDE.md`'s gotchas from real
corrections: those are ongoing practices, and they start the moment the
first PR does.

### Post-bootstrap checklist (web UI)

A few valuable settings have no `gh` or API surface, so the script
cannot set them. They are the same short list after every bootstrap, and
the script prints this checklist at the end of each run:

1. **Turn on the project board's built-in automations.** Open the new
   project → `…` menu → *Workflows*. Turn on **Auto-add to project**
   (new issues and PRs from the linked repo) **and** the separate **Item
   added to project** workflow with its Status set to **Backlog**.
   Auto-add alone only adds items, with *no* status. Without the second
   workflow you get a "No status" pile instead of a Backlog column. Also
   turn on **item closed / PR merged → Done**. Plan note: Free allows
   exactly one auto-add workflow per board, Pro five; fine for the kit's
   single board. These automations use no PAT, no Actions minutes, and
   no GraphQL quota. Prefer them over scripted board moves for every
   transition they can express (practice 8); keep scripts only for what
   they cannot (moves between non-terminal columns).
2. **Turn on Dependabot's security side.** Repo *Settings → Security*
   (GitHub currently labels the section "Code security" or "Advanced
   Security"; it moves): turn on **Dependabot alerts** and **security
   updates**. These are free, low-noise, and independent of any
   `dependabot.yml`: per GitHub's docs, the settings and the file do
   not interact. Treat the *version-update* stream (`dependabot.yml`) as
   optional, not as a default. The source project ran it and retired it
   on 2026-08-15, after one week left 12 version-update PRs stuck: a
   continuous push of update PRs fights a periodic-pull process, and the
   ignore rules needed to make it safe rot silently. The kit-default
   replacement is the dependency-freshness line in the periodic process
   review (see "Periodic reviews"), which batches upgrades into
   deliberate issues. `templates/ci/dependabot.yml.example` remains for
   projects that want the PR stream anyway.
3. **After the first CI run:** add the real required-check name to the
   branch-protection rule the script already created. Leave "Require
   branches to be up to date" off unless you run a merge-train workflow.
   The script also prints this as a per-run follow-up.

### Platform constraints worth knowing up front

Durable plan-gating facts, recorded once so no future project
re-researches them. **Verified 2026-08-11 against current vendor docs;
re-verify at the next tool audit** (see "Periodic reviews"); vendors
re-gate features without notice.

- **GitHub's native merge queue is unavailable to a personal private
  repo at any price.** It requires an org-owned repo, and for private
  repos it additionally requires Enterprise Cloud. Consequence: with
  strict ("require branches to be up to date") branch protection, a
  green auto-merge-armed PR silently starves as `behind` whenever other
  PRs land first, and GitHub never notifies. With many parallel PRs you
  must build your own updater: a small "merge train" workflow. Caveats
  for that workflow, each learned from a failure:
  - GitHub's `schedule` cron is best-effort. Trigger on `workflow_run`
    instead. This applies to the merge train, not to scheduled work in
    general. Best-effort timing is fine for the nightly lanes, reminder
    crons, drift probes and keepalives in practice 8, where an hour of
    slip costs nothing. It is not fine for a trigger that has to fire
    promptly after another event.
  - Filter to *required* checks, or one red non-gating check starves
    the queue.
  - Poll check-run conclusions, not PR state; `blocked` conflates
    queued and failed.
  - Pushes made with the default `GITHUB_TOKEN` do not trigger CI. Use
    a scoped PAT for the update-branch push.
  - Leave workflow scope off that PAT on purpose. The train then cannot
    advance a PR that touches workflow files, and those PRs need a
    founder-scoped direct merge. That is by design: the automation
    cannot rewrite the automation.
  - Give the train a way past a stuck head. When the front PR cannot
    proceed, skip it and update the next eligible PR; otherwise one
    stuck PR parks the whole queue. (Learned 2026-08-15.)
- **Secret scanning / push protection is not available on user-owned
  private repos** (Enterprise-gated). If you want the guard, run a
  scanner such as `gitleaks` in CI instead.
- **Larger runners and issue types are org-only.** Plan around the
  standard runners on a personal account.
- **Available on personal Free/Pro and worth using:** sub-issues, issue
  dependencies ("blocked by"), Projects built-in automations,
  Dependabot, and `gh release create --generate-notes`.
- **Supabase Free tier has NO automatic server-side backups.** None.
  Bring your own backup path from day one. Database branching is
  Pro-gated, and PITR needs Pro plus paid compute. CLI migrations,
  `pg_cron`, Vault, TOTP MFA, and pgTAP are all free. On any Supabase
  project, adopt **CLI migrations from day one**: a `db pull` baseline
  plus versioned migration files, applied by automation after founder
  approval (see practice 7's live-DDL gate).
- **Google Play / Google OAuth gates:** a personal Play developer
  account must pass a closed test with 12 opted-in testers over 14
  continuous days before production access; internal testing does not
  count toward it. A GCP OAuth app that uses only basic sign-in scopes
  is exempt from the 100-test-user cap and the 7-day refresh-token
  expiry. Adding any scope beyond those basic sign-in scopes (sensitive
  or not) silently drops that exemption.

### What stays manual, always

Independent of tooling, per the operating model above: use the product,
write raw testing notes, answer decision pop-ups, approve UI mockups
before they ship, and approve schema changes to a live, populated
database (early on, apply them by hand too; practice 7 covers how that
gate matures). No automation should try to remove these five. They are
where the founder's judgment is the product, and judgment, not
keystrokes, is the part that stays manual.

---

## State backup (two-repo model)

This kit is shaped to be shared: generalized, placeholder-driven, free
of project-specific or personal content. The correction-capture memory
loop (practice 3) is the opposite by nature. It is your actual global
`CLAUDE.md` and the real per-project memory files it indexes, which can
span several unrelated projects: client work, personal projects,
whatever else runs through the same agent setup. That content has real
value as a backup and no business in a repo meant for others to read.

So the backup lives in a **second, separate, private local repo**:
`claude-state`, a sibling of this kit's repo, never inside the kit
itself. `scripts/backup-claude-state.ps1` writes only into that repo:

```powershell
# One-time setup (the script deliberately never does this for you, so a
# mistyped path can't silently start committing into the wrong place):
New-Item -ItemType Directory -Path "..\claude-state" -Force
git -C "..\claude-state" init
# set git identity in that repo if you don't have a global one

# Every time you want a fresh snapshot:
.\scripts\backup-claude-state.ps1
```

Each run copies the global `CLAUDE.md` and every
`~/.claude/projects/*/memory/` directory into `claude-state/`, then
makes one dated commit there and pushes it to the backup remote (both
are skipped if nothing changed since the last run). `-BackupRepoPath`
overrides the default sibling location; `-DryRun` previews without
touching anything.

Treat `claude-state` as private. Do not publish it the way you would
publish a kit repo built from this one. It is a personal, operational
backup, not a deliverable.

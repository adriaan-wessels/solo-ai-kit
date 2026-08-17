# Solo Founder + AI Agents — Bootstrap Kit

This kit is a portable playbook and starter set for one operating model:
**one founder acts as editor, and AI coding agents act as staff.** The
agents maintain the tracker, write the code, verify it, and merge on
green CI. The founder keeps five recurring jobs: use the product, dump
raw testing notes, answer decision pop-ups, approve UI mockups, and
approve live-DB schema changes (early on, apply them by hand too;
practice 7 shows how that gate matures).

The kit comes from a live process review of the Sortomate project
(2026-07-21). On that project, the model produced:

- 30 merged PRs in less than 5 days, with zero PRs left open;
- 20 of 20 green CI runs on `master`;
- a 600-item GitHub Project board with zero mismatches between the board
  and reality;
- a test pyramid of about 2,000 unit/widget tests, 147 integration
  tests, and only 12 E2E specs, with E2E reserved for flows that cross a
  real cloud boundary.

These numbers show that the model works. They do not show that it is
easy. The leverage comes from the practices below, not from the tools
alone.

---

## The operating model

**The founder is the editor. The agents are the staff.** The agents own
the mechanics. They read and write the issue tracker, implement
features, run and write tests, merge their own PRs when CI is green, and
keep the project board truthful in real time. The founder's recurring
duties stay deliberately narrow:

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

**Definition of Done means: match the test level to the change.** It
does not mean "add an E2E spec for everything." And when a change
declines a test level, **say so in the PR, never silently**. "Verified
manually, screenshot attached" is a legitimate line in a PR description.
A PR that does not mention testing at all is not.

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
- **Squash auto-merge on green CI.** A PR that passes its required
  checks merges itself. Nobody has to be awake to click the button.
- **Explicit, scoped AI merge authority.** The founder grants agents
  standing permission to merge their own PRs once green CI plus branch
  protection is the enforced bar. The grant explicitly excludes
  destructive operations, releases, and anything the founder has flagged
  for personal review.
- **A stop-hook that surfaces CI status after every push.** A small
  script checks the current commit's CI runs when an agent session ends
  and reports anything non-green. "I pushed" and "I verified it is
  green" never get silently conflated.
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
  template optimizes for humans filling out a form.
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

## Periodic reviews — the process reviews itself

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
  decision), and **refuted — do not re-research** (investigated,
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
upstream into this kit or the founder's global instructions (see
`claude/skills/overnight-review`, workstream C2).

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
  makes an explicit call: adopt, tune, or drop. Worked example: the
  source project trialed a pre-merge adversarial-review gate on feature
  PRs. Two trial waves stopped five would-ship P1 bugs with zero
  false-positive blocks, and the founder adopted the gate as a standing
  rule on 2026-08-14. The gate's protocol ships as a template:
  `templates/adversarial-review-gate.md`, complete with the trial ledger
  and the decision rule. The same discipline applies to infrastructure
  buy-vs-rent calls. **Re-run those decisions on post-optimization
  numbers**: thresholds written down before a cost optimization are
  stale the moment it lands.

*Why:* without a scheduled look outward (what did the vendors change?)
and inward (what did our own process quietly become?), the process
calcifies around the constraints of its first month. The audits are
cheap (a few agent-hours on a schedule), and each one pays: it finds
real money or capability on the table, or it produces citations that
permanently stop re-research.

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

---

## Day-one bootstrap

`scripts/bootstrap.ps1` automates the repeatable slice of new-project
setup under this model. It is **PowerShell 5.1-compatible** (no `&&`, no
ternary, no null-coalescing), so it runs on a stock Windows machine. The
only prerequisite is an installed, authenticated GitHub CLI (`gh`).

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
  substitutes the project name into the placeholders it can safely
  fill.
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
- Sets branch protection on the default branch: required status checks
  (a placeholder; fill in the real CI job name once the first run
  exists), `enforce_admins` on, force pushes and branch deletion off.

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
3. **After the first CI run:** fill the real required-check name into
   branch protection. The script also prints this as a per-run
   follow-up.

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
    instead.
  - Filter to *required* checks, or one red non-gating check starves
    the queue.
  - Poll check-run conclusions, not PR state; `blocked` conflates
    queued and failed.
  - Pushes made with the default `GITHUB_TOKEN` do not trigger CI. Use
    a scoped PAT for the update-branch push.
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

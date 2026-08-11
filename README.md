# Solo Founder + AI Agents — Bootstrap Kit

A portable playbook and starter kit for running a software project as **one
founder acting as editor, with AI coding agents as staff**: the agents
maintain the tracker, write the code, verify it, and merge on green CI. The
founder's recurring job shrinks to five things — use the product, dump raw
testing notes, answer decision pop-ups, approve UI mockups, and approve
live-DB schema changes (early on, applying them by hand too — see practice 7
for how that gate matures).

This kit was extracted from a live process review of the Sortomate project
(2026-07-21). In that project the model produced: 30 PRs merged in under 5
days with zero PRs left open, 20/20 green CI runs on `master`, a 600-item
GitHub Project board with zero state mismatches between the board and reality,
and a test pyramid of roughly 2,000 unit/widget tests, 147 integration tests,
and only 12 E2E specs (E2E reserved for flows that cross a real cloud
boundary). Those numbers are evidence the model works, not a claim that it's
easy — the leverage comes from the practices below, not from the tools alone.

---

## The operating model

**Founder as editor, AI agents as staff.** The agents own the mechanics:
they read and write the issue tracker, implement features, run and write
tests, merge their own PRs when CI is green, and keep the project board
truthful in real time. The founder's recurring obligations are deliberately
narrow:

1. **Use the product** — daily-driving it is the primary QA signal.
2. **Dump raw testing notes** — unstructured, as they occur to you; agents
   turn them into scoped, deduplicated issues.
3. **Answer decision pop-ups** — short, structured questions posed by agents
   when a call genuinely needs a human (product direction, taste, risk
   tolerance) — not a status update, a question with options.
4. **Approve UI mockups** — before a visual change ships, not after.
5. **Approve live-DB DDL** — schema changes against a hosted database are
   the one category of "irreversible against real data" where a human hand
   stays on the trigger. Early on that means applying the SQL by hand; as
   the project matures it means approving the migration file before
   automation applies it (practice 7). The judgment is the permanent manual
   part, not the keystrokes.

Everything else — writing code, writing tests, triaging bugs, grooming the
backlog, running the release, merging PRs, keeping docs in sync — is agent
work. The founder's time is the scarcest resource in the system; the practices
below exist to keep as much of it as possible off the critical path without
losing correctness or the founder's own judgment where it actually matters.

---

## Portable practices

Each of these generalizes beyond the project it was learned on. They're
listed roughly in the order a new project should adopt them.

### 1. One machine-readable source of truth, maintained by agents

The issue tracker (GitHub Issues + a Project board) is the spec, not a
downstream mirror of one. Issue bodies are the requirements; **issue comments
are the decision-of-record** — when the founder settles a question, the
answer is posted as a comment on the issue, not relayed through chat and
hoped to be remembered. The board's columns are always live: an agent moves a
card the moment it starts work and the moment a PR merges, not in a batch at
the end of a session. When any written status (a handover doc, a stale
paragraph, a summary) disagrees with the board, **the board wins** — fix the
prose, don't trust it over the tracker.

Two disciplines keep the tracker usable once issue volume grows. **File every
issue with a milestone** — default new findings into a designated
inbox/bucket milestone (e.g. "Code health / tech debt") that gets a triage
pass at each periodic review (see "Periodic reviews" below), so nothing is
ever unmilestoned and the unsorted pile is explicit rather than invisible.
And before composing any decision menu for the founder, **retrieve the
existing decision-of-record properly**: search issue *bodies*, not just
titles, using the founder's own vocabulary, and sweep discussion tickets and
umbrella/spec issues — that's where open questions get parked, and they
rarely keyword-match.

*Why:* a spec that lives in chat transcripts or a person's memory doesn't
survive a context switch, a new agent picking up the thread, or the founder
being away for a day. A spec that lives in the tracker is queryable,
diffable, and durable — and agents can be told "the board wins" once and then
trusted not to relitigate stale status forever.

### 2. `CLAUDE.md` as the project operating manual

A single file at the repo root holds the durable facts an agent needs to
work in the codebase without re-discovering them every session: run/test/build
commands, the architecture map, naming and code conventions, known gotchas,
and standing rules the founder wants respected by default. It is a **manual,
not a status report** — it says how the codebase reads and how the team
works, and deliberately does not say what's in progress this week. Status
belongs in the tracker (practice 1); the moment `CLAUDE.md` starts
accumulating "current sprint" paragraphs, it starts going stale the way every
status doc does, and agents start trusting stale prose over the live board.

The strongest form of this rule — adopted after a weaker "keep the status
section fresh" version failed repeatedly — is that the doc carries a
**pointer to the board and nothing else**, plus an explicit instruction that
any status prose creeping back in should be deleted on sight: it rots by
construction, so the only stable amount of it is zero.

*Why:* it is the cheapest possible onboarding cost for a new agent, and it
compounds — every gotcha documented once is a gotcha no agent re-discovers
the hard way again.

### 3. Correction-capture memory loop

Every time the founder corrects an agent — a wrong assumption, a stale
belief, a preference stated once — that correction gets written down as its
own small, typed, indexed memory file: `feedback_*` for how-to-work
corrections, `user_*` for founder facts/preferences, `project_*` for project
facts and decisions, `reference_*` for pointers and tooling notes. An index
file lists all of them, one line each, so a future agent can skim the map
before it needs the detail.

This structurally **replaces the human retro** — instead of a periodic
meeting where the team tries to remember what went wrong, every correction is
captured at the moment it happens, indexed, and available to every future
session. Part of the same loop: a **refuted-findings ledger** — when a review
pass investigates a suspected bug and finds it isn't real, that gets recorded
too, so the next review doesn't re-spend a cycle re-hunting a lead that's
already been disproven.

*Why:* without this, the same correction gets made repeatedly across
sessions — the founder re-explains the same preference, agents re-discover
the same false lead. The loop turns each correction into a one-time cost.

### 4. Tests as agent-verification infrastructure

The test suite is not there to satisfy a coverage metric — it's the
mechanism that lets an agent merge its own work with confidence, because a
human isn't going to eyeball every diff. The pyramid shape matters: cheap,
fast unit/widget tests carry most of the weight; the expensive, brittle,
often-shared-account E2E layer is reserved for flows that genuinely cross a
boundary a lower layer can't reach (auth, sync, payments, anything hitting a
real external service).

**Definition of Done = match the test level to the change**, not "add an E2E
spec for everything." And critically: **declining a test level must be stated
in the PR, never silent** — "verified manually, screenshot attached" is a
legitimate line in a PR description; a PR that just doesn't mention testing
at all is not.

*Why:* an E2E-only strategy is slow and flaky, which trains agents (and
humans) to ignore red runs; an untested strategy means agents can't safely
self-merge. Matching level to change keeps the suite both fast and trustworthy
enough to gate merges on.

### 5. Guardrails that convert founder absence into throughput

The founder being asleep, offline, or simply not looking should not stall the
project. The mechanism is a small stack of GitHub-native guardrails:

- **Branch protection** on the default branch: required status checks (CI
  must be green) plus `enforce_admins` (the rule applies to everyone,
  including whoever has admin rights — no quiet bypass).
- **Squash auto-merge on green CI** — a PR that passes its required checks
  merges itself; nobody has to be awake to click the button.
- **Explicit, scoped AI merge authority** — the founder grants agents standing
  permission to merge their own PRs once CI-green + branch-protection is the
  enforced bar, explicitly *not* extending to destructive ops, releases, or
  anything the founder has flagged for their own review.
- **A stop-hook that surfaces CI status after every push** — a lightweight
  script that checks the current commit's CI runs when an agent session ends
  and surfaces anything non-green, so "I pushed" and "I verified it's green"
  never get silently conflated.

*Why:* without these, every merge either waits on a human (throughput drops
to the founder's waking, attentive hours) or happens by a human trusting an
agent's unverified say-so (correctness drops). The guardrails let both hold
at once.

### 6. AI-native ceremonies replacing human ones

Traditional team ceremonies exist to synchronize humans. A solo-founder,
agent-staffed project doesn't need the synchronization — it needs the
*outcome* the ceremony was for, produced a cheaper way:

- **Overnight review** ≈ a QA cycle. A long unattended pass, timed to the
  founder's off-hours, that lands safe work, runs the expensive test layer
  with flake triage, and fans out parallel review fleets (user-testing,
  multi-lens code/product review, testing-methodology review) that
  catch-and-report to the tracker rather than making unattended changes.
- **Testing-notes triage** ≈ backlog grooming. The founder dumps raw,
  unstructured notes from actually using the product; an agent turns them
  into scoped, deduplicated issues with clear acceptance criteria.
- **Triage-to-milestones** ≈ sprint/release planning. A multi-lens panel of
  agent reviewers scans the *whole* open-issue set for conflicts, overlaps,
  dependencies, and gaps, then proposes a milestone/phase plan — reviewed and
  approved by the founder, never auto-applied.
- **Decision pop-ups** ≈ meetings. Instead of a sync meeting to make a call,
  the agent poses a short, structured question with options at the moment a
  real decision is needed, and work continues once it's answered.

*Why:* the ceremonies were never the point — alignment, quality gates, and
planning were. Reproducing the outcome without the human-synchronization cost
is most of the leverage in this whole model.

### 7. Human-judgment gates only where judgment lives

Not everything should be automated, and pretending otherwise produces bad
outcomes. The gates that stay manual are the ones where the judgment is the
job:

- **UI sign-off via mockups** — a visual/UX change is shown as a mockup and
  approved *before* it's built, not shipped and reviewed after the fact.
- **Live DDL stays founder-applied** — a schema change against a real,
  populated database is exactly the kind of hard-to-reverse, real-state
  change that warrants a human hand on the trigger, even when the SQL itself
  was agent-drafted. Version the schema from day one (a baseline plus
  versioned migration files — hand-applied ad-hoc DDL is a bootstrap smell);
  as the project matures, the founder gate shifts from *typing SQL at a live
  database* to *approving the migration file* before automation applies it.
- **"Don't relitigate" strategy records** — once the founder has made a
  considered call on a strategic question (what the product is, what it
  isn't, a rejected direction), that decision is written down and agents are
  told explicitly not to re-open it without new cause. This is a gate in the
  other direction: it protects founder judgment that's already been spent
  from being silently re-spent by an agent re-deriving a worse answer. The
  lightweight per-issue mechanism is an **on-issue fence comment** — a note
  on the specific issue saying "building this re-opens a strategy decision;
  take it back to a planning session first" — rather than a special
  milestone or label taxonomy for fenced work.
- **One explicit exit-gate issue per phase** — a roadmap phase (e.g. "ready
  to daily-drive the alpha") has exactly one issue that represents "is this
  phase actually done," decided by the founder, rather than an implicit
  vibe-based judgment call buried across many issues.

*Why:* full automation of judgment calls either produces decisions nobody
actually made (bad) or burns founder attention on calls that don't need it
(also bad, just less obviously). Naming the specific gates keeps both failure
modes rare.

### 8. Recurring automation, shaped by cost

Scheduled workflows are where an agent-run project quietly accumulates both
its safety net and its bill. The patterns that have earned their keep:

- **Consolidate heavy CI lanes onto nightly schedules** — integration
  suites, platform artifact builds, full E2E — off the per-PR path, each
  with **auto-file-an-issue-on-red** so a failing nightly is a tracked bug by
  morning, not a red run nobody saw. Per-PR CI keeps only the fast, gating
  layer. (On the project this kit was extracted from, the first measured
  day after this consolidation — 2026-08-10 — cut CI spend by more than
  half against the prior baseline, with the nightlies still catching two
  real breaks that same day; longer-run numbers were still pending when
  this was written.)
- **A daily cost tripwire** — a scheduled job that estimates yesterday's CI
  spend and files/updates an issue past a threshold. Alert-only: pair it
  with a billing budget that *alerts*, never one that hard-stops usage —
  a mid-sprint spending halt costs more than the overage it prevents.
- **Keepalive pings** for infrastructure that pauses when idle (free-tier
  databases and the like) — one authenticated read on a weekly cron, failing
  loudly so a broken keepalive is a red run rather than silence.
- **Destructive scheduled jobs default to dry-run** — anything that prunes
  test accounts, old artifacts, or stale data reports what it *would* delete
  by default and requires an explicit confirm string to actually do it.
- **Prefer the platform's built-in automations over scripted equivalents** —
  e.g. GitHub Projects' own auto-add and closed→Done workflows instead of
  GraphQL scripts moving cards: no token, no CI minutes, no API quota. Treat
  API rate quota as a shared, exhaustible resource across every agent
  working the project; keep scripts only for transitions the built-ins can't
  express.
- **A release freshness gate** — each release cut runs machine-checkable
  probes (a version marker on every deployed surface) plus a short printed
  checklist for the surfaces a probe can't reach, so "we cut a release" and
  "users are actually running it" never silently diverge.

*Why:* recurring automation is the part of the system nobody is looking at
by definition — the failure modes are silent (a schedule that stopped
firing, a cron deleting the wrong thing, a bill compounding daily). Shaping
every scheduled job to fail loudly, delete nothing by default, and cost as
little as its signal allows is what makes "unattended" safe.

### 9. Parallel-agent hygiene

Running several coding agents concurrently against one repo/host adds
failure modes that single-agent work never surfaces:

- **Ban `git stash` in every parallel-builder prompt.** `refs/stash` lives
  in the shared `.git`, not the worktree — concurrent builders doing stash
  push/pop silently swap each other's WIP. Use a scratch WIP commit plus
  soft reset instead. Same class: never force-move a branch you didn't
  create (a sibling worktree may have it checked out), and throwaway repro
  files go in a worktree, never the shared checkout.
- **Don't run full local test gates in parallel.** All agents on one host
  share one toolchain lock; concurrent full gates starve each other into
  timeouts. In a multi-builder wave: targeted suites locally, full suite in
  CI.
- **Assume stalled workers fire no notification.** A hung or quietly-stopped
  background agent looks identical to a working one from the outside. Run a
  periodic broadcast-message sweep over the wave's agent IDs — it doubles
  as stall *detector* and mass *resume*. A stop-hook that scans a finished
  subagent's final message for the "waiting for a notification…" signature
  catches the most common trap mechanically — but note it surfaces the
  warning to the *user*, who then has the coordinator resume the worker;
  hook output is not injected into the model's context, so detection is
  automatic and the resume is not (see `claude/hooks/`). And once a
  worker-prompt boilerplate demonstrably prevents/recovers the trap,
  **freeze its wording** — don't paraphrase a proven incantation.
- **Bound concurrency of heavyweight agent workflows.** Two large parallel
  fleets can trip provider-side throttling that collapses whole waves;
  bound the fan-out, and keep a resume path for a half-dead run.
- **After any host crash or reboot, probe server-side truth** (open PRs,
  branches, releases) before trusting any remembered agent status —
  background agents die silently and their claimed state dies with them.

*Why:* each of these was learned as a multi-hour loss that produced no error
message — cross-contaminated WIP, waves that starved themselves, workers
that stalled for a night unnoticed. Parallelism pays for itself only when
the coordination failures are engineered out rather than debugged per
incident.

### 10. Deliberate omissions

Things this model explicitly does **not** adopt, on purpose:

- No `CONTRIBUTING.md` — there are no external contributors to onboard.
- No `CODEOWNERS` — there's one owner; the file would be a no-op.
- No issue templates — agents write structured issues directly; a template
  optimizes for humans filling out a form.
- No standups — see practice 6; there is no team to synchronize.
- No estimates, no story points — a solo founder plus agents doesn't need
  capacity planning against a estimate-based velocity metric.
- No label taxonomy up front — add a label only when a real, recurring query
  needs it (e.g. "show me everything blocking the alpha gate"), not
  speculatively. An empty taxonomy invented on day one is dead weight;
  a one-label-at-a-time taxonomy earned by actual need stays useful.

*Why:* every one of these is ceremony that exists to coordinate multiple
humans or set expectations for outside contributors. Adopting them anyway
"because that's what a real project has" is pure overhead here — see the
anti-patterns below for what that overhead costs in practice.

---

## Periodic reviews — the process reviews itself

The practices above are themselves a system, and systems drift: vendors
re-gate features, CI bills creep, docs diverge from the tracker, automation
briefs go stale against reality. Two recurring review passes keep the
process honest. The cadences given are **defaults a project may tune, not
mandates** — the low-ceremony rule applies to meta-process too.

### External-tool feature audit (default: quarterly)

Every few months, audit each vendor in the stack (code host, database/BaaS,
CDN/hosting, error tracking, auth, …) against its **current official
documentation**:

- One doc-cited research agent per vendor. **Never answer availability or
  pricing questions from memory** — model knowledge of vendor tiers is stale
  by construction. Fetch the current docs, and verify plan-gating against
  the *actual account type in use* (personal vs. org, free vs. paid), not
  the marketing page's happy path.
- Each agent reports three lists, with a doc URL per claim: **adopt** (free,
  fits, do it), **maybe** (useful but plan-gated or needs a decision), and
  **refuted — do not re-research** (investigated, unavailable or not worth
  it, with the citation that proves it).
- Decisions go to the founder as structured pop-up questions; adopted items
  are filed to the board; quick wins get implemented the same session.
- Archive the whole thing as a **dated do-not-re-research file** in the
  project.

The refuted list with citations is the high-value half: it's what stops
every future session from re-hunting the same dead ends ("can we buy the
managed merge queue?" — no, see the archive). One pass of this on the source
project found a zero-config dependency-update gap, free board automations
nobody had enabled, and the root cause of a live stale-deploy bug.

### Process / best-practices review (default: fortnightly, or scoped pre-milestone)

A recurring pass over the delivery system itself: board hygiene (is the
inbox milestone triaged, do columns match reality), CI cost against value,
doc-vs-tracker drift, dependency freshness, and **automation-brief
freshness** — the automation re-reads its own skill/manual files against
observed reality, fixes *descriptive* drift in place, and surfaces
*normative* changes as founder decisions, never self-applied. Each pass also
emits **kit promotion candidates** report-only: lessons generalized enough
to move upstream into this kit or the founder's global instructions (see
`claude/skills/overnight-review`, workstream C2).

Two disciplines make these reviews compound instead of just accumulate:

- **Prevention-layer classification.** Tag every confirmed review finding
  with the earliest layer that could realistically have caught it — a
  pre-merge review, a CI/lint gate, a test at a named level, spec/decision
  hygiene, or **audit-only** (no cheaper layer exists) — and report the
  distribution. A recurring escape class is a candidate for a new standing
  gate; "audit-only" is a legitimate answer; and a proposed layer that would
  cost more than the class it prevents is a finding *against* the proposal.
- **New process ideas run as trials with a ledger, not adopted as rules.**
  A candidate practice (say, a pre-merge adversarial-reviewer gate on every
  PR — promising on the source project, still a trial there, not standard
  practice) gets a bounded trial with a per-instance ledger: findings,
  false positives, latency, cost. Then an explicit founder decision:
  adopt / tune / drop. The same discipline applies to infrastructure
  buy-vs-rent calls — and **re-run those decisions on post-optimization
  numbers**: thresholds written down before a cost optimization are stale
  the moment it lands.

*Why:* without a scheduled look outward (what did the vendors change?) and
inward (what did our own process quietly become?), the process calcifies
around the constraints of its first month. The audits are cheap — a few
agent-hours on a schedule — and each one either finds real money/capability
on the table or produces citations that permanently stop re-research.

---

## Anti-patterns learned the hard way

Do **not** carry these forward — each was tried (directly or by analogy) and
cost more than it returned:

- **Label taxonomies nobody queries.** A speculative set of labels
  (`priority:P1`, `type:bug`, `area:frontend`, …) invented up front turns
  into upkeep with no payoff, because nothing ever actually filters by them.
  Add a label reactively, the moment a real query needs it — not before.

- **Status snapshots baked into docs.** A "Current sprint" section in
  `CLAUDE.md`, a "what's done so far" paragraph in a handover doc — anything
  that states status in prose — goes stale the moment the next PR merges,
  and then actively misleads whoever reads it next (including a future
  agent). Status lives in exactly one place: the tracker. Docs describe the
  system, not its current state.

- **Copying failure-specific rules from an old project instead of re-earning
  them.** It's tempting to bulk-import another project's whole standing-rules
  file into a new one "to save time." Resist it — a rule that exists because
  of a specific failure on the old project (a particular flaky test, a
  particular footgun in a particular library) is noise on a project that
  never had that failure, and it crowds out the signal of rules that
  actually apply. Let the correction-capture loop (practice 3) re-earn the
  new project's own rule set from its own real corrections. Bring forward
  only the genuinely general practices (this document is exactly that kind
  of transfer) — not the specific incident log.

- **Heavy milestone/phase structure on day one.** A multi-phase roadmap with
  named phases and exit gates is valuable once a project has enough issue
  volume that "what's next" stops being obvious (empirically, that showed up
  around several hundred open issues). Starting there on day one is
  premature process — start with three buckets, **Now / Next / Later**, and
  only introduce formal phases when the issue count actually forces it.

- **Building an E2E layer before there's a cloud boundary to test, and before
  it's bitten you once.** E2E is the most expensive, most brittle layer in
  the pyramid. It earns its keep only for flows that cross a real external
  boundary (auth, sync, a hosted database, payments) — building it out
  preemptively for pure-local logic just buys flakiness with no payoff. Once
  you do have cloud-boundary flows: reserve E2E for exactly those, gate it
  behind a CI path-filter so it doesn't run on every unrelated PR, use
  per-run isolated test accounts (a shared test account turns E2E into a
  serialization bottleneck and a source of cross-run contamination), and run
  the full suite on a weekly schedule in addition to path-filtered PR runs so
  drift still gets caught even between triggering changes.

- **Deploying a static-hosted SPA with no cache-control story.** A web app
  served from a static host/CDN with no explicit cache headers can leave
  users running a build that's many releases stale — silently, while every
  fresh check "works on my machine." Set explicit cache headers (long-lived
  hashed assets, revalidated entrypoint) and version the bootstrap
  entrypoint from day one; don't rely on a framework's service-worker
  self-update magic. Corollary for support: a user reporting long-fixed
  behavior means *suspect a stale client first*.

- **Mixing personal backup data into a shareable kit repo.** A repo meant to
  be shared or published (a starter kit, a template, this document) needs to
  stay generalized — no project-specific facts, no personal state. It's easy
  to violate this by accident: e.g. a "back up my agent config" script that
  commits into the *kit's own* working tree quietly turns a shareable repo
  into a leak of whatever it just backed up (in this project's case,
  cross-project memory files spanning several unrelated clients). Keep the
  two concerns in physically separate repos from the start — see "State
  backup" below — rather than relying on remembering to scrub one out of the
  other before every publish.

---

## Day-one bootstrap

`scripts/bootstrap.ps1` automates the repeatable slice of setting up a new
project under this model. It is **PowerShell 5.1-compatible** (no `&&`, no
ternary, no null-coalescing) so it runs on a stock Windows machine with no
extra setup beyond the GitHub CLI (`gh`) being installed and authenticated.

```powershell
# Preview every step without touching anything (local or remote):
.\scripts\bootstrap.ps1 -ProjectName "my-new-project" -DryRun

# Actually run it:
.\scripts\bootstrap.ps1 -ProjectName "my-new-project" -Description "One-line pitch" -Owner "your-gh-username"
```

**What it automates (via `gh` and `git`):**

- Creates the local project directory and initializes a git repo.
- Copies `templates/CLAUDE.md`, `templates/pull_request_template.md`, and
  `templates/ci/generic-ci.yml` into the new project, substituting the
  project name into the placeholders it can safely fill in.
- Copies `claude/` into the new project's `.claude/` **on disk only** — it is
  never committed (added to `.gitignore`), matching the convention that this
  automation layer is a personal/local tool, not project source.
- Makes the first commit and creates the GitHub repo from the local directory
  in one step (`gh repo create --source . --push`), so the initial push
  happens automatically.
- Creates a GitHub Projects (v2) board titled after the project, sets its
  Status field's options to **Backlog / Next / In Progress / Done** (the
  GitHub API has no mutation to edit an existing single-select field's
  options in place, so the script deletes the default Status field and
  recreates it with the right options — same field name, right values), and
  links the board to the new repo.
- Enables squash auto-merge on the repo.
- Sets branch protection on the default branch: required status checks
  (placeholder — fill in the real CI job name after the first run exists),
  `enforce_admins` on, force pushes and branch deletion off.

**What it prints as a manual step instead of failing** (each such step gets a
clear, direct instruction, not a silent skip):

- Any step whose `gh`/API call errors (e.g. the Status-field rebuild, if the
  account lacks the `project` scope) — printed with the exact manual fix and,
  where resolvable, a direct console URL.
- Filling in the real required-status-check context name in branch
  protection once the first CI run has actually produced one (the placeholder
  can't be resolved before any run exists).
- Anything genuinely outside `gh`'s surface — e.g. inviting collaborators,
  enabling any paid features, or org-level policy that requires the GitHub
  web UI.

Everything else in the model is deliberately **not** automated by the script,
because it isn't a day-one setup step — it's an ongoing practice: writing the
first real issues, running the first testing-notes triage, growing
`CLAUDE.md`'s gotchas section via real corrections, and so on. Those start
the moment the first PR does.

### Post-bootstrap checklist (web UI)

A few valuable settings have no `gh`/API surface at all, so the script can't
do them and they aren't per-run failures either — they're the same short
list after every bootstrap (the script prints this checklist at the end of
each run too):

1. **Enable the project board's built-in automations.** Open the new
   project → `…` menu → *Workflows*: turn on **Auto-add to project** (new
   issues/PRs from the linked repo) **and** the separate **Item added to
   project** workflow with its Status set to **Backlog** — auto-add alone
   only adds items, leaving them with *no* status, so without the second
   workflow you get a "No status" pile instead of a Backlog column. Also
   turn on **item closed / PR merged → Done**. (Plan note: Free allows
   exactly one auto-add workflow per board, Pro five — fine for the kit's
   single board.) These run with no PAT, no Actions minutes, and zero
   GraphQL quota — prefer them over scripted board moves for every
   transition they can express (practice 8), and keep scripts only for what
   they can't (moves between non-terminal columns).
2. **Enable Dependabot.** Repo *Settings → Security* (the section GitHub
   currently labels "Code security"/"Advanced Security" — it moves): turn on
   **Dependabot alerts** and **security updates**. Then copy
   `templates/ci/dependabot.yml.example` from this kit to the project's
   `.github/dependabot.yml` and set its ecosystems to match the stack — the
   script doesn't copy it automatically precisely because the ecosystem list
   can't be guessed.
3. **After the first CI run:** fill the real required-check name into branch
   protection (also printed as a per-run manual follow-up by the script).

### Platform constraints worth knowing up front

Durable plan-gating facts, recorded once so no future project re-researches
them. **Verified 2026-08-11 against current vendor docs — re-verify at the
next tool audit** (see "Periodic reviews"); vendors re-gate features without
notice.

- **GitHub native merge queue: unavailable to a personal private repo at any
  price** — it requires an org-owned repo, and for private repos
  additionally Enterprise Cloud. Consequence: with strict ("require
  branches to be up to date") branch protection, a green auto-merge-armed PR
  silently starves as `behind` whenever other PRs land first — GitHub never
  notifies. With many parallel PRs you must build your own updater (a small
  "merge train" workflow). Hard-won caveats for that workflow: GitHub's
  `schedule` cron is best-effort (trigger on `workflow_run` instead), filter
  to *required* checks or one red non-gating check starves the queue, poll
  check-run conclusions rather than PR state (`blocked` conflates queued and
  failed), and pushes made with the default `GITHUB_TOKEN` don't trigger CI
  (use a scoped PAT for the update-branch push).
- **Secret scanning / push protection: not available on user-owned private
  repos** (Enterprise-gated). If you want the guard, run a scanner like
  `gitleaks` in CI instead.
- **Larger runners and issue types are org-only.** Plan around the standard
  runners on a personal account.
- **Available on personal Free/Pro and worth using:** sub-issues, issue
  dependencies ("blocked by"), Projects built-in automations, Dependabot,
  and `gh release create --generate-notes`.
- **Supabase Free tier has NO automatic server-side backups.** None — bring
  your own backup path from day one. Database branching is Pro-gated and
  PITR needs Pro plus paid compute; but CLI migrations, `pg_cron`, Vault,
  TOTP MFA, and pgTAP are all free. On any Supabase project, adopt **CLI
  migrations from day one** (`db pull` baseline + versioned migration files,
  applied by automation after founder approval) — see practice 7's live-DDL
  gate for how the founder approval fits in.
- **Google Play / Google OAuth gates:** a personal Play developer account
  must pass a closed test with 12 opted-in testers over 14 continuous days
  before production (internal testing doesn't count toward it). A GCP OAuth
  app using only basic sign-in scopes is exempt from the 100-test-user cap
  and the 7-day refresh-token expiry — adding any scope beyond those basic
  sign-in scopes (sensitive or not) silently drops that exemption.

### What stays manual, always

Independent of tooling, per the operating model above: using the product,
writing raw testing notes, answering decision pop-ups, approving UI mockups
before they ship, and approving schema changes to a live, populated database
(early on, applying them by hand too — practice 7 covers how that gate
matures from typing the SQL to approving the migration file). No amount of
automation should try to remove these five — they're where the founder's
judgment is actually the product, and judgment, not keystrokes, is the part
that stays manual.

---

## State backup (two-repo model)

This kit is shaped to be shared: generalized, placeholder-driven, no
project-specific or personal content. The correction-capture memory loop
(practice 3) is the opposite of that by nature — it's your actual global
`CLAUDE.md` and the real per-project memory files it indexes, which can span
several unrelated projects (client work, personal projects, whatever else
you're running through the same agent setup). That content has real value as
a backup and zero business being in a repo meant for others to read.

So the backup lives in a **second, separate, private local repo** —
`claude-state`, a sibling of this kit's own repo — never inside the kit
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

Each run copies the global `CLAUDE.md` and every `~/.claude/projects/*/memory/`
directory into `claude-state/`, then makes one dated commit there (skipped if
nothing changed since the last run). `-BackupRepoPath` overrides the default
sibling location if you keep your backups somewhere else; `-DryRun` previews
without touching anything.

Treat `claude-state` as private — don't publish it the way you'd publish a
kit repo built from this one. It's a personal/operational backup, not a
deliverable.

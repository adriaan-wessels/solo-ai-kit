# Solo Founder + AI Agents — Bootstrap Kit

A portable playbook and starter kit for running a software project as **one
founder acting as editor, with AI coding agents as staff**: the agents
maintain the tracker, write the code, verify it, and merge on green CI. The
founder's recurring job shrinks to five things — use the product, dump raw
testing notes, answer decision pop-ups, approve UI mockups, and apply live-DB
schema changes.

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
5. **Apply live-DB DDL** — schema changes against a hosted database are the
   one category of "irreversible against real data" that stays manual.

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
  was agent-drafted.
- **"Don't relitigate" strategy records** — once the founder has made a
  considered call on a strategic question (what the product is, what it
  isn't, a rejected direction), that decision is written down and agents are
  told explicitly not to re-open it without new cause. This is a gate in the
  other direction: it protects founder judgment that's already been spent
  from being silently re-spent by an agent re-deriving a worse answer.
- **One explicit exit-gate issue per phase** — a roadmap phase (e.g. "ready
  to daily-drive the alpha") has exactly one issue that represents "is this
  phase actually done," decided by the founder, rather than an implicit
  vibe-based judgment call buried across many issues.

*Why:* full automation of judgment calls either produces decisions nobody
actually made (bad) or burns founder attention on calls that don't need it
(also bad, just less obviously). Naming the specific gates keeps both failure
modes rare.

### 8. Deliberate omissions

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

### What stays manual, always

Independent of tooling, per the operating model above: using the product,
writing raw testing notes, answering decision pop-ups, approving UI mockups
before they ship, and applying schema changes to a live, populated database.
No amount of automation should try to remove these five — they're where the
founder's judgment is actually the product.

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

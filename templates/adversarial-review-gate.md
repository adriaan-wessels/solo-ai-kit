# Pre-merge adversarial review gate: trial protocol template

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

- **R1 (interaction reviewer, always runs):** "Enumerate every existing
  feature or surface this change interacts with: <PLACEHOLDER: the
  project's interacting surfaces, e.g. filters, saved views, undo, sync,
  widgets, routing>. For each, reason about the COMBINED behavior (the
  product of features, not the diff in isolation) and try to construct
  a concrete broken interleaving. Report only reachable, evidenced
  findings."
- **R2 (boundary reviewer, runs only when the diff touches an external
  contract):** "List every contract this diff depends on outside the
  compile boundary: <PLACEHOLDER: the project's boundaries, e.g. live DB
  columns and policies (name the VERB), storage paths, platform
  channels, preference keys, CI/workflow assumptions, user-facing doc
  claims>. For each: prove it holds (cite where), or flag it as
  unverified."

**Disposition.**

- Confirmed P0/P1 → blocking. The builder fixes before merge.
- **Arming a merge ends the review. Disarm before any fix round
  starts.** An armed PR merges the builder's next green push instantly,
  reviewed or not. "Armed" and "reviewed" are two separate facts.
- **A fix round that answers a P0 or P1 finding gets one delta
  re-review before arming.** Scope the delta to the fixes themselves
  and to new defects the fixes introduce. Fix rounds are diffs too.
- **One disposition per heading line.** Put the disposition, and nothing
  else, on the gate comment's heading line. Keep fix-round history in the
  body. A heading that announces a fix round and an arm together is
  ambiguous, to a reader and to any tool that reads the record.
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

## Calibration ledger: keep every overrule

Reviewers re-guess the founder's bar every round, and each overrule is
training data that usually gets thrown away. Keep a small tracked file.
Record every founder or coordinator overrule of a reviewer verdict:
date, finding, verdict, ruling, lesson. Paste the recent disagreements
into future reviewer prompts as worked examples, so the next reviewer
inherits the bar instead of guessing at it. The first live entries on
the source project each carry a lesson; one records a reviewer proven
wrong by interval arithmetic.

## Lessons from running the gate

These came from running the gate for real, after the trial that got it
adopted. Fold them in wherever you adapt this template.

- **Arming ends the gate. Disarm before any fix round.**
  `gh pr merge --auto` is a standing instruction, not approval of the
  diff a reviewer just cleared. It persists across every later push. On
  2026-08-21, a PR was armed after its review round passed, CI then went
  red, the builder pushed a fix, checks went green, and auto-merge fired
  instantly on a commit nobody had reviewed. Two P2 findings shipped.
  Treat "armed" and "reviewed" as two separate facts. Disarm before a fix
  round starts, and only re-arm after the fix gets its own review (see
  below). The kit ships a hook for this one lesson: see "The mechanism for
  the arming lesson" at the end of this file.
- **Reviewers must re-run the claim, not read the PR body.** A reviewer
  who reads a test's description and takes its word for it will pass a
  vacuous test. A reviewer who reintroduces the defect and watches
  whether the test still passes will not. This single practice produced
  every catch of a false test so far.
- **A mutation score the author ran is not evidence. Write your own
  injection list.** The agent that wrote the code writes its tests from
  one picture of the problem, and its injections from that same picture.
  On the source project, a classifier caught every injection it wrote
  for itself, and one in eight of the injections a reviewer wrote
  against the same code. Where the mechanism parses text a real system
  emits, take the fixtures from real logs, not from what the author
  assumed the system emits. Make every injection name the assertion that
  must report it, so a crash in the mutated copy does not count as a
  catch.
- **Name vacuous verification as an explicit hunt target.** Look
  specifically for tests that pass against the exact bug they claim to
  guard. Four turned up in one week. CI cannot reach this class on its
  own, because CI only runs the tests, and the tests pass.
- **Do not spend an expensive reviewer on a head whose CI is not yet
  green.** Sequence the gate behind CI. A reviewer costs several times
  what the CI run does; spending one on a commit CI would have rejected
  anyway wastes the expensive check on a question the cheap one already
  answers.
- **A fix round needs its own review, not a rubber stamp.** Two P1
  defects in one week were introduced by the repair, not by the original
  bug. Treat a post-finding fix as a new diff to review, not a patch to a
  diff someone already cleared. The delta round earns its keep: on
  2026-08-25 one delta re-review caught a P1 that the fix round itself
  had introduced, and a second delta round on the same PR caught a
  data-move hazard.

## The mechanism for the arming lesson: `pr-merge-gate.js`

The first lesson above is the only one here with a shipped mechanism.
`claude/hooks/pr-merge-gate.js` is a `PreToolUse` hook. Before an explicit
`gh pr merge` runs, it reads the PR's most recent `## ...gate...` comment,
and it denies the merge when that comment is not a clean, current arm.
Wire it from `claude/settings.json`. The hook's own header carries the
detection rules and the override. It is the kit's first shipped instance
of the two-strikes rule (kit README, principle 1): the arming lesson was
written down as prose, it recurred, and then it became a hook.

**Read this limit before you adopt it. The hook protects explicit merge
commands, and it does that demonstrably well. It does not protect against
a standing auto-merge that fires later.** `gh pr merge --auto` is a
standing instruction. When a later push turns the checks green, GitHub
merges on its own servers. No tool call happens at that moment, so a
`PreToolUse` hook never runs and cannot object. Across a five-day window
on the source project, about 23 PRs merged and only about 11 merge
commands reached the hook. The rest merged server-side. That is the half
this hook cannot see.

For the half it does see, the record after those five days is 19 logged
invocations: 2 blocks, 6 clean passes, 6 fail-opens, 1 disarm passthrough,
0 overrides. Both blocks were correct. Each one refused a merge whose
newest gate comment announced a fix round instead of an approval, and each
PR merged less than a minute later, once a clean arming comment was
posted. No legitimate merge was stopped, and no override was recorded.
That is the evidence bar the kit sets for a hook (kit README,
"Anti-patterns learned the hard way").

One of the two blocks cost a round trip, on a heading that announced a fix
round and an arm together. The heading was genuinely ambiguous, so denying
it is correct by design. The "one disposition per heading line" rule under
**Disposition** above removes that friction, and it is the only friction
the log shows.

The mechanism that would close the server-side gap is a SHA-scoped
`review-gate` commit status, added to the branch protection rules. It puts
the check where the merge happens. That is the known next step. It is not
proven yet, so the kit does not ship it.

# `claude/`: copy this into a new project's `.claude/`

Everything in this directory belongs on disk as the new project's
`.claude/` directory. It is **not** committed to the project's git repo.
In the source project, this whole tree is git-ignored on purpose. It's
personal automation tooling for working the project, not project source,
so it can change freely between sessions without needing a PR.

**That last rule holds for one person, and reverses above one.** With a
team, commit the shared parts (`hooks/`, `skills/`, `workflows/`) and
git-ignore only each developer's local settings. The reason to keep it
out of the repo was that nobody else reads it. Once somebody else does,
keeping it private means each developer rebuilds the same tooling alone,
or nobody builds it at all, and the guards that make agent work safe
protect one machine instead of the codebase. See the kit README's "What
transfers, and what does not".

`scripts/bootstrap.ps1` copies it automatically for a new project (see
the kit README's "Day-one bootstrap" section) and adds `.claude/` to the
new project's `.gitignore` at the same time. If you set a project up by
hand instead, do this manual step:

```powershell
Copy-Item -Recurse -Path claude\* -Destination <new-project>\.claude\
# then make sure <new-project>\.gitignore has a line: .claude/
```

## Two install modes: project-level vs machine-global

`claude/hooks/` supports two install modes. Pick one mode per hook. Never
wire the same hook in both places.

**Project-level (the default).** `scripts/bootstrap.ps1` copies `claude/`
into each new project's git-ignored `.claude/`. The hooks and their wiring
live there. Their scope is that one project only.

**Machine-global.** Four hooks are project-agnostic: `guardrail.js`,
`prompt-context.js`, `agent-ledger.js`, and `session-start.js`. They read no
project-specific state, so you can install them once instead of per project.
Run `scripts/install-global-hooks.ps1` to copy them into `~/.claude/hooks/`
and wire them in `~/.claude/settings.json`. A machine-global install covers
every session on the machine, including repos that never ran
`bootstrap.ps1`.

The other four hooks (`subagent-stall-check.sh`, `branch-sweep.sh`,
`session-branch-count.sh`, `pr-merge-gate.js`) work per repo: they read the
current repo's branches or PRs, or keep state in its `.claude/state/`. They
stay project-level in this kit's source setup. Nothing stops you from
installing them machine-global too, but the kit does not ship that path.

**The rule: each hook gets exactly one home.** Claude Code merges hooks
from user-level and project-level settings. It runs both sets. Wire a hook
in both places and it fires twice per event. A doubled `guardrail.js`
evaluates the same Bash call twice. A doubled `agent-ledger.js` writes two
ledger entries per start or stop. A doubled `prompt-context.js` injects two
context blocks into the same prompt. Pick one home per hook and stay there.

**State paths follow the hook's own location.** Each of the four
machine-global-capable JS hooks resolves its state directory relative to
itself: `path.join(__dirname, '..', 'state')`. No code change is needed to
switch modes. A project-level install writes to `.claude/state/`. A
machine-global install writes to `~/.claude/state/`. `pr-merge-gate.js` is
the exception, and it is project-level only. It resolves the repo root
through `CLAUDE_PROJECT_DIR`, so a subagent working in a worktree does not
write its audit row into a directory that dies with the worktree.

`scripts/bootstrap.ps1` dedupes automatically. When it copies `claude/`
into a new project, it checks `~/.claude/settings.json` first. It drops any
hook wiring already present machine-globally from the new project's copy.
A machine with the global install does not end up with project-level
duplicates.

## What's in here

- **`settings.json`**: registers every hook below. Merge this into the new
  project's `.claude/settings.json` rather than overwriting one that already
  exists. The JS hooks need `node` on PATH; the `.sh` ones need `bash`. On
  Windows, check *which* `bash` you have. The one on PATH is often the WSL
  stub (`AppData\Local\Microsoft\WindowsApps\bash.exe`, which reports
  `Linux`), not Git Bash, and hooks then run in the wrong OS. That's why the
  newer hooks here are Node.
- **`hooks/subagent-stall-check.sh`**: a SubagentStop hook that scans a
  just-finished subagent's final message for the "waiting for a
  notification…" stall signature. This is the worker-side trap in the
  coordinator/worker split (`templates/CLAUDE.md`, standing rule 3): nothing
  ever re-invokes a worker that stops to wait, so a worker that ends its
  turn "waiting" is stalled, not working. **Upgraded 2026-08-14 to exit 2**,
  which blocks the stop and feeds stderr back to *that agent*. The worker
  resumes itself, with no human relay and no coordinator round-trip.
  Previously it could only emit a `systemMessage`, so detection was
  automatic but the resume was not. Silent otherwise. See "Preventing
  premature subagent termination" below (kit README, practice 9).
- **`hooks/hook-log.sh`**: the shared guard-telemetry writer for the shell
  hooks, sourced by them rather than run on its own. The JS hooks each carry
  their own inline equivalent, so this is the same grammar for the `.sh`
  side. It writes `.claude/state/<guard>.log`, sanitises every field, rotates
  itself, and is contractually forbidden from changing the calling hook's
  exit code. Source it with a no-op fallback (`type hook_log >/dev/null 2>&1
  || hook_log() { :; }`) so a missing helper can never stop a guard from
  guarding. See "Guard telemetry" below for the grammar.
- **`hooks/subagent-stall-check.test.sh`**: the replay harness for the stall
  check, run by CI. Asserts that every outcome path writes exactly one log
  line, that the grammar survives pipes and newlines in an agent's message,
  and that a block records which phrase matched. Carries a known-good control
  case: if the control stops passing, distrust every other result in the run.
- **`hooks/guardrail.js`**: a `PreToolUse` hook that DENIES dangerous Bash
  calls and hands the reason back to the agent as text. Highest-value hook
  in the kit: it converts "please don't do X" prompt boilerplate, which
  agents ignore under load, into something mechanically impossible. Ships
  with the portable core: `.bat` invocations that silently no-op under Git
  Bash (a test gate reporting green without running is the worst failure
  mode there is), `git stash` while agents run in parallel, blanket process
  kills, release-asset `--clobber`, pushes to master/main. **Tune the rule
  list per project**; a rule earns its place once it has actually cost you
  something. `CLAUDE_GUARDRAIL_OFF=1` disables enforcement, but not the
  record: the override still writes its own log line, because an override
  you cannot see is the same as no guard. Every invocation writes one line
  to `state/guardrail.log` under the guard-telemetry grammar below:
  `blocked`, `clean`, `open:<reason>` or `override`. Run
  `node hooks/guardrail.test.js` before you deploy any rule change; it
  replays the rules and asserts that each outcome path still logs.
- **`hooks/agent-ledger.js` + `hooks/prompt-context.js`**: the other half of
  stall detection, for the case where a subagent hangs and emits *no*
  completion event, so its absence looks identical to "still working" and
  `subagent-stall-check.sh` never fires at all. The ledger records starts
  and stops to an append-only log; `prompt-context.js` (a `UserPromptSubmit`
  hook) replays it and injects anything still outstanding, flagged as a
  possible stall past 15 minutes. It also injects elapsed time since your
  previous message. The session context carries a start date only, so a
  four-hour gap otherwise reads exactly like a four-second one.
- **`hooks/session-start.js`**: injects open PRs for the current repo at
  session start (dependabot collapsed to a count), so orientation is
  something the agent has rather than something it must remember to fetch.
  Each PR carries a one-line annotation, and only when it says something
  the title does not: conflicting, checks red, or finished-but-unmerged.
  The green case is stamped with the time it was read, because a claim
  about check state is worth exactly as much as its observation time.
  Cached 5 minutes — long enough to collapse a burst of session starts,
  short enough to bound how stale a check-state claim can be right after a
  push. Read the header before adding sections: anything on this path has
  to be cheap.
- **`hooks/session-start.selftest.js`**: 16 assertions over that
  annotation. The behaviour is a judgement rather than a fetch, so it is
  testable without the network. `--prove` reintroduces four real defects
  and requires the suite to go red for each one. CI runs both, because a
  suite that cannot fail is not evidence.
- **`hooks/branch-sweep.sh`**: mechanical cleanup of provably-dead local
  branches and worktrees. The root cause: squash-merge auto-deletes only
  the remote branch, so every merged PR strands a local one (74 had
  accumulated on the source project by 2026-08-15). Three modes: `report`
  classifies only (TSV to stdout); `apply` deletes the safe class; `auto`
  is the SubagentStop wiring, rate-limited to hourly, lock-guarded, silent
  when idle. "Safe" means the branch head is contained in the default
  branch, or its upstream is gone and a merged PR matches the head name
  with no open PR reusing it. Everything else is FLAGGED and never deleted
  by the hook. Those are judgment cases for a human-approved hygiene pass
  (run `report` first, then decide). Every deletion is appended to
  `.claude/state/branch-sweep.log` with its SHA; restore with
  `git branch <name> <sha>`. The hook is the backstop. The primary
  mechanism is the standing rule in `templates/CLAUDE.md`: delete the
  local branch in the same step the merge is confirmed.
- **`hooks/session-branch-count.sh`**: a SessionStart tripwire that injects
  the local branch and worktree counts as context, and suggests a sweep
  when either passes a threshold (15 branches / 2 extra worktrees). Pure
  local git, no fetch, no `gh`, so it costs nothing on the session-start
  path.
- **`hooks/pr-merge-gate.js`**: a `PreToolUse` hook that DENIES an explicit
  `gh pr merge` when the PR's most recent `## ...gate...` comment is not a
  clean, current arm. It is the mechanism for the review gate's first lesson
  (`templates/adversarial-review-gate.md`: arming ends the review, so disarm
  before a fix round), and the kit's first shipped instance of the
  two-strikes rule. **Know its limit before you adopt it: it protects
  explicit merge commands, and it does that demonstrably well; it does not
  protect against a standing auto-merge that fires later.** GitHub merges
  that one server-side, where no tool call happens and no `PreToolUse` hook
  can run. On the source project, about 23 PRs merged in a five-day window
  and only about 11 merge commands reached the hook. Over the same window it
  logged 19 invocations: 2 blocks (both correct), 6 clean passes, 6
  fail-opens, 1 disarm passthrough, 0 overrides. Project-level only. The
  header explains the detection rules, the override, and the SHA-scoped
  commit status that would close the server-side gap.
- **`skills/overnight-review/SKILL.md`**: the "AI-native QA cycle" ceremony
  from the kit README (practice 6). A long, mostly-unattended pass that
  lands safe work, gates on the expensive test layer with flake triage, then
  fans out parallel fleets (user-testing, multi-lens code/product review,
  testing-methodology review) that catch-and-report findings to the
  tracker. Every project-specific detail (the board/issue references, the
  actual review lenses, the tech stack) is marked `<PLACEHOLDER: ...>`. Fill
  those in for the new project before relying on it; the surrounding
  structure is the part that transfers as-is.
- **`workflows/issue-triage-to-milestones.js`**: the "AI-native planning"
  ceremony (practice 6). A three-phase agent workflow (gather every open
  issue → fan out a panel of lens reviewers over the whole set → synthesize
  a milestone plan) that proposes a roadmap without mutating anything. Same
  deal: project-specific bits are `<PLACEHOLDER: ...>`-marked. Fill in the
  lens list and the gather-phase `gh` invocations (owner/project number) for
  the new project.

## The delivery gotcha that makes or breaks all of these

A hook's JSON `systemMessage` field is shown to **the user**. It never enters
the model's context. Most write-ups of context-injection hooks get this
wrong, then "verify" the fix by watching the message echo in their own
terminal, where it looks like it worked.

To actually reach the model:

- `UserPromptSubmit`, `UserPromptExpansion`, `SessionStart`: write **plain
  stdout**. It is added as context. These are the only events where that is
  true.
- `Stop`, `SubagentStop`: **exit 2**. Stopping is blocked and **stderr** is
  fed back to the model as the reason.
- `PreToolUse`: exit 2, or the JSON equivalent `permissionDecision: "deny"`
  with a `permissionDecisionReason`.

Check which one you need before writing the hook, or you will ship something
that silently does nothing.

## Preventing premature subagent termination

`hooks/subagent-stall-check.sh` is the kit's answer to a general multi-agent
failure mode (MAST-style "stopping too early"): an agent completes a
sub-step, and the sub-result (a verdict, a lookup, a check) *looks* like a
finished answer, so it stops there instead of doing the work that sub-result
was an input to. It gets worse the more you modularise, because every
extracted module manufactures a new plausible stopping point.

Prose does not fix this. Restating the contract, completion checklists, and
sterner dispatch prompts each raise the success rate, and none of them close
it, because they are advisory. A stop hook that exits 2 is a hard gate: the
agent cannot terminate while the gate says no.

Two things worth knowing if you adapt it:

- **Gate on a postcondition wherever you have one.** The shipped version
  scans the agent's final message for stall phrases, which is a proxy: it
  catches agents that *announce* they are stopping early and misses the
  quiet ones. If your agents produce something checkable (a row written, a
  file created, a PR opened), test that instead. It tests the state of the
  world rather than what the agent said about it. If you already verify
  after the fact and re-dispatch, you have written this check already;
  moving it into the stop hook turns rework into prevention.
- **Always bound the retries.** This one blocks each `agent_id` at most once
  (recorded in `.claude/state/stall-blocked.txt`). Without a guard, an agent
  that genuinely cannot finish is blocked forever.

## Guard telemetry: one log line per invocation, on every outcome path

Give every guard (a hook, a lint gate, a cron) one log line per
invocation, on every outcome path. Five fields, separated by a pipe
with no spaces around it, because a parser splitting on a bare pipe is
the cheapest reader there is:

```
timestamp|guard|outcome|target|reason
```

Strip pipes, tabs and newlines out of every field as you write it, or a
hostile command breaks the grammar. Use a small fixed outcome
vocabulary: `blocked`, `clean`, `open:<reason>`, `override`. The line
that matters most is the one for the common path. A guard that fails
open without a trace is indistinguishable from a dead guard.

Both shipped guards write exactly this, and `guardrail.test.js` asserts
the field count against hostile input, so the test is the spec and this
section describes it. Keep them in step: if you change one, change the
other in the same commit.

The log serves both directions of the two-strikes principle (kit
README, principle 1). It is the evidence that a guard earns its place:
the kit's own `pr-merge-gate.js` logged its first real block within
hours of gaining telemetry, and that log is what later proved it had
earned a permanent place here. And it is the evidence for the
decommission test: a guard that never fires across a review window
shows it in its own log. The kit once retired a hook for exactly this
gap (`ci-status.sh`, see the README's anti-patterns): it kept no log
and had no recorded catch, so nobody could tell the difference.

## Corpus replay for guards that classify text

A guard that classifies free text (a merge-gate hook that parses
commands, a claim scanner) can regress silently when you tune its
rules. Ship every such guard with a replay script that runs it against
the full history of real past inputs and reports what changed
classification. Run the replay before you deploy any change to the
guard. A regression then shows up as a diff over known history, not as
a missed catch in production.

This repo now runs those replays in CI, on every push and pull request to
`master`, next to a syntax check over every script in `claude/` and
`scripts/`. Read what CI here does not cover before you trust it.
`guardrail.js` and `subagent-stall-check.sh` are the only hooks with a
test suite. The other six hooks, the workflow script, and the three
PowerShell scripts get a syntax check and nothing more, so a hook that
parses cleanly and behaves wrongly still ships green. `pr-merge-gate.js`
is the sharpest of those: it classifies text, so this section's own rule
says it needs a replay, and it does not have one. `bootstrap.ps1` is the
widest. It creates repositories and sets branch protection, and no test
exercises it. The syntax check is a floor, not a substitute. Write the
replay for your own guards.

One thing worth copying from how the stall-check harness was built. Once
it was green, every defect it was meant to catch was reintroduced one at
a time to check that it actually went red. Four of five did. The fifth
reported "not caught", and that was a lie: the edit that was supposed to
introduce the defect never applied, so the harness had run against
unmodified code. **A mutation that fails to apply is indistinguishable
from a test that misses it, and it reports as the reassuring one.** Assert
that the file actually changed before you believe any mutation result.
That is the same reason the harness carries a known-good control: a green
run has to mean the check ran, not merely that nothing errored.

## Why this split exists

Splitting "project source" (committed, in the repo) from "how I work this
project" (`.claude/`, git-ignored, personal) keeps the automation layer free
to evolve per-session without needing review, while keeping the actual
product code clean of tooling that only makes sense to the person driving
the agents. See practice 2 in the kit README for the parallel reasoning
behind `CLAUDE.md` itself.

# `claude/` — copy this into a new project's `.claude/`

Everything in this directory is meant to be copied onto disk as the new
project's `.claude/` directory — **not** committed to the project's git repo.
In the source project this whole tree is git-ignored on purpose: it's
personal automation tooling for working the project, not project source, and
it can change freely between sessions without needing a PR.

`scripts/bootstrap.ps1` does this copy automatically for a new project (see
the kit README's "Day-one bootstrap" section) and adds `.claude/` to the new
project's `.gitignore` at the same time. If you're setting a project up by
hand instead, the equivalent manual step is:

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

The other four hooks (`ci-status.sh`, `subagent-stall-check.sh`,
`branch-sweep.sh`, `session-branch-count.sh`) read the current repo's CI
runs and branches. They stay project-level in this kit's source setup.
Nothing stops you from installing them machine-global too, but the kit does
not ship that path.

**The rule: each hook gets exactly one home.** Claude Code merges hooks
from user-level and project-level settings. It runs both sets. Wire a hook
in both places and it fires twice per event. A doubled `guardrail.js`
evaluates the same Bash call twice. A doubled `agent-ledger.js` writes two
ledger entries per start or stop. A doubled `prompt-context.js` injects two
context blocks into the same prompt. Pick one home per hook and stay there.

**State paths follow the hook's own location.** Each JS hook resolves its
state directory relative to itself: `path.join(__dirname, '..', 'state')`.
No code change is needed to switch modes. A project-level install writes to
`.claude/state/`. A machine-global install writes to `~/.claude/state/`.

`scripts/bootstrap.ps1` dedupes automatically. When it copies `claude/`
into a new project, it checks `~/.claude/settings.json` first. It drops any
hook wiring already present machine-globally from the new project's copy.
A machine with the global install does not end up with project-level
duplicates.

## What's in here

- **`settings.json`** — registers every hook below. Merge this into the new
  project's `.claude/settings.json` rather than overwriting one that already
  exists. The JS hooks need `node` on PATH; the `.sh` ones need `bash`. On
  Windows, check *which* `bash` you have — the one on PATH is often the WSL
  stub (`AppData\Local\Microsoft\WindowsApps\bash.exe`, which reports
  `Linux`), not Git Bash, and hooks then run in the wrong OS. That's why the
  newer hooks here are Node.
- **`hooks/ci-status.sh`** — a Stop hook that checks the current commit's CI
  runs after a push and surfaces anything non-green. Near-generic as-is; it
  only assumes `git`, `gh`, and a GitHub Actions-style CI. See the comments
  in the file for the exact trigger conditions (only fires within 30 minutes
  of a pushed HEAD, stays silent when everything's green).
- **`hooks/subagent-stall-check.sh`** — a SubagentStop hook that scans a
  just-finished subagent's final message for the "waiting for a
  notification…" stall signature — the worker-side trap in the
  coordinator/worker split (`templates/CLAUDE.md`, standing rule 3): nothing
  ever re-invokes a worker that stops to wait, so a worker that ends its
  turn "waiting" is stalled, not working. **Upgraded 2026-08-14 to exit 2**,
  which blocks the stop and feeds stderr back to *that agent* — the worker
  resumes itself, with no human relay and no coordinator round-trip.
  Previously it could only emit a `systemMessage`, so detection was
  automatic but the resume was not. Silent otherwise. See "Preventing
  premature subagent termination" below (kit README, practice 9).
- **`hooks/guardrail.js`** — a `PreToolUse` hook that DENIES dangerous Bash
  calls and hands the reason back to the agent as text. Highest-value hook
  in the kit: it converts "please don't do X" prompt boilerplate, which
  agents ignore under load, into something mechanically impossible. Ships
  with the portable core — `.bat` invocations that silently no-op under Git
  Bash (a test gate reporting green without running is the worst failure
  mode there is), `git stash` while agents run in parallel, blanket process
  kills, release-asset `--clobber`, pushes to master/main. **Tune the rule
  list per project**; a rule earns its place once it has actually cost you
  something. `CLAUDE_GUARDRAIL_OFF=1` disables all of them.
- **`hooks/agent-ledger.js` + `hooks/prompt-context.js`** — the other half
  of stall detection: the case where a subagent hangs and emits *no*
  completion event, so its absence looks identical to "still working" and
  `subagent-stall-check.sh` never fires at all. The ledger records starts
  and stops to an append-only log; `prompt-context.js` (a `UserPromptSubmit`
  hook) replays it and injects anything still outstanding, flagged as a
  possible stall past 15 minutes. It also injects elapsed time since your
  previous message — the session context carries a start date only, so a
  four-hour gap otherwise reads exactly like a four-second one.
- **`hooks/session-start.js`** — injects open PRs for the current repo at
  session start (dependabot collapsed to a count), so orientation is
  something the agent has rather than something it must remember to fetch.
  Cached 30 minutes. Read the header before adding sections: anything on
  this path has to be cheap.
- **`hooks/branch-sweep.sh`** — mechanical cleanup of provably-dead local
  branches and worktrees. The root cause: squash-merge auto-deletes only
  the remote branch, so every merged PR strands a local one (74 had
  accumulated on the source project by 2026-08-15). Three modes: `report`
  classifies only (TSV to stdout); `apply` deletes the safe class; `auto`
  is the SubagentStop wiring — rate-limited to hourly, lock-guarded,
  silent when idle. "Safe" means the branch head is contained in the
  default branch, or its upstream is gone and a merged PR matches the head
  name with no open PR reusing it. Everything else is FLAGGED and never
  deleted by the hook — those are judgment cases for a human-approved
  hygiene pass (run `report` first, then decide). Every deletion is
  appended to `.claude/state/branch-sweep.log` with its SHA; restore with
  `git branch <name> <sha>`. The hook is the backstop — the primary
  mechanism is the standing rule in `templates/CLAUDE.md`: delete the
  local branch in the same step the merge is confirmed.
- **`hooks/session-branch-count.sh`** — a SessionStart tripwire that
  injects the local branch and worktree counts as context, and suggests a
  sweep when either passes a threshold (15 branches / 2 extra worktrees).
  Pure local git — no fetch, no `gh` — so it costs nothing on the
  session-start path.

## The delivery gotcha that makes or breaks all of these

A hook's JSON `systemMessage` field is shown to **the user**. It never enters
the model's context. Most write-ups of context-injection hooks get this
wrong and then "verify" the fix by watching the message echo in their own
terminal, where it looks like it worked.

To actually reach the model:

- `UserPromptSubmit`, `UserPromptExpansion`, `SessionStart` — write **plain
  stdout**; it is added as context. These are the only events where that is
  true.
- `Stop`, `SubagentStop` — **exit 2**. Stopping is blocked and **stderr** is
  fed back to the model as the reason.
- `PreToolUse` — exit 2, or the JSON equivalent `permissionDecision: "deny"`
  with a `permissionDecisionReason`.

Check which one you need before writing the hook, or you will ship something
that silently does nothing.

## Preventing premature subagent termination

`hooks/subagent-stall-check.sh` is the kit's answer to a general multi-agent
failure mode (MAST-style "stopping too early"): an agent completes a
sub-step, and the sub-result — a verdict, a lookup, a check — *looks* like a
finished answer, so it stops there instead of doing the work that sub-result
was an input to. It gets worse the more you modularise, because every
extracted module manufactures a new plausible stopping point.

Prose does not fix this. Restating the contract, completion checklists and
sterner dispatch prompts each raise the success rate and none of them close
it, because they are advisory. A stop hook that exits 2 is a hard gate: the
agent cannot terminate while the gate says no.

Two things worth knowing if you adapt it:

- **Gate on a postcondition wherever you have one.** The shipped version
  scans the agent's final message for stall phrases, which is a proxy — it
  catches agents that *announce* they are stopping early and misses the
  quiet ones. If your agents produce something checkable (a row written, a
  file created, a PR opened), test that instead: it tests the state of the
  world rather than what the agent said about it. If you already verify
  after the fact and re-dispatch, you have written this check already —
  moving it into the stop hook turns rework into prevention.
- **Always bound the retries.** This one blocks each `agent_id` at most once
  (recorded in `.claude/state/stall-blocked.txt`). Without a guard, an agent
  that genuinely cannot finish is blocked forever.
- **`skills/overnight-review/SKILL.md`** — the "AI-native QA cycle" ceremony
  from the kit README (practice 6): a long, mostly-unattended pass that lands
  safe work, gates on the expensive test layer with flake triage, then fans
  out parallel fleets (user-testing, multi-lens code/product review,
  testing-methodology review) that catch-and-report findings to the tracker.
  Every project-specific detail (the board/issue references, the actual
  review lenses, the tech stack) is marked `<PLACEHOLDER: ...>` — fill those
  in for the new project before relying on it; the surrounding structure is
  the part that transfers as-is.
- **`workflows/issue-triage-to-milestones.js`** — the "AI-native planning"
  ceremony (practice 6): a three-phase agent workflow (gather every open
  issue → fan out a panel of lens reviewers over the whole set → synthesize a
  milestone plan) that proposes a roadmap without mutating anything. Same
  deal — project-specific bits are `<PLACEHOLDER: ...>`-marked; fill in the
  lens list and the gather-phase `gh` invocations (owner/project number) for
  the new project.

## Why this split exists

Splitting "project source" (committed, in the repo) from "how I work this
project" (`.claude/`, git-ignored, personal) keeps the automation layer free
to evolve per-session without needing review, while keeping the actual
product code clean of tooling that only makes sense to the person driving
the agents. See practice 2 in the kit README for the parallel reasoning
behind `CLAUDE.md` itself.

# `claude/` — copy this into a new project's `.claude/`

Everything in this directory is meant to be copied onto disk as the new
project's `.claude/` directory — **not** committed to the project's git repo.
In the Sortomate project this whole tree is git-ignored on purpose: it's
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

## What's in here

- **`settings.json`** — registers the CI-status stop-hook below. Merge this
  into the new project's `.claude/settings.json` rather than overwriting one
  that already exists.
- **`hooks/ci-status.sh`** — a Stop hook that checks the current commit's CI
  runs after a push and surfaces anything non-green. Near-generic as-is; it
  only assumes `git`, `gh`, and a GitHub Actions-style CI. See the comments
  in the file for the exact trigger conditions (only fires within 30 minutes
  of a pushed HEAD, stays silent when everything's green).
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

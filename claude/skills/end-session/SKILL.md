---
name: end-session
description: >-
  Close-out ritual for ending a project session: audits the session for
  material work not yet recorded anywhere durable, records it, reconciles
  the project's board/tracker and memory, verifies repo and scratchpad
  hygiene with live checks (never assertions), and delivers a closing
  verification report. Writes a handover memory file only when the audit
  leaves in-flight residue with no durable home; a clean close states
  "no handover" as a verified outcome. Use when the user says "end the
  session", "wrap up", "clean up your stuff", "anything else that needs
  doing?", "can I archive / close this session?", or asks for a handover
  to a new session. NOT for "I'm going to bed" — that is a continuation
  with a deferred morning note, not a session end. If the project has its
  own end-session skill, that one wins.
---

# End session

<!--
  Generalized from the source project's end-session skill for solo-ai-kit.
  See claude/README.md for how this fits. Unlike overnight-review, this
  file carries no <PLACEHOLDER: ...> marks: every project-specific detail
  (sweep mechanisms, label conventions, deploy rules) is deferred to the
  project's own CLAUDE.md at the point of use.
-->

The centerpiece is the question that reliably surfaces what plain
"clean up" passes miss: **"Is there anything material from this session
that is not recorded somewhere durable?"** Every phase verifies live —
a closing claim without a command output behind it is an assertion, and
assertions are the failure mode this skill exists to kill. "N/A" with a
stated reason is a valid verified outcome; an unchecked row is not.

Project-specific hygiene (branch/worktree sweeps, deploy-preview rules,
label conventions) comes from the project's own CLAUDE.md — honor it in
the matching phase rather than skipping it.

## What "done" means, and when the check stops

Two lines, derived on this kit's own tracker (#54), are the whole
practice; every phase below is machinery for auditing against them:

> Done means nothing this session learned is lost — not that the work
> finished.
>
> The check is complete when the only remaining items are artifacts of
> the check itself.

The first is the definition of done. "Safe to archive" computed from
visible activity being finished (commits landed, tree clean, scratchpad
empty) answers a different question than the one being asked, and #54
records it being refuted two messages after it was said.

The second is the termination rule. First-order material is what the
session learned while doing the work; second-order material is what got
created by reporting on it (a comment posted, a hypothesis raised and
refuted while checking). The act of checking produces new recordable
events, so a check without a stopping rule fires forever without the
underlying state ever being incomplete. When a pass returns only
second-order material, the well is dry: answer "no" and close. Without
this rule an honest agent can never answer "no", and a check that always
fires carries no information.

## Why this is an invoked skill, not a hook

Decision of record (#54): the property that makes the close question
work is that it comes from **outside** — the user asks a question the
agent did not set the terms of. A version that triggers itself inherits
the agent's own sense of done, which is the thing being wrong; it
produces a self-report that goes green against the bug. And a
session-end hook fires with no turn left to act on what it finds. So
this skill runs as a normal turn, when the user asks, with full capacity
to fix what it surfaces. Do not wire it to fire on its own.

## Phase 0 — open loops

Is the session actually finishable?

- Background agents/tasks still running? Wait or hand their state over
  explicitly — never abandon one silently.
- Unanswered user questions earlier in the session? Answer now.
- Anything promised this session ("I'll…") but not delivered? Deliver or
  convert to recorded residue (Phase 1).

## Phase 1 — material-gaps audit (the centerpiece)

Walk the session and ask, for every material thing that happened:
**where does it live now?** Each kind has exactly one durable home:

| Material thing | Durable home |
|---|---|
| A decision | Issue/PR comment, cited by URL — no link, no decision |
| A finding / bug / follow-up | Filed issue on the project's board/tracker |
| A lesson / correction | Memory file + MEMORY.md index line (second occurrence → propose a mechanism, not another note) |
| Deferred work | Issue carrying the date/condition that unblocks it |
| An item blocked on the user | Issue, flagged per the project's convention |
| Cross-project follow-up | The *other* project's tracker/memory, not this one's |

Anything without a home gets one **now** — file it, comment it, write it.
A finding is not recorded until it has a number and a state: a commit
body or a chat message *feels* like recording and is neither queryable
nor swept, so it does not count as a home. What cannot be homed
(in-flight state) becomes handover residue (below).

## Phase 2 — memory and index

- Write/update memory files for this session's lessons and state changes;
  prefer updating an existing file over duplicating.
- One index line per file in MEMORY.md.
- Completeness scan (run via the Bash tool; use this project's memory
  directory):

```bash
cd ~/.claude/projects/<project-slug>/memory
for f in *.md; do [ "$f" = "MEMORY.md" ] && continue; grep -qF "($f)" MEMORY.md || echo "UNINDEXED: $f"; done
```

Deliberately unindexed files (superseded historical tail) are fine —
anything else gets indexed or consciously retired.

## Phase 3 — board/tracker reconcile (live queries, not assertions)

Use whatever tracker the project's CLAUDE.md names as source of truth.

- In-progress cards ↔ work actually in progress right now.
- Work finished this session → its cards done/closed.
- Issues filed this session → on the board in the entry column.
- Blocked-on-user flags: on for anything now waiting on the user, off
  for anything they answered this session.

## Phase 4 — repo hygiene

- `git status` clean; `git status -sb` shows 0 ahead / 0 behind.
- Every open PR has a named state (awaiting review / blocked-on-X) — no
  orphaned PRs.
- Run any sweep/cleanup mechanisms the project's CLAUDE.md defines; after
  a sweep, verify the disk agrees (a ledger row is not proof). Before
  removing anything: check for uncommitted or unique content. Ambiguous →
  report, never delete.

## Phase 5 — CI / deploy state

Latest completed run on the default branch is green (`gh run list`).
No CI configured, or deploys handled elsewhere? State that with the
evidence — that is a verified N/A. Red default branch → investigate now
or hand over as named residue; never close over it silently.

## Phase 6 — scratchpad

Inventory first (paths + sizes), confirm every deliverable already lives
somewhere durable, then wipe. Never a blind `rm -rf`.

## Phase 7 — closing report (the deliverable)

A verification table where **every row cites its evidence** (command
output, URL, or query result): working tree · ahead/behind · open
PRs/branches · CI/deploy · board · memory index · background agents ·
scratchpad.

Then, in order:
1. **Handover verdict** — either the file's path + index line, or the
   explicit sentence *"No handover: nothing in flight; the board and
   memory carry the state."*
2. **User-decision queue** — open items waiting on the user that were
   touched or newly filed this session, oldest first.
3. The final line: **"You can archive this session."** — or the named
   blocker that prevents it.

---

## Handover — written on residue, and only on residue

The Phase 1 audit decides, in both directions:

- Residue with no durable home exists → a handover **must** be written.
- No residue → a handover **must not** be written; the closing report
  states the no-handover sentence so the absence is a checked outcome.
- The user asking for one overrides the rule and always produces one.

**Residue means:** an open or unmerged PR mid-flow; a pending review; a
parked decision not yet an issue/PR comment; uncommitted work that must
survive; next-session sequencing the board cannot express ("do X before
Y, because of trap Z").

**Template — every section is required.** "None" is a valid entry; a
missing section means the handover is incomplete:

```markdown
---
name: reference_handover-YYYY-MM-DD-<slug>
description: <one dense status line for MEMORY.md>
metadata:
  type: reference
---
Supersedes [[<previous-handover-name>]] where they disagree.  <!-- or: First handover of this thread. -->

## Default branch is `<SHA>`. Working tree <state>. <N> agents running.

1. Open user decisions (URL each — no link, no decision)
2. What landed (table: change | merged/posted as | outcome)
3. In flight (PR/branch/location + exact state + who owns the next move)
4. Traps learned this session
5. DO-NOT-CLEAN (locations holding unique work — or "none")
6. First moves for the next session (numbered)

DELETE when: <the concrete condition that makes this file obsolete>
```

Index it in MEMORY.md; add "READ FIRST ON RESUME" only when reading it
first is genuinely load-bearing — the flag dilutes if every file
carries it.

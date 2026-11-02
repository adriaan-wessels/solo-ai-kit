---
name: scp
description: "Exchange messages with another AI agent (for example Claude with ChatGPT) on the same computer. Messages pass through numbered Markdown files in a folder the user shares with both. Use when the user asks you to start, answer, watch, close or check a Shared-folder Communications Protocol (SCP) thread. Also use it when the user asks you to set up turn-taking with another product's agent. The rules are in PROTOCOL.md; this skill covers commands and per-product notes. Do not use for the `scp` secure-copy command."
---

# Shared-folder Communications Protocol (SCP): messages over the garden walls

Version 1.6.1. The protocol rules are unchanged from 1.5.6. This version changes how a thread is started and watched,
and `init` now refuses an existing folder or a past deadline.

Read `PROTOCOL.md` before taking part in a thread; it is authoritative. This file only covers commands and
product notes. Install the **whole folder** (this file, `PROTOCOL.md` and `scp.py`): the skill needs the
protocol text and the script, not SKILL.md alone. `PROTOCOL.md` and `scp.py` sit next to this file; run them
from this skill's folder (the product notes give its location).

## When the user invokes this skill to start a thread

The order below puts the paste block in the user's hands before any preparation work. Steps 1 and 2 happen in one
turn when nothing is missing.

1. **Resolve missing settings and access.** Ask nothing that is already settled. Put any questions in one short
   message, with estimated settings stated compactly. Do not show a draft block.
   - *Automatic when unambiguous:* you speak first, and the other agent is the other participant. The thread name is
     short and lower-case, taken from the purpose (letters, digits, hyphens). `<permitted actions>` defaults to
     reading the materials named in the purpose and discussing or reviewing them in the thread. The default writes no
     files outside the thread. The participant's own unpublished draft may be kept inside the thread under the name
     described in Commands.
   - *Threads folder:* the one named in the invocation, else your stored default. If there is none, ask, and store the
     answer only in a place the product loads into every session. Generated memory that may not load is not enough. If
     no such place exists, tell the user the default cannot be kept.
   - *Rounds and deadline:* resolve each separately. Use a value given in this invocation. For a missing value, use an
     applicable standing ceiling the user explicitly approved, stored where the product loads it every session. Store
     a time ceiling as a duration with its starting point (for example "24 hours from init"). Convert it to one
     absolute UTC deadline just before `init`. Use exactly that timestamp in the manifest, the block and the watch. An
     explicit absolute deadline stays absolute; never reuse an expired one (`init` refuses a deadline that has
     passed). If the work appears to exceed a ceiling, ask once for an exception for this thread; change the stored
     ceiling only with explicit approval. With no applicable ceiling, estimate the missing value, give a one-line
     reason, ask once, and offer to remember the answer. Accepting a value for one thread does not approve storing it.
     A round is one published message, not a pair. The ceiling is headroom, not a target. Do not size a thread below
     it to economise, and propose close as soon as the purpose is met.
   - *Authority:* if the purpose needs edits or other actions, use authority the user already gave in this chat. If
     authority for those actions is missing, include it in the single question. Ask also if there is no purpose.
   - *Access:* where the product allows, make the first access attempt in the same turn as the question. An approval
     or access problem then surfaces while the user is present. On some surfaces this is still two interactions. Probe
     separately only when this session lacks evidence that the interpreter and the named threads folder work. The
     probe is a minimal read-only check of the interpreter and that folder's existence and access. Do not scan other
     threads recursively, and do not run `selftest` as routine start-up. Resolve an unknown folder before checking it.
     If settings are already settled, `init` in step 2 is itself the first access attempt. A successful probe does not
     establish permission for later writes or scheduling.

2. **Init and show the block.** Run `init`. If it refuses because the folder already exists
   (`refused: ... already exists`), choose a fresh suffix for the name and retry. Never reuse or overwrite an existing
   thread. Do not treat other `init` errors as collisions. Immediately after a successful `init`, show the user ONE
   short block to paste into the other agent's chat, as a visible intermediate message. Continue working in the same
   run; do not make the user send another message to resume. On a surface that cannot continue after an intermediate
   message, use a verified continuation mechanism. The block:

   ```
   Take part in SCP thread <name> (<thread path>) with <you> to <purpose>; you may <permitted actions>; stop at close or <deadline>.
   ---
   Join as participant "<other>". Use the SCP skill if installed; otherwise the rules are <path>/PROTOCOL.md and the
   script is <path>/scp.py. Run status on this thread now, then check it every 10 minutes until it closes or the
   deadline passes, then stop. The opening message may not exist yet; "waiting for <you>" is normal, so keep the
   schedule.
   ```

   The block is the user's instruction once pasted, not yours (PROTOCOL.md §1). Keep it short enough to read.
   No substantive material review or publication of `001` is required before showing the block. Use the
   purpose, paths and permissions already supplied by the user, and do not imply the material has been reviewed.

3. **Continue the work.** Read the materials, prepare any support files, and write and publish `001`. Keep a watch on
   this thread for its lifetime, bounded by its deadline (product notes). Being asked to start the thread authorises
   the watch (PROTOCOL.md §5). Point `watch` at the thread's own folder, not the threads root, so that other sessions'
   threads do not wake you. Tell the user when `001` is published, which thread you are watching, how often, and until
   when. Publish `001` as soon as it is sound; the other agent sees it at its next check.

Timing: the block reaches the user before opening-message preparation. If the receiver checks before `001` exists, it
waits for a later check. With on-time checks every T minutes, the remaining detection wait after `001` is available is
less than T. It is about T/2 only if arrival is uniformly distributed between checks. Scheduling or host delays can be
longer. Earlier setup can overlap preparation, so the net effect on the first useful reply must be measured
separately.

If you receive such a block, follow it: check the stop condition and run `status` on the exact thread immediately.
Act on a current turn without waiting for the first scheduled check. Establish continued checks on that exact thread
while it remains active, even if `001` is absent; treat "waiting for <first speaker>" as normal. Stop and tell the
user on damaged history, closure, `STOP`, the stated deadline, or no remaining legal turn. Keep the returned schedule
identifier and remove the scheduled check when stopping.

## Commands

`scp.py` is a single standard-library Python file. Run it with the Python you already use.

| step | command |
|---|---|
| start a thread (the user asks you to) | `python scp.py init <thread> --participants claude,chatgpt --first claude --max-rounds <resolved round limit> --deadline <resolved UTC deadline, as YYYY-MM-DDTHH:MM:SSZ> --purpose "..."` |
| whose turn, what is unread | `python scp.py status <thread> <me>` (exit 0: your turn; 1: not your turn, normal while waiting) |
| publish your message | write a draft with the header from PROTOCOL.md §3, then `python scp.py publish <thread> <draft.md>` |
| wait for your turn | `python scp.py watch <thread> <me> <minutes>` (your own thread; a folder of threads also works) (exit 0: your turn; 2: timed out; 3: every thread finished, which is not necessarily closed by agreement; 4: damaged history, no thread ready) |
| list any damage to the history | `python scp.py check <thread>` |
| test the script on this machine | `python scp.py selftest` |

A cycle is: `status` (or `watch`), read the unread messages, write a draft, `publish`. Keep the unpublished draft
inside its thread under a dot-name that cannot be mistaken for a message (`.<me>-draft-<round>.md`). Alternatively,
use a scratch area only when that location is within the operator-authorised scope. Delete the draft after a
successful publish. If `publish` refuses, it says why; fix the draft and try again. A refusal costs nothing. If
`status` reports damaged history, stop and tell the user; do not try to repair the folder yourself. Inspect every
state returned by `watch`, including on exit 0. For each state with damaged history, stop work on that thread and tell
the user; do not repair it yourself. Other ready threads may continue. Point `watch` at your own thread's folder. A
watch on the threads folder wakes you for every thread that names you, including other sessions'. If you do watch a
folder, it must hold only SCP threads. Closed threads may stay there, but test fixtures and other scratch data must
stay outside watched thread directories. Each thread may contain its participant's own dot-named unpublished draft as
described above.

## Product notes

In every product, end the watch or scheduled check when the thread closes, `STOP` appears or the deadline passes
(PROTOCOL.md §5). `watch` returns by itself with 3 once every watched thread is finished. A thread is finished when it
is closed, stopped, or past its cap or deadline with no live proposal. `watch` returns by itself with 4 when a
thread's history is damaged and no thread is ready. Otherwise the damaged states accompany exit 0. Still bound its
minutes by the operator's deadline. A live proposal past a limit keeps a thread open for a late `close_ack`, but it
does not extend the operator's stop. Prefer an event-driven or long-running watcher where the product supports one,
bounded by the deadline; a scheduled check is the portable baseline. Check that the mechanism you choose supports the
cadence the block asks for (10 minutes by default). If it cannot, tell the user at once rather than treat a slower or
manual check as meeting it. Keep scratch files (other than your own dot-named draft), test threads and self-test
temporary folders outside the threads folder. Create test fixtures only within separately authorised scope.

**Claude Science.** This skill's folder is `<Claude Science data folder>/skills/scp/`. Store the default threads
folder in the user's profile memory, which is loaded into every session. After any restart, kernel reset or offline
spell, run `status` on every open thread this session started or joined before anything else. Leave other sessions'
threads alone. Keep at most one watch per assigned thread, as a background job on that thread's own folder, bounded by
its deadline. When starting a thread, follow step 3: publish `001`, then keep the watch running. When joining a
thread, follow the receiver instructions: check immediately and keep checking while it is active, even if `001` is
absent. Replace an existing watch only for this same assigned thread, and never stop a watch another session owns. A
running background job keeps the session waiting and wakes it when the job ends. If no watch is running, nothing on
this side will notice the other agent's reply. The control kernel (`repl`) cannot see host folders; use the ordinary
Python or shell tools. Run `scp.py` with the kernel's own interpreter via subprocess, not a bare `python` from
PowerShell. Show the paste block with the mid-run message tool, then continue. Run the long watch in a separate
environment so that a stuck or interrupted watch never blocks the kernel that drafts messages.

**Claude Code.** Store the default threads folder in `~/.claude/CLAUDE.md`, which is loaded into every session. Run
`watch` as a background command, and stop it when the thread closes, is stopped or expires. A check only at the start
of each session does not meet the block's cadence, so say so if that is all you can do.

**Claude Cowork scheduled tasks.** A scheduled task can run `status` and answer if it is Claude's turn. If its
shortest interval is longer than the block's cadence, say so when joining or use a longer cadence in the block. Each
run is a fresh session, which suits this protocol because all state is in the folder. A task that uses local files
runs only while the computer is awake and the desktop app is open. Not tested with this protocol yet.

**ChatGPT.** Where your surface offers scheduled tasks, set up a scheduled check (a heartbeat) on the thread folder.
Keep the check's identifier so you can change or remove it. Remove it when the thread closes, is stopped or expires.
The identifier, not the title, is the handle for changing or deleting the check. Put the full thread path and
participant in the schedule prompt. Availability and whether the computer must be online differ by surface (desktop,
web, CLI, IDE); check the current documentation for yours. A file uploaded to a chat is a copy, not a live connection
to the shared folder. First establish which connected computer or execution environment can read and write the folder.
A skill does not by itself provide folder access or Python. Store the default threads folder in instructions your
surface loads into every chat, not in generated memory.

**Codex.** Personal skills are in `.codex/skills/` in the user's home folder, so this skill is `.codex/skills/scp/`.
`agents/openai.yaml` gives it the display name SCP and the invocation `$scp`. Loading this skill does not run the
script; use a terminal on the computer that holds the shared folder. Ending a chat turn does not create a schedule.
Store the default threads folder in the global instructions file `~/.codex/AGENTS.md`, which Codex loads at the start
of every session.

*The start order and watch scope were agreed with the ChatGPT reviewer on 28 and 29 Oct 2026. The ChatGPT and
Codex notes are adapted from notes the ChatGPT reviewer wrote on 30 Sep 2026 from its own surface and OpenAI
documentation. On 1 Oct 2026 the Claude Science and Codex installations were used in one thread
(`exchange-scp-usability`); other products were not tested.*

## What this skill does not do

It grants no authority; the user does, in your own chat. It does not verify content, and it does not prove who
wrote a file (PROTOCOL.md §6).

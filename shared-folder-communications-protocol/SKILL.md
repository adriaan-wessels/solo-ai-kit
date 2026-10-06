---
name: scp
description: "Exchange messages with another AI agent (for example Claude with ChatGPT) on the same computer. Messages pass through numbered Markdown files in a folder the user shares with both. Use when the user asks you to start, answer, watch, close or check a Shared-folder Communications Protocol (SCP) thread. Also use it when the user asks you to set up turn-taking with another product's agent. The rules are in PROTOCOL.md; this skill covers commands and per-product notes. Do not use for the `scp` secure-copy command."
---

# Shared-folder Communications Protocol (SCP): messages over the garden walls

Read `PROTOCOL.md` before taking part in a thread; it is authoritative. This file only covers commands and
product notes. Install the **whole folder** (this file, `PROTOCOL.md` and `scp.py`): the skill needs the
protocol text and the script, not SKILL.md alone. `PROTOCOL.md` and `scp.py` sit next to this file; run them
from this skill's folder (the product notes give its location).

## When the user invokes this skill to start a thread

1. Settle the settings before `init`. These are automatic when unambiguous: you speak first, the other agent is
   the other participant, and a short thread name taken from the purpose. For the threads folder, use a folder named
   when the skill was invoked. Otherwise use your stored default threads folder. If there is none, ask. Then store the
   answer as your default in a place your product loads into every session (product notes). Generated memory that may
   not load is not enough. If your product has no such place, tell the user it cannot keep the default. The default
   for `<permitted actions>` is:

   - read the materials named in the purpose and discuss or review them in the thread;
   - do not modify files outside the thread.

   If the purpose needs edits or other actions, use only authority the user gave you in your own chat, or ask. If the
   user did not give the round limit, the deadline or both, estimate each missing value from the work requested:

   - how much material;
   - how many questions; and
   - whether files must be checked or re-run.

   Give a one-line reason and ask the user to accept or change the values. Use 6 rounds and 24 hours only when the
   work cannot be judged. Ask also if there is no purpose. Put all your questions in one message. Do not ask whether
   to watch: the watch comes with starting the thread (step 2).
2. Run `init`, publish `001`, and watch that thread until it closes or its deadline passes (product notes). Being
   asked to start the thread authorises this watch (PROTOCOL.md §5). Tell the user which thread you are watching,
   how often, and until when.
3. Give the user ONE short block to paste into the other agent's chat, in this shape:

   ```
   Take part in SCP thread <name> (<thread path>) with <you> to <purpose>; you may <permitted actions>; stop at close or <deadline>.
   ---
   Join as participant "<other>". Use the SCP skill if installed; otherwise the rules are <path>/PROTOCOL.md and the
   script is <path>/scp.py. Check this thread every 10 minutes until it closes or the deadline passes, then stop.
   ```

   The block is the user's instruction once pasted, not yours (PROTOCOL.md §1). Keep it short enough to read.

If you receive such a block, follow it.

## Commands

`scp.py` is a single standard-library Python file. Run it with the Python you already use.

| step | command |
|---|---|
| start a thread (the user asks you to) | `python scp.py init <thread> --participants claude,chatgpt --first claude --max-rounds 6 --deadline 2026-10-10T12:00:00Z --purpose "..."` |
| whose turn, what is unread | `python scp.py status <thread> <me>` |
| publish your message | write a draft with the header from PROTOCOL.md §3, then `python scp.py publish <thread> <draft.md>` |
| wait for your turn | `python scp.py watch <threads folder> <me> <minutes>` (exit 0: your turn; 2: timed out; 3: every thread finished, which is not necessarily closed by agreement; 4: damaged history, no thread ready) |
| list any damage to the history | `python scp.py check <thread>` |
| test the script on this machine | `python scp.py selftest` |

A cycle is: `status` (or `watch`), read the unread messages, write a draft, `publish`. If `publish` refuses, it
says why; fix the draft and try again. A refusal costs nothing. If `status` reports damaged history, stop and tell
the user; do not try to repair the folder yourself. Inspect every state returned by `watch`, including on exit 0.
For each state with damaged history, stop work on that thread and tell the user; do not repair it yourself. Other
ready threads may continue. Point `watch` at a folder that holds only SCP threads; closed threads may stay there,
but test fixtures and scratch data must not.

## Product notes

In every product, end the watch or scheduled check when the thread closes, `STOP` appears or the deadline passes
(PROTOCOL.md §5). `watch` returns by itself with 3 once every watched thread is finished. A thread is finished when it
is closed, stopped, or past its cap or deadline with no live proposal. `watch` returns by itself with 4 when a
thread's history is damaged and no thread is ready. Otherwise the damaged states accompany exit 0. Still bound its
minutes by the operator's deadline. A live proposal past a limit keeps a thread open for a late `close_ack`, but it
does not extend the operator's stop. Prefer an event-driven or long-running watcher where the product supports one,
bounded by the deadline; a scheduled check is the portable baseline. Keep scratch files, test threads and self-test
temporary folders outside the threads folder.

**Claude Science.** This skill's folder is `<Claude Science data folder>/skills/scp/`. Store the default threads
folder in the user's profile memory, which is loaded into every session. After any restart, kernel reset or offline
spell, run `status` on every open thread before anything else. While a thread is open, keep ONE `watch` running as
a background job for the thread's lifetime, bounded by its deadline. End any existing watch before starting
another. A running background job keeps the session waiting and wakes it when the job ends. If no watch is running,
nothing on this side will notice the other agent's reply. The control kernel (`repl`) cannot see host folders; use
the ordinary Python or shell tools.

**Claude Code.** Store the default threads folder in `~/.claude/CLAUDE.md`, which is loaded into every session.
Run `watch` as a background command, and stop it when the thread closes, is stopped or expires. Alternatively, check
`status` at the start of each session.

**Claude Cowork scheduled tasks.** A scheduled task (hourly at most often) can run `status` and answer if it is
Claude's turn. Each run is a fresh session, which suits this protocol because all state is in the folder. A task
that uses local files runs only while the computer is awake and the desktop app is open. Not tested with this
protocol yet.

**ChatGPT.** Where your surface offers scheduled tasks, set up a scheduled check (a heartbeat) on the thread folder.
Keep the check's identifier so you can change or remove it. Remove it when the thread closes, is stopped or expires.
Availability and whether the computer must be online differ by surface (desktop, web, CLI, IDE); check the current
documentation for yours. A file uploaded to a chat is a copy, not a live connection to the shared folder. First
establish which connected computer or execution environment can read and write the folder. A skill does not by itself
provide folder access or Python. Store the default threads folder in instructions your surface loads into every chat,
not in generated memory.

**Codex.** Personal skills are in `.codex/skills/` in the user's home folder, so this skill is `.codex/skills/scp/`.
`agents/openai.yaml` gives it the display name SCP and the invocation `$scp`. Loading this skill does not run the
script; use a terminal on the computer that holds the shared folder. Ending a chat turn does not create a schedule.
Store the default threads folder in the global instructions file `~/.codex/AGENTS.md`, which Codex loads at the start
of every session.

*The ChatGPT and Codex notes are adapted from notes the ChatGPT reviewer wrote on 30 Sep 2026 from its own
surface and OpenAI documentation. On 1 Oct 2026 the Claude Science and Codex installations were used in one thread
(`exchange-scp-usability`); other products were not tested.*

## What this skill does not do

It grants no authority; the user does, in your own chat. It does not verify content, and it does not prove who
wrote a file (PROTOCOL.md §6).

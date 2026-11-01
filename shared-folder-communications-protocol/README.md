# Shared-folder Communications Protocol (SCP): let two AI agents talk to each other

You use Claude and ChatGPT (or any two agents). Each lives in its own walled garden and cannot message the other.
The **Shared-folder Communications Protocol (SCP)** lets them take turns through a folder you share with both. Each
message is one numbered Markdown file. A small script enforces whose turn it is. SCP also gives a clean way to finish.

It is for **one person running both agents, under their own accounts, on the same computer**. For example, you can
have one agent review the other's work. It is not a security tool, it does not referee between people, and it does not
coordinate agents on different computers. See "Limits" below.

## What is in the folder

| file | what it is |
|---|---|
| `PROTOCOL.md` | the rules, about two pages |
| `scp.py` | the script: one file, standard-library Python, with a built-in self-test |
| `SKILL.md` | a skill in the open Agent Skills format, named `scp`, with notes for Claude Science, Claude Code, Cowork, ChatGPT and Codex |
| `agents/openai.yaml` | the display name for OpenAI products; other products ignore it |

## Five-minute setup

1. Put this folder on your computer, somewhere both agents can read and write. A cloud-synced folder is fine,
   as long as both agents work on this computer. Keep threads in a folder of their own, for example `threads/`,
   with no test data in it.
2. Run `python scp.py selftest`. It should report every case passing.
3. Install the whole folder as a skill named `scp` in each product that supports skills. Alternatively, give each
   agent the three files (`SKILL.md`, `PROTOCOL.md`, `scp.py`) as instructions and tools. `SKILL.md` alone is not
   enough.
4. Invoke the skill in one agent's chat with what the thread is for, for example *"/scp review section 3 of my
   draft"* (`$scp` in Codex). If you gave no round limit or deadline, it uses a standing limit you have approved,
   or sizes them from the job and asks once. The first time, it also asks which folder to keep threads in, and
   remembers it. It then starts the thread and gives you one short block straight away, before it prepares the
   opening message.
5. Read the block and paste it into the other agent's chat. Once pasted it is your instruction.
6. To stop a thread at any time, create an empty file named `STOP` in its folder.

## Limits

- **Turns are enforced; identity is not.** Anyone with access to the folder can write a file. The script keeps
  turns orderly and logs a hash of every message, so accidental edits show up, but it cannot prove which agent
  wrote what.
- **Authority stays with you.** Each agent should act only on what you tell it in its own chat. It should treat the
  other agent's messages as information.
- **Speed depends on watching.** A thread moves only when each agent notices its turn. Some products can keep a
  watcher running or wake on a schedule, and others need a nudge. The product notes in `SKILL.md` say what works
  where.
- **One computer only.** The script serialises publishing on one computer. Agents on different computers are
  outside its design: a slow sync or a conflict copy can duplicate a turn. The script then stops and reports
  damaged history, but it cannot prevent the collision.
- **It does not check content.** Whether a review is right is for the agents, and for you, to judge.

A stricter protocol, with hash-pinned rulings, pinned evidence and a findings ledger, exists for settings that need
it:

- several people;
- agents on different computers;
- a record that outsiders must be able to audit; or
- evidence that must remain re-checkable after the thread.

## Status

Version 1.6.1, 1 November 2026, accepted. The protocol rules are unchanged from 1.5.6. This version changes how a
thread is started and watched, so that the person waits as little as possible for the block to paste:

- the starting agent asks any questions in one turn and, where the product allows, makes its first access attempt in
  the same turn;
- it then starts the thread and shows the block at once, before it reads materials or writes the opening message;
- round limit and deadline are settled separately, each from the first of these that applies:
  - a value given when the skill is invoked;
  - a standing limit the person has approved, used without asking unless the work needs more;
  - an estimate the agent asks about once;
- a time limit is turned into one fixed UTC deadline just before `init`, and an expired deadline is never reused;
- the receiving agent checks the thread as soon as it gets the block and keeps checking even before `001` exists;
- each agent watches only its own threads, by pointing `watch` at the thread's folder. Several threads can then run at
  once without waking or stopping each other's watches; and
- an agent may keep its unpublished draft inside the thread under a dot-name.

`scp.py` changes in three ways. New threads record `SCP 1.6.1`. `init` now refuses, with a message and no traceback, a
thread folder that already exists or a deadline that has passed. The usage text describes `watch` on one thread or on
a folder of threads. The self-test (76 cases, 2 of them new for `init`) passes on Windows with Python 3.11.16,
including under `-I -S -B`.

**Upgrading from 1.6.0.** The start order and watch rules are the same; only their wording changed. `init` now gives
exit 1 and a `refused:` message for an existing folder or a past deadline. In 1.6.0 the first gave a traceback, and
the second created a thread that was already finished.

**Upgrading from 1.5.6.** No change to existing threads: `watch` and `status` find 1.5.x threads as before. To use a
standing limit, store it where each starting agent loads instructions into every session. For example: "SCP threads: 8
rounds and 24 hours from init unless I say otherwise". Point existing watches at a thread's own folder.

If upgrading from 1.5.5 or earlier, also account for the 1.5.6 conventions. Conclusions that depend on files carry
their hashes. Finding IDs carry the participant's name and are never reused. Apply the finding-ID convention to new
threads; do not rename findings in existing threads. For watch callers, exit 3 means finished, not necessarily closed
by agreement; handle exit 4 and inspect damaged states returned alongside exit 0.

**Review history.** ChatGPT reviewed the protocol in these threads, all run under this protocol and kept in the
author's private repository.

- `exchange-lite-review/` (versions 1 to 1.2). ChatGPT verified many fixes. It closed the review qualified, with two
  residuals open and with explicitly no release approval. The first review found real ordering faults in version
  1, including duplicated rounds and unchecked bytes being published.
- `exchange-lite-review-2/` (version 1.3). ChatGPT verified that 1.3 fixes both residuals. It then found one more race
  (L007): a false damage report when a publish finishes while a reader is looking. It also found an overstatement in
  this section (L008). It did not approve release.
- `exchange-lite-review-3/` (versions 1.4 to 1.4.2). ChatGPT verified both fixes and **accepted version 1.4 for public
  release with named limits** (below). Version 1.4.1 changed documentation only: the wording of the recheck (review
  note L010) and this status section. Version 1.4.2 renamed the protocol from its working name, sfcp-lite, to SCP,
  and states the same-computer scope up front.
- `exchange-scp-usability/` (on 1.4.2). Claude and ChatGPT agreed the name `scp` and the usability changes in
  1.5, apart from the one-block start, which the researcher asked for afterwards. Deferred: a read-only `next`
  command that prints the next message header (contract in that thread's message 002).
- `threads/exchange-scp-150-review/` (versions 1.5.0 to 1.5.3). ChatGPT reviewed the one-block start. It did not
  approve 1.5.0: the other agent's default scope was missing, and the starting agent's watch had no authority.
  It did not approve 1.5.1: the starting agent applied a round limit and deadline without asking. It accepted
  1.5.2. At the researcher's request, 1.5.3 then has the starting agent size those values from the work. It
  accepted 1.5.3.
- `threads/exchange-scp-154-review/` (versions 1.5.4 and 1.5.5). The default threads folder, and two README
  sentences that were true only in the author's private repository. ChatGPT did not approve 1.5.4: it kept the
  default where a product might not load it.
- `threads/scp-lite-operational-feedback/` (on 1.5.5). After an 18-finding review of other work had exercised the
  protocol hard, ChatGPT gave operational feedback and Claude added three points. Both agreed the 1.5.6 text and
  product notes, with `scp.py` unchanged. ChatGPT's proposed "many findings" trigger for the strict version was
  dropped: the failures in that review were unsupported self-reports. A findings ledger would not have caught them.
- `threads/scp-156-review/` (first staging of 1.5.6). ChatGPT confirmed the protocol text was faithful to the
  agreed text and accepted the staging decisions. Tests by both participants showed that `watch` did not end on
  stopped, expired or finished threads. Only ChatGPT tested expiry. The review recommended this script change, the
  version string, and a transition note. Claude found that `watch` was also silent on damaged history; exit 4 is in r2
  for the follow-up review to accept or reject.
- `threads/scp-156-r2-review/` (r2). ChatGPT verified the script change independently and accepted exit 4 with a
  turn before damage. It found that the r2 docstring promised damage would be "reported alone on the next pass", which
  the stateless `watch` does not do. The r3 staging corrects that and documents that callers must check every returned
  state, including on exit 0.

- `threads/review-scp-block-first/` (start order). ChatGPT accepted the block-first start. It set five requirements.
  The block shows as a visible message, with work continuing in the same run. Any access probe is cheap and valid, and
  used only when needed. There is no draft block. The receiver checks immediately. A timing claim is stated only as a
  mechanism, not a measured saving.
- `threads/review-scp-157-full/` (the full skill, then labelled 1.5.7). ChatGPT required round limit and deadline to
  be settled separately, and a time limit stored as a duration. It also required watches limited to the agent's own
  threads, and drafts allowed in the thread. It found that `init` accepts a deadline in the past and that the old
  example deadline had expired. The version was then renumbered 1.6.0 with the protocol header and script string, at
  the author's decision; that renumbering was not part of the review.
- `threads/review-scp-160-docs/` (1.6.0 documentation). ChatGPT's byte check found README text and a provenance line
  that no review had covered. It accepted the complete 1.6.0 staging, renumbering included, after four README
  clarifications.

**Accepted limits.** No identity authentication, and one computer only. The damage recheck is a bounded best
effort, not an atomic snapshot. Damage reports are deferred while a fresh publish lock is held. An interrupted
publish needs the operator to recover it. The watch can overshoot its requested time by up to one interval. `watch`
skips a thread whose `thread.json` cannot be read, so it cannot report damage to that file.

Installed and used in Claude Science and Codex on 1 October 2026. On 28 and 29 October 2026, Claude Science initiated
threads using the proposed start order. Codex joined using its installed 1.5.6 skill plus the pasted instructions. Not
yet tested: other products, and Cowork scheduled tasks.

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
   draft"* (`$scp` in Codex). If you gave no round limit or deadline, that agent sizes them from the job. The first
   time, it also asks which folder to keep threads in. It remembers the folder. It asks once, then starts the thread
   and gives you one short block.
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

Version 1.5.6, 4 October 2026, accepted (1.5.0, 1.5.1 and 1.5.4 were not approved; 1.5.2, 1.5.3 and 1.5.5 were
accepted). This is the third staging of 1.5.6 (r3). The protocol adds conventions that came out of a long review in
practice:

- hashes for files a conclusion depends on, with both closing messages carrying their own;
- finding IDs that are never reused and carry the participant's name;
- a round defined as one message, with when to propose close;
- what to do about a problem found after proposing close;
- when a watch ends; and
- that an agent's own summary of a thread is not protected.

The script changes `watch` and its version string. `watch` now returns 3 once every watched thread is finished, not
only when every thread is closed. A thread is finished when it is closed, stopped, or past its cap or deadline with no
live proposal. `watch` now also returns 4 when a thread's history is damaged and no thread is ready. The feedback
thread that agreed the 1.5.6 text recommended leaving `scp.py` unchanged. The first review of 1.5.6 reversed that
after tests by the two participants showed that `watch` kept running on stopped, expired and finished threads.
Claude tested stopped and finished threads; ChatGPT tested all three. The self-test (74 cases, 15 of them new for
`watch`) passes on Windows with Python 3.11.16, including under `-I -S -B`.

**Upgrading from 1.5.5.** Apply the finding-ID convention to new threads; do not rename findings in existing
threads. A caller that treated `watch` exit 3 as "every thread closed by agreement" should now read it as "every
thread finished". That caller should also handle exit 4 and damaged states listed with exit 0.

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

**Accepted limits.** No identity authentication, and one computer only. The damage recheck is a bounded best
effort, not an atomic snapshot. Damage reports are deferred while a fresh publish lock is held. An interrupted
publish needs the operator to recover it. The watch can overshoot its requested time by up to one interval. `watch`
skips a thread whose `thread.json` cannot be read, so it cannot report damage to that file.

Installed and used in Claude Science and Codex on 1 October 2026. Not yet tested: other products, and Cowork
scheduled tasks.

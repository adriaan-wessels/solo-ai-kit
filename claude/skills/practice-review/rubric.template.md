# Practice-review priority rubric (template)

> **What this file is.** A priority rubric for the recommendations a practice
> review produces, which are operating-model changes, NOT product issues. Your
> project's own issue-priority rubric stays authoritative for issues; this one
> rates practice candidates and nothing else.
> Established: <PLACEHOLDER: YYYY-MM-DD, and the tracker issue number>.
> **Last reconciled: <PLACEHOLDER: YYYY-MM-DD>** (<PLACEHOLDER: what prompted the reconcile>).

<!--
  Copy this file to rubric.md in the same directory at adoption, fill the
  placeholders, and leave the rest as it stands. The agents read it at run
  time from disk, so the version on disk is always the version a run rates
  on. The workflow enforces four of its clauses in code (the loosening cap,
  unnameable = P3, nothing above its table cell, and an uncomputable cell
  failing closed); the rest are judgment the agents apply.

  Generalized from the source project's practice rubric. The clause text
  carries over; three things are yours to choose: the calibration ledger
  path, the tracker issue, and the filing rules in step 6.
-->

Ratings live in the run report only, never as labels. Adoption cost NEVER
enters the rating; it is a separate field (S/M/L). Presentation order stays
leverage-for-cost, and the "do-first" band is P0/P1/P2 with cost S and fit yes.

A level rates the HARM AREA the candidate addresses. Whether THIS candidate is
worth adopting is a separate field (candidate_fit, step 5). Read a level as
"this area is hot", never as "adopt this".

## Step 1: harm class, by the WORST DIRECT outcome

  1. data loss / corruption / cross-account isolation breach
  2. security exposure: secrets, credentials, supply chain, prompt injection
     into agents, auth, credential-boundary crossings
  3. corruption of the evidence the founder decides on. TEST: name the founder
     decision the corrupted evidence feeds (a merge verdict, a triage, a
     release cut, an approval). If no decision can be named, it is class 4/5/6,
     not class 3.
  4. founder time burned
  5. money burned (model usage, CI minutes, cloud quota)
  6. delivery speed / friction

DIRECT-CAUSE TEST: the harm must follow from the gap without ANOTHER
independent control also failing. If reaching a higher class needs a second
control to fail, score the class of the direct outcome and note the longer
chain. (A proposal template whose worst chain runs "no template, then an ad hoc
schema change, then migration data loss" is class 6: the migration gate is the
second control.)

COMPETING DIRECT OUTCOMES: when a gap has several direct outcomes in different
classes, score the WORST direct outcome and name the others in the rationale.

## Step 2: evidence

- NAMEABLE: the claim names a concrete artifact that exists HERE (file, table,
  grant, credential, endpoint, log, workflow step, prompt line, settings key),
  cited by path or identifier. For class 1/2 also name WHO or WHAT can reach
  it. Unnameable = P3.
- RECORDED = an OCCURRENCE OF THE HARM here: the bad outcome happened, or was
  caught in the act, and a row exists describing it (issue, ledger row, memory
  file, telemetry line). An issue, decision or proposal that merely DISCUSSES
  the gap is NOT an occurrence. A ledger row recording an exposure STATE (for
  example "installed unread") is NOT an occurrence. A successful hand triage is
  NOT an occurrence. Count 0 / 1 / 2+.
- ONE OCCURRENCE, ONE CANDIDATE: each recorded occurrence may be claimed by the
  ONE candidate that would most directly have prevented it. Note collisions.
- REACH (class 1/2 only): EXTERNAL if reachable by a party other than the
  founder (a fetched page, an issue filer, a dependency, third-party code, an
  agent acting without the founder's approval); FOUNDER-ONLY otherwise.
- PROVENANCE: local / outward / both.

## Step 3: base level (deterministic table; nameable assumed, else P3)

                     | 0 occurrences                    | 1 occurrence | 2+ occurrences
  class 1/2          | P1, or P0 (see P0 CONDITIONS)    | P0           | P0
  class 3            | P2                               | P1           | P1
  class 4/5/6        | P3; P2 with an order-of-magnitude| P2           | P2; P1 only with the
                     |   estimate AND a named recurring |              |   estimate + cost line
                     |   cost line it attacks           |              |

P0 CONDITIONS (class 1/2, 0 occurrences). P0 if EITHER:
  (a) the harm is IRREVERSIBLE (data cannot be restored; a leaked secret cannot
      be rotated; an isolation breach already exposed another account's data),
      OR
  (b) a CREDENTIAL CROSSES to a party with EXTERNAL reach (third-party code
      running with a live token; an agent-issued action that removes the
      permission boundary).
  Otherwise P1. A hazardous STATE that is recoverable by a rotation, a revert or
  a restore is P1, not P0.

DETECTION candidates (the candidate ADDS a reader, detector or check for a
blind spot rather than preventing the harm). Score the class of the blind spot,
then:

  class 1/2 detection   = P1 if the blind spot covers credentials or isolation,
                          else P2
  class 3 detection     = P2
  class 4/5/6 detection = P3; P2 with an order-of-magnitude estimate of what the
                          blind spot costs and a named cost line

The missing reader is itself the nameable artifact. Prevention-vs-detection
test: the candidate PREVENTS if, once adopted, the harm cannot occur on that
path; it DETECTS if the harm can still occur and is reported.

## Step 4: caps and re-check flags (applied AFTER the table, in this order)

1. LOOSENING CAP: a candidate that removes, loosens or broadens a gate, guard,
   hook, credential scope or permission caps at P2 on outward evidence alone
   and carries a contradiction flag. Local telemetry showing the guard is
   net-harmful lifts the cap. An outside article saying a control is
   unnecessary is not telemetry, and the proposal's own claim about its
   provenance is not telemetry.
2. EVIDENCE UNAVAILABLE: if the verifier cannot check the cited artifact or
   occurrence (rate limit, log rotated, source unreachable), mark
   evidence_verified=unavailable and set recheck=true. The level is NOT lowered:
   an unverifiable claim is neither refuted nor confirmed, and a level that
   depends on API quota is not reproducible. The report lists every
   recheck=true item; the coordinator re-verifies them before the founder reads
   the band. UNTESTABLE PREMISE (a harness behaviour that cannot be checked from
   disk) is different: cap at P2 and name the premise as the first step.
3. TIE-BREAK within a class (only where the table leaves a choice):
   irreversible or external-reach takes the higher adjacent level.

Precedence: the table gives exactly one cell; caps only ever lower. No clause
may raise a level above the table cell except the P0 CONDITIONS written for
that cell.

## Step 5: candidate fit (separate from the level)

candidate_fit = yes | partial | no:

  yes     = the candidate's first step materially reduces the harm in this area
  partial = it reduces it only in combination with other work, or it is a trial
            or a comment
  no      = the founder has already declined this shape (a decision of record),
            or the mechanism has no consumer, or it is a question rather than a
            change

An item with fit=no keeps its level (the area stays hot) but is reported as
"area hot, candidate declined" and does NOT enter the in-session band.

IN-SESSION BAND = P0/P1 with fit yes or partial. Everything else is CAPTURED
(step 6).

## Step 6: capture and carry-forward

- In-session band items: the founder triages them in-session, and approved
  items are filed by script.
- Class 1/2 items at any level: always get their own issue when approved, never
  only a ledger line. Flag them for the founder when the next step is the
  founder's.
- Everything else: ONE rolled-up issue per run holding the rated list (id,
  level, class, fit, cost, one-line rationale). No per-item issues.
- Carry-forward: the next run reads EVERY previous roll-up as its
  known-unadopted list. Nothing is capped and nothing is dropped, because the
  priorities are the ordering. A carried item keeps its level. A later run that
  independently re-finds it increments a re-found count reported beside it;
  convergence is a signal for the founder, never an automatic raise and never a
  deletion. A carried item leaves the list only by the founder's decision:
  adopted, or declined with a one-line reason recorded on the roll-up. (The
  growth an arbitrary cap would have addressed is handled instead by the list
  being ids, levels and one-liners, cheap to dedupe against. If a run measures
  that cost as material, that is a finding for the founder, not a rule.)
  The roll-up is a TRACKER-VISIBLE issue, so it is NOT the detection key's
  seed: see the skill's step 2, which draws the sealed key from gaps absent
  from every roll-up.
- Founder overrules of a level are appended to
  <PLACEHOLDER: the project's calibration ledger, for example .claude/review/gate-calibration.jsonl>
  with a source field naming this review, so the rubric's precision stays
  measurable.

## Verifier and tier

The finder proposes the rating; a refute-by-default verifier scores it
independently on the same rubric, and the report lists the disagreements. The
verifier runs at or above the finder's recorded model and effort, on both axes.
A verifier one tier down is a review one tier down, and the workflow reports it
rather than hiding it.

## Output per item

id, harm_class (1-6), direct_chain, nameable (yes/no + artifact), recorded
(0/1/2+ + reference or collision note), reach (external/founder-only/n.a.),
provenance, detection (yes/no), caps_applied, evidence_verified
(yes/no/unavailable), recheck (true/false), level (P0-P3), candidate_fit
(yes/partial/no), cost (S/M/L), rationale.

## How to calibrate

Do not import a precision figure from another project. Measure your own, and
re-measure when you change a clause:

1. Take one past run's survivors. Have two scorers rate them on this rubric
   independently, neither seeing the other's scores.
2. Report two figures: exact-level agreement (both scorers picked the same
   P-level) and band agreement (both landed on the same side of the
   P0/P1 against P2/P3 split).
3. Read the result as the rubric's precision at that moment, on that sample,
   and no further.

Band agreement is the figure that matters, because the band is what the founder
acts on. Where the two scorers split by two or more levels, the clause they
split on is the thing to fix, not the scorers.

Whatever the figures say, the rubric supports an ADVISORY ORDERING only. It
orders what the founder reads first. It gates nothing, blocks nothing, and
never becomes a label.

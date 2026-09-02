# Operating-model inventory: the practice review's diff base

> **What this file is.** The durable record of the practices this shop
> actually runs: the practices counterpart of the CLAUDE.md architecture map.
> The `practice-review` skill diffs external best practice against THIS file,
> so its accuracy decides the review's signal. **Descriptive, never
> normative:** it records what exists; it binds nothing. Each practice-review
> run, and any PR that lands or retires a mechanism, updates it descriptively
> in the same PR. Rule changes themselves stay founder-gated. A stale
> inventory produces false gaps: the review then recommends what you already
> have, or misses what you retired.
> Established: <PLACEHOLDER: YYYY-MM-DD, and the tracker issue number>.
> **Last reconciled: <PLACEHOLDER: YYYY-MM-DD>** (<PLACEHOLDER: what prompted the reconcile>).

<!--
  Copy this file to inventory.md in the same directory at adoption, then fill
  each section from what the project actually runs. Keep the header block and
  the section headings: the workflow's lenses and its synthesis are written
  against them. One line per practice, naming the mechanism (hook, lint,
  test, cron, skill, rule) and where it lives. Replace the two placeholder
  lines under each heading with real content; delete a heading's content,
  not the heading, when a section is empty at this stage.
-->

Context: <PLACEHOLDER: one line on the shop (who, how many people, part-time or full-time) and the product (what it is, which platforms, which stage). The workflow's lenses scale their bar to this line.>

## Process & delivery (EXISTS)
- <PLACEHOLDER: how work is tracked, planned, reviewed, merged and released: the tracker and board rules, the branch and merge policy, any pre-merge review gate, the delegation model, the memory system, versioning.>
- <PLACEHOLDER: one line per mechanism; name the file or rule that implements it.>

## Verification & testing (EXISTS)
- <PLACEHOLDER: the test pyramid and the Definition-of-Done rule that picks the level; red-verification habits; lints that mechanize norms; CI shape and its cost decisions; how a new mechanism earns adoption (detection tests, bounded trials).>
- <PLACEHOLDER: one line per mechanism; name the file or rule that implements it.>

## Product & design (EXISTS)
- <PLACEHOLDER: the product principles and style rules that constrain code; the mockup-before-build gate; the release-readiness bar.>
- <PLACEHOLDER: one line per mechanism.>

## Ops, security, data (EXISTS)
- <PLACEHOLDER: access isolation and its audit; backups, restore drills and pre-migration snapshots; secrets handling; crash reporting and its privacy posture; dependency policy; quota watching.>
- <PLACEHOLDER: one line per mechanism.>

## User feedback & telemetry (EXISTS, partial by stage)
- <PLACEHOLDER: in-app feedback and analytics paths, and whether anything reads them on a schedule; the invite or beta path. "Write path only, no reader yet" is a legitimate line.>
- <PLACEHOLDER: one line per mechanism.>

## AI-specific practices (EXISTS)
- <PLACEHOLDER: prompt-freshness reconciles, fail-open guards, model and effort reporting, pinned workflows, adversarial verification, dedup rules, agent containment, and this review itself.>
- <PLACEHOLDER: one line per mechanism.>

## Decisions of record
Contradicting proposals need a STRONG stated reason and surface FLAGGED; they are never silently filed and never silently dropped.
- <PLACEHOLDER: one line per settled call the review does not relitigate: rejected directions, retired mechanisms, product posture, cost-visibility rules. Date each one.>
- <PLACEHOLDER: one line per decision.>

## Known tracked gaps
Already on the board; do NOT re-recommend as new.
- <PLACEHOLDER: one line per open issue that already covers a gap the review would otherwise re-find: issue number, one-line scope, milestone.>
- <PLACEHOLDER: the dispositions of the previous run's candidates, or a pointer to where they are recorded (the tracker issue).>

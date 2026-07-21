// Generalized from Sortomate's issue-triage-to-milestones workflow for the
// solo-ai-playbook kit. Fill in every <PLACEHOLDER: ...> before running this
// on a new project — search for the literal string "PLACEHOLDER" to find
// every spot. The workflow SHAPE (Gather -> Lenses -> Synthesis, one Sonnet
// digest pass, a fixed panel of Opus-tier lens reviewers, one Opus synthesis
// pass) is what should carry over unchanged; only the lens list and the
// gh/tracker specifics are project-bound.
//
// This file is written against a workflow runtime that provides `phase()`,
// `agent()`, `parallel()`, and `log()` as ambient functions (the same
// convention as Sortomate's original). If your setup's runtime differs,
// port the calls, not the prose in the prompts.

export const meta = {
  name: 'issue-triage-to-milestones',
  description: 'Holistic multi-lens triage of all open issues -> conflicts/overlaps/deps + milestone plan to <PLACEHOLDER: the project\'s next major goal, e.g. "beta">',
  whenToUse: 'When you want a panel of specialists to review the whole open-issue set and propose a milestone roadmap',
  phases: [
    { title: 'Gather', detail: 'one agent dumps every open issue (body+comments+milestone+column) into a faithful digest', model: 'sonnet' },
    { title: 'Lenses', detail: '<PLACEHOLDER: N> Opus reviewers each scan the SET through their lens for cross-issue findings', model: 'opus' },
    { title: 'Synthesis', detail: 'one Opus coordinator reviews, reconciles, and builds the milestone plan', model: 'opus' },
  ],
}

// --- schemas -------------------------------------------------------------
const ISSUE_DIGEST = {
  type: 'object',
  properties: {
    totalOpen: { type: 'integer' },
    issues: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          number: { type: 'integer' },
          title: { type: 'string' },
          milestone: { type: ['string', 'null'] },
          column: { type: 'string' },
          labels: { type: 'array', items: { type: 'string' } },
          summary: { type: 'string' },
          refs: { type: 'array', items: { type: 'integer' } },
        },
        required: ['number', 'title', 'summary'],
      },
    },
  },
  required: ['issues'],
}

const LENS_FINDINGS = {
  type: 'object',
  properties: {
    lens: { type: 'string' },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          kind: { enum: ['conflict', 'overlap', 'dependency', 'gap', 'split'] },
          issues: { type: 'array', items: { type: 'integer' } },
          summary: { type: 'string' },
          severity: { enum: ['high', 'medium', 'low'] },
          gating: { type: 'boolean' },
        },
        required: ['kind', 'summary'],
      },
    },
    gatingCandidates: { type: 'array', items: { type: 'integer' } },
    notes: { type: 'string' },
  },
  required: ['lens', 'findings'],
}

// --- lenses --------------------------------------------------------------
// Sortomate's original panel, generalized. Prune/extend/rename these for
// your own product; keep the shape (a fixed panel of independent,
// single-sentence-briefed reviewers, each scanning the WHOLE set rather than
// issue-by-issue). A product-philosophy lens is worth keeping even if your
// project has no formal manifesto doc — it's the lens that catches
// commodity feature-creep and quiet drift from what the product is supposed
// to be, which no other lens below is positioned to catch.
const LENSES = [
  { key: 'product-philosophy', brief: '<PLACEHOLDER: Product philosophy & principles — judge each issue against this project\'s stated positioning/differentiation/non-goals. FIRST locate and read any manifesto / philosophy / positioning doc in the repo. Flag issues that drift toward commodity feature-creep or contradict a stated principle.>' },
  { key: 'product-ux',      brief: 'Product / UX & daily-driver usability — friction that would stop the founder (or the target user) using the product every day' },
  { key: 'architecture',    brief: 'Architecture & data model — schema, migrations, framework/state-management design, coupling, tech debt' },
  { key: 'security-privacy',brief: 'Security, privacy, access control, auth, and any encryption/backup model' },
  { key: 'data-integrity',  brief: '<PLACEHOLDER: if the product is offline-first, multi-device, or sync-based: sync/offline/backup-restore correctness and data integrity. If not applicable to this project, replace this lens entirely.>' },
  { key: 'testing',         brief: 'Testing, verification, CI/CD, and any known test-infrastructure constraints (e.g. shared test accounts, flake sources)' },
  { key: 'sequencing',      brief: 'Scope, sequencing & dependencies — what must precede what, and which issues are too big for one milestone' },
  { key: 'gtm',             brief: '<PLACEHOLDER: Go-to-market, positioning & launch readiness — judge issues against this project\'s launch narrative and pricing/positioning. Flag GTM gaps (onboarding, landing page, docs, privacy & trust) and anything that weakens the positioning. Drop this lens if the project has no GTM motion yet.>' },
]

// --- phase 1: gather -----------------------------------------------------
phase('Gather')
const digest = await agent(
  'You are gathering the raw material for a holistic issue triage of the <PLACEHOLDER: project name> repo. Produce a faithful, structured digest of EVERY open issue.\n\n' +
  'Steps:\n' +
  '1. Read CLAUDE.md (especially any "Current state" and "Standing rules" sections) and the memory index, if one exists, so the digest respects settled strategic calls.\n' +
  '2. List all open issues with bodies: gh issue list --state open --limit <PLACEHOLDER: a limit comfortably above the real open-issue count> --json number,title,labels,milestone,body\n' +
  '3. Get each issue\'s board column: gh project item-list <PLACEHOLDER: project number> --owner <PLACEHOLDER: gh owner/org> --limit 1000 --format json  (item-list defaults to 30 items — an explicit --limit is REQUIRED or the view silently truncates.)\n' +
  '4. For issues with real discussion, read comments — the issue COMMENTS are part of the spec (see kit README practice 1): gh issue view <n> --comments\n' +
  '5. For each issue return: number, title, current milestone (or null), board column, labels, a faithful 1-3 sentence scope summary drawn from body+comments (NOT just the title), and refs = issue numbers it explicitly depends on / blocks / duplicates / references.\n\n' +
  'Be complete — every open issue must appear. Do not editorialize or trim controversial detail; downstream reviewers rely on this digest being faithful.',
  { label: 'gather-issues', phase: 'Gather', model: 'sonnet', schema: ISSUE_DIGEST }
)

if (!digest || !digest.issues || !digest.issues.length) {
  log('Gather returned no issues — aborting. Check gh auth and the project owner/number.')
  return { error: 'no issues gathered' }
}
log(`Gathered ${digest.issues.length} open issues. Fanning out ${LENSES.length} Opus lens reviewers.`)

// --- phase 2: lenses (barrier — synthesis needs ALL reports to reconcile) -
phase('Lenses')
const digestJson = JSON.stringify(digest.issues)
const reports = (await parallel(
  LENSES.map((l) => () =>
    agent(
      'You are the ' + l.brief + ' reviewer on a triage panel. You have the full open-issue digest below. Review the SET AS A WHOLE through your lens — do NOT summarize issues one by one.\n\n' +
      'Surface cross-issue findings, each tagged by kind:\n' +
      '- conflict: two issues contradict or would undo each other\n' +
      '- overlap: duplicate / should-merge / one should be closed\n' +
      '- dependency: X must land before Y (state the order)\n' +
      '- gap: work the set implies but no open issue covers\n' +
      '- split: an issue too big or mixed to sit in one milestone\n\n' +
      'For each finding give the issue #s, a crisp summary, a severity, and whether it is gating (blocks the current goal — see kit README practice 7 on exit-gate issues — e.g. daily-driver readiness, a launch bar, whatever this project\'s current phase gate is). Also return gatingCandidates: the issue #s that, through your lens, block that goal.\n\n' +
      'Respect the settled strategic calls in CLAUDE.md and any "don\'t relitigate" decision records (kit README practice 7) — only flag them if a NEW open issue genuinely conflicts. You may run "gh issue view <n> --comments" to drill into any issue before judging it.\n\n' +
      'DIGEST:\n' + digestJson,
      { label: 'lens:' + l.key, phase: 'Lenses', model: 'opus', schema: LENS_FINDINGS }
    )
  )
)).filter(Boolean)

log(`${reports.length}/${LENSES.length} lens reviewers returned. Coordinating synthesis (Opus).`)

// --- phase 3: synthesis (the coordinator: review + reconcile + roadmap) ---
phase('Synthesis')
const final = await agent(
  'You are the coordinating partner. ' + reports.length + ' specialist reviewers each returned cross-issue findings on the same open-issue set. Your job: review their work critically, reconcile it, and produce the roadmap.\n\n' +
  'Do all of:\n' +
  '1. REVIEW: drop weak or duplicate findings, merge ones that overlap across lenses, and where two lenses disagree, adjudicate and say why.\n' +
  '2. CROSS-CUTTING FINDINGS: a ranked list (most important first) of the real conflicts / overlaps / dependencies / gaps / splits, each citing issue #s and the lens(es) that raised it.\n' +
  '3. MILESTONE PLAN:\n' +
  '   - Milestone 1 = "<PLACEHOLDER: this project\'s current phase gate, e.g. \'Alpha daily-driver gate\' or \'Public beta readiness\'>": ONLY issues that block that specific goal. State the explicit bar you used to decide in vs. out, and be ruthless about scope.\n' +
  '   - Following milestones: group the remainder into a coherent sequence, each with a one-line theme and a rationale for its position (honor the dependencies found above). If this is a young project with a small open-issue count, prefer the simpler Now/Next/Later buckets from the kit README over named milestones — introduce formal milestone/phase structure only once issue volume genuinely calls for it (kit README anti-patterns section).\n' +
  '   - Present as a table: issue # | title | proposed milestone (or bucket), with the top gate clearly delimited.\n' +
  '4. DECISIONS & CONFIRMATIONS: a short list of the calls you made and anything you would want the founder to confirm.\n\n' +
  'Propose only — do NOT mutate milestones, labels, or the board.\n' +
  'Output clean GitHub-flavored markdown.\n\n' +
  'DIGEST: ' + JSON.stringify(digest.issues) + '\n\n' +
  'LENS REPORTS: ' + JSON.stringify(reports),
  { label: 'coordinator-synthesis', phase: 'Synthesis', model: 'opus', effort: 'high' }
)

return final

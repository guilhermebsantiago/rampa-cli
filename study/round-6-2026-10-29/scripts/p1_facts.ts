/**
 * P1 as facts (pre-registration, section 3, ablation 5): for every 2.4.4 candidate of each page's main snapshot, whether
 * the generic fact holds (`groundedLink('generic', facts)`, the fact a generic-text claim needs to be a finding) with the
 * candidate's facts as 0.1.2 builds them, and without P1 (the same facts with no `cardHeading` and no `menuToggle`). The
 * links where the two differ are those P1 takes the fact from; the main run's findings and suggestions on them are
 * listed with them. No model: without P1 the prompt (the card line) and the order under the cap change, so no verdict
 * without P1 is read.
 *
 * Run from the repository root (Node 24): node study/round-6-2026-10-29/scripts/p1_facts.ts
 * DATA: $RECORDINGS (default C:/Users/guilh/dev/rampa-study-recordings/round-6). Writes data/p1-facts.json; prints counts.
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Report } from '../../../src/core/types.ts'
import { resolveCriteria } from '../../../src/criteria/index.ts'
import { type LinkPurposeContext, groundedLink } from '../../../src/criteria/link-purpose.ts'
import { RULE_CHECKS, runRuleChecks } from '../../../src/rules/index.ts'
import { browserNamed } from '../../../src/snapshot/ax.ts'
import { loadRecorded } from '../../../src/surfaces/targets.ts'

const STUDY = 'study/round-6-2026-10-29'
const DATA = process.env.RECORDINGS ?? 'C:/Users/guilh/dev/rampa-study-recordings/round-6'
const meta = JSON.parse(readFileSync(`${STUDY}/data/pages-input.json`, 'utf8')) as { pages: Array<{ slug: string; split: string }> }
const [criterion] = resolveCriteria(['2.4.4'])
if (!criterion) throw new Error('2.4.4 is not a criterion')

const pages: Array<Record<string, unknown>> = []
const links: Array<Record<string, unknown>> = []
for (const { slug, split } of meta.pages) {
  const dir = join(DATA, 'pages', slug)
  const recording = join(dir, 'recording')
  const file = existsSync(recording) ? readdirSync(recording).find((name) => name.endsWith('.snapshot.json')) : undefined
  if (!file) {
    pages.push({ slug, split, snapshot: false })
    continue
  }
  const { snapshot, engine } = await loadRecorded(join(recording, file).replaceAll('\\', '/'), 'en')
  if (snapshot.document?.kind === 'xml' || snapshot.blocked !== undefined) {
    pages.push({ slug, split, snapshot: true, judged: false })
    continue
  }
  const view = criterion.names === 'browser' ? browserNamed(snapshot) : snapshot
  await criterion.prepare?.(view)
  const decided = runRuleChecks(snapshot, engine, 'en', RULE_CHECKS).decided.get(criterion.id)
  const candidates = criterion.candidates(view, engine).filter((candidate) => !decided?.has(candidate.ref))
  const report = existsSync(join(dir, 'report.json')) ? (JSON.parse(readFileSync(join(dir, 'report.json'), 'utf8')) as Report) : undefined
  const on = (list: ReadonlyArray<{ ref?: string | undefined; criterion?: string; ruleId?: string | undefined }>, ref: string) =>
    list.filter((x) => x.ref === ref && (x.criterion === '2.4.4' || x.ruleId === 'judgment/2.4.4')).length
  let withP1 = 0
  let withoutP1 = 0
  let differ = 0
  for (const candidate of candidates) {
    const facts = candidate.context as LinkPurposeContext
    const now = groundedLink('generic', facts)
    const before = groundedLink('generic', { ...facts, cardHeading: undefined, menuToggle: undefined })
    if (now) withP1++
    if (before) withoutP1++
    if (now === before) continue
    differ++
    links.push({
      slug,
      split,
      ref: candidate.ref,
      by: facts.cardHeading ? 'cardHeading' : 'menuToggle',
      groundedWithP1: now,
      groundedWithoutP1: before,
      mainFindings: report ? on([...report.findings, ...report.belowThreshold].filter((f) => f.source === 'judgment'), candidate.ref) : null,
      mainSuggestions: report ? on(report.needsReview ?? [], candidate.ref) : null,
    })
  }
  pages.push({ slug, split, snapshot: true, candidates: candidates.length, genericWithP1: withP1, genericWithoutP1: withoutP1, differ })
}
writeFileSync(`${STUDY}/data/p1-facts.json`, `${JSON.stringify({ about: 'P1 as facts: the 2.4.4 generic fact with and without cardHeading and menuToggle, on each main snapshot (scripts/p1_facts.ts).', pages, links }, null, 1)}\n`)
for (const split of ['dev', 'test']) {
  const of = links.filter((l) => l.split === split)
  const sum = (key: string) => pages.filter((p) => p.split === split).reduce((n, p) => n + (Number(p[key]) || 0), 0)
  console.log(
    `${split}: ${sum('candidates')} candidates; generic fact on ${sum('genericWithoutP1')} without P1, ${sum('genericWithP1')} with it; ${of.length} links differ ` +
      `(${of.filter((l) => l.by === 'cardHeading').length} by a card heading, ${of.filter((l) => l.by === 'menuToggle').length} by a toggle); ` +
      `main-run findings on them ${of.reduce((n, l) => n + (Number(l.mainFindings) || 0), 0)}, suggestions ${of.reduce((n, l) => n + (Number(l.mainSuggestions) || 0), 0)}`,
  )
}

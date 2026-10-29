/**
 * What P1 changes in the 2.4.4 judgments of the recorded pages, with no model: for every recorded snapshot of the second
 * to fifth real-page studies, the link candidates as `rampa check` builds them (browser names, rule-decided links left
 * out, the cap of 50 with its judge-first order), once as main has them (the card heading and the toggle taken out of
 * each candidate's facts) and once as this branch has them. Per page:
 * - judged: the candidates the cap sends to the model, before and after (P1 changes which links are judged first: a
 *   generic text the card heading completes is no longer a link a finding could be about);
 * - promptChanged: judged both times, with the new prompt line ("Heading of the card the link sits in"), so its cached
 *   answer is not reused;
 * - entered / left: judged only after / only before (entered ones have no cached answer either);
 * - ungrounded: candidates whose `generic` fact holds before and not after, by the card heading or by the toggle.
 * The new model calls a replay needs for 2.4.4 are promptChanged + entered.
 *
 * The fifth study's test half is counted only: its rows carry no link text.
 *
 * It reads this branch's link-purpose.ts (P1); main's behaviour is the same candidates with the two new facts taken out.
 * Run from the repository root: node study/notes-precision-p1p2/prompts.ts > study/notes-precision-p1p2/data/prompts.md
 * Writes study/notes-precision-p1p2/data/prompts.json and prints a table.
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { DEFAULT_MAX_CANDIDATES, capCandidates } from '../../src/core/check.ts'
import type { Candidate, EngineResults } from '../../src/core/types.ts'
import { emptyEngine } from '../../src/engine/axe.ts'
import { addressText } from '../../src/criteria/generic-text.ts'
import { type LinkPurposeContext, groundedLink, linkPurpose } from '../../src/criteria/link-purpose.ts'
import { runRuleChecks } from '../../src/rules/index.ts'
import { browserNamed } from '../../src/snapshot/ax.ts'
import { loadEngineFor, loadSnapshot } from '../../src/surfaces/targets.ts'

const RECORDINGS = process.env.RECORDINGS ?? 'C:/Users/guilh/dev/rampa-study-recordings'
const STUDIES = [
  { study: 's2', folder: 'fresh-2026-10-11', input: 'fresh-2026-10-11' },
  { study: 's3', folder: 'round-3-2026-10-23', input: 'round-3-2026-10-23' },
  { study: 's4', folder: 'round-4-2026-10-24', input: 'round-4-2026-10-24' },
  { study: 's5', folder: 'round-5', input: 'round-5-2026-10-28' },
] as const

/** A candidate's facts as main has them: no card heading, no toggle. */
const asMain = (c: LinkPurposeContext): LinkPurposeContext => {
  const { cardHeading: _card, menuToggle: _toggle, ...rest } = c
  return rest
}
/** main's judge-first rule (`groundable` in link-purpose.ts), on main's facts. */
const groundableMain = (c: LinkPurposeContext) =>
  groundedLink('generic', asMain(c)) || addressText(c.name) || groundedLink('ambiguous', asMain(c)) || groundedLink('mismatch', asMain(c))

interface Row {
  study: string
  split: string
  slug: string
  candidates: number
  judgedBefore: number
  judgedAfter: number
  promptChanged: number
  entered: number
  left: number
  ungroundedByCard: number
  ungroundedByToggle: number
  newCalls: number
  /** The links whose generic fact P1 takes away, for pages outside the fifth study's test half. */
  links?: Array<{ ref: string; name: string; by: 'card' | 'toggle'; judgedBefore: boolean; judgedAfter: boolean; cardHeading?: string | undefined }>
}

const rows: Row[] = []
for (const { study, folder, input } of STUDIES) {
  const pages = (JSON.parse(readFileSync(join('study', input, 'data', 'pages-input.json'), 'utf8')) as { pages: Array<{ slug: string; split: string }> }).pages
  for (const { slug, split } of pages) {
    const recording = join(RECORDINGS, folder, 'pages', slug, 'recording')
    if (!existsSync(recording)) continue
    const file = readdirSync(recording).find((name) => name.endsWith('.snapshot.json'))
    if (!file) continue
    const path = join(recording, file)
    const snapshot = browserNamed(await loadSnapshot(path))
    const engine: EngineResults = (await loadEngineFor(path)) ?? emptyEngine()
    const decided = runRuleChecks(snapshot, engine, 'en').decided.get('2.4.4')
    const candidates = linkPurpose.candidates(snapshot, engine).filter((candidate) => !decided?.has(candidate.ref))
    const before = new Set<Candidate<LinkPurposeContext>>(
      capCandidates({ ...linkPurpose, judgeFirst: (candidate: Candidate<LinkPurposeContext>) => groundableMain(candidate.context) } as never, snapshot, candidates, DEFAULT_MAX_CANDIDATES),
    )
    const after = new Set<Candidate<LinkPurposeContext>>(capCandidates(linkPurpose as never, snapshot, candidates, DEFAULT_MAX_CANDIDATES))
    const row: Row = { study, split, slug, candidates: candidates.length, judgedBefore: before.size, judgedAfter: after.size, promptChanged: 0, entered: 0, left: 0, ungroundedByCard: 0, ungroundedByToggle: 0, newCalls: 0 }
    const links: NonNullable<Row['links']> = []
    for (const candidate of candidates) {
      const c = candidate.context
      const wasJudged = before.has(candidate)
      const isJudged = after.has(candidate)
      if (wasJudged && isJudged && c.cardHeading) row.promptChanged++
      if (isJudged && !wasJudged) row.entered++
      if (wasJudged && !isJudged) row.left++
      if (groundedLink('generic', asMain(c)) && !groundedLink('generic', c)) {
        const by = c.cardHeading ? 'card' : 'toggle'
        if (by === 'card') row.ungroundedByCard++
        else row.ungroundedByToggle++
        links.push({ ref: candidate.ref, name: c.name.slice(0, 60), by, judgedBefore: wasJudged, judgedAfter: isJudged, ...(c.cardHeading ? { cardHeading: c.cardHeading.slice(0, 80) } : {}) })
      }
    }
    row.newCalls = row.promptChanged + row.entered
    if (!(study === 's5' && split === 'test') && links.length > 0) row.links = links
    rows.push(row)
  }
}

writeFileSync('study/notes-precision-p1p2/data/prompts.json', `${JSON.stringify({ cap: DEFAULT_MAX_CANDIDATES, rows }, null, 1)}\n`)
const sum = (selected: Row[], key: keyof Row) => selected.reduce((total, row) => total + (row[key] as number), 0)
const keys = ['candidates', 'judgedBefore', 'judgedAfter', 'promptChanged', 'entered', 'left', 'ungroundedByCard', 'ungroundedByToggle', 'newCalls'] as const
console.log(`| set | pages | ${keys.join(' | ')} |`)
console.log(`| --- | ---: | ${keys.map(() => '---:').join(' | ')} |`)
for (const [name, selected] of [
  ['s2', rows.filter((r) => r.study === 's2')],
  ['s3', rows.filter((r) => r.study === 's3')],
  ['s4', rows.filter((r) => r.study === 's4')],
  ['s5 dev', rows.filter((r) => r.study === 's5' && r.split === 'dev')],
  ['s5 test (counts)', rows.filter((r) => r.study === 's5' && r.split === 'test')],
] as const) {
  console.log(`| ${name} | ${selected.length} | ${keys.map((key) => sum(selected as Row[], key)).join(' | ')} |`)
}
console.log('\nPages where the judged set or a prompt changes (fifth study test half by count only):')
for (const row of rows) {
  if (row.newCalls === 0 && row.left === 0 && row.ungroundedByCard + row.ungroundedByToggle === 0) continue
  const name = row.study === 's5' && row.split === 'test' ? `${row.study} test page` : `${row.study} ${row.split} ${row.slug}`
  console.log(`- ${name}: ${row.candidates} candidates, judged ${row.judgedBefore} -> ${row.judgedAfter}, prompt changed ${row.promptChanged}, entered ${row.entered}, left ${row.left}, ungrounded ${row.ungroundedByCard} by card + ${row.ungroundedByToggle} by toggle`)
  for (const link of row.links ?? []) console.log(`    ${link.by} ${JSON.stringify(link.name)} judged ${link.judgedBefore ? 'y' : 'n'}->${link.judgedAfter ? 'y' : 'n'}${link.cardHeading ? ` under ${JSON.stringify(link.cardHeading)}` : ''}`)
}

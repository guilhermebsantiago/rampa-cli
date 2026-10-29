/**
 * What P3, P4 and the card-heading refinement change in the inputs of the recorded pages, with no model: for every
 * recorded snapshot of the second to fifth real-page studies,
 * - 2.4.4: the link candidates as `rampa check` builds them (browser names, rule-decided links left out, the cap of 50
 *   with its judge-first order), once with main's facts and once with this branch's. main's facts are the branch's with
 *   (a) the card heading read as main read it, a heading on the generic lists included (`oldCardHeading`, main's
 *   `cardHeadingOf`), and (b) the shared-text fact without `namesOwnDestination`. Per page: the judged sets before and
 *   after, the links whose prompt changes (the card line comes or goes), entered and left, the links P4 takes the
 *   shared-text fact from, and the ones the refinement gives the generic fact back to;
 * - 1.1.1: the images that are all their link to a social network holds and whose alternative names the network
 *   (`namesNetworkOfLink`; not a file name, a placeholder or a generic word), the only images P3 can move, and only a
 *   reading claim on them. P3 changes no prompt and no judge-first order.
 * The new model calls a replay needs for 2.4.4 are promptChanged + entered; P3 asks none and saves the second pass on
 * the claims it holds back.
 *
 * The fifth study's test half is counted only: its rows carry no text and no alternative.
 *
 * Run from the repository root: node study/notes-precision-p3p4/facts.ts > study/notes-precision-p3p4/data/facts.md
 * Writes study/notes-precision-p3p4/data/facts.json and prints a table.
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { DEFAULT_MAX_CANDIDATES, capCandidates } from '../../src/core/check.ts'
import type { Candidate, EngineResults } from '../../src/core/types.ts'
import { emptyEngine } from '../../src/engine/axe.ts'
import { addressText, genericLinkText } from '../../src/criteria/generic-text.ts'
import { type LinkPurposeContext, genericCardHeading, groundedLink, linkPurpose, namesOwnDestination } from '../../src/criteria/link-purpose.ts'
import { isGenericAlt, looksLikePlaceholder, namesNetworkOfLink, nonTextContent } from '../../src/criteria/non-text-content.ts'
import { isHidden, subtreeText } from '../../src/criteria/shared.ts'
import { runRuleChecks } from '../../src/rules/index.ts'
import { browserNamed } from '../../src/snapshot/ax.ts'
import type { A11yNode } from '../../src/snapshot/schema.ts'
import { type TreeIndex, indexTree, walkTree } from '../../src/snapshot/tree.ts'
import { loadEngineFor, loadSnapshot } from '../../src/surfaces/targets.ts'
import { normalizeForMatch } from '../../src/core/util.ts'

const RECORDINGS = process.env.RECORDINGS ?? 'C:/Users/guilh/dev/rampa-study-recordings'
const STUDIES = [
  { study: 's2', folder: 'fresh-2026-10-11', input: 'fresh-2026-10-11' },
  { study: 's3', folder: 'round-3-2026-10-23', input: 'round-3-2026-10-23' },
  { study: 's4', folder: 'round-4-2026-10-24', input: 'round-4-2026-10-24' },
  { study: 's5', folder: 'round-5', input: 'round-5-2026-10-28' },
] as const

/** main's `cardHeadingOf` (a82558e): the same rule without the generic-heading check. */
function oldCardHeading(index: TreeIndex, node: A11yNode, heading: A11yNode | undefined): string | undefined {
  if (!heading?.name) return undefined
  const aroundHeading = new Set<string>()
  for (let ref = index.get(heading.ref)?.parentRef; ref !== undefined; ref = index.get(ref)?.parentRef) aroundHeading.add(ref)
  let ref = index.get(node.ref)?.parentRef
  for (let depth = 1; ref !== undefined && depth <= 2; depth++) {
    if (aroundHeading.has(ref)) {
      const card = index.get(ref)?.node
      return card && subtreeText(card).length <= 300 ? heading.name : undefined
    }
    ref = index.get(ref)?.parentRef
  }
  return undefined
}

/** The round-5 notes' `altNamesHost`: a word is a network's name, or within 2 edits of a label of any host. */
const NOTES_SOCIAL = new Set(['facebook', 'instagram', 'x', 'twitter', 'youtube', 'linkedin', 'tiktok', 'whatsapp', 'telegram', 'flickr', 'pinterest', 'threads', 'bluesky', 'spotify'])
function edits(a: string, b: string): number {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array<number>(b.length).fill(0)])
  for (let j = 1; j <= b.length; j++) dp[0]![j] = j
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) dp[i]![j] = Math.min(dp[i - 1]![j]! + 1, dp[i]![j - 1]! + 1, dp[i - 1]![j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1))
  return dp[a.length]![b.length]!
}
function notesRule(alt: string, href: string | undefined, base: string): boolean {
  const words = normalizeForMatch(alt).split(/[^a-z0-9]+/).filter(Boolean)
  if (words.some((w) => NOTES_SOCIAL.has(w))) return true
  try {
    const labels = new URL(href ?? '', base).hostname.split('.').filter((l) => l.length >= 4 && l !== 'www')
    return labels.some((label) => words.some((w) => w.length >= 4 && edits(w, label) <= 2))
  } catch {
    return false
  }
}
/** A link to a host of the networks `namesNetworkOfLink` reads (SERVICES in non-text-content.ts). */
const NETWORK_HOSTS = ['facebook.com', 'fb.com', 'fb.me', 'instagram.com', 'x.com', 'twitter.com', 'youtube.com', 'youtu.be', 'tiktok.com', 'linkedin.com', 'pinterest.com', 'pin.it', 'whatsapp.com', 'wa.me', 'telegram.org', 'telegram.me', 't.me', 'threads.net', 'threads.com', 'bsky.app', 'reddit.com', 'tumblr.com', 'flickr.com', 'vimeo.com', 'spotify.com', 'soundcloud.com', 'github.com', 'discord.com', 'discord.gg', 'twitch.tv', 'snapchat.com']
function onNetwork(href: string | undefined, base: string): boolean {
  try {
    const host = new URL(href ?? '', base).hostname.toLowerCase()
    return NETWORK_HOSTS.some((domain) => host === domain || host.endsWith(`.${domain}`))
  } catch {
    return false
  }
}

const sharedFact = (c: LinkPurposeContext) => Boolean(c.sameText && c.sameText.places > 1 && !c.sameText.apart)

interface Link {
  ref: string
  name: string
  judgedBefore: boolean
  judgedAfter: boolean
  title?: string | undefined
  heading?: string | undefined
  cardHeading?: string | undefined
}
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
  p4: number
  p1: number
  newCalls: number
  images: number
  p3: number
  /** Images the round-5 notes' wider rule reaches, and of them those whose link leads to no network's host. */
  p3Notes: number
  p3NotesOffNetwork: number
  /** Refs only, so that analyze.py can join them with the reports; text only outside the fifth study's test half. */
  p4Links: Link[]
  p1Links: Link[]
  p3Images: Array<{ ref: string; alt?: string; href?: string }>
  enteredRefs: string[]
  leftRefs: string[]
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
    const raw = await loadSnapshot(path)
    const engine: EngineResults = (await loadEngineFor(path)) ?? emptyEngine()
    const counted = study === 's5' && split === 'test'
    const row: Row = { study, split, slug, candidates: 0, judgedBefore: 0, judgedAfter: 0, promptChanged: 0, entered: 0, left: 0, p4: 0, p1: 0, newCalls: 0, images: 0, p3: 0, p3Notes: 0, p3NotesOffNetwork: 0, p4Links: [], p1Links: [], p3Images: [], enteredRefs: [], leftRefs: [] }

    // 2.4.4, on the browser's names.
    const snapshot = browserNamed(raw)
    const index = indexTree(snapshot.root)
    const nearest = new Map<string, A11yNode>()
    let heading: A11yNode | undefined
    for (const node of walkTree(snapshot.root)) {
      if (node.role === 'heading' && node.name && !isHidden(node)) heading = node
      if (node.role === 'link' && heading) nearest.set(node.ref, heading)
    }
    const decided = runRuleChecks(snapshot, engine, 'en').decided.get('2.4.4')
    const candidates = linkPurpose.candidates(snapshot, engine).filter((candidate) => !decided?.has(candidate.ref))
    const mainFacts = new Map<Candidate<LinkPurposeContext>, LinkPurposeContext>()
    for (const candidate of candidates) {
      const c = candidate.context
      const node = index.get(candidate.ref)?.node
      const card = c.cardHeading ?? (node && genericLinkText(c.name) ? oldCardHeading(index, node, nearest.get(candidate.ref)) : undefined)
      const { cardHeading: _card, ...rest } = c
      mainFacts.set(candidate, card ? { ...rest, cardHeading: card } : rest)
    }
    const mainGroundable = (candidate: Candidate<LinkPurposeContext>) => {
      const c = mainFacts.get(candidate)!
      return groundedLink('generic', c) || addressText(c.name) || sharedFact(c) || groundedLink('mismatch', c)
    }
    const before = new Set(capCandidates({ ...linkPurpose, judgeFirst: mainGroundable } as never, snapshot, candidates, DEFAULT_MAX_CANDIDATES))
    const after = new Set(capCandidates(linkPurpose as never, snapshot, candidates, DEFAULT_MAX_CANDIDATES))
    row.candidates = candidates.length
    row.judgedBefore = before.size
    row.judgedAfter = after.size
    for (const candidate of candidates) {
      const c = candidate.context
      const m = mainFacts.get(candidate)!
      const wasJudged = before.has(candidate)
      const isJudged = after.has(candidate)
      if (wasJudged && isJudged && m.cardHeading !== c.cardHeading) row.promptChanged++
      if (isJudged && !wasJudged) {
        row.entered++
        row.enteredRefs.push(candidate.ref)
      }
      if (wasJudged && !isJudged) {
        row.left++
        row.leftRefs.push(candidate.ref)
      }
      const shown = (link: Link): Link => (counted ? { ref: link.ref, name: '', judgedBefore: link.judgedBefore, judgedAfter: link.judgedAfter } : link)
      if (sharedFact(m) && !groundedLink('ambiguous', c)) {
        row.p4++
        row.p4Links.push(shown({ ref: candidate.ref, name: c.name, judgedBefore: wasJudged, judgedAfter: isJudged, title: c.destination?.title, heading: c.destination?.heading }))
      }
      if (!groundedLink('generic', m) && groundedLink('generic', c)) {
        row.p1++
        row.p1Links.push(shown({ ref: candidate.ref, name: c.name, judgedBefore: wasJudged, judgedAfter: isJudged, cardHeading: m.cardHeading }))
      }
      // A sanity check of the emulation: the refinement only ever takes a heading on the generic lists away.
      if (m.cardHeading !== c.cardHeading && !(m.cardHeading && !c.cardHeading && genericCardHeading(m.cardHeading))) throw new Error(`${slug} ${candidate.ref}: card heading differs otherwise`)
      if (namesOwnDestination(c) !== (sharedFact(m) && !groundedLink('ambiguous', c)) && sharedFact(m)) throw new Error(`${slug} ${candidate.ref}: P4 emulation`)
    }
    row.newCalls = row.promptChanged + row.entered

    // 1.1.1, on the collector's names.
    for (const candidate of nonTextContent.candidates(raw, engine)) {
      const c = candidate.context
      if (c.hidden) continue
      row.images++
      // A file name, a placeholder or a generic word keeps its claim whatever the link (`groundedImage`).
      if (c.functional && !looksLikePlaceholder(c.alt, c.src) && !isGenericAlt(c.alt) && namesNetworkOfLink(c.alt, c.functional, raw)) {
        row.p3++
        row.p3Images.push(counted ? { ref: candidate.ref } : { ref: candidate.ref, alt: c.alt, href: c.functional.href })
      }
      // The round-5 notes' wider `altNamesHost` (study/notes-precision-round5/image-facts.ts), for its reach only.
      if (c.functional?.control === 'link' && notesRule(c.alt, c.functional.href, raw.target)) {
        row.p3Notes++
        if (!onNetwork(c.functional.href, raw.target)) row.p3NotesOffNetwork++
      }
    }
    rows.push(row)
  }
}

writeFileSync('study/notes-precision-p3p4/data/facts.json', `${JSON.stringify({ cap: DEFAULT_MAX_CANDIDATES, rows }, null, 1)}\n`)
const sum = (selected: Row[], key: keyof Row) => selected.reduce((total, row) => total + (row[key] as number), 0)
const keys = ['candidates', 'judgedBefore', 'judgedAfter', 'promptChanged', 'entered', 'left', 'p4', 'p1', 'newCalls', 'images', 'p3', 'p3Notes', 'p3NotesOffNetwork'] as const
console.log('2.4.4 link candidates and 1.1.1 images on the recorded pages: what the branch changes in their inputs, before any model.\n')
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
console.log(
  "\np4: shared-text candidates whose destination was read with their text in its title or main heading (the fact P4 takes away); p1: generic links whose only card heading is on the generic lists (the fact the refinement gives back); p3: images that are all their link to a social network holds, with the network named; p3Notes: images that are all their link holds that the round-5 notes' wider altNamesHost reaches, and p3NotesOffNetwork those of them whose link leads to no network's host.\n",
)
console.log('Pages with a change (fifth study test half by count only):')
for (const row of rows) {
  if (row.newCalls + row.left + row.p4 + row.p1 + row.p3 === 0) continue
  if (row.study === 's5' && row.split === 'test') {
    console.log(`- s5 test page: judged ${row.judgedBefore} -> ${row.judgedAfter}, prompt changed ${row.promptChanged}, entered ${row.entered}, left ${row.left}, p4 ${row.p4}, p1 ${row.p1}, p3 ${row.p3}`)
    continue
  }
  console.log(`- ${row.study} ${row.split} ${row.slug}: ${row.candidates} candidates, judged ${row.judgedBefore} -> ${row.judgedAfter}, prompt changed ${row.promptChanged}, entered ${row.entered}, left ${row.left}, p4 ${row.p4}, p1 ${row.p1}, p3 ${row.p3}`)
  for (const link of row.p4Links) console.log(`    p4 ${JSON.stringify(link.name)} judged ${link.judgedBefore ? 'y' : 'n'}->${link.judgedAfter ? 'y' : 'n'}; read: ${JSON.stringify(link.title ?? '')} / ${JSON.stringify(link.heading ?? '')}`)
  for (const link of row.p1Links) console.log(`    p1 ${JSON.stringify(link.name)} judged ${link.judgedBefore ? 'y' : 'n'}->${link.judgedAfter ? 'y' : 'n'} under ${JSON.stringify(link.cardHeading)}`)
  for (const image of row.p3Images) console.log(`    p3 ${JSON.stringify(image.alt)} -> ${image.href}`)
}

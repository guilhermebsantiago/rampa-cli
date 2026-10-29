/**
 * Candidate facts for 2.4.4 claims, replayed on the recorded snapshots of the second to fifth real-page studies with no
 * model: for every link candidate whose text is generic, or that the shared-text fact grounds, the facts a future rule
 * could read, so that Python (analyze.py) can join them with the studies' labels and count what each rule would move.
 *
 * Facts per link:
 * - cardHeading: the nearest preceding heading (DOM order), the depth of its lowest common ancestor with the link, the
 *   text length of that ancestor, whether the ancestor holds a paragraph, and the heading's own text;
 * - siblingSame: the smallest ancestor depth at which another link leads to the same address with a non-generic name;
 * - namesDestination: the destination's title or heading, where Rampa read it, contains the link's text;
 * - menuToggle: an href of "#" (or none) and a list right after the link in its own list item.
 *
 * Run from the repository root: node study/notes-precision-round5/link-facts.ts [r5test]
 * Writes study/notes-precision-round5/data/link-facts.json. The fifth study's test half is written only with r5test,
 * to a separate file, and is counted, never read.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { browserNamed } from '../../src/snapshot/ax.ts'
import { emptyEngine } from '../../src/engine/axe.ts'
import { loadEngineFor, loadSnapshot } from '../../src/surfaces/targets.ts'
import type { A11yNode, A11ySnapshot } from '../../src/snapshot/schema.ts'
import type { EngineResults } from '../../src/core/types.ts'
import { indexTree, walkTree } from '../../src/snapshot/tree.ts'
import { attributesOf, isHidden, subtreeText } from '../../src/criteria/shared.ts'
import { normalizeForMatch } from '../../src/core/util.ts'
import { genericLinkText } from '../../src/criteria/generic-text.ts'
import { groundedLink, linkPurpose } from '../../src/criteria/link-purpose.ts'

const RECORDINGS = process.env.RECORDINGS ?? 'C:/Users/guilh/dev/rampa-study-recordings'
const r5test = process.argv.includes('r5test')
const r5pages = JSON.parse(readFileSync('study/round-5-2026-10-28/data/pages-input.json', 'utf8')) as { pages: Array<{ slug: string; split: string }> }
const r5split = new Map(r5pages.pages.map((p) => [p.slug, p.split]))

const STUDIES = [
  { study: 's2', folder: 'fresh-2026-10-11' },
  { study: 's3', folder: 'round-3-2026-10-23' },
  { study: 's4', folder: 'round-4-2026-10-24' },
  { study: 's5', folder: 'round-5' },
] as const

const TRACKING = /^(utm_\w+|fbclid|gclid|dclid|msclkid|mc_cid|mc_eid)$/i
function placeOf(href: string | undefined, base: string): string | undefined {
  const raw = href?.trim() ?? ''
  if (raw === '' || raw === '#' || /^javascript:/i.test(raw)) return undefined
  try {
    const url = new URL(raw, base)
    url.hash = ''
    for (const name of [...url.searchParams.keys()]) if (TRACKING.test(name)) url.searchParams.delete(name)
    url.pathname = url.pathname.replace(/\/index\.html?$/i, '/').replace(/(.)\/+$/, '$1')
    return url.href
  } catch {
    return raw
  }
}

interface Row {
  study: string
  split: string
  slug: string
  ref: string
  name: string
  generic: boolean
  groundedGeneric: boolean
  groundedShared: boolean
  hasContext: boolean
  heading: string | undefined
  cardHeading: { depth: number; textLength: number; paragraph: boolean; links: number; text: string } | undefined
  siblingSame: { depth: number; name: string } | undefined
  namesDestination: boolean
  destinationRead: boolean
  menuToggle: boolean
}

const rows: Row[] = []
const pages: Array<{ study: string; slug: string; split: string; candidates: number; groundedGeneric: number; groundedShared: number }> = []

for (const { study, folder } of STUDIES) {
  const dir = join(RECORDINGS, folder, 'pages')
  for (const slug of readdirSync(dir).sort()) {
    const split = study === 's5' ? r5split.get(slug) ?? 'unknown' : 'all'
    if (study === 's5' && (split === 'test') !== r5test) continue
    const recording = join(dir, slug, 'recording')
    if (!existsSync(recording)) continue
    const file = readdirSync(recording).find((name) => name.endsWith('.snapshot.json'))
    if (!file) continue
    const path = join(recording, file)
    const snapshot: A11ySnapshot = browserNamed(await loadSnapshot(path))
    const engine: EngineResults = (await loadEngineFor(path)) ?? emptyEngine()
    const index = indexTree(snapshot.root)
    let base: string
    try {
      base = new URL(snapshot.target).href
    } catch {
      base = 'file:///page'
    }
    // DOM order: the nearest preceding heading of every node.
    const precedingHeading = new Map<string, A11yNode>()
    const parentOf = (ref: string) => index.get(ref)?.parentRef
    const ancestors = (node: A11yNode): A11yNode[] => {
      const out: A11yNode[] = []
      for (let ref = parentOf(node.ref); ref !== undefined; ref = parentOf(ref)) {
        const entry = index.get(ref)
        if (!entry) break
        out.push(entry.node)
      }
      return out
    }
    let lastHeading: A11yNode | undefined
    const linkPlaces = new Map<string, string | undefined>()
    for (const node of walkTree(snapshot.root)) {
      if (node.role === 'heading' && node.name && !isHidden(node)) lastHeading = node
      if (node.role === 'link' && !isHidden(node)) {
        if (lastHeading) precedingHeading.set(node.ref, lastHeading)
        linkPlaces.set(node.ref, placeOf(attributesOf(node).href, base))
      }
    }
    const linksUnder = (node: A11yNode): A11yNode[] => [...walkTree(node)].filter((n) => n.role === 'link' && !isHidden(n))
    const hasParagraph = (node: A11yNode): boolean => [...walkTree(node)].some((n) => n.role === 'paragraph')

    const candidates = linkPurpose.candidates(snapshot, engine)
    let groundedGeneric = 0
    let groundedShared = 0
    for (const candidate of candidates) {
      const c = candidate.context
      const node = index.get(candidate.ref)?.node
      if (!node) continue
      const generic = genericLinkText(c.name)
      const gGeneric = groundedLink('generic', c)
      const gShared = groundedLink('ambiguous', c)
      if (gGeneric) groundedGeneric++
      if (gShared) groundedShared++
      if (!generic && !gShared) continue
      const chain = ancestors(node)
      const heading = precedingHeading.get(node.ref)
      let cardHeading: Row['cardHeading']
      if (heading) {
        const headingChain = new Set(ancestors(heading).map((n) => n.ref))
        const at = chain.findIndex((n) => headingChain.has(n.ref))
        if (at >= 0) {
          const lca = chain[at]!
          cardHeading = { depth: at + 1, textLength: subtreeText(lca).length, paragraph: hasParagraph(lca), links: linksUnder(lca).length, text: heading.name!.slice(0, 80) }
        }
      }
      let siblingSame: Row['siblingSame']
      const myPlace = linkPlaces.get(node.ref)
      if (myPlace) {
        for (let depth = 1; depth <= chain.length && depth <= 8; depth++) {
          const other = linksUnder(chain[depth - 1]!).find((l) => l.ref !== node.ref && linkPlaces.get(l.ref) === myPlace && (l.name ?? '').trim() !== '' && !genericLinkText(l.name!.trim()))
          if (other) {
            siblingSame = { depth, name: other.name!.trim().slice(0, 80) }
            break
          }
        }
      }
      const destination = c.destination
      const destinationText = destination ? normalizeForMatch([destination.title, destination.heading].filter(Boolean).join(' ')) : ''
      const namesDestination = destinationText !== '' && normalizeForMatch(c.name).length >= 3 && destinationText.includes(normalizeForMatch(c.name))
      const href = attributesOf(node).href?.trim() ?? ''
      const item = chain.find((n) => n.role === 'listitem')
      let menuToggle = false
      if ((href === '' || href === '#' || /^javascript:/i.test(href)) && item) {
        const kids = item.children
        const at = kids.findIndex((k) => k.ref === node.ref || [...walkTree(k)].some((n) => n.ref === node.ref))
        menuToggle = at >= 0 && kids.slice(at + 1).some((k) => k.role === 'list' || [...walkTree(k)].some((n) => n.role === 'list'))
      }
      rows.push({
        study,
        split,
        slug,
        ref: candidate.ref,
        name: c.name.slice(0, 80),
        generic,
        groundedGeneric: gGeneric,
        groundedShared: gShared,
        hasContext: Boolean(c.context),
        heading: c.heading?.slice(0, 80),
        cardHeading,
        siblingSame,
        namesDestination,
        destinationRead: Boolean(destination),
        menuToggle,
      })
    }
    pages.push({ study, slug, split, candidates: candidates.length, groundedGeneric, groundedShared })
    console.error(`${study} ${slug}: ${candidates.length} candidates, ${groundedGeneric} grounded generic, ${groundedShared} grounded shared`)
  }
}

mkdirSync('study/notes-precision-round5/data', { recursive: true })
const out = r5test ? 'study/notes-precision-round5/data/link-facts-r5test.json' : 'study/notes-precision-round5/data/link-facts.json'
writeFileSync(out, `${JSON.stringify({ rows, pages }, null, 1)}\n`)
console.error(`wrote ${out}: ${rows.length} rows, ${pages.length} pages`)

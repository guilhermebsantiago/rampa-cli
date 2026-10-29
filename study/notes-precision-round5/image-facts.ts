/**
 * Facts about the images behind the 1.1.1 reading claims the second pass confirmed (confirm_groups.py's
 * data/confirm-claims.json), read from the recorded snapshots with no model, to see whether a deterministic check could
 * tell the confirmed false positives from the true ones:
 * - altInNearby: the alternative text (normalised) occurs in the text of a heading, caption, paragraph or link of the
 *   image's own card (an ancestor at most 3 levels up, text at most 600 characters), outside the image itself;
 * - altNamesHost: a word of the alternative is within edit distance 2 of a label of the hostname the image's link leads to
 *   ("istagram" and instagram.com), or equals a well-known social network's name;
 * - linkHasText: the image sits in a link that also has visible text (the image is not all the link holds).
 *
 * Run from the repository root: node study/notes-precision-round5/image-facts.ts
 * Writes study/notes-precision-round5/data/image-facts.json and prints counts by label.
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { browserNamed } from '../../src/snapshot/ax.ts'
import { loadSnapshot } from '../../src/surfaces/targets.ts'
import type { A11yNode, A11ySnapshot } from '../../src/snapshot/schema.ts'
import { indexTree, walkTree } from '../../src/snapshot/tree.ts'
import { attributesOf, subtreeText } from '../../src/criteria/shared.ts'
import { normalizeForMatch } from '../../src/core/util.ts'

const RECORDINGS = process.env.RECORDINGS ?? 'C:/Users/guilh/dev/rampa-study-recordings'
const FOLDERS: Record<string, string> = { s2: 'fresh-2026-10-11', s3: 'round-3-2026-10-23', s4: 'round-4-2026-10-24', s5: 'round-5' }

interface Claim {
  study: string
  slug: string
  ref: string
  alt: string
  final: string
  confirmed: boolean
  min: number
}
const claims = JSON.parse(readFileSync('study/notes-precision-round5/data/confirm-claims.json', 'utf8')) as Claim[]

function editDistance(a: string, b: string): number {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)] as number[])
  for (let j = 1; j <= b.length; j++) dp[0]![j] = j
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      dp[i]![j] = Math.min(dp[i - 1]![j]! + 1, dp[i]![j - 1]! + 1, dp[i - 1]![j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1))
  return dp[a.length]![b.length]!
}

const SOCIAL = new Set(['facebook', 'instagram', 'x', 'twitter', 'youtube', 'linkedin', 'tiktok', 'whatsapp', 'telegram', 'flickr', 'pinterest', 'threads', 'bluesky', 'spotify'])

const out: Array<Claim & { found: boolean; altInNearby: boolean; nearbyDepth: number | undefined; altNamesHost: boolean; linkHasText: boolean; inLink: boolean }> = []
const cache = new Map<string, { snapshot: A11ySnapshot; index: ReturnType<typeof indexTree> }>()
for (const claim of claims) {
  if (!claim.confirmed) continue
  const key = `${claim.study}/${claim.slug}`
  let page = cache.get(key)
  if (!page) {
    const recording = join(RECORDINGS, FOLDERS[claim.study]!, 'pages', claim.slug, 'recording')
    const file = existsSync(recording) ? readdirSync(recording).find((name) => name.endsWith('.snapshot.json')) : undefined
    if (!file) {
      out.push({ ...claim, found: false, altInNearby: false, nearbyDepth: undefined, altNamesHost: false, linkHasText: false, inLink: false })
      continue
    }
    const snapshot = browserNamed(await loadSnapshot(join(recording, file)))
    page = { snapshot, index: indexTree(snapshot.root) }
    cache.set(key, page)
  }
  const { index } = page
  const node = index.get(claim.ref)?.node
  if (!node) {
    out.push({ ...claim, found: false, altInNearby: false, nearbyDepth: undefined, altNamesHost: false, linkHasText: false, inLink: false })
    continue
  }
  const alt = normalizeForMatch(claim.alt)
  const chain: A11yNode[] = []
  for (let ref = index.get(node.ref)?.parentRef; ref !== undefined; ref = index.get(ref)?.parentRef) {
    const entry = index.get(ref)
    if (!entry) break
    chain.push(entry.node)
  }
  const textWithout = (root: A11yNode): string =>
    [...walkTree(root)]
      .filter((n) => n.ref !== node.ref && n.role !== 'img' && (n.role === 'heading' || n.role === 'link' || n.role === 'paragraph' || n.role === 'caption' || n.role === 'figure' || n.text))
      .map((n) => (n.text ?? '') + ' ' + (n.role === 'heading' || n.role === 'link' ? n.name ?? '' : ''))
      .join(' ')
  let altInNearby = false
  let nearbyDepth: number | undefined
  if (alt.length >= 3) {
    for (let depth = 1; depth <= Math.min(3, chain.length); depth++) {
      const card = chain[depth - 1]!
      if (subtreeText(card).length > 600) break
      if (normalizeForMatch(textWithout(card)).includes(alt)) {
        altInNearby = true
        nearbyDepth = depth
        break
      }
    }
  }
  const link = chain.find((n) => n.role === 'link')
  const inLink = Boolean(link)
  const linkHasText = Boolean(link && [...walkTree(link)].some((n) => n.ref !== node.ref && n.role !== 'img' && (n.text ?? '').trim() !== ''))
  let altNamesHost = false
  const words = alt.split(/[^a-z0-9]+/).filter((w) => w.length >= 1)
  if (words.some((w) => SOCIAL.has(w))) altNamesHost = true
  if (link) {
    try {
      const host = new URL(attributesOf(link).href ?? '', page.snapshot.target).hostname.split('.').filter((l) => l.length >= 4 && l !== 'www')
      if (host.some((label) => words.some((w) => w.length >= 4 && editDistance(w, label) <= 2))) altNamesHost = true
    } catch {
      // no address
    }
  }
  out.push({ ...claim, found: true, altInNearby, nearbyDepth, altNamesHost, linkHasText, inLink })
}

writeFileSync('study/notes-precision-round5/data/image-facts.json', `${JSON.stringify(out, null, 1)}\n`)
const count = (pred: (r: (typeof out)[number]) => boolean) => {
  const sel = out.filter(pred)
  const by = (final: string) => sel.filter((r) => r.final === final).length
  return `TP ${by('true_positive')} FP ${by('false_positive')} unc ${by('uncertain')}`
}
console.log(`confirmed claims: ${out.length}, found in snapshot: ${out.filter((r) => r.found).length}`)
console.log(`all confirmed:           ${count(() => true)}`)
console.log(`altInNearby:             ${count((r) => r.altInNearby)}`)
console.log(`altNamesHost:            ${count((r) => r.altNamesHost)}`)
console.log(`inLink && linkHasText:   ${count((r) => r.inLink && r.linkHasText)}`)
console.log(`any of the three:        ${count((r) => r.altInNearby || r.altNamesHost || (r.inLink && r.linkHasText))}`)
console.log('')
for (const r of out.filter((r) => r.final !== 'true_positive')) console.log(`  ${r.study} ${r.slug.padEnd(24)} ${r.final.slice(0, 5)} ${JSON.stringify(r.alt.slice(0, 40)).padEnd(44)} nearby=${r.altInNearby}@${r.nearbyDepth ?? '-'} host=${r.altNamesHost} inLink=${r.inLink} linkText=${r.linkHasText}`)
console.log('  true positives the three would also move:')
for (const r of out.filter((r) => r.final === 'true_positive' && (r.altInNearby || r.altNamesHost || (r.inLink && r.linkHasText)))) console.log(`  ${r.study} ${r.slug.padEnd(24)} ${JSON.stringify(r.alt.slice(0, 40)).padEnd(44)} nearby=${r.altInNearby}@${r.nearbyDepth ?? '-'} host=${r.altNamesHost} inLink=${r.inLink} linkText=${r.linkHasText}`)

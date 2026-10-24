// The 2.4.4 facts of every candidate on the fresh-page study's DEV pages, with no model: which candidates a new fact
// could ground, and which would share no word with the page they lead to. Only rows of pages-input.json whose split is
// "dev" are read. Usage, from the repository root: node study/notes-remaining/facts244.ts [--list]
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import '../../src/core/check.ts'
import { addressText, genericLinkText, kindOnlyLinkText } from '../../src/criteria/generic-text.ts'
import { destinationEvidence, kindOnlyUncompleted, linkPurpose, namesNoPartOf } from '../../src/criteria/link-purpose.ts'
import { emptyEngine } from '../../src/engine/axe.ts'
import { browserNamed } from '../../src/snapshot/ax.ts'
import { loadEngineFor, loadSnapshot } from '../../src/surfaces/targets.ts'

const study = 'study/fresh-2026-10-11'
const pages = (JSON.parse(readFileSync(join(study, 'data/pages-input.json'), 'utf8')).pages as Array<{ slug: string; split: string }>).filter((p) => p.split === 'dev')
const list = process.argv.includes('--list')

const fold = (text: string) => text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
const STOP = new Set(['the', 'and', 'for', 'with', 'from', 'this', 'that', 'our', 'your', 'you', 'are', 'its', 'uma', 'com', 'para', 'por', 'dos', 'das', 'nos', 'nas', 'que', 'del', 'los', 'las'])
const words = (text: string | undefined) => fold(text ?? '').split(/[^\p{L}\p{N}]+/u).filter((w) => /\p{L}{3}/u.test(w) && !STOP.has(w))
const same = (a: string, b: string) => a === b || (Math.min(a.length, b.length) >= 4 && (a.startsWith(b) || b.startsWith(a)))

const counts = { candidates: 0, noContextAtAll: 0, noContextOutsideLandmarks: 0, nothingAround: 0, kindOnly: 0, kindOnlyUncompleted: 0, samePage: 0, namesNoPartOf: 0, read: 0, readNoSharedWord: 0 }
for (const { slug } of pages) {
  const dir = join(study, 'pages', slug, 'recording')
  const file = readdirSync(dir).find((f) => f.endsWith('.snapshot.json'))
  if (!file) throw new Error(`no recording for ${slug}`)
  // 2.4.4 reads link names as the browser computes them (`names: 'browser'`), as `rampa check` does.
  const snapshot = browserNamed(await loadSnapshot(join(dir, file)))
  const engine = (await loadEngineFor(join(dir, file))) ?? emptyEngine()
  for (const candidate of linkPurpose.candidates(snapshot, engine)) {
    const c = candidate.context
    counts.candidates++
    const none = !c.context && !c.headers && !c.description && !c.heading
    if (none) counts.noContextAtAll++
    if (none && !c.landmark) {
      counts.noContextOutsideLandmarks++
      if (list) console.log(`no-context  ${slug} | ${JSON.stringify(c.name)} | ${c.href ?? ''}${c.menu ? ' (menu)' : ''}`)
    }
    // The model's reading alone on a link with nothing else at all (not a fact Rampa grounds; counted for the notes).
    if (none && !c.landmark && !c.menu) {
      counts.nothingAround++
      if (list) console.log(`nothing-around ${slug} | ${JSON.stringify(c.name)} | ${c.href ?? ''}`)
    }
    if (kindOnlyLinkText(c.name)) {
      counts.kindOnly++
      if (list) console.log(`kind-only   ${slug} | ${JSON.stringify(c.name)} | context=${JSON.stringify(c.context ?? '').slice(0, 80)} heading=${JSON.stringify(c.heading ?? '')} headers=${c.headers ?? ''} row=${c.rowSubject ?? ''} landmark=${c.landmark ?? ''}`)
    }
    if (kindOnlyUncompleted(c)) {
      counts.kindOnlyUncompleted++
      console.log(`KIND-ONLY UNCOMPLETED ${slug} | ${JSON.stringify(c.name)} | ${c.href ?? ''}`)
    }
    if (c.part) {
      counts.samePage++
      if (list) console.log(`same-page   ${slug} | ${JSON.stringify(c.name)} -> #${c.part.id} (${c.part.role}) ${JSON.stringify(c.part.text.slice(0, 60))}`)
    }
    if (namesNoPartOf(c)) {
      counts.namesNoPartOf++
      console.log(`NAMES NO PART ${slug} | ${JSON.stringify(c.name)} -> #${c.part?.id}`)
    }
    // The fact the brief proposed for another page: a destination read, a specific text, and no word shared.
    if (c.destination?.kind === 'page' && destinationEvidence(c.destination, snapshot) === 'read') {
      counts.read++
      const specific = !genericLinkText(c.name) && !addressText(c.name) && words(c.name).length > 0
      let path = ''
      try {
        path = decodeURIComponent(new URL(c.destination.finalUrl ?? c.href ?? '', snapshot.target).pathname)
      } catch {
        path = ''
      }
      const named = [c.destination.title, c.destination.heading, c.destination.description, path].flatMap(words)
      const promised = [c.name, c.context, c.heading, c.description].flatMap(words)
      if (specific && !promised.some((w) => named.some((n) => same(w, n)))) {
        counts.readNoSharedWord++
        console.log(`NO SHARED WORD ${slug} | ${JSON.stringify(c.name)} -> ${JSON.stringify(c.destination.title ?? '')} / ${JSON.stringify(c.destination.heading ?? '')} (${path.slice(0, 60)})`)
      }
    }
  }
}
console.log(JSON.stringify(counts))

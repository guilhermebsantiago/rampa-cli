// Deterministic facts for the 2.4.4 and 2.4.6 candidates of the dev pages, and for the study's labelled dev findings.
// node study/notes-244-246/dev-facts.ts .rampa/dev/snapshots study/data/findings.json .rampa/dev/facts.json
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import '../../src/core/check.ts'
import { linkPurpose, destinationEvidence } from '../../src/criteria/link-purpose.ts'
import { headingsAndLabels } from '../../src/criteria/headings-and-labels.ts'
import { genericLinkText, genericHeadingOrLabel } from '../../src/criteria/generic-text.ts'
import { browserNamed } from '../../src/snapshot/ax.ts'
import { normalizeForMatch } from '../../src/core/util.ts'

const [dir, studyFile, outFile] = process.argv.slice(2) as [string, string, string]
const study = JSON.parse(readFileSync(studyFile, 'utf8')) as Array<Record<string, any>>
const dev = study.filter((row) => row.split === 'dev' && (row.criterion === '2.4.4' || row.criterion === '2.4.6'))

const STOP = new Set(
  'the a an and or of to in on for with by at from is are be this that these those it its as into about our your you we they he she his her their more here click read see view go learn find out page link site home new all www http https com org br gov html de da do das dos e o os as um uma uns umas em no na nos nas por para com sem que se ao aos à às mais aqui clique leia veja ver saiba sobre pelo pela el la los las y del al en con por para más aquí'.split(' '),
)
const words = (text: string | undefined) =>
  [
    ...new Set(
      (text ?? '')
        .normalize('NFD')
        .replace(/\p{M}/gu, '')
        .toLowerCase()
        .match(/[\p{L}\p{N}]+/gu) ?? [],
    ),
  ].filter((w) => w.length >= 3 && !STOP.has(w) && !/^\d+$/.test(w))
const related = (a: string, b: string) => a === b || (Math.min(a.length, b.length) >= 4 && (a.startsWith(b.slice(0, Math.max(4, b.length - 2))) || b.startsWith(a.slice(0, Math.max(4, a.length - 2)))))
const shares = (a: string[], b: string[]) => a.filter((x) => b.some((y) => related(x, y)))

const pages: Record<string, unknown>[] = []
const slugOf = (file: string) => file.replace(/\.snapshot\.json$/, '')
for (const file of readdirSync(dir).filter((f) => f.endsWith('.snapshot.json'))) {
  const raw = JSON.parse(readFileSync(join(dir, file), 'utf8'))
  const engine = JSON.parse(readFileSync(join(dir, file.replace('.snapshot.json', '.engine.json')), 'utf8'))
  const snapshot = browserNamed(raw)
  const links = linkPurpose.candidates(snapshot, engine).map((candidate) => {
    const c = candidate.context
    const promise = [c.name, c.context, c.description].join(' ')
    const dest = c.destination
    const evidence = dest ? destinationEvidence(dest, snapshot) : 'none'
    const destText = c.target ?? (dest && dest.kind === 'page' ? [dest.title, dest.heading, dest.description, dest.section].join(' ') : '')
    return {
      ref: candidate.ref,
      name: c.name,
      generic: genericLinkText(c.name),
      hasContext: Boolean(c.context || c.headers || c.description),
      context: c.context?.slice(0, 160),
      heading: c.heading?.slice(0, 80),
      landmark: c.landmark,
      sameText: c.sameText,
      destination: dest ? { kind: dest.kind, title: (dest as any).title, heading: (dest as any).heading, description: (dest as any).description?.slice(0, 120) } : c.target ? { kind: 'same-page', section: c.target.slice(0, 80) } : undefined,
      evidence: c.target ? 'same-page' : evidence,
      overlap: destText ? shares(words(promise), words(destText)) : undefined,
    }
  })
  const headings = headingsAndLabels.candidates(snapshot, engine).map((candidate) => {
    const c = candidate.context
    return {
      ref: candidate.ref,
      kind: c.kind,
      text: c.text,
      generic: genericHeadingOrLabel(c.text, c.kind),
      parent: c.outline?.at(-1),
      siblings: c.siblings,
      series: c.series,
      overlap: shares(words(c.text), words(c.content)),
      textWords: words(c.text),
      content: c.content.slice(0, 200),
    }
  })
  pages.push({ slug: slugOf(file), title: snapshot.title, links, headings })
}

// The study's labelled findings, matched by text on the page of the same slug prefix.
const matched = dev.map((row) => {
  const page = pages.find((p) => String(p.slug).startsWith(String(row.slug).slice(0, 25))) as any
  const text = String(row.evidence ?? '')
  const pool = row.criterion === '2.4.4' ? page?.links : page?.headings
  const hits = (pool ?? []).filter((c: any) => normalizeForMatch(c.name ?? c.text) === normalizeForMatch(text))
  const byRef = hits.find((c: any) => c.ref === row.ref)
  return { slug: row.slug, criterion: row.criterion, fingerprint: row.fingerprint, final: row.final, cause: row.finalCause, message: row.message, evidence: text, found: hits.length, sameRef: Boolean(byRef), facts: byRef ?? hits[0] }
})
writeFileSync(outFile, JSON.stringify({ pages, matched }, null, 1))
console.log(`pages ${pages.length}, dev findings ${matched.length}, matched ${matched.filter((m) => m.found > 0).length}`)

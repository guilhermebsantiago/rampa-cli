// The dev candidates a fail could be a finding about (judgeFirst), per page.
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import '../../src/core/check.ts'
import { linkPurpose } from '../../src/criteria/link-purpose.ts'
import { headingsAndLabels } from '../../src/criteria/headings-and-labels.ts'
import { browserNamed } from '../../src/snapshot/ax.ts'

const dir = process.argv[2] as string
let links = 0
let headings = 0
for (const file of readdirSync(dir).filter((f) => f.endsWith('.snapshot.json'))) {
  const snapshot = browserNamed(JSON.parse(readFileSync(join(dir, file), 'utf8')))
  const engine = JSON.parse(readFileSync(join(dir, file.replace('.snapshot.json', '.engine.json')), 'utf8'))
  const l = linkPurpose.candidates(snapshot, engine)
  const h = headingsAndLabels.candidates(snapshot, engine)
  const gl = l.filter((c) => linkPurpose.judgeFirst?.(c))
  const gh = h.filter((c) => headingsAndLabels.judgeFirst?.(c))
  links += l.length
  headings += h.length
  console.log(file.slice(0, 40).padEnd(40), `links ${gl.length}/${l.length}`, `headings+labels ${gh.length}/${h.length}`)
  for (const c of gl) console.log('    L', JSON.stringify(c.context.name), c.context.sameText ? JSON.stringify(c.context.sameText) : '', '|', (c.context.context ?? '').slice(0, 90), '| h:', c.context.heading?.slice(0, 40))
  for (const c of gh) console.log('    H', c.context.kind, JSON.stringify(c.context.text), c.context.outline?.at(-1) ?? '')
}
console.log({ links, headings })

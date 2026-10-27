/**
 * The unstyled-capture rule (fix F2, src/snapshot/reach.ts `captureStyle`) on every recorded snapshot of the second,
 * third and fourth real-page studies (main and probe recordings) and of the demo: which pages it reads as read without
 * their styles, and why. No model, no browser.
 *
 * Run from the repository root: node study/notes-precision-fixes/capture-style.ts > study/notes-precision-fixes/data/capture-style.md
 */
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { bodyLookOf, isDefaultLook } from '../../src/snapshot/look.ts'
import { captureStyle } from '../../src/snapshot/reach.ts'
import { loadSnapshot } from '../../src/surfaces/targets.ts'

const RECORDINGS = process.env.RECORDINGS ?? 'C:/Users/guilh/dev/rampa-study-recordings'
const files: Array<{ set: string; path: string }> = []
for (const folder of ['fresh-2026-10-11', 'round-3-2026-10-23', 'round-4-2026-10-24']) {
  const pages = join(RECORDINGS, folder, 'pages')
  for (const slug of readdirSync(pages).sort()) {
    for (const kind of ['recording', 'probe-recording']) {
      const dir = join(pages, slug, kind)
      if (!existsSync(dir)) continue
      for (const name of readdirSync(dir).filter((name) => name.endsWith('.snapshot.json'))) files.push({ set: `${folder} ${kind}`, path: join(dir, name) })
    }
  }
}
for (const name of readdirSync('demo/recorded').filter((name) => name.endsWith('.snapshot.json'))) files.push({ set: 'demo', path: join('demo/recorded', name) })

const lines = ['# The unstyled-capture rule on every recorded snapshot', '', '| set | snapshot | body look | recorded stylesheets | read as unstyled | by |', '| --- | --- | --- | --- | --- | --- |']
const tally = new Map<string, number>()
for (const { set, path } of files) {
  const snapshot = await loadSnapshot(path)
  const style = captureStyle(snapshot)
  const look = bodyLookOf(snapshot.root)
  const sheets = snapshot.reach?.stylesheets
  const key = `${set}|${style.unstyled ? `unstyled by ${style.by}` : style.selfLinks ? 'styled (self link corrected)' : 'styled'}`
  tally.set(key, (tally.get(key) ?? 0) + 1)
  if (style.unstyled || style.selfLinks || isDefaultLook(look) || sheets) {
    const name = path.split(/[\\/]/).slice(-3).join('/')
    const said = sheets ? `${sheets.applied} of ${sheets.linked} applied${sheets.unstyled ? ', recorded unstyled' : ''}` : 'none recorded'
    lines.push(`| ${set} | ${name} | ${look ? `${look.size} px ${look.family} ${look.color}` : '–'} | ${said} | ${style.unstyled ? 'yes' : 'no'} | ${style.by ?? (style.selfLinks ? `self link (${style.selfLinks})` : '')} |`)
  }
}
lines.push('', `${files.length} snapshots. Pages not listed have an author's body look and no stylesheet record.`, '')
for (const [key, count] of [...tally].sort()) lines.push(`- ${key.replace('|', ': ')}: ${count}`)
console.log(lines.join('\n'))

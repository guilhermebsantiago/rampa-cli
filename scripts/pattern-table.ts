// Writes test/fixtures/coga/pattern-table.json: for each pattern and value, whether Chromium's
// validity.patternMismatch is set. coga/input-formats compiles patterns itself, and a test holds that
// compilation to these answers. Run it again after a browser update: node scripts/pattern-table.ts
import { writeFile } from 'node:fs/promises'
import { launchBrowser } from '../src/surfaces/web.ts'

const PATTERNS = [
  '\\d{11}',
  '[0-9]{11}',
  '[0-9]{8}',
  '[0-9]{5}-[0-9]{3}',
  '[0-9]{5}-?[0-9]{3}',
  '\\d{5}-?\\d{3}',
  '\\d{3}\\.\\d{3}\\.\\d{3}-\\d{2}',
  '\\d{3}\\.?\\d{3}\\.?\\d{3}-?\\d{2}',
  '\\d{2}\\.\\d{3}\\.\\d{3}/\\d{4}-\\d{2}',
  '[0-9]{14}',
  '\\(\\d{2}\\) \\d{5}-\\d{4}',
  '(\\(?\\d{2}\\)?\\s?)?9?\\d{4}-?\\d{4}',
  '[\\d\\(\\)+\\s\\-]{8,20}',
  '[0-9]{10,11}',
  '\\+?[0-9 ]{10,16}',
  '[0-9]{16}',
  '[0-9 ]{13,19}',
  '\\d{4} ?\\d{4} ?\\d{4} ?\\d{4}',
  '[0-9]*',
  '\\d{2}/\\d{2}/\\d{4}',
  '\\d{1,2}/\\d{1,2}/\\d{4}',
  '[0-9]{5}(-[0-9]{4})?',
  '[A-Za-z]{1,2}[0-9][A-Za-z0-9]? ?[0-9][A-Za-z]{2}',
  '[A-Z]{1,2}[0-9][A-Z0-9]? [0-9][A-Z]{2}',
  '\\(\\d{3}\\) \\d{3}-\\d{4}',
  '\\d{3}-\\d{3}-\\d{4}',
  // Not valid under the v flag: browsers ignore them, so nothing mismatches.
  '[0-9-]{9}',
  '[\\d()+\\s-]{8,20}',
  '[a-z',
  '(?<year>\\d{4})-\\d{2}',
]

const VALUES = [
  '01310-100', '01310100', '123.456.789-09', '12345678909', '12.345.678/0001-95', '12345678000195',
  '(11) 91234-5678', '11 91234-5678', '11912345678', '+55 11 91234-5678', '4111 1111 1111 1111', '4111111111111111',
  '25/12/1990', '5/3/1990', '94103', '94103-1234', 'SW1A 1AA', 'SW1A1AA', 'sw1a 1aa', '(415) 555-0123', '415-555-0123', '2026-10',
]

const browser = await launchBrowser()
const page = await (await browser.newContext()).newPage()
await page.setContent('<input id="field">')
const rows = await page.evaluate(
  ({ patterns, values }) => {
    const input = document.getElementById('field') as HTMLInputElement
    return patterns.map((pattern) => {
      input.pattern = pattern
      const mismatch: Record<string, boolean> = {}
      for (const value of values) {
        input.value = value
        mismatch[value] = input.validity.patternMismatch
      }
      return { pattern, mismatch }
    })
  },
  { patterns: PATTERNS, values: VALUES },
)
const version = browser.version()
await browser.close()
await writeFile('test/fixtures/coga/pattern-table.json', `${JSON.stringify({ browser: version, rows }, null, 2)}\n`, 'utf8')
console.log(`test/fixtures/coga/pattern-table.json written (${rows.length} patterns, ${version})`)

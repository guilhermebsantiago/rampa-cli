import { describe, expect, it } from 'vitest'
import { probedCriteria } from '../src/eval/probed.ts'

// The benchmark's probes row (bench/run.mjs) runs only the pages of the criteria its probes check, and keeps the judged
// row's result on the others. It once took every probe rule's criteria, opt-in kinds included, so it loaded 1.1.1 pages
// once per probe for nothing; W3C's server then answered their shared test image with a challenge (HTTP 429), and the
// row lost an object-alt violation and two 1.1.1 judgments that the row without probes had.
describe('the criteria a --probe run can change', () => {
  it('leaves out the criteria only opt-in probes check', () => {
    const all = probedCriteria('all')
    // variants (1.1.1, 3.1.1) and links (2.4.4) are opt-in: `--probe all` never runs them.
    for (const criterion of ['1.1.1', '2.4.4', '3.1.1', '3.3.8', '2.3.1', '2.2.1']) expect(all).not.toContain(criterion)
    expect(all).toEqual(expect.arrayContaining(['1.2.2', '1.3.4', '1.4.1', '1.4.3', '1.4.4', '1.4.10', '1.4.12', '1.4.13', '2.1.1', '2.1.2', '2.1.4', '2.4.7']))
  })

  it('takes in an opt-in kind when it is named, and nothing with none', () => {
    expect(probedCriteria('all,variants')).toEqual(expect.arrayContaining(['1.1.1', '3.1.1']))
    expect(probedCriteria('links')).toEqual(['2.4.4'])
    expect(probedCriteria('none')).toEqual([])
  })
})

describe('the benchmark harness', () => {
  it('checks again a page Rampa could not load in time, as a network error', async () => {
    // bench/ is its own project in plain JavaScript; this helper needs only Node.
    const env = (await import(new URL('../bench/lib/env.mjs', import.meta.url).href)) as { TRANSIENT_ERROR: RegExp }
    expect(env.TRANSIENT_ERROR.test('rampa: https://www.w3.org/WAI/x.html did not reach load within 30000 ms. Raise --timeout.')).toBe(true)
    expect(env.TRANSIENT_ERROR.test('rampa: No judgment module for WCAG 9.9.9.')).toBe(false)
  })
})

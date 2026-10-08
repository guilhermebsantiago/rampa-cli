import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  activeFingerprints,
  daysBetween,
  isDate,
  isFingerprint,
  pruneExpired,
  readWaivers,
  statusOf,
  today,
  upsertWaiver,
  waiversWith,
  writeWaivers,
} from '../src/adoption/waivers.ts'
import { listWaivers } from '../src/cli/commands/waivers.ts'
import { loadWaivers } from '../src/config.ts'
import type { Report } from '../src/core/types.ts'

async function waiversFile(content: unknown): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'rampa-waivers-'))
  const path = join(dir, 'waivers.json')
  await writeFile(path, typeof content === 'string' ? content : JSON.stringify(content), 'utf8')
  return path
}

describe('waiver files', () => {
  it('reads the formats earlier versions wrote: bare fingerprints and { fingerprint } objects', async () => {
    const path = await waiversFile(['5F085D8A3B9C', { fingerprint: '2c1d064d9cc7' }])
    expect(await loadWaivers(path)).toEqual(new Set(['5f085d8a3b9c', '2c1d064d9cc7']))
  })

  it('treats a missing file as no waivers, and a broken one as an error', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'rampa-waivers-'))
    expect(await loadWaivers(join(dir, 'missing.json'))).toEqual(new Set())
    expect((await readWaivers(join(dir, 'missing.json'))).exists).toBe(false)
    await expect(readWaivers(await waiversFile('[{"fingerprint": '))).rejects.toThrow(/not valid JSON/)
    await expect(readWaivers(await waiversFile({ waivers: [] }))).rejects.toThrow(/must be a JSON array/)
    expect((await readWaivers(await waiversFile(''))).entries).toEqual([])
  })

  it('applies a waiver through its expiry date and not a day after', async () => {
    const file = await readWaivers(await waiversFile([{ fingerprint: 'aaaaaaaaaaaa', reason: 'r', expires: '2026-10-31' }, 'bbbbbbbbbbbb']))
    expect(activeFingerprints(file, '2026-10-31')).toEqual(new Set(['aaaaaaaaaaaa', 'bbbbbbbbbbbb']))
    expect(activeFingerprints(file, '2026-11-01')).toEqual(new Set(['bbbbbbbbbbbb']))
    expect(waiversWith(file, 'expired', '2026-11-01').map((waiver) => waiver.fingerprint)).toEqual(['aaaaaaaaaaaa'])
  })

  it('never applies an entry it cannot read, such as an expiry that is not a date', async () => {
    const file = await readWaivers(
      await waiversFile([{ fingerprint: 'aaaaaaaaaaaa', expires: 'next week' }, { reason: 'no fingerprint' }, 42, { fingerprint: 'cccccccccccc', expires: '2026-02-30' }]),
    )
    expect(file.entries.map((entry) => statusOf(entry, '2026-10-08'))).toEqual(['invalid', 'invalid', 'invalid', 'invalid'])
    expect(file.entries[0]?.problem).toMatch(/not a YYYY-MM-DD date/)
    expect(activeFingerprints(file, '2026-10-08')).toEqual(new Set())
  })

  it('adds a waiver, and renews one without losing fields it does not know', async () => {
    const path = await waiversFile([{ fingerprint: 'aaaaaaaaaaaa', reason: 'old', expires: '2026-01-01', ticket: 'A11Y-12' }])
    const file = await readWaivers(path)
    expect(upsertWaiver(file, { fingerprint: 'aaaaaaaaaaaa', reason: 'renewed', date: '2026-10-08' })).toBe('updated')
    expect(upsertWaiver(file, { fingerprint: 'bbbbbbbbbbbb', reason: 'new', expires: '2027-01-31', author: undefined })).toBe('added')
    await writeWaivers(file)
    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual([
      // Renewed without --expires: the old, past date must not come back with it.
      { fingerprint: 'aaaaaaaaaaaa', reason: 'renewed', date: '2026-10-08', ticket: 'A11Y-12' },
      { fingerprint: 'bbbbbbbbbbbb', reason: 'new', expires: '2027-01-31' },
    ])
  })

  it('prunes only expired waivers and writes the rest back as they were', async () => {
    const entries = ['bbbbbbbbbbbb', { fingerprint: 'aaaaaaaaaaaa', expires: '2026-09-30', reason: 'gone' }, { note: 'kept as written' }]
    const path = await waiversFile(entries)
    const file = await readWaivers(path)
    expect(pruneExpired(file, '2026-10-08').map((waiver) => waiver.fingerprint)).toEqual(['aaaaaaaaaaaa'])
    await writeWaivers(file)
    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual(['bbbbbbbbbbbb', { note: 'kept as written' }])
  })

  it('flags a waiver as unused only when the reports checked its page', async () => {
    const file = await readWaivers(
      await waiversFile([
        { fingerprint: 'aaaaaaaaaaaa', target: 'dist/index.html' },
        { fingerprint: 'bbbbbbbbbbbb', target: 'dist/index.html' },
        { fingerprint: 'cccccccccccc', target: 'dist/other.html' },
        'dddddddddddd',
      ]),
    )
    const report = {
      target: 'dist/index.html',
      findings: [],
      belowThreshold: [],
      waived: [{ fingerprint: 'aaaaaaaaaaaa' }],
    } as unknown as Report
    const statuses = listWaivers(file, '2026-10-08', [report]).map((item) => `${item.waiver?.fingerprint} ${item.status}`)
    expect(statuses).toEqual(['aaaaaaaaaaaa active', 'bbbbbbbbbbbb unused', 'cccccccccccc active', 'dddddddddddd unused'])
    expect(listWaivers(file, '2026-10-08').every((item) => item.status === 'active')).toBe(true)
  })
})

describe('waiver values', () => {
  it('accepts only real calendar days', () => {
    expect(isDate('2028-02-29')).toBe(true)
    expect(isDate('2026-02-29')).toBe(false)
    expect(isDate('2026-1-5')).toBe(false)
    expect(isDate('2026-13-01')).toBe(false)
  })

  it('knows a fingerprint when it sees one', () => {
    expect(isFingerprint('5f085d8a3b9c')).toBe(true)
    expect(isFingerprint('5f085d8a3b9')).toBe(false)
    expect(isFingerprint('5f085d8a3b9z')).toBe(false)
  })

  it('reads today on the local calendar and counts days between dates', () => {
    expect(today(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05')
    expect(daysBetween('2026-10-08', '2027-01-31')).toBe(115)
    expect(daysBetween('2026-03-28', '2026-03-30')).toBe(2)
  })
})

import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { checkSnapshot } from '../src/core/check.ts'
import type { Finding, Report } from '../src/core/types.ts'
import type { HoverData } from '../src/probes/hover.ts'
import { DETERMINISM_ARGS } from '../src/probes/run.ts'
import { renderReport } from '../src/report/pretty.ts'
import { paint } from '../src/report/color.ts'
import { A11ySnapshotSchema, type A11ySnapshot } from '../src/snapshot/schema.ts'
import { walkTree } from '../src/snapshot/tree.ts'
import { loadRecorded } from '../src/surfaces/targets.ts'
import { type Collected, collectWeb, launchBrowser } from '../src/surfaces/web.ts'
import { byRule, fixture, probeCheckOptions, reviewByRule } from './probe-helpers.ts'

// Integration: needs Chrome or Edge. Skipped, with the reason on stderr, when none starts.
const browser = await launchBrowser({ args: DETERMINISM_ARGS }).catch((error: unknown) => {
  process.stderr.write(`\nSkipping the hover probe tests: no browser started (${error instanceof Error ? error.message.split('\n')[0] : String(error)}).\n`)
  return undefined
})
// Closing Edge can take long on a loaded machine.
afterAll(async () => browser?.close(), 60_000)

const collected = new Map<string, Promise<Collected>>()
function probed(name: string): Promise<Collected> {
  if (!browser) throw new Error('no browser')
  let result = collected.get(name)
  if (!result) {
    result = collectWeb(browser, fixture(name), { runAxe: false, locale: 'en', probes: ['hover'] })
    collected.set(name, result)
  }
  return result
}

/** Which of the three conditions a finding is about, from its message. */
const condition = (f: Pick<Finding, 'message'>) => /dismissible/.exec(f.message)?.[0] ?? /hoverable/.exec(f.message)?.[0] ?? /persistent/.exec(f.message)?.[0] ?? '?'
const dataOf = (snapshot: A11ySnapshot) => snapshot.observations?.probes.find((p) => p.kind === 'hover')?.data as HoverData | undefined

describe.skipIf(!browser)('hover probe (1.4.13)', { timeout: 120_000 }, () => {
  it('records the triggers it tried and what each did, behind the guard, with no click', async () => {
    const { snapshot } = await probed('hover-fail.html')
    expect(A11ySnapshotSchema.safeParse(snapshot).success).toBe(true)
    const record = snapshot.observations?.probes.find((p) => p.kind === 'hover')
    expect(record).toMatchObject({ kind: 'hover', version: '1', status: 'complete', conditions: { variant: 'hover-focus', viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 } })
    expect(record?.guard).toEqual({ blocked: [], navigations: [], dialogs: [] })
    const data = dataOf(snapshot)
    expect(data?.clock).toBe(true)
    expect(data?.triggers.map((t) => t.ref).sort()).toEqual(['#gap-btn', '#pseudo-link', '#ship-wrap', '#timed-btn'])
    expect(data?.triggers.find((t) => t.ref === '#pseudo-link')).toMatchObject({ pseudo: '::after', rule: '[data-tip]:hover::after' })
    expect(data?.triggers.find((t) => t.ref === '#gap-btn')?.sources).toContain('describedby')
  })

  it('fails content that Esc cannot close over other content, that the pointer cannot reach (F95), and that goes on its own', async () => {
    const { snapshot, engine } = await probed('hover-fail.html')
    const report = await checkSnapshot(snapshot, engine, probeCheckOptions())
    const findings = byRule(report, 'rampa/hover-content')
    expect(findings.map((f) => `${f.ref} ${condition(f)}`).sort()).toEqual(['#gap-btn hoverable', '#pseudo-link dismissible', '#ship-wrap dismissible', '#timed-btn persistent'])
    expect(findings.every((f) => f.source === 'probe' && f.experimental && f.confidence === 'high' && f.criterion === '1.4.13')).toBe(true)
    const of = (ref: string) => findings.find((f) => f.ref === ref)
    expect(of('#gap-btn')?.evidence).toMatch(/^on hover, <button> "Returns" showed <div role=tooltip> "Returns are free for thirty days\." .*16 px from the trigger; .*it disappeared, in 2 of 2 tries$/)
    expect(of('#timed-btn')?.message).toMatch(/^Content that appears on hover and on focus disappears on its own/)
    expect(of('#timed-btn')?.evidence).toMatch(/10 s later on the fake clock, with the pointer or focus still on the trigger, it was gone, in 2 of 2 tries$/)
    expect(of('#ship-wrap')?.message).toMatch(/^Content that appears on hover and on focus covers other content and does not close with Esc/)
    expect(of('#ship-wrap')?.evidence).toMatch(/over 1 other element\(s\) such as <p> "Delivery takes .*Esc pressed without moving the pointer or focus: it still showed \d+ ms later, and it went away once the pointer and focus left$/)
    expect(of('#pseudo-link')?.evidence).toMatch(/showed its ::after "A small fee applies to express delivery\." .*\(measured from the pixels that changed\), over 1 other element\(s\)/)
    expect(reviewByRule(report, 'rampa/hover-content')).toEqual([])
    expect(report.coverage.probes?.find((c) => c.criterion === '1.4.13')).toMatchObject({ method: 'probe/hover@1', rule: 'rampa/hover-content', status: 'failures', failures: 4, applicable: 4 })
    expect(report.coverage.notChecked).not.toContain('1.4.13')
    expect(report.coverage.criteria?.find((c) => c.id === '1.4.13')?.methods).toContainEqual(expect.objectContaining({ kind: 'probe', id: 'rampa/hover-content', ran: true, maturity: 'experimental' }))
  })

  it('finds nothing in SCR39 tooltips, menus that Esc closes, content that covers nothing, and browser title tooltips', async () => {
    const { snapshot, engine } = await probed('hover-pass.html')
    const triggers = dataOf(snapshot)?.triggers ?? []
    // `title` is the browser's own tooltip, and a:hover only restyles the link itself: neither is a trigger.
    expect(triggers.filter((t) => ['abbr', 'a'].includes(t.tag) || t.label === 'Print')).toEqual([])
    expect(triggers.map((t) => t.ref).sort()).toEqual(['#faq', '#good-btn', '#menu-shop', '#side-wrap'])
    const report = await checkSnapshot(snapshot, engine, probeCheckOptions())
    expect(byRule(report, 'rampa/hover-content')).toEqual([])
    expect(reviewByRule(report, 'rampa/hover-content')).toEqual([])
    const coverage = report.coverage.probes?.find((c) => c.criterion === '1.4.13')
    expect(coverage).toMatchObject({ status: 'no-failure-found', failures: 0, review: 0, applicable: 4 })
    expect(coverage?.note).toContain('2 did not close with Esc but cover no other content, which the criterion allows')
  })

  it('sends a possible input error, a failure seen once, Esc that moves focus, and content that never closes to review', async () => {
    const { snapshot, engine } = await probed('hover-review.html')
    const report = await checkSnapshot(snapshot, engine, probeCheckOptions())
    expect(byRule(report, 'rampa/hover-content')).toEqual([])
    const review = reviewByRule(report, 'rampa/hover-content')
    expect(review.map((f) => f.ref).sort()).toEqual(['#blur-btn', '#email', '#flaky-btn', '#sticky-btn'])
    const of = (ref: string) => review.find((f) => f.ref === ref)
    expect(of('#email')?.message).toContain('may be an input error message')
    expect(of('#flaky-btn')?.message).toContain('failed the hoverable check in one of two tries')
    expect(of('#flaky-btn')?.evidence).toMatch(/it disappeared, in 1 of 2 tries$/)
    expect(of('#blur-btn')?.message).toContain('only by taking focus off its trigger')
    expect(of('#sticky-btn')?.evidence).toMatch(/and it stayed after the pointer and focus left$/)
    expect(report.coverage.probes?.find((c) => c.criterion === '1.4.13')).toMatchObject({ status: 'needs-review', failures: 0, review: 4 })
  })

  it('writes the evidence and the coverage line in the report language', async () => {
    const { snapshot, engine } = await probed('hover-fail.html')
    const report = await checkSnapshot(snapshot, engine, probeCheckOptions({ locale: 'pt-BR' }))
    const gap = byRule(report, 'rampa/hover-content').find((f) => f.ref === '#gap-btn')
    expect(gap?.message).toMatch(/^O conteúdo que aparece quando o ponteiro passa aqui some/)
    expect(gap?.evidence).toMatch(/^no hover, <button> "Returns" mostrou .*a 16 px do gatilho; .*em 2 de 2 tentativas$/)
    expect(report.coverage.probes?.find((c) => c.criterion === '1.4.13')?.conditions).toMatch(/^hover e foco em até 30 gatilhos em 1280×800 · /)
  })

  it('keeps experimental findings below the default threshold and prints the coverage line', async () => {
    const { snapshot, engine } = await probed('hover-fail.html')
    const report = await checkSnapshot(snapshot, engine, probeCheckOptions({ minConfidence: 'medium' }))
    expect(byRule(report, 'rampa/hover-content')).toEqual([])
    expect(report.belowThreshold.filter((f) => f.ruleId === 'rampa/hover-content')).toHaveLength(4)
    const text = renderReport(report, { verbose: true, paint: paint(false) })
    expect(text).toContain('1.4.13  probe/hover@1 (rampa/hover-content) · hover and focus on up to 30 triggers at 1280×800')
  })

  it('replays a saved snapshot offline to the same findings', async () => {
    const { snapshot, engine } = await probed('hover-fail.html')
    const live = await checkSnapshot(snapshot, engine, probeCheckOptions())
    const dir = await mkdtemp(join(tmpdir(), 'rampa-hover-'))
    const path = join(dir, 'hover.snapshot.json')
    await writeFile(path, JSON.stringify(snapshot), 'utf8')
    await writeFile(join(dir, 'hover.engine.json'), JSON.stringify(engine), 'utf8')
    const loaded = await loadRecorded(path, 'en')
    const replayed = await checkSnapshot(loaded.snapshot, loaded.engine, probeCheckOptions())
    const key = (report: Report) => report.findings.map((f) => `${f.fingerprint} ${f.evidence}`)
    expect(key(replayed)).toEqual(key(live))
    expect(replayed.coverage.probes).toEqual(live.coverage.probes)
  })

  it('reports nothing about a trigger whose identity changed between loads', async () => {
    const { snapshot, engine } = await probed('hover-fail.html')
    const changed = structuredClone(snapshot) as A11ySnapshot
    for (const node of walkTree(changed.root)) {
      if (node.ref === '#gap-btn') node.native = { ...node.native, tag: 'a' }
    }
    const report = await checkSnapshot(changed, engine, probeCheckOptions())
    expect(byRule(report, 'rampa/hover-content').map((f) => f.ref)).not.toContain('#gap-btn')
    expect(report.coverage.probes?.find((c) => c.criterion === '1.4.13')).toMatchObject({ unmatched: 1, failures: 3 })
  })
})

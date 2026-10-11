import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { checkSnapshot } from '../src/core/check.ts'
import type { Report } from '../src/core/types.ts'
import { statusJudgments, statusMessages } from '../src/criteria/status-messages.ts'
import { emptyEngine } from '../src/engine/axe.ts'
import type { JudgeRequest, ModelProvider } from '../src/providers/types.ts'
import { DETERMINISM_ARGS, parseProbeKinds } from '../src/probes/run.ts'
import type { StatusData, StatusMessage, StatusTrigger } from '../src/probes/status.ts'
import { paint } from '../src/report/color.ts'
import { renderReport } from '../src/report/pretty.ts'
import { STATUS_RULE, sameWords, statusVerdicts, triage } from '../src/rules/status-messages.ts'
import { A11ySnapshotSchema, type A11yNode, type A11ySnapshot, type ProbeRecord } from '../src/snapshot/schema.ts'
import { indexTree } from '../src/snapshot/tree.ts'
import { loadRecorded } from '../src/surfaces/targets.ts'
import { type Collected, collectWeb, launchBrowser } from '../src/surfaces/web.ts'
import { startFixtureServers } from './media-server.ts'
import { byRule, probeCheckOptions, reviewByRule } from './probe-helpers.ts'

const message = (text: string, extra: Partial<StatusMessage> = {}): StatusMessage => ({
  ref: '#msg',
  id: { tag: 'p', sig: 'p|msg||||' },
  tag: 'p',
  role: 'generic',
  label: text,
  text,
  added: false,
  visible: true,
  chars: text.length,
  controls: 0,
  items: 0,
  ax: null,
  ancestors: [{ ref: 'html > body > main', id: { tag: 'main', sig: 'main|||||' }, tag: 'main' }],
  ...extra,
})

describe('the F103 triage', () => {
  it('reads a live region that says the same words as the message', () => {
    expect(sameWords('Added. Your list has 2 items.', 'Your list: 2 items')).toBe(true)
    expect(sameWords('Link copied to the clipboard', 'Link copied')).toBe(true)
    expect(sameWords('Loading', 'Enter an e-mail address like name@example.com')).toBe(false)
    expect(sameWords('', 'Saved')).toBe(false)
  })

  it('leaves out what does not show, takes focus, sits in a dialog, is exposed, was said, or is large, and keeps the rest', () => {
    expect(triage(message('Saved', { visible: false }), [])).toBe('hidden')
    expect(triage(message('Saved', { focus: true }), [])).toBe('focused')
    expect(triage(message('Saved', { dialog: true }), [])).toBe('dialog')
    expect(triage(message('Saved', { ax: { role: 'status', live: 'polite' } }), [])).toBe('live')
    expect(triage(message('Saved', { ax: { role: 'generic', live: 'assertive' } }), [])).toBe('live')
    // The browser's tree wins over the markup: a live region it does not expose (aria-hidden) does not count.
    expect(triage(message('Saved', { ax: null, live: { ref: '#r', role: 'status', politeness: 'polite' } }), [])).toBe('unexposed')
    expect(triage(message('Saved', { ax: undefined, live: { ref: '#r', role: 'status', politeness: 'polite' } }), [])).toBe('live')
    expect(triage(message('Saved', { ax: undefined, live: { ref: '#r', role: 'timer', politeness: 'off' } }), [])).toBe('unexposed')
    expect(triage(message('Your list: 2 items'), [{ ref: '#announcer', role: 'region', text: 'Added. Your list has 2 items.', added: false }])).toBe('announced')
    // W3C's tutorial: "Error:" in the field's label, the advice in a live region of its own. Tied to the field, it was said.
    const advice = [{ ref: '#expDesc3', role: 'region', text: 'Use the format MM/YYYY.', added: false }]
    expect(triage(message('Error:', { inLabel: true }), advice)).toBe('announced')
    expect(triage(message('Enter your name', { describedBy: true }), advice)).toBe('announced')
    expect(triage(message('Enter your name', { describedBy: true }), [])).toBe('unexposed')
    expect(triage(message('Error:'), advice)).toBe('unexposed')
    expect(triage(message('x'.repeat(400)), [])).toBe('content')
    expect(triage(message('Steel Glass Copper', { items: 3 }), [])).toBe('content')
    expect(triage(message('Enter an e-mail address like name@example.com'), [])).toBe('unexposed')
  })

  it('keeps the activate class out of --probe all', () => {
    expect(parseProbeKinds('all')).not.toContain('status')
    expect(parseProbeKinds('status')).toEqual(['status'])
    expect(parseProbeKinds('interact')).toContain('status')
  })
})

const node = (ref: string, tag: string, attributes: Record<string, string>): A11yNode => ({ ref, role: 'generic', states: [], native: { tag, attributes, html: `<${tag}${attributes.id ? ` id="${attributes.id}"` : ''}></${tag}>` }, children: [] })

function trigger(ref: string, label: string, kind: StatusTrigger['trigger'], messages: StatusMessage[], extra: Partial<StatusTrigger> = {}): StatusTrigger {
  return {
    ref,
    id: { tag: 'button', sig: `button|${ref.slice(1)}||||` },
    tag: 'button',
    role: 'button',
    label,
    trigger: kind,
    why: 'copy',
    trial: { action: 'clicked', messages },
    ...extra,
  }
}

function statusSnapshot(triggers: StatusTrigger[]): A11ySnapshot {
  const data: StatusData = { viewport: { width: 1280, height: 800 }, found: triggers.length, triggers, tried: triggers.length, loads: triggers.length, regions: [], actions: [], end: 'complete' }
  const record: ProbeRecord = {
    kind: 'status',
    version: '1',
    conditions: { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, browser: 'chromium 1 (headless)', variant: 'status-messages' },
    status: 'complete',
    guard: { blocked: [], navigations: [], dialogs: [] },
    durationMs: 1,
    data,
  }
  const main: A11yNode = { ...node('html > body > main', 'main', {}), children: [node('#msg', 'p', { id: 'msg' }), node('#copy', 'button', { id: 'copy' }), node('#sort', 'button', { id: 'sort' })] }
  return {
    schemaVersion: 1,
    surface: 'web',
    target: 'https://example.com/',
    title: 'Shop',
    viewport: { width: 1280, height: 800, scale: 1 },
    root: { ref: 'html', role: 'document', states: [], native: { tag: 'html', attributes: {} }, children: [{ ref: 'html > body', role: 'generic', states: [], native: { tag: 'body', attributes: {} }, children: [main] }] },
    observations: { probes: [record] },
    collectedAt: new Date(0).toISOString(),
    collector: { name: 'rampa-web', version: '0' },
  }
}

/** A model that answers the 4.1.3 question per text, and keeps the prompts. */
function reader(answers: Record<string, Record<string, unknown>>): ModelProvider & { asked: string[] } {
  const asked: string[] = []
  return {
    id: 'stub:status',
    asked,
    async judge<T>(request: JudgeRequest<T>) {
      asked.push(request.user)
      const text = /Text that appeared, in .*?: "(.*)"/.exec(request.user)?.[1] ?? ''
      const output = Object.entries(answers).find(([key]) => text.includes(key))?.[1] ?? { verdict: 'cannot_tell', evidence: '', confidence: 'low' }
      return { output: request.schema.parse(output), inputTokens: 100, outputTokens: 20, latencyMs: 1, modelId: 'stub' }
    },
  }
}

describe('4.1.3 over recorded messages', () => {
  // A note that was in the page on load (its own element), and a toast added to the page (reported on <main>).
  const sorted = trigger('#sort', 'Sort by', 'control', [message('Sorted by price, lowest first')])
  const toast = message('Link copied', { ref: 'html > body > main > div', id: { tag: 'div', sig: 'div|||||' }, tag: 'div', added: true })
  const copied = trigger('#copy', 'Copy link', 'control', [toast, message('Saved', { ref: '#msg', ax: { role: 'status', live: 'polite' } })])

  it('sends what nothing exposes to review, on its own element or the nearest one the snapshot has, and decides nothing itself', async () => {
    const snapshot = statusSnapshot([sorted, copied])
    const verdicts = statusVerdicts(snapshot.observations?.probes[0]?.data as StatusData, indexTree(snapshot.root))
    expect(verdicts.verdicts.map((v) => `${v.node.ref} ${v.triage} ${v.exact}`)).toEqual(['#msg unexposed true', 'html > body > main unexposed false', '#msg live true'])
    const report = await checkSnapshot(snapshot, emptyEngine(), probeCheckOptions())
    expect(byRule(report, STATUS_RULE)).toEqual([])
    const review = reviewByRule(report, STATUS_RULE)
    expect(review.map((r) => r.ref)).toEqual(['#msg', 'html > body > main'])
    expect(review[0]?.message).toMatch(/^After the probe clicked <button> "Sort by", "Sorted by price, lowest first" appeared without focus moving to it, and nothing exposes it as a status/)
    expect(review[1]?.evidence).toContain('reported on the nearest element the page had on load, html > body > main')
    const row = report.coverage.probes?.find((c) => c.rule === STATUS_RULE)
    expect(row).toMatchObject({ criterion: '4.1.3', method: 'probe/status@1', status: 'needs-review', applicable: 3, failures: 0, review: 2 })
    expect(row?.note).toContain('3 text(s) appeared after them: 1 in a live region or a status, alert or log role')
    expect(report.coverage.criteria?.find((c) => c.id === '4.1.3')?.status).toBe('needs-review')
    expect(renderReport(report, { verbose: true, paint: paint(false) })).toMatch(/4\.1\.3 +probe\/status@1 \(rampa\/status-messages\) · fields left, searches and client-only controls/)
  })

  it('asks the model only with judgment on, about the texts nothing exposes', async () => {
    const snapshot = statusSnapshot([sorted, copied])
    expect(statusJudgments(snapshot)).toEqual([statusMessages])
    expect(statusJudgments(statusSnapshot([trigger('#copy', 'Copy', 'control', [message('Saved', { ax: { role: 'status', live: 'polite' } })])]))).toEqual([])
    const off = await checkSnapshot(snapshot, emptyEngine(), probeCheckOptions())
    expect(off.criteria.find((c) => c.criterion === '4.1.3')).toMatchObject({ candidates: 2, judged: 0 })
  })

  it('turns a status message the model quotes into a finding, with role="status" on its own element, and clears what it reads as content', async () => {
    const model = reader({
      Sorted: { verdict: 'fail', evidence: 'Sorted by price', confidence: 'high' },
      'Link copied': { verdict: 'pass', evidence: '', confidence: 'high' },
    })
    const report = await checkSnapshot(statusSnapshot([sorted, copied]), emptyEngine(), probeCheckOptions({ llm: true, provider: model }))
    expect(model.asked).toHaveLength(2)
    expect(model.asked[0]).toContain('What the test did: it clicked <button> "Sort by"')
    const findings = report.findings.filter((f) => f.criterion === '4.1.3')
    expect(findings).toHaveLength(1)
    expect(findings[0]).toMatchObject({ ref: '#msg', source: 'judgment', experimental: true, model: 'stub:status', evidence: 'Sorted by price' })
    expect(findings[0]?.message).toMatch(/^After the test clicked <button> "Sort by", a status message appeared that nothing exposes: "Sorted by price"\. .*WCAG 4\.1\.3; F103/)
    expect(findings[0]?.patch).toMatchObject({ kind: 'set-attribute', attribute: 'role', to: 'status', after: '<p id="msg" role="status">' })
    // Both items were settled: neither is left to review.
    expect(reviewByRule(report, STATUS_RULE)).toEqual([])
    const row = report.coverage.probes?.find((c) => c.rule === STATUS_RULE)
    expect(row).toMatchObject({ review: 0, failures: 1, status: 'failures' })
    expect(row?.note).toContain('the model read "Link copied" as content, not a status message')
    const methods = report.coverage.criteria?.find((c) => c.id === '4.1.3')?.methods ?? []
    expect(methods.map((m) => `${m.kind} ${m.maturity}`)).toEqual(['probe experimental', 'judgment experimental'])
  })

  it('discards a fail that quotes words the page did not show, and leaves the item to review', async () => {
    const model = reader({ Sorted: { verdict: 'fail', evidence: 'Your order was sorted', confidence: 'high' } })
    const report = await checkSnapshot(statusSnapshot([sorted]), emptyEngine(), probeCheckOptions({ llm: true, provider: model }))
    expect(report.discarded).toEqual([expect.objectContaining({ criterion: '4.1.3', reason: 'evidence is not text that appeared' })])
    expect(report.findings.filter((f) => f.criterion === '4.1.3')).toEqual([])
    expect(reviewByRule(report, STATUS_RULE).map((r) => r.ref)).toEqual(['#msg'])
  })
})

// Integration: needs Chrome or Edge, and the fixtures over HTTP. Skipped, with the reason on stderr, when no browser starts.
const browser = await launchBrowser({ args: DETERMINISM_ARGS }).catch((error: unknown) => {
  process.stderr.write(`\nSkipping the status probe tests: no browser started (${error instanceof Error ? error.message.split('\n')[0] : String(error)}).\n`)
  return undefined
})
const servers = browser ? await startFixtureServers() : undefined
afterAll(async () => {
  await browser?.close()
  await servers?.close()
}, 60_000)

const collected = new Map<string, Promise<Collected>>()
function probed(name: string): Promise<Collected> {
  if (!browser || !servers) throw new Error('no browser')
  let result = collected.get(name)
  if (!result) {
    result = collectWeb(browser, `${servers.origin}/${name}`, { runAxe: false, locale: 'en', probes: ['status'] })
    collected.set(name, result)
  }
  return result
}

const recordOf = (snapshot: A11ySnapshot) => snapshot.observations?.probes.find((p) => p.kind === 'status')
const dataOf = (snapshot: A11ySnapshot) => recordOf(snapshot)?.data as StatusData

describe.skipIf(!browser)('status probe (4.1.3)', { timeout: 400_000 }, () => {
  it('sets off each safe trigger and sends what nothing exposes to review', async () => {
    const { snapshot, engine } = await probed('status-fail.html')
    expect(A11ySnapshotSchema.safeParse(snapshot).success).toBe(true)
    expect(recordOf(snapshot)).toMatchObject({ kind: 'status', version: '1', status: 'complete', conditions: { variant: 'status-messages' } })
    const data = dataOf(snapshot)
    expect(data.triggers.map((t) => `${t.ref} ${t.trigger}`)).toEqual([
      '#q search',
      '#email blur',
      '#name blur',
      'html > body > main > section:nth-of-type(2) > button control',
      'html > body > main > section:nth-of-type(5) > button control',
      '#sort setting',
    ])
    const verdicts = statusVerdicts(data, indexTree(snapshot.root))
    expect(verdicts.verdicts.filter((v) => v.triage === 'unexposed').map((v) => v.message.text).sort()).toEqual(
      ['3 results for "kettles"', 'Enter an e-mail address like name@example.com', 'Enter the name to print on the card', 'Link copied to the clipboard', 'Sorted by price, lowest first', 'Your list: 2 items'].sort(),
    )
    // The results themselves are content; the clock that ticks on its own is never a message.
    expect(verdicts.counts.content).toBe(1)
    expect(verdicts.verdicts.map((v) => v.message.text).some((t) => /^\d+$/.test(t))).toBe(false)
    const report = await checkSnapshot(snapshot, engine, probeCheckOptions())
    expect(reviewByRule(report, STATUS_RULE)).toHaveLength(6)
    expect(reviewByRule(report, STATUS_RULE).find((r) => r.ref === '#name-error')?.evidence).toContain('the field names it with aria-describedby or aria-errormessage and is aria-invalid')
    // The search form's own submission was cancelled: the server saw the page's load and nothing else.
    expect((servers?.requests ?? []).filter((r) => r.includes('results.html'))).toEqual([])
  })

  it('gives the model each text, and makes findings of what it quotes as status messages, patched where the element was there on load', async () => {
    const { snapshot, engine } = await probed('status-fail.html')
    const all = { verdict: 'fail', confidence: 'high' }
    const model = reader({
      results: { ...all, evidence: '3 results' },
      'e-mail': { ...all, evidence: 'Enter an e-mail address' },
      'name to print': { ...all, evidence: 'Enter the name to print on the card' },
      'Link copied': { ...all, evidence: 'Link copied' },
      Sorted: { ...all, evidence: 'Sorted by price' },
      'Your list': { ...all, evidence: 'Your list: 2 items' },
    })
    const report = await checkSnapshot(snapshot, engine, probeCheckOptions({ llm: true, provider: model }))
    const findings = report.findings.filter((f) => f.criterion === '4.1.3')
    expect(findings).toHaveLength(6)
    expect(
      findings
        .filter((f) => f.patch)
        .map((f) => f.ref)
        .sort(),
    ).toEqual(['#list-count', '#name-error', '#sort-note', '#summary'])
    expect(findings.find((f) => f.ref === '#name-error')?.confidence).toBe('medium')
    expect(reviewByRule(report, STATUS_RULE)).toEqual([])
  })

  it('finds every message exposed where the page uses live regions, roles or a hidden announcer', async () => {
    const { snapshot, engine } = await probed('status-pass.html')
    const verdicts = statusVerdicts(dataOf(snapshot), indexTree(snapshot.root))
    expect(verdicts.counts.unexposed).toBe(0)
    expect(verdicts.counts.live).toBeGreaterThanOrEqual(5)
    expect(verdicts.counts.announced).toBe(1)
    const report = await checkSnapshot(snapshot, engine, probeCheckOptions())
    expect(reviewByRule(report, STATUS_RULE)).toEqual([])
    expect(report.coverage.probes?.find((c) => c.rule === STATUS_RULE)).toMatchObject({ status: 'no-failure-found' })
    expect(report.coverage.probes?.find((c) => c.rule === STATUS_RULE)?.note).toMatch(/\d live region\(s\) on load \(rampa\/live-regions\); \d received text after a trigger/)
  })

  it('leaves panels, lists, focus, dialogs and the skip list alone, and sends text shown for its own sake to a person', async () => {
    const { snapshot, engine } = await probed('status-controls.html')
    const data = dataOf(snapshot)
    const report = await checkSnapshot(snapshot, engine, probeCheckOptions())
    // Only reading tells the story paragraph from a message: without a model, a person does.
    expect(reviewByRule(report, STATUS_RULE).map((r) => r.ref)).toEqual(['#story'])
    const verdicts = statusVerdicts(data, indexTree(snapshot.root))
    // The error summary, the "Copied" label and the dialog all take focus; the panel of filters and the list are content.
    expect(verdicts.counts).toMatchObject({ unexposed: 1, focused: 3, content: 2 })
    const model = reader({ 'Our kettles': { verdict: 'pass', evidence: '', confidence: 'high' } })
    const judged = await checkSnapshot(snapshot, engine, probeCheckOptions({ llm: true, provider: model }))
    expect(reviewByRule(judged, STATUS_RULE)).toEqual([])
    expect(judged.findings.filter((f) => f.criterion === '4.1.3')).toEqual([])
    expect(data.triggers.filter((t) => t.skip).map((t) => `${t.label} ${t.skip?.reason}`)).toEqual(['E-mail sensitive-form', 'Delete all filters destructive'])
    expect((servers?.requests ?? []).filter((r) => r.includes('touched'))).toEqual([])
  })

  it('replays a saved snapshot offline to the same results', async () => {
    const { snapshot, engine } = await probed('status-fail.html')
    const live = await checkSnapshot(snapshot, engine, probeCheckOptions())
    const dir = await mkdtemp(join(tmpdir(), 'rampa-status-'))
    const path = join(dir, 'status.snapshot.json')
    await writeFile(path, JSON.stringify(snapshot), 'utf8')
    await writeFile(join(dir, 'status.engine.json'), JSON.stringify(engine), 'utf8')
    const loaded = await loadRecorded(path, 'en')
    const replayed = await checkSnapshot(loaded.snapshot, loaded.engine, probeCheckOptions())
    const key = (report: Report) => (report.needsReview ?? []).map((r) => `${r.ruleId} ${r.ref} ${r.evidence}`)
    expect(key(replayed)).toEqual(key(live))
    expect(replayed.coverage.probes).toEqual(live.coverage.probes)
  })
})

import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import { memoryCache } from '../src/core/cache.ts'
import { checkSnapshot } from '../src/core/check.ts'
import { CRITERIA, DEFAULT_CRITERIA } from '../src/criteria/index.ts'
import { infoAndRelationships, styledHeadings } from '../src/criteria/info-and-relationships.ts'
import { labelsOrInstructions } from '../src/criteria/labels-or-instructions.ts'
import { asksForDate, formatShownIn } from '../src/criteria/options-and-formats.ts'
import { besideBox, containsLabel, untiedLabels, visibleLabelInName } from '../src/criteria/visible-label-in-name.ts'
import { ACT_RULES } from '../src/eval/act.ts'
import { CORRUPTORS } from '../src/eval/pairs.ts'
import type { JudgeRequest, ModelProvider } from '../src/providers/types.ts'
import { browserNamed } from '../src/snapshot/ax.ts'
import { type Look, bodyLookOf, lookOf, sameLook, standsOut } from '../src/snapshot/look.ts'
import { walkTree } from '../src/snapshot/tree.ts'
import { type Collected, collectWeb, launchBrowser } from '../src/surfaces/web.ts'
import { node } from './helpers.ts'

const heading: Look = { size: 24, weight: 700, family: 'georgia', color: 'rgb(17, 34, 51)' }
const body: Look = { size: 16, weight: 400, family: 'arial', color: 'rgb(34, 34, 34)' }

describe('looks (1.3.1, F2)', () => {
  it('match on size within half a pixel, and on weight, family, style, case and color', () => {
    expect(sameLook(heading, { ...heading, size: 24.5 })).toBe(true)
    expect(sameLook(heading, { ...heading, size: 25 })).toBe(false)
    expect(sameLook(heading, { ...heading, weight: 600 })).toBe(false)
    expect(sameLook(heading, { ...heading, color: 'rgb(0, 0, 0)' })).toBe(false)
    expect(sameLook(heading, { ...heading, italic: true })).toBe(false)
    expect(sameLook(heading, { ...heading, caps: 'uppercase' })).toBe(false)
  })

  it('stand out from body text when two pixels larger, or bold where the body is not', () => {
    expect(standsOut(heading, body)).toBe(true)
    expect(standsOut({ ...body, size: 17 }, body)).toBe(false)
    expect(standsOut({ ...body, weight: 700 }, body)).toBe(true)
    expect(standsOut({ ...body, weight: 700 }, { ...body, weight: 700 })).toBe(false)
  })
})

describe('visible labels beside a field (2.5.3)', () => {
  it('sit to its left on the same line, above it and aligned, or to the right of a checkbox', () => {
    const field = { x: 100, y: 100, width: 200, height: 30 }
    expect(besideBox({ x: 40, y: 105, width: 50, height: 20 }, field, false)).toBe('left')
    expect(besideBox({ x: 100, y: 70, width: 80, height: 20 }, field, false)).toBe('above')
    expect(besideBox({ x: 100, y: 20, width: 80, height: 20 }, field, false)).toBeUndefined()
    expect(besideBox({ x: 310, y: 105, width: 80, height: 20 }, field, false)).toBeUndefined()
    expect(besideBox({ x: 310, y: 105, width: 80, height: 20 }, field, true)).toBe('right')
  })

  it('are in a name when their words are, in a row, or nearly (hyphens, a shortened word), marks aside', () => {
    expect(containsLabel('Email address', 'Email')).toBe(true)
    expect(containsLabel('Email address', 'Email *')).toBe(true)
    expect(containsLabel('E-mail address', 'Email')).toBe(true)
    expect(containsLabel('Information about shipping', 'Info')).toBe(true)
    expect(containsLabel('Your address', 'Email')).toBe(false)
    expect(containsLabel('Number of phone', 'Phone number')).toBe(false)
  })
})

describe('dates typed in a text field (3.3.2)', () => {
  const field = (attributes: Record<string, string>, name?: string) => node({ ref: '#f', role: 'textbox', name, native: { tag: 'input', attributes } })
  it('are read from the label, the name, the id or the autocomplete token, in the field language', () => {
    expect(asksForDate(field({ id: 'dob' }), 'en', 'Date of birth')).toBe(true)
    expect(asksForDate(field({ name: 'dataNascimento' }), 'pt-BR', undefined)).toBe(true)
    expect(asksForDate(field({ autocomplete: 'cc-exp' }), 'en', 'Card')).toBe(true)
    expect(asksForDate(field({ name: 'fecha' }), 'es', undefined)).toBe(true)
    // "data" is a date only in Portuguese; a native date field and one with a pattern are not asked about.
    expect(asksForDate(field({ name: 'data' }), 'en', 'Your data')).toBe(false)
    expect(asksForDate(field({ type: 'date' }), 'en', 'Date of birth')).toBe(false)
    expect(asksForDate(field({ pattern: '\\d{2}/\\d{2}/\\d{4}' }), 'en', 'Date of birth')).toBe(false)
    expect(asksForDate(field({ class: 'form-control datepicker' }), 'en', 'Date of birth')).toBe(false)
  })

  it('show their format by naming its parts or by an example', () => {
    expect(formatShownIn(['Start date (DD/MM/YYYY)'])).toBe('Start date (DD/MM/YYYY)')
    expect(formatShownIn([undefined, 'Ex.: 01/02/2000'])).toBe('Ex.: 01/02/2000')
    expect(formatShownIn(['Data de nascimento', 'dia mês ano'])).toBe('dia mês ano')
    expect(formatShownIn(['Date of birth', 'Required'])).toBeUndefined()
  })
})

describe('the C14 modules in the registry', () => {
  it('judge 1.3.1 and 2.5.3 on request, with pairs, and are not defaults', () => {
    expect(CRITERIA.get('1.3.1')).toBe(infoAndRelationships)
    expect(CRITERIA.get('2.5.3')).toBe(visibleLabelInName)
    expect(DEFAULT_CRITERIA).not.toContain('1.3.1')
    expect(DEFAULT_CRITERIA).not.toContain('2.5.3')
    expect(ACT_RULES['1.3.1']).toEqual({ syntax: [], semantic: [], pairs: ['b49b2e'] })
    expect(ACT_RULES['2.5.3']).toEqual({ syntax: ['2ee8b8'], semantic: [], pairs: ['cc0f0a'] })
    expect(CORRUPTORS['1.3.1']?.map((corruptor) => corruptor.id)).toEqual(['heading-as-text'])
    expect(CORRUPTORS['2.5.3']?.map((corruptor) => corruptor.id)).toEqual(['label-detached'])
  })
})

// Integration: needs Chrome or Edge.
const browser = await launchBrowser().catch((error: unknown) => {
  process.stderr.write(`\nSkipping the C14 page tests: no browser started (${error instanceof Error ? error.message.split('\n')[0] : String(error)}).\n`)
  return undefined
})
afterAll(async () => browser?.close(), 60_000)

let collected: Promise<Collected> | undefined
function collect(): Promise<Collected> {
  if (!browser) throw new Error('no browser')
  collected ??= collectWeb(browser, pathToFileURL(resolve('test/fixtures/criteria/structure.html')).href, { runAxe: true, locale: 'en' })
  return collected
}

/** Fails every new question, as a model that always finds a problem would; passes the fields 3.3.2 judged before. */
function failingModel(): ModelProvider & { asked: string[] } {
  const asked: string[] = []
  return {
    id: 'stub:structure',
    asked,
    async judge<T>(request: JudgeRequest<T>) {
      const quoted = (tag: string) => new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`).exec(request.user)?.[1] ?? ''
      let output: unknown
      if (request.schemaName === 'wcag_1_3_1_judgment') output = { introduces: 'returns', verdict: 'fail', evidence: quoted('text'), confidence: 'high' }
      else if (request.schemaName === 'wcag_2_5_3_judgment') output = { labels: true, verdict: 'fail', evidence: quoted('text'), confidence: 'high' }
      else if (request.system.includes('ONE group of options')) output = { shown: '', rule: '', verdict: 'fail', problem: 'no_visible_label', evidence: quoted('name'), confidence: 'high' }
      else if (request.system.includes('asks for a date')) output = { shown: quoted('name'), rule: 'DD/MM/YYYY', verdict: 'fail', problem: 'rule_not_explained', evidence: quoted('name'), confidence: 'high' }
      else output = { shown: quoted('name'), rule: '', verdict: 'pass', problem: 'none', evidence: quoted('name'), confidence: 'high' }
      asked.push(`${request.schemaName} ${quoted('text') || quoted('name')}`)
      return { output: request.schema.parse(output), inputTokens: 100, outputTokens: 20, latencyMs: 1, modelId: 'stub' }
    },
  }
}

describe.skipIf(!browser)('C14 on a page', { timeout: 60_000 }, () => {
  it('records the look of headings, of short blocks that could be headings, and of the body text', async () => {
    const { snapshot } = await collect()
    const byId = new Map([...walkTree(snapshot.root)].map((n) => [(n.native.attributes as Record<string, string> | undefined)?.id ?? n.ref, n]))
    const h2 = [...walkTree(snapshot.root)].find((n) => n.native.tag === 'h2')
    expect(h2 && lookOf(h2)).toEqual({ size: 24, weight: 700, family: 'georgia', color: 'rgb(17, 34, 51)' })
    expect(lookOf(byId.get('fake-heading') ?? node({ ref: 'x' }))).toEqual(h2 && lookOf(h2))
    expect(lookOf(byId.get('lead') ?? node({ ref: 'x' }))?.size).toBe(20)
    // A flex item is a block, with the body's look; the row that holds a field gets none.
    expect(lookOf(byId.get('email-text') ?? node({ ref: 'x' }))).toEqual(body)
    expect([...walkTree(snapshot.root)].filter((n) => n.native.tag === 'div' && lookOf(n))).toEqual([byId.get('price')])
    expect(bodyLookOf(snapshot.root)).toEqual({ size: 16, weight: 400, family: 'arial', color: 'rgb(34, 34, 34)' })
  })

  it('finds text styled as a real heading and followed by content; leaves prices, other looks, a subtitle, a lead-in and a label over one link', async () => {
    const { snapshot } = await collect()
    const found = styledHeadings(browserNamed(snapshot))
    expect(found.map((c) => [c.ref, c.context.text, c.context.level])).toEqual([['#fake-heading', 'Returns', 2]])
    expect(found[0]?.context.after).toBe('You can return any item within thirty days of delivery, at no cost to you.')
  })

  it('finds visible text beside a field that is not tied to it and not in its name', async () => {
    const { snapshot, engine } = await collect()
    const found = untiedLabels(browserNamed(snapshot), engine)
    expect(found.map((c) => `${c.ref} "${c.context.text}" ${c.context.where} "${c.context.name}"`)).toEqual([
      '#email "Email" left "Your address"',
      '#news "Send me the newsletter" right "Opt in"',
    ])
  })

  it('adds to 3.3.2 an option group with no question and dates with no format, and leaves the rest', async () => {
    const { snapshot, engine } = await collect()
    const found = labelsOrInstructions.candidates(browserNamed(snapshot), engine).filter((c) => c.context.kind)
    expect(found.map((c) => `${c.context.kind} ${c.ref} ${c.context.name}`)).toEqual(['format #birth Date of birth', 'format #validade Validade do cartão', 'group #yes Yes / No'])
  })

  it('reports each below the default threshold, with a patch where a start tag can carry it', async () => {
    const { snapshot, engine } = await collect()
    const model = failingModel()
    const report = await checkSnapshot(snapshot, engine, {
      criteria: [infoAndRelationships, visibleLabelInName, labelsOrInstructions],
      llm: true,
      provider: model,
      runs: 1,
      cache: memoryCache(),
      offline: false,
      locale: 'en',
      minConfidence: 'medium',
      concurrency: 2,
    })
    const judged = (f: { source: string; criterion: string }) => f.source === 'judgment' && ['1.3.1', '2.5.3', '3.3.2'].includes(f.criterion)
    expect(report.findings.filter(judged)).toEqual([])
    const below = report.belowThreshold.filter(judged)
    expect(below.map((f) => `${f.criterion} ${f.ref} ${f.confidence}`).sort()).toEqual([
      '1.3.1 #fake-heading low',
      '2.5.3 #email low',
      '2.5.3 #news low',
      '3.3.2 #birth low',
      '3.3.2 #validade low',
      '3.3.2 #yes low',
    ])
    const byRef = (criterion: string, ref: string) => below.find((f) => f.criterion === criterion && f.ref === ref)
    expect(byRef('1.3.1', '#fake-heading')?.message).toMatch(/^"Returns" looks exactly like the page's level 2 headings, such as "Delivery" \(24 px, weight 700, georgia\)/)
    expect(byRef('1.3.1', '#fake-heading')?.patch?.after).toBe('<p id="fake-heading" class="h2" role="heading" aria-level="2">')
    expect(byRef('2.5.3', '#email')?.message).toMatch(/^The text "Email" shows as this field's label, but its accessible name is "Your address" \(from aria-label\)/)
    expect(byRef('2.5.3', '#email')?.patch?.after).toBe('<input id="email" type="email" aria-label="Email">')
    expect(byRef('3.3.2', '#yes')?.message).toMatch(/^Nothing on screen says what the options "Yes", "No" choose/)
    expect(byRef('3.3.2', '#yes')?.patch).toBeUndefined()
    expect(byRef('3.3.2', '#birth')?.message).toBe('The field "Date of birth" asks for a date, and nothing on screen shows the format to type it in (such as DD/MM/YYYY).')
    expect(byRef('3.3.2', '#birth')?.patch?.after).toBe('<input id="birth" name="birth" aria-describedby="birth-hint"> <span id="birth-hint">DD/MM/YYYY</span>')
  })
})

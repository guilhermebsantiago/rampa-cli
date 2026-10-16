import { describe, expect, it } from 'vitest'
import { inventedLimit, wordingCandidates } from '../src/advisory/checks/error-wording.ts'
import { PLAIN_PHRASES, isPlainExpression, isPlainText, literalCandidates, literalSystem } from '../src/advisory/checks/literal-language.ts'
import { SUMMARY_WORDS, summaryCandidate } from '../src/advisory/checks/long-text-summary.ts'
import { ERROR_LABEL, FAILURE_WORDING } from '../src/advisory/messages.ts'
import { readPage } from '../src/advisory/page.ts'
import { runProfiles } from '../src/advisory/profile.ts'
import type { Advisory, AdvisorySection } from '../src/advisory/types.ts'
import { FAIL_ON, exitCode } from '../src/cli/exit-code.ts'
import { memoryCache } from '../src/core/cache.ts'
import { checkSnapshot } from '../src/core/check.ts'
import { type SiteReport, siteExitCode } from '../src/core/site.ts'
import type { Finding, Report } from '../src/core/types.ts'
import type { Locale } from '../src/i18n.ts'
import { snapshotSignature } from '../src/probes/identity.ts'
import type { ModelProvider } from '../src/providers/types.ts'
import { paint } from '../src/report/color.ts'
import { renderHtml } from '../src/report/html.ts'
import { renderMarkdown } from '../src/report/markdown.ts'
import { renderReport } from '../src/report/pretty.ts'
import { toSarif } from '../src/report/sarif.ts'
import type { A11yNode, A11ySnapshot } from '../src/snapshot/schema.ts'
import { noEngine, profileOf, testDictionaries } from './coga-helpers.ts'
import { node } from './helpers.ts'

/**
 * The three checks of the cognitive profile that a model decides (coga/literal-language, coga/long-text-summary,
 * coga/error-wording), with the model stubbed: what runs them, what they ask, what the quote check throws away, and
 * that what they report is a suggestion in every output, which never changes the exit code. scripts/coga-model-fixtures.ts
 * runs their fixtures against a real model.
 */

const MODEL_CHECKS = ['coga/literal-language', 'coga/long-text-summary', 'coga/error-wording']

function el(ref: string, tag: string, attributes: Record<string, string> = {}, extra: Partial<A11yNode> = {}): A11yNode {
  const markup = Object.entries(attributes)
    .map(([name, value]) => ` ${name}="${value}"`)
    .join('')
  return node({ ref, ...extra, native: { tag, attributes, html: `<${tag}${markup}>` } })
}

/** Exactly `count` words of prose, ten to a sentence. */
function prose(count: number, word = 'river'): string {
  const words = Array.from({ length: count }, (_, i) => (i % 10 === 0 ? `${word[0]?.toUpperCase()}${word.slice(1)}` : word))
  return words.map((w, i) => (i % 10 === 9 || i === count - 1 ? `${w}.` : w)).join(' ')
}

interface PageParts {
  lang?: string
  /** Paragraphs of the article. */
  paragraphs?: string[]
  /** A heading at the top of the article. */
  start?: string
  buttons?: string[]
  /** An e-mail field in an error state, with this message. */
  error?: string
  /** A field labelled only by its placeholder: a rule advisory (coga/visible-labels). */
  placeholderOnly?: boolean
}

function page(parts: PageParts = {}): A11ySnapshot {
  const lang = parts.lang ?? 'en'
  const article: A11yNode[] = [el('h1', 'h1', {}, { role: 'heading', text: 'Changes to bin collections' })]
  if (parts.start) article.push(el('h2.start', 'h2', {}, { role: 'heading', text: parts.start }))
  for (const [index, text] of (parts.paragraphs ?? []).entries()) article.push(el(`p${index + 1}`, 'p', {}, { role: 'paragraph', text }))
  const form: A11yNode[] = []
  // First in the form, with nothing before it that could read as its label.
  if (parts.placeholderOnly) form.push(el('div.phone', 'div', {}, { children: [el('#phone', 'input', { id: 'phone', type: 'tel', placeholder: 'Your phone' }, { role: 'textbox' })] }))
  if (parts.error !== undefined) {
    form.push(el('label.email', 'label', { for: 'email' }, { text: 'Email address' }))
    form.push(el('#email', 'input', { id: 'email', type: 'email', 'aria-invalid': 'true', 'aria-describedby': 'email-error' }, { role: 'textbox', name: 'Email address' }))
    form.push(el('#email-error', 'span', { id: 'email-error', class: 'error-message' }, { text: parts.error }))
  }
  for (const [index, text] of (parts.buttons ?? []).entries()) form.push(el(`button${index + 1}`, 'button', { type: 'button' }, { role: 'button', name: text, text }))
  return {
    schemaVersion: 1,
    surface: 'web',
    target: 'test://model-checks',
    title: 'Bin collections',
    locale: lang,
    viewport: { width: 1280, height: 800, scale: 1 },
    collectedAt: '2026-10-15T00:00:00.000Z',
    collector: { name: 'test', version: '0' },
    root: el('html', 'html', { lang }, {
      role: 'document',
      lang,
      children: [
        el('body', 'body', {}, {
          children: [el('main', 'main', {}, { role: 'main', children: [el('article', 'article', {}, { role: 'article', children: article }), el('form', 'form', {}, { role: 'form', children: form })] })],
        }),
      ],
    }),
  }
}

type Answer = (question: { check: string; user: string; text: string }) => Record<string, unknown>

/** A model that answers each question by `answer`, batches included (one judgment per <item>), and counts its calls. */
function stubModel(answer: Answer): ModelProvider & { calls: number; questions: string[] } {
  const provider = {
    id: 'test:stub',
    calls: 0,
    /** `check: text` for each question asked. */
    questions: [] as string[],
    async judge<T>(request: { system: string; user: string; schema: { parse(value: unknown): T } }) {
      provider.calls++
      const check = request.system.includes('long text') ? 'coga/long-text-summary' : request.system.includes('error message') ? 'coga/error-wording' : 'coga/literal-language'
      const ask = (user: string) => {
        const text = /<text>([\s\S]*?)<\/text>/.exec(user)?.[1] ?? /<message>([\s\S]*?)<\/message>/.exec(user)?.[1] ?? ''
        provider.questions.push(`${check}: ${text}`)
        return answer({ check, user, text })
      }
      const items = [...request.user.matchAll(/<item id="(\d+)">\n([\s\S]*?)\n<\/item>/g)]
      const output = items.length > 0 ? { items: items.map((item) => ({ id: item[1], judgment: ask(item[2] ?? '') })) } : ask(request.user)
      return { output: request.schema.parse(output), inputTokens: 10, outputTokens: 5, latencyMs: 1, modelId: 'test:stub' }
    },
  }
  return provider
}

/** Texts of the test page that the stub reads as literal. */
const LITERAL = new Set(['Changes to bin collections', 'Email address', 'Invalid input', 'Em resumo'])

/** What a model that finds a problem everywhere says: an idiom in every other text, no summary, a vague message. */
const sayNo: Answer = ({ check, user, text }) => {
  if (check === 'coga/literal-language') {
    return LITERAL.has(text)
      ? { kind: 'literal', expression: '', meaning: '', verdict: 'pass', evidence: text, confidence: 'high' }
      : { kind: 'idiom', expression: text, meaning: 'say it plainly', verdict: 'fail', evidence: text, confidence: 'high' }
  }
  if (check === 'coga/long-text-summary') {
    const first = /\[paragraph\] ([^.]*\.)/.exec(user)?.[1] ?? ''
    return { summary: false, verdict: 'fail', evidence: first, confidence: 'high' }
  }
  return { isError: true, howToFix: false, suggestion: 'Enter your email address with an @, like name@example.com', verdict: 'fail', evidence: text, confidence: 'high' }
}

const LONG = [prose(110), prose(110, 'stone'), prose(110, 'cloud')]
/** A page with something for each check: a long article, a button with an idiom, a field with a vague message. */
const all = () => page({ paragraphs: LONG, buttons: ['Get the ball rolling'], error: 'Invalid input' })

async function report(snapshot: A11ySnapshot, provider: ModelProvider | undefined, extra: { locale?: Locale; llm?: boolean; batch?: boolean } = {}): Promise<Report> {
  return checkSnapshot(snapshot, noEngine, {
    criteria: [],
    rules: false,
    llm: extra.llm ?? true,
    provider,
    runs: 1,
    cache: memoryCache(),
    offline: false,
    locale: extra.locale ?? 'en',
    minConfidence: 'medium',
    concurrency: 2,
    batch: extra.batch,
    profiles: ['cognitive'],
    coga: { dictionaries: async () => Promise.reject(new Error('no dictionary in this test')) },
  })
}

const own = (section: AdvisorySection | undefined, check: string): Advisory[] => [...(section?.results ?? []), ...(section?.belowThreshold ?? [])].filter((advisory) => advisory.check === check)

describe('checks a model decides: when they run', () => {
  it('say they did not run, and why, with --no-llm or no model; the patterns they screen are then not run', async () => {
    const snapshot = page({ paragraphs: LONG, buttons: ['Get the ball rolling'], error: 'Invalid input' })
    const off = await profileOf(snapshot)
    const none = await profileOf(snapshot, { llm: true, provider: undefined })
    for (const check of MODEL_CHECKS) {
      expect(off.checks.find((summary) => summary.check === check)).toMatchObject({ ran: false, review: true, maturity: 'experimental', reason: 'this check needs a model, and --no-llm turned the model off' })
      expect(none.checks.find((summary) => summary.check === check)).toMatchObject({ ran: false, reason: 'this check needs a model, and none was set: --model or RAMPA_MODEL' })
      expect(own(off, check)).toEqual([])
    }
    for (const slug of ['o3p04-literal-language', 'o3p08-summary-provided', 'o4p04-supportive-forms']) expect(off.coverage.patterns[slug]).toBe('not-run')
    const pt = await profileOf(snapshot, { locale: 'pt-BR' })
    expect(pt.checks.find((summary) => summary.check === 'coga/literal-language')?.reason).toBe('esta verificação precisa de um modelo, e o --no-llm desligou o modelo')
  })

  it('run with a model, mark the patterns screened, and cite GAIA G02 for literal language', async () => {
    const model = stubModel(sayNo)
    const { advisory } = await report(page({ paragraphs: LONG, buttons: ['Get the ball rolling'], error: 'Invalid input' }), model)
    for (const check of MODEL_CHECKS) expect(advisory?.checks.find((summary) => summary.check === check)).toMatchObject({ ran: true, review: true })
    for (const slug of ['o3p04-literal-language', 'o3p08-summary-provided', 'o4p04-supportive-forms']) expect(advisory?.coverage.patterns[slug]).toBe('screened')
    expect(advisory?.coverage.gaia?.G02).toBe('screened')
  })
})

describe('coga/long-text-summary: the 300-word trigger', () => {
  it('asks nothing at 300 words of paragraphs, and asks once at 301', async () => {
    const at = [prose(100), prose(100, 'stone'), prose(100, 'cloud')]
    expect(summaryCandidate(readPage(page({ paragraphs: at })))).toEqual({ words: SUMMARY_WORDS })
    const quiet = stubModel(sayNo)
    expect(own((await report(page({ paragraphs: at }), quiet)).advisory, 'coga/long-text-summary')).toEqual([])
    expect(quiet.questions.filter((question) => question.startsWith('coga/long-text-summary'))).toEqual([])

    const over = [...at.slice(0, 2), prose(101, 'cloud')]
    expect(summaryCandidate(readPage(page({ paragraphs: over }))).words).toBe(301)
    const asked = stubModel(sayNo)
    const [result, ...rest] = own((await report(page({ paragraphs: over }), asked)).advisory, 'coga/long-text-summary')
    expect(rest).toEqual([])
    expect(result).toMatchObject({ ref: 'article', impact: 'suggestion', review: true, facts: { words: 301, threshold: 300, firstSentence: 'River river river river river river river river river river.' } })
    expect(result?.message).toContain('This text has 301 words, and a model read its start and found no short summary of what follows.')
  })

  it('takes a heading such as "Em resumo" at the start as a summary, without asking a model', async () => {
    const snapshot = page({ lang: 'pt-BR', start: 'Em resumo', paragraphs: LONG })
    expect(summaryCandidate(readPage(snapshot)).candidate?.context.marked).toBe('Em resumo')
    const model = stubModel(sayNo)
    const { advisory } = await report(snapshot, model)
    expect(own(advisory, 'coga/long-text-summary')).toEqual([])
    expect(model.questions.filter((question) => question.startsWith('coga/long-text-summary'))).toEqual([])
    expect(advisory?.checks.find((summary) => summary.check === 'coga/long-text-summary')?.model).toMatchObject({ asked: 1, answered: 1, kept: 0 })
  })
})

describe('the quote check', () => {
  const invented: Answer = ({ check, text }) => {
    if (check === 'coga/literal-language') return { kind: 'idiom', expression: 'the big red button', meaning: 'the main button', verdict: 'fail', evidence: 'Click the big red button', confidence: 'high' }
    if (check === 'coga/long-text-summary') return { summary: false, verdict: 'fail', evidence: 'This sentence is not on the page.', confidence: 'high' }
    return { isError: true, howToFix: false, suggestion: 'Enter your email', verdict: 'fail', evidence: `${text} (and something it never said)`, confidence: 'high' }
  }

  it('discards a claim whose quote is not on the page, for each of the three checks', async () => {
    const { advisory } = await report(page({ paragraphs: LONG, buttons: ['Get the ball rolling'], error: 'Invalid input' }), stubModel(invented))
    // Literal language asks about the heading, the label, the button and the message.
    const asked: Record<string, number> = { 'coga/literal-language': 4, 'coga/long-text-summary': 1, 'coga/error-wording': 1 }
    for (const check of MODEL_CHECKS) {
      expect(own(advisory, check)).toEqual([])
      const count = asked[check] ?? 0
      expect(advisory?.checks.find((summary) => summary.check === check)?.model).toMatchObject({ asked: count, answered: count, kept: 0, discarded: count })
    }
  })

  it('discards an expression that is not words of the text, or a claim with no plain meaning', async () => {
    const elsewhere = stubModel(({ text }) => ({ kind: 'idiom', expression: 'piece of cake', meaning: 'very easy', verdict: 'fail', evidence: text, confidence: 'high' }))
    const away = (await report(page({ buttons: ['Get the ball rolling'] }), elsewhere)).advisory
    expect(own(away, 'coga/literal-language')).toEqual([])
    expect(away?.checks.find((summary) => summary.check === 'coga/literal-language')?.model).toMatchObject({ asked: 2, discarded: 2 })
    const unexplained = stubModel(({ text }) => ({ kind: 'idiom', expression: 'the ball rolling', meaning: '', verdict: 'fail', evidence: text, confidence: 'high' }))
    expect(own((await report(page({ buttons: ['Get the ball rolling'] }), unexplained)).advisory, 'coga/literal-language')).toEqual([])
  })
})

describe('coga/literal-language: plain interface words', () => {
  it('has a list of plain phrases in English and Portuguese, sent with every question', () => {
    for (const phrase of ['sign in', 'shopping cart', 'add to cart', 'home page', 'log in']) expect(PLAIN_PHRASES.en).toContain(phrase)
    for (const phrase of ['entrar', 'carrinho de compras', 'página inicial', 'fale conosco', 'esqueci minha senha']) expect(PLAIN_PHRASES.pt).toContain(phrase)
    expect(literalSystem('en')).toContain('sign in; sign up')
    expect(literalSystem('en')).toContain('shopping cart')
    expect(literalSystem('pt-BR')).toContain('carrinho de compras')
  })

  it('never asks about a text made only of one, in either language', () => {
    expect(isPlainText('Sign in', 'en')).toBe(true)
    expect(isPlainText('Shopping cart', 'en')).toBe(true)
    expect(isPlainText('Carrinho de compras', 'pt-BR')).toBe(true)
    expect(isPlainText('Get the ball rolling', 'en')).toBe(false)
    const asked = literalCandidates(readPage(page({ buttons: ['Sign in', 'Shopping cart', 'Add to cart', 'Log out', 'Get the ball rolling'] }))).candidates.map((c) => c.context.text)
    expect(asked).toEqual(['Changes to bin collections', 'Get the ball rolling'])
    const pt = literalCandidates(readPage(page({ lang: 'pt-BR', buttons: ['Carrinho de compras', 'Fale conosco', 'Esqueci minha senha', 'Bata o martelo'] }))).candidates.map((c) => c.context.text)
    expect(pt).toEqual(['Changes to bin collections', 'Bata o martelo'])
  })

  it('discards a claim on a plain phrase inside a longer text', async () => {
    expect(isPlainExpression('cart', 'Your shopping cart is empty', 'en')).toBe(true)
    expect(isPlainExpression('shopping cart', 'Your shopping cart is empty', 'en')).toBe(true)
    expect(isPlainExpression('carrinho', 'Seu carrinho está vazio', 'pt-BR')).toBe(true)
    expect(isPlainExpression('the ball rolling', 'Get the ball rolling', 'en')).toBe(false)
    const model = stubModel(({ text }) => ({ kind: 'metaphor', expression: 'shopping cart', meaning: 'the list of things you will buy', verdict: 'fail', evidence: text, confidence: 'high' }))
    const { advisory } = await report(page({ buttons: ['Your shopping cart is empty'] }), model)
    expect(own(advisory, 'coga/literal-language')).toEqual([])
    expect(model.questions).toContain('coga/literal-language: Your shopping cart is empty')
  })

  it('reads headings, labels, buttons, instructions and messages, never body prose', () => {
    const snapshot = page({ paragraphs: ['The council finally bit the bullet and changed the collections.'], buttons: ['Get the ball rolling'], error: 'Hold your horses, check the address' })
    const asked = literalCandidates(readPage(snapshot)).candidates.map((c) => `${c.context.where}: ${c.context.text}`)
    expect(asked).toEqual(['heading: Changes to bin collections', 'label: Email address', 'button: Get the ball rolling', 'message: Hold your horses, check the address'])
  })

  it('reports the expression and its meaning as a suggestion, at most five per page, with a note for the rest', async () => {
    const buttons = ['Get the ball rolling', 'Break a leg today', 'Bite the bullet now', 'Hit the road soon', 'Spill the beans here', 'Cut to the chase please']
    const { advisory } = await report(page({ buttons }), stubModel(sayNo))
    const found = own(advisory, 'coga/literal-language')
    expect(found).toHaveLength(5)
    expect(found[0]).toMatchObject({ ref: 'button1', impact: 'suggestion', source: 'judgment', review: true, confidence: 'medium', model: 'test:stub', facts: { where: 'button', expression: 'Get the ball rolling', meaning: 'say it plainly' } })
    expect(found[0]?.message).toBe(
      '"Get the ball rolling" in this button is an idiom, which a person who takes words literally may not understand: "Get the ball rolling". Suggestion to review, from test:stub: it means "say it plainly". Write that, or add it in brackets after the expression. COGA recommends literal language, starting with headings, labels, navigation, instructions and messages, and an explanation next to any metaphor; GAIA (G02) asks to avoid metaphors and non-literal text.',
    )
    expect(advisory?.notes).toContain('coga/literal-language: 1 more suggestion is not listed (at most 5 per page).')
  })
})

describe('coga/error-wording', () => {
  it('asks about the messages of fields in an error state, and leaves one with a WCAG 3.3.3 result to it', async () => {
    const snapshot = page({ error: 'Invalid input' })
    expect(wordingCandidates(readPage(snapshot)).map((c) => ({ ref: c.ref, text: c.context.text, fieldRef: c.context.fieldRef, label: c.context.label }))).toEqual([
      { ref: '#email-error', text: 'Invalid input', fieldRef: '#email', label: 'Email address' },
    ])
    const model = stubModel(sayNo)
    const finding = { fingerprint: 'f', criterion: '3.3.3', level: 'AA', source: 'rule', ref: '#email', message: 'm', confidence: 'medium' } as Finding
    const section = await profileOf(snapshot, { findings: [finding], llm: true, provider: model })
    expect(own(section, 'coga/error-wording')).toEqual([])
    expect(model.questions.filter((question) => question.startsWith('coga/error-wording'))).toEqual([])
    expect(section.checks.find((summary) => summary.check === 'coga/error-wording')).toMatchObject({ ran: true, candidates: 1, model: { asked: 0 } })
    // A 3.3.1 judgment on the message itself, or a 3.3.3 item to review on the field, leaves it alone too.
    const judged = { ...finding, criterion: '3.3.1', ref: '#email-error' }
    expect(own(await profileOf(snapshot, { findings: [judged], llm: true, provider: stubModel(sayNo) }), 'coga/error-wording')).toEqual([])
    const review = { criterion: '3.3.3', level: 'AA' as const, ruleId: 'rampa/error-suggestion', ref: '#email', message: 'm' }
    expect(own(await profileOf(snapshot, { review: [review], llm: true, provider: stubModel(sayNo) }), 'coga/error-wording')).toEqual([])
    expect(own(await profileOf(snapshot, { llm: true, provider: stubModel(sayNo) }), 'coga/error-wording')).toHaveLength(1)
    expect(section.notes).toContain('coga/error-wording: 1 message was left to the WCAG 3.3.1 or 3.3.3 result on the same element.')
  })

  it('quotes the message and suggests a clearer one, leaving out a wording that states a limit the page does not give', async () => {
    const [plain] = own((await report(page({ error: 'Invalid input' }), stubModel(sayNo))).advisory, 'coga/error-wording')
    expect(plain).toMatchObject({ ref: '#email-error', subject: 'Invalid input', impact: 'suggestion', review: true, facts: { field: 'Email address', suggestion: 'Enter your email address with an @, like name@example.com' } })
    expect(plain?.message).toContain('This message for the field "Email address" says something is wrong, but not, in plain words, how to put it right: "Invalid input".')
    const limit = stubModel(({ text }) => ({ isError: true, howToFix: false, suggestion: 'Use at least 12 characters', verdict: 'fail', evidence: text, confidence: 'high' }))
    const [dropped] = own((await report(page({ error: 'Invalid input' }), limit)).advisory, 'coga/error-wording')
    expect(dropped?.facts).toMatchObject({ suggestionLeftOut: 'at least 12' })
    expect(dropped?.facts?.suggestion).toBeUndefined()
    expect(dropped?.message).toContain('Say what to enter, in everyday words. The wording a model proposed was left out, as it states a limit the page does not give ("at least 12").')
  })

  it('reads the messages that showed after --probe form typed into a field, but not a hint that was already there', () => {
    const snapshot = page({ buttons: ['Search'] })
    const zip = el('#zip', 'input', { id: 'zip', name: 'zip', inputmode: 'numeric' }, { role: 'textbox', name: 'ZIP code' })
    const hint = el('#zip-hint', 'p', { id: 'zip-hint' }, { text: 'Required field' })
    const form = snapshot.root.children[0]?.children[0]?.children[1]
    form?.children.push(zip, hint)
    const after = (text: string, ref: string) => ({
      ref: '#zip',
      label: 'ZIP code',
      type: 'text',
      state: ['aria-invalid'],
      invalid: 'true',
      validity: [],
      messages: [{ ref, text, via: 'aria-describedby', shown: true, inTree: true }],
      hints: [],
      constraints: {},
      announced: [],
    })
    snapshot.observations = {
      probes: [
        {
          kind: 'form',
          version: '1',
          conditions: { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, browser: 'test', variant: 'form' },
          status: 'complete',
          guard: { blocked: [] },
          data: {
            fields: [
              {
                ref: '#zip',
                id: { sig: snapshotSignature(zip) },
                tag: 'input',
                role: 'textbox',
                label: 'ZIP code',
                type: 'text',
                constraints: { pattern: '\\d{5}' },
                results: [
                  { constraint: 'pattern', rule: 'pattern="\\d{5}"', typed: 'abc', validity: ['patternMismatch'], userInvalid: true, reacted: true, after: after('Erro 0x13', '#zip-error') },
                  { constraint: 'required', rule: 'required', typed: '', validity: ['valueMissing'], userInvalid: true, reacted: true, after: after('Required field', '#zip-hint') },
                ],
              },
            ],
          },
        },
      ],
    } as unknown as A11ySnapshot['observations']
    expect(wordingCandidates(readPage(snapshot)).map((c) => ({ ref: c.ref, text: c.context.text, fieldRef: c.context.fieldRef, rules: c.context.rules, from: c.context.from }))).toEqual([
      { ref: '#zip-error', text: 'Erro 0x13', fieldRef: '#zip', rules: ['pattern="\\d{5}"'], from: 'probe' },
    ])
  })

  it('finds a limit the suggestion invents, and lets one the page states through', () => {
    const field = { text: 'Too short', label: 'Password', rules: ['minlength="8"'], hints: [] }
    expect(inventedLimit('Use at least 10 characters', field)).toBe('at least 10')
    expect(inventedLimit('Use at least 8 characters', field)).toBeUndefined()
    expect(inventedLimit('Enter a 5-digit ZIP code', { text: 'Value does not match ^\\d{5}$', label: 'ZIP code', rules: [], hints: [] })).toBeUndefined()
    expect(inventedLimit('O CEP tem 8 números', { text: 'Campo inválido', label: 'CEP', rules: [], hints: [] })).toBe('8 números')
    expect(inventedLimit('Digite a data, por exemplo 25/12/1990', { text: 'Data inválida', label: 'Data', rules: [], hints: [] })).toBeUndefined()
  })
})

describe('a suggestion, never a failure', () => {

  function expectNoFailureWording(text: string, where: string): void {
    const own = text.replace(/"[^"]*"/g, '""').replace(/«[^»]*»/g, '«»')
    expect({ where, match: FAILURE_WORDING.exec(own)?.[0] }).toEqual({ where, match: undefined })
    expect({ where, match: ERROR_LABEL.exec(own)?.[0] }).toEqual({ where, match: undefined })
  }

  it('never changes the exit code, under any --fail-on policy, for a check or a crawl', async () => {
    const result = await report(all(), stubModel(sayNo))
    const suggestions = result.advisory?.results.filter((advisory) => MODEL_CHECKS.includes(advisory.check)) ?? []
    expect(suggestions.map((advisory) => advisory.check).sort()).toEqual([...MODEL_CHECKS].sort())
    expect(suggestions.every((advisory) => advisory.review === true && advisory.impact === 'suggestion' && advisory.kind === 'advisory')).toBe(true)
    expect(result.findings).toEqual([])
    for (const policy of FAIL_ON) expect({ policy, code: exitCode([result], policy) }).toEqual({ policy, code: 0 })
    const site = { pages: [result], siteCriteria: undefined } as unknown as SiteReport
    expect(siteExitCode([site], 'advisory')).toBe(0)

    // A rule advisory on the same page still counts under --fail-on advisory, as before.
    const ruled = await report(page({ paragraphs: LONG, buttons: ['Get the ball rolling'], error: 'Invalid input', placeholderOnly: true }), stubModel(sayNo))
    expect(ruled.advisory?.results.some((advisory) => advisory.check === 'coga/visible-labels' && !advisory.review)).toBe(true)
    expect(exitCode([ruled], 'advisory')).toBe(1)
    expect(exitCode([ruled], 'confirmed')).toBe(0)
  })

  it('does not exit with 2 under --fail-on advisory when the model answers none of their questions', async () => {
    const broken: ModelProvider = {
      id: 'test:broken',
      async judge() {
        throw new Error('connection refused')
      },
    }
    const result = await report(all(), broken)
    expect(result.advisory?.checks.find((summary) => summary.check === 'coga/literal-language')?.model).toMatchObject({ answered: 0, errors: 4 })
    expect(result.advisory?.notes).toContain('coga/literal-language: the model gave no answer for 4 texts.')
    expect(result.advisory?.errors).toContain('connection refused')
    expect(exitCode([result], 'advisory')).toBe(0)
  })

  it('says so in every output format, in English and Portuguese, without failure wording', async () => {
    for (const locale of ['en', 'pt-BR'] as const) {
      const result = await report(all(), stubModel(sayNo), { locale })
      const tag = locale === 'en' ? "a model's suggestion to review (test:stub), its quote checked on the page; it never changes the exit code" : 'sugestão de um modelo para revisar (test:stub), com a citação conferida na página; nunca muda o código de saída'
      const pretty = renderReport(result, { verbose: false, paint: paint(false) })
      const markdown = renderMarkdown([result])
      const html = renderHtml([result])
      expect(pretty).toContain(tag)
      expect(pretty).not.toContain('✗')
      expect(markdown).toContain(tag)
      expect(html.replaceAll('&#39;', "'")).toContain(tag)
      for (const advisory of result.advisory?.results.filter((item) => item.review) ?? []) {
        expectNoFailureWording(advisory.message, `${locale} ${advisory.check}`)
        expectNoFailureWording(advisory.label, `${locale} ${advisory.check} label`)
        expect(advisory.label).toContain(locale === 'en' ? '(not a WCAG requirement)' : '(não é requisito da WCAG)')
      }
      for (const note of result.advisory?.notes ?? []) expectNoFailureWording(note, `${locale} note`)
      const json = JSON.parse(JSON.stringify(result)) as Report
      expect(json.advisory?.results.filter((advisory) => advisory.review).length).toBe(3)
      const run = toSarif([result], { failOn: 'advisory' }).runs[0]
      const results = run?.results.filter((item) => MODEL_CHECKS.includes(String(item.properties?.check))) ?? []
      expect(results).toHaveLength(3)
      expect(results.every((item) => item.level === 'note' && item.properties?.review === true)).toBe(true)
      for (const check of MODEL_CHECKS) expect(run?.tool.driver.rules.find((rule) => rule.id === check)?.properties.tags).toContain('model-suggestion')
    }
  })
})

describe('the judge infrastructure', () => {
  it('keys the cache by the check and its prompt version: a second run asks nothing', async () => {
    const model = stubModel(sayNo)
    const cache = memoryCache()
    const options = {
      profiles: ['cognitive' as const],
      locale: 'en' as const,
      findings: [],
      llm: true,
      provider: model,
      offline: false,
      cache,
      runs: 1,
      concurrency: 2,
      minConfidence: 'low' as const,
      coga: { observe: 0 as const, dictionaries: testDictionaries },
    }
    const first = await runProfiles(all(), noEngine, options)
    const calls = model.calls
    expect(calls).toBeGreaterThan(0)
    const second = await runProfiles(all(), noEngine, options)
    expect(model.calls).toBe(calls)
    expect(second.usage.cachedCalls).toBe(first.usage.calls)
    expect(second.section.results.map((advisory) => advisory.fingerprint)).toEqual(first.section.results.map((advisory) => advisory.fingerprint))
    expect(first.section.checks.find((summary) => summary.check === 'coga/literal-language')?.version).toBe('1+literal-1')
  })

  it('asks several texts in one call with --batch (on with --fast), and keeps to --max-candidates', async () => {
    const buttons = ['Get the ball rolling', 'Break a leg today', 'Bite the bullet now']
    const alone = stubModel(sayNo)
    await report(page({ buttons }), alone)
    const batched = stubModel(sayNo)
    const result = await report(page({ buttons }), batched, { batch: true })
    expect(alone.calls).toBe(4)
    expect(batched.calls).toBe(1)
    expect(own(result.advisory, 'coga/literal-language')).toHaveLength(3)
    expect(result.advisory?.checks.find((summary) => summary.check === 'coga/literal-language')?.model).toMatchObject({ asked: 4, answered: 4, kept: 3 })

    const section = await profileOf(page({ buttons }), { llm: true, provider: stubModel(sayNo), maxCandidates: 2 })
    expect(section.checks.find((summary) => summary.check === 'coga/literal-language')?.model).toMatchObject({ asked: 2, notJudged: 2 })
    expect(section.notes).toContain('coga/literal-language: 2 more texts were not asked about (at most 2 per page, --max-candidates).')
  })
})

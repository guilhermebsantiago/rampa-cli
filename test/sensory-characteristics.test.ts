import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import { memoryCache } from '../src/core/cache.ts'
import { checkSnapshot } from '../src/core/check.ts'
import { CRITERIA, DEFAULT_CRITERIA } from '../src/criteria/index.ts'
import { type SensoryJudgment, lies, sensoryCharacteristics, sensorySentences, shapeEvidence } from '../src/criteria/sensory-characteristics.ts'
import { ACT_RULES } from '../src/eval/act.ts'
import { CORRUPTORS } from '../src/eval/pairs.ts'
import type { JudgeRequest, ModelProvider } from '../src/providers/types.ts'
import { findSensoryInstructions, fold, sensoryLanguageOf } from '../src/rules/words/sensory.ts'
import { browserNamed } from '../src/snapshot/ax.ts'
import { walkTree } from '../src/snapshot/tree.ts'
import { type Collected, collectWeb, launchBrowser } from '../src/surfaces/web.ts'
import { node } from './helpers.ts'

const matched = (text: string, language: 'en' | 'pt' | 'es') =>
  findSensoryInstructions(text, language).map((found) => ({
    phrases: found.phrases.map((phrase) => `${phrase.kind}:${phrase.phrase}`),
    referent: found.referent?.word,
  }))

describe('the sensory matcher (1.3.3)', () => {
  it('nominates instructions that point by place, shape, size, orientation or sound, in English, Portuguese and Spanish', () => {
    expect(matched('Find the menu on the right, to navigate.', 'en')).toEqual([{ phrases: ['location:on the right'], referent: 'menu' }])
    expect(matched('Click the round button for a surprise.', 'en')).toEqual([{ phrases: ['shape:round'], referent: 'button' }])
    expect(matched('Press the big button to start.', 'en')).toEqual([{ phrases: ['size:big'], referent: 'button' }])
    expect(matched('Tap the star to save it.', 'en')).toEqual([{ phrases: ['shape:star'], referent: undefined }])
    expect(matched('Press the star icon to save it.', 'en')).toEqual([{ phrases: ['shape:star'], referent: 'icon' }])
    expect(matched('Start speaking when you hear the beep.', 'en')).toEqual([{ phrases: ['sound:when you hear', 'sound:the beep'], referent: undefined }])
    expect(matched('Clique no botão do lado direito para continuar.', 'pt')).toEqual([{ phrases: ['location:do lado direito'], referent: 'botão' }])
    expect(matched('Use a barra lateral direita.', 'pt')).toEqual([{ phrases: ['location:barra lateral direita'], referent: 'barra lateral' }])
    expect(matched('Veja o menu da esquerda.', 'pt')).toEqual([{ phrases: ['location:da esquerda'], referent: 'menu' }])
    expect(matched('Toque na estrela para favoritar.', 'pt')).toEqual([{ phrases: ['shape:estrela'], referent: undefined }])
    expect(matched('Pulse el botón redondo para empezar.', 'es')).toEqual([{ phrases: ['shape:redondo'], referent: 'botón' }])
    expect(matched('Use el menú de la izquierda.', 'es')).toEqual([{ phrases: ['location:de la izquierda'], referent: 'menú' }])
  })

  it('leaves alone what gives no instruction, idioms, quantities, keys, and size words that describe no thing', () => {
    expect(matched('The menu on the right lists every section.', 'en')).toEqual([])
    expect(matched('A square is a regular quadrilateral.', 'en')).toEqual([])
    expect(matched('Above all, choose what fits you.', 'en')).toEqual([])
    expect(matched('Choose a plan for teams above 10 people.', 'en')).toEqual([])
    expect(matched('Use the up and down arrows to review results.', 'en')).toEqual([])
    expect(matched('Use the arrow keys to move.', 'en')).toEqual([])
    expect(matched('See our offers for small business.', 'en')).toEqual([])
    expect(matched('Veja o abaixo-assinado pela praça.', 'pt')).toEqual([])
    expect(matched('Escolha planos acima de 10 pessoas.', 'pt')).toEqual([])
    expect(matched('Click the round button.', 'pt')).toEqual([])
  })

  it('keeps quoted names and the words that may name something', () => {
    const [found] = findSensoryInstructions('Click the button labelled "howdy", on the right, for a surprise', 'en')
    expect(found?.quoted).toEqual(['howdy'])
    expect(found?.nameWords).toEqual(expect.arrayContaining(['labelled', 'howdy', 'surprise']))
    expect(found?.nameWords).not.toContain('button')
  })

  it('reads languages by their primary tag and folds case and accents one character for one', () => {
    expect(sensoryLanguageOf('pt-BR')).toBe('pt')
    expect(sensoryLanguageOf('es-419')).toBe('es')
    expect(sensoryLanguageOf('fr')).toBeUndefined()
    expect(fold('À Direita')).toBe('a direita')
    expect(fold('Botão ★')).toHaveLength('Botão ★'.length)
  })
})

describe('where things lie and what they look like', () => {
  const page = { width: 1280, bottom: 2000 }
  const text = { x: 340, y: 100, width: 560, height: 20 }
  it('places a box right, left, above, below or beside a text', () => {
    expect(lies('right', { x: 960, y: 0, width: 100, height: 40 }, text, page)).toBe(true)
    expect(lies('right', { x: 400, y: 0, width: 100, height: 40 }, text, page)).toBe(false)
    expect(lies('left', { x: 0, y: 0, width: 300, height: 40 }, text, page)).toBe(true)
    expect(lies('below', { x: 340, y: 140, width: 100, height: 40 }, text, page)).toBe(true)
    expect(lies('above', { x: 340, y: 140, width: 100, height: 40 }, text, page)).toBe(false)
    expect(lies('beside', { x: 920, y: 95, width: 60, height: 30 }, text, page)).toBe(true)
    // Text moved off the page has no place on it: the page is the reference.
    expect(lies('right', { x: 960, y: 0, width: 100, height: 40 }, undefined, page)).toBe(true)
  })

  it('sees a shape in a character, a class, a picture file name or round corners, never in a frame address', () => {
    expect(shapeEvidence(node({ ref: 'p', text: '★' }), 'star')).toBe('★ in its text')
    expect(shapeEvidence(node({ ref: 'i', native: { tag: 'i', attributes: { class: 'fa fa-star' } } }), 'star')).toBe('"star" in its class')
    expect(shapeEvidence(node({ ref: 'img', role: 'img', native: { tag: 'img', attributes: { src: '/icons/star.svg?v=2' } } }), 'star')).toBe('"star" in its file name')
    expect(shapeEvidence(node({ ref: 'iframe', native: { tag: 'iframe', attributes: { src: 'star.html' } } }), 'star')).toBeUndefined()
    expect(shapeEvidence(node({ ref: 'b', role: 'button', native: { tag: 'button', attributes: {}, shape: { corners: 'circle' } } }), 'circle')).toBe('its corners make it a circle')
    expect(shapeEvidence(node({ ref: 'b', role: 'button', native: { tag: 'button', attributes: { class: 'rounded' } } }), 'circle')).toBeUndefined()
    // Punctuation is not a shape: an ellipsis, a multiplication sign, guillemets.
    expect(shapeEvidence(node({ ref: 'p', text: 'Leia mais…' }), 'dots')).toBeUndefined()
    expect(shapeEvidence(node({ ref: 'p', text: '2 × R$ 10' }), 'cross')).toBeUndefined()
    expect(shapeEvidence(node({ ref: 'p', text: '«Olá»' }), 'arrow')).toBeUndefined()
    expect(shapeEvidence(node({ ref: 'b', text: '⋮' }), 'dots')).toBe('⋮ in its text')
  })
})

describe('1.3.3 in the registry', () => {
  it('is a judged criterion on request, scored on ACT 9bd38c with pairs, and not a default', () => {
    expect(CRITERIA.get('1.3.3')).toBe(sensoryCharacteristics)
    expect(DEFAULT_CRITERIA).not.toContain('1.3.3')
    expect(ACT_RULES['1.3.3']).toEqual({ syntax: [], semantic: ['9bd38c'] })
    expect(CORRUPTORS['1.3.3']?.map((corruptor) => corruptor.id)).toEqual(['sensory-only'])
  })
})

// Integration: needs Chrome or Edge.
const browser = await launchBrowser().catch((error: unknown) => {
  process.stderr.write(`\nSkipping the 1.3.3 page tests: no browser started (${error instanceof Error ? error.message.split('\n')[0] : String(error)}).\n`)
  return undefined
})
afterAll(async () => browser?.close(), 60_000)

let collected: Promise<Collected> | undefined
function collect(): Promise<Collected> {
  if (!browser) throw new Error('no browser')
  collected ??= collectWeb(browser, pathToFileURL(resolve('test/fixtures/criteria/sensory.html')).href, { runAxe: true, locale: 'en' })
  return collected
}

/** A model that fails every sentence, naming the words the prompt lists, or the words it is given. */
function failingModel(words?: string): ModelProvider & { asked: string[] } {
  const asked: string[] = []
  return {
    id: 'stub:sensory',
    asked,
    async judge<T>(request: JudgeRequest<T>) {
      const sentence = /<sentence>([\s\S]*?)<\/sentence>/.exec(request.user)?.[1] ?? ''
      asked.push(sentence)
      const listed = /: "([^"]+)"/.exec(request.user)?.[1] ?? ''
      const output: SensoryJudgment = { instruction: true, words: words ?? listed, refersTo: 'the thing', verdict: 'fail', evidence: sentence, confidence: 'high' }
      return { output: request.schema.parse(output), inputTokens: 100, outputTokens: 20, latencyMs: 1, modelId: 'stub' }
    },
  }
}

describe.skipIf(!browser)('1.3.3 on a page', { timeout: 60_000 }, () => {
  it('records round corners and a rotation the instructions may describe', async () => {
    const { snapshot } = await collect()
    const byId = new Map([...walkTree(snapshot.root)].map((n) => [(n.native.attributes as Record<string, string> | undefined)?.id ?? n.ref, n]))
    expect(byId.get('go')?.native.shape).toEqual({ corners: 'circle' })
    expect(byId.get('subscribe')?.native.shape).toBeUndefined()
    expect(byId.get('tilted')?.native.shape).toEqual({ rotate: 15 })
  })

  it('finds what each instruction points to, and passes those something else names, without a model', async () => {
    const { snapshot } = await collect()
    const view = browserNamed(snapshot)
    const outcome = Object.fromEntries(
      sensorySentences(view).map((c) => [c.context.sentence, c.context.unverifiable ? 'unverifiable' : (c.context.identified?.how ?? 'model')]),
    )
    expect(outcome).toEqual({
      'Use the menu on the left to find older posts.': 'model',
      'Use o menu à esquerda para ver as publicações antigas.': 'model',
      'Click the round button to start.': 'model',
      'Press the button labelled "Subscribe" on the right to get the newsletter.': 'quoted',
      'Find the links on the right to contact us.': 'heading',
      'Click the star to save this page.': 'unverifiable',
      'Fill in the form below to send us a message.': 'reading-order',
      'Rellene el formulario de abajo para escribirnos.': 'reading-order',
      'Read this tilted text slowly to find the answer.': 'self',
    })
    // A sentence whose thing was not found is no candidate; the rest are, the decided ones too.
    expect(sensoryCharacteristics.candidates(view, { engine: { name: 'axe-core', version: 'test' }, rules: [] })).toHaveLength(8)
  })

  it('fails only what the model, the matcher and the page agree on, below the default threshold', async () => {
    const { snapshot, engine } = await collect()
    const model = failingModel()
    const report = await checkSnapshot(snapshot, engine, {
      criteria: [sensoryCharacteristics],
      llm: true,
      provider: model,
      runs: 1,
      cache: memoryCache(),
      offline: false,
      locale: 'en',
      minConfidence: 'medium',
      concurrency: 2,
    })
    expect(model.asked.sort()).toEqual(['Click the round button to start.', 'Use o menu à esquerda para ver as publicações antigas.', 'Use the menu on the left to find older posts.'])
    expect(report.findings.filter((f) => f.criterion === '1.3.3')).toEqual([])
    const failures = report.belowThreshold.filter((f) => f.criterion === '1.3.3')
    expect(failures.map((f) => `${f.ref} ${f.confidence}`).sort()).toEqual(['#fail-left low', '#fail-round low', '#pt-fail low'])
    expect(failures.find((f) => f.ref === '#fail-left')?.message).toMatch(
      /^The instruction "Use the menu on the left to find older posts\." points to "menu" only by "on the left" \(where it is\).*Rampa found a list of 2 links "March April", left of the text/,
    )
    const summary = report.criteria.find((c) => c.criterion === '1.3.3')
    expect(summary).toMatchObject({ candidates: 8, decided: 5, failed: 3 })
  })

  it('drops a claim whose words are not the sensory words the matcher found', async () => {
    const { snapshot, engine } = await collect()
    const report = await checkSnapshot(snapshot, engine, {
      criteria: [sensoryCharacteristics],
      llm: true,
      provider: failingModel('to start'),
      runs: 1,
      cache: memoryCache(),
      offline: false,
      locale: 'pt-BR',
      minConfidence: 'low',
      concurrency: 2,
    })
    expect(report.findings.filter((f) => f.criterion === '1.3.3')).toEqual([])
    const reasons = Object.fromEntries(report.discarded.filter((d) => d.criterion === '1.3.3').map((d) => [d.ref, d.reason]))
    expect(reasons).toEqual({
      '#fail-round': 'the words the claim names are not the sensory words the matcher found',
      '#fail-left': 'the words the claim names are not in the sentence',
      '#pt-fail': 'the words the claim names are not in the sentence',
    })
  })
})

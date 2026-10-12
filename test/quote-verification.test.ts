import { describe, expect, it } from 'vitest'
import type { Candidate } from '../src/core/types.ts'
import { type AuthenticationContext, accessibleAuthentication } from '../src/criteria/accessible-authentication.ts'
import { type ShortcutSettingsContext, characterKeyShortcuts } from '../src/criteria/character-key-shortcuts.ts'
import { type ParityContext, keyboardParity } from '../src/criteria/keyboard-parity.ts'
import { type LanguageOfPageContext, languageOfPage } from '../src/criteria/language-of-page.ts'
import { type LanguageOfPartsContext, languageOfParts } from '../src/criteria/language-of-parts.ts'
import { type OnInputContext, onInput } from '../src/criteria/on-input.ts'
import { type GestureContext, pointerGestures } from '../src/criteria/pointer-gestures.ts'
import { MIN_QUOTE, QUOTE_SHARE, trivialQuote, verifyListedQuote, verifyQuote } from '../src/criteria/shared.ts'
import { type StatusContext, statusMessages } from '../src/criteria/status-messages.ts'
import { type TimingContext, timingAdjustable } from '../src/criteria/timing-adjustable.ts'
import type { A11ySnapshot } from '../src/snapshot/schema.ts'

// None of these verify functions reads the snapshot.
const page = undefined as unknown as A11ySnapshot
const at = <Ctx>(context: Ctx): Candidate<Ctx> => ({ ref: '#x', context })

describe('verifyQuote', () => {
  const title = 'Summer sale: umbrellas at half price'

  it('takes the text exactly, after normalizing case, spaces and quotation marks', () => {
    expect(verifyQuote(title, title, 'page title')).toEqual({ ok: true })
    expect(verifyQuote('  SUMMER   sale: Umbrellas at half price ', title, 'page title')).toEqual({ ok: true })
    expect(verifyQuote('It’s “here”', "It's \"here\"", 'link text')).toEqual({ ok: true })
  })

  it(`takes most of the text in one piece (${QUOTE_SHARE * 100}% of it or more), never less`, () => {
    // 23 of 36 characters: a quote that drops a little at the start. 13 of 36: a few words of it.
    expect(verifyQuote('umbrellas at half price', title, 'page title')).toEqual({ ok: true })
    expect('umbrellas at half price'.length / title.length).toBeGreaterThanOrEqual(QUOTE_SHARE)
    expect(verifyQuote('at half price', title, 'page title')).toEqual({ ok: false, reason: 'evidence is not the page title' })
    expect('at half price'.length / title.length).toBeLessThan(QUOTE_SHARE)
  })

  it('rejects an empty or trivial quote, unless it is all of the text', () => {
    expect(verifyQuote('', title, 'page title')).toEqual({ ok: false, reason: 'empty evidence' })
    expect(verifyQuote('Go', 'Go now', 'link text')).toEqual({ ok: false, reason: 'evidence too short to be a quote' })
    // A short text is quoted whole, its punctuation aside.
    expect(verifyQuote('Go', 'Go', 'link text')).toEqual({ ok: true })
    expect(verifyQuote('Go', 'Go!', 'link text')).toEqual({ ok: true })
  })

  it('rejects a quote of another element: words that are not in this one, or that hold it', () => {
    expect(verifyQuote('Winter sale', title, 'page title')).toEqual({ ok: false, reason: 'evidence is not the page title' })
    expect(verifyQuote(`${title} and free shipping`, title, 'page title')).toEqual({ ok: false, reason: 'evidence is not the page title' })
  })
})

describe('a quote too short to show anything', () => {
  it(`needs ${MIN_QUOTE} letters or digits, or all of a text`, () => {
    expect(MIN_QUOTE).toBe(3)
    // One or two letters are in nearly any text: they show nothing about where they came from.
    expect(trivialQuote('a', ['Livros de culinária'])).toBe(true)
    expect(trivialQuote('de', ['Livros de culinária'])).toBe(true)
    expect(trivialQuote('—', ['Livros — culinária'])).toBe(true)
    // Three is enough for what short evidence legitimately is: a language's name, a word of another language, a number.
    expect(trivialQuote('Lao', ['Language: Lao'])).toBe(false)
    expect(trivialQuote('Oui', ['Oui, merci'])).toBe(false)
    expect(trivialQuote('日本語', ['日本語のページ'])).toBe(false)
    expect(trivialQuote('404', ['Error 404'])).toBe(false)
    // A text shorter than that is quoted whole.
    expect(trivialQuote('Sí', ['¡Sí!'])).toBe(false)
    expect(trivialQuote('中文', ['中文'])).toBe(false)
    expect(trivialQuote('中文', ['中文版本说明'])).toBe(true)
    // Where the quote must show a language, digits do not count.
    expect(trivialQuote('12 de', ['Rua 12 de Maio'], 'letters')).toBe(true)
    expect(trivialQuote('12 de', ['Rua 12 de Maio'])).toBe(false)
  })
})

describe('verifyListedQuote', () => {
  const texts = ['Keyboard shortcut settings', 'Press ? to open the keyboard shortcut settings']

  it('takes one listed text, or most of one', () => {
    expect(verifyListedQuote('Keyboard shortcut settings', texts)).toEqual({ ok: true })
    expect(verifyListedQuote('Press ? to open the keyboard shortcut settings', texts)).toEqual({ ok: true })
    expect(verifyListedQuote('to open the keyboard shortcut settings', texts)).toEqual({ ok: true })
  })

  it('rejects a few letters of a listed text, a text that only holds one, and two joined', () => {
    expect(verifyListedQuote('Ke', texts)).toEqual({ ok: false, reason: 'evidence too short to be a quote' })
    expect(verifyListedQuote('shortcut', texts)).toEqual({ ok: false, reason: 'evidence is not text the page shows' })
    expect(verifyListedQuote('Keyboard shortcut settings let you turn every shortcut off', texts)).toMatchObject({ ok: false })
    expect(verifyListedQuote(texts.join(' '), texts)).toMatchObject({ ok: false })
  })
})

describe('a pass that clears a probe finding quotes the page by verifyQuote rule', () => {
  it('2.1.4: one listed text, never a letter of it nor a longer text that holds one', () => {
    const context: ShortcutSettingsContext = { keys: ['"s" opens search'], hidden: [], openers: ['Settings'], controls: ['Settings', 'Keyboard shortcut settings'], instructions: ['Press ? for help'] }
    const pass = (evidence: string) => characterKeyShortcuts.verify({ verdict: 'pass', control: 'Keyboard shortcut settings', evidence, confidence: 'high' }, at(context), page)
    expect(pass('Keyboard shortcut settings')).toEqual({ ok: true })
    expect(pass('K')).toMatchObject({ ok: false })
    // Held before: the quote held a listed text whole, so any invented sentence around "Settings" passed.
    expect(pass('Settings: turn off single-key shortcuts here')).toEqual({ ok: false, reason: 'evidence is not text the page shows' })
  })

  it('3.3.8: one listed text, never a sentence that only holds one', () => {
    const context: AuthenticationContext = { step: 'login', tests: [{ kind: 'partial-characters', quote: 'Enter the 2nd and 6th characters of your password' }], texts: ['Sign in, step 2', 'Need help?'] }
    const pass = (evidence: string) => accessibleAuthentication.verify({ verdict: 'pass', kind: 'not-a-test', evidence, confidence: 'high' }, at(context), page)
    expect(pass('Sign in, step 2')).toEqual({ ok: true })
    expect(pass('S')).toMatchObject({ ok: false })
    expect(pass('Need help? This is only an example, not a real question')).toEqual({ ok: false, reason: 'evidence is not text the page shows' })
    // A fail quotes by the same rule.
    const fail = (evidence: string) => accessibleAuthentication.verify({ verdict: 'fail', kind: 'partial-characters', evidence, confidence: 'high' }, at(context), page)
    expect(fail('Enter the 2nd and 6th characters')).toEqual({ ok: true })
    expect(fail('2nd')).toMatchObject({ ok: false })
  })

  it('2.5.1 and 2.1.1: most of a listed text, not any six letters of it', () => {
    const texts = ['Draw your signature in the box below with your finger', 'Clear']
    const gesture: GestureContext = { element: '<canvas> "Signature"', kind: 'touch', gesture: 'swipe-right', effect: 'the canvas changed', texts }
    const essential = (evidence: string) => pointerGestures.verify({ verdict: 'pass', evidence, confidence: 'high' }, at(gesture), page)
    expect(essential('Draw your signature in the box below with your finger')).toEqual({ ok: true })
    expect(essential('signature in the box below with your finger')).toEqual({ ok: true })
    expect(essential('your signature')).toEqual({ ok: false, reason: 'evidence is not text the page shows' })
    const parity: ParityContext = { control: '<canvas>', result: 'none', texts, click: [], keys: [] }
    const path = (evidence: string) => keyboardParity.verify({ verdict: 'pass', reason: 'path-dependent', keys: '', facts: [], evidence, confidence: 'high' }, at(parity), page)
    expect(path('Draw your signature in the box below with your finger')).toEqual({ ok: true })
    expect(path('the box below')).toEqual({ ok: false, reason: 'evidence is not text the page shows' })
  })

  it('3.2.2 and 2.2.1: a listed text, never two joined', () => {
    const input: OnInputContext = {
      control: '<select> "Country"',
      action: 'selected "Brasil"',
      change: 'goes to another page as soon as its value changes',
      texts: ['Selecting a country reloads the page.', 'Prices are shown in your currency.'],
      page: [],
    }
    const warned = (evidence: string) => onInput.verify({ verdict: 'pass', evidence, confidence: 'high' }, at(input), page)
    expect(warned('Selecting a country reloads the page.')).toEqual({ ok: true })
    expect(warned('Selecting a country reloads the page. Prices are shown in your currency.')).toMatchObject({ ok: false })
    const timing: TimingContext = { after: '20 min', consequence: 'goes to https://shop.example/expired', texts: ['You can extend your session at any time.'] }
    const excepted = (evidence: string) => timingAdjustable.verify({ verdict: 'pass', exception: 'extend', evidence, confidence: 'high' }, at(timing), page)
    expect(excepted('You can extend your session at any time.')).toEqual({ ok: true })
    expect(excepted('Note: You can extend your session at any time.')).toMatchObject({ ok: false })
  })

  it('4.1.3: a pass that would take the item off the review list quotes the text that appeared', () => {
    const context: StatusContext = { trigger: 'clicked <button> "Copy link"', text: 'Link copied to the clipboard', tag: 'div', added: true, exact: false, describedBy: false, subject: 's', key: 'k' }
    const pass = (evidence: string) => statusMessages.verify({ verdict: 'pass', evidence, confidence: 'high' }, at(context), page)
    expect(pass('Link copied to the clipboard')).toEqual({ ok: true })
    expect(pass('')).toEqual({ ok: false, reason: 'a pass must quote the text that appeared' })
    expect(pass('Li')).toEqual({ ok: false, reason: 'evidence too short to be a quote' })
    expect(pass('Link copied')).toEqual({ ok: false, reason: 'evidence is not the text that appeared' })
    // A fail quotes the words that make it a status message: three letters or digits at least, unless that is all of it.
    const fail = (evidence: string, text = context.text) => statusMessages.verify({ verdict: 'fail', evidence, confidence: 'high' }, at({ ...context, text }), page)
    expect(fail('Link copied')).toEqual({ ok: true })
    expect(fail('Li')).toEqual({ ok: false, reason: 'a fail must quote the status message' })
    expect(fail('OK', 'OK')).toEqual({ ok: true })
  })
})

describe('the quotes of 3.1.1 and 3.1.2', () => {
  const parts = (text: string, declared = 'pt'): Candidate<LanguageOfPartsContext> => at({ kind: 'marked', declared, inherited: 'en', text, html: '' })
  const said = (evidence: string, detectedLanguage = 'pt') => ({ verdict: 'pass' as const, detectedLanguage, evidence, exception: 'none' as const, confidence: 'high' as const })

  it('3.1.2 rejects a one- or two-letter quote out of a longer text', () => {
    expect(languageOfParts.verify(said('de'), parts('Livros de culinária'), page)).toEqual({ ok: false, reason: 'evidence too short' })
    expect(languageOfParts.verify(said('é'), parts('A loja é sua'), page)).toEqual({ ok: false, reason: 'evidence too short' })
    expect(languageOfParts.verify(said('Livros de culinária'), parts('Livros de culinária'), page)).toEqual({ ok: true })
  })

  it('3.1.2 keeps short legitimate evidence: a language name, a word of another language, a short text quoted whole', () => {
    expect(languageOfParts.verify(said('Lao', 'lo'), parts('ພາສາລາວ Lao', 'lo'), page)).toEqual({ ok: true })
    expect(languageOfParts.verify(said('Oui', 'fr'), parts('Oui, merci', 'fr'), page)).toEqual({ ok: true })
    expect(languageOfParts.verify(said('Sí', 'es'), parts('¡Sí!', 'es'), page)).toEqual({ ok: true })
    expect(languageOfParts.verify(said('中文', 'zh'), parts('中文', 'zh'), page)).toEqual({ ok: true })
    expect(languageOfParts.verify(said('中文', 'zh'), parts('中文版本说明', 'zh'), page)).toEqual({ ok: false, reason: 'evidence too short' })
  })

  it('3.1.1 rejects a two-letter quote and keeps a word', () => {
    const candidate = at<LanguageOfPageContext>({ declared: 'pt', title: 'Loja', text: 'Bem-vindo à nossa loja de livros', startTag: '<html lang="pt">' })
    const pass = (evidence: string) => languageOfPage.verify({ verdict: 'pass', detectedLanguage: 'pt', evidence, confidence: 'high' }, candidate, page)
    expect(pass('de')).toEqual({ ok: false, reason: 'evidence too short' })
    expect(pass('livros')).toEqual({ ok: true })
    expect(pass('Loja')).toEqual({ ok: true })
  })
})

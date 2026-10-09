import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { memoryCache } from '../src/core/cache.ts'
import { checkSnapshot } from '../src/core/check.ts'
import type { EngineResults } from '../src/core/types.ts'
import { headingsAndLabels } from '../src/criteria/headings-and-labels.ts'
import { CRITERIA } from '../src/criteria/index.ts'
import { languageOfPage } from '../src/criteria/language-of-page.ts'
import { languageOfParts } from '../src/criteria/language-of-parts.ts'
import { linkPurpose } from '../src/criteria/link-purpose.ts'
import { nonTextContent } from '../src/criteria/non-text-content.ts'
import { pageTitled } from '../src/criteria/page-titled.ts'
import { encodePng } from '../src/pixels/png.ts'
import { snapshotFromUiAutomator } from '../src/surfaces/android/uiautomator.ts'
import { importXcuitest } from '../src/surfaces/ios.ts'
import { blank, fill } from './screens.ts'

const android = (name: string, locale?: string) => {
  const screen = blank(1080, 2400)
  fill(screen, { x: 390, y: 150, width: 300, height: 300 }, [30, 90, 200])
  fill(screen, { x: 930, y: 1320, width: 87, height: 87 }, [60, 60, 60])
  return snapshotFromUiAutomator(readFileSync(new URL(`./fixtures/android/${name}`, import.meta.url), 'utf8'), { screenshot: screen, locale, localeSource: 'device' })
}

const ios = () => {
  const data = JSON.parse(readFileSync(new URL('./fixtures/ios/login.json', import.meta.url), 'utf8')) as Record<string, unknown>
  const screen = blank(393 * 3, 852 * 3)
  fill(screen, { x: 146 * 3, y: 120 * 3, width: 300, height: 300 }, [52, 199, 89])
  return importXcuitest({ ...data, screenshot: encodePng(screen).toString('base64') }, { locale: 'en' }).snapshot
}

const none: EngineResults = { engine: { name: 'rampa-rules', version: 'test' }, rules: [] }

describe('1.1.1 on app screens', () => {
  it('judges named images and image buttons, seen as cropped from the screenshot, with their source as markup', () => {
    const login = android('login.xml', 'en-US')
    const candidates = nonTextContent.candidates(login, none)
    expect(candidates.map((c) => [c.ref, c.context.alt, c.context.role])).toEqual([
      ['com.example.shop:id/logo', 'image', 'img'],
      ['com.example.shop:id/help', 'Help', 'button'],
    ])
    const [logo] = candidates
    if (!logo) throw new Error('no candidate')
    expect(logo.context.language).toBe('en-US')
    const prompt = nonTextContent.prompt(logo, login)
    expect(prompt.user).toContain('Surface: android')
    expect(prompt.user).toContain('<android.widget.ImageView resource-id="com.example.shop:id/logo" content-desc="image" bounds="[390,150][690,450]">')
    expect(prompt.images?.[0]?.mediaType).toBe('image/png')
  })

  it('patches the property the description lives in, or hides a decorative image', () => {
    const login = android('login.xml')
    const [logo] = nonTextContent.candidates(login, none)
    if (!logo) throw new Error('no candidate')
    const claim = { verdict: 'fail', evidence: 'image', problem: 'filename_or_placeholder', imageShows: 'A blue square logo', suggestedAlt: 'Shop logo', confidence: 'high' } as const
    expect(nonTextContent.verify(claim, logo, login)).toEqual({ ok: true })
    expect(nonTextContent.patch?.(claim, logo, login)).toEqual({
      ref: 'com.example.shop:id/logo',
      kind: 'set-attribute',
      attribute: 'contentDescription',
      from: 'image',
      to: 'Shop logo',
      before: 'android:contentDescription="image"',
      after: 'android:contentDescription="Shop logo"',
    })
    expect(nonTextContent.patch?.({ ...claim, problem: 'decorative', suggestedAlt: '' }, logo, login)).toMatchObject({
      attribute: 'importantForAccessibility',
      before: 'android:contentDescription="image"',
      after: 'android:importantForAccessibility="no"',
    })
    expect(nonTextContent.message(claim, logo, 'en')).toBe('The text alternative "image" is a file name or a placeholder.')

    const screen = ios()
    const [iosLogo] = nonTextContent.candidates(screen, none)
    if (!iosLogo) throw new Error('no candidate')
    expect(nonTextContent.patch?.(claim, iosLogo, screen)).toMatchObject({ before: 'accessibilityLabel = "image"', after: 'accessibilityLabel = "Shop logo"' })
    expect(nonTextContent.patch?.({ ...claim, problem: 'decorative', suggestedAlt: '' }, iosLogo, screen)?.after).toBe('isAccessibilityElement = false')
  })
})

describe('2.4.6 on app screens', () => {
  it('reads headings marked by Appium and labels from the hint, with the field described by its platform facts', () => {
    const notes = android('notes-appium.xml', 'en')
    const candidates = headingsAndLabels.candidates(notes, none)
    expect(candidates.map((c) => `${c.context.kind}:${c.context.text}`)).toEqual(['heading:Notes', 'label:Field 1', 'heading:Item 1', 'heading:Item 2', 'heading:Item 3'])
    const item = candidates.find((c) => c.context.text === 'Item 1')
    expect(item?.context.content).toContain('Buy oat milk')
    expect(item?.context.content).not.toContain('dentist')
    expect(item?.context.siblings).toEqual(['Notes', 'Item 2', 'Item 3'])
    const label = candidates.find((c) => c.context.kind === 'label')
    expect(label?.context.content).toBe(
      [
        'Field: textbox, android.widget.EditText',
        'resource-id="com.example.notes:id/filter"',
        'The label is its hint, shown inside the field while it is empty',
        'Under the visible heading: Notes',
      ].join('\n'),
    )
  })

  it('patches the hint, the text or the accessibilityLabel the label comes from', () => {
    const notes = android('notes-appium.xml')
    const candidates = headingsAndLabels.candidates(notes, none)
    const fail = { named: '', verdict: 'fail', evidence: 'Field 1', problem: 'generic', suggestedText: 'Search notes', confidence: 'high' } as const
    const label = candidates.find((c) => c.context.kind === 'label')
    if (!label) throw new Error('no label')
    expect(headingsAndLabels.patch?.(fail, label, notes)).toMatchObject({ attribute: 'hint', before: 'android:hint="Field 1"', after: 'android:hint="Search notes"' })
    const heading = candidates.find((c) => c.context.text === 'Item 1')
    if (!heading) throw new Error('no heading')
    expect(headingsAndLabels.patch?.({ ...fail, evidence: 'Item 1', suggestedText: 'Weekend groceries' }, heading, notes)).toMatchObject({
      kind: 'set-text',
      before: 'android:text="Item 1"',
      after: 'android:text="Weekend groceries"',
    })

    const screen = ios()
    const iosLabels = headingsAndLabels.candidates(screen, none).filter((c) => c.context.kind === 'label')
    expect(iosLabels.map((c) => [c.context.text, c.context.target?.property])).toEqual([
      ['Email', 'placeholder'],
      ['Password', 'accessibilityLabel'],
      ['Field 1', 'accessibilityLabel'],
    ])
    const promo = iosLabels.find((c) => c.context.text === 'Field 1')
    if (!promo) throw new Error('no promo label')
    expect(promo.context.content).toContain('identifier="promo"')
    expect(headingsAndLabels.patch?.({ ...fail, suggestedText: 'Promo code' }, promo, screen)?.after).toBe('accessibilityLabel = "Promo code"')
    // A heading drawn by a label: the fix changes what it shows, so VoiceOver keeps reading what people see.
    const welcome = headingsAndLabels.candidates(screen, none).find((c) => c.context.text === 'Welcome back')
    if (!welcome) throw new Error('no heading')
    expect(headingsAndLabels.patch?.({ ...fail, evidence: 'Welcome back', suggestedText: 'Sign in' }, welcome, screen)).toMatchObject({
      kind: 'set-text',
      before: 'text = "Welcome back"',
      after: 'text = "Sign in"',
    })
  })
})

describe('2.4.4 on app screens', () => {
  it('judges an iOS link and patches its text', () => {
    const screen = ios()
    const [link, ...rest] = linkPurpose.candidates(screen, none)
    expect(rest).toHaveLength(0)
    if (!link) throw new Error('no link')
    expect(link.context).toMatchObject({ name: 'Forgot password?', heading: 'Welcome back' })
    expect(linkPurpose.prompt(link, screen).user).toContain('Markup: <XCUIElementTypeLink label="Forgot password?"')
    const fail = { promises: 'a way to recover the password', leadsTo: 'unknown', verdict: 'fail', evidence: 'Forgot password?', problem: 'generic', suggestedText: 'Reset your password', confidence: 'high' } as const
    expect(linkPurpose.patch?.(fail, link, screen)).toMatchObject({ kind: 'set-text', before: 'text = "Forgot password?"', after: 'text = "Reset your password"' })
  })
})

describe('3.1.1 on app screens', () => {
  it('reads the screen text against the language the app runs in', () => {
    const gallery = android('gallery-windows.xml', 'en-US')
    const [candidate] = languageOfPage.candidates(gallery, none)
    if (!candidate) throw new Error('no candidate')
    expect(candidate.context).toMatchObject({ declared: 'en-US', reader: 'TalkBack' })
    expect(candidate.context.text).toContain('Viagem de verão')
    const prompt = languageOfPage.prompt(candidate, gallery)
    expect(prompt.user).toContain('Declared language of the screen (the language the app runs in): en-US')
    const fail = { verdict: 'fail', detectedLanguage: 'pt', evidence: 'Fotos da praia em Florianópolis', confidence: 'high' } as const
    expect(languageOfPage.verify(fail, candidate, gallery)).toEqual({ ok: true })
    expect(languageOfPage.message(fail, candidate, 'en')).toBe(
      "The app runs in American English (en-US), but most of the screen's text is in Portuguese (pt). TalkBack reads it as American English unless the app marks the text's language (LocaleSpan), which the capture does not show.",
    )
    expect(languageOfPage.patch?.(fail, candidate, gallery)).toBeUndefined()
  })

  it('stays out when the language the app runs in is unknown', () => {
    expect(languageOfPage.candidates(android('gallery-windows.xml'), none)).toEqual([])
    const screen = ios()
    expect(languageOfPage.candidates({ ...screen, root: { ...screen.root, lang: undefined } }, none)).toEqual([])
  })
})

describe('3.1.2 and 2.4.2 on app screens', () => {
  it('judges language of parts only where an exporter recorded a node language', () => {
    const gallery = android('gallery-windows.xml', 'en-US')
    expect(languageOfParts.candidates(gallery, none)).toEqual([])
    const caption = gallery.root.children[0]?.children[0]?.children[1]
    if (!caption) throw new Error('no caption')
    caption.lang = 'es'
    const [candidate] = languageOfParts.candidates(gallery, none)
    expect(candidate?.context).toMatchObject({ declared: 'es', inherited: 'en-US' })
    if (!candidate) throw new Error('no candidate')
    const fail = { verdict: 'fail', detectedLanguage: 'pt', evidence: 'Fotos da praia', exception: 'none', confidence: 'high' } as const
    expect(languageOfParts.patch?.(fail, candidate, gallery)).toMatchObject({
      before: 'LocaleSpan(Locale.forLanguageTag("es"))',
      after: 'LocaleSpan(Locale.forLanguageTag("pt"))',
    })
  })

  it('leaves page titles to the web, where WCAG2ICT does not apply the criterion as written', async () => {
    expect(pageTitled.surfaces).toEqual(['web'])
    const report = await checkSnapshot(android('gallery-windows.xml', 'en-US'), none, {
      criteria: [...CRITERIA.values()],
      llm: false,
      provider: undefined,
      runs: 1,
      cache: memoryCache(),
      offline: false,
      locale: 'en',
      minConfidence: 'medium',
      concurrency: 1,
    })
    expect(report.criteria.filter((c) => !c.applicable).map((c) => c.criterion)).toEqual(['2.4.2'])
    expect(report.criteria.find((c) => c.criterion === '3.1.1')?.candidates).toBe(1)
  })
})

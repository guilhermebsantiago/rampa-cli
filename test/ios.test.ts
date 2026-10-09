import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { decodePng, encodePng, pngFromBase64 } from '../src/pixels/png.ts'
import { type A11yNode, A11ySnapshotSchema } from '../src/snapshot/schema.ts'
import { indexTree, walkTree } from '../src/snapshot/tree.ts'
import { ELEMENT_TYPES, importXcuitest, isXcuitestExport } from '../src/surfaces/ios.ts'
import { WHITE, blank, drawText, fill } from './screens.ts'

const loginExport = () => JSON.parse(readFileSync(new URL('./fixtures/ios/login.json', import.meta.url), 'utf8')) as Record<string, unknown>

function byRef(root: A11yNode, ref: string): A11yNode {
  const found = indexTree(root).get(ref)?.node
  if (!found) throw new Error(`no node ${ref}`)
  return found
}

/** The login screen at 3x, painted in iOS's default colors: dark labels, gray secondary text, placeholder gray, system blue. */
function loginScreenshot(): string {
  const screen = blank(393 * 3, 852 * 3)
  const at = (x: number, y: number, width: number, height: number) => ({ x: x * 3, y: y * 3, width: width * 3, height: height * 3 })
  fill(screen, at(146, 120, 100, 100), [0x34, 0xc7, 0x59])
  drawText(screen, at(163, 70, 67, 22), [0, 0, 0], WHITE)
  drawText(screen, at(16, 236, 361, 34), [0, 0, 0], WHITE)
  drawText(screen, at(16, 274, 361, 20), [0x8e, 0x8e, 0x93], WHITE)
  drawText(screen, at(16, 310, 361, 44), [0xc4, 0xc4, 0xc6], WHITE)
  drawText(screen, at(110, 582, 173, 20), [0x00, 0x7a, 0xff], WHITE)
  return encodePng(screen).toString('base64')
}

describe('XCUITest export', () => {
  const data = { ...loginExport(), screenshot: loginScreenshot() }
  const { snapshot, engine, notes, png } = importXcuitest(data, { locale: 'en' })

  it('is recognized by its format and becomes a valid ios snapshot', () => {
    expect(isXcuitestExport(data)).toBe(true)
    expect(isXcuitestExport({ schemaVersion: 1, surface: 'web' })).toBe(false)
    expect(A11ySnapshotSchema.safeParse(snapshot).success).toBe(true)
    expect(snapshot).toMatchObject({ surface: 'ios', target: 'com.example.shop', title: 'Sign in', locale: 'en' })
    expect(snapshot.root).toMatchObject({ ref: '/XCUIElementTypeApplication', role: 'application', lang: 'en' })
    expect(snapshot.viewport).toEqual({ width: 393, height: 852, scale: 3 })
    expect(png && decodePng(png).width).toBe(1179)
  })

  it('maps element types to roles, with accessibilityLabel as the name and the placeholder when there is none', () => {
    const mapped = Object.fromEntries(
      [...walkTree(snapshot.root)].filter((n) => n.native.identifier).map((n) => [n.native.identifier, [n.role, n.name]]),
    )
    expect(mapped).toMatchObject({
      'Sign in': ['navigation', undefined],
      BackButton: ['button', 'Shop'],
      form: ['generic', undefined],
      logo: ['img', 'image'],
      email: ['textbox', 'Email'],
      password: ['textbox', 'Password'],
      togglePassword: ['button', undefined],
      promo: ['textbox', 'Field 1'],
      remember: ['switch', 'Remember me'],
      signIn: ['button', 'Sign in'],
      heroArt: ['img', undefined],
    })
    const email = byRef(snapshot.root, 'email')
    expect(email).toMatchObject({ text: undefined, native: { nameFrom: 'placeholder', showingPlaceholder: true, renderedText: 'Email' } })
  })

  it('finds headings through the header trait, and links', () => {
    expect([...walkTree(snapshot.root)].filter((n) => n.role === 'heading').map((n) => n.name)).toEqual(['Sign in', 'Welcome back'])
    expect(byRef(snapshot.root, '//*[@name="form"]/XCUIElementTypeLink')).toMatchObject({ role: 'link', name: 'Forgot password?' })
  })

  it('leaves the system keyboard out and marks what is scrolled off the screen', () => {
    expect([...walkTree(snapshot.root)].some((n) => n.native.elementType === 'key' || n.native.elementType === 'keyboard')).toBe(false)
    expect(snapshot.root.native.dropped).toBe(1)
    expect(byRef(snapshot.root, 'createAccount').states).toContain('offscreen')
    expect(byRef(snapshot.root, 'remember').states).toContain('checked')
    expect(byRef(snapshot.root, 'password').states).toContain('password')
  })

  it('refers to elements by a unique accessibilityIdentifier, else by an Appium-style path', () => {
    const refs = [...walkTree(snapshot.root)].map((n) => n.ref)
    expect(refs).toEqual(
      expect.arrayContaining([
        '/XCUIElementTypeApplication/XCUIElementTypeWindow',
        '/XCUIElementTypeApplication/XCUIElementTypeWindow/XCUIElementTypeOther',
        '//*[@name="Sign in"]/XCUIElementTypeStaticText',
        '//*[@name="form"]/XCUIElementTypeStaticText[1]',
        '//*[@name="form"]/XCUIElementTypeStaticText[2]',
      ]),
    )
    expect(new Set(refs).size).toBe(refs.length)
  })

  it('crops named images at the screenshot scale', () => {
    const logo = byRef(snapshot.root, 'logo')
    const crop = pngFromBase64(logo.image ?? '')
    expect(crop && decodePng(crop)).toMatchObject({ width: 300, height: 300 })
    expect(byRef(snapshot.root, 'heroArt').image).toBeUndefined()
  })

  it('runs the rules: an unlabeled button fails, an image without a label needs a person, fields are named', () => {
    const refs = (ruleId: string, outcome: string) =>
      engine.rules.filter((r) => r.ruleId === ruleId && r.outcome === outcome).flatMap((r) => r.nodes.map((n) => n.ref))
    expect(refs('control-name', 'violation')).toEqual(['togglePassword'])
    expect(engine.rules.find((r) => r.ruleId === 'control-name' && r.outcome === 'violation')?.nodes[0]?.detail).toBe(
      'This button has no text and no accessibilityLabel, so VoiceOver cannot say what it does.',
    )
    expect(refs('image-name', 'incomplete')).toEqual(['heroArt'])
    expect(refs('field-name', 'pass')).toEqual(['email', 'password', 'promo'])
  })

  it('measures contrast at the screenshot scale: the default placeholder gray fails, system blue needs large text', () => {
    const refs = (outcome: string) =>
      engine.rules.filter((r) => r.ruleId === 'text-contrast' && r.outcome === outcome).flatMap((r) => r.nodes.map((n) => [n.ref, n.evidence]))
    expect(refs('violation')).toEqual([['email', '#c4c4c6 on #ffffff = 1.74:1']])
    expect(refs('incomplete')).toEqual([
      ['//*[@name="form"]/XCUIElementTypeStaticText[2]', '#8e8e93 on #ffffff = 3.26:1'],
      ['//*[@name="form"]/XCUIElementTypeLink', '#007aff on #ffffff = 4.02:1'],
    ])
    expect(refs('pass').map(([ref]) => ref)).toEqual(['//*[@name="Sign in"]/XCUIElementTypeStaticText', '//*[@name="form"]/XCUIElementTypeStaticText[1]'])
  })

  it('says only what the export cannot show', () => {
    expect(notes).toEqual(['Read from an XCUITest export, which does not expose labels tied to fields or the language of text.'])
  })
})

describe('a bare export', () => {
  it('has no screen language without the app language, and says what it lacks', () => {
    const data = loginExport()
    delete data.language
    delete data.languageSource
    const stripTraits = (element: Record<string, unknown>): void => {
      delete element.traits
      for (const child of (element.children ?? []) as Record<string, unknown>[]) stripTraits(child)
    }
    stripTraits(data.root as Record<string, unknown>)
    const { snapshot, notes } = importXcuitest(data, { locale: 'pt-BR' })
    // The device language still sets the language suggestions are written in.
    expect(snapshot.locale).toBe('pt-BR')
    expect(snapshot.root.lang).toBeUndefined()
    expect([...walkTree(snapshot.root)].some((n) => n.role === 'heading')).toBe(false)
    expect(notes).toEqual([
      'Lido de uma exportação do XCUITest, que não expõe rótulos ligados a campos nem o idioma do texto.',
      'A exportação não tem os traits de acessibilidade, então os títulos não foram encontrados (2.4.6).',
      'A exportação não diz em que idioma o app rodou, então o idioma da tela (3.1.1) não foi verificado. Passe language: ao RampaExport ou abra o app com -AppleLanguages.',
      'Sem captura de tela utilizável: as imagens não foram julgadas (1.1.1) e o contraste do texto não foi medido.',
    ])
  })

  it('reads a type by its raw value or its XCUIElementType name', () => {
    expect(ELEMENT_TYPES[9]).toBe('button')
    expect(ELEMENT_TYPES[48]).toBe('staticText')
    expect(ELEMENT_TYPES[82]).toBe('statusItem')
    const data = {
      format: 'rampa-xcuitest',
      version: 1,
      root: {
        typeRaw: 2,
        frame: { x: 0, y: 0, width: 100, height: 100 },
        children: [
          { typeRaw: 43, label: 'Logo', frame: { x: 0, y: 0, width: 50, height: 50 } },
          { type: 'XCUIElementTypeStaticText', label: 'Hello', frame: { x: 0, y: 60, width: 50, height: 20 } },
        ],
      },
    }
    const { snapshot } = importXcuitest(data, { locale: 'en' })
    expect(snapshot.root.children.map((n) => [n.role, n.name])).toEqual([
      ['img', 'Logo'],
      ['text', 'Hello'],
    ])
    expect(snapshot.target).toBe('ios')
  })

  it('refuses a file that is not an export', () => {
    expect(() => importXcuitest({ format: 'rampa-xcuitest', version: 1, root: { type: 'button' } }, { locale: 'en' })).toThrow(/Not a valid Rampa XCUITest export/)
  })
})

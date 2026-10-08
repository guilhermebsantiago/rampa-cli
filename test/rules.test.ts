import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { engineFindings } from '../src/core/check.ts'
import type { EngineResults } from '../src/core/types.ts'
import { rulesNotes, runRules } from '../src/engine/rules.ts'
import type { A11ySnapshot } from '../src/snapshot/schema.ts'
import { snapshotFromUiAutomator } from '../src/surfaces/android/uiautomator.ts'
import { node } from './helpers.ts'
import { WHITE, blank, drawText } from './screens.ts'

const fixture = (name: string) => readFileSync(new URL(`./fixtures/android/${name}`, import.meta.url), 'utf8')

/** The login screen as painted: most text dark, the link light gray, the email placeholder mid gray. */
export function loginScreen() {
  const screen = blank(1080, 2400)
  drawText(screen, { x: 63, y: 500, width: 954, height: 80 }, [0x20, 0x21, 0x24], WHITE)
  drawText(screen, { x: 63, y: 620, width: 954, height: 147 }, [0x8a, 0x8a, 0x8a], WHITE)
  drawText(screen, { x: 63, y: 800, width: 807, height: 147 }, [0x75, 0x75, 0x75], WHITE)
  drawText(screen, { x: 63, y: 980, width: 537, height: 120 }, [0x20, 0x21, 0x24], WHITE)
  drawText(screen, { x: 63, y: 1140, width: 954, height: 147 }, WHITE, [0x1a, 0x73, 0xe8])
  drawText(screen, { x: 300, y: 1320, width: 480, height: 80 }, [0x9e, 0x9e, 0x9e], WHITE)
  drawText(screen, { x: 63, y: 1430, width: 954, height: 70 }, [0xe0, 0xe0, 0xe0], WHITE)
  return screen
}

const outcome = (engine: EngineResults, ruleId: string, kind: string) =>
  engine.rules.filter((rule) => rule.ruleId === ruleId && rule.outcome === kind).flatMap((rule) => rule.nodes.map((n) => n.ref))

describe('tree rules on Android', () => {
  const screen = loginScreen()
  const login = snapshotFromUiAutomator(fixture('login.xml'), { screenshot: screen })
  const engine = runRules(login, { locale: 'en', screenshot: screen })

  it('fails the image button with no name, under 1.1.1 and 4.1.2', () => {
    expect(engine.engine.name).toBe('rampa-rules')
    expect(outcome(engine, 'image-control-name', 'violation')).toEqual(['com.example.shop:id/toggle_password'])
    expect(outcome(engine, 'image-control-name', 'pass')).toEqual(['com.example.shop:id/help'])
    const rule = engine.rules.find((r) => r.ruleId === 'image-control-name' && r.outcome === 'violation')
    expect(rule?.criteria).toEqual(['1.1.1', '4.1.2'])
    expect(rule?.nodes[0]?.detail).toBe('This image button has no text and no contentDescription, so TalkBack cannot say what it does.')
  })

  it('passes named controls and leaves disabled ones and fields to their own rules', () => {
    expect(outcome(engine, 'control-name', 'violation')).toEqual([])
    expect(outcome(engine, 'control-name', 'pass')).toEqual(['com.example.shop:id/remember', 'com.example.shop:id/sign_in', 'com.example.shop:id/forgot'])
    expect(outcome(engine, 'field-name', 'pass')).toEqual(['com.example.shop:id/email', 'com.example.shop:id/password'])
    expect(outcome(engine, 'image-name', 'pass')).toEqual(['com.example.shop:id/logo'])
  })

  it('measures text contrast from the screenshot: below 3:1 fails, below 4.5:1 needs the size, disabled text is exempt', () => {
    expect(outcome(engine, 'text-contrast', 'violation')).toEqual(['com.example.shop:id/forgot'])
    expect(outcome(engine, 'text-contrast', 'incomplete')).toEqual(['com.example.shop:id/email'])
    expect(outcome(engine, 'text-contrast', 'pass')).toEqual([
      'com.example.shop:id/title',
      'com.example.shop:id/password',
      'com.example.shop:id/remember',
      'com.example.shop:id/sign_in',
    ])
    const forgot = engine.rules.find((r) => r.ruleId === 'text-contrast' && r.outcome === 'violation')?.nodes[0]
    expect(forgot?.evidence).toBe('#9e9e9e on #ffffff = 2.68:1')
    expect(forgot?.detail).toContain('"Forgot password?" has a contrast of 2.68:1')
  })

  it('reports violations as engine findings with their own message and evidence', () => {
    const findings = engineFindings(engine)
    expect(findings.map((f) => [f.criterion, f.ref, f.confidence])).toEqual([
      ['1.1.1', 'com.example.shop:id/toggle_password', 'high'],
      ['1.4.3', 'com.example.shop:id/forgot', 'high'],
    ])
    expect(findings[1]?.message).toMatch(/^The text "Forgot password\?" has a contrast of 2\.68:1/)
    expect(findings[1]?.evidence).toBe('#9e9e9e on #ffffff = 2.68:1')
    expect(findings[1]?.html).toContain('resource-id="com.example.shop:id/forgot"')
  })

  it('writes Portuguese messages and evidence for a Portuguese report', () => {
    const pt = runRules(login, { locale: 'pt-BR', screenshot: screen })
    const forgot = pt.rules.find((r) => r.ruleId === 'text-contrast' && r.outcome === 'violation')?.nodes[0]
    expect(forgot?.evidence).toBe('#9e9e9e sobre #ffffff = 2,68:1')
    expect(forgot?.detail).toContain('tem contraste de 2,68:1')
    expect(rulesNotes(pt, 'pt-BR')).toEqual([expect.stringContaining('1 texto(s) com contraste entre 3:1 e 4,5:1')])
  })

  it('leaves contrast out without a screenshot', () => {
    const without = runRules(login, { locale: 'en' })
    expect(without.rules.some((r) => r.ruleId === 'text-contrast')).toBe(false)
  })

  it('cannot tell a decorative image from a missing description, and says so', () => {
    const gallery = snapshotFromUiAutomator(fixture('gallery-windows.xml'))
    const results = runRules(gallery, { locale: 'en' })
    expect(outcome(results, 'image-name', 'incomplete')).toEqual(['//*[@resource-id="com.example.gallery:id/grid"]/android.widget.ImageView[3]'])
    expect(outcome(results, 'image-control-name', 'violation')).toEqual(['com.example.gallery:id/share'])
    // The grid is clickable to pick a photo; it is not a control that needs a name.
    expect(outcome(results, 'control-name', 'violation')).toEqual([])
    expect(rulesNotes(results, 'en')).toEqual(['1 image(s) have no description: decide whether each is decorative (hide it) or needs one.'])
  })

  it('skips images marked as left out of what TalkBack reads', () => {
    const notes = snapshotFromUiAutomator(fixture('notes-appium.xml'))
    const results = runRules(notes, { locale: 'en' })
    expect(outcome(results, 'image-name', 'incomplete')).toEqual([])
    expect(outcome(results, 'control-name', 'pass')).toContain('//*[@resource-id="com.example.notes:id/list"]/android.widget.LinearLayout[1]')
  })
})

describe('tree rules on other surfaces', () => {
  function screen(surface: A11ySnapshot['surface'], field: ReturnType<typeof node>): A11ySnapshot {
    return {
      schemaVersion: 1,
      surface,
      target: 'test',
      viewport: { width: 390, height: 844, scale: 3 },
      collectedAt: '2026-10-08T00:00:00.000Z',
      collector: { name: 'test', version: '0' },
      root: node({ ref: 'app', role: 'application', children: [field] }),
    }
  }

  it('fails a text field with no name on iOS, where nothing else can name it, and asks on Android', () => {
    const field = node({ ref: 'email', role: 'textbox' })
    expect(outcome(runRules(screen('ios', field), { locale: 'en' }), 'field-name', 'violation')).toEqual(['email'])
    expect(outcome(runRules(screen('android', field), { locale: 'en' }), 'field-name', 'incomplete')).toEqual(['email'])
  })

  it('names the platform attribute in the message', () => {
    const button = node({ ref: 'close', role: 'button' })
    const ios = runRules(screen('ios', button), { locale: 'en' }).rules.find((r) => r.ruleId === 'control-name' && r.outcome === 'violation')
    expect(ios?.nodes[0]?.detail).toBe('This button has no text and no accessibilityLabel, so VoiceOver cannot say what it does.')
  })

  it('runs only the pixel rule on an image, and marks what a model located', () => {
    const image = screen('image', node({ ref: 'text[1]', role: 'text', text: 'Sale', bounds: { x: 10, y: 10, width: 200, height: 40 }, native: { renderedText: 'Sale' } }))
    image.viewport.scale = 1
    const pixels = blank(390, 844)
    drawText(pixels, { x: 10, y: 10, width: 200, height: 40 }, [0xaa, 0xaa, 0xaa], WHITE)
    const results = runRules(image, { locale: 'en', screenshot: pixels, locatedBy: 'ollama:gemma4:12b' })
    expect(results.rules.map((r) => `${r.ruleId}:${r.outcome}`)).toEqual(['text-contrast:violation'])
    const [finding] = engineFindings(results)
    expect(finding).toMatchObject({ criterion: '1.4.3', confidence: 'medium', locatedBy: 'ollama:gemma4:12b' })
    expect(finding?.message).toContain('measured from the image')
  })
})

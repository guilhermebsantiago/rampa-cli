import { describe, expect, it } from 'vitest'
import type { EngineResults } from '../src/core/types.ts'
import { identifyInputPurpose } from '../src/criteria/identify-input-purpose.ts'
import { labelsOrInstructions } from '../src/criteria/labels-or-instructions.ts'
import { isHoneypot } from '../src/criteria/shared.ts'
import type { A11yNode, A11ySnapshot } from '../src/snapshot/schema.ts'
import { node } from './helpers.ts'

const noFindings: EngineResults = { engine: { name: 'axe-core', version: 'test' }, rules: [] }
const onScreen = { x: 40, y: 300, width: 320, height: 32 }

function input(ref: string, name: string, attributes: Record<string, string>, extra: Partial<A11yNode> = {}): A11yNode {
  const attrs = Object.entries(attributes)
    .map(([key, value]) => ` ${key}="${value}"`)
    .join('')
  return node({ ref, role: 'textbox', name, bounds: onScreen, ...extra, native: { tag: 'input', attributes, html: `<input${attrs}>` } })
}

/**
 * Modeled on the real-page study's dev split: a support contact form whose "Website" field
 * is a spam trap placed at -9999 px, out of the tab order and with autocomplete off.
 */
function contactForm(): A11ySnapshot {
  return {
    schemaVersion: 1,
    surface: 'web',
    target: 'test://contact/technical',
    locale: 'en',
    viewport: { width: 1280, height: 800, scale: 1 },
    collectedAt: '2026-10-09T00:00:00.000Z',
    collector: { name: 'test', version: '0' },
    root: node({
      ref: 'html',
      role: 'document',
      lang: 'en',
      children: [
        node({ ref: 'h1', role: 'heading', name: 'Technical support', native: { tag: 'h1' }, bounds: onScreen }),
        node({
          ref: 'form',
          role: 'form',
          native: { tag: 'form' },
          children: [
            // Named only by aria-label, so 3.3.2 judges it; no autocomplete, so 1.3.5 judges it.
            input('#email', 'Email', { id: 'email', type: 'email', name: 'email', 'aria-label': 'Email' }),
            input(
              '#website',
              'Website',
              { id: 'website', type: 'text', name: 'website', tabindex: '-1', autocomplete: 'off', 'aria-label': 'Website' },
              { states: ['offscreen'], bounds: { x: -9999, y: -9943, width: 200, height: 20 } },
            ),
            // Squeezed to nothing and named like a trap, though still in the tab order.
            input('#hp', 'Leave this empty', { id: 'hp_field', type: 'text', name: 'hp', 'aria-label': 'Leave this empty' }, { bounds: { x: 40, y: 400, width: 0, height: 0 } }),
            // A real website field people fill in.
            input('#homepage', 'Your website', { id: 'homepage', type: 'url', name: 'website', 'aria-label': 'Your website' }),
            node({ ref: 'button', role: 'button', name: 'Send', native: { tag: 'button' }, bounds: onScreen }),
          ],
        }),
      ],
    }),
  }
}

describe('honeypot fields', () => {
  it('recognizes a field out of sight and out of the tab order, or out of sight and named like a trap', () => {
    const fields = new Map([...contactForm().root.children[1]!.children].map((child) => [child.ref, child]))
    expect(isHoneypot(fields.get('#website')!)).toBe(true)
    expect(isHoneypot(fields.get('#hp')!)).toBe(true)
    expect(isHoneypot(fields.get('#email')!)).toBe(false)
    expect(isHoneypot(fields.get('#homepage')!)).toBe(false)
    // tabindex="-1" alone does not make a visible field a trap.
    expect(isHoneypot(input('#visible', 'Website', { name: 'website', tabindex: '-1' }))).toBe(false)
  })

  it('1.3.5 leaves the trap out of its candidates and of the other fields it lists', () => {
    const candidates = identifyInputPurpose.candidates(contactForm(), noFindings)
    expect(candidates.map((c) => c.ref)).toEqual(['#email', '#homepage'])
    expect(JSON.stringify(candidates.map((c) => c.context))).not.toContain('Leave this empty')
  })

  it('3.3.2 leaves the trap out of its candidates', () => {
    const refs = labelsOrInstructions.candidates(contactForm(), noFindings).map((c) => c.ref)
    expect(refs).toContain('#email')
    expect(refs).toContain('#homepage')
    expect(refs).not.toContain('#website')
    expect(refs).not.toContain('#hp')
  })
})

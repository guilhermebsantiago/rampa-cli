import type { Confidence, Finding } from '../../core/types.ts'
import type { Locale } from '../../i18n.ts'
import { authData, authRecord } from '../../rules/auth.ts'
import type { A11ySnapshot } from '../../snapshot/schema.ts'
import { type CogaClipboard, type CogaData, type CogaElement, type CogaField, OBSERVE_VARIANT, PASTE_VALUES } from '../../probes/cognitive-kit.ts'
import type { AdvisoryCheck, AdvisoryHit } from '../check.ts'
import { cogaBasis } from '../coga.ts'
import { type AdvisoryMessageKey, am } from '../messages.ts'
import { MAX_PER_CHECK, elementFacts, experimental, htmlOf, nameOf, observedLoad, percent, quote } from '../observed.ts'
import type { Basis, Impact } from '../types.ts'

/**
 * COGA o8p02 Enable APIs and Extensions (https://www.w3.org/WAI/WCAG2/supplemental/patterns/o8p02-apis/), How it
 * Helps: "However, sometimes a web site stops extensions and APIs from working. The result is that these users cannot
 * use this web site."; for password and code fields also COGA o6p01, Avoid: "Using a password and not allowing pasting
 * into the field."
 *
 * Facts from the observe load of the cognitive observation, which dispatched the events itself at the end of the
 * window (nothing typed, no network):
 * - a text field (passwords and one-time codes included) where a paste event, or a beforeinput event of a paste,
 *   carrying a dummy value was cancelled and no field of its form changed after it. A handler that cancels the event
 *   to insert the value itself (trimmed, reformatted, spread across the boxes of a code) changes a field, so it is not
 *   reported; nor is one that reads the clipboard instead of the event. Medium confidence: the event was Rampa's,
 *   not a real Ctrl+V, which would mean typing into the page. Three fields or more, all of them cancelling, are one
 *   advisory: a script on the page cancels every paste;
 * - a field that cancels copy with nothing put in its place (password fields are left out: browsers never copy them);
 * - the page cancelling copy, or the context menu, on its longest block of text;
 * - user-select: none on half or more of the page's text, 200 characters at least.
 * A password or code field is a barrier, as it may keep the person from signing in; the rest is a hurdle, and the
 * context menu a suggestion.
 *
 * Sign-in fields overlap WCAG 3.3.8, which the authentication probe (--probe auth) checks with a real Ctrl+V: a field
 * with a 3.3.8 finding is left to it, and one where the real paste arrived is not reported. Both say so in a note.
 */

export const SELECT_SHARE = 0.5
export const SELECT_MIN_CHARS = 200
export const ALL_FIELDS = 3

export type ClipboardKind = 'paste' | 'paste-all' | 'copy' | 'copy-text' | 'contextmenu' | 'user-select'

export interface ClipboardBlock {
  kind: ClipboardKind
  el: CogaElement
  impact: Impact
  confidence: Confidence
  field?: CogaField | undefined
  fields?: CogaField[] | undefined
  /** paste: which event the page cancelled. */
  via?: 'paste' | 'beforeinput' | undefined
  share?: number | undefined
}

/** A paste the page cancelled with nothing inserted: by the paste event, or by the beforeinput event of a paste. */
export function pasteCancelled(field: CogaField): 'paste' | 'beforeinput' | undefined {
  if (field.paste.readClipboard) return undefined
  if (field.paste.prevented && !field.paste.changed) return 'paste'
  if (field.beforeinput?.prevented && !field.beforeinput.changed) return 'beforeinput'
  return undefined
}

/** What the page blocks, from the clipboard events. Pure: `skip` names the fields left to another check (3.3.8). */
export function clipboardBlocks(clipboard: CogaClipboard, skip: (field: CogaField) => boolean = () => false): ClipboardBlock[] {
  const blocks: ClipboardBlock[] = []
  const tested = clipboard.fields.filter((field) => !skip(field))
  const pasteBlocked = tested.filter((field) => pasteCancelled(field) !== undefined)
  const secret = (field: CogaField) => field.kind === 'password' || field.kind === 'code'
  if (pasteBlocked.length >= ALL_FIELDS && pasteBlocked.length === tested.length) {
    const first = pasteBlocked[0] as CogaField
    blocks.push({ kind: 'paste-all', el: first.el, impact: pasteBlocked.some(secret) ? 'barrier' : 'hurdle', confidence: 'medium', fields: pasteBlocked, via: pasteCancelled(first) })
  } else {
    for (const field of pasteBlocked) blocks.push({ kind: 'paste', el: field.el, impact: secret(field) ? 'barrier' : 'hurdle', confidence: 'medium', field, via: pasteCancelled(field) })
  }
  const text = clipboard.text
  const textCopyBlocked = Boolean(text?.copy.prevented && !text.copy.data)
  if (text && textCopyBlocked) blocks.push({ kind: 'copy-text', el: text.el, impact: 'hurdle', confidence: 'medium' })
  else {
    // With the page's own copy working, a field that cancels copy does it on its own.
    for (const field of tested) if (field.copy?.prevented && !field.copy.data) blocks.push({ kind: 'copy', el: field.el, impact: 'hurdle', confidence: 'medium', field })
  }
  if (text?.contextmenu.prevented) blocks.push({ kind: 'contextmenu', el: text.el, impact: 'suggestion', confidence: 'medium' })
  const select = text?.userSelect
  if (select && select.chars >= SELECT_MIN_CHARS && select.none / select.chars >= SELECT_SHARE) {
    blocks.push({ kind: 'user-select', el: select.by ?? (text as NonNullable<typeof text>).el, impact: 'hurdle', confidence: 'high', share: select.none / select.chars })
  }
  const rank: Record<Impact, number> = { barrier: 0, hurdle: 1, suggestion: 2 }
  return blocks.sort((a, b) => rank[a.impact] - rank[b.impact])
}

/** Fields the authentication probe tested with a real Ctrl+V, by ref, and whether the value arrived. */
function trustedPastes(snapshot: A11ySnapshot): Map<string, boolean> {
  const out = new Map<string, boolean>()
  const record = authRecord(snapshot.observations?.probes)
  if (!record) return out
  try {
    for (const step of authData(record).steps ?? []) for (const field of step.fields ?? []) if (field.paste && field.el?.ref) out.set(field.el.ref, field.paste.arrived)
  } catch {
    // A record of another shape: nothing to compare with.
  }
  return out
}

function valueOf(field: CogaField): string {
  const numeric = field.type === 'number' || field.type === 'tel'
  return field.kind === 'password' ? PASTE_VALUES.password : field.kind === 'code' || numeric ? PASTE_VALUES.code : field.kind === 'email' ? PASTE_VALUES.email : PASTE_VALUES.text
}

function messageOf(block: ClipboardBlock, clipboard: CogaClipboard, data: CogaData, locale: Locale): string {
  const parts: string[] = []
  const said = clipboard.alerts?.[0]
  switch (block.kind) {
    case 'paste': {
      const field = block.field as CogaField
      const how = am(locale, block.via === 'beforeinput' ? 'pbHowBeforeinput' : 'pbHowPaste')
      parts.push(am(locale, 'pbPaste', { field: am(locale, `field_${field.kind}` as AdvisoryMessageKey), how, value: valueOf(field) }))
      if (said) parts.push(am(locale, 'pbSaid', { text: quote(said) }))
      parts.push(am(locale, 'pbSynthetic'), am(locale, field.kind === 'password' ? 'pbLogin' : 'pbRecommend'))
      break
    }
    case 'paste-all': {
      const fields = (block.fields ?? []).slice(0, 4).map((field) => `"${field.label || field.el.ref || field.type}"`)
      parts.push(am(locale, 'pbAllFields', { count: block.fields?.length ?? 0, fields: fields.join(', ') }))
      if (said) parts.push(am(locale, 'pbSaid', { text: quote(said) }))
      parts.push(am(locale, 'pbSynthetic'), am(locale, (block.fields ?? []).some((field) => field.kind === 'password') ? 'pbLogin' : 'pbRecommend'))
      break
    }
    case 'copy':
      parts.push(am(locale, 'pbCopyField'), am(locale, 'pbRecommend'))
      break
    case 'copy-text':
      parts.push(am(locale, 'pbCopyText', { text: quote(block.el.label, 60) }), am(locale, 'pbTextRecommend'))
      break
    case 'contextmenu':
      parts.push(am(locale, 'pbMenu'), am(locale, 'pbTextRecommend'))
      break
    case 'user-select':
      parts.push(am(locale, 'pbSelect', { share: percent(block.share ?? 0, locale), by: nameOf(block.el) }), am(locale, 'pbTextRecommend'))
      break
  }
  parts.push(experimental(data, locale))
  return parts.join(' ')
}

export const pasteBlocked: AdvisoryCheck = {
  id: 'coga/paste-blocked',
  version: '1',
  maturity: 'experimental',
  pattern: 'o8p02',
  surfaces: ['web'],
  observes: true,

  run({ page, locale, coga, findings }) {
    const observe = observedLoad(page.snapshot, OBSERVE_VARIANT, locale, coga)
    if (!observe.data) return { ran: false, reason: observe.reason, candidates: 0, hits: [] }
    const data = observe.data
    const clipboard = data.clipboard ?? { fields: [] }
    const basis = cogaBasis('o8p02', 'how-it-helps', 'However, sometimes a web site stops extensions and APIs from working. The result is that these users cannot use this web site.')
    const login: Basis = cogaBasis('o6p01', 'avoid', 'Using a password and not allowing pasting into the field.')
    const notes: string[] = []
    const trusted = trustedPastes(page.snapshot)
    const wcag = new Set(findings.filter((finding: Finding) => finding.criterion === '3.3.8' && finding.ref).map((finding) => finding.ref as string))
    // A sign-in field the authentication probe tested with a real paste is its call: a finding stays WCAG's, an arrived paste wins.
    const skip = (field: CogaField): boolean => {
      const ref = field.el.ref
      if (!ref || pasteCancelled(field) === undefined) return false
      if (wcag.has(ref)) {
        notes.push(am(locale, 'pbLeftToWcag', { ref }))
        return true
      }
      if (trusted.get(ref) === true) {
        notes.push(am(locale, 'pbTrusted', { ref }))
        return true
      }
      return false
    }
    const blocks = clipboardBlocks(clipboard, skip)
    const hits: AdvisoryHit[] = blocks.slice(0, MAX_PER_CHECK).map((block) => {
      const field = block.field
      const facts: Record<string, string | number | boolean> = { block: block.kind, ...elementFacts(block.el) }
      if (field) {
        Object.assign(facts, { fieldKind: field.kind, type: field.type, label: field.label, onpaste: field.onpaste, pastePrevented: field.paste.prevented, pasteChanged: field.paste.changed })
        if (field.beforeinput) Object.assign(facts, { beforeinputPrevented: field.beforeinput.prevented, beforeinputChanged: field.beforeinput.changed })
        if (field.copy) Object.assign(facts, { copyPrevented: field.copy.prevented, copyData: field.copy.data })
      }
      if (block.fields) Object.assign(facts, { fields: block.fields.length, refs: block.fields.map((f) => f.el.ref ?? f.type).slice(0, 8).join(', ') })
      if (block.via) facts.via = block.via
      if (block.share !== undefined && clipboard.text) Object.assign(facts, { share: Math.round(block.share * 100) / 100, chars: clipboard.text.userSelect.chars, unselectable: clipboard.text.userSelect.none })
      if (clipboard.alerts?.length) facts.pageSaid = quote(clipboard.alerts[0] ?? '', 120)
      const secret = (field && (field.kind === 'password' || field.kind === 'code')) || (block.fields ?? []).some((f) => f.kind === 'password' || f.kind === 'code')
      return {
        kind: 'advisory',
        basis,
        related: secret ? [login] : undefined,
        impact: block.impact,
        source: 'rule',
        ref: block.el.ref,
        html: htmlOf(page, block.el),
        message: messageOf(block, clipboard, data, locale),
        evidence: field ? `${field.onpaste ? 'onpaste attribute; ' : ''}${block.via ?? 'paste'} event: defaultPrevented ${block.via === 'beforeinput' ? field.beforeinput?.prevented : field.paste.prevented}, value unchanged` : undefined,
        subject: block.kind,
        pageLevel: block.kind === 'paste-all' || block.kind === 'user-select' || block.kind === 'copy-text' || block.kind === 'contextmenu',
        facts,
        confidence: block.confidence,
      } satisfies AdvisoryHit
    })
    return { ran: true, candidates: clipboard.fields.length + (clipboard.text ? 1 : 0), hits, notes }
  },
}

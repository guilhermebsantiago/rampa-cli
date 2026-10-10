import type { Finding, ProbeCoverage } from '../core/types.ts'
import type { Locale } from '../i18n.ts'
import { type KeyChange, type KeyTrial, SCREEN_PIXELS, type SettingTrial, type ShortcutsData } from '../probes/shortcuts.ts'
import type { A11yNode, A11ySnapshot, ProbeRecord } from '../snapshot/schema.ts'
import { type ProbeRule, type ProbeRuleContext, asArray, asRecord, conditionsText, probeFinding, say } from './probes.ts'

export const SHORTCUTS_RULE = 'rampa/character-key-shortcuts'
/** Pixels (in the half-size capture) that must change for a key with no other effect to count: a few letters' worth. */
export const PIXEL_MIN = SCREEN_PIXELS
/** Scrolling of at least this many CSS px counts. */
const SCROLL_MIN = 4
const MAX_KEYS_LISTED = 8

/** Whether a key press, or a wait with no key, changed the page as a reader would notice. */
export function changed(change: KeyChange | undefined): boolean {
  if (!change) return false
  const scroll = change.scroll ? Math.abs(change.scroll.x) + Math.abs(change.scroll.y) : 0
  return change.dom > 0 || change.focus !== undefined || scroll >= SCROLL_MIN || change.url === true || change.events.length > 0 || change.pixels >= PIXEL_MIN
}

export interface ShortcutVerdicts {
  /** Keys that changed the page on both presses, with nothing changing in the wait with no key before the second. */
  active: KeyTrial[]
  /** The setting that stopped each key, when one did. */
  blockedBy: Map<string, SettingTrial>
  /** Active keys no setting on the page stopped. */
  unblocked: KeyTrial[]
  /** Changed the page on the first press only. */
  once: string[]
  /** Changed it, but the page also changed in the wait with no key: not attributed. */
  noisy: string[]
  /** Not pressed a second time (budget). */
  unconfirmed: string[]
  /** Toggled settings that stopped none of the keys. */
  ineffective: SettingTrial[]
  /** Settings or controls that may lead to a way to turn the shortcuts off, which the probe could not reach without a click. */
  needsJudgment: boolean
}

/** The rule's reading of the probe's facts; the 2.1.4 judgment reads the same, so both agree on what is pending. */
export function shortcutVerdicts(data: ShortcutsData): ShortcutVerdicts {
  const keys = asArray<KeyTrial>(data.keys).filter((trial) => trial && typeof trial.key === 'string' && trial.first)
  const active: KeyTrial[] = []
  const once: string[] = []
  const noisy: string[] = []
  const unconfirmed: string[] = []
  for (const trial of keys) {
    if (!changed(trial.first)) continue
    if (!trial.second) unconfirmed.push(trial.key)
    else if (changed(trial.control)) noisy.push(trial.key)
    else if (changed(trial.second)) active.push(trial)
    else once.push(trial.key)
  }
  const settings = asArray<SettingTrial>(data.settings).filter((s) => s && typeof s.ref === 'string')
  const blockedBy = new Map<string, SettingTrial>()
  const ineffective: SettingTrial[] = []
  for (const setting of settings) {
    if (!setting.toggled) continue
    let stopped = 0
    for (const { key, change } of asArray<{ key: string; change: KeyChange }>(setting.keys)) {
      if (active.some((t) => t.key === key) && !changed(change)) {
        stopped++
        if (!blockedBy.has(key)) blockedBy.set(key, setting)
      }
    }
    if (stopped === 0) ineffective.push(setting)
  }
  const unblocked = active.filter((trial) => !blockedBy.has(trial.key))
  const needsJudgment = unblocked.length > 0 && (asArray(data.hidden).length > 0 || asArray(data.openers).length > 0)
  return { active, blockedBy, unblocked, once, noisy, unconfirmed, ineffective, needsJudgment }
}

/** The page as a whole: a shortcut listens on the document, not on one element. */
export function shortcutNode(snapshot: A11ySnapshot): A11yNode {
  return snapshot.root.children.find((child) => child.native.tag === 'body') ?? snapshot.root
}

const keyName = (key: string) => `"${key}"`

function sampleText(sample: KeyChange['samples'][number], locale: Locale): string {
  const label = sample.label ? ` "${sample.label.length > 40 ? `${sample.label.slice(0, 39)}…` : sample.label}"` : ''
  const el = `<${sample.tag}>${label}`
  if (sample.what === 'added') return say(locale, `added ${el}`, `adicionou ${el}`)
  if (sample.what === 'removed') return say(locale, `removed ${el}`, `removeu ${el}`)
  if (sample.what === 'text') return say(locale, `changed the text of ${el}`, `mudou o texto de ${el}`)
  return say(locale, `set ${sample.what} on ${el}`, `mudou ${sample.what} em ${el}`)
}

const EVENTS: Record<string, [string, string]> = {
  open: ['opened a window', 'abriu uma janela'],
  popup: ['opened a window', 'abriu uma janela'],
  submit: ['submitted a form', 'enviou um formulário'],
  modal: ['opened a modal dialog', 'abriu um diálogo modal'],
  history: ['added a history entry', 'adicionou uma entrada ao histórico'],
  navigation: ['started a navigation (answered by the guard)', 'iniciou uma navegação (respondida pelo guarda)'],
}

/** What a key did, in a few words: "moved focus to <input> "Search"", "added <li>". */
export function effectOf(change: KeyChange, locale: Locale): string {
  const parts: string[] = []
  if (change.focus) {
    const label = change.focus.label ? ` "${change.focus.label.length > 40 ? `${change.focus.label.slice(0, 39)}…` : change.focus.label}"` : ''
    parts.push(say(locale, `moved focus to <${change.focus.tag}>${label}`, `moveu o foco para <${change.focus.tag}>${label}`))
  }
  for (const event of change.events) {
    const words = EVENTS[event] ?? (event.startsWith('dialog-') ? ['opened a browser dialog', 'abriu um diálogo do navegador'] : undefined)
    if (words && !parts.includes(say(locale, words[0], words[1]))) parts.push(say(locale, words[0], words[1]))
  }
  if (change.url) parts.push(say(locale, 'changed the address', 'mudou o endereço'))
  if (change.scroll && Math.abs(change.scroll.x) + Math.abs(change.scroll.y) >= SCROLL_MIN) {
    parts.push(say(locale, `scrolled the window by ${change.scroll.x}, ${change.scroll.y} px`, `rolou a janela em ${change.scroll.x}, ${change.scroll.y} px`))
  }
  if (change.dom > 0) {
    const first = change.samples[0]
    parts.push(first ? `${sampleText(first, locale)}${change.dom > 1 ? say(locale, ` (${change.dom} changes)`, ` (${change.dom} mudanças)`) : ''}` : say(locale, `${change.dom} change(s) to the page`, `${change.dom} mudança(s) na página`))
  }
  if (parts.length === 0 && change.pixels > 0) parts.push(say(locale, 'changed what the window shows', 'mudou o que a janela mostra'))
  return parts.join(', ')
}

function settingName(setting: Pick<SettingTrial, 'tag' | 'label' | 'kind'>): string {
  const label = setting.label.length > 60 ? `${setting.label.slice(0, 59)}…` : setting.label
  return `<${setting.tag === 'input' ? `input type=${setting.kind}` : setting.tag}>${label ? ` "${label}"` : ''}`
}

const TEXT: Record<Locale, { found: string; nothing: string; ineffective: string; pending: string; leads: string; fix: string }> = {
  en: {
    found: 'Pressing {keys} with focus on the page, and no other key held, changes it: single character key shortcuts that work while no control has focus.',
    nothing: 'Nothing on this page turns them off or remaps them.',
    ineffective: 'Toggling {settings} did not stop them.',
    pending: 'A setting that may turn them off is not showing{hidden}{openers}; Rampa never clicks to open it, so whether the way there is clearly labeled is for the model or for you to decide.',
    leads: '{openers} may lead to a setting that turns them off; Rampa never clicks to follow it, so whether it is clearly labeled is for the model or for you to decide.',
    fix: 'Let people turn them off, or remap them to include a key such as Ctrl or Alt, or make each work only while its control has focus (WCAG 2.1.4; F99). If a setting elsewhere, such as another page or the account settings, already does this, the criterion is satisfied: waive this finding (rampa waive).',
  },
  'pt-BR': {
    found: 'Pressionar {keys} com o foco na página, sem outra tecla segurada, muda a página: atalhos de uma tecla que funcionam enquanto nenhum controle tem o foco.',
    nothing: 'Nada nesta página os desliga nem os remapeia.',
    ineffective: 'Alternar {settings} não os interrompeu.',
    pending: 'Uma configuração que pode desligá-los não está visível{hidden}{openers}; o Rampa nunca clica para abri-la, então se o caminho até ela está claramente identificado fica para o modelo ou para você decidir.',
    leads: '{openers} pode levar a uma configuração que os desliga; o Rampa nunca clica para segui-lo, então se está claramente identificado fica para o modelo ou para você decidir.',
    fix: 'Permita desligá-los, ou remapeá-los para incluir uma tecla como Ctrl ou Alt, ou faça cada um funcionar só quando seu controle tem o foco (WCAG 2.1.4; F99). Se uma configuração em outro lugar, como outra página ou as configurações da conta, já faz isso, o critério está atendido: dispense este achado (rampa waive).',
  },
}

/**
 * 2.1.4 Character Key Shortcuts, over the shortcuts probe. One finding per page, listing the printable keys that
 * changed it twice with focus on the body (and not in the wait with no key) that no setting on the page stopped.
 * A setting the probe toggled that stopped a key clears that key. Settings it could not reach (a closed dialog) and
 * controls that may lead to them are named in the message; the 2.1.4 judgment may clear the finding when it reads
 * one of them as clearly labeled (src/criteria/character-key-shortcuts.ts). Confidence medium: a setting on another
 * page satisfies the criterion, and the message says so.
 */
export const shortcutsRule: ProbeRule = {
  id: SHORTCUTS_RULE,
  kind: 'shortcuts',
  variant: 'character-keys',
  versions: ['1'],
  criteria: ['2.1.4'],
  run(record: ProbeRecord, ctx: ProbeRuleContext) {
    const data = asRecord(record.data) as unknown as ShortcutsData
    const verdicts = shortcutVerdicts(data)
    const text = TEXT[ctx.locale]
    const findings: Finding[] = []
    const { active, blockedBy, unblocked } = verdicts
    const hidden = asArray<ShortcutsData['hidden'][number]>(data.hidden)
    const openers = asArray<ShortcutsData['openers'][number]>(data.openers)
    if (unblocked.length > 0) {
      const listed = unblocked.slice(0, MAX_KEYS_LISTED)
      const keys = `${listed.map((t) => keyName(t.key)).join(', ')}${unblocked.length > listed.length ? say(ctx.locale, ` and ${unblocked.length - listed.length} more`, ` e mais ${unblocked.length - listed.length}`) : ''}`
      const parts = [text.found.replace('{keys}', keys)]
      if (verdicts.ineffective.length > 0) parts.push(text.ineffective.replace('{settings}', verdicts.ineffective.slice(0, 3).map(settingName).join(', ')))
      if (verdicts.needsJudgment) {
        const named = [...new Set(openers.map((o) => `<${o.tag}> "${o.label}"`))].slice(0, 3).join(', ')
        if (hidden[0]) {
          const hiddenText = ` (${settingName({ tag: hidden[0].tag, label: hidden[0].label, kind: 'checkbox' })})`
          const openerText = named ? say(ctx.locale, `, and ${named} may lead to it`, `, e ${named} pode levar a ela`) : ''
          parts.push(text.pending.replace('{hidden}', hiddenText).replace('{openers}', openerText))
        } else parts.push(text.leads.replace('{openers}', named))
      } else if (verdicts.ineffective.length === 0) parts.push(text.nothing)
      parts.push(text.fix)
      const evidence = `${listed.map((t) => `${keyName(t.key)} ${effectOf(t.second ?? t.first, ctx.locale)}`).join('; ')}${say(
        ctx.locale,
        `; each on two presses with focus on the body, and nothing changed in the same wait with no key`,
        `; cada uma em duas pressões com o foco no body, e nada mudou na mesma espera sem tecla`,
      )}`
      findings.push(
        probeFinding({
          criterion: '2.1.4',
          rule: this.id,
          node: shortcutNode(ctx.snapshot),
          message: parts.join(' '),
          evidence,
          confidence: 'medium',
          subject: 'character-key-shortcuts',
        }),
      )
    }

    const blocked = [...blockedBy.entries()]
    const bySetting = new Map<string, string[]>()
    for (const [key, setting] of blocked) bySetting.set(settingName(setting), [...(bySetting.get(settingName(setting)) ?? []), keyName(key)])
    const pressed = Number(data.pressed) || 0
    const selects = asArray(data.selects).length
    const documented = asArray<string>(data.documented)
    const end = data.end
    const notes = [
      end === 'no-listeners'
        ? say(ctx.locale, 'the page has no key listener, so no key was pressed', 'a página não tem ouvinte de teclas, então nenhuma tecla foi pressionada')
        : say(ctx.locale, `${pressed} printable key(s) pressed one at a time with focus on the page`, `${pressed} tecla(s) imprimível(is) pressionada(s) uma a uma com o foco na página`),
      active.length > 0 ? say(ctx.locale, `${active.length} change it (${active.slice(0, 12).map((t) => keyName(t.key)).join(', ')})`, `${active.length} a mudam (${active.slice(0, 12).map((t) => keyName(t.key)).join(', ')})`) : '',
      ...[...bySetting.entries()].map(([setting, keys]) => say(ctx.locale, `${setting} turns off or remaps ${keys.join(', ')}`, `${setting} desliga ou remapeia ${keys.join(', ')}`)),
      verdicts.noisy.length > 0
        ? say(ctx.locale, `${verdicts.noisy.length} changed it while the page also changed with no key pressed, not counted`, `${verdicts.noisy.length} a mudaram enquanto a página também mudava sem tecla, não contada(s)`)
        : '',
      verdicts.once.length > 0 ? say(ctx.locale, `${verdicts.once.length} changed it on one press of two, not counted`, `${verdicts.once.length} a mudaram em uma de duas pressões, não contada(s)`) : '',
      verdicts.unconfirmed.length > 0 ? say(ctx.locale, `${verdicts.unconfirmed.length} not pressed a second time (budget)`, `${verdicts.unconfirmed.length} não pressionada(s) uma segunda vez (limite)`) : '',
      asArray(data.settings).length > 0 ? say(ctx.locale, `${asArray(data.settings).length} shortcut setting(s) toggled with Space and put back`, `${asArray(data.settings).length} configuração(ões) de atalho alternada(s) com Espaço e restaurada(s)`) : '',
      hidden.length > 0 ? say(ctx.locale, `${hidden.length} shortcut setting(s) not showing, not reached`, `${hidden.length} configuração(ões) de atalho não visível(is), não alcançada(s)`) : '',
      selects > 0 ? say(ctx.locale, `${selects} shortcut select(s) found, not changed`, `${selects} seleção(ões) de atalho encontrada(s), não alterada(s)`) : '',
      documented.length > 0 ? say(ctx.locale, `aria-keyshortcuts on the page: ${documented.slice(0, 5).join(', ')}`, `aria-keyshortcuts na página: ${documented.slice(0, 5).join(', ')}`) : '',
      end === 'time' ? say(ctx.locale, 'time budget reached', 'limite de tempo atingido') : '',
      data.listeners === null ? say(ctx.locale, 'key listeners not read', 'ouvintes de teclas não lidos') : '',
    ].filter(Boolean)
    const viewport = asRecord(data.viewport)
    const coverage: ProbeCoverage = {
      criterion: '2.1.4',
      method: `probe/shortcuts@${record.version}`,
      rule: this.id,
      conditions: conditionsText(
        record,
        say(
          ctx.locale,
          `printable keys with focus on the body at ${Number(viewport.width) || 0}×${Number(viewport.height) || 0}`,
          `teclas imprimíveis com o foco no body em ${Number(viewport.width) || 0}×${Number(viewport.height) || 0}`,
        ),
      ),
      status: end === 'focus-stuck' ? 'not-checked' : findings.length > 0 ? 'failures' : 'no-failure-found',
      // The keys that changed the page are what the rule decided about.
      applicable: end === 'focus-stuck' ? 0 : active.length,
      failures: findings.length,
      review: 0,
      unmatched: 0,
      note: end === 'focus-stuck' ? say(ctx.locale, 'a field kept focus, so no key was pressed', 'um campo manteve o foco, então nenhuma tecla foi pressionada') : notes.join('; '),
      maturity: 'experimental',
    }
    return { findings, review: [], coverage: [coverage] }
  },
}

import type { Report } from '../core/types.ts'
import type { Locale } from '../i18n.ts'
import type { Painter } from '../report/color.ts'
import type { BaselineEntry } from './baseline.ts'

const messages = {
  en: {
    noNew: 'No new confirmed failures in what was checked; the baseline holds back {count} known finding(s).',
    known: 'Baseline {file}: {count} known finding(s) not shown.',
    knownMoved: 'Baseline {file}: {count} known finding(s) not shown ({moved} matched by content, as their element moved).',
    knownTitle: 'Known from the baseline',
    notInBaseline: 'This target is not in the baseline {file}, so every finding counts as new.',
    otherPath: 'Compared with {recordedAs} in the baseline: the same path on another host.',
    fixed: '{count} baseline finding(s) no longer found; once you confirm they are fixed, record the baseline again with rampa baseline:',
    more: '… and {count} more (--verbose lists them).',
    unchecked: '{count} baseline finding(s) could not be checked again in this run: {why}.',
    uncheckedNoJudgment: 'they need the judgment layer, which did not run',
    uncheckedPartial: 'their criterion was not judged, or the model abstained or failed on part of it',
    uncheckedNoEngine: 'the engine did not run on this target',
    otherModel: 'The baseline was recorded with {recorded}; this run used {current}, which can judge differently.',
    noJudgmentRecorded: 'The baseline for this target was recorded without the judgment layer, so judgment findings count as new.',
    newCriteria: 'The baseline did not judge {criteria} on this target, so their findings count as new.',
    waived: '{count} finding(s) waived (rampa waivers lists why).',
    expired: '{count} waiver(s) expired, so their findings are reported again:',
    expiredOn: 'expired on {date}',
  },
  'pt-BR': {
    noNew: 'Nenhuma falha confirmada nova no que foi verificado; a baseline segura {count} achado(s) já conhecido(s).',
    known: 'Baseline {file}: {count} achado(s) já conhecido(s) não mostrado(s).',
    knownMoved: 'Baseline {file}: {count} achado(s) já conhecido(s) não mostrado(s) ({moved} pelo conteúdo, porque o elemento mudou de lugar).',
    knownTitle: 'Já conhecidos da baseline',
    notInBaseline: 'Este alvo não está na baseline {file}, então todo achado conta como novo.',
    otherPath: 'Comparado com {recordedAs} da baseline: o mesmo caminho em outro host.',
    fixed: '{count} achado(s) da baseline não aparece(m) mais; depois de confirmar a correção, grave a baseline de novo com rampa baseline:',
    more: '… e mais {count} (--verbose lista todos).',
    unchecked: '{count} achado(s) da baseline não pôde(puderam) ser verificado(s) de novo nesta execução: {why}.',
    uncheckedNoJudgment: 'depende(m) da camada de julgamento, que não rodou',
    uncheckedPartial: 'o critério não foi julgado, ou o modelo se absteve ou falhou em parte dele',
    uncheckedNoEngine: 'o motor não rodou neste alvo',
    otherModel: 'A baseline foi gravada com {recorded}; esta execução usou {current}, que pode julgar diferente.',
    noJudgmentRecorded: 'A baseline deste alvo foi gravada sem a camada de julgamento, então os achados do julgamento contam como novos.',
    newCriteria: 'A baseline não julgou {criteria} neste alvo, então os achados desses critérios contam como novos.',
    waived: '{count} achado(s) dispensado(s) (rampa waivers mostra os motivos).',
    expired: '{count} dispensa(s) vencida(s), então os achados voltam a aparecer:',
    expiredOn: 'venceu em {date}',
  },
} as const

type Key = keyof (typeof messages)['en']

function say(locale: Locale, key: Key, vars: Record<string, string | number> = {}): string {
  const template: string = messages[locale][key] ?? messages.en[key]
  return template.replace(/\{(\w+)\}/g, (_, name: string) => String(vars[name] ?? `{${name}}`))
}

const LIST_LIMIT = 10

/** Replaces "no confirmed failures" when the baseline hid known ones: they are still failures. */
export function noNewFindings(report: Report): string | undefined {
  const known = report.baseline?.known.length ?? 0
  return known > 0 ? say(report.locale, 'noNew', { count: known }) : undefined
}

/** What the waivers and the baseline changed in this report, for the terminal. */
export function adoptionLines(report: Report, verbose: boolean, p: Painter): string[] {
  const locale = report.locale
  const lines: string[] = []

  if (report.waived.length > 0) lines.push(p.dim(say(locale, 'waived', { count: report.waived.length })))
  const expired = report.expiredWaivers ?? []
  if (expired.length > 0) {
    lines.push(p.yellow(say(locale, 'expired', { count: expired.length })))
    for (const waiver of expired) {
      const when = waiver.expires ? say(locale, 'expiredOn', { date: waiver.expires }) : ''
      lines.push(p.yellow(`  ${waiver.fingerprint} ${[when, waiver.reason].filter(Boolean).join(': ')}`))
    }
  }

  const baseline = report.baseline
  if (!baseline) return lines
  if (!baseline.recordedAs) {
    lines.push(p.yellow(say(locale, 'notInBaseline', { file: baseline.file })))
    return lines
  }
  if (baseline.known.length > 0) {
    const vars = { file: baseline.file, count: baseline.known.length, moved: baseline.moved }
    lines.push(p.dim(say(locale, baseline.moved > 0 ? 'knownMoved' : 'known', vars)))
    if (verbose) {
      lines.push(p.dim(`${say(locale, 'knownTitle')}:`))
      for (const finding of baseline.known) lines.push(p.dim(`  · ${finding.criterion} ${finding.ref ?? finding.target ?? ''}  ${finding.message}`))
    }
  }
  // Only a URL can match a baseline entry under another key: the same path on another host.
  if (/^https?:\/\//i.test(report.target) && baseline.recordedAs !== report.target) {
    lines.push(p.dim(say(locale, 'otherPath', { recordedAs: baseline.recordedAs })))
  }
  lines.push(...settingNotes(report).map((note) => p.yellow(note)))
  if (baseline.fixed.length > 0) {
    lines.push(p.green(say(locale, 'fixed', { count: baseline.fixed.length })))
    const shown = verbose ? baseline.fixed : baseline.fixed.slice(0, LIST_LIMIT)
    for (const entry of shown) lines.push(entryLine(entry, p))
    if (shown.length < baseline.fixed.length) lines.push(p.dim(`  ${say(locale, 'more', { count: baseline.fixed.length - shown.length })}`))
  }
  const uncheckedEngine = baseline.unchecked.filter((entry) => entry.source === 'engine').length
  const uncheckedJudgment = baseline.unchecked.length - uncheckedEngine
  if (uncheckedEngine > 0) lines.push(p.yellow(say(locale, 'unchecked', { count: uncheckedEngine, why: say(locale, 'uncheckedNoEngine') })))
  if (uncheckedJudgment > 0) {
    const why = say(locale, report.llm === 'on' ? 'uncheckedPartial' : 'uncheckedNoJudgment')
    lines.push(p.yellow(say(locale, 'unchecked', { count: uncheckedJudgment, why })))
  }
  return lines
}

function entryLine(entry: BaselineEntry, p: Painter): string {
  return `  ${p.green('✓')} ${entry.criterion} ${entry.ref ?? ''}  ${p.dim(entry.message)}`
}

/** When this run is not comparable with how the baseline was recorded, say what differs. */
function settingNotes(report: Report): string[] {
  const recorded = report.baseline?.recorded
  if (!recorded) return []
  const locale = report.locale
  const notes: string[] = []
  if (report.llm === 'on' && recorded.llm !== 'on') notes.push(say(locale, 'noJudgmentRecorded'))
  if (report.llm === 'on' && recorded.llm === 'on') {
    if (recorded.model && report.model && recorded.model !== report.model) {
      notes.push(say(locale, 'otherModel', { recorded: recorded.model, current: report.model }))
    }
    const missing = report.coverage.judged.filter((criterion) => !recorded.criteria.includes(criterion))
    if (missing.length > 0) notes.push(say(locale, 'newCriteria', { criteria: missing.join(', ') }))
  }
  return notes
}

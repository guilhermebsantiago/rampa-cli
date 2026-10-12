import type { TimingStage, Timings } from '../core/timings.ts'
import type { Report } from '../core/types.ts'
import type { Locale } from '../i18n.ts'
import type { Painter } from './color.ts'

const STAGE_LABELS: Record<TimingStage, { en: string; 'pt-BR': string }> = {
  'browser-launch': { en: 'browser launch', 'pt-BR': 'abrir o navegador' },
  navigation: { en: 'navigation', 'pt-BR': 'navegação' },
  settle: { en: 'settle after load', 'pt-BR': 'espera após o carregamento' },
  collection: { en: 'collection', 'pt-BR': 'coleta' },
  axe: { en: 'axe-core', 'pt-BR': 'axe-core' },
  'ax-tree': { en: 'browser accessibility tree', 'pt-BR': 'árvore de acessibilidade do navegador' },
  'image-capture': { en: 'image capture', 'pt-BR': 'captura de imagens' },
  'label-visibility': { en: 'label visibility (pixels)', 'pt-BR': 'visibilidade dos rótulos (pixels)' },
  'pixel-contrast': { en: 'contrast (pixels)', 'pt-BR': 'contraste (pixels)' },
  'link-following': { en: 'link following', 'pt-BR': 'leitura dos destinos dos links' },
  screenshot: { en: 'page screenshot', 'pt-BR': 'captura da página' },
  probes: { en: 'probes', 'pt-BR': 'sondas' },
  teardown: { en: 'closing the page', 'pt-BR': 'fechar a página' },
  rules: { en: 'rules', 'pt-BR': 'regras' },
  advisory: { en: 'advisory profiles', 'pt-BR': 'perfis consultivos' },
  source: { en: 'source lines', 'pt-BR': 'linhas do código-fonte' },
}

const WORDS = {
  en: {
    title: 'Time on this page: {total} (--timings)',
    judgment: 'judgment {criterion}',
    other: 'other',
    prepare: '{time} preparing',
    candidates: '{count} candidate(s)',
    judged: '{count} judged',
    calls: '{calls} model call(s), {cached} from cache',
    batches: '{count} batched',
  },
  'pt-BR': {
    title: 'Tempo nesta página: {total} (--timings)',
    judgment: 'julgamento {criterion}',
    other: 'outros',
    prepare: '{time} preparando',
    candidates: '{count} candidato(s)',
    judged: '{count} julgado(s)',
    calls: '{calls} chamada(s) ao modelo, {cached} do cache',
    batches: '{count} em lote',
  },
} as const

function say(locale: Locale, key: keyof (typeof WORDS)['en'], vars: Record<string, string | number> = {}): string {
  return WORDS[locale][key].replace(/\{(\w+)\}/g, (_, name: string) => String(vars[name] ?? `{${name}}`))
}

/** Seconds with two decimals under ten seconds and one above, in the report's language. */
export function seconds(ms: number, locale: Locale): string {
  const text = (ms / 1000).toFixed(ms < 10_000 ? 2 : 1)
  return `${locale === 'pt-BR' ? text.replace('.', ',') : text} s`
}

/** The time breakdown of a report made with --timings, one line per stage and per judged criterion; empty without it. */
export function timingLines(report: Report, p: Painter): string[] {
  const timings = report.timings
  if (!timings) return []
  const { locale } = report
  const rows = timingRows(timings, locale)
  const width = Math.max(...rows.map((row) => row.label.length)) + 2
  const lines = [p.bold(say(locale, 'title', { total: seconds(timings.totalMs, locale) }))]
  for (const row of rows) {
    const share = timings.totalMs > 0 ? `${Math.round((row.ms / timings.totalMs) * 100)}%` : ''
    const time = seconds(row.ms, locale).padStart(8)
    lines.push(`  ${row.label.padEnd(width)}${time} ${share.padStart(4)}${row.detail ? p.dim(` · ${row.detail}`) : ''}`)
  }
  return lines
}

interface TimingRow {
  label: string
  ms: number
  detail?: string | undefined
}

function timingRows(timings: Timings, locale: Locale): TimingRow[] {
  // The stages before judgment, the criteria, then the stages after it, as the page ran them.
  const after = new Set<TimingStage>(['advisory', 'source'])
  const stage = (entry: Timings['stages'][number]): TimingRow => ({
    label: STAGE_LABELS[entry.stage][locale],
    ms: entry.ms,
    detail: entry.parts?.map((part) => `${part.name} ${seconds(part.ms, locale)}`).join(', '),
  })
  const criteria = timings.criteria.map((c): TimingRow => {
    const detail = [
      say(locale, 'candidates', { count: c.candidates }),
      c.judged !== c.candidates ? say(locale, 'judged', { count: c.judged }) : undefined,
      c.calls + c.cachedCalls > 0 ? say(locale, 'calls', { calls: c.calls, cached: c.cachedCalls }) : undefined,
      c.batches ? say(locale, 'batches', { count: c.batches }) : undefined,
      c.prepareMs >= 50 ? say(locale, 'prepare', { time: seconds(c.prepareMs, locale) }) : undefined,
    ].filter((part) => part !== undefined)
    return { label: say(locale, 'judgment', { criterion: c.criterion }), ms: c.ms, detail: detail.join(', ') }
  })
  return [
    ...timings.stages.filter((s) => !after.has(s.stage)).map(stage),
    ...criteria,
    ...timings.stages.filter((s) => after.has(s.stage)).map(stage),
    { label: say(locale, 'other'), ms: timings.otherMs },
  ]
}

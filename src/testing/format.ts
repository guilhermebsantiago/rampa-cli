import type { Finding, Report } from '../core/types.ts'
import { type Locale, t } from '../i18n.ts'
import { displayTarget } from '../report/pretty.ts'
import { compareCriteria, criteriaFor, criterionLabel, versionOf } from '../wcag.ts'

/** When reports pass, for the matchers, `assertRampa` and the fixture. */
export interface AssertOptions {
  /** 'confirmed' (default): findings at or above minConfidence fail, like --fail-on confirmed. 'any': findings below it fail too. */
  failOn?: 'confirmed' | 'any' | undefined
  /** Also fail when the judgment did not run on every candidate: judgment off, no model, an offline cache miss or a model error. */
  requireJudgment?: boolean | undefined
}

export interface Assessment {
  pass: boolean
  /** Findings that fail under the policy, report by report. */
  failing: Array<{ report: Report; findings: Array<{ finding: Finding; belowThreshold: boolean }> }>
  /** Why the judgment cannot be counted as done, one sentence each. */
  problems: string[]
}

// The strings of the test-runner integration live here, next to the code that prints them.
const TEXT = {
  en: {
    failure: 'Rampa: {count} failure in {target}',
    failures: 'Rampa: {count} failures in {target}',
    noFailures: 'Rampa: no failures in {target}',
    scope: 'scope: {include}',
    excluding: 'excluding {exclude}',
    element: 'Element',
    message: 'Message',
    evidence: 'Evidence',
    patch: 'Patch',
    html: 'HTML',
    rule: 'Rule',
    judged: 'Judged',
    waiver: 'Waiver id',
    belowThreshold: 'below the confidence threshold',
    confidence: 'confidence {level}',
    runs: '{votes}/{total} runs',
    verified: 'evidence verified',
    coverage: 'Coverage: {engine} checked {engineList}; judged with verified evidence: {judgedList}; not checked automatically: {count} of {total} WCAG {version} A/AA criteria.',
    none: 'none',
    waiverHint: 'To dismiss a finding on purpose, add its waiver id to .rampa/waivers.json or to the waivers option.',
    expectedFailures: 'Expected Rampa to find failures, and it found none.',
    problems: 'The judgment did not run in full:',
    allErrors: 'the model failed on every candidate of WCAG {criterion}: {error}',
    off: 'the judgment layer was off (noLlm), so only {engine} ran',
    noModel: 'no model was configured, so only {engine} ran; pass model, set RAMPA_MODEL or start Ollama',
    offlineMisses: '{count} candidate(s) had no cached judgment (offline)',
    errors: 'the model failed on {count} candidate(s): {error}',
    findingsOne: '1 finding',
    findingsMany: '{count} findings',
    summaryJudged: 'judged: {list}',
    summaryNotChecked: 'not checked automatically: {count} of {total} WCAG {version} A/AA criteria',
    summaryModel: 'model {model}',
    summaryOff: 'judgment off (noLlm)',
    summaryNoModel: 'no model: {engine} only',
  },
  'pt-BR': {
    failure: 'Rampa: {count} falha em {target}',
    failures: 'Rampa: {count} falhas em {target}',
    noFailures: 'Rampa: nenhuma falha em {target}',
    scope: 'escopo: {include}',
    excluding: 'excluindo {exclude}',
    element: 'Elemento',
    message: 'Mensagem',
    evidence: 'Evidência',
    patch: 'Patch',
    html: 'HTML',
    rule: 'Regra',
    judged: 'Julgado',
    waiver: 'Dispensa',
    belowThreshold: 'abaixo do limiar de confiança',
    confidence: 'confiança {level}',
    runs: '{votes}/{total} rodadas',
    verified: 'evidência verificada',
    coverage: 'Cobertura: {engine} verificou {engineList}; julgado com evidência verificada: {judgedList}; não verificado automaticamente: {count} de {total} critérios WCAG {version} A/AA.',
    none: 'nenhum',
    waiverHint: 'Para dispensar um achado de propósito, adicione o id em .rampa/waivers.json ou na opção waivers.',
    expectedFailures: 'Esperava que o Rampa encontrasse falhas, e ele não encontrou nenhuma.',
    problems: 'O julgamento não rodou por completo:',
    allErrors: 'o modelo falhou em todos os candidatos de WCAG {criterion}: {error}',
    off: 'a camada de julgamento estava desligada (noLlm), então só o {engine} rodou',
    noModel: 'nenhum modelo configurado, então só o {engine} rodou; passe model, defina RAMPA_MODEL ou inicie o Ollama',
    offlineMisses: '{count} candidato(s) sem julgamento em cache (offline)',
    errors: 'o modelo falhou em {count} candidato(s): {error}',
    findingsOne: '1 achado',
    findingsMany: '{count} achados',
    summaryJudged: 'julgado: {list}',
    summaryNotChecked: 'não verificado automaticamente: {count} de {total} critérios WCAG {version} A/AA',
    summaryModel: 'modelo {model}',
    summaryOff: 'julgamento desligado (noLlm)',
    summaryNoModel: 'sem modelo: só o {engine}',
  },
} as const

type TextKey = keyof (typeof TEXT)['en']

function text(locale: Locale, key: TextKey, vars: Record<string, string | number> = {}): string {
  const template: string = TEXT[locale][key] ?? TEXT.en[key]
  return template.replace(/\{(\w+)\}/g, (_, name: string) => String(vars[name] ?? `{${name}}`))
}

export function isReport(value: unknown): value is Report {
  if (typeof value !== 'object' || value === null) return false
  const report = value as Partial<Report>
  return report.schemaVersion === 1 && Array.isArray(report.findings) && typeof report.coverage === 'object'
}

/** The reports in a value, or undefined when it holds none. */
export function asReports(value: unknown): Report[] | undefined {
  if (isReport(value)) return [value]
  if (Array.isArray(value) && value.length > 0 && value.every(isReport)) return value
  return undefined
}

/** Passes when no finding fails under the policy and the judgment did not break, as the CLI's exit code decides. */
export function assess(reports: readonly Report[], options: AssertOptions = {}): Assessment {
  const failing: Assessment['failing'] = []
  const problems: string[] = []
  for (const report of reports) {
    const findings = [
      ...report.findings.map((finding) => ({ finding, belowThreshold: false })),
      ...(options.failOn === 'any' ? report.belowThreshold.map((finding) => ({ finding, belowThreshold: true })) : []),
    ]
    if (findings.length > 0) failing.push({ report, findings })
    for (const problem of judgmentProblems(report, Boolean(options.requireJudgment))) {
      // Several reports of one run usually share a problem, such as no model; it is said once.
      if (!problems.includes(problem)) problems.push(problem)
    }
  }
  return { pass: failing.length === 0 && problems.length === 0, failing, problems }
}

function judgmentProblems(report: Report, required: boolean): string[] {
  const locale = report.locale
  const problems: string[] = []
  // The CLI exits 2 on these: a criterion the model could not judge at all is a broken run, not a pass.
  const broken = report.criteria.filter((summary) => summary.errors > 0 && summary.judged === 0)
  for (const summary of broken) problems.push(text(locale, 'allErrors', { criterion: summary.criterion, error: report.errors[0] ?? '' }))
  if (!required) return problems
  const engine = report.engine.name
  if (report.llm === 'off') problems.push(text(locale, 'off', { engine }))
  if (report.llm === 'no-model') problems.push(text(locale, 'noModel', { engine }))
  const misses = report.criteria.reduce((total, summary) => total + summary.offlineMisses, 0)
  if (misses > 0) problems.push(text(locale, 'offlineMisses', { count: misses }))
  const errors = report.criteria.filter((summary) => !broken.includes(summary)).reduce((total, summary) => total + summary.errors, 0)
  if (errors > 0) problems.push(text(locale, 'errors', { count: errors, error: report.errors[0] ?? '' }))
  return problems
}

/**
 * Readable text for a failed check: each failing finding with its criterion, element,
 * message, evidence and patch, then what the judgment could not do and the coverage.
 */
export function formatFindings(reports: Report | readonly Report[], options: AssertOptions = {}): string {
  const list = asReports(reports) ?? []
  const assessment = assess(list, options)
  const blocks = list.map((report) => {
    const failing = assessment.failing.find((entry) => entry.report === report)?.findings ?? []
    return formatReport(report, failing)
  })
  const locale = list[0]?.locale ?? 'en'
  if (assessment.problems.length > 0) blocks.push([text(locale, 'problems'), ...assessment.problems.map((problem) => `  - ${problem}`)].join('\n'))
  if (assessment.failing.length > 0) blocks.push(text(locale, 'waiverHint'))
  return blocks.join('\n\n')
}

/** The text for a negated assertion that failed: the reports passed, so it says so before their coverage. */
export function formatPassed(reports: Report | readonly Report[], options: AssertOptions = {}): string {
  const locale = asReports(reports)?.[0]?.locale ?? 'en'
  return `${text(locale, 'expectedFailures')}\n\n${formatFindings(reports, options)}`
}

function formatReport(report: Report, failing: Array<{ finding: Finding; belowThreshold: boolean }>): string {
  const locale = report.locale
  const target = displayTarget(report.target) + scopeText(report)
  const lines: string[] = [
    failing.length === 0
      ? text(locale, 'noFailures', { target })
      : text(locale, failing.length === 1 ? 'failure' : 'failures', { count: failing.length, target }),
  ]
  const ordered = [...failing].sort((a, b) => compareCriteria(a.finding.criterion, b.finding.criterion))
  ordered.forEach(({ finding, belowThreshold }, index) => {
    lines.push('', ...formatFinding(finding, index + 1, belowThreshold, report))
  })
  lines.push('', coverageLine(report), t(locale, 'disclaimer'))
  return lines.join('\n')
}

function formatFinding(finding: Finding, number: number, belowThreshold: boolean, report: Report): string[] {
  const locale = report.locale
  const labels: TextKey[] = ['element', 'message', 'evidence', 'patch', 'html', 'rule', 'judged', 'waiver']
  const width = Math.max(...labels.map((label) => text(locale, label).length)) + 2
  const field = (label: TextKey, value: string) => `   ${`${text(locale, label)}:`.padEnd(width)}${value}`
  const indent = ' '.repeat(3 + width)
  const lines = [`${number}. ${criterionLabel(finding.criterion, locale)}${belowThreshold ? ` (${text(locale, 'belowThreshold')})` : ''}`]
  lines.push(field('element', finding.ref ?? finding.target ?? '—'))
  lines.push(field('message', finding.message))
  if (finding.evidence) lines.push(field('evidence', `"${finding.evidence}"`))
  if (finding.patch?.before && finding.patch.after) {
    lines.push(field('patch', `- ${finding.patch.before}`), `${indent}+ ${finding.patch.after}`)
  } else if (finding.patch) {
    lines.push(field('patch', `${finding.patch.attribute ?? finding.patch.kind}: "${finding.patch.from ?? ''}" → "${finding.patch.to}"`))
  }
  if (finding.source === 'engine') {
    if (finding.html) lines.push(field('html', finding.html.length > 160 ? `${finding.html.slice(0, 159)}…` : finding.html))
    lines.push(field('rule', [`${report.engine.name} ${finding.ruleId ?? ''}`.trim(), finding.helpUrl].filter(Boolean).join(' · ')))
  } else {
    const parts = [finding.model, text(locale, 'confidence', { level: t(locale, finding.confidence) })]
    if (finding.agreement) parts.push(text(locale, 'runs', { votes: finding.agreement.votes, total: finding.agreement.total }))
    parts.push(text(locale, 'verified'))
    lines.push(field('judged', parts.filter(Boolean).join(' · ')))
  }
  lines.push(field('waiver', finding.fingerprint))
  return lines
}

function scopeText(report: Report): string {
  if (!report.scope) return ''
  const parts: string[] = []
  if (report.scope.include.length > 0) parts.push(text(report.locale, 'scope', { include: report.scope.include.join(', ') }))
  if (report.scope.exclude.length > 0) parts.push(text(report.locale, 'excluding', { exclude: report.scope.exclude.join(', ') }))
  return ` (${parts.join(', ')})`
}

function coverageLine(report: Report): string {
  const none = text(report.locale, 'none')
  return text(report.locale, 'coverage', {
    engine: report.engine.name,
    engineList: report.coverage.engine.join(', ') || none,
    judgedList: report.coverage.judged.join(', ') || none,
    count: report.coverage.notChecked.length,
    total: criteriaFor(versionOf(report.wcagTarget)).length,
    version: versionOf(report.wcagTarget),
  })
}

/** One line for a test report: what was found, judged and left unchecked, and whether a model ran. */
export function summarize(report: Report): string {
  const locale = report.locale
  const count = report.findings.length
  const judgment =
    report.llm === 'off'
      ? text(locale, 'summaryOff')
      : report.llm === 'no-model'
        ? text(locale, 'summaryNoModel', { engine: report.engine.name })
        : text(locale, 'summaryModel', { model: report.model ?? '—' })
  return [
    count === 1 ? text(locale, 'findingsOne') : text(locale, 'findingsMany', { count }),
    text(locale, 'summaryJudged', { list: report.coverage.judged.join(', ') || text(locale, 'none') }),
    text(locale, 'summaryNotChecked', {
      count: report.coverage.notChecked.length,
      total: criteriaFor(versionOf(report.wcagTarget)).length,
      version: versionOf(report.wcagTarget),
    }),
    judgment,
  ].join(' · ')
}

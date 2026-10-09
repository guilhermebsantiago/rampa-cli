import type { Painter } from '../report/color.ts'
import { criterionLabel } from '../wcag.ts'
import { type ComparedCriterion, type ComparedRun, type Comparison, type DifferingCase, type PairDiscrimination, type PairedCounts, type RunUsage, runTime } from './compare.ts'

/** Terminal and Markdown views of a comparison. Both show the same numbers; only the layout differs. */

export const COMPARE_NOTE =
  "Intervals are 95% Wilson score intervals. McNemar's exact test counts only the cases where one run is right and the other wrong; a large p means these cases cannot tell the runs apart, not that the runs are equally good."

const fixed = (value: number | undefined) => (value === undefined ? '—' : value.toFixed(2))
const kilo = (tokens: number) => `${(tokens / 1000).toFixed(1)}k`

function interval(ci: [number, number] | undefined): string {
  return ci ? `(${ci[0].toFixed(2)}–${ci[1].toFixed(2)})` : ''
}

function metric(value: number | undefined, ci: [number, number] | undefined): string {
  return value === undefined ? '—' : `${value.toFixed(2)} ${interval(ci)}`
}

function toldApart(result: PairDiscrimination | undefined): string {
  return result ? `${result.toldApart}/${result.total} ${interval(result.ci)}` : '—'
}

function seconds(usage: RunUsage): string {
  if (usage.msPerCall !== undefined) return (usage.msPerCall / 1000).toFixed(1)
  return usage.cachedCalls > 0 ? 'all cached' : '—'
}

function cost(run: ComparedRun): string {
  if (run.costUsd === undefined) return run.model ? 'price unknown' : '—'
  if (run.costUsd === 0) return 'local model, no API cost'
  return run.costUsd < 0.0001 ? '< US$ 0.0001' : `≈ US$ ${run.costUsd.toFixed(4)}`
}

function details(run: ComparedRun): string {
  const parts = [runTime(run.createdAt), `${run.cases} cases`]
  if (!run.llm) parts.push('no model')
  else if (run.runs !== undefined) parts.push(run.runs === 1 ? '1 judgment per candidate' : `${run.runs} judgments per candidate, majority vote`)
  if (run.llm) parts.push(run.verify ? 'verification on' : 'verification OFF (ablation)')
  if (run.actSha256) parts.push(`ACT ${run.actSha256.slice(0, 8)}`)
  return parts.filter((part): part is string => part !== undefined).join(' · ')
}

function caseSet(item: DifferingCase): string {
  return item.set === 'act' ? `ACT ${item.ruleId} (${item.ruleKind})` : `pair ${item.corruptor ?? ''} of ${item.ruleId}`
}

export function pValue(p: number): string {
  return p < 0.001 ? '< 0.001' : p.toFixed(3)
}

function pairedRows(paired: { criteria: Array<PairedCounts & { criterion: string }>; all: PairedCounts }): string[][] {
  const row = (name: string, counts: PairedCounts) =>
    [name, counts.shared, counts.bothRight, counts.onlyFirstRight, counts.onlySecondRight, counts.bothWrong].map(String).concat(pValue(counts.pValue))
  const rows = paired.criteria.map((counts) => row(counts.criterion, counts))
  if (paired.criteria.length > 1) rows.push(row('all', paired.all))
  return rows
}

/**
 * The rows of a criterion, for the runs that evaluated it. `name(i)` names run i;
 * the set or corruption kind is written on its first row only.
 */
function criterionRows(criterion: ComparedCriterion, name: (index: number) => string) {
  const present = criterion.usage.flatMap((usage, index) => (usage ? [index] : []))
  const sets = criterion.sets.flatMap((set) =>
    present.map((index, row) => {
      const score = set.scores[index]
      const first = row === 0 ? set.label : ''
      if (!score) return [first, name(index), '—', 'not in this run', '', '']
      return [first, name(index), String(score.n), metric(score.precision, score.precisionCi), metric(score.recall, score.recallCi), fixed(score.f1)]
    }),
  )
  const pairs = criterion.pairs.flatMap((pair) => present.map((index, row) => [row === 0 ? pair.corruptor : '', name(index), toldApart(pair.results[index])]))
  const judgment = present.flatMap((index) => {
    const usage = criterion.usage[index]
    return usage ? [[name(index), String(usage.candidates), String(usage.discarded), String(usage.cannotTell), `${usage.calls} + ${usage.cachedCalls}`, seconds(usage)]] : []
  })
  return { present, sets, pairs, judgment }
}

const SET_HEADERS = ['set', 'run', 'n', 'precision (95% CI)', 'recall (95% CI)', 'F1']
const JUDGMENT_HEADERS = ['run', 'candidates', 'discarded by verification', 'cannot tell', 'calls (new + cached)', 's per new call']

// Terminal

type Cell = string | { text: string; style: (text: string) => string }

/** Pads on the visible text, then styles, so colors never shift a column. */
function table(headers: string[], rows: Cell[][], p: Painter, right: ReadonlySet<number> = new Set()): string[] {
  const text = (cell: Cell | undefined) => (cell === undefined ? '' : typeof cell === 'string' ? cell : cell.text)
  const widths = headers.map((header, i) => Math.max(header.length, ...rows.map((row) => text(row[i]).length)))
  const last = headers.length - 1
  const pad = (value: string, i: number) => (right.has(i) ? value.padStart(widths[i] ?? 0) : i === last ? value : value.padEnd(widths[i] ?? 0))
  const line = (cells: Cell[]) =>
    `  ${cells
      .map((cell, i) => {
        const padded = pad(text(cell), i)
        return typeof cell === 'string' ? padded : cell.style(padded)
      })
      .join('  ')}`.trimEnd()
  return [p.dim(line(headers)), ...rows.map(line)]
}

export function renderComparison(comparison: Comparison, p: Painter): string {
  const { runs } = comparison
  const lines: string[] = []
  const id = (index: number) => runs[index]?.id ?? ''
  lines.push(p.bold(`rampa compare · ${runs.length} run${runs.length === 1 ? '' : 's'} · WCAG ${comparison.criteria.map((c) => c.criterion).join(', ')}`))
  for (const run of runs) {
    lines.push('', `  ${p.bold(run.id)}  ${p.cyan(run.label)}`, p.dim(`     ${details(run)}`), p.dim(`     ${run.dir}`))
  }

  for (const criterion of comparison.criteria) {
    const rows = criterionRows(criterion, id)
    lines.push('', p.bold(criterionLabel(criterion.criterion, 'en')))
    const dim = (cell: string) => (cell === 'not in this run' ? { text: cell, style: p.dim } : cell)
    lines.push(...table(SET_HEADERS, rows.sets.map((row) => row.map(dim)), p, new Set([2, 5])))
    if (rows.pairs.length > 0) lines.push('', ...table(['pair discrimination', 'run', 'corrupted copies told apart'], rows.pairs, p))
    lines.push('', ...table(['judgment', ...JUDGMENT_HEADERS], rows.judgment.map((row) => ['', ...row]), p, new Set([2, 3, 4, 6])))
    const absent = runs.filter((_, index) => !rows.present.includes(index)).map((run) => run.id)
    if (absent.length > 0) lines.push(p.dim(`  Not evaluated by ${absent.join(', ')}.`))
  }

  lines.push('', p.bold('All criteria, per run'))
  lines.push(
    ...table(
      ['run', 'cases', 'candidates', 'discarded by verification', 'cannot tell', 'model errors'],
      runs.map((run) => [run.id, String(run.cases), String(run.candidates), String(run.discarded), String(run.cannotTell), String(run.modelErrors)]),
      p,
      new Set([1, 2, 3, 4, 5]),
    ),
  )
  lines.push('')
  lines.push(
    ...table(
      ['run', 'calls (new + cached)', 'tokens in / out', 's per new call', 'cost'],
      runs.map((run) => [run.id, `${run.calls} + ${run.cachedCalls}`, `${kilo(run.inputTokens)} / ${kilo(run.outputTokens)}`, seconds(run), cost(run)]),
      p,
      new Set([3]),
    ),
  )

  const paired = comparison.paired
  const [first, second] = runs
  if (paired && first && second) {
    lines.push('')
    if (paired.all.shared === 0) {
      lines.push(p.bold(`Paired comparison of ${first.id} and ${second.id}`), '  No shared cases: the two runs evaluated different pages.')
    } else {
      lines.push(p.bold(`Paired comparison of ${first.id} and ${second.id} on ${paired.all.shared} shared cases`))
      lines.push(
        ...table(
          ['criterion', 'shared', 'both right', `only ${first.id} right`, `only ${second.id} right`, 'both wrong', 'McNemar p (exact)'],
          pairedRows(paired),
          p,
          new Set([1, 2, 3, 4, 5, 6]),
        ),
      )
      if (paired.onlyInFirst + paired.onlyInSecond > 0) {
        lines.push(p.dim(`  Left out: ${paired.onlyInFirst} case(s) only ${first.id} evaluated, ${paired.onlyInSecond} only ${second.id} evaluated.`))
      }
      lines.push('', p.bold(`  Verdicts that differ (${paired.differing.length})`))
      if (paired.differing.length === 0) lines.push('  None: on every shared case both runs gave the same verdict.')
      const verdict = (item: DifferingCase, index: 0 | 1) => {
        const right = (item.verdicts[index] === 'failed') === (item.expected === 'failed')
        return right ? p.green(`${item.verdicts[index]} ✓`) : p.red(`${item.verdicts[index]} ✗`)
      }
      for (const item of paired.differing) {
        lines.push(`  ${item.criterion}  ${caseSet(item)}  ${item.title} · expected ${item.expected} · ${first.id} ${verdict(item, 0)} · ${second.id} ${verdict(item, 1)}`)
        lines.push(p.dim(`    ${item.url}`))
      }
    }
  }

  if (comparison.warnings.length > 0) lines.push('', ...comparison.warnings.map((warning) => p.yellow(warning)))
  lines.push('', p.dim(COMPARE_NOTE))
  return lines.join('\n')
}

// Markdown

const escape = (value: string) => value.replaceAll('\\', '\\\\').replaceAll('|', '\\|').replaceAll('\n', ' ')
const code = (value: string) => `\`${value.replaceAll('`', '')}\``

/** A link destination with nothing that could end it early. */
const href = (url: string) => url.replaceAll('(', '%28').replaceAll(')', '%29').replaceAll(' ', '%20')

function markdownTable(headers: string[], rows: string[][], right: ReadonlySet<number> = new Set()): string[] {
  return [
    `| ${headers.map(escape).join(' | ')} |`,
    `| ${headers.map((_, i) => (right.has(i) ? '---:' : '---')).join(' | ')} |`,
    ...rows.map((row) => `| ${row.map((value) => (value === '' ? ' ' : value)).join(' | ')} |`),
  ]
}

export function comparisonMarkdown(comparison: Comparison): string {
  const { runs } = comparison
  const lines: string[] = []
  const named = (index: number) => {
    const run = runs[index]
    return run ? `${run.id} ${code(run.label)}` : ''
  }

  lines.push(`Rampa eval runs compared with \`rampa compare\` (rampa ${comparison.rampaVersion}). A page fails when axe-core or a verified judgment fails it.`, '')
  lines.push(
    ...markdownTable(
      ['Run', 'Model', 'Date', 'Cases', 'Judgments per candidate', 'Verification', 'ACT test cases'],
      runs.map((run) => [
        run.id,
        code(run.label),
        escape(runTime(run.createdAt) ?? '—'),
        String(run.cases),
        run.llm ? String(run.runs ?? '—') : 'no model',
        run.llm ? (run.verify ? 'on' : 'off (ablation)') : '—',
        run.actSha256 ? code(run.actSha256.slice(0, 8)) : '—',
      ]),
      new Set([3, 4]),
    ),
  )

  for (const criterion of comparison.criteria) {
    const rows = criterionRows(criterion, named)
    lines.push('', `### ${escape(criterionLabel(criterion.criterion, 'en'))}`, '')
    lines.push(...markdownTable(['Set', 'Run', 'n', 'Precision (95% CI)', 'Recall (95% CI)', 'F1'], rows.sets.map((row) => [escape(row[0] ?? ''), ...row.slice(1)]), new Set([2, 5])))
    if (rows.pairs.length > 0) {
      const pairs = rows.pairs.map(([kind = '', ...rest]) => [kind === '' ? '' : code(kind), ...rest])
      lines.push('', ...markdownTable(['Pair discrimination', 'Run', 'Corrupted copies told apart (95% CI)'], pairs))
    }
    lines.push('', ...markdownTable(['Run', 'Candidates', 'Discarded by verification', 'Cannot tell', 'Calls (new + cached)', 'Seconds per new call'], rows.judgment, new Set([1, 2, 3, 5])))
    const absent = runs.filter((_, index) => !rows.present.includes(index)).map((run) => `${run.id} ${code(run.label)}`)
    if (absent.length > 0) lines.push('', `Not evaluated by ${absent.join(', ')}.`)
  }

  lines.push('', '### All criteria, per run', '')
  lines.push(
    ...markdownTable(
      ['Run', 'Cases', 'Candidates', 'Discarded by verification', 'Cannot tell', 'Model errors', 'Calls (new + cached)', 'Tokens in / out', 'Seconds per new call', 'Cost'],
      runs.map((run, index) => [
        named(index),
        String(run.cases),
        String(run.candidates),
        String(run.discarded),
        String(run.cannotTell),
        String(run.modelErrors),
        `${run.calls} + ${run.cachedCalls}`,
        `${kilo(run.inputTokens)} / ${kilo(run.outputTokens)}`,
        seconds(run),
        cost(run),
      ]),
      new Set([1, 2, 3, 4, 5, 8]),
    ),
  )

  const paired = comparison.paired
  const [first, second] = runs
  if (paired && first && second) {
    lines.push('', `### Paired comparison of ${named(0)} and ${named(1)}`, '')
    if (paired.all.shared === 0) {
      lines.push('No shared cases: the two runs evaluated different pages.')
    } else {
      const left = paired.onlyInFirst + paired.onlyInSecond > 0 ? `; ${paired.onlyInFirst} only in ${first.id} and ${paired.onlyInSecond} only in ${second.id} are left out` : ''
      lines.push(`On the ${paired.all.shared} cases both runs evaluated${left}.`, '')
      lines.push(
        ...markdownTable(
          ['Criterion', 'Shared cases', 'Both right', `Only ${first.id} right`, `Only ${second.id} right`, 'Both wrong', 'McNemar p (exact)'],
          pairedRows(paired),
          new Set([1, 2, 3, 4, 5, 6]),
        ),
      )
      if (paired.differing.length > 0) {
        lines.push('', 'Cases where the verdicts differ:', '')
        lines.push(
          ...markdownTable(
            ['Criterion', 'Set', 'Test case', 'Expected', first.id, second.id],
            paired.differing.map((item) => [item.criterion, escape(caseSet(item)), `[${escape(item.title)}](${href(item.url)})`, item.expected, item.verdicts[0], item.verdicts[1]]),
          ),
        )
      }
    }
  }

  // A list, so that several warnings do not run together into one paragraph.
  if (comparison.warnings.length > 0) lines.push('', ...comparison.warnings.map((warning) => `> - ${escape(warning)}`))
  lines.push('', COMPARE_NOTE, '')
  return lines.join('\n')
}

import { access } from 'node:fs/promises'
import { BASELINE_FILE, type BaselineFile, readBaseline, recordBaseline, targetKey, writeBaseline } from '../../adoption/baseline.ts'
import type { Report } from '../../core/types.ts'
import { colorsEnabled, paint } from '../../report/color.ts'
import type { GlobalContext } from '../context.ts'
import { type CheckCommandOptions, runCheck } from './check.ts'

export type BaselineCommandOptions = Omit<CheckCommandOptions, 'format' | 'output' | 'failOn' | 'minConfidence' | 'verbose' | 'baseline' | 'onReports'> & {
  /** Where to write; the config's baseline, else .rampa/baseline.json. */
  out?: string
}

/** Checks the targets like rampa check, then records every finding instead of reporting it. */
export async function runBaseline(targets: string[], options: BaselineCommandOptions, context: GlobalContext): Promise<number> {
  const out = options.out ?? context.config.baseline ?? BASELINE_FILE
  return runCheck(
    targets,
    {
      ...options,
      format: 'pretty',
      failOn: 'never',
      // Every confidence level is recorded anyway; low keeps them all in one list.
      minConfidence: 'low',
      baseline: false,
      onReports: (reports) => saveBaseline(reports, out, context),
    },
    context,
  )
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

/**
 * Writes the baseline unless the run missed findings it would have had: a model that failed, or
 * cached judgments that were not there, would leave a baseline that later runs contradict.
 */
export async function saveBaseline(reports: Report[], out: string, context: GlobalContext): Promise<number> {
  const p = paint(colorsEnabled())
  if (reports.length === 0) {
    process.stderr.write(`\nrampa: not writing ${out}: the targets hold no page to check.\n`)
    return 2
  }
  const missed = reports.reduce((total, report) => total + report.criteria.reduce((sum, c) => sum + c.errors + c.offlineMisses, 0), 0)
  if (missed > 0) {
    const reason = reports.flatMap((report) => report.errors)[0]
    process.stderr.write(
      `\nrampa: not writing ${out}: ${missed} candidate(s) were not judged${reason ? ` (${reason})` : ' (no cached judgment)'}, so the baseline would miss their findings. Fix the model (rampa doctor) and run again, or pass --no-llm for an engine-only baseline.\n`,
    )
    return 2
  }

  const previous: BaselineFile | undefined = (await exists(out)) ? await readBaseline(out) : undefined
  const baseline = recordBaseline(reports, previous)
  await writeBaseline(out, baseline)

  const checked = new Set(reports.map((report) => targetKey(report.target)))
  const kept = Object.keys(previous?.targets ?? {}).filter((target) => !checked.has(target))
  const width = Math.min(60, Math.max(...[...checked].map((target) => target.length))) + 2
  console.log(`\n  ${p.bold('Baseline written:')} ${out}`)
  for (const report of reports) {
    const entries = baseline.targets[targetKey(report.target)]?.findings ?? []
    const engine = entries.filter((entry) => entry.source === 'engine').length
    console.log(`  ${targetKey(report.target).padEnd(width)}${entries.length} finding(s)${p.dim(` · ${engine} engine, ${entries.length - engine} judgment`)}`)
  }
  if (kept.length > 0) console.log(p.dim(`  Kept ${kept.length} other target(s) recorded earlier.`))
  const waived = reports.reduce((total, report) => total + report.waived.length, 0)
  if (waived > 0) console.log(p.dim(`  ${waived} waived finding(s) are left out: they come back when their waiver expires.`))

  const first = reports[0]
  if (first?.llm === 'on') console.log(p.dim(`  Judged by ${first.model} · criteria ${first.criteria.map((c) => c.criterion).join(', ')}`))
  else if (first?.llm === 'off') console.log(p.dim('  Engine findings only (--no-llm). Checks with a model will report judgment findings as new.'))
  else if (first) {
    console.log(p.yellow('  No model was available, so this baseline has engine findings only. Record it with the model CI uses (--model),'))
    console.log(p.yellow('  or every judgment finding there counts as new.'))
  }

  console.log('')
  console.log(`  Commit ${out}. Then ${p.cyan(`rampa check --baseline ${out}`)} reports only new findings,`)
  if (context.config.baseline !== out) console.log(`  or set baseline: '${out}' in the config to make it the default (CI included).`)
  else console.log('  and the config already points rampa check to it.')
  console.log('')
  return 0
}

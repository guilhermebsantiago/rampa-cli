import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { Browser } from 'playwright-core'
import { prepareAdoption, targetsOrConfig } from '../../adoption/apply.ts'
import { fileCache } from '../../core/cache.ts'
import { checkSnapshot } from '../../core/check.ts'
import type { Confidence, Report } from '../../core/types.ts'
import { RampaError } from '../../core/util.ts'
import { resolveCriteria } from '../../criteria/index.ts'
import { emptyEngine } from '../../engine/axe.ts'
import { type Reasoning, createModelProvider, providerIdentity } from '../../providers/ai-sdk.ts'
import { chooseModel } from '../../providers/detect.ts'
import type { ModelProvider } from '../../providers/types.ts'
import { colorsEnabled, paint } from '../../report/color.ts'
import { renderReport } from '../../report/pretty.ts'
import { collectWeb, launchBrowser } from '../../surfaces/web.ts'
import { loadEngineFor, loadSnapshot, recordingName, resolveTargets } from '../../surfaces/targets.ts'
import type { GlobalContext } from '../context.ts'

export interface CheckCommandOptions {
  criteria: string
  model?: string
  llm: boolean
  runs: string
  format: 'pretty' | 'json'
  output?: string
  failOn: 'confirmed' | 'any' | 'never'
  minConfidence: Confidence
  offline?: boolean
  screenshots?: boolean
  cacheDir: string
  concurrency: string
  reasoning?: Reasoning
  /** Write each collected snapshot and its engine results here, to check later without a browser. */
  save?: string
  verbose?: boolean
  /** Leave out the findings this baseline file has; false (--no-baseline) ignores the config's. */
  baseline?: string | false
  /** Takes over once every target is checked, instead of printing the report: rampa baseline records the findings. */
  onReports?: (reports: Report[]) => Promise<number>
}

export async function resolveProvider(spec: string | undefined, offline: boolean, reasoning?: Reasoning): Promise<ModelProvider | undefined> {
  if (!spec) return undefined
  if (offline) {
    return {
      ...providerIdentity(spec, reasoning),
      judge() {
        throw new RampaError('offline', 'Offline mode never calls the model.')
      },
    }
  }
  return createModelProvider(spec, { reasoning })
}

export async function runCheck(targets: string[], options: CheckCommandOptions, context: GlobalContext): Promise<number> {
  const resolved = await resolveTargets(targetsOrConfig(targets, context.config))
  const criteria = resolveCriteria(options.criteria.split(','))
  const runs = Math.max(1, Number.parseInt(options.runs, 10) || 1)
  const spec = options.llm ? await chooseModel(options.model, context.config.model) : undefined
  const provider = await resolveProvider(spec, Boolean(options.offline), options.reasoning ?? context.config.reasoning)
  const needsImages = options.llm && criteria.some((criterion) => criterion.needs.vision)
  const cache = fileCache(options.cacheDir)
  const adoption = await prepareAdoption(options.baseline, context.config)
  if (adoption.invalidWaivers > 0) {
    process.stderr.write(`rampa: ${adoption.invalidWaivers} waiver(s) in ${adoption.waiversFile} cannot apply; rampa waivers shows why.\n`)
  }
  const progress = (message: string) => {
    if (process.stderr.isTTY && options.format === 'pretty') process.stderr.write(`\x1b[2K${message}\r`)
  }

  const reports: Report[] = []
  let browser: Browser | undefined
  try {
    for (const target of resolved) {
      progress(`… ${target.label}`)
      let collected
      if (target.kind === 'web') {
        browser ??= await launchBrowser()
        collected = await collectWeb(browser, target.url, {
          runAxe: true,
          locale: context.locale,
          screenshotDir: options.screenshots ? '.rampa/screenshots' : undefined,
          captureImages: needsImages,
        })
        if (options.save) {
          await mkdir(options.save, { recursive: true })
          const name = recordingName(target.label)
          // A local file is recorded by its relative path, so the recording is portable and leaks no home directory.
          const snapshot = target.url.startsWith('file:') ? { ...collected.snapshot, target: target.label.replaceAll('\\', '/') } : collected.snapshot
          await writeFile(join(options.save, `${name}.snapshot.json`), `${JSON.stringify(snapshot)}\n`, 'utf8')
          await writeFile(join(options.save, `${name}.engine.json`), `${JSON.stringify(collected.engine)}\n`, 'utf8')
        }
      } else {
        collected = { snapshot: await loadSnapshot(target.path), engine: (await loadEngineFor(target.path)) ?? emptyEngine() }
      }
      reports.push(
        await checkSnapshot(collected.snapshot, collected.engine, {
          criteria,
          llm: options.llm,
          provider,
          runs,
          cache,
          offline: Boolean(options.offline),
          locale: context.locale,
          minConfidence: options.minConfidence,
          concurrency: Math.max(1, Number.parseInt(options.concurrency, 10) || 4),
          waivers: adoption.waivers,
        }),
      )
    }
  } finally {
    progress('')
    await browser?.close()
  }
  // Expired waivers and the baseline: from here on, findings are the new ones.
  for (const [index, report] of reports.entries()) reports[index] = adoption.apply(report)
  if (options.onReports) return options.onReports(reports)

  if (options.format === 'json') {
    const json = `${JSON.stringify(reports.length === 1 ? reports[0] : reports, null, 2)}\n`
    if (options.output) {
      await mkdir(dirname(options.output), { recursive: true })
      await writeFile(options.output, json, 'utf8')
    } else process.stdout.write(json)
  } else {
    const p = paint(colorsEnabled())
    const text = reports.map((report) => renderReport(report, { verbose: Boolean(options.verbose), paint: p })).join('\n\n')
    process.stdout.write(`\n${text}\n`)
    if (options.output) {
      await mkdir(dirname(options.output), { recursive: true })
      await writeFile(options.output, `${JSON.stringify(reports.length === 1 ? reports[0] : reports, null, 2)}\n`, 'utf8')
    }
  }

  const allFailed = reports.some((r) => r.criteria.some((c) => c.errors > 0 && c.judged === 0))
  if (allFailed) return 2
  if (options.failOn === 'never') return 0
  const failing = reports.some((r) => r.findings.length > 0 || (options.failOn === 'any' && r.belowThreshold.length > 0))
  return failing ? 1 : 0
}

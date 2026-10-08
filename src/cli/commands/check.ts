import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { Browser } from 'playwright-core'
import { loadWaivers } from '../../config.ts'
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
import { FILE_FORMATS, type Format, formatReports } from '../../report/formats.ts'
import { locateReport, readPageSource, repositoryRoot } from '../../source/locate.ts'
import { collectWeb, launchBrowser } from '../../surfaces/web.ts'
import { loadEngineFor, loadSnapshot, recordingName, resolveTargets } from '../../surfaces/targets.ts'
import type { GlobalContext } from '../context.ts'
import { type FailOn, exitCode } from '../exit-code.ts'

export interface CheckCommandOptions {
  criteria: string
  model?: string
  llm: boolean
  runs: string
  format: Format
  /** The report in --format; with pretty, the terminal keeps it and the file gets JSON. */
  output?: string
  /** Extra copies in other formats, any combination. */
  json?: string
  sarif?: string
  markdown?: string
  html?: string
  failOn: FailOn
  minConfidence: Confidence
  offline?: boolean
  screenshots?: boolean
  cacheDir: string
  concurrency: string
  reasoning?: Reasoning
  /** Write each collected snapshot and its engine results here, to check later without a browser. */
  save?: string
  verbose?: boolean
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
  const resolved = await resolveTargets(targets)
  const criteria = resolveCriteria(options.criteria.split(','))
  const runs = Math.max(1, Number.parseInt(options.runs, 10) || 1)
  const spec = options.llm ? await chooseModel(options.model, context.config.model) : undefined
  const provider = await resolveProvider(spec, Boolean(options.offline), options.reasoning ?? context.config.reasoning)
  const needsImages = options.llm && criteria.some((criterion) => criterion.needs.vision)
  const cache = fileCache(options.cacheDir)
  const waivers = await loadWaivers()
  // Source paths are relative to the repository root, as GitHub resolves them.
  const root = (await repositoryRoot()) ?? process.cwd()
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
      const report = await checkSnapshot(collected.snapshot, collected.engine, {
        criteria,
        llm: options.llm,
        provider,
        runs,
        cache,
        offline: Boolean(options.offline),
        locale: context.locale,
        minConfidence: options.minConfidence,
        concurrency: Math.max(1, Number.parseInt(options.concurrency, 10) || 4),
        waivers,
      })
      // A local page gets file:line for each finding, and its patches as edits to the file.
      const source = await readPageSource(collected.snapshot.target, root)
      reports.push(source ? locateReport(report, collected.snapshot, source) : report)
    }
  } finally {
    progress('')
    await browser?.close()
  }

  const formatOptions = { verbose: Boolean(options.verbose), paint: paint(colorsEnabled()) }
  const render = (format: Format) => formatReports(format, reports, formatOptions)
  if (!options.output) process.stdout.write(render(options.format))
  else if (options.format === 'pretty') {
    // With pretty, -o keeps its original meaning: the terminal shows the report and the file gets the JSON.
    process.stdout.write(render('pretty'))
    await writeOutput(options.output, render('json'))
  } else await writeOutput(options.output, render(options.format))
  for (const format of FILE_FORMATS) {
    const file = options[format]
    if (file) await writeOutput(file, render(format))
  }

  return exitCode(reports, options.failOn)
}

async function writeOutput(file: string, text: string): Promise<void> {
  await mkdir(dirname(file), { recursive: true })
  await writeFile(file, text, 'utf8')
}

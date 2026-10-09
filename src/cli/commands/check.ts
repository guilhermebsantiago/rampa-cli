import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { Browser } from 'playwright-core'
import { loadWaivers } from '../../config.ts'
import { type JudgmentCache, fileCache } from '../../core/cache.ts'
import { checkSnapshot } from '../../core/check.ts'
import type { AnyCriterion, Confidence, EngineResults, Report, Usage } from '../../core/types.ts'
import { RampaError } from '../../core/util.ts'
import { resolveCriteria } from '../../criteria/index.ts'
import { rulesNotes } from '../../engine/rules.ts'
import type { Locale } from '../../i18n.ts'
import { type Reasoning, createModelProvider, providerIdentity } from '../../providers/ai-sdk.ts'
import { chooseModel } from '../../providers/detect.ts'
import type { ModelProvider } from '../../providers/types.ts'
import { colorsEnabled, paint } from '../../report/color.ts'
import { renderReport } from '../../report/pretty.ts'
import type { A11ySnapshot } from '../../snapshot/schema.ts'
import { collectAndroid, fromScreen } from '../../surfaces/android/adb.ts'
import { collectImage } from '../../surfaces/image.ts'
import { type Target, loadRecorded, recordingName, resolveTargets, siblingPng } from '../../surfaces/targets.ts'
import { type DestinationCache, type FollowLinks, type FollowOptions, destinationCache } from '../../surfaces/destinations.ts'
import { collectWeb, launchBrowser } from '../../surfaces/web.ts'
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
  /** Write each collected snapshot and its engine results here, to check later without a browser or a device. */
  save?: string
  verbose?: boolean
  /** Which links to read before judging, for criteria that compare a link with where it leads. */
  followLinks?: FollowLinks
}

/** Read links when a criterion needs their destinations and the judgment layer will run. */
export function followOptions(policy: FollowLinks | undefined, llm: boolean, criteria: AnyCriterion[], cache: DestinationCache): FollowOptions | undefined {
  if (!llm || !policy || policy === 'none' || !criteria.some((criterion) => criterion.needs.fetch)) return undefined
  return { policy, cache }
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

/** One target, ready to check: the snapshot, the deterministic results, and what the collector could not see. */
interface Collected {
  snapshot: A11ySnapshot
  engine: EngineResults
  notes: string[]
  /** Model calls made while collecting: an image's text is located by a model. */
  usage?: Usage | undefined
  /** Kept next to a recording: the raw UI Automator dump and the screenshot. */
  dump?: string | undefined
  png?: Buffer | undefined
  /** Whether --save records it: a recorded snapshot is already a recording. */
  record: boolean
}

interface CollectContext {
  locale: Locale
  provider: ModelProvider | undefined
  cache: JudgmentCache
  offline: boolean
  concurrency: number
  captureImages: boolean
  screenshots: boolean
  /** Links to read before judging, when a criterion compares a link with where it leads. */
  followLinks: FollowOptions | undefined
  browser: () => Promise<Browser>
}

async function collect(target: Target, ctx: CollectContext): Promise<Collected> {
  switch (target.kind) {
    case 'web': {
      const web = await collectWeb(await ctx.browser(), target.url, {
        runAxe: true,
        locale: ctx.locale,
        screenshotDir: ctx.screenshots ? '.rampa/screenshots' : undefined,
        captureImages: ctx.captureImages,
        followLinks: ctx.followLinks,
      })
      return { ...web, notes: [], record: true }
    }
    case 'android': {
      const android = await collectAndroid({ serial: target.serial, locale: ctx.locale, captureImages: ctx.captureImages })
      return { ...android, dump: android.screen.xml, png: android.screen.png, record: true }
    }
    case 'android-dump': {
      const screen = { xml: await readFile(target.path, 'utf8'), png: await siblingPng(target.path), locale: undefined, localeSource: undefined }
      const android = fromScreen(screen, ctx.locale, ctx.captureImages)
      android.snapshot.source = { kind: 'android-xml', path: target.label.replaceAll('\\', '/') }
      return { ...android, record: true }
    }
    case 'image': {
      const image = await collectImage(target.path, {
        provider: ctx.provider,
        cache: ctx.cache,
        offline: ctx.offline,
        locale: ctx.locale,
        label: target.label.replaceAll('\\', '/'),
        concurrency: ctx.concurrency,
      })
      return { ...image, record: true }
    }
    case 'snapshot': {
      const loaded = await loadRecorded(target.path, ctx.locale, ctx.captureImages)
      return { ...loaded, record: loaded.from === 'xcuitest' }
    }
  }
}

/** Snapshot and engine results, plus the raw dump and the screenshot for an app screen, to check later without a device. */
async function saveRecording(dir: string, target: Target, collected: Collected): Promise<void> {
  await mkdir(dir, { recursive: true })
  const { snapshot: collectedSnapshot } = collected
  // A live screen has no file name; the app and the screen title name it.
  const name = recordingName(target.kind === 'android' ? `android ${collectedSnapshot.target} ${collectedSnapshot.title ?? ''}` : target.label)
  let snapshot = collectedSnapshot
  // A local file is recorded by its relative path, so the recording is portable and leaks no home directory.
  if (target.kind === 'web' && target.url.startsWith('file:')) snapshot = { ...snapshot, target: target.label.replaceAll('\\', '/') }
  if (collected.dump !== undefined) {
    await writeFile(join(dir, `${name}.xml`), collected.dump, 'utf8')
    snapshot = { ...snapshot, source: { kind: 'android-xml', path: `${name}.xml` } }
  }
  if (collected.png) {
    await writeFile(join(dir, `${name}.png`), collected.png)
    snapshot = { ...snapshot, screenshot: `${name}.png` }
  }
  await writeFile(join(dir, `${name}.snapshot.json`), `${JSON.stringify(snapshot)}\n`, 'utf8')
  await writeFile(join(dir, `${name}.engine.json`), `${JSON.stringify(collected.engine)}\n`, 'utf8')
}

export async function runCheck(targets: string[], options: CheckCommandOptions, context: GlobalContext): Promise<number> {
  const resolved = await resolveTargets(targets)
  const criteria = resolveCriteria(options.criteria.split(','))
  const runs = Math.max(1, Number.parseInt(options.runs, 10) || 1)
  const spec = options.llm ? await chooseModel(options.model, context.config.model) : undefined
  const provider = await resolveProvider(spec, Boolean(options.offline), options.reasoning ?? context.config.reasoning)
  const needsImages = options.llm && criteria.some((criterion) => criterion.needs.vision)
  const follow = followOptions(options.followLinks, options.llm, criteria, destinationCache({ dir: '.rampa/destinations' }))
  const cache = fileCache(options.cacheDir)
  const waivers = await loadWaivers()
  const concurrency = Math.max(1, Number.parseInt(options.concurrency, 10) || 4)
  const progress = (message: string) => {
    if (process.stderr.isTTY && options.format === 'pretty') process.stderr.write(`\x1b[2K${message}\r`)
  }

  const reports: Report[] = []
  let browser: Browser | undefined
  const ctx: CollectContext = {
    locale: context.locale,
    provider,
    cache,
    offline: Boolean(options.offline),
    concurrency,
    captureImages: needsImages,
    screenshots: Boolean(options.screenshots),
    followLinks: follow,
    browser: async () => {
      browser ??= await launchBrowser()
      return browser
    },
  }
  try {
    for (const target of resolved) {
      progress(`… ${target.label}`)
      const collected = await collect(target, ctx)
      if (options.save && collected.record) await saveRecording(options.save, target, collected)
      const report = await checkSnapshot(collected.snapshot, collected.engine, {
        criteria,
        llm: options.llm,
        provider,
        runs,
        cache,
        offline: Boolean(options.offline),
        locale: context.locale,
        minConfidence: options.minConfidence,
        concurrency,
        waivers,
      })
      const notes = [...collected.notes, ...rulesNotes(collected.engine, context.locale)]
      if (notes.length > 0) report.notes = notes
      if (collected.usage) {
        for (const key of ['calls', 'cachedCalls', 'inputTokens', 'outputTokens', 'latencyMs'] as const) report.usage[key] += collected.usage[key]
      }
      reports.push(report)
    }
  } finally {
    progress('')
    await browser?.close()
  }

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

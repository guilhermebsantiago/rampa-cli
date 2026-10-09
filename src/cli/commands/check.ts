import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { Browser } from 'playwright-core'
import { prepareAdoption, targetsOrConfig } from '../../adoption/apply.ts'
import { resolveProfiles } from '../../advisory/profile.ts'
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
import { FILE_FORMATS, type Format, formatReports } from '../../report/formats.ts'
import { locateReport, readPageSource, repositoryRoot } from '../../source/locate.ts'
import { type BrowserFlags, type BrowserOptions, parseBrowserFlags } from '../../surfaces/browser-options.ts'
import { type CrawlFlags, crawlRequested } from '../../surfaces/crawl.ts'
import { collectWeb, launchBrowser } from '../../surfaces/web.ts'
import { DETERMINISM_ARGS, type ProbeKind, parseProbeKinds } from '../../probes/run.ts'
import type { GlobalContext } from '../context.ts'
import { type FailOn, exitCode } from '../exit-code.ts'
import { singlePageNote } from '../../site/index.ts'
import { runSiteCheck } from './site.ts'
import { DEFAULT_WCAG, type WcagVersion, parseWcagVersion } from '../../wcag.ts'

export interface CheckCommandOptions extends BrowserFlags, CrawlFlags {
  criteria: string
  /** The WCAG version to state coverage against: '2.2' (default) or '2.1'. */
  wcag?: string
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
  /** Write each collected snapshot and its engine results here, to check later without a browser or a device. */
  save?: string
  verbose?: boolean
  /** Leave out the findings this baseline file has; false (--no-baseline) ignores the config's. */
  baseline?: string | false
  /** Takes over once every target is checked, instead of printing the report: rampa baseline records the findings. */
  onReports?: (reports: Report[]) => Promise<number>
  /** Which links to read before judging, for criteria that compare a link with where it leads. */
  followLinks?: FollowLinks
  /** Probes to run on web pages after collection: layout, keyboard, hover, all or none (docs/probes.md). */
  probe?: string
  /** An advisory profile to run on top of the WCAG check (--profile cognitive); the config's profiles otherwise. */
  profile?: string
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
  /** Viewport, device, session, headers and what to wait for, for web pages. */
  browserOptions: BrowserOptions | undefined
  /** Probe kinds to run on web pages; empty runs none. */
  probes: ProbeKind[]
  browser: () => Promise<Browser>
  wcag: WcagVersion
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
        browserOptions: ctx.browserOptions,
        wcag: ctx.wcag,
        probes: ctx.probes,
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
  const browserOptions = parseBrowserFlags(options)
  const wcag = wcagOption(options.wcag)
  const probes = parseProbeKinds(options.probe)
  if (crawlRequested(options)) {
    if (probes.length > 0) process.stderr.write('rampa: --probe does not run with --crawl yet; the pages are checked without probes.\n')
    return runSiteCheck(targetsOrConfig(targets, context.config), options, context, browserOptions)
  }
  const resolved = await resolveTargets(targetsOrConfig(targets, context.config))
  const criteria = resolveCriteria(options.criteria.split(','))
  const profiles = resolveProfiles(options.profile, context.config.profiles)
  const runs = Math.max(1, Number.parseInt(options.runs, 10) || 1)
  const spec = options.llm ? await chooseModel(options.model, context.config.model) : undefined
  const provider = await resolveProvider(spec, Boolean(options.offline), options.reasoning ?? context.config.reasoning)
  const needsImages = options.llm && criteria.some((criterion) => criterion.needs.vision)
  const follow = followOptions(options.followLinks, options.llm, criteria, destinationCache({ dir: '.rampa/destinations' }))
  const cache = fileCache(options.cacheDir)
  const concurrency = Math.max(1, Number.parseInt(options.concurrency, 10) || 4)
  // Source paths are relative to the repository root, as GitHub resolves them.
  const root = (await repositoryRoot()) ?? process.cwd()
  const adoption = await prepareAdoption(options.baseline, context.config)
  if (adoption.invalidWaivers > 0) {
    process.stderr.write(`rampa: ${adoption.invalidWaivers} waiver(s) in ${adoption.waiversFile} cannot apply; rampa waivers shows why.\n`)
  }
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
    browserOptions,
    probes,
    wcag,
    browser: async () => {
      // Probes compare pixels: the browser renders with a fixed color profile and no LCD text.
      browser ??= await launchBrowser(probes.length > 0 ? { args: DETERMINISM_ARGS } : {})
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
        waivers: adoption.waivers,
        profiles,
        coga: context.config.coga,
        wcag,
      })
      const notes = [...collected.notes, ...rulesNotes(collected.engine, context.locale)]
      if (collected.snapshot.surface === 'web') notes.push(singlePageNote(context.locale))
      if (notes.length > 0) report.notes = notes
      if (collected.usage) {
        for (const key of ['calls', 'cachedCalls', 'inputTokens', 'outputTokens', 'latencyMs'] as const) report.usage[key] += collected.usage[key]
      }
      // A local page gets file:line for each finding, and its patches as edits to the file.
      const source = await readPageSource(collected.snapshot.target, root)
      reports.push(source ? locateReport(report, collected.snapshot, source) : report)
    }
  } finally {
    progress('')
    await browser?.close()
  }
  // Expired waivers and the baseline: from here on, findings are the new ones.
  for (const [index, report] of reports.entries()) reports[index] = adoption.apply(report)
  if (options.onReports) return options.onReports(reports)

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

/** `--wcag`, or the config's `wcag`: 2.2 when neither is set. */
export function wcagOption(value: string | undefined): WcagVersion {
  if (value === undefined) return DEFAULT_WCAG
  const version = parseWcagVersion(value)
  if (!version) throw new RampaError('invalid-option', `--wcag takes 2.1 or 2.2; got "${value}".`)
  return version
}

async function writeOutput(file: string, text: string): Promise<void> {
  await mkdir(dirname(file), { recursive: true })
  await writeFile(file, text, 'utf8')
}

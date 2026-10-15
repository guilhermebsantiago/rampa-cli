import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import type { Browser } from 'playwright-core'
import { prepareAdoption, targetsOrConfig } from '../../adoption/apply.ts'
import { observationWindow } from '../../advisory/observed.ts'
import { resolveProfiles } from '../../advisory/profile.ts'
import { type JudgmentCache, fileCache } from '../../core/cache.ts'
import { checkSnapshot, loweredCap } from '../../core/check.ts'
import { nothingJudgedNote } from '../../core/gate.ts'
import { FAST, type FastCollection, fastCollectOptions, fastCollection, fastCoverage } from '../../core/fast.ts'
import { Stopwatch, timed } from '../../core/timings.ts'
import type { AnyCriterion, Confidence, EngineResults, Report, Usage } from '../../core/types.ts'
import { RampaError } from '../../core/util.ts'
import { resolveCriteria } from '../../criteria/index.ts'
import { rulesNotes } from '../../engine/rules.ts'
import { type Locale, t } from '../../i18n.ts'
import { type Reasoning, createModelProvider, providerIdentity } from '../../providers/ai-sdk.ts'
import { chooseModel } from '../../providers/detect.ts'
import type { ModelProvider } from '../../providers/types.ts'
import { colorsEnabled, paint } from '../../report/color.ts'
import { displayTarget, renderReport } from '../../report/pretty.ts'
import type { A11ySnapshot } from '../../snapshot/schema.ts'
import { type AdbRunner, collectAndroid, fromScreen, systemAdb } from '../../surfaces/android/adb.ts'
import { ANDROID_PROBE_KINDS, runAndroidProbes } from '../../surfaces/android/probes.ts'
import { IOS_PROBE_KINDS } from '../../surfaces/ios.ts'
import { collectImage } from '../../surfaces/image.ts'
import { type Target, loadRecorded, recordingName, resolveTargets, siblingPng } from '../../surfaces/targets.ts'
import { type DestinationCache, type FollowLinks, type FollowOptions, destinationCache } from '../../surfaces/destinations.ts'
import { FILE_FORMATS, type Format, formatReports } from '../../report/formats.ts'
import { type ChangedTargets, onlyChanged } from '../../source/changed.ts'
import { displayPath, locateReport, readPageSource, repositoryRoot } from '../../source/locate.ts'
import { type BrowserFlags, type BrowserOptions, parseBrowserFlags, wholeNumber } from '../../surfaces/browser-options.ts'
import { type CrawlFlags, crawlRequested } from '../../surfaces/crawl.ts'
import { collectWeb, launchBrowser } from '../../surfaces/web.ts'
import { type ProbeKind, parseProbeKinds, probeLaunchArgs } from '../../probes/run.ts'
import { originOf } from '../../probes/guard.ts'
import { describeSubmitRecord, parseAllowSubmit } from '../../probes/submit.ts'
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
  /** Candidates per criterion and page the model judges at most; '0' for no cap. */
  maxCandidates?: string
  /** Seconds after a page starts loading when Rampa stops asking the model and reports what was judged. */
  timeLimit?: string
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
  /**
   * Probes to run after collection: layout, keyboard, hover, orientation, shortcuts, media, color, states, variants, auth, flash, links, input,
   * toggles, status, motion, form, pointer, parity, focus-order, gestures, all (every kind but variants, auth, flash, links, input, toggles, status,
   * motion, form, pointer, parity, focus-order and gestures), interact or none (docs/probes.md). On android:, keyboard, layout and orientation drive the device; an
   * XCUITest export gives layout and orientation from the steps its helper exported.
   */
  probe?: string
  /**
   * --allow-submit, repeatable: exact origins where the form probe may submit forms (docs/probes.md, "Submitting
   * forms"). Command line only: the config file cannot set it.
   */
  allowSubmit?: string[]
  /** --submit-dry-run: the form probe lists what it would submit, and submits nothing. */
  submitDryRun?: boolean
  /** The adb the Android surface talks to; tests pass a fake device. Not a command-line flag. */
  adb?: AdbRunner
  /** An advisory profile to run on top of the WCAG check (--profile cognitive); the config's profiles otherwise. */
  profile?: string
  /** --timings: record where each page's time goes, in `report.timings` and the terminal report (core/timings.ts). */
  timings?: boolean
  /**
   * --fast (or `fast: true` in the config): the preset for CI and pre-commit (core/fast.ts). The CLI has already filled
   * in --max-candidates and --follow-links where nothing else set them; the rest applies here.
   */
  fast?: boolean
  /** --batch / --no-batch: batched judgment (core/batch.ts); the config's `batch`, else on with --fast only. */
  batch?: boolean
  /**
   * --changed[=<ref>]: of the local HTML files, check only those changed since the ref; true for the merge base with
   * the default branch (source/changed.ts). Other targets are always checked.
   */
  changed?: string | boolean
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
  /** Probe kinds to run on web pages and Android screens, or to read from an XCUITest export; empty runs none. */
  probes: ProbeKind[]
  /**
   * The cognitive profile's observation of the live page, in milliseconds (advisory/observed.ts): web pages Rampa loads
   * get the `cognitive` probe on top of the others. Undefined without the profile, or with `coga.observe: 0`.
   */
  observeMs: number | undefined
  /** --allow-submit and --submit-dry-run, for the form probe on web pages. */
  submit: { allowed: string[]; dryRun: boolean } | undefined
  adb: AdbRunner | undefined
  /** The run's browser, started on the first web page; its launch is timed on that page's stopwatch. */
  browser: (watch?: Stopwatch) => Promise<Browser>
  wcag: WcagVersion
  /** --fast: the shorter wait after load, the fewer captures and no contrast from pixels. */
  fast: FastCollection | undefined
  /** --profile cognitive: also measure how text and controls are presented (surfaces/presentation.ts). */
  presentation: boolean
}

async function collect(target: Target, ctx: CollectContext, watch: Stopwatch | undefined): Promise<Collected> {
  switch (target.kind) {
    case 'web': {
      const web = await collectWeb(await ctx.browser(watch), target.url, {
        timings: watch,
        runAxe: true,
        locale: ctx.locale,
        screenshotDir: ctx.screenshots ? '.rampa/screenshots' : undefined,
        captureImages: ctx.captureImages,
        followLinks: ctx.followLinks,
        browserOptions: ctx.browserOptions,
        wcag: ctx.wcag,
        probes: ctx.observeMs ? [...ctx.probes.filter((kind) => kind !== 'cognitive'), 'cognitive'] : ctx.probes,
        ...(ctx.observeMs ? { observeMs: ctx.observeMs } : {}),
        presentation: ctx.presentation,
        ...(ctx.submit ? { submit: ctx.submit } : {}),
        ...fastCollectOptions(ctx.fast),
      })
      // What the form probe submitted, or would have: on stderr as it happens, and in the report's header.
      const submitted = web.snapshot.observations?.probes.find((record) => record.kind === 'form' && record.conditions.variant === 'submit')
      if (submitted) for (const line of describeSubmitRecord(submitted, target.url)) process.stderr.write(`${line}\n`)
      return { ...web, notes: [], record: true }
    }
    case 'android': {
      const adb = ctx.adb ?? systemAdb()
      const android = await collectAndroid({ serial: target.serial, locale: ctx.locale, captureImages: ctx.captureImages, adb })
      if (ctx.probes.length > 0) {
        // The screen as collected names the nodes every probe record cites; the probes then drive the device.
        const run = await runAndroidProbes({ adb, serial: android.screen.serial, kinds: ctx.probes, snapshot: android.snapshot })
        if (run.records.length > 0) {
          android.snapshot.observations = { probes: run.records }
          android.notes.push(t(ctx.locale, 'noteProbesUntested'))
        }
        if (run.leftOut.length > 0) android.notes.push(t(ctx.locale, 'noteProbesAppKinds', { kinds: ANDROID_PROBE_KINDS.join(', '), left: run.leftOut.join(', ') }))
        for (const warning of run.warnings) {
          process.stderr.write(`rampa: ${warning}\n`)
          android.notes.push(warning)
        }
      }
      return { ...android, dump: android.screen.xml, png: android.screen.png, record: true }
    }
    case 'android-dump': {
      const screen = { xml: await readFile(target.path, 'utf8'), png: await siblingPng(target.path), locale: undefined, localeSource: undefined }
      const android = fromScreen(screen, ctx.locale, ctx.captureImages)
      android.snapshot.source = { kind: 'android-xml', path: target.label.replaceAll('\\', '/') }
      if (ctx.probes.length > 0) android.notes.push(t(ctx.locale, 'noteProbesNeedDevice'))
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
      const loaded = await loadRecorded(target.path, ctx.locale, ctx.captureImages, ctx.probes.length > 0 ? ctx.probes : undefined)
      // App-screen probe records, from an export's steps or in a recording: say they have only run against fakes.
      const app = loaded.snapshot.surface === 'android' || loaded.snapshot.surface === 'ios'
      if (app && (loaded.snapshot.observations?.probes.length ?? 0) > 0) loaded.notes.push(t(ctx.locale, 'noteProbesUntested'))
      if (loaded.from === 'xcuitest') {
        const leftOut = ctx.probes.filter((kind) => !IOS_PROBE_KINDS.includes(kind) && kind !== 'keyboard')
        if (leftOut.length > 0) loaded.notes.push(t(ctx.locale, 'noteProbesAppKinds', { kinds: IOS_PROBE_KINDS.join(', '), left: leftOut.join(', ') }))
      }
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
  // Refused before anything loads: an origin that is not exact (a path, a wildcard, another scheme) is a usage error.
  const allowSubmit = parseAllowSubmit(options.allowSubmit)
  const submitDryRun = Boolean(options.submitDryRun)
  if (crawlRequested(options)) {
    if (probes.length > 0) process.stderr.write('rampa: --probe does not run with --crawl yet; the pages are checked without probes.\n')
    if (options.changed) process.stderr.write('rampa: --changed picks among local HTML files; a crawl checks the pages it finds.\n')
    if (allowSubmit.length > 0 || submitDryRun) process.stderr.write('rampa: --allow-submit and --submit-dry-run do not run with --crawl; nothing is submitted.\n')
    return runSiteCheck(targetsOrConfig(targets, context.config), options, context, browserOptions)
  }
  const all = await resolveTargets(targetsOrConfig(targets, context.config))
  // --changed: only the local HTML files changed since the ref, said on stderr now and in each report.
  const changed = options.changed ? await onlyChanged(all, options.changed === true ? undefined : options.changed) : undefined
  const resolved = changed?.targets ?? all
  const changedNote = changed ? changedLines(changed, all, context.locale) : undefined
  if (changedNote) process.stderr.write(`rampa: ${changedNote.stderr}\n`)
  const submit = submitPlan(allowSubmit, submitDryRun, probes, resolved)
  const criteria = resolveCriteria(options.criteria.split(','))
  const profiles = resolveProfiles(options.profile, context.config.profiles)
  const runs = Math.max(1, Number.parseInt(options.runs, 10) || 1)
  const spec = options.llm ? await chooseModel(options.model, context.config.model) : undefined
  const provider = await resolveProvider(spec, Boolean(options.offline), options.reasoning ?? context.config.reasoning)
  const needsImages = options.llm && criteria.some((criterion) => criterion.needs.vision)
  const follow = followOptions(options.followLinks, options.llm, criteria, destinationCache({ dir: '.rampa/destinations' }))
  const cache = fileCache(options.cacheDir)
  const concurrency = Math.max(1, Number.parseInt(options.concurrency, 10) || 4)
  const limits = judgingLimits(options)
  const timeLimitMs = limits.timeLimitMs
  // rampa baseline has no --max-candidates: --fast sets its cap here.
  const fast = Boolean(options.fast)
  const maxCandidates = limits.maxCandidates ?? (fast ? FAST.maxCandidates : undefined)
  const batch = batchSetting(options, context.config)
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
    observeMs: observationWindow(profiles, context.config.coga, fast) ?? (probes.includes('cognitive') ? observationWindow(['cognitive'], undefined, fast) : undefined),
    submit,
    adb: options.adb,
    wcag,
    fast: fast ? fastCollection(criteria) : undefined,
    presentation: profiles.includes('cognitive'),
    browser: async (watch) => {
      // Probes compare pixels: the browser renders with a fixed color profile and no LCD text (and lets media autoplay for the media probe).
      browser ??= await timed(watch, 'browser-launch', () => launchBrowser(probes.length > 0 ? { args: probeLaunchArgs(probes) } : {}))
      return browser
    },
  }
  try {
    for (const target of resolved) {
      progress(`… ${target.label}`)
      // The time limit counts from here, so it also covers loading the page, as a timeout around the whole run would.
      const deadline = timeLimitMs === undefined ? undefined : Date.now() + timeLimitMs
      const watch = options.timings ? new Stopwatch() : undefined
      const collected = await collect(target, ctx, watch)
      if (options.save && collected.record) await saveRecording(options.save, target, collected)
      const report = await checkSnapshot(collected.snapshot, collected.engine, {
        timings: watch,
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
        maxCandidates,
        deadline,
        batch,
        fast: fast
          ? fastCoverage({
              criteria,
              llm: options.llm,
              probes: probes.length,
              linksSkipped: options.followLinks === 'none' && criteria.some((criterion) => criterion.needs.fetch),
              maxCandidates: loweredCap(maxCandidates),
              web: target.kind === 'web',
            })
          : undefined,
      })
      // What the collector could not see first, then what the check left out: images without a capture, and
      // candidates the model did not judge (past the cap or the time limit).
      const notes = [...collected.notes, ...(report.notes ?? []), ...rulesNotes(collected.engine, context.locale)]
      if (collected.snapshot.surface === 'web') notes.push(singlePageNote(context.locale))
      if (changedNote?.note) notes.push(changedNote.note)
      if (notes.length > 0) report.notes = notes
      if (collected.usage) {
        for (const key of ['calls', 'cachedCalls', 'inputTokens', 'outputTokens', 'latencyMs'] as const) report.usage[key] += collected.usage[key]
      }
      // A local page gets file:line for each finding, and its patches as edits to the file.
      const located = await timed(watch, 'source', async () => {
        const source = await readPageSource(collected.snapshot.target, root)
        return source ? locateReport(report, collected.snapshot, source) : report
      })
      if (watch) located.timings = watch.result()
      reports.push(located)
    }
  } finally {
    progress('')
    await browser?.close()
  }
  // Expired waivers and the baseline: from here on, findings are the new ones.
  for (const [index, report] of reports.entries()) reports[index] = adoption.apply(report)
  if (options.onReports) return options.onReports(reports)
  // The gate in effect goes in every report, next to its threshold: SARIF's levels follow it, and JSON states it.
  for (const report of reports) report.failOn = options.failOn

  const formatOptions = { verbose: Boolean(options.verbose), paint: paint(colorsEnabled()) }
  // --changed left nothing to check: the terminal says so, instead of an empty report.
  if (reports.length === 0 && changedNote && options.format === 'pretty' && !options.output) {
    process.stdout.write(`\n${changedNote.nothing}\n\n`)
    return 0
  }
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

  // A run that asked for judgment and judged nothing exits 2: stderr says why, whatever the format on stdout.
  for (const report of reports) {
    const nothing = nothingJudgedNote(report)
    if (nothing) process.stderr.write(`rampa: ${displayTarget(report.target)}: ${nothing}\n`)
  }
  return exitCode(reports, options.failOn)
}

/**
 * What --allow-submit and --submit-dry-run do in this run, said loudly on stderr before anything loads: submitting
 * writes to a server. Undefined when the form probe will not submit (or list) anything.
 */
export function submitPlan(allowed: string[], dryRun: boolean, probes: readonly ProbeKind[], targets: readonly Target[]): CollectContext['submit'] {
  if (allowed.length === 0 && !dryRun) return undefined
  if (!probes.includes('form')) {
    process.stderr.write(`rampa: ${dryRun ? '--submit-dry-run' : '--allow-submit'} takes effect only with --probe form (or --probe interact); nothing is submitted.\n`)
    return undefined
  }
  if (dryRun) {
    process.stderr.write('rampa: --submit-dry-run: the form probe lists the forms and the values it would submit, and submits nothing.\n')
    return { allowed, dryRun: true }
  }
  process.stderr.write(
    `rampa: --allow-submit: the form probe will SUBMIT forms on ${allowed.join(', ')}, writing to that server. Use it on test environments only. Every other origin stays blocked; payment, password and file forms, CAPTCHAs, and controls that buy, pay, delete, sign or subscribe are never submitted.\n`,
  )
  const origins = targets.flatMap((target) => (target.kind === 'web' ? [originOf(target.url)] : []))
  if (!origins.some((origin) => allowed.includes(origin))) process.stderr.write('rampa: --allow-submit: no target is on an origin it names, so nothing will be submitted.\n')
  return { allowed, dryRun: false }
}

/** What --changed did, for stderr, for each report's notes (when it skipped files) and for a run left with nothing to check. */
export function changedLines(changed: ChangedTargets, all: readonly Target[], locale: Locale): { stderr: string; note: string | undefined; nothing: string } {
  const local = all.filter((target) => target.kind === 'web' && target.url.startsWith('file:')).length
  const commit = changed.base.commit.slice(0, 7)
  const skipped = changed.skipped.map((label) => displayPath(resolve(label), process.cwd()))
  const list = `${skipped.slice(0, 10).join(', ')}${skipped.length > 10 ? `, … (${skipped.length - 10} more)` : ''}`
  return {
    stderr: `--changed (${changed.base.ref}, ${commit}): checking ${local - skipped.length} of ${local} local HTML files; ${skipped.length} unchanged since then are skipped.`,
    note: skipped.length > 0 ? t(locale, 'changedNote', { count: skipped.length, ref: changed.base.ref, commit, list }) : undefined,
    nothing: t(locale, 'changedNothing', { ref: changed.base.ref, commit, count: skipped.length }),
  }
}

/** Batched judgment: --batch or --no-batch, else the config's `batch`, else on in fast mode only. */
export function batchSetting(options: Pick<CheckCommandOptions, 'batch' | 'fast'>, config: { batch?: boolean | undefined }): boolean {
  return options.batch ?? config.batch ?? Boolean(options.fast)
}

/** --max-candidates (0 for no cap) and --time-limit in milliseconds, undefined when it is not set. */
export function judgingLimits(options: Pick<CheckCommandOptions, 'maxCandidates' | 'timeLimit'>): { maxCandidates: number | undefined; timeLimitMs: number | undefined } {
  return {
    maxCandidates: options.maxCandidates === undefined ? undefined : wholeNumber(options.maxCandidates, '--max-candidates', 0),
    timeLimitMs: options.timeLimit === undefined ? undefined : wholeNumber(options.timeLimit, '--time-limit', 1) * 1000,
  }
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

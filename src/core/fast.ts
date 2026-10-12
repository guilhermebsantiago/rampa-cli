import type { Locale } from '../i18n.ts'

/**
 * `--fast` (`fast: true` in the config or from code): a preset for CI and pre-commit hooks that leaves out what costs the
 * most time and rarely decides a finding at the default threshold. Each choice comes from the timings of real pages
 * (`--timings`, docs/performance.md). The preset only fills in what the run did not set: an option given on the command
 * line, in the config or in code keeps its value. The report says it ran in fast mode and what was left out
 * (`coverage.fast`), never silently.
 */
export const FAST = {
  /** Candidates per criterion and page the model judges, generic texts first (the default is 50). */
  maxCandidates: 10,
  /** The longest wait after load for the page to settle, in milliseconds (the default is 3000). */
  settleCapMs: 1000,
  /**
   * Images captured per page for the criteria that judge pixels (the default is 25). At 10, one of the three measured
   * pages lost an image 1.1.1 failed in full mode; 15 holds the images of all three.
   */
  imageLimit: 15,
  /** The longest the image captures may take together, waits for lazy images included (the default is 15 s). */
  imageBudgetMs: 5000,
} as const

/**
 * What fast mode left out of a run:
 * - probes: no probe runs unless --probe names one;
 * - link-following: 2.4.4 judges link text and context without reading where links lead (--follow-links none);
 * - ocr: 1.4.5, the only criterion that reads pictures with OCR, is not judged unless --criteria names it;
 * - pixel-contrast: contrast is not measured from pixels; what axe-core could not decide stays to review;
 * - css-backgrounds: CSS background images are not captured (only 1.4.5 reads them).
 */
export const FAST_SKIPS = ['probes', 'link-following', 'ocr', 'pixel-contrast', 'css-backgrounds'] as const
export type FastSkip = (typeof FAST_SKIPS)[number]

/** Fast mode on a report, in `coverage.fast`: what it left out and the limits it lowered. A limit set explicitly is not listed. */
export interface FastCoverage {
  skipped: FastSkip[]
  maxCandidates?: number | undefined
  imageLimit?: number | undefined
  settleCapMs?: number | undefined
}

/** How fast mode collects a web page: the settle cap, the captures and the pixel checks it changes. */
export interface FastCollection {
  settleCapMs: number
  imageLimit: number
  imageBudgetMs: number
  /** CSS backgrounds captured; none unless 1.4.5 is judged. */
  backgroundLimit: number
  pixelContrast: false
}

/** The collection settings of fast mode, for a run that judges `criteria`. */
export function fastCollection(criteria: readonly { id: string }[]): FastCollection {
  return {
    settleCapMs: FAST.settleCapMs,
    imageLimit: FAST.imageLimit,
    imageBudgetMs: FAST.imageBudgetMs,
    backgroundLimit: criteria.some((c) => c.id === '1.4.5') ? FAST.imageLimit : 0,
    pixelContrast: false,
  }
}

/** Fast mode's settings as collectWeb takes them (surfaces/web.ts); none without fast mode. */
export function fastCollectOptions(collection: FastCollection | undefined): {
  settle?: { capMs: number }
  imageCapture?: { limit: number; backgrounds: number; budgetMs: number }
  pixelContrast?: false
} {
  if (!collection) return {}
  return {
    settle: { capMs: collection.settleCapMs },
    imageCapture: { limit: collection.imageLimit, backgrounds: collection.backgroundLimit, budgetMs: collection.imageBudgetMs },
    pixelContrast: collection.pixelContrast,
  }
}

/**
 * Fast mode's coverage line for a run, from what did run: `llm` whether the judgment layer ran (images are captured and
 * links read only for it), `probes` how many probe kinds ran, `linksSkipped` whether 2.4.4 was judged without reading
 * where links lead because fast mode turned that off, `maxCandidates` the cap in effect when it is below the default one,
 * `web` whether the page was loaded in a browser (the settle cap and the captures apply to web pages only).
 */
export function fastCoverage(run: { criteria: readonly { id: string }[]; llm: boolean; probes: number; linksSkipped: boolean; maxCandidates: number | undefined; web: boolean }): FastCoverage {
  const judged = new Set(run.criteria.map((c) => c.id))
  const skipped = new Set<FastSkip>()
  if (run.probes === 0) skipped.add('probes')
  if (run.llm && run.linksSkipped) skipped.add('link-following')
  if (run.llm && !judged.has('1.4.5')) {
    skipped.add('ocr')
    if (run.web) skipped.add('css-backgrounds')
  }
  if (run.web) skipped.add('pixel-contrast')
  return {
    skipped: FAST_SKIPS.filter((skip) => skipped.has(skip)),
    ...(run.llm && run.maxCandidates !== undefined ? { maxCandidates: run.maxCandidates } : {}),
    ...(run.web && run.llm ? { imageLimit: FAST.imageLimit } : {}),
    ...(run.web ? { settleCapMs: FAST.settleCapMs } : {}),
  }
}

const SKIP_WORDS: Record<FastSkip, { en: string; 'pt-BR': string }> = {
  probes: { en: 'probes', 'pt-BR': 'sondas' },
  'link-following': { en: 'link following (2.4.4 judged from text and context)', 'pt-BR': 'leitura dos destinos dos links (2.4.4 julgado pelo texto e contexto)' },
  ocr: { en: 'OCR (1.4.5)', 'pt-BR': 'OCR (1.4.5)' },
  'pixel-contrast': { en: "contrast from pixels (axe-core's undecided contrast stays to review)", 'pt-BR': 'contraste por pixels (o contraste que o axe-core não decidiu fica para revisão)' },
  'css-backgrounds': { en: 'CSS background captures', 'pt-BR': 'capturas de fundos CSS' },
}

/** The coverage line's label and text, in the report's language: what fast mode left out and lowered. */
export function fastLine(fast: FastCoverage, locale: Locale): { label: string; text: string } {
  const pt = locale === 'pt-BR'
  const seconds = (ms: number) => `${String(ms / 1000).replace('.', pt ? ',' : '.')} s`
  const left = fast.skipped.map((skip) => SKIP_WORDS[skip][locale])
  const limits = [
    fast.maxCandidates !== undefined ? (pt ? `no máximo ${fast.maxCandidates} candidatos por critério` : `at most ${fast.maxCandidates} candidates per criterion`) : undefined,
    fast.imageLimit !== undefined ? (pt ? `${fast.imageLimit} capturas de imagem` : `${fast.imageLimit} image captures`) : undefined,
    fast.settleCapMs !== undefined ? (pt ? `${seconds(fast.settleCapMs)} de espera após o carregamento` : `${seconds(fast.settleCapMs)} of waiting after load`) : undefined,
  ].filter((part) => part !== undefined)
  const parts = [
    left.length > 0 ? `${pt ? 'deixou de fora' : 'left out'} ${left.join(', ')}` : undefined,
    limits.length > 0 ? `${pt ? 'limitou a' : 'lowered to'} ${limits.join(', ')}` : undefined,
  ].filter((part) => part !== undefined)
  return { label: pt ? 'Modo rápido (--fast):' : 'Fast mode (--fast):', text: parts.join('; ') }
}

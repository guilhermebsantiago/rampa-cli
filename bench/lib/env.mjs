// Paths, the browser every tool shares, and small helpers used across the benchmark.
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const BENCH = resolve(dirname(fileURLToPath(import.meta.url)), '..')
export const ROOT = resolve(BENCH, '..')
export const CACHE = join(BENCH, '.cache')

/**
 * Microsoft Edge, the one browser every tool drives: Playwright through `executablePath`, Puppeteer (Pa11y,
 * QualWeb, Lighthouse) the same way. BENCH_BROWSER_PATH points elsewhere (another Chromium) if needed.
 */
export function browserPath() {
  const explicit = process.env.BENCH_BROWSER_PATH
  if (explicit) {
    if (!existsSync(explicit)) throw new Error(`BENCH_BROWSER_PATH=${explicit} does not exist`)
    return explicit
  }
  const candidates =
    process.platform === 'win32'
      ? [
          join(process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)', 'Microsoft\\Edge\\Application\\msedge.exe'),
          join(process.env.ProgramFiles ?? 'C:\\Program Files', 'Microsoft\\Edge\\Application\\msedge.exe'),
        ]
      : process.platform === 'darwin'
        ? ['/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge']
        : ['/opt/microsoft/msedge/msedge', '/usr/bin/microsoft-edge', '/usr/bin/microsoft-edge-stable']
  const found = candidates.find((path) => existsSync(path))
  if (!found) throw new Error(`Microsoft Edge not found (looked in ${candidates.join(', ')}); set BENCH_BROWSER_PATH`)
  return found
}

/** Same navigation for every tool the harness drives itself: up to 60 s for `load`, then the analysis. */
export const NAVIGATION_TIMEOUT_MS = 60_000

/**
 * Opens a page and runs an analysis on it. A page that redirects as soon as it loads (a meta refresh with no delay)
 * destroys the document under the analysis; then the analysis runs once more on the page it led to, as Pa11y and
 * Rampa, which wait for the network to settle, end up doing.
 */
export async function openAndAnalyze(tab, url, analyze) {
  await tab.goto(url, { waitUntil: 'load', timeout: NAVIGATION_TIMEOUT_MS })
  try {
    return await analyze()
  } catch (error) {
    if (!/Execution context was destroyed|navigat/i.test(String(error?.message))) throw error
    await tab.waitForLoadState('load', { timeout: NAVIGATION_TIMEOUT_MS })
    return analyze()
  }
}

export async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'))
}

export async function writeJson(path, value) {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

export async function readJsonl(path) {
  if (!existsSync(path)) return []
  const text = await readFile(path, 'utf8')
  return text
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line))
}

/** WCAG criterion ids sort by their numbers: 1.4.10 after 1.4.3. */
export function compareIds(a, b) {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (d !== 0) return d
  }
  return 0
}

/** `wcag1412` (axe-core's tag) to `1.4.12`. */
export function criterionFromAxeTag(tag) {
  const match = /^wcag(\d)(\d)(\d{1,2})$/.exec(tag)
  return match ? `${match[1]}.${match[2]}.${match[3]}` : undefined
}

export function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`)
  if (index === -1) return fallback
  const value = process.argv[index + 1]
  return value === undefined || value.startsWith('--') ? true : value
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * The installed version of a package as `require` (from createRequire) resolves it, even when its `exports` hide
 * package.json: the nearest package.json above its entry point with that name.
 */
export function packageVersion(require, name) {
  try {
    return require(`${name}/package.json`).version
  } catch {
    let dir = dirname(require.resolve(name))
    for (;;) {
      const file = join(dir, 'package.json')
      if (existsSync(file)) {
        const pkg = require(file)
        if (pkg.name === name) return pkg.version
      }
      const parent = dirname(dir)
      if (parent === dir) return 'unknown'
      dir = parent
    }
  }
}

/** Adds rule ids under each criterion, once each. */
export function addHit(map, criterion, rule) {
  const list = (map[criterion] ??= [])
  if (!list.includes(rule)) list.push(rule)
}

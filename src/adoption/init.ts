import { createRequire } from 'node:module'
import { access, mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { loadConfig } from '../config.ts'
import type { Confidence } from '../core/types.ts'
import { errorMessage } from '../core/util.ts'
import { DEFAULT_CRITERIA } from '../criteria/index.ts'
import type { Locale } from '../i18n.ts'
import { findProvider } from '../providers/registry.ts'
import { BASELINE_FILE } from './baseline.ts'
import { WAIVERS_FILE } from './waivers.ts'

export const CONFIG_FORMATS = ['ts', 'mts', 'mjs', 'json'] as const
export type ConfigFormat = (typeof CONFIG_FORMATS)[number]

/** Every name loadConfig reads, in the order it tries them. */
const CONFIG_NAMES = ['rampa.config.ts', 'rampa.config.mts', 'rampa.config.js', 'rampa.config.mjs', 'rampa.config.json']

export const WORKFLOW_FILE = '.github/workflows/rampa.yml'

/** Generated locally and never worth committing; the waivers and the baseline next to them are. */
export const IGNORED = ['.rampa/cache', '.rampa/runs', '.rampa/screenshots', '.rampa/act']

export interface InitSettings {
  targets: string[]
  /** Written only when chosen on purpose: without it, Rampa picks a model on each machine. */
  model?: string | undefined
  criteria: string[]
  minConfidence: Confidence
  locale: Locale
  github: boolean
  format: ConfigFormat
}

export interface InitStep {
  path: string
  action: 'created' | 'overwritten' | 'updated' | 'kept'
  detail?: string | undefined
}

export interface InitResult {
  steps: InitStep[]
  warnings: string[]
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

/** The package.json Node reads for files in `dir`: the nearest one up the tree. */
async function nearestPackage(dir: string): Promise<{ type?: string } | undefined> {
  for (let current = dir; ; current = dirname(current)) {
    try {
      return JSON.parse(await readFile(join(current, 'package.json'), 'utf8')) as { type?: string }
    } catch {
      // no readable package.json here
    }
    if (dirname(current) === current) return undefined
  }
}

/**
 * TypeScript when this Node can strip types: `.ts` in a package of ES modules, `.mts` elsewhere,
 * since Node parses a `.ts` in a CommonJS package as CommonJS and fails on `export default`, and
 * parses it twice, with a warning, in a package without a "type". Older Node reads only `.mjs`.
 */
export async function defaultConfigFormat(cwd: string): Promise<ConfigFormat> {
  const strips = Boolean((process.features as { typescript?: unknown }).typescript)
  if (!strips) return 'mjs'
  return (await nearestPackage(cwd))?.type === 'module' ? 'ts' : 'mts'
}

/** Folders a build usually writes HTML into, in the order they are tried. */
const BUILD_DIRS = ['dist', 'build', 'out', '_site', 'public']

/** The first build folder with an HTML file in it, as a target to suggest. */
export async function detectTargets(cwd: string): Promise<string[]> {
  for (const dir of BUILD_DIRS) {
    try {
      const entries = await readdir(join(cwd, dir), { recursive: true })
      if (entries.some((entry) => /\.html?$/i.test(String(entry)))) return [dir]
    } catch {
      // no such folder
    }
  }
  return []
}

/** Whether `rampa` itself resolves from the project, so the config can import defineConfig for types. */
export function rampaResolves(cwd: string): boolean {
  try {
    createRequire(join(cwd, 'package.json')).resolve('rampa')
    return true
  } catch {
    return false
  }
}

const quote = (value: string) => `'${value.replaceAll('\\', '\\\\').replaceAll("'", "\\'")}'`
const list = (values: readonly string[]) => `[${values.map(quote).join(', ')}]`

export function configSource(settings: InitSettings, options: { typed: boolean; suggestedModel?: string | undefined }): string {
  if (settings.format === 'json') {
    const config = {
      targets: settings.targets.length > 0 ? settings.targets : undefined,
      model: settings.model,
      criteria: settings.criteria,
      minConfidence: settings.minConfidence,
      locale: settings.locale,
    }
    return `${JSON.stringify(config, null, 2)}\n`
  }
  const lines = [
    '// Rampa settings for this project: https://github.com/guilhermebsantiago/rampa-cli/blob/main/docs/adoption.md',
    '// Command-line options win over this file. API keys never go here: use the environment or a .env file.',
    ...(options.typed ? ["import { defineConfig } from 'rampa'", ''] : []),
    options.typed ? 'export default defineConfig({' : 'export default {',
    '  // What rampa check and rampa baseline check when you pass no targets: URLs, .html files, folders.',
    settings.targets.length > 0 ? `  targets: ${list(settings.targets)},` : "  // targets: ['dist', 'http://localhost:3000/'],",
    `  criteria: ${list(settings.criteria)},`,
  ]
  if (settings.model) lines.push(`  model: ${quote(settings.model)},`)
  else {
    lines.push('  // Without a model, Rampa picks one on each machine, a local Ollama model first (rampa models).')
    lines.push(`  // model: ${quote(options.suggestedModel ?? 'ollama:gemma4:12b')},`)
  }
  lines.push(
    `  minConfidence: ${quote(settings.minConfidence)},`,
    `  locale: ${quote(settings.locale)},`,
    '  // Report only the findings this file does not have: record it with rampa baseline, then uncomment.',
    `  // baseline: ${quote(BASELINE_FILE)},`,
    options.typed ? '})' : '}',
    '',
  )
  return lines.join('\n')
}

/**
 * A workflow that runs the Rampa action on pull requests and on main. It sticks to the action's
 * inputs: targets, criteria, model, fail-on, locale, comment and sarif. The action runs rampa check
 * at the root of the repository, so the config, its baseline and the waivers apply there too.
 */
export function workflowSource(settings: InitSettings): string {
  // The action takes targets separated by spaces.
  const targets = yamlText(settings.targets.length > 0 ? settings.targets.join(' ') : 'dist')
  const pinned = settings.model
  const provider = pinned ? findProvider(pinned.slice(0, pinned.indexOf(':'))) : undefined
  // Only a provider whose first variable is its API key gets a ready secret line; rampa doctor lists the rest.
  const key = provider?.where === 'api' && provider.env[0]?.endsWith('_API_KEY') ? provider.env[0] : undefined
  // With no model input the action uses the one Rampa picks, the config's included: a local model
  // there would fail on a runner, so the workflow says none (axe-core alone) until it has a hosted one.
  const model = pinned && isLocalModel(pinned)
    ? [
        '          # The config pins a local model, which a CI runner does not have: none runs axe-core alone.',
        '          # For the judgment layer, name a hosted model here and set its key below.',
        '          model: none',
      ]
    : pinned
      ? [`          # The config's model, ${pinned}, runs with the key below.`]
      : ['          # Without a model and its API key, only the deterministic engine (axe-core) runs.', '          # model: anthropic:claude-haiku-5-5']
  const env = key
    ? [`        # Plus any other variable rampa doctor says ${provider?.name} needs.`, '        env:', `          ${key}: \${{ secrets.${key} }}`]
    : pinned && !isLocalModel(pinned)
      ? [`        # Set the credentials ${provider?.name ?? pinned} needs as secrets, under env (rampa doctor lists them).`]
      : ['        # env:', '        #   ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}']
  return `# Accessibility checks with Rampa: https://github.com/guilhermebsantiago/rampa-cli/blob/main/docs/adoption.md
name: accessibility

on:
  pull_request:
  push:
    branches: [main]

permissions:
  contents: read
  # comment: the report as one comment on the pull request.
  pull-requests: write
  # sarif: the findings in code scanning.
  security-events: write

jobs:
  rampa:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5

      # Build or start the site first, so the targets below exist. For example:
      # - uses: actions/setup-node@v5
      #   with:
      #     node-version: 24
      # - run: npm ci && npm run build

      - uses: guilhermebsantiago/rampa-cli@main
        with:
          targets: ${targets}
          # With baseline set in the Rampa config, only findings the baseline does not have fail the job.
          fail-on: confirmed
${model.join('\n')}
          # criteria: ${settings.criteria.join(',')}
          locale: ${settings.locale}
          comment: true
          sarif: true
${env.join('\n')}
`
}

/** A YAML scalar: plain when it can be, single-quoted when a character would change its meaning. */
function yamlText(value: string): string {
  const plain = /^[\w./~$][^#'"]*$/.test(value) && !/:\s|\s$/.test(value)
  return plain ? value : `'${value.replaceAll("'", "''")}'`
}

/** Models served on the machine itself, which a CI runner does not have. */
export function isLocalModel(spec: string): boolean {
  return findProvider(spec.slice(0, spec.indexOf(':')))?.where === 'local'
}

/** Normalizes an ignore pattern for comparison: no leading or trailing slash. */
const bare = (line: string) => line.trim().replace(/^\//, '').replace(/\/$/, '')

/** The lines .gitignore still lacks, and whether it ignores the whole .rampa folder, waivers included. */
export function gitignoreChanges(existing: string): { missing: string[]; ignoresAll: boolean } {
  const lines = existing.split(/\r?\n/).map(bare)
  // Git cannot re-include a file inside an ignored folder, only one matched by a wildcard.
  const reincluded = lines.includes('!.rampa/waivers.json')
  return {
    missing: IGNORED.filter((pattern) => !lines.includes(pattern)),
    ignoresAll: lines.includes('.rampa') || (!reincluded && (lines.includes('.rampa/*') || lines.includes('.rampa/**'))),
  }
}

async function writeNew(path: string, content: string, force: boolean): Promise<InitStep['action']> {
  const there = await exists(path)
  if (there && !force) return 'kept'
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, content, 'utf8')
  return there ? 'overwritten' : 'created'
}

/**
 * Writes the config, an empty waivers file, the .gitignore lines and, on request, the workflow.
 * Nothing that exists is replaced without `force`, and the waivers file never is: it holds decisions.
 */
export async function runInitSteps(
  cwd: string,
  settings: InitSettings,
  options: { force: boolean; suggestedModel?: string | undefined },
): Promise<InitResult> {
  const steps: InitStep[] = []
  const warnings: string[] = []
  const at = (path: string) => join(cwd, path)

  const configName = `rampa.config.${settings.format}`
  const others: string[] = []
  for (const name of CONFIG_NAMES) if (name !== configName && (await exists(at(name)))) others.push(name)
  if (others.length > 0 && !options.force) {
    steps.push({ path: others[0] ?? configName, action: 'kept', detail: 'a config file exists; --force writes a new one' })
  } else {
    const typed = settings.format !== 'json' && rampaResolves(cwd)
    const action = await writeNew(at(configName), configSource(settings, { typed, suggestedModel: options.suggestedModel }), options.force)
    steps.push({ path: configName, action, detail: action === 'kept' ? 'exists; --force overwrites it' : undefined })
    // loadConfig reads the first name in its list and ignores the rest.
    for (const other of others) {
      warnings.push(
        CONFIG_NAMES.indexOf(other) < CONFIG_NAMES.indexOf(configName)
          ? `${other} also exists and Rampa reads it first; remove it to use ${configName}.`
          : `${other} also exists; Rampa now reads ${configName} instead, so remove ${other}.`,
      )
    }
    if (action !== 'kept') {
      try {
        await loadConfig(cwd)
      } catch (error) {
        warnings.push(`${configName} does not load on this Node: ${errorMessage(error)} Try --config-format mjs.`)
      }
    }
  }

  const waivers = at(WAIVERS_FILE)
  if (await exists(waivers)) steps.push({ path: WAIVERS_FILE, action: 'kept', detail: 'holds decisions; never replaced' })
  else {
    await mkdir(dirname(waivers), { recursive: true })
    await writeFile(waivers, '[]\n', 'utf8')
    steps.push({ path: WAIVERS_FILE, action: 'created' })
  }

  const gitignore = at('.gitignore')
  const current = (await exists(gitignore)) ? await readFile(gitignore, 'utf8') : undefined
  const { missing, ignoresAll } = gitignoreChanges(current ?? '')
  if (missing.length > 0) {
    // The file's own line ending, so a CRLF file does not end up mixed.
    const eol = current?.includes('\r\n') ? '\r\n' : '\n'
    const separator = current === undefined || current === '' ? '' : current.endsWith('\n') ? eol : eol + eol
    const block = ['# Rampa: local files. Commit .rampa/waivers.json and .rampa/baseline.json.', ...missing].join(eol)
    await writeFile(gitignore, `${current ?? ''}${separator}${block}${eol}`, 'utf8')
    steps.push({ path: '.gitignore', action: current === undefined ? 'created' : 'updated', detail: `+ ${missing.join(', ')}` })
  } else steps.push({ path: '.gitignore', action: 'kept', detail: 'already ignores the local Rampa files' })
  if (ignoresAll) {
    warnings.push('.gitignore ignores all of .rampa, so the waivers and the baseline would never be committed. Replace that line with the four .rampa/ lines above.')
  }

  if (settings.github) {
    const action = await writeNew(at(WORKFLOW_FILE), workflowSource(settings), options.force)
    steps.push({ path: WORKFLOW_FILE, action, detail: action === 'kept' ? 'exists; --force overwrites it' : undefined })
  }
  return { steps, warnings }
}

export interface LocalServers {
  ollama: { reachable: boolean; models: string[] }
  lmStudio: { reachable: boolean; models: string[] }
}

export interface ModelSuggestion {
  /** A local model to suggest. */
  spec?: string | undefined
  /** rampa check would pick it here without --model. */
  automatic: boolean
  note: string
}

/**
 * What to tell the person running init about models. `automatic` is what rampa check picks here
 * without --model (defaultModel in providers/detect.ts): a recommended Ollama model, else a hosted one.
 */
export function suggestModel(servers: LocalServers, automatic: string | undefined): ModelSuggestion {
  if (automatic?.startsWith('ollama:')) {
    return { spec: automatic, automatic: true, note: `Ollama is running with ${automatic.slice(7)}, which rampa check uses here when --model is not given.` }
  }
  const studio = servers.lmStudio.models[0]
  if (servers.lmStudio.reachable && studio) {
    return {
      spec: `lmstudio:${studio}`,
      automatic: false,
      note: `LM Studio has ${studio} loaded; Rampa never picks LM Studio on its own, so pass --model lmstudio:${studio} or set it in the config.`,
    }
  }
  const other = servers.ollama.models[0]
  if (servers.ollama.reachable && other) {
    return { spec: `ollama:${other}`, automatic: false, note: `Ollama has no model Rampa picks on its own: ollama pull gemma4:12b, or pass --model ollama:${other}.` }
  }
  const pull = 'ollama pull gemma4:12b gives the judgment layer a local model with vision'
  if (servers.ollama.reachable) return { automatic: false, note: `Ollama is running with no model pulled: ${pull}.` }
  if (automatic) return { automatic: false, note: `No local model server found; with the API key set here, rampa check uses ${automatic}.` }
  return { automatic: false, note: `No local model server and no API key found, so only axe-core runs: ${pull}, or set a provider's key (rampa models).` }
}

export function defaultSettings(overrides: Partial<InitSettings> & { format: ConfigFormat }): InitSettings {
  return {
    targets: [],
    criteria: [...DEFAULT_CRITERIA],
    minConfidence: 'medium',
    locale: 'en',
    github: false,
    ...overrides,
  }
}

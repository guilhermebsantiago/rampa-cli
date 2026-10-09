/**
 * The check step of the GitHub Action (action.yml). It runs `rampa check` with the
 * action's inputs, writes every report format to the runner's temporary directory, sets
 * the step outputs and adds the Markdown report to the job summary. It always exits 0
 * once rampa ran, so the SARIF upload and the comment still happen; the last step of the
 * action fails the job with rampa's exit code.
 *
 * Node 22.18+ runs it as is, TypeScript without a build step; it reads the provider table
 * from src, which needs no dependency to load.
 */
import { spawnSync } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { findProvider } from '../src/providers/registry.ts'

export interface CheckInputs {
  targets: string
  criteria: string
  model: string
  failOn: string
  locale: string
  args: string
}

export interface ReportFiles {
  json: string
  markdown: string
  sarif: string
  html: string
}

export interface CheckPlan {
  args: string[]
  files: ReportFiles
}

/**
 * Splits like a shell, minus the escapes: spaces and new lines separate, quotes group, and a
 * backslash is kept as written, so Windows paths such as `site\` or `\\server\share` stay whole.
 * Nothing is expanded.
 */
export function splitArgs(input: string): string[] {
  const args: string[] = []
  let current = ''
  let started = false
  let quote: '"' | "'" | undefined
  for (let i = 0; i < input.length; i++) {
    const char = input[i] as string
    if (quote) {
      if (char === quote) quote = undefined
      else current += char
      continue
    }
    if (char === '"' || char === "'") {
      quote = char
      started = true
    } else if (/\s/.test(char)) {
      if (started) args.push(current)
      current = ''
      started = false
    } else {
      current += char
      started = true
    }
  }
  if (quote) throw new Error(`Unclosed ${quote} in: ${input}`)
  if (started) args.push(current)
  return args
}

export interface ModelChoice {
  args: string[]
  /** Why the judgment layer is off, when a model was asked for. */
  warning?: string | undefined
}

/** Credentials a `provider:model` still needs in this environment, in words; empty when it can be called. */
export function missingCredentials(spec: string): string[] {
  const colon = spec.indexOf(':')
  // Without a provider prefix, rampa itself rejects the spec.
  return colon === -1 ? [] : (findProvider(spec.slice(0, colon))?.missing() ?? [])
}

/**
 * The model flags: the input when set, otherwise the model rampa detects (RAMPA_MODEL or an
 * API key in the environment). With no model, or a model whose key this run lacks, as on a
 * pull request from a fork, which gets no secrets, it is `--no-llm`: the deterministic layer
 * runs instead of the job failing.
 */
export function modelArgs(model: string, extra: readonly string[], detect: () => string | undefined, missing = missingCredentials): ModelChoice {
  const value = model.trim()
  if (['none', 'off', 'false', 'no'].includes(value.toLowerCase())) return { args: ['--no-llm'] }
  if (value === '' && extra.some((arg) => arg === '--no-llm' || arg === '-m' || arg === '--model' || arg.startsWith('--model='))) return { args: [] }
  const spec = value || detect()
  if (!spec) return { args: ['--no-llm'] }
  const needs = missing(spec)
  if (needs.length > 0) {
    return {
      args: ['--no-llm'],
      warning: `${spec} needs ${needs.join(' and ')}, which this run does not have (pull requests from forks get no secrets), so only the deterministic layer runs.`,
    }
  }
  return { args: ['--model', spec] }
}

export function planCheck(
  inputs: CheckInputs,
  outDir: string,
  detect: () => string | undefined,
  missing = missingCredentials,
): CheckPlan & { warning?: string | undefined } {
  const targets = splitArgs(inputs.targets)
  if (targets.length === 0) throw new Error('No targets: set the targets input to URLs, .html files or folders.')
  const extra = splitArgs(inputs.args)
  const model = modelArgs(inputs.model, extra, detect, missing)
  const files: ReportFiles = {
    json: join(outDir, 'rampa.json'),
    markdown: join(outDir, 'rampa.md'),
    sarif: join(outDir, 'rampa.sarif'),
    html: join(outDir, 'rampa.html'),
  }
  const args = ['check', '--json', files.json, '--markdown', files.markdown, '--sarif', files.sarif, '--html', files.html]
  if (inputs.criteria.trim() !== '') args.push('--criteria', inputs.criteria.trim())
  if (inputs.failOn.trim() !== '') args.push('--fail-on', inputs.failOn.trim())
  if (inputs.locale.trim() !== '') args.push('--locale', inputs.locale.trim())
  args.push(...model.args, ...extra)
  // After `--`, a target can never be read as an option.
  args.push('--', ...targets)
  return { args, files, warning: model.warning }
}

/** Confirmed findings in a JSON report: one report, or an array of them for several targets. */
export function countFindings(json: unknown): number {
  const reports: unknown[] = Array.isArray(json) ? json : [json]
  return reports.reduce<number>((sum, report) => {
    const findings = (report as { findings?: unknown } | null)?.findings
    return sum + (Array.isArray(findings) ? findings.length : 0)
  }, 0)
}

/** Lines for $GITHUB_OUTPUT. */
export function outputLines(outputs: Record<string, string | number>): string {
  return Object.entries(outputs)
    .map(([name, value]) => `${name}=${String(value).replace(/[\r\n]+/g, ' ')}\n`)
    .join('')
}

function inputsFrom(env: NodeJS.ProcessEnv): CheckInputs {
  return {
    targets: env.INPUT_TARGETS ?? '',
    criteria: env.INPUT_CRITERIA ?? '',
    model: env.INPUT_MODEL ?? '',
    failOn: env.INPUT_FAIL_ON ?? '',
    locale: env.INPUT_LOCALE ?? '',
    args: env.INPUT_ARGS ?? '',
  }
}

function main(): number {
  const env = process.env
  const cli = env.RAMPA_CLI ?? resolve(dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'cli.mjs')
  if (!existsSync(cli)) {
    console.error(`::error::Rampa is not built: ${cli} is missing.`)
    return 2
  }
  // A new folder for each run: a run that fails early must not leave an earlier report to
  // publish, and a second use of the action in a job must not overwrite the first one's outputs.
  const base = join(env.RUNNER_TEMP ?? tmpdir(), 'rampa')
  mkdirSync(base, { recursive: true })
  const outDir = mkdtempSync(join(base, 'run-'))
  const detect = () => {
    const result = spawnSync(process.execPath, [cli, 'models', '--default'], { encoding: 'utf8' })
    return result.status === 0 ? result.stdout.trim() || undefined : undefined
  }

  let plan: ReturnType<typeof planCheck>
  try {
    plan = planCheck(inputsFrom(env), outDir, detect)
  } catch (error) {
    console.error(`::error::${error instanceof Error ? error.message : String(error)}`)
    return 2
  }
  if (plan.warning) console.log(`::warning::${plan.warning}`)
  console.log(`rampa ${plan.args.join(' ')}`)
  // The job log shows colors, unless the workflow asked for none.
  const color = env.FORCE_COLOR === undefined && env.NO_COLOR === undefined ? { FORCE_COLOR: '1' } : {}
  const run = spawnSync(process.execPath, [cli, ...plan.args], { stdio: 'inherit', env: { ...env, ...color } })
  const exitCode = run.status ?? 2

  let findings = 0
  try {
    findings = countFindings(JSON.parse(readFileSync(plan.files.json, 'utf8')))
  } catch {
    // rampa stopped before it wrote a report; exit-code says why.
  }
  const present = (file: string) => (existsSync(file) ? file : '')
  const outputs = {
    'exit-code': exitCode,
    findings,
    json: present(plan.files.json),
    markdown: present(plan.files.markdown),
    sarif: present(plan.files.sarif),
    html: present(plan.files.html),
  }
  if (env.GITHUB_OUTPUT) appendFileSync(env.GITHUB_OUTPUT, outputLines(outputs))
  else console.log(outputLines(outputs).trimEnd())
  if (env.INPUT_SUMMARY !== 'false' && env.GITHUB_STEP_SUMMARY && outputs.markdown) {
    appendFileSync(env.GITHUB_STEP_SUMMARY, `${readFileSync(outputs.markdown, 'utf8')}\n`)
  }
  return 0
}

// Run only as a script, not when a test imports it.
if (isEntry(process.argv[1], import.meta.filename)) process.exitCode = main()

/** Compares real paths: Node reports this module's own path with symlinks and junctions resolved. */
function isEntry(invoked: string | undefined, self: string | undefined): boolean {
  if (!invoked || !self) return false
  try {
    const [a, b] = [realpathSync(resolve(invoked)), realpathSync(self)]
    return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b
  } catch {
    return false
  }
}

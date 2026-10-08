import { createInterface } from 'node:readline/promises'
import type { Readable, Writable } from 'node:stream'
import {
  CONFIG_FORMATS,
  type ConfigFormat,
  type InitSettings,
  type ModelSuggestion,
  defaultConfigFormat,
  defaultSettings,
  detectTargets,
  runInitSteps,
  suggestModel,
} from '../../adoption/init.ts'
import type { Confidence } from '../../core/types.ts'
import { RampaError } from '../../core/util.ts'
import { resolveCriteria } from '../../criteria/index.ts'
import { resolveLocale } from '../../i18n.ts'
import { defaultModel, probeLmStudio, probeOllama } from '../../providers/detect.ts'
import { colorsEnabled, paint } from '../../report/color.ts'
import type { GlobalContext } from '../context.ts'

export interface InitCommandOptions {
  targets?: string
  model?: string
  criteria?: string
  minConfidence?: Confidence
  github?: boolean
  yes?: boolean
  force?: boolean
  configFormat?: ConfigFormat
  /** --no-detect: do not look for local model servers. */
  detect: boolean
}

export interface InitIo {
  input: Readable & { isTTY?: boolean }
  output: Writable
}

const splitList = (value: string) =>
  value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)

export async function runInit(options: InitCommandOptions, context: GlobalContext, io: InitIo = { input: process.stdin, output: process.stdout }): Promise<number> {
  const cwd = process.cwd()
  if (options.configFormat && !CONFIG_FORMATS.includes(options.configFormat)) {
    throw new RampaError('invalid-option', `--config-format must be one of ${CONFIG_FORMATS.join(', ')}.`)
  }
  const criteria = options.criteria ? resolveCriteria(splitList(options.criteria)).map((criterion) => criterion.id) : undefined
  let settings = defaultSettings({
    format: options.configFormat ?? (await defaultConfigFormat(cwd)),
    targets: options.targets ? splitList(options.targets) : await detectTargets(cwd),
    model: options.model,
    locale: context.locale,
    github: Boolean(options.github),
    ...(criteria ? { criteria } : {}),
    ...(options.minConfidence ? { minConfidence: options.minConfidence } : {}),
  })
  const suggestion = options.detect && !options.model ? await detectModel() : undefined

  if (io.input.isTTY && !options.yes) settings = await interview(settings, suggestion, io)

  const p = paint(colorsEnabled())
  const result = await runInitSteps(cwd, settings, { force: Boolean(options.force), suggestedModel: suggestion?.spec })
  const out = (line = '') => io.output.write(`${line}\n`)
  out()
  out(`  ${p.bold('rampa init')}`)
  out()
  for (const step of result.steps) {
    const mark = step.action === 'kept' ? p.gray(step.action.padEnd(12)) : p.green(step.action.padEnd(12))
    out(`  ${mark}${step.path}${step.detail ? p.dim(`  ${step.detail}`) : ''}`)
  }
  for (const warning of result.warnings) out(`  ${p.yellow('!')} ${warning}`)
  out()
  if (settings.targets.length === 0) out(`  ${p.yellow('No targets yet:')} set targets in the config, or pass them to rampa check.`)
  if (suggestion) out(`  ${p.bold('Model:')} ${suggestion.note}`)
  else if (settings.model) out(`  ${p.bold('Model:')} ${settings.model}, pinned in the config.`)
  if (settings.github && (settings.model?.startsWith('ollama:') || settings.model?.startsWith('lmstudio:') || suggestion?.automatic)) {
    out(`  ${p.dim('CI has no local model: give the workflow a model and its API key, or it runs axe-core alone.')}`)
  }
  out()
  out(`  ${p.bold('Next')}`)
  const next: Array<[string, string]> = [
    ['rampa check', settings.targets.length > 0 ? 'checks the targets in the config' : 'checks the pages you pass it'],
    ['rampa baseline', "records today's findings, so CI fails only on new ones (docs/adoption.md)"],
    ['rampa waive <id> --reason "..."', 'accepts one finding on purpose, with a reason'],
  ]
  for (const [command, what] of next) out(`    ${p.cyan(command.padEnd(34))}${what}`)
  out()
  return 0
}

async function detectModel(): Promise<ModelSuggestion> {
  const [ollama, lmStudio, automatic] = await Promise.all([probeOllama(), probeLmStudio(), defaultModel()])
  return suggestModel({ ollama, lmStudio }, automatic)
}

/** The same settings, asked one by one with the flags and what was detected as the defaults. */
export async function interview(settings: InitSettings, suggestion: ModelSuggestion | undefined, io: InitIo): Promise<InitSettings> {
  const rl = createInterface({ input: io.input, output: io.output, terminal: Boolean(io.input.isTTY) })
  // The iterator buffers lines typed ahead or piped in, which rl.question would drop.
  const lines = rl[Symbol.asyncIterator]()
  let closed = false
  rl.once('close', () => {
    closed = true
  })
  const ask = async (question: string, fallback: string) => {
    const prompt = `  ${question}${fallback ? ` [${fallback}]` : ''}: `
    // Once the input has ended, only buffered answers are left and readline no longer prompts.
    if (closed) io.output.write(prompt)
    else {
      rl.setPrompt(prompt)
      rl.prompt()
    }
    const next = await lines.next()
    const answer = next.done ? '' : String(next.value).trim()
    return answer === '' ? fallback : answer
  }
  try {
    io.output.write('\n  Set up Rampa in this project. Enter keeps the value in brackets.\n\n')
    const targets = await ask('Pages to check: URLs, .html files or folders, comma-separated', settings.targets.join(', '))
    if (suggestion) io.output.write(`  ${suggestion.note}\n`)
    const model = await ask('Model to pin in the config, or empty to pick one on each machine', settings.model ?? '')
    const locale = await ask('Report language, en or pt-BR', settings.locale)
    const github = await ask('Add a GitHub Actions workflow? y or n', settings.github ? 'y' : 'n')
    return { ...settings, targets: splitList(targets), model: model || undefined, locale: resolveLocale(locale), github: /^y/i.test(github) }
  } finally {
    rl.close()
  }
}

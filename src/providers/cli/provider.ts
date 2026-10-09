import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { z } from 'zod'
import { RampaError, errorMessage } from '../../core/util.ts'
import type { Reasoning } from '../ai-sdk.ts'
import type { ModelProvider } from '../types.ts'
import { FATAL_CODES, cliFailed, invalidOutput, notInstalled, notSignedIn, notSubscription, oneLine, timedOut, unknownModel } from './errors.ts'
import { type ResolvedCommand, limiter, resolveCommand, runProcess } from './process.ts'
import type { CliAdapter, CliCall, Exec, SignIn } from './types.ts'

/** Spawning an agent CLI costs a process and its startup each time, so a run keeps only a few alive at once. */
export const DEFAULT_CLI_CONCURRENCY = 3
/** Thinking models can take a while on a long page, but a CLI that hangs should not hold the run forever. */
export const DEFAULT_CLI_TIMEOUT_S = 300
const STATUS_TIMEOUT_MS = 20_000

function positiveNumber(value: string | undefined, fallback: number): number {
  const parsed = Number.parseFloat(value ?? '')
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

export const cliConcurrency = (): number => Math.max(1, Math.floor(positiveNumber(process.env.RAMPA_CLI_CONCURRENCY, DEFAULT_CLI_CONCURRENCY)))
export const cliTimeoutSeconds = (): number => positiveNumber(process.env.RAMPA_CLI_TIMEOUT, DEFAULT_CLI_TIMEOUT_S)

/**
 * An empty directory of Rampa's own, so the CLI never picks up the checked
 * project's AGENTS.md, GEMINI.md, hooks or MCP servers. It lives in the
 * user's cache directory rather than a shared /tmp, where another account
 * could plant those files.
 */
export function cliWorkdir(): string {
  const base =
    process.platform === 'win32'
      ? process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local')
      : process.env.XDG_CACHE_HOME || join(homedir(), '.cache')
  return join(base, 'rampa', 'cli')
}

/** The user's environment without the variables that would bill an API key, plus the CLI's own isolation switches. */
export function cliEnvironment(cli: CliAdapter, env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const drop = new Set(cli.dropEnv.map((name) => name.toUpperCase()))
  const result: NodeJS.ProcessEnv = {}
  for (const [name, value] of Object.entries(env)) if (!drop.has(name.toUpperCase())) result[name] = value
  return { ...result, ...cli.setEnv }
}

/** `default` keeps the CLI's own model; anything else must look like a model name, since it ends up on a command line. */
export function cliModel(cli: CliAdapter, modelId: string): string | undefined {
  if (modelId === 'default') return undefined
  if (!/^[A-Za-z0-9][\w.:/@+-]*$/.test(modelId)) throw unknownModel(cli, modelId, 'not a model name')
  return modelId
}

/** The CLIs share three effort levels; asking for no reasoning gets the lowest, since newer models cannot turn it off. */
export function cliEffort(reasoning: Reasoning): CliCall['effort'] {
  if (reasoning === 'provider-default') return undefined
  return reasoning === 'medium' || reasoning === 'high' ? reasoning : 'low'
}

function makeExec(cli: CliAdapter, command: ResolvedCommand, cwd: string): Exec {
  const env = cliEnvironment(cli)
  return async (args, input, options = {}) => {
    const timeoutMs = options.timeoutMs ?? cliTimeoutSeconds() * 1000
    let result: Awaited<ReturnType<typeof runProcess>>
    try {
      result = await runProcess(command, args, { cwd, env: options.env ? { ...env, ...options.env } : env, input, timeoutMs })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw notInstalled(cli)
      throw cliFailed(cli, `could not start ${command.path}: ${errorMessage(error)}`)
    }
    if (result.timedOut) throw timedOut(cli, Math.round(timeoutMs / 1000))
    return result
  }
}

/** The override variable when set; otherwise PATH, then where the official installer puts the CLI. */
export function locateCli(cli: CliAdapter): ResolvedCommand | undefined {
  const override = process.env[cli.binEnv] || undefined
  if (override) return resolveCommand(cli.command, override)
  return resolveCommand(cli.command) ?? (cli.knownPaths?.() ?? []).map((path) => resolveCommand(cli.command, path)).find((found) => found !== undefined)
}

async function ensureWorkdir(): Promise<string> {
  const dir = cliWorkdir()
  try {
    await mkdir(dir, { recursive: true, mode: 0o700 })
    return dir
  } catch {
    // A read-only home, as in some CI containers: a private directory of its own under the system temp works too.
    return mkdtemp(join(tmpdir(), 'rampa-cli-'))
  }
}

/**
 * A provider that hands each judgment to an agent CLI. Before the first call
 * it checks that the CLI is there and signed in to a subscription, so a run
 * fails at once, the way a missing API key does.
 */
export async function createCliProvider(
  cli: CliAdapter,
  modelId: string,
  identity: { id: string; settings: string },
  reasoning: Reasoning,
): Promise<ModelProvider> {
  const model = cliModel(cli, modelId)
  const command = locateCli(cli)
  if (!command) throw notInstalled(cli)
  const workdir = await ensureWorkdir()
  const exec = makeExec(cli, command, workdir)

  if (cli.signIn) {
    const status = await cli.signIn((args, input) => exec(args, input, { timeoutMs: STATUS_TIMEOUT_MS })).catch((error: unknown) => {
      if (error instanceof RampaError && error.code === 'cli-not-installed') throw error
      return undefined
    })
    if (status?.signedIn === false) throw notSignedIn(cli, status.detail)
    if (status?.subscription === false) throw notSubscription(cli, status.detail)
  }
  await cli.prepare?.(workdir)

  const slot = limiter(cliConcurrency())
  const effort = cliEffort(reasoning)
  let fatal: RampaError | undefined

  return {
    ...identity,
    async judge(request) {
      if (fatal) throw fatal
      return slot(async () => {
        if (fatal) throw fatal
        // A call that waited for its turn past the time limit is not started.
        request.signal?.throwIfAborted()
        const dir = await mkdtemp(join(workdir, 'call-'))
        const started = performance.now()
        try {
          // Draft-07 is what the CLIs' validators read; the declaration itself is left out, since some reject it.
          const jsonSchema = z.toJSONSchema(request.schema, { target: 'draft-7' }) as Record<string, unknown>
          delete jsonSchema.$schema
          const answer = await cli.judge(
            { system: request.system, user: request.user, images: request.images ?? [], jsonSchema, model, effort, dir },
            exec,
          )
          const parsed = request.schema.safeParse(answer.output)
          if (!parsed.success) {
            const issue = parsed.error.issues[0]
            throw invalidOutput(cli, issue ? `${issue.path.join('.') || 'answer'}: ${issue.message}` : undefined)
          }
          return {
            output: parsed.data,
            inputTokens: answer.inputTokens,
            outputTokens: answer.outputTokens,
            latencyMs: Math.round(performance.now() - started),
            modelId: answer.modelId ?? modelId,
          }
        } catch (error) {
          if (error instanceof RampaError && FATAL_CODES.has(error.code)) fatal = error
          throw error
        } finally {
          await rm(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }).catch(() => undefined)
        }
      })
    },
  }
}

export interface CliStatus {
  installed: boolean
  /** Where the executable was found. */
  path?: string | undefined
  version?: string | undefined
  signIn?: SignIn | undefined
}

/** For doctor and models: is the CLI there, which version, and is it signed in. Never calls a model. */
export async function probeCli(cli: CliAdapter): Promise<CliStatus> {
  const command = locateCli(cli)
  if (!command) return { installed: false }
  let exec: Exec
  try {
    exec = makeExec(cli, command, await ensureWorkdir())
  } catch {
    return { installed: true, path: command.path }
  }
  const quick: Exec = (args, input) => exec(args, input, { timeoutMs: STATUS_TIMEOUT_MS })
  const [version, signIn] = await Promise.all([
    // "codex-cli 0.55.0", "0.42.0": the number is enough next to the name.
    quick(['--version'], '')
      .then((result) => (result.code === 0 ? (/\d+\.\d+[\w.+-]*/.exec(result.stdout)?.[0] ?? (oneLine(result.stdout, 40) || undefined)) : undefined))
      .catch(() => undefined),
    cli.signIn ? cli.signIn(quick).catch(() => undefined) : Promise.resolve(undefined),
  ])
  return { installed: true, path: command.path, version, signIn }
}

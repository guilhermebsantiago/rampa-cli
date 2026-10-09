import { RampaError } from '../../core/util.ts'
import type { CliAdapter } from './types.ts'

/** What to use instead when the CLI cannot judge, in one place so every message offers the same way out. */
const ALTERNATIVES = 'use a local model (--model ollama:gemma4:12b) or an API key instead; rampa models lists both'

/** Errors after which no later call can succeed, so the provider stops spawning the CLI for the rest of the run. */
export const FATAL_CODES: ReadonlySet<string> = new Set([
  'cli-not-installed',
  'cli-not-signed-in',
  'cli-not-subscription',
  'subscription-limit',
  'invalid-model',
])

const detail = (text: string | undefined) => (text ? ` (${oneLine(text)})` : '')

export function oneLine(text: string, max = 300): string {
  const line = text.replace(/\s+/g, ' ').trim()
  return line.length > max ? `${line.slice(0, max - 1)}…` : line
}

export function notInstalled(cli: CliAdapter): RampaError {
  return new RampaError(
    'cli-not-installed',
    `${cli.name} (${cli.command}) is not installed or not on PATH. Install it from ${cli.install} and sign in, or set ${cli.binEnv} to its path; or ${ALTERNATIVES}.`,
  )
}

export function notSignedIn(cli: CliAdapter, text?: string): RampaError {
  return new RampaError('cli-not-signed-in', `${cli.name} is not signed in${detail(text)}: ${cli.signInHint}, then run Rampa again; or ${ALTERNATIVES}.`)
}

export function notSubscription(cli: CliAdapter, text?: string): RampaError {
  return new RampaError(
    'cli-not-subscription',
    `${cli.name} is signed in with an API key or a cloud account${detail(text)}, not a ${cli.plan} subscription. Sign it in with your ${cli.plan} account, or call that API directly with its own provider; see rampa models.`,
  )
}

export function limitReached(cli: CliAdapter, text?: string): RampaError {
  return new RampaError(
    'subscription-limit',
    `Your ${cli.plan} plan reached its usage limit in ${cli.name}${detail(text)}. Rampa stopped calling it for this run: wait for the reset, or ${ALTERNATIVES}.`,
  )
}

export function unknownModel(cli: CliAdapter, model: string | undefined, text?: string): RampaError {
  return new RampaError('invalid-model', `${cli.name} does not offer the model "${model ?? 'default'}"${detail(text)}.`)
}

export function invalidOutput(cli: CliAdapter, text?: string): RampaError {
  return new RampaError('invalid-output', `${cli.name} did not return an answer that matches the schema${detail(text)}.`)
}

export function timedOut(cli: CliAdapter, seconds: number): RampaError {
  return new RampaError('cli-timeout', `${cli.name} did not answer within ${seconds} s; set RAMPA_CLI_TIMEOUT (seconds) to wait longer.`)
}

export function cliFailed(cli: CliAdapter, text: string): RampaError {
  return new RampaError('cli-error', `${cli.name} failed: ${oneLine(text) || 'no output'}`)
}

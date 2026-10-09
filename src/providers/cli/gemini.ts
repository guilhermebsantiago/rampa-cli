import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'
import { number, parseJsonText, record, withSchema, writeImages } from './answer.ts'
import { cliFailed, invalidOutput, limitReached, notSignedIn, unknownModel } from './errors.ts'
import type { ProcessResult } from './process.ts'
import type { CliAdapter, CliAnswer, CliCall, SignIn } from './types.ts'

/** "You have exhausted your daily quota on this model", RESOURCE_EXHAUSTED, HTTP 429. */
const PLAN_LIMIT = /exhausted your (?:\w+ )?(?:capacity|quota)|quota|resource.?exhausted|rate.?limit/i
const SIGNED_OUT = /auth method|not (?:logged|signed) in|login required|authenticat|permission denied/i
const NO_MODEL = /model.*not found|not found.*model|is not supported/i
/** Exit codes Gemini CLI documents or sets: 41 for authentication; an API error exits with its HTTP status, 429 (173 once POSIX truncates it). */
const AUTH_EXIT = 41
const LIMIT_EXITS = new Set([429, 173])
/** The sign-ins Gemini CLI saves as security.auth.selectedType (selectedAuthType before the v2 settings layout). */
const SUBSCRIPTION_AUTH = new Set(['oauth-personal', 'cloud-shell', 'compute-default-credentials'])
const API_AUTH = new Set(['gemini-api-key', 'vertex-ai', 'gateway'])

/**
 * Workspace settings for Rampa's own directory, which Gemini CLI reads on top
 * of the user's: no built-in tools (an empty allowlist; @file references do
 * not need one), no hooks, skills, checkpoints or auto-update, no GEMINI.md
 * (the context file name matches nothing) and no directory tree in the prompt.
 * https://geminicli.com/docs/reference/configuration/
 */
const WORKSPACE_SETTINGS = {
  tools: { core: [] },
  hooksConfig: { enabled: false },
  skills: { enabled: false },
  general: { enableAutoUpdate: false, checkpointing: { enabled: false } },
  context: { fileName: 'RAMPA-NO-CONTEXT.md', includeDirectoryTree: false, fileFiltering: { respectGitIgnore: false } },
}

function failure(cli: CliAdapter, call: CliCall, text: string, code: number | null): Error {
  if (LIMIT_EXITS.has(code ?? 0) || PLAN_LIMIT.test(text)) return limitReached(cli, text)
  if (code === AUTH_EXIT || SIGNED_OUT.test(text)) return notSignedIn(cli, text)
  if (NO_MODEL.test(text)) return unknownModel(cli, call.model, text)
  return cliFailed(cli, text)
}

/** The JSON object in this output, which Gemini CLI pretty-prints over several lines, after any warnings. */
function jsonObject(output: string): Record<string, unknown> | undefined {
  const start = output.indexOf('{')
  if (start < 0) return undefined
  try {
    return record(JSON.parse(output.slice(start)))
  } catch {
    return undefined
  }
}

/** Reads one `gemini --output-format json` run: the answer on stdout, or a fatal error as JSON on stderr. */
export function readGeminiRun(cli: CliAdapter, call: CliCall, run: ProcessResult): CliAnswer {
  const result = jsonObject(run.stdout)
  const error = record(result?.error ?? jsonObject(run.stderr)?.error)
  if (!result || Object.keys(error).length > 0 || typeof result.response !== 'string') {
    const text = String(error.message ?? '') || run.stderr.trim() || (run.signal ? `stopped by ${run.signal}` : `exit code ${run.code}`)
    throw failure(cli, call, text, run.code)
  }
  const output = parseJsonText(result.response)
  if (output === undefined) throw invalidOutput(cli, 'the answer is not JSON')
  // One entry per model the run used (a router may add a small one); the judge is the one that wrote the most.
  const models = Object.entries(record(record(result.stats).models)).sort(
    ([, a], [, b]) => number(record(record(b).tokens).candidates) - number(record(record(a).tokens).candidates),
  )
  let inputTokens = 0
  let outputTokens = 0
  for (const [, stats] of models) {
    const tokens = record(record(stats).tokens)
    // prompt includes the cached part; thoughts are output, as the API providers count them.
    inputTokens += number(tokens.prompt)
    outputTokens += number(tokens.candidates) + number(tokens.thoughts)
  }
  return { output, inputTokens, outputTokens, modelId: models[0]?.[0] ?? call.model }
}

/** The sign-in Gemini CLI saved in ~/.gemini/settings.json; the credential files themselves are never opened. */
async function savedSignIn(): Promise<SignIn> {
  let settings: Record<string, unknown>
  try {
    settings = record(JSON.parse(await readFile(join(process.env.GEMINI_CLI_HOME || homedir(), '.gemini', 'settings.json'), 'utf8')))
  } catch {
    return { signedIn: undefined, subscription: undefined }
  }
  const selected = record(record(settings.security).auth).selectedType ?? settings.selectedAuthType
  if (typeof selected !== 'string') return { signedIn: undefined, subscription: undefined }
  if (API_AUTH.has(selected)) return { signedIn: true, subscription: false, detail: selected }
  return { signedIn: true, subscription: SUBSCRIPTION_AUTH.has(selected) ? true : undefined, detail: 'Google sign-in' }
}

/**
 * Google's Gemini CLI in headless mode (https://geminicli.com/docs/cli/headless/),
 * on its Google sign-in, which since 2026-06-18 serves Gemini Code Assist
 * Standard and Enterprise; Google AI Pro and Ultra moved to Antigravity CLI.
 * Gemini CLI takes no schema, so Rampa's instructions carry it and replace
 * the CLI's system prompt (GEMINI_SYSTEM_MD), and Rampa reads the JSON out of
 * the answer. The prompt goes through stdin; images go in as @file references
 * relative to the working directory, which Gemini CLI reads and sends inline.
 */
export const geminiCli: CliAdapter = {
  command: 'gemini',
  binEnv: 'RAMPA_GEMINI_BIN',
  name: 'Gemini CLI',
  plan: 'Gemini Code Assist',
  install: 'https://geminicli.com/docs/get-started/installation/',
  signInHint: 'run gemini and choose Sign in with Google',
  // An API key, Vertex AI or a gateway in the environment would bill per token instead of the sign-in.
  dropEnv: ['GEMINI_API_KEY', 'GOOGLE_API_KEY', 'GOOGLE_GENAI_USE_VERTEXAI', 'GOOGLE_GEMINI_BASE_URL'],
  setEnv: {
    // Headless runs exit in a folder that is not trusted, and only a trusted one reads the workspace settings above.
    GEMINI_CLI_TRUST_WORKSPACE: 'true',
    // An expired sign-in prints a URL instead of opening a browser from inside Rampa's run.
    NO_BROWSER: 'true',
  },

  signIn: () => savedSignIn(),

  async prepare(workdir) {
    await mkdir(join(workdir, '.gemini'), { recursive: true })
    await writeFile(join(workdir, '.gemini', 'settings.json'), `${JSON.stringify(WORKSPACE_SETTINGS, null, 2)}\n`, 'utf8')
  },

  async judge(call, exec) {
    const instructions = join(call.dir, 'system.md')
    await writeFile(instructions, withSchema(call.system, call.jsonSchema), 'utf8')
    const images = await writeImages(call)
    // Relative to the working directory, the only place Gemini CLI reads @ files from.
    const references = images.map((image) => `@${basename(call.dir)}/${basename(image)}`)
    const prompt = references.length > 0 ? `${call.user}\n\nThe image: ${references.join(' ')}` : call.user
    // No extensions, and an MCP allowlist that names no server.
    const args = ['--output-format', 'json', '--extensions', 'none', '--allowed-mcp-server-names', 'rampa-none']
    if (call.model) args.push('--model', call.model)
    return readGeminiRun(geminiCli, call, await exec(args, prompt, { env: { GEMINI_SYSTEM_MD: instructions } }))
  },
}

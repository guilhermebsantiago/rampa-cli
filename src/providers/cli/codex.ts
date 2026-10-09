import { readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { number, parseJsonLines, parseJsonText, record, writeImages } from './answer.ts'
import { cliFailed, invalidOutput, limitReached, notSignedIn, unknownModel } from './errors.ts'
import type { ProcessResult } from './process.ts'
import type { CliAdapter, CliAnswer, CliCall, SignIn } from './types.ts'

/** "You’ve hit your usage limit. Try again at …", and the per-model and quota variants. */
const PLAN_LIMIT = /hit your usage limit|usage limit|quota exceeded|rate limit|too many requests/i
const SIGNED_OUT = /not logged in|(?:log|sign) ?in again|please (?:log|sign) ?in|unauthorized|\b401\b|token (?:has )?expired|refresh token/i
const NO_MODEL = /model .*(?:not (?:found|supported|exist)|does not exist|unsupported)|unknown model|invalid model/i

function failure(cli: CliAdapter, call: CliCall, text: string): Error {
  if (PLAN_LIMIT.test(text)) return limitReached(cli, text)
  if (SIGNED_OUT.test(text)) return notSignedIn(cli, text)
  if (NO_MODEL.test(text)) return unknownModel(cli, call.model, text)
  return cliFailed(cli, text)
}

/** Reads the JSONL events of one `codex exec --json` run. */
export function readCodexRun(cli: CliAdapter, call: CliCall, run: ProcessResult): CliAnswer {
  const events = parseJsonLines(run.stdout)
  const failed = events.findLast((event) => event.type === 'turn.failed')
  const error = events.findLast((event) => event.type === 'error')
  const items = events.filter((event) => event.type === 'item.completed').map((event) => record(event.item))
  const message = items.findLast((item) => item.type === 'agent_message')
  const completed = events.findLast((event) => event.type === 'turn.completed')

  if (failed || !message) {
    const text =
      String(record(failed?.error).message ?? '') ||
      (typeof error?.message === 'string' ? error.message : '') ||
      run.stderr.replace(/^Reading prompt from stdin\.\.\.\s*/m, '').trim() ||
      (run.signal ? `stopped by ${run.signal}` : `exit code ${run.code}`)
    throw failure(cli, call, text)
  }
  const text = String(message.text ?? '')
  const output = parseJsonText(text)
  if (output === undefined) throw invalidOutput(cli, text ? 'the answer is not JSON' : 'no answer')
  // No event names the model, except a warning when Codex moves the run to another one.
  const rerouted = items.flatMap((item) => (item.type === 'error' ? [/model rerouted: \S+ -> (\S+)/.exec(String(item.message ?? ''))?.[1]] : [])).at(-1)
  const usage = record(completed?.usage)
  return {
    output,
    // In OpenAI's usage, the cached prompt is part of input_tokens and reasoning is part of output_tokens.
    inputTokens: number(usage.input_tokens),
    outputTokens: number(usage.output_tokens),
    modelId: rerouted ?? call.model,
  }
}

/**
 * Config overrides for one exec run (https://learn.chatgpt.com/docs/config-file/config-reference):
 * no shell, apps, plugins, hooks, subagents, image generation, web search or
 * image viewer, so a page that carries instructions cannot make the model
 * run anything, read files or reach the network; no project AGENTS.md; and
 * nothing written to the user's prompt history. Features an older Codex does
 * not know only log a warning.
 */
const ISOLATION = [
  'features.shell_tool=false',
  'features.unified_exec=false',
  'features.apps=false',
  'features.plugins=false',
  'features.hooks=false',
  'features.multi_agent=false',
  'features.image_generation=false',
  'web_search="disabled"',
  'tools.view_image=false',
  'project_doc_max_bytes=0',
  'history.persistence="none"',
].flatMap((override) => ['-c', override])

/**
 * --ignore-user-config also drops the user's choice of credential store, and
 * Codex would then look for its sign-in in auth.json only. This reads that one
 * setting back from config.toml, so a keyring sign-in is still found. It never
 * reads the credentials.
 */
async function credentialStore(): Promise<string | undefined> {
  try {
    const config = await readFile(join(process.env.CODEX_HOME || join(homedir(), '.codex'), 'config.toml'), 'utf8')
    // Top-level keys come before the first [table].
    const topLevel = config.split(/^\s*\[/m)[0] ?? ''
    return /^\s*cli_auth_credentials_store\s*=\s*["'](file|keyring|auto)["']/m.exec(topLevel)?.[1]
  } catch {
    return undefined
  }
}

/**
 * OpenAI's Codex CLI in exec mode (https://learn.chatgpt.com/docs/non-interactive-mode),
 * on the ChatGPT plan it is signed in to: a read-only sandbox in an empty
 * directory outside any repository, without the user's config.toml or rules,
 * with no tools and no saved session. Rampa's instructions go in as developer
 * instructions, next to Codex's own (a replaced base prompt may not be
 * accepted on a ChatGPT sign-in); the prompt goes through stdin, the schema
 * in a file (--output-schema) and each image in a file (--image=, which ends
 * that flag's list).
 */
export const codex: CliAdapter = {
  command: 'codex',
  binEnv: 'RAMPA_CODEX_BIN',
  // The standalone installer's place on Windows; npm puts codex on PATH.
  knownPaths: () =>
    process.platform === 'win32' && process.env.LOCALAPPDATA ? [join(process.env.LOCALAPPDATA, 'Programs', 'OpenAI', 'Codex', 'bin', 'codex.exe')] : [],
  name: 'Codex CLI',
  plan: 'ChatGPT',
  install: 'https://learn.chatgpt.com/docs/codex/cli',
  signInHint: 'run codex and sign in with ChatGPT',
  // CODEX_API_KEY bills the API ahead of the ChatGPT sign-in; OPENAI_API_KEY is not read by exec, but Rampa's .env may hold it.
  dropEnv: ['CODEX_API_KEY', 'OPENAI_API_KEY'],

  async signIn(exec): Promise<SignIn> {
    // codex login status writes to stderr: "Logged in using ChatGPT", "... using an API key - sk-proj-***", "Not logged in".
    const run = await exec(['login', 'status'], '')
    const text = `${run.stdout}\n${run.stderr}`
    if (/not logged in/i.test(text)) return { signedIn: false, subscription: undefined }
    if (!/logged in/i.test(text)) return { signedIn: run.code === 0 ? undefined : false, subscription: undefined }
    if (/using chatgpt/i.test(text)) return { signedIn: true, subscription: true, detail: 'ChatGPT' }
    if (/api key|bedrock|workload identity/i.test(text)) return { signedIn: true, subscription: false, detail: /bedrock/i.test(text) ? 'Amazon Bedrock' : 'an API key' }
    return { signedIn: true, subscription: undefined }
  },

  async judge(call, exec) {
    const schema = join(call.dir, 'schema.json')
    await writeFile(schema, JSON.stringify(call.jsonSchema), 'utf8')
    const images = await writeImages(call)
    const store = await credentialStore()
    const args = ['exec', '--json', '--color', 'never', '--skip-git-repo-check', '--ephemeral', '--ignore-user-config', '--ignore-rules']
    args.push('--sandbox', 'read-only', ...ISOLATION)
    // A JSON string is a valid TOML string: quotes, line breaks and Windows backslashes stay intact.
    args.push('-c', `developer_instructions=${JSON.stringify(call.system)}`, '--output-schema', schema)
    if (store) args.push('-c', `cli_auth_credentials_store="${store}"`)
    if (call.model) args.push('--model', call.model)
    if (call.effort) args.push('-c', `model_reasoning_effort="${call.effort}"`)
    for (const image of images) args.push(`--image=${image}`)
    return readCodexRun(codex, call, await exec(args, call.user))
  },
}

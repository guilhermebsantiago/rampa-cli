// A stand-in for the agent CLIs in tests: it answers in each CLI's wire format
// without a model or a network. STUB_MODE picks the behavior, and every run
// leaves a record in STUB_LOG_DIR (arguments, stdin, the environment it saw).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const ANSWER = { verdict: 'fail', evidence: 'IMG_2034.jpg', confidence: 'high' }

function readStdin() {
  try {
    return readFileSync(0, 'utf8')
  } catch {
    return ''
  }
}

function record(kind, args, stdin, started) {
  const dir = process.env.STUB_LOG_DIR
  if (!dir) return
  mkdirSync(dir, { recursive: true })
  const seen = {
    OPENAI_API_KEY: process.env.OPENAI_API_KEY !== undefined,
    CODEX_API_KEY: process.env.CODEX_API_KEY !== undefined,
    GEMINI_API_KEY: process.env.GEMINI_API_KEY !== undefined,
    GOOGLE_API_KEY: process.env.GOOGLE_API_KEY !== undefined,
    GEMINI_CLI_TRUST_WORKSPACE: process.env.GEMINI_CLI_TRUST_WORKSPACE,
    NO_BROWSER: process.env.NO_BROWSER,
    cwd: process.cwd(),
  }
  const files = {}
  const keep = (path, key = path) => {
    try {
      files[key] = readFileSync(path).toString('base64')
    } catch {
      files[key] = null
    }
  }
  // The files a CLI is pointed at only exist during the call, so the stub keeps their contents.
  for (const [index, arg] of args.entries()) {
    if (['--output-schema', '--image', '-i'].includes(args[index - 1] ?? '')) keep(arg)
    if (arg.startsWith('--image=')) for (const path of arg.slice('--image='.length).split(',')) keep(path, `image:${path}`)
    if (args[index - 1] === '-c' && arg.startsWith('developer_instructions=')) {
      files.developer_instructions = Buffer.from(JSON.parse(arg.slice(arg.indexOf('=') + 1))).toString('base64')
    }
  }
  // Gemini CLI reads @file references in the prompt, relative to its working directory.
  for (const match of stdin.matchAll(/@(\S+)/g)) keep(join(process.cwd(), match[1]), `@${match[1]}`)
  if (process.env.GEMINI_SYSTEM_MD) keep(process.env.GEMINI_SYSTEM_MD, 'GEMINI_SYSTEM_MD')
  if (kind === 'gemini') keep(join(process.cwd(), '.gemini', 'settings.json'), 'workspace-settings')
  writeFileSync(join(dir, `${started}-${process.pid}.json`), JSON.stringify({ kind, args, stdin, seen, files, started, ended: Date.now() }))
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const answer = () => (process.env.STUB_ANSWER ? JSON.parse(process.env.STUB_ANSWER) : ANSWER)
const line = (event) => process.stdout.write(`${JSON.stringify(event)}\n`)

async function codex(args, stdin) {
  const mode = process.env.STUB_MODE ?? 'success'
  if (mode === 'hang') await sleep(60_000)
  if (mode === 'slow') await sleep(Number(process.env.STUB_DELAY ?? 300))
  if (mode === 'bad-flag') {
    // An option this version does not know stops it before any event.
    process.stderr.write("error: unexpected argument '--ignore-rules' found\n")
    return 2
  }
  line({ type: 'thread.started', thread_id: 'thread_1' })
  line({ type: 'turn.started' })
  switch (mode) {
    case 'limit':
      line({ type: 'error', message: "You've hit your usage limit. Upgrade to Pro or try again in 3 hours." })
      line({ type: 'turn.failed', error: { message: "You've hit your usage limit. Upgrade to Pro or try again in 3 hours." } })
      return 1
    case 'signed-out':
      line({ type: 'turn.failed', error: { message: 'unexpected status 401 Unauthorized: Your access token could not be refreshed. Please log out and sign in again.' } })
      return 1
    case 'bad-model':
      line({ type: 'turn.failed', error: { message: "unexpected status 400 Bad Request: The 'gpt-nope' model is not supported when using Codex with a ChatGPT account." } })
      return 1
  }
  const output = mode === 'wrong-shape' ? { verdict: 'maybe' } : answer()
  line({ type: 'item.completed', item: { id: 'item_0', type: 'reasoning', text: '**Judging**' } })
  line({ type: 'item.completed', item: { id: 'item_1', type: 'agent_message', text: mode === 'not-json' ? 'I think it fails.' : JSON.stringify(output) } })
  line({ type: 'turn.completed', usage: { input_tokens: 1500, cached_input_tokens: 1200, output_tokens: 120 } })
  return 0
}

async function codexMeta(args) {
  if (args.includes('--version')) {
    process.stdout.write('codex-cli 0.99.0\n')
    return 0
  }
  if (args[0] === 'login' && args[1] === 'status') {
    const auth = process.env.STUB_AUTH ?? 'chatgpt'
    if (auth === 'none') {
      process.stderr.write('Not logged in\n')
      return 1
    }
    process.stderr.write(auth === 'api_key' ? 'Logged in using an API key - sk-proj-***ABCD\n' : 'Logged in using ChatGPT\n')
    return 0
  }
  return undefined
}

async function gemini(args, stdin) {
  const mode = process.env.STUB_MODE ?? 'success'
  if (mode === 'hang') await sleep(60_000)
  // Fatal errors go to stderr as JSON, and the exit code is the error's: 41 for auth, the HTTP status for API errors.
  const fatal = (type, message, code) => {
    process.stderr.write(`${JSON.stringify({ session_id: 'session_1', error: { type, message, code } }, null, 2)}\n`)
    return code
  }
  switch (mode) {
    case 'limit':
      return fatal('Error', 'You have exhausted your daily quota on this model.', 429)
    case 'signed-out':
      return fatal('FatalAuthenticationError', 'Please set an Auth method in your settings.json or specify one of the following environment variables: GEMINI_API_KEY, GOOGLE_GENAI_USE_VERTEXAI, GOOGLE_GENAI_USE_GCA', 41)
    case 'bad-model':
      return fatal('Error', 'Requested entity was not found: models/gemini-nope is not found for API version v1beta.', 404)
    case 'blocked':
      process.stdout.write(`${JSON.stringify({ session_id: 'session_1', response: '', stats: {}, error: { type: 'INVALID_STREAM', message: 'Model stream ended with an empty response.' } }, null, 2)}\n`)
      return 0
  }
  const output = mode === 'wrong-shape' ? { verdict: 'maybe' } : answer()
  const response = mode === 'not-json' ? 'It fails.' : `\`\`\`json\n${JSON.stringify(output)}\n\`\`\``
  const tokens = (prompt, candidates, thoughts) => ({ input: prompt - 100, prompt, candidates, total: prompt + candidates + thoughts, cached: 100, thoughts, tool: 0 })
  process.stdout.write(
    `${JSON.stringify(
      {
        session_id: 'session_1',
        response,
        stats: {
          models: {
            // A router call on a small model, then the judge.
            'gemini-3.5-flash-lite': { api: { totalRequests: 1, totalErrors: 0, totalLatencyMs: 200 }, tokens: tokens(200, 5, 0) },
            'gemini-3.5-flash': { api: { totalRequests: 1, totalErrors: 0, totalLatencyMs: 900 }, tokens: tokens(1000, 80, 50) },
          },
          tools: { totalCalls: 0 },
        },
      },
      null,
      2,
    )}\n`,
  )
  return 0
}

async function geminiMeta(args) {
  if (args.includes('--version')) {
    process.stdout.write('0.99.0\n')
    return 0
  }
  return undefined
}

export async function run(kind) {
  const args = process.argv.slice(2)
  const started = Date.now()
  const meta = await { codex: codexMeta, gemini: geminiMeta }[kind]?.(args)
  if (meta !== undefined) {
    record(kind, args, '', started)
    process.exit(meta)
  }
  const stdin = readStdin()
  const handlers = { codex, gemini }
  const handler = handlers[kind]
  const code = handler ? await handler(args, stdin) : 2
  record(kind, args, stdin, started)
  process.exit(code)
}

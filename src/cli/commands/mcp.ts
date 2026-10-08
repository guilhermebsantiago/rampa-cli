import { serveStdio } from '@modelcontextprotocol/server/stdio'
import { fileCache } from '../../core/cache.ts'
import { errorMessage } from '../../core/util.ts'
import { tolerantCache } from '../../mcp/check.ts'
import { createMcpServer } from '../../mcp/server.ts'
import type { Reasoning } from '../../providers/ai-sdk.ts'
import { chooseModel } from '../../providers/detect.ts'
import { VERSION } from '../../version.ts'
import type { GlobalContext } from '../context.ts'

export interface McpCommandOptions {
  model?: string
  llm: boolean
  offline?: boolean
  reasoning?: Reasoning
  cacheDir: string
  concurrency: string
}

const log = (line: string) => {
  process.stderr.write(`${line}\n`)
}

/** Serves the check tools over stdio until the client closes stdin. */
export async function runMcp(options: McpCommandOptions, context: GlobalContext): Promise<number> {
  // stdout carries the protocol and nothing else: whatever a dependency prints goes to stderr.
  console.log = console.info = console.debug = (...args: unknown[]) => console.error(...args)

  const server = () =>
    createMcpServer({
      model: options.model,
      llm: options.llm,
      locale: context.locale,
      offline: Boolean(options.offline),
      reasoning: options.reasoning ?? context.config.reasoning,
      cache: tolerantCache(fileCache(options.cacheDir), log),
      concurrency: Math.max(1, Number.parseInt(options.concurrency, 10) || 4),
      chooseModel: (requested) => chooseModel(requested, context.config.model),
      log,
    })
  serveStdio(server, { onerror: (error) => log(`rampa mcp: ${errorMessage(error)}`) })

  const judgment = !options.llm ? 'off by default (no_llm)' : options.model ? `model ${options.model}` : 'model chosen per call, as in rampa check'
  log(`rampa ${VERSION} MCP server on stdio · judgment ${judgment}${options.offline ? ', cached judgments only' : ''} · cache ${options.cacheDir}`)
  if (process.stdin.isTTY) log('It speaks the Model Context Protocol on stdin and stdout: register it in an MCP client (see docs/mcp.md). Ctrl+C stops it.')
  return 0
}

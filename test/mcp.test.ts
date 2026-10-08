import { spawn } from 'node:child_process'
import { readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { Client, InMemoryTransport } from '@modelcontextprotocol/client'
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { fileCache, memoryCache } from '../src/core/cache.ts'
import { CRITERIA, DEFAULT_CRITERIA } from '../src/criteria/index.ts'
import { type AgentDefaults, tolerantCache } from '../src/mcp/check.ts'
import type { CriteriaList, Explanation } from '../src/mcp/explain.ts'
import type { CheckResult } from '../src/mcp/format.ts'
import { createMcpServer, withBase } from '../src/mcp/server.ts'
import { launchBrowser } from '../src/surfaces/web.ts'

// The recorded store page replays Gemma 4 12B's judgments from demo/recorded/cache: no browser, no model, no network.
const STORE = resolve('demo/recorded/examples-store-before.snapshot.json')
const RECORDED_CACHE = resolve('demo/recorded/cache')
const SERVER_ARGS = ['--locale', 'en', 'mcp', '--offline', '--model', 'ollama:gemma4:12b', '--cache-dir', 'demo/recorded/cache']

function defaults(extra: Partial<AgentDefaults> = {}): AgentDefaults {
  return {
    model: 'ollama:gemma4:12b',
    llm: true,
    locale: 'en',
    offline: true,
    cache: fileCache(RECORDED_CACHE),
    concurrency: 4,
    chooseModel: async (requested) => requested,
    log: () => undefined,
    ...extra,
  }
}

async function connect(options: AgentDefaults = defaults()) {
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair()
  const server = createMcpServer(options)
  await server.connect(serverSide)
  const client = new Client({ name: 'rampa-test', version: '0' })
  await client.connect(clientSide)
  return { client, close: () => client.close() }
}

type ToolResult = Awaited<ReturnType<Client['callTool']>>

function textOf(result: ToolResult): string {
  return result.content.map((block) => (block.type === 'text' ? block.text : '')).join('\n')
}

describe('rampa mcp tools', () => {
  let session: Awaited<ReturnType<typeof connect>>
  beforeAll(async () => {
    session = await connect()
  })
  afterAll(async () => session.close())

  it('lists four read-only tools with input and output schemas', async () => {
    const { tools } = await session.client.listTools()
    expect(tools.map((tool) => tool.name).sort()).toEqual(['check_html', 'check_page', 'explain_finding', 'list_criteria'])
    const checkPage = tools.find((tool) => tool.name === 'check_page')
    expect(checkPage?.inputSchema.required).toEqual(['target'])
    expect(Object.keys(checkPage?.inputSchema.properties ?? {})).toEqual(['target', 'criteria', 'model', 'no_llm', 'locale', 'runs', 'min_confidence'])
    for (const tool of tools) {
      expect(tool.outputSchema).toBeDefined()
      expect(tool.annotations?.readOnlyHint).toBe(true)
    }
    expect(session.client.getServerVersion()?.name).toBe('rampa')
    expect(session.client.getInstructions()).toContain('Rampa never says a page is accessible')
  })

  it('lists what Rampa judges, the default set and who checks each WCAG criterion', async () => {
    const result = await session.client.callTool({ name: 'list_criteria', arguments: {} })
    const list = result.structuredContent as CriteriaList
    expect(list.judged.map((c) => c.id)).toEqual([...CRITERIA.keys()])
    expect(list.default_criteria).toEqual(DEFAULT_CRITERIA)
    expect(list.judged.find((c) => c.id === '1.1.1')).toMatchObject({ level: 'A', needs_vision: true, default: true })
    expect(list.wcag).toHaveLength(50)
    const checkedBy = (id: string) => list.wcag.find((sc) => sc.id === id)?.checked_by
    expect(checkedBy('1.1.1')).toEqual(['axe-core', 'rampa judgment'])
    expect(checkedBy('1.4.3')).toEqual(['axe-core'])
    expect(checkedBy('2.4.7')).toEqual([])
    expect(textOf(result)).toContain('never declares a page accessible')
  })

  it('checks the recorded store page: nine findings with evidence, patches and coverage, from the cache', async () => {
    const result = await session.client.callTool({ name: 'check_page', arguments: { target: STORE } })
    expect(result.isError).toBeFalsy()
    const check = result.structuredContent as CheckResult
    expect(check.findings.map((f) => f.criterion)).toEqual(['1.1.1', '1.1.1', '1.1.1', '1.1.1', '2.4.2', '2.4.4', '2.4.6', '2.4.6', '3.1.2'])
    expect(check.summary).toMatchObject({ findings: 9, from_engine: 1, judged: 8, discarded_claims: 0 })
    expect(check.findings[0]).toMatchObject({ source: 'engine', rule_id: 'image-alt', selector: 'html > body > header > img' })
    expect(check.findings[0]?.how_to_fix).toMatch(/^Fix any of the following: Element does not have an alt attribute;/)
    expect(check.findings[1]).toMatchObject({
      source: 'judgment',
      level: 'A',
      evidence: 'IMG_2034.jpg',
      confidence: 'high',
      patch: { kind: 'set-attribute', attribute: 'alt', before: '<img src="mug.svg" alt="IMG_2034.jpg">' },
    })
    expect(check.coverage.judged).toEqual(DEFAULT_CRITERIA)
    expect(check.coverage.not_checked.length).toBeGreaterThan(30)
    expect(check.coverage.statement).toBe('This report does not declare the page accessible. What was not checked needs manual review and testing with people.')
    expect(check.usage).toMatchObject({ model_calls: 0, cached_calls: 13, estimated_cost_usd: 0 })
    const text = textOf(result)
    expect(text).toContain('9 finding(s): 1 from axe-core, 8 judged with verified evidence.')
    expect(text).toContain('+ <blockquote lang="nl">')
    expect(text).toContain('This report does not declare the page accessible.')
    expect(text).toContain('show them to a person before they ship')
  })

  it('sends progress notifications that grow up to the total', async () => {
    const updates: Array<{ progress: number; total?: number | undefined }> = []
    await session.client.callTool({ name: 'check_page', arguments: { target: STORE } }, { onprogress: (update) => updates.push(update) })
    expect(updates.length).toBeGreaterThanOrEqual(2)
    expect(updates.map((u) => u.progress)).toEqual([...updates.map((u) => u.progress)].sort((a, b) => a - b))
    const last = updates.at(-1)
    expect(last?.progress).toBe(last?.total)
  })

  it('reports in Portuguese when asked', async () => {
    const result = await session.client.callTool({ name: 'check_page', arguments: { target: STORE, locale: 'pt-BR' } })
    const text = textOf(result)
    expect(text).toContain('O texto alternativo "IMG_2034.jpg" é um nome de arquivo ou um placeholder.')
    expect(text).toContain('Este relatório não declara a página acessível.')
  })

  it('runs only axe-core with no_llm and says what it skipped', async () => {
    const result = await session.client.callTool({ name: 'check_page', arguments: { target: STORE, no_llm: true } })
    const check = result.structuredContent as CheckResult
    expect(check.judgment).toBe('off')
    expect(check.findings.map((f) => f.source)).toEqual(['engine'])
    expect(check.summary.not_judged).toBe(13)
    expect(check.coverage.judged).toEqual([])
    expect(check.notes[0]).toMatch(/^Judgment skipped \(no_llm\): 13 candidate\(s\)/)
  })

  it('judges only the criteria asked for', async () => {
    const result = await session.client.callTool({ name: 'check_page', arguments: { target: STORE, criteria: ['3.1.2'] } })
    const check = result.structuredContent as CheckResult
    expect(check.coverage.judged).toEqual(['3.1.2'])
    expect(check.findings.filter((f) => f.source === 'judgment').map((f) => f.criterion)).toEqual(['3.1.2'])
  })

  it('turns a missing target into an error the agent can act on', async () => {
    const result = await session.client.callTool({ name: 'check_page', arguments: { target: 'nowhere/missing.html' } })
    expect(result.isError).toBe(true)
    expect(textOf(result)).toMatch(/^Target not found: nowhere\/missing\.html \(looked for .*\). Pass an absolute path/)
  })

  it('checks one page per call', async () => {
    const result = await session.client.callTool({ name: 'check_page', arguments: { target: 'examples/store' } })
    expect(result.isError).toBe(true)
    expect(textOf(result)).toContain('is a folder with 2 .html files, and a call checks one page')
  })

  it('rejects arguments outside the schema before running anything', async () => {
    const result = await session.client.callTool({ name: 'check_page', arguments: { target: STORE, runs: 9, criteria: ['9.9.9'] } })
    expect(result.isError).toBe(true)
    expect(textOf(result)).toContain('Input validation error')
  })

  it('explains a finding from this session', async () => {
    const check = (await session.client.callTool({ name: 'check_page', arguments: { target: STORE } })).structuredContent as CheckResult
    const finding = check.findings.find((f) => f.evidence === 'IMG_2034.jpg')
    const result = await session.client.callTool({ name: 'explain_finding', arguments: { finding_id: finding?.id } })
    const explanation = result.structuredContent as Explanation
    expect(explanation.criterion).toMatchObject({
      id: '1.1.1',
      judged_by_rampa: true,
      understanding_url: 'https://www.w3.org/WAI/WCAG21/Understanding/non-text-content.html',
    })
    expect(explanation.wcag_text).toMatch(/^All non-text content that is presented to the user has a text alternative/)
    expect(explanation.finding?.target).toBe('examples/store/before.html')
    expect(explanation.finding?.fix).toMatch(/^Replace <img src="mug.svg" alt="IMG_2034.jpg"> with <img src="mug.svg" alt="[^"]+">\. The suggested text/)
    expect(textOf(result)).toContain(`Finding ${finding?.id} on examples/store/before.html:`)
  })

  it('explains a criterion Rampa does not judge, from axe-core and the W3C', async () => {
    const result = await session.client.callTool({ name: 'explain_finding', arguments: { criterion: '1.4.3' } })
    const explanation = result.structuredContent as Explanation
    expect(explanation.criterion).toMatchObject({ name: 'Contrast (Minimum)', level: 'AA', judged_by_rampa: false })
    expect(explanation.criterion.axe_rules).toContain('color-contrast')
    expect(explanation.how_to_fix.join(' ')).toContain('https://www.w3.org/WAI/WCAG21/Understanding/contrast-minimum.html')
  })

  it('says what to pass when explain_finding cannot tell what to explain', async () => {
    const unknown = await session.client.callTool({ name: 'explain_finding', arguments: { finding_id: 'feedfacecafe' } })
    expect(unknown.isError).toBe(true)
    expect(textOf(unknown)).toContain('No finding feedfacecafe in this session')
    const fallback = await session.client.callTool({ name: 'explain_finding', arguments: { finding_id: 'feedfacecafe', criterion: '2.4.4' } })
    expect(fallback.isError).toBeFalsy()
    expect(textOf(fallback)).toMatch(/^No finding feedfacecafe in this session; this explains 2\.4\.4\./)
    const empty = await session.client.callTool({ name: 'explain_finding', arguments: {} })
    expect(textOf(empty)).toContain('Pass finding_id')
    const bogus = await session.client.callTool({ name: 'explain_finding', arguments: { criterion: '9.9.9' } })
    expect(textOf(bogus)).toContain('Unknown criterion 9.9.9')
  })
})

describe('rampa mcp defaults', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('lets a call turn judgment back on when the server started with --no-llm', async () => {
    const { client, close } = await connect(defaults({ llm: false }))
    const off = (await client.callTool({ name: 'check_page', arguments: { target: STORE } })).structuredContent as CheckResult
    const on = (await client.callTool({ name: 'check_page', arguments: { target: STORE, no_llm: false } })).structuredContent as CheckResult
    await close()
    expect(off.judgment).toBe('off')
    expect(on.judgment).toBe('on')
    expect(on.findings).toHaveLength(9)
  })

  it('says how to get a model when none is available', async () => {
    const { client, close } = await connect(defaults({ model: undefined, offline: false, chooseModel: async () => undefined }))
    const result = await client.callTool({ name: 'check_page', arguments: { target: STORE } })
    await close()
    expect(result.isError).toBe(true)
    expect(textOf(result)).toMatch(/^No model is available for the judgment layer/)
    expect(textOf(result)).toContain('or pass no_llm: true to run only axe-core')
  })

  it('rejects a model that is not provider:model', async () => {
    const { client, close } = await connect()
    const result = await client.callTool({ name: 'check_page', arguments: { target: STORE, model: 'gemma' } })
    await close()
    expect(result.isError).toBe(true)
    expect(textOf(result)).toContain('Model must be provider:model')
    expect(textOf(result)).toContain('no_llm: true')
  })

  it('says Ollama is down before calling it', async () => {
    vi.stubGlobal('fetch', async () => {
      throw new Error('connect ECONNREFUSED 127.0.0.1:11434')
    })
    const { client, close } = await connect(defaults({ offline: false, cache: memoryCache() }))
    const result = await client.callTool({ name: 'check_page', arguments: { target: STORE } })
    await close()
    expect(result.isError).toBe(true)
    expect(textOf(result)).toMatch(/^Ollama is not reachable at http:\/\/localhost:11434, so ollama:gemma4:12b cannot judge/)
  })

  it('keeps judging when the cache cannot be written, and says so once', async () => {
    const lines: string[] = []
    const cache = tolerantCache(
      {
        get: async () => undefined,
        set: async () => {
          throw new Error('EACCES: permission denied')
        },
      },
      (line) => lines.push(line),
    )
    const value = { output: {}, inputTokens: 1, outputTokens: 1, latencyMs: 1, modelId: 'x', createdAt: '' }
    await cache.set('a', value)
    await cache.set('b', value)
    expect(lines).toEqual(['rampa mcp: judgments are not being cached (EACCES: permission denied); pass --cache-dir with a writable folder.'])
  })
})

describe('check_html', () => {
  it('puts <base> where the parser keeps it in the head', () => {
    const base = 'https://example.com/shop/'
    expect(withBase('<!doctype html><html><head><title>T</title></head></html>', base)).toBe(
      '<!doctype html><html><head><base href="https://example.com/shop/"><title>T</title></head></html>',
    )
    expect(withBase('<!DOCTYPE html><html lang="en"><body></body></html>', base)).toBe(
      '<!DOCTYPE html><html lang="en"><base href="https://example.com/shop/"><body></body></html>',
    )
    expect(withBase('<!doctype html><p>Hi</p>', base)).toBe('<!doctype html><base href="https://example.com/shop/"><p>Hi</p>')
    expect(withBase('<header>Hi</header>', base)).toBe('<base href="https://example.com/shop/"><header>Hi</header>')
    expect(withBase('<head><base href="/x/"></head>', base)).toBe('<head><base href="/x/"></head>')
  })

  it('rejects a base_url that is not a URL or an absolute folder', async () => {
    const { client, close } = await connect()
    const result = await client.callTool({ name: 'check_html', arguments: { html: '<p>Hi</p>', base_url: 'shop/', no_llm: true } })
    await close()
    expect(result.isError).toBe(true)
    expect(textOf(result)).toContain('base_url must be an http(s) URL, a file URL or an absolute folder path')
  })
})

// Integration: needs Chrome or Edge (or Playwright's Chromium). Skipped when none is installed.
const browser = await launchBrowser().catch(() => undefined)
await browser?.close()

describe.skipIf(!browser)('check_html in a browser', { timeout: 30_000 }, () => {
  it('checks markup in hand and leaves no temporary file behind', async () => {
    const before = (await readdir(tmpdir())).filter((name) => name.startsWith('rampa-mcp-'))
    const { client, close } = await connect()
    const html = '<!doctype html><html lang="en"><head><title>Order history</title></head><body><main><img src="logo.png"></main></body></html>'
    const result = await client.callTool({ name: 'check_html', arguments: { html, no_llm: true } })
    await close()
    const check = result.structuredContent as CheckResult
    expect(check.target).toBe('inline HTML')
    expect(check.findings.map((f) => f.rule_id)).toContain('image-alt')
    const after = (await readdir(tmpdir())).filter((name) => name.startsWith('rampa-mcp-'))
    expect(after).toEqual(before)
  })
})

describe('rampa mcp over stdio', { timeout: 30_000 }, () => {
  it('serves an MCP client that starts it as a child process', async () => {
    const transport = new StdioClientTransport({ command: process.execPath, args: [resolve('src/cli.ts'), ...SERVER_ARGS], cwd: process.cwd(), stderr: 'pipe' })
    const client = new Client({ name: 'rampa-test', version: '0' })
    await client.connect(transport)
    const { tools } = await client.listTools()
    const result = await client.callTool({ name: 'check_page', arguments: { target: 'demo/recorded/examples-store-before.snapshot.json' } })
    await client.close()
    expect(tools).toHaveLength(4)
    expect((result.structuredContent as CheckResult).findings).toHaveLength(9)
  })

  it('writes nothing but protocol messages to stdout, and exits when stdin closes', async () => {
    const child = spawn(process.execPath, [resolve('src/cli.ts'), ...SERVER_ARGS], { cwd: process.cwd(), stdio: ['pipe', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => {
      stdout += chunk
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk
    })
    const send = (message: object) => child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`)
    const answered = (id: number) =>
      new Promise<void>((done) => {
        const check = () => (stdout.includes(`"id":${id}`) ? done() : setTimeout(check, 20))
        check()
      })
    send({ id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'raw', version: '0' } } })
    await answered(1)
    send({ method: 'notifications/initialized' })
    send({ id: 2, method: 'tools/call', params: { name: 'check_page', arguments: { target: 'demo/recorded/examples-store-before.snapshot.json' }, _meta: { progressToken: 7 } } })
    await answered(2)
    child.stdin.end()
    const code = await new Promise<number | null>((done) => child.on('exit', done))
    const lines = stdout.split('\n').filter((line) => line.trim() !== '')
    const messages = lines.map((line) => JSON.parse(line) as { jsonrpc: string; method?: string })
    expect(messages.every((message) => message.jsonrpc === '2.0')).toBe(true)
    expect(messages.filter((message) => message.method === 'notifications/progress').length).toBeGreaterThan(0)
    expect(stderr).toContain('MCP server on stdio')
    expect(code).toBe(0)
  })
})

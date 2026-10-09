import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough, Readable } from 'node:stream'
import { describe, expect, it } from 'vitest'
import {
  type ConfigFormat,
  IGNORED,
  configSource,
  defaultConfigFormat,
  defaultSettings,
  detectTargets,
  gitignoreChanges,
  runInitSteps,
  suggestModel,
  workflowSource,
} from '../src/adoption/init.ts'
import { interview } from '../src/cli/commands/init.ts'
import { loadConfig } from '../src/config.ts'

async function project(files: Record<string, string> = {}): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'rampa-init-'))
  for (const [name, content] of Object.entries(files)) {
    await mkdir(join(dir, name, '..'), { recursive: true })
    await writeFile(join(dir, name), content, 'utf8')
  }
  return dir
}

const read = (dir: string, name: string) => readFile(join(dir, name), 'utf8')
const settings = (format: ConfigFormat, extra = {}) => defaultSettings({ format, targets: ['dist'], ...extra })

describe('rampa init', () => {
  it('picks a config file this Node and this package can load', async () => {
    const strips = Boolean((process.features as { typescript?: unknown }).typescript)
    expect(await defaultConfigFormat(await project({ 'package.json': '{"type":"module"}' }))).toBe(strips ? 'ts' : 'mjs')
    // A .ts file in a CommonJS package fails on export default; in one without "type" it is parsed twice.
    expect(await defaultConfigFormat(await project({ 'package.json': '{"type":"commonjs"}' }))).toBe(strips ? 'mts' : 'mjs')
    expect(await defaultConfigFormat(await project({ 'package.json': '{"name":"site"}' }))).toBe(strips ? 'mts' : 'mjs')
  })

  it.each(['ts', 'mts', 'mjs', 'json'] as const)('writes a %s config that loads with the chosen settings', async (format) => {
    const dir = await project({ 'package.json': format === 'ts' ? '{"type":"module"}' : '{"name":"site"}' })
    const chosen = settings(format, { model: 'ollama:gemma4:12b', locale: 'pt-BR', criteria: ['1.1.1', '3.1.2'], minConfidence: 'high' })
    const result = await runInitSteps(dir, chosen, { force: false })
    expect(result.warnings).toEqual([])
    const { config, path } = await loadConfig(dir)
    expect(path).toBe(join(dir, `rampa.config.${format}`))
    expect(config).toEqual({ targets: ['dist'], model: 'ollama:gemma4:12b', criteria: ['1.1.1', '3.1.2'], minConfidence: 'high', locale: 'pt-BR' })
  })

  it('suggests the model and the baseline in comments, without pinning them', () => {
    const source = configSource(settings('ts'), { typed: false, suggestedModel: 'lmstudio:qwen3.5-9b' })
    expect(source).toContain("  // model: 'lmstudio:qwen3.5-9b',")
    expect(source).toContain("  // baseline: '.rampa/baseline.json',")
    expect(source).not.toContain('import')
    const typed = configSource(settings('ts'), { typed: true })
    expect(typed).toContain("import { defineConfig } from 'rampa'")
    expect(typed).toContain('export default defineConfig({')
    expect(configSource(settings('ts', { targets: [] }), { typed: false })).toContain("  // targets: ['dist', 'http://localhost:3000/'],")
  })

  it('creates the config, an empty waivers file, the .gitignore lines and the workflow', async () => {
    const dir = await project({ 'package.json': '{"type":"module"}' })
    const result = await runInitSteps(dir, settings('ts', { github: true }), { force: false })
    expect(result.steps.map((step) => `${step.action} ${step.path}`)).toEqual([
      'created rampa.config.ts',
      'created .rampa/waivers.json',
      'created .gitignore',
      'created .github/workflows/rampa.yml',
    ])
    expect(JSON.parse(await read(dir, '.rampa/waivers.json'))).toEqual([])
    expect(await read(dir, '.gitignore')).toBe(`# Rampa: local files. Commit .rampa/waivers.json and .rampa/baseline.json.\n${IGNORED.join('\n')}\n`)
    expect(await read(dir, '.github/workflows/rampa.yml')).toContain('uses: guilhermebsantiago/rampa-cli@main')
  })

  it('replaces nothing that exists without --force, and never the waivers', async () => {
    const dir = await project({ 'package.json': '{"type":"module"}' })
    await runInitSteps(dir, settings('ts', { github: true }), { force: false })
    await writeFile(join(dir, 'rampa.config.ts'), 'export default { targets: ["mine"] }\n')
    await writeFile(join(dir, '.rampa/waivers.json'), '["5f085d8a3b9c"]\n')
    await writeFile(join(dir, '.github/workflows/rampa.yml'), 'name: mine\n')
    const gitignore = await read(dir, '.gitignore')

    const again = await runInitSteps(dir, settings('ts', { github: true }), { force: false })
    expect(again.steps.map((step) => step.action)).toEqual(['kept', 'kept', 'kept', 'kept'])
    expect(await read(dir, 'rampa.config.ts')).toBe('export default { targets: ["mine"] }\n')
    expect(await read(dir, '.gitignore')).toBe(gitignore)

    const forced = await runInitSteps(dir, settings('ts', { github: true }), { force: true })
    expect(forced.steps.map((step) => `${step.action} ${step.path}`)).toEqual([
      'overwritten rampa.config.ts',
      'kept .rampa/waivers.json',
      'kept .gitignore',
      'overwritten .github/workflows/rampa.yml',
    ])
    expect(await read(dir, '.rampa/waivers.json')).toBe('["5f085d8a3b9c"]\n')
  })

  it('keeps a config of another type, and with --force says which one Rampa reads', async () => {
    const dir = await project({ 'package.json': '{"type":"module"}', 'rampa.config.json': '{"targets":["old"]}' })
    const kept = await runInitSteps(dir, settings('ts'), { force: false })
    expect(kept.steps[0]).toMatchObject({ path: 'rampa.config.json', action: 'kept' })
    const forced = await runInitSteps(dir, settings('ts'), { force: true })
    expect(forced.steps[0]).toMatchObject({ path: 'rampa.config.ts', action: 'created' })
    expect(forced.warnings).toEqual(['rampa.config.json also exists; Rampa now reads rampa.config.ts instead, so remove rampa.config.json.'])
    expect((await loadConfig(dir)).config.targets).toEqual(['dist'])
  })

  it('adds only the missing .gitignore lines, and warns when the whole .rampa folder is ignored', async () => {
    expect(gitignoreChanges('node_modules\n/.rampa/cache/\n.rampa/runs').missing).toEqual(['.rampa/screenshots', '.rampa/act'])
    expect(gitignoreChanges('.rampa/\n').ignoresAll).toBe(true)
    expect(gitignoreChanges('.rampa/*\n').ignoresAll).toBe(true)
    expect(gitignoreChanges('.rampa/*\n!.rampa/waivers.json\n').ignoresAll).toBe(false)

    const dir = await project({ '.gitignore': 'node_modules\n.rampa/', 'package.json': '{"type":"module"}' })
    const result = await runInitSteps(dir, settings('ts'), { force: false })
    expect(await read(dir, '.gitignore')).toBe(`node_modules\n.rampa/\n\n# Rampa: local files. Commit .rampa/waivers.json and .rampa/baseline.json.\n${IGNORED.join('\n')}\n`)
    expect(result.warnings.join(' ')).toMatch(/ignores all of \.rampa/)

    const windows = await project({ '.gitignore': 'node_modules\r\n', 'package.json': '{"type":"module"}' })
    await runInitSteps(windows, settings('ts'), { force: false })
    expect(await read(windows, '.gitignore')).toBe(`node_modules\r\n\r\n# Rampa: local files. Commit .rampa/waivers.json and .rampa/baseline.json.\r\n${IGNORED.join('\r\n')}\r\n`)
  })

  it('finds a build folder with HTML to suggest as the target', async () => {
    expect(await detectTargets(await project({ 'build/docs/index.html': '<p>hi</p>', 'dist/app.js': '' }))).toEqual(['build'])
    expect(await detectTargets(await project({ 'src/index.ts': '' }))).toEqual([])
  })

  it('suggests a local model, and says when rampa check would pick it by itself', () => {
    const none = { reachable: false, models: [] }
    expect(suggestModel({ ollama: { reachable: true, models: ['gemma4:12b'] }, lmStudio: none }, 'ollama:gemma4:12b')).toMatchObject({
      spec: 'ollama:gemma4:12b',
      automatic: true,
    })
    expect(suggestModel({ ollama: none, lmStudio: { reachable: true, models: ['qwen3.5-9b'] } }, undefined)).toMatchObject({
      spec: 'lmstudio:qwen3.5-9b',
      automatic: false,
    })
    expect(suggestModel({ ollama: { reachable: true, models: ['llama3:8b'] }, lmStudio: none }, undefined)).toMatchObject({ spec: 'ollama:llama3:8b', automatic: false })
    expect(suggestModel({ ollama: { reachable: true, models: [] }, lmStudio: none }, undefined).note).toMatch(/ollama pull gemma4:12b/)
    expect(suggestModel({ ollama: none, lmStudio: none }, 'anthropic:claude-haiku-5-5').note).toMatch(/uses anthropic:claude-haiku-5-5/)
    const nothing = suggestModel({ ollama: none, lmStudio: none }, undefined)
    expect(nothing.spec).toBeUndefined()
    expect(nothing.note).toMatch(/only axe-core runs/)
  })

  it('asks each setting with the detected value as the default', async () => {
    const input = Readable.from(['\n', 'lmstudio:qwen3.5-9b\n', 'pt-BR\n', 'y\n'])
    const output = new PassThrough()
    const answers = await interview(settings('ts'), { spec: 'lmstudio:qwen3.5-9b', automatic: false, note: 'LM Studio has it.' }, { input, output })
    expect(answers).toMatchObject({ targets: ['dist'], model: 'lmstudio:qwen3.5-9b', locale: 'pt-BR', github: true })
    expect(String(output.read())).toContain('Pages to check: URLs, .html files or folders, comma-separated [dist]: ')
  })

  it('keeps the defaults for whatever the input ends before', async () => {
    const answers = await interview(settings('ts'), undefined, { input: Readable.from(['dist, http://localhost:3000/\n']), output: new PassThrough() })
    expect(answers).toMatchObject({ targets: ['dist', 'http://localhost:3000/'], model: undefined, locale: 'en', github: false })
  })
})

describe('the workflow rampa init writes', () => {
  it('uses only inputs the Rampa action has, with the permissions they need', () => {
    const workflow = workflowSource(settings('ts', { targets: ['dist', 'http://localhost:4173/'], locale: 'pt-BR' }))
    const step = workflow.slice(workflow.indexOf('rampa-cli@main'))
    const inputs = [...step.matchAll(/^ {10}#? ?([a-z-]+): /gm)].map((match) => match[1])
    expect(inputs).toEqual(['targets', 'fail-on', 'model', 'criteria', 'locale', 'comment', 'sarif'])
    expect(workflow).toContain('targets: dist http://localhost:4173/')
    // The action's locale input defaults to en and would override the config's.
    expect(workflow).toContain('          locale: pt-BR\n')
    expect(workflow).toContain('  pull-requests: write\n')
    expect(workflow).toContain('  security-events: write\n')
    expect(workflow).toContain('        #   ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}')
    expect(workflow).toContain('          # model: anthropic:claude-haiku-5-5')
  })

  it('quotes targets that YAML would otherwise misread', () => {
    expect(workflowSource(settings('ts', { targets: ['http://localhost:3000/#top'] }))).toContain("targets: 'http://localhost:3000/#top'\n")
    expect(workflowSource(settings('ts', { targets: ["docs/it's.html"] }))).toContain("targets: 'docs/it''s.html'\n")
    expect(workflowSource(settings('ts', { targets: ['site/index.html', 'https://example.com/a?b=c'] }))).toContain('targets: site/index.html https://example.com/a?b=c\n')
  })

  it('runs axe-core alone in CI when the config pins a local model, which a runner does not have', () => {
    const workflow = workflowSource(settings('ts', { model: 'ollama:gemma4:12b' }))
    expect(workflow).toContain('          model: none\n')
  })

  it('passes the key of a hosted model the config pins', () => {
    const workflow = workflowSource(settings('ts', { model: 'anthropic:claude-haiku-5-5' }))
    expect(workflow).not.toMatch(/^ {10}model:/m)
    expect(workflow).toContain('        env:\n          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}\n')
    expect(workflowSource(settings('ts', { model: 'bedrock:global.anthropic.claude-haiku-5-5' }))).toContain('Set the credentials Amazon Bedrock needs as secrets')
  })
})

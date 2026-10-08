import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { countFindings, missingCredentials, modelArgs, outputLines, planCheck, splitArgs } from '../action/check.ts'
import { DEFAULT_MARKER, type IssueComment, MAX_BODY, markerFor, pullRequestNumber, runComment, upsertComment, withMarker } from '../action/comment.ts'
import { MARKDOWN_MARKER } from '../src/report/markdown.ts'

const target = { api: 'https://api.github.test', repo: 'owner/site', issue: 7, token: 't0ken' }

/** Just enough of GitHub's issue comments API, in memory. */
function fakeGitHub(initial: IssueComment[] = [], fail?: number) {
  const comments = initial.map((comment) => ({ ...comment }))
  const calls: Array<{ method: string; url: string; body?: string }> = []
  let next = 1000
  const handler = async (input: string | URL | Request, init: RequestInit = {}): Promise<Response> => {
    const url = String(input)
    const method = init.method ?? 'GET'
    calls.push({ method, url, body: typeof init.body === 'string' ? (JSON.parse(init.body) as { body: string }).body : undefined })
    if (fail && method !== 'GET') return new Response('{"message":"Resource not accessible by integration"}', { status: fail })
    const page = /\/issues\/7\/comments\?per_page=100&page=(\d+)$/.exec(url)
    if (method === 'GET' && page) {
      const index = Number(page[1]) - 1
      return Response.json(comments.slice(index * 100, index * 100 + 100))
    }
    const body = (JSON.parse(String(init.body ?? '{}')) as { body: string }).body
    if (method === 'POST' && url.endsWith('/issues/7/comments')) {
      const created = { id: next++, body, html_url: `https://github.test/owner/site/pull/7#issuecomment-${next - 1}` }
      comments.push(created)
      return Response.json(created, { status: 201 })
    }
    const edit = /\/issues\/comments\/(\d+)$/.exec(url)
    const comment = comments.find((candidate) => candidate.id === Number(edit?.[1]))
    if (method === 'PATCH' && comment) {
      comment.body = body
      return Response.json(comment)
    }
    return new Response('not found', { status: 404 })
  }
  return { fetch: handler as typeof fetch, comments, calls, writes: () => calls.filter((call) => call.method !== 'GET') }
}

describe('sticky pull request comment', () => {
  it('uses the marker the Markdown report starts with', () => {
    expect(DEFAULT_MARKER).toBe(MARKDOWN_MARKER)
    expect(markerFor('')).toBe(MARKDOWN_MARKER)
    expect(markerFor('docs site')).toBe('<!-- rampa-report:docs-site -->')
    expect(markerFor('--> <b>')).toBe('<!-- rampa-report:-b- -->')
  })

  it('creates the comment when there is none', async () => {
    const github = fakeGitHub([{ id: 1, body: 'LGTM' }])
    const result = await upsertComment(target, { body: `${MARKDOWN_MARKER}\n## Report`, fetch: github.fetch })
    expect(result).toMatchObject({ action: 'created', id: 1000 })
    expect(github.writes()).toEqual([{ method: 'POST', url: 'https://api.github.test/repos/owner/site/issues/7/comments', body: `${MARKDOWN_MARKER}\n## Report` }])
  })

  it('edits its own comment and leaves alone a reply that quotes it', async () => {
    const github = fakeGitHub([
      { id: 1, body: `> ${MARKDOWN_MARKER}\n> ## Report\n\nIs this right?` },
      { id: 2, body: `${MARKDOWN_MARKER}\n## Old report` },
      { id: 3, body: `I copied the marker ${MARKDOWN_MARKER} here` },
    ])
    const result = await upsertComment(target, { body: `${MARKDOWN_MARKER}\n## New report`, fetch: github.fetch })
    expect(result).toMatchObject({ action: 'updated', id: 2 })
    expect(github.writes()).toEqual([{ method: 'PATCH', url: 'https://api.github.test/repos/owner/site/issues/comments/2', body: `${MARKDOWN_MARKER}\n## New report` }])
    expect(github.comments.map((comment) => comment.body?.slice(0, 12))).toEqual([`> ${MARKDOWN_MARKER}`.slice(0, 12), `${MARKDOWN_MARKER}`.slice(0, 12), 'I copied the'])
  })

  it('writes nothing when the report did not change', async () => {
    const github = fakeGitHub([{ id: 2, body: `${MARKDOWN_MARKER}\r\n## Same` }])
    const result = await upsertComment(target, { body: `${MARKDOWN_MARKER}\n## Same`, fetch: github.fetch })
    expect(result).toMatchObject({ action: 'unchanged', id: 2 })
    expect(github.writes()).toEqual([])
  })

  it('finds its comment past the first page', async () => {
    const chatter = Array.from({ length: 150 }, (_, index) => ({ id: index + 1, body: `comment ${index}` }))
    const github = fakeGitHub([...chatter, { id: 500, body: `${MARKDOWN_MARKER}\nold` }])
    const result = await upsertComment(target, { body: `${MARKDOWN_MARKER}\nnew`, fetch: github.fetch })
    expect(result).toMatchObject({ action: 'updated', id: 500 })
    expect(github.calls.filter((call) => call.method === 'GET')).toHaveLength(2)
  })

  it('gives each key its own comment', async () => {
    const github = fakeGitHub([{ id: 2, body: `${MARKDOWN_MARKER}\nsite report` }])
    const docs = markerFor('docs')
    const result = await upsertComment(target, { body: `${MARKDOWN_MARKER}\ndocs report`, marker: docs, fetch: github.fetch })
    expect(result).toMatchObject({ action: 'created' })
    expect(github.comments[1]?.body).toBe(`${docs}\ndocs report`)
    expect(github.comments[0]?.body).toBe(`${MARKDOWN_MARKER}\nsite report`)
  })

  it('reads but never writes in a dry run', async () => {
    const github = fakeGitHub([{ id: 2, body: `${MARKDOWN_MARKER}\nold` }])
    expect(await upsertComment(target, { body: `${MARKDOWN_MARKER}\nnew`, dryRun: true, fetch: github.fetch })).toEqual({ action: 'would-update', id: 2 })
    expect(github.writes()).toEqual([])
  })

  it('puts the marker first and cuts a body GitHub would refuse', () => {
    expect(withMarker('## Report', MARKDOWN_MARKER)).toBe(`${MARKDOWN_MARKER}\n## Report`)
    const huge = withMarker(`${MARKDOWN_MARKER}\n${'x'.repeat(MAX_BODY)}`, markerFor('docs'))
    expect(huge.length).toBe(MAX_BODY)
    expect(huge.startsWith('<!-- rampa-report:docs -->')).toBe(true)
    expect(huge.endsWith('_(cut to fit the size limit of a comment)_\n')).toBe(true)
  })

  it('finds the pull request of the event', () => {
    expect(pullRequestNumber({ pull_request: { number: 12 } })).toBe(12)
    expect(pullRequestNumber({ issue: { number: 13, pull_request: {} } })).toBe(13)
    expect(pullRequestNumber({ issue: { number: 14 } })).toBeUndefined()
    expect(pullRequestNumber({ ref: 'refs/heads/main' })).toBeUndefined()
  })
})

describe('comment script', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rampa-comment-'))
  const bodyFile = join(dir, 'rampa.md')
  writeFileSync(bodyFile, `${MARKDOWN_MARKER}\n## Report\n`)
  const event = join(dir, 'event.json')
  writeFileSync(event, JSON.stringify({ pull_request: { number: 7 } }))
  const env = { GITHUB_REPOSITORY: 'owner/site', GITHUB_EVENT_PATH: event, GITHUB_API_URL: 'https://api.github.test', GITHUB_TOKEN: 't0ken' }

  it('posts on the pull request of the event', async () => {
    const github = fakeGitHub()
    const log: string[] = []
    const code = await runComment({ argv: ['--body-file', bodyFile], env, fetch: github.fetch, log: (line) => log.push(line) })
    expect(code).toBe(0)
    expect(github.comments).toHaveLength(1)
    expect(log).toEqual(['Posted the Rampa report on owner/site#7: https://github.test/owner/site/pull/7#issuecomment-1000'])
  })

  it('warns and exits 0 when the token cannot write, as on a pull request from a fork', async () => {
    const github = fakeGitHub([], 403)
    const log: string[] = []
    const code = await runComment({ argv: ['--body-file', bodyFile], env, fetch: github.fetch, log: (line) => log.push(line) })
    expect(code).toBe(0)
    expect(log[0]).toMatch(/^::warning::Could not comment on pull request #7: POST .* HTTP 403 .*as on pull requests from forks/)
  })

  it('does nothing outside a pull request', async () => {
    const push = join(dir, 'push.json')
    writeFileSync(push, JSON.stringify({ ref: 'refs/heads/main' }))
    const github = fakeGitHub()
    const log: string[] = []
    const code = await runComment({ argv: ['--body-file', bodyFile], env: { ...env, GITHUB_EVENT_PATH: push }, fetch: github.fetch, log: (line) => log.push(line) })
    expect(code).toBe(0)
    expect(github.calls).toEqual([])
    expect(log).toEqual(['Not a pull request: no comment to post.'])
  })

  it('runs as a script, and a dry run without a token touches no network', () => {
    const run = spawnSync(process.execPath, ['action/comment.ts', '--body-file', bodyFile, '--dry-run', '--key', 'docs'], {
      encoding: 'utf8',
      env: { ...process.env, ...env, GITHUB_TOKEN: '' },
    })
    expect(run.status).toBe(0)
    expect(run.stdout).toContain('Dry run: would create or update the comment on owner/site#7 (no token to look for an earlier one).')
    expect(run.stdout).toContain('<!-- rampa-report:docs -->\n## Report')
  })
})

describe('check step', () => {
  it('splits inputs like a shell, keeping Windows paths', () => {
    expect(splitArgs(`site/index.html "docs/my page.html" 'a b'\n  site\\about.html my\\ file.html`)).toEqual([
      'site/index.html',
      'docs/my page.html',
      'a b',
      'site\\about.html',
      'my file.html',
    ])
    expect(splitArgs('--min-confidence high --runs 3')).toEqual(['--min-confidence', 'high', '--runs', '3'])
    expect(splitArgs('  ')).toEqual([])
    expect(() => splitArgs('"open')).toThrow('Unclosed " in: "open')
  })

  it('runs the deterministic layer when no model is configured, instead of failing', () => {
    const none = () => undefined
    const keys = () => []
    expect(modelArgs('anthropic:claude-haiku-5-5', [], none, keys)).toEqual({ args: ['--model', 'anthropic:claude-haiku-5-5'] })
    expect(modelArgs('none', [], () => 'ollama:gemma4:12b', keys)).toEqual({ args: ['--no-llm'] })
    expect(modelArgs('', [], () => 'openai:gpt-6-luna', keys)).toEqual({ args: ['--model', 'openai:gpt-6-luna'] })
    expect(modelArgs('', [], none, keys)).toEqual({ args: ['--no-llm'] })
    let asked = false
    expect(modelArgs('', ['--no-llm'], () => ((asked = true), undefined), keys)).toEqual({ args: [] })
    expect(asked).toBe(false)
  })

  it('falls back to the deterministic layer, with a warning, when the model has no key here', () => {
    const choice = modelArgs('anthropic:claude-haiku-5-5', [], () => undefined, () => ['ANTHROPIC_API_KEY'])
    expect(choice.args).toEqual(['--no-llm'])
    expect(choice.warning).toBe(
      'anthropic:claude-haiku-5-5 needs ANTHROPIC_API_KEY, which this run does not have (pull requests from forks get no secrets), so only the deterministic layer runs.',
    )
  })

  it('reads missing credentials from the provider table', () => {
    const saved = process.env.ANTHROPIC_API_KEY
    try {
      process.env.ANTHROPIC_API_KEY = ''
      expect(missingCredentials('anthropic:claude-haiku-5-5')).toEqual(['ANTHROPIC_API_KEY'])
      process.env.ANTHROPIC_API_KEY = 'sk-test'
      expect(missingCredentials('anthropic:claude-haiku-5-5')).toEqual([])
      expect(missingCredentials('ollama:gemma4:12b')).toEqual([])
      expect(missingCredentials('nobody:model')).toEqual([])
    } finally {
      if (saved === undefined) delete process.env.ANTHROPIC_API_KEY
      else process.env.ANTHROPIC_API_KEY = saved
    }
  })

  it('writes every format to the output directory and keeps targets after --', () => {
    const plan = planCheck(
      { targets: 'site/index.html\n--weird.html', criteria: '1.1.1,2.4.4', model: 'none', failOn: 'AA', locale: 'pt-BR', args: '--min-confidence high' },
      '/tmp/out',
      () => undefined,
      () => [],
    )
    expect(plan.files.sarif).toBe(join('/tmp/out', 'rampa.sarif'))
    expect(plan.args).toEqual([
      'check',
      '--json',
      join('/tmp/out', 'rampa.json'),
      '--markdown',
      join('/tmp/out', 'rampa.md'),
      '--sarif',
      join('/tmp/out', 'rampa.sarif'),
      '--html',
      join('/tmp/out', 'rampa.html'),
      '--criteria',
      '1.1.1,2.4.4',
      '--fail-on',
      'AA',
      '--locale',
      'pt-BR',
      '--no-llm',
      '--min-confidence',
      'high',
      '--',
      'site/index.html',
      '--weird.html',
    ])
    expect(() => planCheck({ targets: ' ', criteria: '', model: '', failOn: '', locale: '', args: '' }, '/tmp', () => undefined)).toThrow('No targets')
  })

  it('counts confirmed findings in one report or several', () => {
    expect(countFindings({ findings: [1, 2] })).toBe(2)
    expect(countFindings([{ findings: [1] }, { findings: [] }, { findings: [1, 2, 3] }])).toBe(4)
    expect(countFindings(null)).toBe(0)
    expect(outputLines({ findings: 3, sarif: '/tmp/a b.sarif', note: 'two\nlines' })).toBe('findings=3\nsarif=/tmp/a b.sarif\nnote=two lines\n')
  })

  it('runs rampa, sets the outputs and the job summary, and leaves failing to the last step', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rampa-action-'))
    const output = join(dir, 'output.txt')
    const summary = join(dir, 'summary.md')
    writeFileSync(output, '')
    writeFileSync(summary, '')
    const run = spawnSync(process.execPath, ['action/check.ts'], {
      encoding: 'utf8',
      env: {
        ...process.env,
        RAMPA_CLI: 'src/cli.ts',
        RUNNER_TEMP: dir,
        GITHUB_OUTPUT: output,
        GITHUB_STEP_SUMMARY: summary,
        INPUT_TARGETS: 'demo/recorded/examples-store-before.snapshot.json',
        INPUT_MODEL: 'ollama:gemma4:12b',
        INPUT_ARGS: '--offline --cache-dir demo/recorded/cache',
        INPUT_FAIL_ON: 'confirmed',
        INPUT_LOCALE: 'en',
        INPUT_CRITERIA: '',
        INPUT_SUMMARY: 'true',
      },
    })
    expect(run.status).toBe(0)
    const outputs = Object.fromEntries(
      readFileSync(output, 'utf8')
        .trim()
        .split('\n')
        .map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]),
    )
    expect(outputs).toEqual({
      'exit-code': '1',
      findings: '9',
      json: join(dir, 'rampa', 'rampa.json'),
      markdown: join(dir, 'rampa', 'rampa.md'),
      sarif: join(dir, 'rampa', 'rampa.sarif'),
      html: join(dir, 'rampa', 'rampa.html'),
    })
    expect(readFileSync(summary, 'utf8').startsWith(`${MARKDOWN_MARKER}\n## Rampa accessibility report`)).toBe(true)
    const sarif = JSON.parse(readFileSync(outputs.sarif as string, 'utf8')) as { runs: Array<{ results: unknown[] }> }
    expect(sarif.runs[0]?.results).toHaveLength(9)
  }, 60_000)
})

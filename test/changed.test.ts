import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { Report } from '../src/core/types.ts'
import { changedBase, changedFiles, onlyChanged } from '../src/source/changed.ts'
import { resolveTargets } from '../src/surfaces/targets.ts'
import { browserForTests } from './browser.ts'

const PAGE = (title: string) => `<!doctype html><html lang="en"><head><title>${title}</title></head><body><main><h1>${title}</h1></main></body></html>\n`

/** A repository with four pages on main and a branch that changes one, adds one and leaves one untracked. */
function repository(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'rampa-changed-')))
  const git = (...args: string[]) => execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', '-c', 'commit.gpgsign=false', ...args], { cwd: dir, stdio: 'pipe' })
  git('init', '-q', '-b', 'main')
  mkdirSync(join(dir, 'site', 'docs'), { recursive: true })
  for (const name of ['index', 'about', 'docs/guide']) writeFileSync(join(dir, 'site', `${name}.html`), PAGE(name))
  writeFileSync(join(dir, 'site', 'style.css'), 'body { color: #222 }\n')
  git('add', '.')
  git('commit', '-q', '-m', 'pages')
  git('checkout', '-q', '-b', 'feature')
  writeFileSync(join(dir, 'site', 'about.html'), PAGE('About us'))
  writeFileSync(join(dir, 'site', 'pricing.html'), PAGE('Pricing'))
  git('add', '.')
  git('commit', '-q', '-m', 'about and pricing')
  // A new page not committed yet, and a style sheet change that no page's HTML shows.
  writeFileSync(join(dir, 'site', 'docs', 'faq.html'), PAGE('FAQ'))
  writeFileSync(join(dir, 'site', 'style.css'), 'body { color: #999 }\n')
  return dir
}

const labels = (targets: Array<{ label: string }>, dir: string) => targets.map((target) => target.label.replace(`${dir}${process.platform === 'win32' ? '\\' : '/'}`, '').replaceAll('\\', '/')).sort()

describe('--changed', () => {
  it('compares with the merge base of the default branch by default', async () => {
    const dir = repository()
    const base = await changedBase(undefined, dir)
    expect(base.ref).toBe('merge-base with main')
    expect(base.commit).toBe(execFileSync('git', ['rev-parse', 'main'], { cwd: dir, encoding: 'utf8' }).trim())
    const files = await changedFiles(base.commit, dir)
    expect([...files].map((file) => file.replaceAll('\\', '/').split('/site/')[1]).sort()).toEqual(['about.html', 'docs/faq.html', 'pricing.html', 'style.css'])
  })

  it('keeps the HTML files that changed and every target that is not a local HTML file', async () => {
    const dir = repository()
    const targets = await resolveTargets([join(dir, 'site'), 'https://example.com/'])
    const changed = await onlyChanged(targets, undefined, dir)
    expect(labels(changed.targets.filter((t) => t.kind === 'web' && t.url.startsWith('file:')), dir)).toEqual(['site/about.html', 'site/docs/faq.html', 'site/pricing.html'])
    expect(changed.targets.some((t) => t.kind === 'web' && t.url === 'https://example.com/')).toBe(true)
    expect(labels(changed.skipped.map((label) => ({ label })), dir)).toEqual(['site/docs/guide.html', 'site/index.html'])
  })

  it('takes a ref: HEAD keeps only what is not committed yet', async () => {
    const dir = repository()
    const changed = await onlyChanged(await resolveTargets([join(dir, 'site')]), 'HEAD', dir)
    expect(changed.base.ref).toBe('HEAD')
    expect(labels(changed.targets, dir)).toEqual(['site/docs/faq.html'])
  })

  it('refuses a ref that is not a commit, and says how to fetch it', async () => {
    const dir = repository()
    await expect(onlyChanged([], 'origin/nowhere', dir)).rejects.toThrow('--changed: "origin/nowhere" is not a commit in this repository')
    // `rampa check --changed site` takes the folder for the ref.
    await expect(onlyChanged([], 'site', dir)).rejects.toThrow('--changed took "site" as a git ref. Put --changed after the targets')
  })
})

// The CLI in the repository: the browser checks the changed pages only.
const browser = await browserForTests('the --changed command line')
await browser?.close()

describe.skipIf(!browser)('rampa check --changed', { timeout: 120_000 }, () => {
  const rampa = (dir: string, ...args: string[]) => {
    const run = spawnSync(process.execPath, [resolve('src/cli.ts'), 'check', ...args], { cwd: dir, encoding: 'utf8', env: { ...process.env, NO_COLOR: '1', RAMPA_LOCALE: 'en', RAMPA_MODEL: '' } })
    return { code: run.status, stdout: run.stdout, stderr: run.stderr }
  }

  it('checks the changed pages, and says on stderr and in each report what it skipped', () => {
    const dir = repository()
    const run = rampa(dir, 'site', '--changed', '--no-llm', '--format', 'json', '--fail-on', 'none')
    expect(run.code).toBe(0)
    expect(run.stderr).toContain('rampa: --changed (merge-base with main')
    expect(run.stderr).toContain('checking 3 of 5 local HTML files; 2 unchanged since then are skipped')
    const reports = JSON.parse(run.stdout) as Report[]
    expect(reports.map((report) => report.sourceFile).sort()).toEqual(['site/about.html', 'site/docs/faq.html', 'site/pricing.html'])
    expect(reports[0]?.notes).toContain(`--changed: 2 local HTML file(s) unchanged since merge-base with main (${execFileSync('git', ['rev-parse', '--short', 'main'], { cwd: dir, encoding: 'utf8' }).trim()}) were not checked in this run: site/docs/guide.html, site/index.html.`)
  })

  it('checks nothing, and says so, when no HTML file changed', () => {
    const dir = repository()
    const run = rampa(dir, 'site/index.html', '--changed', '--no-llm')
    expect(run.code).toBe(0)
    expect(run.stdout).toContain('No local HTML file changed since merge-base with main')
  })
})

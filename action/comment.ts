/**
 * Posts the Markdown report as one sticky pull request comment. It looks for the comment
 * an earlier run posted, by the hidden marker it starts with, and edits it, so a pull
 * request carries one report that follows every push instead of one comment per push.
 *
 *   node action/comment.ts --body-file rampa.md [--key docs] [--issue 12] [--dry-run]
 *
 * It reads GITHUB_TOKEN, GITHUB_REPOSITORY, GITHUB_EVENT_PATH and GITHUB_API_URL, as set
 * on GitHub Actions. --dry-run reads but never writes, and prints what it would post.
 * A comment is a courtesy: when GitHub refuses it (a pull request from a fork gets a
 * read-only token) it warns and exits 0, and the report stays in the job summary.
 *
 * Node 22.18+ runs it as is: TypeScript without a build step, Node built-ins only.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parseArgs } from 'node:util'

/** Must match MARKDOWN_MARKER in src/report/markdown.ts. */
export const DEFAULT_MARKER = '<!-- rampa-report -->'
/** GitHub's limit for a comment body. */
export const MAX_BODY = 65_536

export interface CommentTarget {
  api: string
  repo: string
  issue: number
  token: string
}

export interface IssueComment {
  id: number
  body?: string | null
  html_url?: string
}

export type UpsertResult =
  | { action: 'created' | 'updated'; id: number; url?: string | undefined }
  | { action: 'unchanged'; id: number; url?: string | undefined }
  | { action: 'would-create' }
  | { action: 'would-update'; id: number }

export class GitHubError extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.name = 'GitHubError'
    this.status = status
  }
}

/** Each key gets its own comment, so two jobs that report on one pull request never edit each other's. */
export function markerFor(key: string | undefined): string {
  // A run of hyphens could close the HTML comment early.
  const clean = (key ?? '')
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/-{2,}/g, '-')
  return clean === '' ? DEFAULT_MARKER : `<!-- rampa-report:${clean} -->`
}

/** The body with its marker first, cut to what GitHub accepts. */
export function withMarker(body: string, marker: string): string {
  const marked = body.includes(DEFAULT_MARKER) ? body.replace(DEFAULT_MARKER, marker) : `${marker}\n${body}`
  if (marked.length <= MAX_BODY) return marked
  const note = '\n\n_(cut to fit the size limit of a comment)_\n'
  return marked.slice(0, MAX_BODY - note.length) + note
}

/** A comment is ours when it starts with the marker; a reply that quotes it starts with `>` and is left alone. */
export function isOurs(comment: IssueComment, marker: string): boolean {
  return (comment.body ?? '').trimStart().startsWith(marker)
}

/** The pull request a workflow event is about, if any. */
export function pullRequestNumber(event: unknown): number | undefined {
  const payload = event as { pull_request?: { number?: unknown }; issue?: { number?: unknown; pull_request?: unknown } } | null
  const fromPull = payload?.pull_request?.number
  if (typeof fromPull === 'number') return fromPull
  const fromIssue = payload?.issue?.number
  if (payload?.issue?.pull_request && typeof fromIssue === 'number') return fromIssue
  return undefined
}

const sameText = (a: string, b: string) => a.replace(/\r\n/g, '\n') === b.replace(/\r\n/g, '\n')

export async function upsertComment(
  target: CommentTarget,
  options: { body: string; marker?: string | undefined; dryRun?: boolean | undefined; fetch?: typeof fetch | undefined },
): Promise<UpsertResult> {
  const call = options.fetch ?? fetch
  const marker = options.marker ?? DEFAULT_MARKER
  const body = withMarker(options.body, marker)
  const base = `${target.api.replace(/\/+$/, '')}/repos/${target.repo}`
  const headers = {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${target.token}`,
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'rampa-action',
  }
  const request = async <T>(url: string, init: { method?: string; body?: string } = {}): Promise<T> => {
    const response = await call(url, { ...init, headers: init.body ? { ...headers, 'Content-Type': 'application/json' } : headers })
    if (!response.ok) throw new GitHubError(response.status, `${init.method ?? 'GET'} ${url}: HTTP ${response.status} ${(await response.text()).slice(0, 300)}`)
    return (await response.json()) as T
  }

  let existing: IssueComment | undefined
  for (let page = 1; page <= 30 && !existing; page++) {
    const comments = await request<IssueComment[]>(`${base}/issues/${target.issue}/comments?per_page=100&page=${page}`)
    existing = comments.find((comment) => isOurs(comment, marker))
    if (comments.length < 100) break
  }

  if (existing && sameText(existing.body ?? '', body)) return { action: 'unchanged', id: existing.id, url: existing.html_url }
  if (options.dryRun) return existing ? { action: 'would-update', id: existing.id } : { action: 'would-create' }
  const payload = JSON.stringify({ body })
  if (existing) {
    const updated = await request<IssueComment>(`${base}/issues/comments/${existing.id}`, { method: 'PATCH', body: payload })
    return { action: 'updated', id: updated.id, url: updated.html_url }
  }
  const created = await request<IssueComment>(`${base}/issues/${target.issue}/comments`, { method: 'POST', body: payload })
  return { action: 'created', id: created.id, url: created.html_url }
}

export interface CommentRun {
  argv: string[]
  env: NodeJS.ProcessEnv
  fetch?: typeof fetch | undefined
  log?: ((line: string) => void) | undefined
}

/** The script, without the process around it: returns the exit code. */
export async function runComment({ argv, env, fetch: call, log = console.log }: CommentRun): Promise<number> {
  const { values } = parseArgs({
    args: argv,
    options: {
      'body-file': { type: 'string' },
      key: { type: 'string' },
      issue: { type: 'string' },
      repo: { type: 'string' },
      'dry-run': { type: 'boolean', default: false },
    },
  })
  const file = values['body-file']
  if (!file) {
    log('::error::Pass --body-file with the Markdown report.')
    return 1
  }
  const body = readFileSync(file, 'utf8')
  const marker = markerFor(values.key ?? env.INPUT_COMMENT_KEY)
  const dryRun = values['dry-run'] === true
  const repo = values.repo ?? env.GITHUB_REPOSITORY
  let event: unknown
  try {
    event = env.GITHUB_EVENT_PATH ? JSON.parse(readFileSync(env.GITHUB_EVENT_PATH, 'utf8')) : undefined
  } catch {
    event = undefined
  }
  const issue = values.issue ? Number.parseInt(values.issue, 10) : pullRequestNumber(event)
  const token = env.GITHUB_TOKEN ?? ''

  if (!issue || Number.isNaN(issue)) {
    log('Not a pull request: no comment to post.')
    if (dryRun) log(withMarker(body, marker))
    return 0
  }
  if (!repo || (!token && !dryRun)) {
    log(`::warning::Cannot comment on pull request #${issue}: ${!repo ? 'GITHUB_REPOSITORY' : 'GITHUB_TOKEN'} is not set.`)
    return 0
  }
  if (dryRun && !token) {
    log(`Dry run: would create or update the comment on ${repo}#${issue} (no token to look for an earlier one).`)
    log(withMarker(body, marker))
    return 0
  }

  try {
    const result = await upsertComment({ api: env.GITHUB_API_URL ?? 'https://api.github.com', repo, issue, token }, { body, marker, dryRun, fetch: call })
    switch (result.action) {
      case 'created':
      case 'updated':
        log(`${result.action === 'created' ? 'Posted' : 'Updated'} the Rampa report on ${repo}#${issue}${result.url ? `: ${result.url}` : '.'}`)
        break
      case 'unchanged':
        log(`The Rampa report on ${repo}#${issue} is already up to date.`)
        break
      case 'would-create':
      case 'would-update':
        log(`Dry run: would ${result.action === 'would-create' ? 'create a comment' : `update comment ${result.id}`} on ${repo}#${issue}.`)
        log(withMarker(body, marker))
        break
    }
    return 0
  } catch (error) {
    const status = error instanceof GitHubError ? error.status : undefined
    const hint = status === 403 || status === 404 ? ' The token cannot write here, as on pull requests from forks; the report is in the job summary.' : ''
    log(`::warning::Could not comment on pull request #${issue}: ${error instanceof Error ? error.message : String(error)}${hint}`)
    return 0
  }
}

// Run only as a script, not when a test imports it.
if (isEntry(process.argv[1], import.meta.filename)) {
  process.exitCode = await runComment({ argv: process.argv.slice(2), env: process.env })
}

function isEntry(invoked: string | undefined, self: string | undefined): boolean {
  if (!invoked || !self) return false
  const a = resolve(invoked)
  return process.platform === 'win32' ? a.toLowerCase() === self.toLowerCase() : a === self
}

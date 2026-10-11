import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { RampaError, errorMessage } from '../core/util.ts'
import type { Target } from '../surfaces/targets.ts'

/**
 * `--changed[=<ref>]`: of the local HTML files a run would check, only those that changed since a git ref: committed
 * since it, staged, modified in the working tree, or new and not ignored. The default ref is the merge base of HEAD with
 * the repository's default branch, what a pull request changed. URLs and other targets are always checked. A file that
 * did not change is skipped even when a style sheet or a script it loads did: the report says how many were skipped.
 */

const run = promisify(execFile)

async function git(args: readonly string[], cwd: string): Promise<string> {
  const { stdout } = await run('git', [...args], { cwd, maxBuffer: 64 * 1024 * 1024, windowsHide: true })
  return stdout
}

/** The ref --changed compares with, and the commit it names. */
export interface ChangedBase {
  /** As given, or how the default was found, such as `merge-base with origin/main`. */
  ref: string
  commit: string
}

/** The default branch, as the remote names it (origin/HEAD), else the first of origin/main, origin/master, main, master that exists. */
async function defaultBranch(cwd: string): Promise<string | undefined> {
  const head = await git(['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD'], cwd).catch(() => '')
  if (head.trim()) return head.trim()
  for (const name of ['origin/main', 'origin/master', 'main', 'master']) {
    const found = await git(['rev-parse', '--verify', '--quiet', `${name}^{commit}`], cwd).catch(() => '')
    if (found.trim()) return name
  }
  return undefined
}

/** The commit --changed compares with: the ref given, or the merge base of HEAD and the default branch. */
export async function changedBase(ref: string | undefined, cwd = process.cwd()): Promise<ChangedBase> {
  if (ref !== undefined) {
    const commit = await git(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], cwd).catch(() => '')
    if (!commit.trim()) {
      // `rampa check --changed site/` reads the target as the ref.
      if (existsSync(resolve(cwd, ref))) throw new RampaError('changed-ref', `--changed took "${ref}" as a git ref. Put --changed after the targets, or name the ref: --changed=<ref>.`)
      throw new RampaError('changed-ref', `--changed: "${ref}" is not a commit in this repository. Fetch it first (in CI: actions/checkout with fetch-depth: 0).`)
    }
    return { ref, commit: commit.trim() }
  }
  const branch = await defaultBranch(cwd)
  if (!branch) throw new RampaError('changed-ref', '--changed: found no default branch (origin/HEAD, main or master) to compare with. Pass the ref: --changed=<branch or commit>.')
  const base = await git(['merge-base', 'HEAD', branch], cwd).catch((error: unknown) => {
    throw new RampaError(
      'changed-ref',
      `--changed: no merge base of HEAD and ${branch} (${errorMessage(error)}). A shallow clone lacks the history: in CI, use actions/checkout with fetch-depth: 0, or pass --changed=<ref>.`,
    )
  })
  return { ref: `merge-base with ${branch}`, commit: base.trim() }
}

/** Absolute paths of the files that changed since `commit`: committed since, staged or modified, and untracked ones git does not ignore. */
export async function changedFiles(commit: string, cwd = process.cwd()): Promise<Set<string>> {
  const root = (await git(['rev-parse', '--show-toplevel'], cwd)).trim()
  const listed = [
    ...(await git(['diff', '--name-only', '-z', '--diff-filter=ACMR', commit, '--'], root)).split('\0'),
    ...(await git(['ls-files', '--others', '--exclude-standard', '-z'], root)).split('\0'),
  ]
  return new Set(listed.filter((file) => file !== '').map((file) => pathKey(resolve(root, file))))
}

/** Paths compare without case on Windows and macOS, as their file systems do by default. */
function pathKey(path: string): string {
  return process.platform === 'win32' || process.platform === 'darwin' ? path.toLowerCase() : path
}

export interface ChangedTargets {
  /** What to check: changed local HTML files, and every target that is not a local HTML file. */
  targets: Target[]
  /** Local HTML files left out because they did not change. */
  skipped: string[]
  base: ChangedBase
}

/** Keeps the local HTML files that changed since `ref` (the merge base with the default branch when undefined), and every other target. */
export async function onlyChanged(targets: readonly Target[], ref: string | undefined, cwd = process.cwd()): Promise<ChangedTargets> {
  const base = await changedBase(ref, cwd)
  const changed = await changedFiles(base.commit, cwd)
  const kept: Target[] = []
  const skipped: string[] = []
  for (const target of targets) {
    const file = target.kind === 'web' && target.url.startsWith('file:') ? fileURLToPath(target.url) : undefined
    if (file === undefined || changed.has(pathKey(file))) kept.push(target)
    else skipped.push(target.label)
  }
  return { targets: kept, skipped, base }
}

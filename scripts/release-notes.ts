/**
 * Prints the notes of one version from CHANGELOG.md, for its GitHub release:
 *
 *   node scripts/release-notes.ts 0.2.0 > notes.md
 *
 * A version's notes run from its heading, `## [0.2.0] - 2026-10-20` (or `## 0.2.0`), to the next
 * `## ` heading. With no notes for the version it exits 1, so the release workflow stops before
 * anything is published. Node 22.18+ runs it as is, with Node built-ins only.
 */
import { readFileSync } from 'node:fs'

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** The notes under the version's heading, trimmed; undefined when the heading is missing or has nothing under it. */
export function releaseNotes(changelog: string, version: string): string | undefined {
  const heading = new RegExp(`^## \\[?v?${escape(version)}\\]?(?=[\\s(]|$)`)
  const lines = changelog.split(/\r?\n/)
  const start = lines.findIndex((line) => heading.test(line))
  if (start === -1) return undefined
  const rest = lines.slice(start + 1)
  const end = rest.findIndex((line) => line.startsWith('## '))
  const notes = (end === -1 ? rest : rest.slice(0, end))
    // Link definitions such as `[0.2.0]: https://...` belong to the file, not to one release.
    .filter((line) => !/^\[[^\]]+\]:\s+\S+$/.test(line))
    .join('\n')
    .trim()
  return notes === '' ? undefined : notes
}

if (import.meta.main) {
  const version = process.argv[2]?.replace(/^v/, '')
  const file = process.argv[3] ?? 'CHANGELOG.md'
  const notes = version ? releaseNotes(readFileSync(file, 'utf8'), version) : undefined
  if (notes === undefined) {
    console.error(version ? `${file} has no notes for ${version}: add a "## [${version}]" section.` : 'Usage: node scripts/release-notes.ts <version> [CHANGELOG.md]')
    process.exitCode = 1
  } else {
    console.log(notes)
  }
}

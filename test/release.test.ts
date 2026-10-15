import { spawnSync } from 'node:child_process'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { releaseNotes } from '../scripts/release-notes.ts'

const version = (JSON.parse(readFileSync('package.json', 'utf8')) as { version: string }).version

describe('release notes', () => {
  const changelog = [
    '# Changelog',
    '',
    '## Unreleased',
    '',
    '- Not yet.',
    '',
    '## [0.2.0] - 2026-11-02',
    '',
    '### Added',
    '',
    '- A thing.',
    '',
    '## 0.1.10',
    '',
    'Ten.',
    '',
    '## [0.1.1]',
    '',
    '## v0.1.0 (2026-10-15)',
    '',
    'First.',
    '',
    '[0.2.0]: https://github.com/guilhermebsantiago/rampa-cli/releases/tag/v0.2.0',
    '',
  ].join('\n')

  it("takes the version's section, up to the next one", () => {
    expect(releaseNotes(changelog, '0.2.0')).toBe('### Added\n\n- A thing.')
    expect(releaseNotes(changelog, '0.1.10')).toBe('Ten.')
    expect(releaseNotes(changelog, '0.1.0')).toBe('First.')
  })

  it('has none for a version without a section, an empty one, or one that only shares a prefix', () => {
    expect(releaseNotes(changelog, '0.3.0')).toBeUndefined()
    expect(releaseNotes(changelog, '0.1.1')).toBeUndefined()
    expect(releaseNotes(changelog, '0.1')).toBeUndefined()
    expect(releaseNotes(changelog, '0.1.1x')).toBeUndefined()
  })

  it('fails the script without notes, so a release stops before it publishes', () => {
    const missing = spawnSync(process.execPath, ['scripts/release-notes.ts', '99.0.0'], { encoding: 'utf8' })
    expect(missing.status).toBe(1)
    expect(missing.stderr).toContain('CHANGELOG.md has no notes for 99.0.0')
    const current = spawnSync(process.execPath, ['scripts/release-notes.ts', `v${version}`], { encoding: 'utf8' })
    expect(current.status).toBe(0)
    expect(current.stdout.trim()).not.toBe('')
  })
})

describe('version', () => {
  it('is the same in package.json, CHANGELOG.md, CITATION.cff and the pinned action in the docs', () => {
    expect(releaseNotes(readFileSync('CHANGELOG.md', 'utf8'), version), `CHANGELOG.md needs a "## [${version}]" section`).toBeDefined()
    expect(readFileSync('CITATION.cff', 'utf8')).toContain(`\nversion: ${version}\n`)
    for (const file of ['README.md', 'docs/github-action.md', 'examples/github-workflow.yml']) {
      const pins = [...readFileSync(file, 'utf8').matchAll(/guilhermebsantiago\/rampa-cli@(v[\w.-]+)/g)].map((match) => match[1])
      expect(pins.length, file).toBeGreaterThan(0)
      expect(new Set(pins), file).toEqual(new Set([`v${version}`]))
    }
  })
})

describe('workflows and the action', () => {
  const files = ['action.yml', ...readdirSync('.github/workflows').map((name) => join('.github/workflows', name))]

  it('pin every action they use by its full commit SHA, with the version in a comment', () => {
    for (const file of files) {
      const uses = readFileSync(file, 'utf8')
        .split('\n')
        .filter((line) => /^\s*(?:-\s+)?uses:/.test(line))
      expect(uses.length, file).toBeGreaterThan(0)
      for (const line of uses) expect(line, file).toMatch(/uses: [\w.-]+\/[\w./-]+@[0-9a-f]{40} # v\d+\.\d+\.\d+$/)
    }
  })

  it('give the release jobs only the permissions each one needs', () => {
    const release = readFileSync('.github/workflows/release.yml', 'utf8')
    expect(release).toContain('\npermissions: {}\n')
    // Only the publish job can get an OIDC token, and it runs nothing but npm.
    expect(release.match(/id-token: write/g)).toHaveLength(1)
    const publish = release.slice(release.indexOf('\n  publish:'), release.indexOf('\n  github-release:'))
    expect(publish).toContain('id-token: write')
    expect(publish).not.toMatch(/pnpm|actions\/checkout/)
    expect(release.match(/contents: write/g)).toHaveLength(1)
    expect(release.slice(release.indexOf('\n  github-release:'))).toContain('contents: write')
  })
})

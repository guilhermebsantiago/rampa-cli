import { chmodSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const STUB = pathToFileURL(fileURLToPath(new URL('./fixtures/cli-stub.mjs', import.meta.url))).href

/** The shim npm writes for a global CLI on Windows (cmd-shim), pointing at `script`. */
function npmShim(script: string): string {
  return [
    '@ECHO off',
    'GOTO start',
    ':find_dp0',
    'SET dp0=%~dp0',
    'EXIT /b',
    ':start',
    'SETLOCAL',
    'CALL :find_dp0',
    '',
    'IF EXIST "%dp0%\\node.exe" (',
    '  SET "_prog=%dp0%\\node.exe"',
    ') ELSE (',
    '  SET "_prog=node"',
    '  SET PATHEXT=%PATHEXT:;.JS;=;%',
    ')',
    '',
    `endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\${script}" %*`,
    '',
  ].join('\r\n')
}

/** Installs a fake `name` CLI the way npm would: a .cmd shim on Windows, an executable script elsewhere. */
export function installStub(dir: string, kind: 'codex' | 'gemini', name: string = kind): void {
  const body = `import(${JSON.stringify(STUB)}).then((stub) => stub.run(${JSON.stringify(kind)}))\n`
  if (process.platform === 'win32') {
    writeFileSync(join(dir, `${name}-stub.mjs`), body)
    writeFileSync(join(dir, `${name}.cmd`), npmShim(`${name}-stub.mjs`))
  } else {
    const bin = join(dir, name)
    writeFileSync(bin, `#!${process.execPath}\n${body}`)
    chmodSync(bin, 0o755)
  }
}

export interface StubRun {
  kind: string
  args: string[]
  stdin: string
  seen: Record<string, unknown>
  /** Contents, in base64, of the files the CLI was pointed at. */
  files: Record<string, string | null>
  started: number
  ended: number
}

export function stubRuns(logDir: string): StubRun[] {
  if (!existsSync(logDir)) return []
  return readdirSync(logDir)
    .sort()
    .map((file) => JSON.parse(readFileSync(join(logDir, file), 'utf8')) as StubRun)
}

const created: string[] = []

export function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  created.push(dir)
  return dir
}

/** Removes every directory tempDir made; a stub still exiting on Windows may hold one for a moment, which is fine to leave. */
export function removeTempDirs(): void {
  for (const dir of created.splice(0)) {
    try {
      rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
    } catch {
      // left for the system to clean
    }
  }
}

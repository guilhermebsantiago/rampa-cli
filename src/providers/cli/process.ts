import { spawn } from 'node:child_process'
import { accessSync, constants, existsSync, readFileSync, statSync } from 'node:fs'
import { delimiter, dirname, extname, isAbsolute, join, resolve, sep } from 'node:path'

/** How to start an executable found on this machine. */
export interface ResolvedCommand {
  /** The file found, as doctor shows it. */
  path: string
  /** What is spawned. */
  file: string
  /** Arguments that go before the CLI's own, such as the script an npm shim runs. */
  prefix: string[]
  /** A batch file Rampa could not read through: it runs under cmd.exe, with every argument escaped for it. */
  viaCmd: boolean
}

const isWindows = process.platform === 'win32'

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile()
  } catch {
    return false
  }
}

function isExecutable(path: string): boolean {
  if (!isFile(path)) return false
  if (isWindows) return true
  try {
    accessSync(path, constants.X_OK)
    return true
  } catch {
    return false
  }
}

/** The first `name` on PATH, trying each PATHEXT extension on Windows the way cmd.exe does. */
export function findOnPath(name: string, env: NodeJS.ProcessEnv = process.env): string | undefined {
  const pathValue = (isWindows ? (env.Path ?? env.PATH) : env.PATH) ?? ''
  // PATHEXT is upper case; the files on disk usually are not, and the path shows up in doctor.
  const extensions = isWindows
    ? ['', ...(env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean)].map((ext) => ext.toLowerCase()).filter((ext) => ext !== '' || extname(name) !== '')
    : ['']
  for (const dir of pathValue.split(delimiter)) {
    if (!dir) continue
    for (const ext of extensions) {
      const candidate = join(dir.replace(/^"(.*)"$/, '$1'), name + ext)
      if (isExecutable(candidate)) return candidate
    }
  }
  return undefined
}

/**
 * Finds a CLI by name, or at the path in an override variable. Node refuses to
 * spawn .cmd and .bat files directly, and npm installs every CLI on Windows as
 * one, so an npm shim runs as the script it points to, with Node.
 */
export function resolveCommand(name: string, override?: string, env: NodeJS.ProcessEnv = process.env): ResolvedCommand | undefined {
  const path = override ? (isAbsolute(override) || existsSync(override) ? resolve(override) : findOnPath(override, env)) : findOnPath(name, env)
  if (!path || !isFile(path)) return undefined
  if (!isWindows || !/\.(cmd|bat)$/i.test(path)) return { path, file: path, prefix: [], viaCmd: false }
  const shim = npmShimTarget(path)
  if (shim) return { path, ...shim, viaCmd: false }
  return { path, file: env.ComSpec ?? env.COMSPEC ?? 'cmd.exe', prefix: [], viaCmd: true }
}

/** The program an npm (or pnpm) cmd shim starts: `"%dp0%\node_modules\pkg\cli.js" %*`. */
export function npmShimTarget(shimPath: string): { file: string; prefix: string[] } | undefined {
  let text: string
  try {
    text = readFileSync(shimPath, 'utf8')
  } catch {
    return undefined
  }
  const match = /"%~?dp0%?\\([^"%]+)"\s*%\*/i.exec(text)
  if (!match?.[1]) return undefined
  const target = resolve(dirname(shimPath), match[1].replaceAll('\\', sep))
  if (!isFile(target)) return undefined
  if (/\.exe$/i.test(target)) return { file: target, prefix: [] }
  if (!/\.[cm]?js$/i.test(target)) return undefined
  // The shim prefers a node.exe next to it, then whatever node is on PATH; Rampa's own Node is a safe stand-in for the second.
  const bundled = join(dirname(shimPath), 'node.exe')
  return { file: isFile(bundled) ? bundled : process.execPath, prefix: [target] }
}

const CMD_META = /([()\][%!^"`<>&|;, *?])/g

/** Quotes one argument for cmd.exe /s /c, as cross-spawn does (https://qntm.org/cmd). */
export function escapeForCmd(arg: string): string {
  if (/[\r\n]/.test(arg)) throw new Error('An argument for a batch file cannot contain a line break.')
  let quoted = arg.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\*)$/, '$1$1')
  quoted = `"${quoted}"`
  // Twice: once for cmd.exe itself, once for the %* the batch file expands.
  return quoted.replace(CMD_META, '^$1').replace(CMD_META, '^$1')
}

export interface ProcessResult {
  code: number | null
  signal: NodeJS.Signals | null
  stdout: string
  stderr: string
  timedOut: boolean
}

export interface RunOptions {
  cwd: string
  env: NodeJS.ProcessEnv
  /** Written to stdin, which is then closed. */
  input: string
  timeoutMs: number
}

/** Output beyond this is dropped; a judgment answer is a few kilobytes. */
const MAX_OUTPUT = 16 * 1024 * 1024

/** Runs the command to completion. Rejects only when it cannot start; a timeout kills the whole process tree. */
export function runProcess(command: ResolvedCommand, args: readonly string[], options: RunOptions): Promise<ProcessResult> {
  const argv = [...command.prefix, ...args]
  const file = command.file
  const spawnArgs = command.viaCmd ? ['/d', '/s', '/c', `"${[command.path.replace(CMD_META, '^$1'), ...argv.map(escapeForCmd)].join(' ')}"`] : argv

  return new Promise((resolvePromise, reject) => {
    const child = spawn(file, spawnArgs, {
      cwd: options.cwd,
      env: options.env,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      windowsVerbatimArguments: command.viaCmd,
    })
    let stdout = ''
    let stderr = ''
    let timedOut = false
    let settled = false
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
      if (stdout.length < MAX_OUTPUT) stdout += chunk
    })
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => {
      if (stderr.length < MAX_OUTPUT) stderr += chunk
    })
    const timer = setTimeout(() => {
      timedOut = true
      killTree(child.pid, () => child.kill('SIGKILL'))
    }, options.timeoutMs)
    child.on('error', (error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      reject(error)
    })
    child.on('close', (code, signal) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolvePromise({ code, signal, stdout, stderr, timedOut })
    })
    // A CLI that exits before reading its input closes the pipe; that is reported through the exit code instead.
    child.stdin.on('error', () => {})
    child.stdin.end(options.input)
  })
}

/** On Windows a CLI often runs under a shim or a wrapper, so the whole tree goes; elsewhere SIGTERM, then SIGKILL. */
function killTree(pid: number | undefined, fallback: () => void): void {
  if (pid === undefined) return fallback()
  if (isWindows) {
    const taskkill = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'taskkill.exe')
    const killer = spawn(taskkill, ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true })
    killer.on('error', fallback)
    killer.on('exit', (code) => {
      if (code !== 0) fallback()
    })
    return
  }
  try {
    process.kill(pid, 'SIGTERM')
  } catch {
    return
  }
  setTimeout(() => {
    try {
      process.kill(pid, 'SIGKILL')
    } catch {
      // already gone
    }
  }, 2000).unref()
}

/** At most `size` tasks at a time; a finished task hands its slot straight to the next one in line. */
export function limiter(size: number): <R>(task: () => Promise<R>) => Promise<R> {
  let active = 0
  const waiting: Array<() => void> = []
  return async (task) => {
    if (active < size) active++
    else await new Promise<void>((resolveSlot) => waiting.push(resolveSlot))
    try {
      return await task()
    } finally {
      const next = waiting.shift()
      if (next) next()
      else active--
    }
  }
}

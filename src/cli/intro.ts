import { type Locale, t } from '../i18n.ts'
import { type Painter, colorsEnabled, paint } from '../report/color.ts'
import { VERSION } from '../version.ts'

const ROWS = 4
const STEP = 4
const STAIR_EDGE = '▄▄▄▄'
const RAMP_EDGE = '▁▃▅▇'
const WORDMARK = ['█▀█ ▄▀█ █▀▄▀█ █▀█ ▄▀█', '█▀▄ █▀█ █ ▀ █ █▀▀ █▀█']

/** A staircase whose steps become a ramp from the bottom up, then the name. */
export function scene(rampRows: number, wordmarkColumns: number, p: Painter, locale: Locale): string[] {
  const lines: string[] = ['']
  for (let row = 0; row < ROWS; row++) {
    const indent = ' '.repeat((ROWS - 1 - row) * STEP)
    const built = row >= ROWS - rampRows
    const shape = (built ? RAMP_EDGE : STAIR_EDGE) + '█'.repeat(row * STEP)
    lines.push(`  ${indent}${built ? p.cyan(shape) : p.gray(shape)}`)
  }
  for (const line of WORDMARK) lines.push(`  ${p.bold(line.slice(0, wordmarkColumns))}`)
  const done = wordmarkColumns >= (WORDMARK[0]?.length ?? 0)
  lines.push(done ? `  ${p.dim(`${t(locale, 'tagline')} · v${VERSION}`)}` : '')
  return lines
}

export function shouldAnimate(motion: boolean | undefined): boolean {
  return Boolean(
    process.stdout.isTTY &&
      process.stdin.isTTY &&
      motion !== false &&
      !process.env.CI &&
      !process.env.RAMPA_NO_MOTION &&
      !process.env.NO_MOTION &&
      process.env.TERM !== 'dumb',
  )
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/**
 * Plays for about 1.2 s and never longer than 2 s; any key skips it.
 * With motion off, or when a screen reader would hear every redraw, only the
 * final frame is printed.
 */
export async function intro(locale: Locale, motion: boolean | undefined): Promise<void> {
  const p = paint(colorsEnabled())
  const finalFrame = scene(ROWS, WORDMARK[0]?.length ?? 0, p, locale)
  if (!shouldAnimate(motion)) {
    process.stdout.write(`${finalFrame.join('\n')}\n`)
    return
  }

  const out = process.stdout
  const stdin = process.stdin
  let skipped = false
  const onKey = (data: Buffer) => {
    skipped = true
    if (data[0] === 3) {
      restore()
      process.exit(130)
    }
  }
  const restore = () => {
    out.write('\x1b[?25h')
    if (stdin.isTTY) stdin.setRawMode(false)
    stdin.off('data', onKey)
    stdin.pause()
  }
  process.once('exit', () => out.write('\x1b[?25h'))

  stdin.setRawMode(true)
  stdin.resume()
  stdin.on('data', onKey)
  out.write('\x1b[?25l')

  const frames: string[][] = []
  for (let rampRows = 0; rampRows <= ROWS; rampRows++) frames.push(scene(rampRows, 0, p, locale))
  const width = WORDMARK[0]?.length ?? 0
  for (let columns = 4; columns < width; columns += 4) frames.push(scene(ROWS, columns, p, locale))
  frames.push(finalFrame)

  let drawn = 0
  const draw = (frame: string[]) => {
    if (drawn > 0) out.write(`\x1b[${drawn}F`)
    for (const line of frame) out.write(`\x1b[2K${line}\n`)
    drawn = frame.length
  }

  const started = Date.now()
  for (const [index, frame] of frames.entries()) {
    if (skipped || Date.now() - started > 2000) break
    draw(frame)
    await sleep(index <= ROWS ? 120 : 60)
  }
  draw(finalFrame)
  restore()
}

export function menu(locale: Locale): string {
  const p = paint(colorsEnabled())
  const rows: Array<[string, string]> = [
    ['rampa check <url|file|snapshot.json>', t(locale, 'menuCheck')],
    ['rampa eval --criteria 1.1.1,3.1.2', t(locale, 'menuEval')],
    ['rampa models', t(locale, 'menuModels')],
    ['rampa doctor', t(locale, 'menuDoctor')],
    ['rampa mcp', t(locale, 'menuMcp')],
  ]
  const width = Math.max(...rows.map(([command]) => command.length)) + 3
  return [
    '',
    `  ${p.bold(t(locale, 'menuIntro'))}`,
    ...rows.map(([command, description]) => `  ${p.cyan(command.padEnd(width))}${description}`),
    '',
    `  ${p.dim(t(locale, 'menuHelp'))}`,
    '',
  ].join('\n')
}

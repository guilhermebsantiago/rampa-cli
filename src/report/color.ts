import { styleText } from 'node:util'

type Style = Parameters<typeof styleText>[0]

/** Colors only on a TTY that supports them; NO_COLOR and FORCE_COLOR are respected. */
export function colorsEnabled(stream: NodeJS.WriteStream = process.stdout): boolean {
  if (process.env.NO_COLOR !== undefined && process.env.NO_COLOR !== '') return false
  if (process.env.FORCE_COLOR !== undefined && process.env.FORCE_COLOR !== '0') return true
  return Boolean(stream.isTTY && stream.hasColors?.())
}

export function paint(enabled: boolean) {
  const apply = (style: Style) => (text: string) => (enabled ? styleText(style, text, { validateStream: false }) : text)
  return {
    bold: apply('bold'),
    dim: apply('dim'),
    red: apply('red'),
    green: apply('green'),
    yellow: apply('yellow'),
    cyan: apply('cyan'),
    gray: apply('gray'),
    redBold: apply(['red', 'bold']),
    cyanBold: apply(['cyan', 'bold']),
  }
}

export type Painter = ReturnType<typeof paint>

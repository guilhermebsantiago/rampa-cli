import { mkdir, stat, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { RampaError } from '../../core/util.ts'
import { compareRuns, loadRun } from '../../eval/compare.ts'
import { comparisonMarkdown, renderComparison } from '../../eval/compare-render.ts'
import { colorsEnabled, paint } from '../../report/color.ts'

export interface CompareCommandOptions {
  /** true prints Markdown instead of the terminal view; a string writes it to that file. */
  markdown?: boolean | string
  /** true prints JSON instead of the terminal view; a string writes it to that file. */
  json?: boolean | string
}

/** A run is its directory; a file inside it, such as summary.json, stands for the directory. */
async function runDirectory(input: string): Promise<string> {
  const info = await stat(input).catch(() => undefined)
  if (!info) throw new RampaError('run-not-found', `Run not found: ${input}. Give a directory written by rampa eval, such as .rampa/runs/<run>.`)
  return info.isDirectory() ? input : dirname(input)
}

async function writeOutput(flag: string, file: string, content: string): Promise<void> {
  // `--markdown <dir> <dir>` would take the first run directory as the file name.
  if ((await stat(file).catch(() => undefined))?.isDirectory()) {
    throw new RampaError('invalid-option', `${flag} takes a file name, and ${file} is a directory. Put ${flag} after the run directories, or write ${flag}=FILE.`)
  }
  await mkdir(dirname(file), { recursive: true })
  await writeFile(file, content, 'utf8')
  process.stderr.write(`${flag.slice(2)}: ${file}\n`)
}

export async function runCompare(dirs: string[], options: CompareCommandOptions): Promise<number> {
  if (options.markdown === true && options.json === true) {
    throw new RampaError('invalid-option', 'Only one of --markdown and --json can go to the terminal; give the other a file name.')
  }
  const runs = await Promise.all(dirs.map(async (dir) => loadRun(await runDirectory(dir))))
  const comparison = compareRuns(runs)

  if (typeof options.markdown === 'string') await writeOutput('--markdown', options.markdown, comparisonMarkdown(comparison))
  if (typeof options.json === 'string') await writeOutput('--json', options.json, `${JSON.stringify(comparison, null, 2)}\n`)

  if (options.markdown === true) process.stdout.write(comparisonMarkdown(comparison))
  else if (options.json === true) process.stdout.write(`${JSON.stringify(comparison, null, 2)}\n`)
  else process.stdout.write(`\n${renderComparison(comparison, paint(colorsEnabled()))}\n\n`)
  return 0
}

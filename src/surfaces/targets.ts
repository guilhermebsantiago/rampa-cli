import { readFile, readdir, stat } from 'node:fs/promises'
import type { EngineResults } from '../core/types.ts'
import { extname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { RampaError } from '../core/util.ts'
import { type A11ySnapshot, A11ySnapshotSchema } from '../snapshot/schema.ts'

export type Target = { kind: 'web'; url: string; label: string } | { kind: 'snapshot'; path: string; label: string }

/** URLs, HTML files, folders of HTML files and snapshot .json files exported by any platform. */
export async function resolveTargets(inputs: readonly string[]): Promise<Target[]> {
  const targets: Target[] = []
  for (const input of inputs) {
    if (/^https?:\/\//i.test(input) || input.startsWith('file://')) {
      targets.push({ kind: 'web', url: input, label: input })
      continue
    }
    const path = resolve(input)
    const info = await stat(path).catch(() => undefined)
    if (!info) throw new RampaError('target-not-found', `Target not found: ${input}`)
    if (info.isDirectory()) {
      for (const file of await htmlFilesIn(path)) {
        targets.push({ kind: 'web', url: pathToFileURL(file).href, label: file })
      }
      continue
    }
    const ext = extname(path).toLowerCase()
    if (ext === '.json') targets.push({ kind: 'snapshot', path, label: input })
    else if (ext === '.html' || ext === '.htm') targets.push({ kind: 'web', url: pathToFileURL(path).href, label: input })
    else throw new RampaError('unsupported-target', `Unsupported target: ${input}. Use a URL, an .html file, a folder or a snapshot .json.`)
  }
  return targets
}

async function htmlFilesIn(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true, recursive: true })
  return entries
    .filter((entry) => entry.isFile() && /\.html?$/i.test(entry.name))
    .map((entry) => join(entry.parentPath, entry.name))
    .sort()
}

export async function loadSnapshot(path: string): Promise<A11ySnapshot> {
  const data: unknown = JSON.parse(await readFile(path, 'utf8'))
  const parsed = A11ySnapshotSchema.safeParse(data)
  if (!parsed.success) {
    throw new RampaError('invalid-snapshot', `${path} is not a valid Rampa snapshot:\n${parsed.error.message}`)
  }
  return parsed.data
}

/** Engine results recorded next to a snapshot by `rampa check --save`: `x.snapshot.json` becomes `x.engine.json`. */
export async function loadEngineFor(snapshotPath: string): Promise<EngineResults | undefined> {
  const enginePath = snapshotPath.endsWith('.snapshot.json')
    ? snapshotPath.replace(/\.snapshot\.json$/, '.engine.json')
    : snapshotPath.replace(/\.json$/, '.engine.json')
  try {
    const engine = JSON.parse(await readFile(enginePath, 'utf8')) as EngineResults
    return engine?.engine?.name && Array.isArray(engine.rules) ? engine : undefined
  } catch {
    return undefined
  }
}

/** A file-system friendly name for a target: `examples/store/before.html` becomes `examples-store-before`. */
export function recordingName(label: string): string {
  const name = label
    .replace(/^[a-z]+:\/\//i, '')
    .replace(/\.html?$/i, '')
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
  return name || 'page'
}

import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { CliCall } from './types.ts'

// The CLIs' output is untyped JSON; these read it without trusting its shape.
export const record = (value: unknown): Record<string, unknown> => (value && typeof value === 'object' ? (value as Record<string, unknown>) : {})
export const number = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) ? value : 0)

/** One JSON event per line, as the CLIs stream them; lines that are not JSON are skipped. */
export function parseJsonLines(stdout: string): Array<Record<string, unknown>> {
  return stdout.split(/\r?\n/).flatMap((line) => {
    const text = line.trim()
    if (!text.startsWith('{')) return []
    try {
      return [record(JSON.parse(text))]
    } catch {
      return []
    }
  })
}

/** For a CLI that takes no schema: the instructions carry it, as the API providers' schemaInPrompt path does. */
export function withSchema(instructions: string, jsonSchema: Record<string, unknown>): string {
  return `${instructions}

Answer with only a JSON object that follows this JSON schema:
${JSON.stringify(jsonSchema)}`
}

/** The JSON object in a model's text answer, with or without a code fence around it; undefined when there is none. */
export function parseJsonText(text: string): unknown {
  const trimmed = text.trim()
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed)?.[1] ?? trimmed
  for (const candidate of [fenced, fenced.slice(fenced.indexOf('{'), fenced.lastIndexOf('}') + 1)]) {
    if (!candidate) continue
    try {
      return JSON.parse(candidate)
    } catch {
      // try the next form
    }
  }
  return undefined
}

const EXTENSIONS: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' }

/** Writes the call's images into its directory, for a CLI that takes images as files; returns their paths. */
export async function writeImages(call: CliCall): Promise<string[]> {
  return Promise.all(
    call.images.map(async (image, index) => {
      const path = join(call.dir, `image-${index + 1}.${EXTENSIONS[image.mediaType] ?? 'png'}`)
      await writeFile(path, image.data)
      return path
    }),
  )
}

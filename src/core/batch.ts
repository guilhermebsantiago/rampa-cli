import { z } from 'zod'
import { pageData } from './util.ts'

/**
 * Batched judgment: several candidates of one criterion in one model call (`Criterion.batch`, `--batch`, on in --fast).
 * Each candidate keeps its own prompt, wrapped in an <item> with an id, under the criterion's own instructions, and the
 * answer holds one judgment per id. Every judgment still goes through the criterion's `settle` and `verify`, as one
 * from a call of its own; and since verification checks each claim against its own candidate, an answer that mixes up
 * two items is discarded, never reported. Batches are cached by their own prompt, never as a candidate's.
 */

/** Added to the criterion's instructions: one question per item, each judged as if it were the only one. */
export const BATCH_SYSTEM = `This request holds several items. Each item is the question above about a different element, between <item id="N"> and </item>. Where the instructions above speak of one element, they mean the element of each item.
Judge every item on its own, exactly as if it were the only one: never let what one item says decide another item's answer, and never quote one item's text in another's answer.
Answer with one entry per item in "items", in the order given, each with the item's id and its judgment written as the instructions above ask.`

/** The prompt of a batch: the criterion's instructions with the batch note, and each candidate's question as an item. */
export function batchPrompt(system: string, users: readonly string[]): { system: string; user: string; ids: string[] } {
  const ids = users.map((_, index) => String(index + 1))
  // An item's page data cannot end the item either (pageData): a `</item>` in it is escaped, as its own blocks' tags are.
  const user = users.map((text, index) => `<item id="${ids[index]}">\n${pageData('item', text)}\n</item>`).join('\n\n')
  return { system: `${system}\n\n${BATCH_SYSTEM}`, user, ids }
}

export interface BatchAnswer<Out> {
  items: Array<{ id: string; judgment: Out }>
}

/** The answer schema of a batch: one judgment per item, in the criterion's own schema, with the item's id. */
export function batchSchema<Out>(schema: z.ZodType<Out>, ids: readonly string[]): z.ZodType<BatchAnswer<Out>> {
  const [first, ...rest] = ids
  if (first === undefined) throw new Error('a batch needs at least one item')
  return z.strictObject({
    items: z
      .array(z.strictObject({ id: z.enum([first, ...rest]).describe('The id of the item this judgment answers'), judgment: schema }))
      .describe('One entry per item, in the order given'),
  }) as unknown as z.ZodType<BatchAnswer<Out>>
}

/** Each item's judgment, by id: the first one given for it. An id the answer left out is absent, and its candidate is asked alone. */
export function batchAnswers<Out>(answer: BatchAnswer<Out>, ids: readonly string[]): Map<string, Out> {
  const found = new Map<string, Out>()
  for (const item of answer.items) if (ids.includes(item.id) && !found.has(item.id)) found.set(item.id, item.judgment)
  return found
}

/**
 * The most item text one batch holds, in characters. With the criterion's instructions (3,000 to 5,000 characters) and
 * an answer per item, a batch stays well inside a 4,096-token context, the one Ollama gives a local model by default
 * (at about 3.5 characters a token); past it, Ollama cuts the prompt without saying so.
 */
export const BATCH_CHARS = 4000

/**
 * `items` split into batches in order: as few as `max` items each allows, of sizes as even as can be, and a new batch
 * whenever the next item's text (`size`) would take one past `budget` characters. An item larger than the budget alone
 * makes a batch of one, which is asked alone.
 */
export function batchesOf<T>(items: readonly T[], max: number, size: (item: T) => number = () => 0, budget: number = BATCH_CHARS): T[][] {
  if (items.length === 0) return []
  const target = Math.ceil(items.length / Math.ceil(items.length / Math.max(1, max)))
  const batches: T[][] = []
  let current: T[] = []
  let chars = 0
  for (const item of items) {
    const length = size(item)
    if (current.length > 0 && (current.length >= target || chars + length > budget)) {
      batches.push(current)
      current = []
      chars = 0
    }
    current.push(item)
    chars += length
  }
  batches.push(current)
  return batches
}

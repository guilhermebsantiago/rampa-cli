import { z } from 'zod'

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
  const user = users.map((text, index) => `<item id="${ids[index]}">\n${text}\n</item>`).join('\n\n')
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

/** `items` split into as few batches of at most `max` as it takes, of sizes as even as can be, in order. */
export function batchesOf<T>(items: readonly T[], max: number): T[][] {
  if (items.length === 0) return []
  const count = Math.ceil(items.length / Math.max(1, max))
  const size = Math.ceil(items.length / count)
  const batches: T[][] = []
  for (let start = 0; start < items.length; start += size) batches.push(items.slice(start, start + size))
  return batches
}

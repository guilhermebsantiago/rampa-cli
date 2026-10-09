import { z } from 'zod'

/**
 * The normalized accessibility snapshot is the only thing criteria, prompts and
 * verification ever read. Every surface (web, Android, iOS, desktop, a bare
 * image) is converted into this shape first, so the core stays platform-agnostic.
 */

export const SURFACES = ['web', 'android', 'ios', 'windows', 'macos', 'image'] as const
export const SurfaceSchema = z.enum(SURFACES)
export type Surface = z.infer<typeof SurfaceSchema>

export const BoundsSchema = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number(),
})
export type Bounds = z.infer<typeof BoundsSchema>

export interface A11yNode {
  /** Native locator that resolves to exactly one node: CSS selector, resource-id, accessibilityIdentifier or XPath. */
  ref: string
  /** Role normalized to ARIA (button, link, img, heading, textbox, paragraph, generic...). */
  role: string
  /** Accessible name: alt, aria-label, contentDescription, accessibilityLabel... */
  name?: string | undefined
  /** Text owned directly by this node (not its descendants). */
  text?: string | undefined
  /** Language declared on this node itself: lang, accessibilityLanguage... */
  lang?: string | undefined
  /** States such as hidden, aria-hidden, disabled, checked, expanded, selected, focusable, and broken for an image that did not load. */
  states: string[]
  bounds?: Bounds | undefined
  /** The node as rendered (PNG data URI or file path), for criteria that need vision. */
  image?: string | undefined
  /** Raw platform attributes, kept for prompts and patches. */
  native: Record<string, unknown>
  children: A11yNode[]
}

export const A11yNodeSchema: z.ZodType<A11yNode> = z.lazy(() =>
  z.object({
    ref: z.string().min(1),
    role: z.string(),
    name: z.string().optional(),
    text: z.string().optional(),
    lang: z.string().optional(),
    states: z.array(z.string()),
    bounds: BoundsSchema.optional(),
    image: z.string().optional(),
    native: z.record(z.string(), z.unknown()),
    children: z.array(A11yNodeSchema),
  }),
)

export const A11ySnapshotSchema = z.object({
  schemaVersion: z.literal(1),
  surface: SurfaceSchema,
  /** URL, Android package, iOS bundle id or file path. */
  target: z.string(),
  title: z.string().optional(),
  /** Default language of the screen (html lang, app locale). */
  locale: z.string().optional(),
  viewport: z.object({ width: z.number(), height: z.number(), scale: z.number() }),
  root: A11yNodeSchema,
  screenshot: z.string().optional(),
  source: z
    .object({
      kind: z.enum(['html', 'android-xml', 'ios-xml', 'uia-xml']),
      path: z.string(),
    })
    .optional(),
  truncated: z.boolean().optional(),
  collectedAt: z.string(),
  collector: z.object({ name: z.string(), version: z.string() }),
})
export type A11ySnapshot = z.infer<typeof A11ySnapshotSchema>

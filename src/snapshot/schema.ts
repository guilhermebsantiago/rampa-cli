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
  /** States such as hidden, aria-hidden, disabled, readonly, checked, expanded, selected, focusable, and broken for an image that did not load. */
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

/**
 * What a link's address leads to, as Rampa read it one level deep (see docs/link-purpose.md).
 * Recorded in the snapshot, so a saved snapshot is judged with the same facts offline.
 */
export const DestinationSchema = z.object({
  /**
   * page: an HTML page was read. file: something else was served, so only its type and size are known.
   * same-page: the address points within the page itself. unreadable: nothing could be read; `reason` says why.
   */
  kind: z.enum(['page', 'file', 'same-page', 'unreadable']),
  /** HTTP status of the last response; absent for local files. */
  status: z.number().optional(),
  /** Where the address ended after redirects, when that differs from the address itself. */
  finalUrl: z.string().optional(),
  contentType: z.string().optional(),
  bytes: z.number().optional(),
  title: z.string().optional(),
  /** The page's first h1. */
  heading: z.string().optional(),
  /** The page's meta description. */
  description: z.string().optional(),
  /** The text where the address's #fragment points. */
  section: z.string().optional(),
  /** Why nothing could be read: not found, sign-in, timeout... */
  reason: z.string().optional(),
})
export type Destination = z.infer<typeof DestinationSchema>

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
  /** Where the page's links lead, keyed by the href as written, for the links Rampa followed. */
  destinations: z.record(z.string(), DestinationSchema).optional(),
  /** Other pages of the same site that a crawl had read when this one was judged, with their titles (2.4.2). */
  siblings: z.array(z.object({ url: z.string(), title: z.string() })).optional(),
  collectedAt: z.string(),
  collector: z.object({ name: z.string(), version: z.string() }),
})
export type A11ySnapshot = z.infer<typeof A11ySnapshotSchema>

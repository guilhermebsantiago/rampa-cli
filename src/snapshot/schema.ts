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

/**
 * What the browser itself exposes for a node: Chromium's accessibility tree, read over CDP after collection
 * (surfaces/ax-tree.ts). The collector's own `role` and `name` are an approximation; these are what assistive
 * technology gets from the browser. Absent on other surfaces, without CDP, and for elements the browser keeps
 * no node for (plain containers, text-level elements, content that is not rendered). See docs/rules.md.
 */
export const AxFactsSchema = z.object({
  /** The role the browser computed, in Chromium's words: an ARIA role (button, image, generic...) or an internal one (LabelText, RootWebArea...). */
  role: z.string(),
  /** The accessible name the browser computed, recorded only when it differs from the node's `name`: absent, the two agree. */
  name: z.string().optional(),
  /** Where the name came from, when there is one: aria-labelledby, aria-label, label, alt, title, value, placeholder, contents, caption, legend... */
  nameFrom: z.string().optional(),
  /** The accessible description (aria-describedby, title...). */
  description: z.string().optional(),
  /** The value the browser exposes for a field, a slider or a combobox. */
  value: z.string().optional(),
  /** States and properties the browser exposes, besides their defaults: focusable, checked, expanded, pressed, selected, level, live... */
  props: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
  /**
   * Relations the browser resolved (labelledby, describedby, controls, owns...), as the refs of the elements they point
   * to. `controls` also holds what aria-controls names while it is hidden, which the browser leaves out of its tree.
   */
  relations: z.record(z.string(), z.array(z.string())).optional(),
  /** The browser leaves the element out of what it exposes (aria-hidden, a presentational role...). */
  ignored: z.boolean().optional(),
  /** Why, in Chromium's words: ariaHiddenElement, ariaHiddenSubtree, presentationalRole, inertElement... */
  ignoredReasons: z.array(z.string()).optional(),
  /**
   * For an element focusable by tabindex or with an inline handler and a role that is not a control's: the events it
   * listens to itself (click, keydown...), read over CDP, and whether it scrolls. Delegated listeners are not seen.
   */
  listeners: z.array(z.string()).optional(),
  scrollable: z.boolean().optional(),
})
export type AxFacts = z.infer<typeof AxFactsSchema>

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
  /** What the browser exposes for the node, when the collector read its accessibility tree (web, Chromium). */
  ax?: AxFacts | undefined
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
    ax: AxFactsSchema.optional(),
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

/**
 * What a probe saw while it drove the page read-only (keys, focus, viewport, injected CSS),
 * after collection: facts, never verdicts. Rules turn them into findings, so a saved snapshot
 * is judged again offline with no browser. See docs/probes.md.
 */
export const ProbeRecordSchema = z.object({
  kind: z.enum(['keyboard', 'layout', 'hover', 'orientation', 'shortcuts', 'media', 'auth', 'clock', 'interact', 'form']),
  /** The probe's version; each rule states which versions it reads. */
  version: z.string(),
  conditions: z.object({
    viewport: z.object({ width: z.number(), height: z.number() }),
    deviceScaleFactor: z.number(),
    /** Such as 'msedge 141.0.3537.57 (headless)'. */
    browser: z.string(),
    /** 'reflow-320x256', 'text-spacing'... */
    variant: z.string().optional(),
    colorScheme: z.enum(['light', 'dark']).optional(),
    reducedMotion: z.boolean().optional(),
  }),
  status: z.enum(['complete', 'partial', 'skipped']),
  /** Why the probe stopped early or did not run: 'stop budget reached (150)', 'page navigated away'. */
  reason: z.string().optional(),
  /** What the network guard did while the probe ran; `at` is milliseconds since the probe started. */
  guard: z.object({
    /** `type` is the browser's resource type: fetch, xhr, ping (sendBeacon), document, websocket... */
    blocked: z.array(z.object({ method: z.string(), url: z.string(), at: z.number(), type: z.string().optional() })),
    navigations: z.array(z.object({ url: z.string(), at: z.number(), cause: z.string().optional() })),
    dialogs: z.array(z.object({ type: z.string(), message: z.string(), at: z.number() })),
  }),
  durationMs: z.number(),
  /** Per kind: refs, identities, bounds and measured numbers. */
  data: z.unknown(),
})
export type ProbeRecord = z.infer<typeof ProbeRecordSchema>

export const ObservationsSchema = z.object({ probes: z.array(ProbeRecordSchema) })
export type Observations = z.infer<typeof ObservationsSchema>

/**
 * How far the collector got into the page beyond its own document (snapshot/reach.ts). Refs into frames and open
 * shadow roots follow snapshot/refs.ts. Absent when the page has no frame and no shadow root, and in snapshots
 * recorded before the collector entered them.
 */
export const ReachSchema = z.object({
  /** Every frame met: whether its document is in the tree, under the frame's node, and whether the engine checked it. */
  frames: z
    .array(
      z.object({
        /** The frame element's ref. */
        ref: z.string(),
        /** The frame's address: its document's URL when the page may read it, else its src. */
        url: z.string().optional(),
        /** The frame's document is in the tree. */
        collected: z.boolean(),
        /** Why it is not: hidden (not rendered), cross-origin (the page may not read it), not-loaded (still blank, as a lazy frame below the fold), empty (no document). */
        reason: z.string().optional(),
        /** axe-core ran in the frame; absent when the engine did not run on the page. */
        engine: z.boolean().optional(),
        /**
         * Why it did not: skipped (axe-core leaves out frames hidden from assistive technology and frames outside the
         * checked part of the page), or what stopped it: the frame budget, a frame the browser library could not reach.
         */
        engineReason: z.string().optional(),
      }),
    )
    .optional(),
  /** Open shadow roots in the tree, and closed ones the browser reported, which no script can read. */
  shadowRoots: z
    .object({
      open: z.number(),
      closed: z.number().optional(),
      /** Refs of the hosts of closed shadow roots, at most 10. */
      closedHosts: z.array(z.string()).optional(),
    })
    .optional(),
  /** The page was still changing (network or DOM) when the wait after load reached its cap, in milliseconds. */
  unsettledAfterMs: z.number().optional(),
  /**
   * Shadow roots and frames have a budget of elements of their own, next to the page's (`truncated`): the
   * collector stopped at it, so what follows in them is not in the snapshot.
   */
  truncated: z.boolean().optional(),
})
export type Reach = z.infer<typeof ReachSchema>

/**
 * How the collector read the browser's accessibility tree (surfaces/ax-tree.ts), so a report can say what was left
 * out. Absent when it was not read: another surface, a browser without CDP, a snapshot recorded before Rampa read it.
 */
export const AxTreeSchema = z.object({
  /** cdp: Chromium's Accessibility.getFullAXTree, one call per document. */
  source: z.string(),
  /** Elements of the snapshot that carry the browser's facts (`ax`). */
  nodes: z.number(),
  /** Elements of the snapshot the browser keeps no node of its own for: plain containers, text-level elements, content not rendered. */
  withoutNode: z.number(),
  /** Elements whose name the browser computes otherwise than the collector: both are recorded (`name` and `ax.name`). */
  namesDiffer: z.number(),
  /** Why the tree was not read at all, such as a page over the limit of elements; nothing carries `ax` then. */
  skipped: z.string().optional(),
  /** Frames whose documents are in the snapshot but whose tree was not read, and why (the frame limit, the time budget, an error). */
  framesLeftOut: z.array(z.object({ ref: z.string(), reason: z.string() })).optional(),
  /** Elements whose own event listeners were read for the custom-control rule, and those left out past the limit. */
  listeners: z.object({ read: z.number(), leftOut: z.number() }).optional(),
})
export type AxTree = z.infer<typeof AxTreeSchema>

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
  /** Facts recorded by probes (`--probe`), read by the probe rules; absent when no probe ran. */
  observations: ObservationsSchema.optional(),
  /** Frames and shadow roots: what the collector and the engine reached, and what they could not. */
  reach: ReachSchema.optional(),
  /** The browser's accessibility tree: how much of it the collector read onto the nodes (`ax`), and what it left out. */
  axTree: AxTreeSchema.optional(),
  /** Other pages of the same site that a crawl had read when this one was judged, with their titles (2.4.2). */
  siblings: z.array(z.object({ url: z.string(), title: z.string() })).optional(),
  collectedAt: z.string(),
  collector: z.object({ name: z.string(), version: z.string() }),
})
export type A11ySnapshot = z.infer<typeof A11ySnapshotSchema>

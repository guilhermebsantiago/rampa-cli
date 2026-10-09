import type { A11yNode } from '../snapshot/schema.ts'
import { walkTree } from '../snapshot/tree.ts'

/**
 * The form issues Chromium raises on its own (DevTools' Issues panel, the CDP Audits domain): an autocomplete
 * attribute left empty, a token that is wrong but well intended ("telephone"), or a token written in the name or
 * id instead of autocomplete. They are recorded on the field as `native.formIssues`, and 1.3.5 reads them as
 * corroboration, never as a finding on their own. Enabling the Audits domain replays the issues raised so far,
 * so they are read after the page is collected, the same way for `rampa check` and for a test's own page.
 */

/** The Audits issue types about autocomplete that 1.3.5 can use; the rest (labels, ids) belong to other criteria. */
export const AUTOCOMPLETE_ISSUES = [
  'FormAutocompleteAttributeEmptyError',
  'FormInputHasWrongButWellIntendedAutocompleteValueError',
  'FormInputAssignedAutocompleteValueToIdOrNameAttributeError',
] as const
export type AutocompleteIssue = (typeof AUTOCOMPLETE_ISSUES)[number]

const MAX_ISSUES = 100
/** Replayed issues arrive as events next to the answer to Audits.enable; a short wait lets them all in. */
const REPLAY_WAIT_MS = 100

/** The part of a CDP session this module uses: Playwright's CDPSession fits it. */
export interface CdpSessionLike {
  send(method: string, params?: Record<string, unknown>): Promise<unknown>
  // biome-ignore lint/suspicious/noExplicitAny: CDP event payloads are untyped here; each handler checks what it reads
  on(event: string, handler: (payload: any) => void): unknown
  detach(): Promise<void>
}

interface GenericIssue {
  code?: string
  details?: { genericIssueDetails?: { errorType?: string; violatingNodeId?: number } }
}

/**
 * Writes Chromium's autocomplete issues onto the fields of the collected tree. Needs the collector's element-to-ref
 * map, which it leaves on the page. Any failure (no CDP, another browser) leaves the tree as it was.
 */
export async function attachFormIssues(open: () => Promise<CdpSessionLike | undefined>, root: A11yNode): Promise<void> {
  let session: CdpSessionLike | undefined
  try {
    session = await open()
    if (!session) return
    const issues = new Map<string, { type: AutocompleteIssue; backendNodeId: number }>()
    session.on('Audits.issueAdded', (event: { issue?: GenericIssue }) => {
      const details = event.issue?.details?.genericIssueDetails
      const type = details?.errorType as AutocompleteIssue | undefined
      if (event.issue?.code !== 'GenericIssue' || !type || !AUTOCOMPLETE_ISSUES.includes(type) || details?.violatingNodeId === undefined) return
      if (issues.size < MAX_ISSUES) issues.set(`${type}|${details.violatingNodeId}`, { type, backendNodeId: details.violatingNodeId })
    })
    await session.send('Audits.enable')
    await new Promise((resolve) => setTimeout(resolve, REPLAY_WAIT_MS))
    if (issues.size === 0) return
    const byRef = new Map<string, A11yNode>()
    for (const node of walkTree(root)) byRef.set(node.ref, node)
    for (const issue of issues.values()) {
      try {
        const { object } = (await session.send('DOM.resolveNode', { backendNodeId: issue.backendNodeId })) as { object: { objectId?: string } }
        if (!object.objectId) continue
        const { result } = (await session.send('Runtime.callFunctionOn', {
          objectId: object.objectId,
          functionDeclaration: 'function () { const refs = window.__rampaRefs; return refs ? refs.get(this) : undefined }',
          returnByValue: true,
        })) as { result: { value?: unknown } }
        const node = typeof result.value === 'string' ? byRef.get(result.value) : undefined
        if (!node) continue
        const recorded = Array.isArray(node.native.formIssues) ? (node.native.formIssues as string[]) : []
        // Events arrive in no fixed order; a sorted list keeps the snapshot, and the prompt, the same between runs.
        node.native.formIssues = [...new Set([...recorded, issue.type])].sort()
      } catch {
        // The node went away after the issue was raised.
      }
    }
  } catch {
    // No CDP for this page: the snapshot goes without the issues.
  } finally {
    await session?.detach().catch(() => undefined)
  }
}

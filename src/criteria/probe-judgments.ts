import type { AnyCriterion } from '../core/types.ts'
import type { A11ySnapshot } from '../snapshot/schema.ts'
import { authenticationJudgments } from './accessible-authentication.ts'
import { probeJudgments as shortcutJudgments } from './character-key-shortcuts.ts'
import { onInputJudgments } from './on-input.ts'
import { statusJudgments } from './status-messages.ts'
import { timingJudgments } from './timing-adjustable.ts'

/**
 * Judgments the probe records ask for: 2.1.4's "clearly labeled" when the shortcuts probe left that question,
 * 3.3.8's cognitive function test when the authentication probe quoted one, 3.2.2's advance warning when the
 * on-input probe saw a change of context, 4.1.3's "is this a status message?" when the status probe saw text that
 * nothing exposes, and 2.2.1's exceptions when the time-limit probe failed a time limit. checkSnapshot adds them to
 * the criteria it was given, so a model is asked only when there is something to ask, and only with judgment on. Each
 * may only clear its probe rule's finding, but 4.1.3's, which settles its rule's items to review (`Criterion.settles`).
 */
export function probeJudgments(snapshot: A11ySnapshot): AnyCriterion[] {
  return [...shortcutJudgments(snapshot), ...authenticationJudgments(snapshot), ...onInputJudgments(snapshot), ...statusJudgments(snapshot), ...timingJudgments(snapshot)]
}

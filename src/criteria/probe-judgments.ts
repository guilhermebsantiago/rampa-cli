import type { AnyCriterion } from '../core/types.ts'
import type { A11ySnapshot } from '../snapshot/schema.ts'
import { authenticationJudgments } from './accessible-authentication.ts'
import { probeJudgments as shortcutJudgments } from './character-key-shortcuts.ts'
import { parityJudgments } from './keyboard-parity.ts'
import { onInputJudgments } from './on-input.ts'

/**
 * Judgments the probe records ask for: 2.1.4's "clearly labeled" when the shortcuts probe left that question,
 * 3.3.8's cognitive function test when the authentication probe quoted one, 3.2.2's advance warning when the
 * on-input probe saw a change of context, and 2.1.1's equivalence and path-dependent exception when the parity probe
 * failed a control. checkSnapshot adds them to the criteria
 * it was given, so a model is asked only when there is something to ask, and only with judgment on. Each may only
 * clear its probe rule's finding.
 */
export function probeJudgments(snapshot: A11ySnapshot): AnyCriterion[] {
  return [...shortcutJudgments(snapshot), ...authenticationJudgments(snapshot), ...onInputJudgments(snapshot), ...parityJudgments(snapshot)]
}

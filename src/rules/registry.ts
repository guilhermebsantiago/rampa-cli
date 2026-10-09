import { focusObscuredNarrowRule, focusObscuredRule, focusVisibleRule } from './focus.ts'
import { keyboardReachRule, keyboardTrapRule, onFocusRule } from './keyboard.ts'
import { reflowRule, textSpacingRule } from './layout.ts'
import type { ProbeRule } from './probes.ts'

/** The probe rules every report runs; a rule with no record to read reports nothing, not even coverage. */
export const PROBE_RULES: readonly ProbeRule[] = [reflowRule, textSpacingRule, keyboardReachRule, keyboardTrapRule, onFocusRule, focusVisibleRule, focusObscuredRule, focusObscuredNarrowRule]

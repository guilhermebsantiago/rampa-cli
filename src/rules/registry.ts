import { focusObscuredNarrowRule, focusObscuredRule, focusVisibleRule } from './focus.ts'
import { keyboardReachRule, keyboardTrapRule, onFocusRule } from './keyboard.ts'
import { reflowRule, textSpacingRule, zoomRule } from './layout.ts'
import type { ProbeRule } from './probes.ts'

/** The probe rules every report runs; a rule with no record to read reports nothing, not even coverage. */
export const PROBE_RULES: readonly ProbeRule[] = [
  zoomRule,
  reflowRule,
  textSpacingRule,
  keyboardReachRule,
  keyboardTrapRule,
  onFocusRule,
  focusVisibleRule,
  focusObscuredRule,
  focusObscuredNarrowRule,
]

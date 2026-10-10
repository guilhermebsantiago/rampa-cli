import { focusObscuredNarrowRule, focusObscuredRule, focusVisibleRule } from './focus.ts'
import { keyboardReachRule, keyboardTrapRule, onFocusRule } from './keyboard.ts'
import { hoverRule } from './hover.ts'
import { reflowRule, textSpacingRule, zoomRule } from './layout.ts'
import { orientationRule } from './orientation.ts'
import type { ProbeRule } from './probes.ts'

/** The probe rules every report runs; a rule with no record to read reports nothing, not even coverage. */
export const PROBE_RULES: readonly ProbeRule[] = [
  zoomRule,
  reflowRule,
  textSpacingRule,
  hoverRule,
  orientationRule,
  keyboardReachRule,
  keyboardTrapRule,
  onFocusRule,
  focusVisibleRule,
  focusObscuredRule,
  focusObscuredNarrowRule,
]

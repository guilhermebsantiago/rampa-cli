/**
 * What `rampa eval` measures with, for scripts outside the CLI such as the benchmark in bench/: the W3C ACT test
 * cases and how Rampa maps them to criteria, the corrupted pairs, the scores, the WCAG list, and the rules and axe-core
 * settings behind each result, which the ACT implementation report (bench/act-report) maps to ACT rules. Built to
 * dist/eval/index.mjs; not part of the package's public API (package.json does not export it).
 */
export { ACT_RULES, ACT_TESTCASES_URL, PROPOSED_OUTCOMES, type ActDataset, type ActOutcome, type ActTestcase, loadActTestcases, selectRuleTestcases, selectTestcases } from './act.ts'
export { CORRUPTORS, LANGUAGE_SWAP, type Corruptor } from './pairs.ts'
export { type Confusion, type Scores, confusion, scores, wilson } from './metrics.ts'
export { WCAG22_A_AA, WCAG_CRITERIA, compareCriteria, criterionFromAxeTag, type SuccessCriterion } from '../wcag.ts'
export { CRITERIA, DEFAULT_CRITERIA } from '../criteria/index.ts'
export { PROBE_RULES } from '../rules/registry.ts'
export { RULE_CHECKS } from '../rules/index.ts'
export { AXE_REVIEW_RULES, EXPERIMENTAL_RULES, REVIEW_ONLY_RULES, axeTags } from '../engine/axe.ts'
export { probedCriteria } from './probed.ts'
export { VERSION } from '../version.ts'

// Every row of the benchmark: which module runs it, and how its findings are read.
// `failure` and `review` say, in the tool's own terms, what counts as a definite failure and what is left to a person.

export const TOOLS = {
  axe: {
    label: 'axe-core',
    module: '../tools/axe.mjs',
    failure: 'violations',
    review: 'incomplete ("needs review")',
    mapping: 'the wcag### tags of each rule',
  },
  lighthouse: {
    label: 'Lighthouse (accessibility category)',
    module: '../tools/lighthouse.mjs',
    failure: 'audits that score 0',
    review: 'none: manual audits are not run, and axe-core incompletes are not reported',
    mapping: 'each audit is the axe-core rule of the same id, read through its wcag### tags',
    // About ten times slower than axe-core per page, and a page that paints nothing ends its run (NO_FCP): it runs on
    // a sample, to show what it adds to axe-core, and stays out of the scored tables.
    sample: 3,
    scored: false,
  },
  pa11y: {
    label: 'Pa11y (HTML_CodeSniffer)',
    module: '../tools/pa11y.mjs',
    options: { runner: 'htmlcs' },
    failure: 'errors',
    review: 'warnings (Pa11y hides them by default); notices, which HTML_CodeSniffer raises on nearly every page ("Check that..."), are not counted',
    mapping: 'the success criterion in each HTML_CodeSniffer code (WCAG2AA.Principle1.Guideline1_1.1_1_1.H37 is 1.1.1)',
  },
  'pa11y-axe': {
    label: 'Pa11y (axe runner)',
    module: '../tools/pa11y.mjs',
    options: { runner: 'axe' },
    failure: 'errors (axe-core results of critical or serious impact, incomplete ones included)',
    review: 'warnings (moderate impact); notices (minor impact) are not counted',
    mapping: 'the wcag### tags of the axe-core rule',
  },
  ibm: {
    label: 'IBM Equal Access',
    module: '../tools/ibm.mjs',
    failure: 'violations',
    review: 'potential violations and manual checks (recommendations are not counted)',
    mapping: 'the checkpoints of the IBM_Accessibility rule set that list the rule',
  },
  alfa: {
    label: 'Siteimprove Alfa',
    module: '../tools/alfa.mjs',
    failure: 'failed outcomes',
    review: 'cantTell outcomes (questions with no one to answer them)',
    mapping: 'the WCAG criteria among each rule’s requirements',
  },
  qualweb: {
    label: 'QualWeb',
    module: '../tools/qualweb.mjs',
    failure: 'failed assertions',
    review: 'warnings; best practices, failed or not, are advice and not counted',
    mapping: 'the success-criteria metadata of each ACT rule and WCAG technique',
  },
  rampa: {
    label: 'Rampa, no model (--no-llm)',
    runner: 'rampa',
    args: ['--no-llm'],
    failure: 'findings at or above the default confidence threshold (what fails `rampa check`)',
    review: 'findings below the threshold (experimental checks) and items it sends to review',
    mapping: 'the criterion of each finding',
  },
  'rampa-gemma': {
    label: 'Rampa + Gemma 4 12B',
    runner: 'rampa',
    args: ['--model', 'ollama:gemma4:12b'],
    failure: 'findings at or above the default confidence threshold (what fails `rampa check`)',
    review: 'findings below the threshold (experimental checks, judgments of ordinary titles, links and headings) and items it sends to review',
    mapping: 'the criterion of each finding',
  },
  'rampa-probes': {
    label: 'Rampa + Gemma 4 12B + probes (--probe all)',
    runner: 'rampa',
    args: ['--model', 'ollama:gemma4:12b', '--probe', 'all'],
    // Probes only add findings on the criteria they check; every other page keeps rampa-gemma's result.
    probesOnly: true,
    inherit: 'rampa-gemma',
    // The judgments of the pages it reruns come from rampa-gemma's cache, so its time is collection and probes.
    shareCache: 'rampa-gemma',
    failure: 'findings at or above the default confidence threshold (what fails `rampa check`)',
    review: 'findings below the threshold and items it sends to review',
    mapping: 'the criterion of each finding',
  },
}

export const DEFAULT_ORDER = ['axe', 'lighthouse', 'pa11y', 'pa11y-axe', 'ibm', 'alfa', 'qualweb', 'rampa', 'rampa-gemma', 'rampa-probes']

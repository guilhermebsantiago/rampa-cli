// The tables of docs/benchmark.md, written from scores.json. Everything between the bench:tables markers of that
// file is generated; the method and the caveats around it are written by hand.
import { readFile, writeFile } from 'node:fs/promises'
import { compareIds } from './env.mjs'

const SHORT = {
  axe: 'axe-core',
  lighthouse: 'Lighthouse',
  pa11y: 'Pa11y',
  'pa11y-axe': 'Pa11y (axe)',
  ibm: 'IBM',
  alfa: 'Alfa',
  qualweb: 'QualWeb',
  rampa: 'Rampa',
  'rampa-gemma': 'Rampa + Gemma',
  'rampa-probes': 'Rampa + Gemma + probes',
}

const num = (value, digits = 2) => (value === undefined || value === null || Number.isNaN(value) ? '—' : value.toFixed(digits))
const ci = (interval) => (interval ? ` (${num(interval[0])}–${num(interval[1])})` : '')
const seconds = (ms) => (ms === undefined ? '—' : (ms / 1000).toFixed(ms < 10_000 ? 2 : 1))
const minutes = (ms) => (ms === undefined ? '—' : `${Math.round(ms / 60_000)} min`)
const row = (cells) => `| ${cells.join(' | ')} |`
const header = (cells, align) => [row(cells), row(align ?? cells.map(() => '---'))].join('\n')

export function renderReport({ scores, cases, pairs, run, names, levels, tools }) {
  const scored = Object.values(scores.tools).filter((tool) => tool.scored)
  const all = Object.values(scores.tools)
  const label = (tool) => SHORT[tool.id] ?? tool.label
  const lines = []
  const push = (...items) => lines.push(...items)

  const units = scores.units
  const failedUnits = scored[0]?.overall.failed ?? 0
  push(
    `Run of ${run.date}: Rampa ${run.rampaVersion} at \`${run.rampaCommit ?? '?'}\`${run.rampaDirty ? ' (with uncommitted changes)' : ''}, ACT test cases \`${run.act.sha256.slice(0, 8)}\`, ${cases.rules.length} ACT rules, ${cases.cases.length} test cases, ${units} units (a test case under each A/AA criterion its rule maps to), of which ${failedUnits} are failed examples. ${pairs.pairs.length} corrupted pairs. ${run.limit ? `**Smoke test: at most ${run.limit} cases per rule and ${run.limit} pairs per corruption.**` : ''}`,
    '',
  )

  // Versions
  push('### What ran', '')
  push(header(['Row', 'Versions', 'A failure is', 'Review is']))
  for (const tool of all) {
    const spec = tools[tool.id]
    const versions = Object.entries(tool.meta?.versions ?? {})
      .filter(([key]) => key !== 'browser')
      .map(([key, value]) => `${key} ${value}`)
      .join(', ')
    push(row([`${tool.label}${tool.scored ? '' : ' (sample, not scored)'}`, versions || '—', spec?.failure ?? '', spec?.review ?? '']))
  }
  const browsers = [...new Set(all.map((tool) => tool.meta?.versions?.browser).filter((b) => b && /\d/.test(b)))]
  push('', `Browser: ${browsers.join('; ') || 'Microsoft Edge'}. Machine: ${run.cpu}, ${run.memoryGb} GB, ${run.os}, Node ${run.node}. ${run.workers} pages at a time per tool, one tool at a time.`, '')

  // Overall
  push('### Overall, on the ACT test cases', '')
  push(
    'Recall: failed examples caught, under the criterion their rule maps to. Flagged: passed or inapplicable examples the tool failed under that criterion. 95% Wilson intervals in parentheses. "Only review" counts failed examples the tool did not fail but sent to review under that criterion.',
    '',
  )
  push(
    header(
      ['Tool', 'Caught', 'Recall', 'Passed flagged', 'Inapplicable flagged', 'Precision', 'F1', 'Only review', 'Pages not checked'],
      ['---', '---:', ':---:', '---:', '---:', ':---:', ':---:', '---:', '---:'],
    ),
  )
  for (const tool of scored) {
    const o = tool.overall
    push(
      row([
        label(tool),
        `${o.caught} / ${o.failed}`,
        `${num(o.recall)}${ci(o.recallCi)}`,
        `${o.passedFlagged} / ${o.passed}`,
        `${o.inapplicableFlagged} / ${o.inapplicable}`,
        `${num(o.precision)}${ci(o.precisionCi)}`,
        num(o.f1),
        String(o.reviewOnlyOnFailed),
        String(tool.time.errors),
      ]),
    )
  }
  push('')

  // Home advantage
  const homeRules = cases.rules.filter((rule) => cases.home.includes(rule.ruleId))
  push('### Home advantage: rules Rampa was built or tuned on', '')
  push(
    `${homeRules.length} of the ${cases.rules.length} rules are mentioned in Rampa's source or tests: its judged criteria were prompted, and its rules and probes adjusted, while reading their test cases. The other tools were not tuned on Rampa's cases, but axe-core, Alfa, QualWeb and IBM implement ACT rules and test against these same cases. Recall / precision / F1 on each side:`,
    '',
  )
  push(header(['Tool', `Rules Rampa was tuned on (${scored[0]?.home.n ?? 0} units)`, `Other rules (${scored[0]?.away.n ?? 0} units)`]))
  for (const tool of scored) {
    const side = (s) => `${num(s.recall)} / ${num(s.precision)} / ${num(s.f1)}`
    push(row([label(tool), side(tool.home), side(tool.away)]))
  }
  push('')

  // Coverage
  push('### Coverage of WCAG 2.2 A/AA criteria', '')
  push(
    `Of the 55 criteria, ${scores.criteria.length} have ACT test cases here. "Claims" counts the criteria the tool's own rule metadata maps a rule to (all 55, not only these). "Failed anything" counts criteria the tool reported a failure under on any page of this run, right or wrong; "true failure", criteria where at least one of those was a failed example. The last column scores each tool only on the criteria it failed anything under.`,
    '',
  )
  push(
    header(['Tool', 'Claims', 'Failed anything', 'At least one true failure', 'Recall / precision on those criteria'], ['---', '---:', '---:', '---:', ':---:']),
  )
  for (const tool of scored) {
    const c = tool.coverage
    push(row([label(tool), c.claimed ? String(c.claimed.length) : '—', String(c.failedAny.length), String(c.trueFailure.length), `${num(tool.onFailable.recall)} / ${num(tool.onFailable.precision)}`]))
  }
  push('', '<details><summary>Which criteria</summary>', '')
  push(header(['Tool', 'At least one true failure', 'Failed, never rightly']))
  for (const tool of scored) {
    const wrongOnly = tool.coverage.failedAny.filter((c) => !tool.coverage.trueFailure.includes(c))
    push(row([label(tool), tool.coverage.trueFailure.join(', ') || '—', wrongOnly.join(', ') || '—']))
  }
  push('', '</details>', '')

  // Per criterion
  push('### By criterion', '')
  push('Each cell: failed examples caught / failed examples, then passed or inapplicable examples flagged. ★ marks a criterion with a rule Rampa was tuned on.', '')
  push(header(['Criterion', 'Units', ...scored.map(label)], ['---', '---:', ...scored.map(() => ':---:')]))
  for (const criterion of scores.criteria) {
    const cells = scored.map((tool) => {
      const t = tool.byCriterion[criterion.criterion]
      return `${t.caught}/${t.failed} · ${t.passedFlagged + t.inapplicableFlagged}`
    })
    push(row([`${criterion.criterion} ${names[criterion.criterion] ?? ''} (${criterion.level})${criterion.home.length ? ' ★' : ''}`, `${criterion.failed} + ${criterion.others}`, ...cells]))
  }
  push('')

  // Pairs
  push('### Corrupted pairs', '')
  push(
    'A pair is a passed example of an ACT rule and a copy Rampa\'s corruptor broke on purpose (src/eval/pairs.ts). A tool tells a pair apart when it fails the copy under the pair\'s criterion and not the original. Criteria marked "opt-in" are not among the criteria Rampa judges by default, so the Rampa rows do not judge them.',
    '',
  )
  const pairRows = scored[0]?.pairs.rows ?? []
  push(header(['Criterion', 'Corruption', 'Pairs', ...scored.map(label)], ['---', '---', '---:', ...scored.map(() => '---:')]))
  for (const [index, pairRow] of pairRows.entries()) {
    push(
      row([
        `${pairRow.criterion}${pairRow.rampaDefault ? '' : ' (opt-in)'}`,
        `\`${pairRow.corruptor}\``,
        String(pairRow.total),
        ...scored.map((tool) => String(tool.pairs.rows[index]?.toldApart ?? '—')),
      ]),
    )
  }
  push(row(['**All**', '', `**${scored[0]?.pairs.total ?? 0}**`, ...scored.map((tool) => `**${tool.pairs.toldApart}**`)]))
  push(row(['Rampa\'s default criteria', '', String(scored[0]?.pairs.defaultTotal ?? 0), ...scored.map((tool) => String(tool.pairs.defaultToldApart))]))
  push(row(['Intact page already failed', '', '', ...scored.map((tool) => String(tool.pairs.intactFlagged))]))
  push('')
  if (pairs.dropped?.length) push(`${pairs.dropped.length} copies were left out because the corruptor changed nothing on them, as \`rampa eval\` leaves them out.`, '')

  // Time
  push('### Time per page', '')
  push(
    'Wall time from opening the page to the tool\'s results, on this machine, with the pages of one tool at a time. For the in-process tools that is a new browser context, navigation and the analysis; for Rampa, one `rampa check` process per 20 pages, timed between consecutive reports (collection, axe-core, its rules, judgments, probes). The first page of each Rampa process also starts Node and the browser: it is left out of the median and shown apart. ACT pages are tiny, so these are lower bounds for real pages.',
    '',
  )
  push(header(['Tool', 'Pages', 'Median (s)', '90th percentile (s)', 'Mean (s)', 'First page of a process (s)', 'Wall time', 'Model calls'], ['---', '---:', '---:', '---:', '---:', '---:', '---:', '---:']))
  for (const tool of all) {
    const t = tool.time
    push(
      row([
        label(tool),
        String(t.pages),
        seconds(t.medianMs),
        seconds(t.p90Ms),
        seconds(t.meanMs),
        seconds(t.coldMeanMs),
        minutes(t.wallMs),
        t.modelCalls || t.cachedCalls ? `${t.modelCalls} (${t.cachedCalls} cached)` : '—',
      ]),
    )
  }
  push('')

  // Sensitivity: counting review
  push('### If review items counted as failures', '')
  push(
    'The same units, now counting what each tool sends to a person (lib/tools.mjs says what that is for each) as if it were a failure. For Rampa that includes findings below the default confidence threshold; "Rampa + Gemma, low confidence counted" adds those findings and nothing else, which is how `rampa eval` scores.',
    '',
  )
  push(header(['Tool', 'Recall', 'Passed flagged', 'Inapplicable flagged', 'Precision', 'F1'], ['---', ':---:', '---:', '---:', ':---:', ':---:']))
  for (const tool of scored) {
    const o = tool.overallWithReview
    push(row([label(tool), num(o.recall), `${o.passedFlagged} / ${o.passed}`, `${o.inapplicableFlagged} / ${o.inapplicable}`, num(o.precision), num(o.f1)]))
  }
  for (const tool of scored.filter((t) => t.overallWithLow)) {
    const o = tool.overallWithLow
    push(row([`${label(tool)}, low confidence counted`, num(o.recall), `${o.passedFlagged} / ${o.passed}`, `${o.inapplicableFlagged} / ${o.inapplicable}`, num(o.precision), num(o.f1)]))
  }
  push('')

  // False positives that independent engines share
  const shared = scores.sharedFalsePositives
  if (shared?.engines.length >= 4) {
    push('### False positives the engines share', '')
    push(
      `A passed or inapplicable example can still fail its criterion for a reason its rule does not test. When at least three of the other independent engines (${shared.engines.map((id) => SHORT[id]).join(', ')}) fail the same example under the same criterion, that is likely. For each tool, its false positives and how many of them at least three other engines share:`,
      '',
    )
    push(header(['Tool', 'False positives', 'Shared with 3+ other engines'], ['---', '---:', '---:']))
    for (const tool of scored) {
      const s = shared.perTool[tool.id]
      if (s) push(row([label(tool), String(s.falsePositives), String(s.sharedWithThreeOthers)]))
    }
    push('')
    if (shared.widespread.length) {
      push('<details><summary>Examples at least four engines fail</summary>', '')
      for (const w of shared.widespread) push(`- ${w.criterion}, ${w.ruleId} ${w.title} (${w.expected}): ${w.engines.map((id) => SHORT[id]).join(', ')}`)
      push('', '</details>', '')
    }
  }

  // Engines compared
  const lh = scores.comparisons.lighthouse
  if (lh) {
    push('### Lighthouse against axe-core, page by page', '')
    push(
      `On ${lh.pages} pages both checked (the first ${tools.lighthouse.sample} test cases of each rule): ${lh.failuresNotInAxe.length === 0 ? 'every audit Lighthouse failed was a violation axe-core reported on the same page' : `${lh.failuresNotInAxe.length} pages had a Lighthouse failure axe-core did not report (${lh.failuresNotInAxe.map((p) => `${p.id}: ${p.rules.join(', ')}`).join('; ')})`}. axe-core WCAG failures Lighthouse did not report: ${Object.entries(lh.axeWcagFailuresLighthouseMissed).map(([rule, n]) => `\`${rule}\` (${n})`).join(', ') || 'none'}. Lighthouse returned no audits on ${lh.errors} pages (${lh.errorKinds.join(', ') || '—'}).`,
      '',
    )
  }
  const pa = scores.comparisons.pa11yAxe
  if (pa) {
    push("### Pa11y's axe runner against axe-core, page by page", '')
    const list = (map) => Object.entries(map).map(([rule, n]) => `\`${rule}\` (${n})`).join(', ') || 'none'
    push(
      `On ${pa.pages} pages both checked. Pa11y errors that axe-core itself left incomplete: ${list(pa.errorsFromAxeIncomplete)}. axe-core WCAG violations Pa11y reported as a warning or notice: ${list(pa.axeViolationsDemoted)}; and not at all: ${list(pa.axeViolationsAbsent)}.`,
      '',
    )
  }

  // Errors
  const withErrors = all.filter((tool) => tool.time.errors > 0)
  if (withErrors.length) {
    push('### Pages a tool could not check', '')
    for (const tool of withErrors) push(`- ${tool.label}: ${tool.time.errors}. ${tool.errorSamples.map((e) => `\`${e.id}\`: ${e.error}`).join('; ')}`)
    push('')
  }

  // Per rule
  push('<details><summary>By ACT rule</summary>', '')
  push(header(['Rule', 'Criteria', 'Cases', ...scored.map(label)], ['---', '---', '---:', ...scored.map(() => ':---:')]))
  for (const rule of scores.rules) {
    push(
      row([
        `[${rule.ruleId}](https://www.w3.org/WAI/standards-guidelines/act/rules/${rule.ruleId}/) ${rule.ruleName.replace(/\|/g, '\\|')}${rule.home ? ' ★' : ''}`,
        rule.criteria.join(', '),
        String(rule.cases),
        ...scored.map((tool) => {
          const t = tool.byRule[rule.ruleId]
          return t ? `${t.caught}/${t.failed} · ${t.passedFlagged + t.inapplicableFlagged}` : '—'
        }),
      ]),
    )
  }
  push('', 'A rule that maps to two criteria counts each of its cases once per criterion here.', '', '</details>', '')

  // Exclusions
  push('<details><summary>ACT rules left out</summary>', '')
  for (const skipped of cases.excluded.skipped) push(`- [${skipped.ruleId}](https://www.w3.org/WAI/standards-guidelines/act/rules/${skipped.ruleId}/) ${skipped.ruleName} (${skipped.cases} cases): ${skipped.reason}`)
  push(
    `- ${cases.excluded.noCriterion.length} rules map to no WCAG 2.2 A/AA criterion for conformance (AAA only, WAI-ARIA or technique requirements only, or a WCAG criterion only as a secondary requirement): ${cases.excluded.noCriterion.map((r) => r.ruleId).join(', ')}.`,
    `- ${cases.excluded.notHtml} SVG and XML test cases of the rules kept: Rampa's eval loads only HTML documents, so no tool runs them.`,
    '',
    '</details>',
  )
  return `${lines.join('\n')}\n`
}

/** The headline: one row per scored tool, the numbers a reader looks for first. */
export function renderSummary({ scores, cases, pairs, run }) {
  const scored = Object.values(scores.tools).filter((tool) => tool.scored)
  const first = scored[0]
  const lines = [
    `Measured on ${run.date} (Rampa \`${run.rampaCommit ?? '?'}\`, ACT test cases \`${run.act.sha256.slice(0, 8)}\`): ${cases.cases.length} test cases of ${cases.rules.length} ACT rules, ${scores.units} units under ${scores.criteria.length} WCAG 2.2 A/AA criteria, ${first?.overall.failed ?? 0} of them failed examples; ${pairs.pairs.length} corrupted pairs.${run.limit ? ' **Smoke test, not a result.**' : ''}`,
    '',
    header(
      ['Tool', 'Failed examples caught', 'Precision', 'F1', 'Corrupted pairs told apart', 'Criteria with a true failure', 'Median time per page'],
      ['---', ':---:', ':---:', ':---:', ':---:', ':---:', '---:'],
    ),
  ]
  for (const tool of scored) {
    const o = tool.overall
    lines.push(
      row([
        SHORT[tool.id] ?? tool.label,
        `${o.caught} of ${o.failed} (${num(o.recall)})`,
        num(o.precision),
        num(o.f1),
        `${tool.pairs.toldApart} of ${tool.pairs.total}`,
        String(tool.coverage.trueFailure.length),
        `${seconds(tool.time.medianMs)} s`,
      ]),
    )
  }
  lines.push(
    '',
    'Failures only, as each tool defines them; review items, and the scores if they counted, are in the results below. Every tool is scored on every criterion. Read the caveats before quoting a number: Rampa was tuned on these test cases, and the pairs are its own design.',
  )
  return `${lines.join('\n')}\n`
}

function replaceBlock(text, name, content, note) {
  const start = `<!-- bench:${name}:start -->`
  const end = `<!-- bench:${name}:end -->`
  const from = text.indexOf(start)
  const to = text.indexOf(end)
  if (from === -1 || to === -1) throw new Error(`no ${start} … ${end} block`)
  return `${text.slice(0, from)}${start}\n<!-- ${note} -->\n\n${content}\n${end}${text.slice(to + end.length)}`
}

export async function updateDocs(path, { tables, summary }, resultsPath) {
  const note = `Generated by bench/run.mjs --docs from ${resultsPath}; do not edit by hand.`
  let text = await readFile(path, 'utf8')
  text = replaceBlock(text, 'summary', summary, note)
  text = replaceBlock(text, 'tables', tables, note)
  await writeFile(path, text, 'utf8')
}

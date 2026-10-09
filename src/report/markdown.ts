import type { Finding, Report } from '../core/types.ts'
import { type Locale, t } from '../i18n.ts'
import { VERSION } from '../version.ts'
import {
  PROJECT_URL,
  WAIVERS_FILE,
  countLevels,
  coverageRows,
  criterionName,
  criterionTag,
  findingPlace,
  diffLines,
  levelBreakdown,
  pageLabel,
  patchOf,
  plural,
  runUsageLine,
  safeUrl,
  shownFindings,
  toolsLine,
  understandingUrl,
} from './common.ts'
import { advisoryMarkdown, cogaClause } from './advisory.ts'
import { notesOf } from './pretty.ts'

/**
 * Markdown made for a pull request comment: a summary line, one block per finding
 * (criterion and level, file:line, message, the patch as a diff, evidence, confidence
 * and the id to waive it), and the coverage at the end. A hidden marker lets a bot find
 * and update its own comment instead of posting a new one on every push.
 */

export const MARKDOWN_MARKER = '<!-- rampa-report -->'
/** GitHub rejects comments over 65,536 characters; this leaves room for the marker of a custom key. */
export const MAX_COMMENT_LENGTH = 60_000
/** Findings per page shown before the rest fold into a <details>. */
const OPEN_FINDINGS = 5
const MAX_MARKUP = 300
/** Notes, coverage rows and clean pages listed before the rest are counted; the JSON and HTML reports have them all. */
const MAX_LIST = 20

export interface MarkdownOptions {
  verbose?: boolean | undefined
  maxLength?: number | undefined
}

export function renderMarkdown(reports: readonly Report[], options: MarkdownOptions = {}): string {
  const locale: Locale = reports[0]?.locale ?? 'en'
  const verbose = Boolean(options.verbose)
  const maxLength = options.maxLength ?? MAX_COMMENT_LENGTH
  const pages = reports.map((report) => ({ report, findings: shownFindings(report, verbose) }))
  const all = pages.flatMap((page) => page.findings)
  const confirmed = reports.flatMap((report) => report.findings)

  const head: string[] = [MARKDOWN_MARKER, `## ${t(locale, 'reportTitle')}`, '']
  if (reports.length === 0) head.push(`**${t(locale, 'noPages')}**`)
  else if (confirmed.length > 0) {
    const counts = countLevels(confirmed)
    head.push(
      `**${plural(locale, 'confirmedCount', confirmed.length)}** ${plural(locale, 'onPages', reports.length)}: ${levelBreakdown(counts, locale)}.`,
    )
  } else {
    head.push(`**${plural(locale, 'noFindingsPages', reports.length)}**`)
  }
  head.push('')

  // The pages without findings, listed up to a limit so a site of hundreds of pages still fits.
  const cleanPages: string[] = []
  const clean = pages.filter((page) => page.findings.length === 0).map((page) => pageLabel(page.report))
  if (clean.length > 0 && clean.length < reports.length) {
    const line = plural(locale, 'cleanPages', clean.length)
    if (clean.length <= 5) cleanPages.push(`${line} ${clean.map(code).join(', ')}`, '')
    else cleanPages.push('<details>', `<summary>${line}</summary>`, '', ...capped(clean.map((label) => `- ${code(label)}`), MAX_LIST, locale), '</details>', '')
  }

  const tail = [...notesSection(reports, verbose), ...coverageSection(reports), ...waiverSection(all, locale), footer(reports)]
  // What is left for findings once the fixed parts and the omission note are counted.
  const budget = maxLength - [...head, ...cleanPages, ...tail].join('\n').length - 300

  const body: string[] = []
  let used = 0
  let omitted = 0
  for (const { report, findings } of pages) {
    if (findings.length === 0) continue
    const heading = `### ${code(pageLabel(report))}`
    const fits: string[] = []
    for (const finding of findings) {
      const block = findingBlock(finding, report)
      // A page's first block also pays for its heading and the <details> around its folded findings.
      const cost = block.length + (fits.length === 0 ? heading.length + 200 : 0)
      if (used + cost > budget) {
        omitted++
        continue
      }
      used += cost
      fits.push(block)
    }
    if (fits.length === 0) continue
    body.push(heading, '')
    body.push(...fits.slice(0, OPEN_FINDINGS))
    const folded = fits.slice(OPEN_FINDINGS)
    if (folded.length > 0) {
      body.push('<details>', `<summary>${plural(locale, 'moreFindings', folded.length)}</summary>`, '', ...folded, '</details>', '')
    }
  }
  if (omitted > 0) body.push(`> ${plural(locale, 'omittedFindings', omitted)}`, '')
  // Advisories get what the findings left of the budget: they are what a long comment drops first.
  const advisories = advisoryMarkdown(reports, verbose, budget - used, { prose, code })

  return `${[...head, ...body, ...advisories, ...cleanPages, ...tail].join('\n').trimEnd()}\n`
}

/** At most `max` lines, then one that counts the rest. */
function capped(lines: string[], max: number, locale: Locale): string[] {
  if (lines.length <= max) return lines
  return [...lines.slice(0, max), `- ${plural(locale, 'andMore', lines.length - max)}`]
}

function findingBlock(finding: Finding, report: Report): string {
  const locale = report.locale
  const lines: string[] = []
  const url = understandingUrl(finding.criterion)
  const name = criterionName(finding.criterion, locale)
  const tag = url ? `[${criterionTag(finding)}](${url}${name ? ` "${name.replaceAll('"', "'")}"` : ''})` : criterionTag(finding)
  const place = findingPlace(finding)
  // The trailing backslash is a hard line break, so the message starts its own line in comments and files alike.
  lines.push(`**${tag}**${place ? ` — ${code(place)}` : ''}\\`)
  lines.push(prose(finding.message))
  lines.push('')

  const patch = patchOf(finding)
  if (patch) {
    const sign = { context: ' ', removed: '-', added: '+' } as const
    lines.push(...fenced(diffLines(patch.before, patch.after).map((line) => `${sign[line.kind]} ${line.text}`).join('\n'), 'diff'))
  } else {
    const markup = finding.location?.snippet ?? finding.html
    if (markup) lines.push(...fenced(markup.length > MAX_MARKUP ? `${markup.slice(0, MAX_MARKUP - 1)}…` : markup, 'html'))
  }

  const meta: string[] = []
  if (finding.evidence) meta.push(`${t(locale, 'evidence')}: "${prose(finding.evidence)}"`)
  const confidence = `${t(locale, 'confidence')} ${t(locale, finding.confidence)}`
  meta.push(meta.length === 0 ? capitalize(confidence) : confidence)
  if (finding.agreement) meta.push(`${finding.agreement.votes}/${finding.agreement.total} ${t(locale, 'runs')}`)
  if (finding.source === 'engine' && finding.ruleId) {
    const help = safeUrl(finding.helpUrl)
    // In angle brackets, a ) in the address cannot end the link early.
    const rule = help ? `[${prose(finding.ruleId)}](<${help}>)` : code(finding.ruleId)
    meta.push(`${t(locale, 'engineRule')} ${rule} (${prose(report.engine.name)})`)
  }
  if (report.findings.includes(finding)) meta.push(`id ${code(finding.fingerprint)}`)
  else meta.push(`${t(locale, 'belowThresholdShort')} · id ${code(finding.fingerprint)}`)
  lines.push(meta.join(' · '), '')
  return lines.join('\n')
}

function notesSection(reports: readonly Report[], verbose: boolean): string[] {
  const locale = reports[0]?.locale ?? 'en'
  const prefix = (report: Report) => (reports.length > 1 ? `${code(pageLabel(report))}: ` : '')
  const notes = reports.flatMap((report) => {
    const lines = notesOf(report, verbose).map((note) => `${prefix(report)}${prose(note)}`)
    if (report.waived.length > 0) lines.push(`${prefix(report)}${plural(locale, 'waivedCount', report.waived.length, { file: code(WAIVERS_FILE) })}`)
    return lines
  })
  const usage = runUsageLine(reports)
  if (usage) notes.push(prose(usage))
  if (notes.length === 0) return []
  return [`#### ${t(locale, 'notesTitle')}`, '', ...capped(notes.map((note) => `- ${note}`), MAX_LIST, locale), '']
}

/** The coverage statement, always in the open: an empty report must not read as a clean page. */
function coverageSection(reports: readonly Report[]): string[] {
  const locale = reports[0]?.locale ?? 'en'
  const lines = [`#### ${t(locale, 'coverageTitle')}`, '']
  const first = reports[0]
  if (reports.length === 1 && first) {
    for (const row of coverageRows(first)) lines.push(`- ${row.label} ${row.text}`)
    if (first.coverage.notChecked.length > 0) {
      const summary = t(locale, 'coverageNotChecked').replace(/:$/, '')
      lines.push('', '<details>', `<summary>${summary}</summary>`, '', first.coverage.notChecked.join(', '), '</details>')
    }
  } else if (first) {
    const labels = coverageRows(first).map((row) => row.label.replace(/:$/, ''))
    lines.push(`| ${t(locale, 'page')} | ${labels.join(' | ')} |`, `| --- | ${labels.map(() => '---').join(' | ')} |`)
    for (const report of reports.slice(0, MAX_LIST)) {
      const cells = coverageRows(report).map((row) => row.text)
      lines.push(`| ${code(pageLabel(report))} | ${cells.map((cell) => prose(cell)).join(' | ')} |`)
    }
    if (reports.length > MAX_LIST) lines.push('', plural(locale, 'andMore', reports.length - MAX_LIST))
  }
  const coga = first ? cogaClause(first) : undefined
  if (coga) lines.push('', prose(`${coga}.`))
  lines.push('', `**${t(locale, 'disclaimer')}** ${t(locale, 'manualReview')}`, '')
  return lines
}

/** How to dismiss a false positive so it stays dismissed: a waiver in the repository, reviewed like code. */
function waiverSection(findings: readonly Finding[], locale: Locale): string[] {
  const example = findings[0]
  if (!example) return []
  const snippet = JSON.stringify([{ fingerprint: example.fingerprint, reason: t(locale, 'waiveReason') }], null, 2)
  return [
    '<details>',
    `<summary>${t(locale, 'waiveTitle')}</summary>`,
    '',
    t(locale, 'waiveText', { file: code(WAIVERS_FILE) }),
    '',
    ...fenced(snippet, 'json'),
    '</details>',
    '',
  ]
}

function footer(reports: readonly Report[]): string {
  const locale = reports[0]?.locale ?? 'en'
  const tools = toolsLine(reports)
  return `<sub>${t(locale, 'generatedBy', { tool: `[Rampa](${PROJECT_URL}) ${VERSION}` })}${tools ? ` · ${prose(tools)}` : ''}</sub>`
}

/**
 * Text from the page, made inert: Markdown and HTML characters are escaped, and @mentions
 * and #references get a zero-width space, so a quoted alt text never pings a person.
 */
export function prose(value: string): string {
  return value
    .replace(/\s*[\r\n]+\s*/g, ' ')
    .replaceAll('&', '&amp;')
    .replace(/[\\`*_[\]<>|~]/g, '\\$&')
    .replace(/([@#])(?=[\p{L}\p{N}_-])/gu, '$1&#8203;')
    .replace(/\b(GH-)(?=\d)/gi, '$1&#8203;')
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}

/** Inline code: a fence longer than any run of backticks inside. */
export function code(value: string): string {
  const flat = value.replace(/\s*[\r\n]+\s*/g, ' ')
  const longest = Math.max(0, ...(flat.match(/`+/g) ?? []).map((run) => run.length))
  const fence = '`'.repeat(longest + 1)
  const pad = flat.startsWith('`') || flat.endsWith('`') ? ' ' : ''
  return `${fence}${pad}${flat}${pad}${fence}`
}

function fenced(body: string, language: string): string[] {
  const longest = Math.max(0, ...(body.match(/`+/g) ?? []).map((run) => run.length))
  const fence = '`'.repeat(Math.max(3, longest + 1))
  return [`${fence}${language}`, body, fence]
}

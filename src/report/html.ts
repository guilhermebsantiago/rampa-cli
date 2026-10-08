import type { Finding, Report } from '../core/types.ts'
import { type Locale, type MessageKey, t } from '../i18n.ts'
import { VERSION } from '../version.ts'
import { compareCriteria, successCriterion } from '../wcag.ts'
import {
  PROJECT_URL,
  WAIVERS_FILE,
  countLevels,
  coverageRows,
  criterionName,
  criterionTag,
  escapeHtml as e,
  findingPlace,
  diffLines,
  levelBreakdown,
  pageLabel,
  patchOf,
  plural,
  shownFindings,
  toolsLine,
  understandingUrl,
} from './common.ts'
import { notesOf, usageLine } from './pretty.ts'

/**
 * One self-contained HTML file to attach to a ticket: no script, no external request,
 * inline CSS that follows the reader's light or dark preference. It holds itself to
 * what it reports: landmarks, a heading outline, real tables and AA contrast in both themes.
 */

export interface HtmlOptions {
  verbose?: boolean | undefined
}

export function renderHtml(reports: readonly Report[], options: HtmlOptions = {}): string {
  const locale: Locale = reports[0]?.locale ?? 'en'
  const verbose = Boolean(options.verbose)
  const confirmed = reports.flatMap((report) => report.findings)
  const subject = reports.length === 1 && reports[0] ? pageLabel(reports[0]) : plural(locale, 'pagesCount', reports.length)
  const created = reports.map((report) => report.createdAt).sort().at(-1) ?? new Date().toISOString()
  const lead =
    reports.length === 0
      ? t(locale, 'noPages')
      : confirmed.length > 0
        ? `${plural(locale, 'confirmedCount', confirmed.length)} ${plural(locale, 'onPages', reports.length)}: ${levelBreakdown(countLevels(confirmed), locale)}.`
        : plural(locale, 'noFindingsPages', reports.length)

  const parts: string[] = []
  parts.push(`<!doctype html>
<html lang="${e(locale)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="generator" content="Rampa ${e(VERSION)}">
<title>${e(`${t(locale, 'htmlTitle')}: ${subject} — Rampa`)}</title>
<style>${STYLE}</style>
</head>
<body>
<a class="skip" href="#main">${e(t(locale, 'skipToContent'))}</a>
<header class="wrap">
<p class="brand">Rampa</p>
<h1>${e(t(locale, 'htmlTitle'))}</h1>
<p class="lead">${e(lead)}</p>
<p class="disclaimer"><strong>${e(t(locale, 'disclaimer'))}</strong> ${e(t(locale, 'manualReview'))}</p>
<dl class="facts">
<div><dt>${e(t(locale, 'checkedAt'))}</dt><dd><time datetime="${e(created)}">${e(formatDate(created, locale))}</time></dd></div>
<div><dt>${e(t(locale, 'tools'))}</dt><dd>${e(toolsLine(reports) || '—')}</dd></div>
<div><dt>Rampa</dt><dd>${e(VERSION)}</dd></div>
</dl>
</header>
<main id="main" class="wrap">`)

  if (reports.length > 1) parts.push(summaryTable(reports, locale))
  reports.forEach((report, index) => {
    parts.push(pageSection(report, index, reports.length > 1, verbose))
  })
  parts.push(aboutSection(reports, locale))
  parts.push(`</main>
<footer class="wrap">
<p>${withMarkup(locale, 'generatedBy', 'tool', `<a href="${PROJECT_URL}">Rampa</a> ${e(VERSION)}`)} · <a href="https://www.w3.org/TR/WCAG21/">${e(t(locale, 'wcagLink'))}</a></p>
</footer>
</body>
</html>
`)
  return parts.join('\n')
}

/** Four columns, so it fits a phone; findings below the threshold and waived ones are in each page's notes. */
function summaryTable(reports: readonly Report[], locale: Locale): string {
  const rows = reports.map((report, index) => {
    const counts = countLevels(report.findings)
    return `<tr><th scope="row"><a href="#page-${index + 1}">${e(pageLabel(report))}</a></th><td>${counts.total}</td><td>${counts.A}</td><td>${counts.AA}</td></tr>`
  })
  return `<section aria-labelledby="summary">
<h2 id="summary">${e(t(locale, 'summaryTitle'))}</h2>
<table class="summary">
<caption>${e(t(locale, 'summaryCaption'))}</caption>
<thead><tr><th scope="col">${e(t(locale, 'page'))}</th><th scope="col">${e(t(locale, 'confirmedTitle'))}</th><th scope="col">${e(t(locale, 'levelName', { level: 'A' }))}</th><th scope="col">${e(t(locale, 'levelName', { level: 'AA' }))}</th></tr></thead>
<tbody>
${rows.join('\n')}
</tbody>
</table>
</section>`
}

function pageSection(report: Report, index: number, several: boolean, verbose: boolean): string {
  const locale = report.locale
  const id = `page-${index + 1}`
  const findings = shownFindings(report, verbose)
  const out: string[] = []
  out.push(`<section class="page" aria-labelledby="${id}">`)
  out.push(several ? `<h2 id="${id}">${e(pageLabel(report))}</h2>` : `<h2 id="${id}">${e(t(locale, 'findingsOn', { page: pageLabel(report) }))}</h2>`)
  // With one page, the header already says this.
  if (several) {
    const counts = countLevels(report.findings)
    const lead = counts.total > 0 ? `${plural(locale, 'confirmedCount', counts.total)}: ${levelBreakdown(counts, locale)}.` : t(locale, 'noFindings')
    out.push(`<p class="page-lead">${e(lead)}</p>`)
  }

  const notes = notesOf(report, verbose)
  if (report.waived.length > 0) notes.push(plural(locale, 'waivedCount', report.waived.length, { file: WAIVERS_FILE }))
  const usage = usageLine(report)
  if (usage) notes.push(usage)
  if (notes.length > 0) out.push(`<ul class="notes">${notes.map((note) => `<li>${e(note)}</li>`).join('')}</ul>`)

  const byCriterion = new Map<string, Finding[]>()
  for (const finding of findings) byCriterion.set(finding.criterion, [...(byCriterion.get(finding.criterion) ?? []), finding])
  for (const criterion of [...byCriterion.keys()].sort(compareCriteria)) {
    const group = byCriterion.get(criterion) ?? []
    const first = group[0]
    if (!first) continue
    const name = criterionName(criterion, locale)
    const url = understandingUrl(criterion)
    out.push('<div class="criterion">')
    out.push(`<h3>${e(name ? `${criterionTag(first)} — ${name}` : criterionTag(first))}</h3>`)
    if (url && name) out.push(`<p class="understanding"><a href="${e(url)}">${e(t(locale, 'understanding', { id: criterion, name }))}</a></p>`)
    out.push(`<ol class="findings">${group.map((finding) => findingItem(finding, report)).join('\n')}</ol>`)
    out.push('</div>')
  }

  out.push(`<h3>${e(t(locale, 'coverageTitle'))}</h3>`)
  out.push(coverageTable(report))
  if (verbose && report.discarded.length > 0) {
    out.push(`<details><summary>${e(t(locale, 'discardedTitle'))} (${report.discarded.length})</summary><ul>`)
    for (const item of report.discarded) out.push(`<li><code>${e(item.ref)}</code> ${e(item.reason)}</li>`)
    out.push('</ul></details>')
  }
  out.push('</section>')
  return out.join('\n')
}

function findingItem(finding: Finding, report: Report): string {
  const locale = report.locale
  const out: string[] = ['<li class="finding">']
  const place = findingPlace(finding)
  const selector = finding.ref ?? finding.target
  const where = [`<code>${e(place)}</code>`]
  if (finding.location && selector) where.push(`<code class="selector">${e(selector)}</code>`)
  out.push(`<p class="where">${where.join(' ')}</p>`)
  out.push(`<p class="message">${e(finding.message)}</p>`)
  if (finding.evidence) out.push(`<p>${e(t(locale, 'evidence'))}: <q>${e(finding.evidence)}</q></p>`)

  const patch = patchOf(finding)
  if (patch) {
    const lines = diffLines(patch.before, patch.after).map((line) =>
      line.kind === 'removed' ? `<del>- ${e(line.text)}</del>` : line.kind === 'added' ? `<ins>+ ${e(line.text)}</ins>` : `<span>  ${e(line.text)}</span>`,
    )
    out.push(`<div class="patch"><p class="patch-title">${e(t(locale, 'suggestedChange'))} <span class="legend">${e(t(locale, 'diffLegend'))}</span></p><pre class="diff"><code>${lines.join('')}</code></pre></div>`)
  } else {
    const markup = finding.location?.snippet ?? finding.html
    if (markup) out.push(`<pre class="markup"><code>${e(markup)}</code></pre>`)
  }

  const meta: string[] = [`${e(t(locale, 'confidence'))} ${e(t(locale, finding.confidence))}`]
  if (finding.agreement) meta.push(`${finding.agreement.votes}/${finding.agreement.total} ${e(t(locale, 'runs'))}`)
  if (finding.source === 'judgment') meta.push(e(t(locale, 'verified')))
  if (finding.source === 'engine' && finding.ruleId) {
    const rule = `${e(t(locale, 'engineRule'))} ${e(finding.ruleId)} (${e(report.engine.name)})`
    meta.push(finding.helpUrl ? `<a href="${e(finding.helpUrl)}">${rule}</a>` : rule)
  }
  if (!report.findings.includes(finding)) meta.push(e(t(locale, 'belowThresholdShort')))
  meta.push(`id <code>${e(finding.fingerprint)}</code>`)
  out.push(`<p class="meta">${meta.join(' · ')}</p>`)
  out.push('</li>')
  return out.join('')
}

function coverageTable(report: Report): string {
  const locale = report.locale
  const rows = coverageRows(report).map((row, index) => {
    const cell =
      index === 2 && row.criteria.length > 0
        ? `<details><summary>${e(row.text)}</summary><ul class="criteria">${row.criteria
            .map((id) => `<li>${e(id)} ${e(criterionName(id, locale) ?? '')} (${e(successCriterion(id)?.level ?? '')})</li>`)
            .join('')}</ul></details>`
        : e(row.text)
    return `<tr><th scope="row">${e(row.label.replace(/:$/, ''))}</th><td>${cell}</td></tr>`
  })
  return `<table class="coverage">
<caption>${e(t(locale, 'coverageCaption', { page: pageLabel(report) }))}</caption>
<tbody>
${rows.join('\n')}
</tbody>
</table>`
}

function aboutSection(reports: readonly Report[], locale: Locale): string {
  const example = reports.flatMap((report) => report.findings)[0]
  const snippet = JSON.stringify([{ fingerprint: example?.fingerprint ?? '0123456789ab', reason: t(locale, 'waiveReason') }], null, 2)
  return `<section aria-labelledby="about">
<h2 id="about">${e(t(locale, 'aboutTitle'))}</h2>
<p><strong>${e(t(locale, 'disclaimer'))}</strong> ${e(t(locale, 'manualReview'))}</p>
<p>${e(t(locale, 'aboutMethod'))}</p>
<h3>${e(t(locale, 'waiveTitle'))}</h3>
<p>${withMarkup(locale, 'waiveText', 'file', `<code>${e(WAIVERS_FILE)}</code>`)}</p>
<pre class="markup"><code>${e(snippet)}</code></pre>
</section>`
}

/** A message escaped as text, with markup in one of its slots. */
function withMarkup(locale: Locale, key: MessageKey, slot: string, markup: string): string {
  return e(t(locale, key, { [slot]: '\u0000' })).replace('\u0000', markup)
}

function formatDate(iso: string, locale: Locale): string {
  try {
    const formatted = new Intl.DateTimeFormat(locale, { dateStyle: 'long', timeStyle: 'short', timeZone: 'UTC' }).format(new Date(iso))
    return `${formatted} UTC`
  } catch {
    return iso
  }
}

// Every text color meets 4.5:1 on the backgrounds it sits on, in both themes (test/html-report.test.ts checks).
const STYLE = `
:root{color-scheme:light dark;--bg:#ffffff;--surface:#f6f8fa;--fg:#1f2328;--muted:#57606a;--border:#d1d9e0;--accent:#0969da;--del-bg:#ffebe9;--del-fg:#82071e;--ins-bg:#dafbe1;--ins-fg:#116329}
@media (prefers-color-scheme:dark){:root{--bg:#0d1117;--surface:#151b23;--fg:#e6edf3;--muted:#9198a1;--border:#3d444d;--accent:#4493f8;--del-bg:#25171c;--del-fg:#ffdcd7;--ins-bg:#12261e;--ins-fg:#aff5b4}}
*,*::before,*::after{box-sizing:border-box}
html{-webkit-text-size-adjust:100%;text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--fg);font:1rem/1.55 system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif}
.wrap{max-width:64rem;margin:0 auto;padding:0 1rem}
a{color:var(--accent);text-underline-offset:.15em}
a:focus-visible,summary:focus-visible{outline:3px solid var(--accent);outline-offset:2px;border-radius:2px}
.skip{position:absolute;left:-10000px;top:0}
.skip:focus{left:1rem;top:1rem;z-index:1;padding:.5rem 1rem;background:var(--bg);border:2px solid var(--accent)}
header{padding-top:2rem;padding-bottom:1.5rem;border-bottom:1px solid var(--border)}
.brand{margin:0;font-weight:700;letter-spacing:.08em;text-transform:uppercase;font-size:.8rem;color:var(--muted)}
h1{margin:.25rem 0 .5rem;font-size:2rem;line-height:1.2}
h2{margin:2.5rem 0 .75rem;font-size:1.5rem;line-height:1.25;overflow-wrap:anywhere}
h3{margin:2rem 0 .5rem;font-size:1.15rem}
.lead{font-size:1.15rem;margin:.5rem 0}
.disclaimer{margin:.5rem 0 1rem}
.facts{display:flex;flex-wrap:wrap;gap:.25rem 2rem;margin:0;color:var(--muted);font-size:.9rem}
.facts div{display:flex;gap:.4rem}
.facts dt::after{content:":"}
.facts dd{margin:0;color:var(--fg)}
.page-lead{font-size:1.05rem}
.notes{padding-left:1.25rem;color:var(--muted)}
.notes li{margin:.25rem 0}
.understanding{margin:.25rem 0 .75rem}
.findings{list-style:none;margin:0;padding:0}
.finding{margin:0 0 1rem;padding:1rem;border:1px solid var(--border);border-radius:8px;background:var(--surface)}
.finding p{margin:.35rem 0}
.where code{font-weight:600}
.where .selector{font-weight:400;color:var(--muted)}
.message{font-size:1.05rem}
.meta{color:var(--muted);font-size:.9rem}
code,pre{font-family:ui-monospace,SFMono-Regular,"SF Mono",Menlo,Consolas,"Liberation Mono",monospace;font-size:.875em}
code{overflow-wrap:anywhere}
pre{margin:.5rem 0;padding:.75rem;border:1px solid var(--border);border-radius:6px;background:var(--bg);white-space:pre-wrap;overflow-wrap:anywhere}
.patch-title{font-weight:600;margin-bottom:0}
.legend{font-weight:400;color:var(--muted);font-size:.9rem}
.diff del,.diff ins,.diff span{display:block;text-decoration:none;padding:0 .25rem}
.diff del{background:var(--del-bg);color:var(--del-fg)}
.diff ins{background:var(--ins-bg);color:var(--ins-fg)}
table{width:100%;border-collapse:collapse;margin:.5rem 0 1rem}
caption{text-align:left;font-weight:600;padding:.25rem 0}
th,td{text-align:left;vertical-align:top;padding:.5rem;border-bottom:1px solid var(--border);overflow-wrap:break-word}
thead th{border-bottom-width:2px}
td,th[scope=row]{overflow-wrap:anywhere}
.summary td{font-variant-numeric:tabular-nums}
.coverage th{width:16rem;font-weight:600}
.criteria{margin:.5rem 0 0;padding-left:1.25rem}
summary{cursor:pointer}
footer{margin-top:3rem;padding-top:1rem;padding-bottom:2rem;border-top:1px solid var(--border);color:var(--muted);font-size:.9rem}
@media (max-width:40rem){.coverage th{width:auto}h1{font-size:1.6rem}th,td{padding:.4rem .3rem}.summary{font-size:.9rem}}
@media print{:root{--bg:#fff;--surface:#fff;--fg:#000;--muted:#333;--accent:#000}.skip{display:none}.finding{break-inside:avoid}a{text-decoration:underline}}
`

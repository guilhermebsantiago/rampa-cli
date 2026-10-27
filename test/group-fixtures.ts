import { sha256 } from '../src/core/util.ts'
import type { Finding, Report } from '../src/core/types.ts'
import type { A11yNode, A11ySnapshot } from '../src/snapshot/schema.ts'
import { node } from './helpers.ts'
import { findingOf, recordedReport } from './report-fixtures.ts'

/** A judgment finding of one claim, with its own element and id. */
export function judged(criterion: string, claim: string | undefined, index: number, extra: Partial<Finding> = {}): Finding {
  return {
    fingerprint: sha256(`${criterion}|${claim}|${index}`).slice(0, 12),
    criterion,
    level: 'A',
    source: 'judgment',
    ref: `html > body > ul > li:nth-of-type(${index + 1}) > a`,
    message: `The link text "Products ${index}" is shared by 3 links that lead to different places.`,
    evidence: `Products ${index}`,
    subject: `Products ${index}`,
    ...(claim ? { claim } : {}),
    confidence: 'high',
    agreement: { votes: 1, total: 1 },
    model: 'stub',
    ...extra,
  }
}

/** An engine finding of one rule, with its own element. */
export function engineFinding(criterion: string, ruleId: string, index: number): Finding {
  return {
    fingerprint: sha256(`${ruleId}|${index}`).slice(0, 12),
    criterion,
    level: 'A',
    source: 'engine',
    ref: `html > body > p:nth-of-type(${index + 1})`,
    target: `["p:nth-of-type(${index + 1})"]`,
    message: 'Elements must meet minimum color contrast ratio thresholds',
    confidence: 'high',
    ruleId,
  }
}

/**
 * The recorded store page with a burst: its 2.4.4 finding ("Click here", a generic text) and seven more like it on
 * other links of the page, all with the same check and claim, so the page has one group of eight.
 */
export async function burstReport(options: { locale?: 'en' | 'pt-BR'; count?: number } = {}): Promise<Report> {
  const { report } = await recordedReport('examples-store-before', { locale: options.locale })
  const original = findingOf(report, '2.4.4')
  const copies = Array.from({ length: (options.count ?? 8) - 1 }, (_, index): Finding => ({
    ...original,
    fingerprint: sha256(`burst|${index}`).slice(0, 12),
    ref: `html > body > footer > ul > li:nth-of-type(${index + 1}) > a`,
    location: undefined,
    patch: original.patch && { ...original.patch, ref: `html > body > footer > ul > li:nth-of-type(${index + 1}) > a` },
  }))
  const at = report.findings.indexOf(original)
  const findings = [...report.findings.slice(0, at + 1), ...copies, ...report.findings.slice(at + 1)]
  const { groups: _groups, ...rest } = report
  return { ...rest, findings }
}

/** A page with `count` links that all read "Read more" and say nothing else, each to its own address; `text` names each link instead. */
export function readMorePage(count: number, text: (index: number) => string = () => 'Read more'): A11ySnapshot {
  const links: A11yNode[] = Array.from({ length: count }, (_, index) =>
    node({
      ref: `a.more-${index + 1}`,
      role: 'link',
      name: text(index),
      native: { tag: 'a', attributes: { href: `/story-${index + 1}` }, html: `<a href="/story-${index + 1}">${text(index)}</a>` },
      children: [node({ ref: `a.more-${index + 1}-text`, text: text(index) })],
    }),
  )
  return {
    schemaVersion: 1,
    surface: 'web',
    target: 'https://news.test/',
    locale: 'en',
    viewport: { width: 1280, height: 800, scale: 1 },
    collectedAt: '2026-10-27T00:00:00.000Z',
    collector: { name: 'test', version: '0' },
    root: node({ ref: 'html', role: 'document', lang: 'en', children: [node({ ref: 'body', native: { tag: 'body' }, children: links })] }),
  }
}

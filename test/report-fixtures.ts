import { fileCache } from '../src/core/cache.ts'
import { checkSnapshot } from '../src/core/check.ts'
import type { Finding, Report } from '../src/core/types.ts'
import { DEFAULT_CRITERIA, resolveCriteria } from '../src/criteria/index.ts'
import type { Locale } from '../src/i18n.ts'
import { providerIdentity } from '../src/providers/ai-sdk.ts'
import type { A11ySnapshot } from '../src/snapshot/schema.ts'
import { locateReport, readPageSource } from '../src/source/locate.ts'
import { loadEngineFor, loadSnapshot } from '../src/surfaces/targets.ts'

/**
 * A page from demo/recorded checked with the judgments recorded next to it: real findings
 * with evidence and patches, and no browser, model or network.
 */
export async function recordedReport(
  name = 'examples-store-before',
  options: { locale?: Locale; locate?: boolean; waivers?: Set<string> } = {},
): Promise<{ report: Report; snapshot: A11ySnapshot }> {
  const path = `demo/recorded/${name}.snapshot.json`
  const snapshot = await loadSnapshot(path)
  const engine = await loadEngineFor(path)
  if (!engine) throw new Error(`no engine results recorded for ${name}`)
  const report = await checkSnapshot(snapshot, engine, {
    criteria: resolveCriteria(DEFAULT_CRITERIA),
    llm: true,
    provider: {
      ...providerIdentity('ollama:gemma4:12b'),
      judge() {
        throw new Error('the recorded judgments should cover every candidate')
      },
    },
    runs: 1,
    cache: fileCache('demo/recorded/cache'),
    offline: true,
    locale: options.locale ?? 'en',
    minConfidence: 'medium',
    concurrency: 4,
    waivers: options.waivers,
  })
  if (options.locate === false) return { report, snapshot }
  const source = await readPageSource(snapshot.target, process.cwd())
  return { report: source ? locateReport(report, snapshot, source) : report, snapshot }
}

export function findingOf(report: Report, criterion: string, ref?: string): Finding {
  const finding = report.findings.find((candidate) => candidate.criterion === criterion && (ref === undefined || candidate.ref === ref))
  if (!finding) throw new Error(`no ${criterion} finding${ref ? ` on ${ref}` : ''}`)
  return finding
}

/** The same report as a remote page: no source file, so nothing is located. */
export function asRemote(report: Report, url = 'https://shop.example/new'): Report {
  const strip = (finding: Finding): Finding => ({ ...finding, location: undefined })
  return {
    ...report,
    target: url,
    sourceFile: undefined,
    findings: report.findings.map(strip),
    belowThreshold: report.belowThreshold.map(strip),
    waived: report.waived.map(strip),
  }
}

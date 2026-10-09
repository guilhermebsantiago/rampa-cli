import { isAbsolute } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { Confidence, Finding, Report, SourceRegion } from '../core/types.ts'
import { sha256 } from '../core/util.ts'
import { type Locale, t } from '../i18n.ts'
import { type WcagVersion, successCriterion } from '../wcag.ts'
import { VERSION } from '../version.ts'
import { PROJECT_URL, WAIVERS_FILE, coverageStatement, criterionName, pageLabel, safeUrl, understandingUrl, wcagVersion } from './common.ts'

/**
 * SARIF 2.1.0, the format GitHub code scanning and most IDEs read. One rule per WCAG
 * success criterion; one result per finding, located in the source file of a local page
 * (with the patch as a fix) or at the URL and selector of a remote one. Every run states
 * its coverage, because a log without results must not read as a clean page.
 */

export const SARIF_SCHEMA = 'https://json.schemastore.org/sarif-2.1.0.json'
/** Paths of local pages are relative to this base: the repository root. */
export const SOURCE_ROOT = '%SRCROOT%'
/** The key of `partialFingerprints`. Bump the version if what it hashes changes. */
export const FINGERPRINT_KEY = 'rampa/v1'

export interface SarifOptions {
  /** Also report findings below the confidence threshold, as notes, and waived ones, as suppressed. */
  verbose?: boolean | undefined
}

interface Message {
  text: string
  markdown?: string
}

interface ArtifactLocation {
  uri: string
  uriBaseId?: string
  index?: number
}

interface Region extends SourceRegion {
  snippet?: { text: string }
}

interface Location {
  physicalLocation: { artifactLocation: ArtifactLocation; region?: Region }
  logicalLocations?: Array<{ fullyQualifiedName: string; kind: string }>
}

interface Rule {
  id: string
  name: string
  shortDescription: Message
  fullDescription: Message
  help: Message
  helpUri?: string
  defaultConfiguration: { level: 'error' | 'warning' | 'note' }
  properties: { tags: string[]; [key: string]: unknown }
}

export interface SarifResult {
  ruleId: string
  ruleIndex: number
  level: 'error' | 'warning' | 'note'
  message: Message
  locations: Location[]
  partialFingerprints: Record<string, string>
  fixes?: Array<{
    description: Message
    artifactChanges: Array<{ artifactLocation: ArtifactLocation; replacements: Array<{ deletedRegion: SourceRegion; insertedContent: { text: string } }> }>
  }>
  suppressions?: Array<{ kind: 'external'; status: 'accepted'; justification: string }>
  properties: Record<string, unknown>
}

interface Notification {
  level: 'note' | 'warning' | 'error'
  message: Message
  descriptor: { id: string }
  locations?: Location[]
}

export interface SarifLog {
  $schema: string
  version: '2.1.0'
  runs: Array<{
    tool: {
      driver: { name: string; fullName: string; version: string; semanticVersion: string; informationUri: string; rules: Rule[] }
      extensions?: Array<{ name: string; version: string; informationUri: string }>
    }
    invocations: Array<{ executionSuccessful: boolean; endTimeUtc?: string; toolExecutionNotifications: Notification[] }>
    language: string
    columnKind: 'utf16CodeUnits'
    originalUriBaseIds?: Record<string, { description: Message }>
    artifacts: Array<{ location: ArtifactLocation; roles: string[]; sourceLanguage?: string }>
    results: SarifResult[]
    properties: Record<string, unknown>
  }>
}

type Kind = 'confirmed' | 'below-threshold' | 'waived'

export function toSarif(reports: readonly Report[], options: SarifOptions = {}): SarifLog {
  const locale: Locale = reports[0]?.locale ?? 'en'
  const version = wcagVersion(reports[0] ?? {})
  const rules: Rule[] = []
  const ruleIndex = new Map<string, number>()
  const artifacts: SarifLog['runs'][number]['artifacts'] = []
  // SARIF wants each artifact once, even when a page was checked twice.
  const artifactIndex = new Map<string, number>()
  const results: SarifResult[] = []
  const notifications: Notification[] = []

  const ruleFor = (finding: Finding): { id: string; index: number } => {
    const id = ruleIdOf(finding)
    let index = ruleIndex.get(id)
    if (index === undefined) {
      index = rules.push(ruleOf(finding, locale, version)) - 1
      ruleIndex.set(id, index)
    }
    return { id, index }
  }

  for (const report of reports) {
    const location = artifactLocationOf(report)
    const key = `${location.uriBaseId ?? ''}|${location.uri}`
    let index = artifactIndex.get(key)
    if (index === undefined) {
      index = artifacts.push({ location, roles: ['analysisTarget'], ...(report.surface === 'web' ? { sourceLanguage: 'html' } : {}) }) - 1
      artifactIndex.set(key, index)
    }
    const artifact: ArtifactLocation = { ...location, index }
    const entries: Array<[Finding, Kind]> = [
      ...report.findings.map((finding): [Finding, Kind] => [finding, 'confirmed']),
      ...(options.verbose ? report.belowThreshold.map((finding): [Finding, Kind] => [finding, 'below-threshold']) : []),
      ...(options.verbose ? report.waived.map((finding): [Finding, Kind] => [finding, 'waived']) : []),
    ]
    for (const [finding, kind] of entries) results.push(resultOf(finding, kind, report, artifact, ruleFor(finding)))

    const where = [{ physicalLocation: { artifactLocation: artifact } }]
    const note = { text: plainText(`${pageLabel(report)}: ${coverageStatement(report)}`) }
    notifications.push({ level: 'note', message: note, descriptor: { id: 'coverage' }, locations: where })
    for (const error of report.errors) {
      notifications.push({ level: 'warning', message: { text: plainText(`${pageLabel(report)}: ${error}`) }, descriptor: { id: 'judgment-error' }, locations: where })
    }
  }

  const engines = new Map(reports.filter((report) => report.engine.name !== 'none').map((report) => [report.engine.name, report.engine.version]))
  const relative = artifacts.some((artifact) => artifact.location.uriBaseId === SOURCE_ROOT)
  const failed = reports.some((report) => report.criteria.some((criterion) => criterion.errors > 0 && criterion.judged === 0))
  const ended = reports.map((report) => report.createdAt).sort().at(-1)

  return {
    $schema: SARIF_SCHEMA,
    version: '2.1.0',
    runs: [
      {
        tool: {
          driver: {
            name: 'Rampa',
            fullName: 'Rampa accessibility checker',
            version: VERSION,
            semanticVersion: VERSION,
            informationUri: PROJECT_URL,
            rules,
          },
          ...(engines.size > 0
            ? { extensions: [...engines].map(([name, version]) => ({ name, version, informationUri: engineUrl(name) })) }
            : {}),
        },
        invocations: [{ executionSuccessful: !failed, ...(ended ? { endTimeUtc: ended } : {}), toolExecutionNotifications: notifications }],
        language: locale,
        columnKind: 'utf16CodeUnits',
        ...(relative
          ? { originalUriBaseIds: { [SOURCE_ROOT]: { description: { text: 'The repository root, or the working directory outside a repository.' } } } }
          : {}),
        artifacts,
        results,
        properties: {
          statement: `${t(locale, 'disclaimer')} ${t(locale, 'manualReview')}`,
          coverage: reports.map((report) => ({
            target: pageLabel(report),
            surface: report.surface,
            wcagTarget: report.wcagTarget ?? 'wcag21-aa',
            llm: report.llm,
            model: report.model,
            checkedByEngine: report.coverage.engine,
            judged: report.coverage.judged,
            notChecked: report.coverage.notChecked,
          })),
        },
      },
    ],
  }
}

/** `WCAG-1.1.1`; a finding outside WCAG 2.1 A/AA keeps the id of the engine rule behind it. */
export function ruleIdOf(finding: Pick<Finding, 'criterion' | 'ruleId'>): string {
  return successCriterion(finding.criterion) ? `WCAG-${finding.criterion}` : (finding.ruleId ?? finding.criterion)
}

/**
 * Plain text for a SARIF message: brackets are escaped, since `[text](n)` is SARIF's syntax for a
 * link to a related location and page text could otherwise make one.
 */
function plainText(text: string): string {
  return text.replace(/\\(?=[[\]])/g, '\\\\').replace(/[[\]]/g, '\\$&')
}

function ruleOf(finding: Finding, locale: Locale, version: WcagVersion): Rule {
  const sc = successCriterion(finding.criterion)
  if (!sc) {
    const help = safeUrl(finding.helpUrl)
    const id = ruleIdOf(finding)
    return {
      id,
      name: pascalCase(id),
      shortDescription: { text: id },
      fullDescription: { text: finding.message },
      help: { text: help ?? finding.message },
      ...(help ? { helpUri: help } : {}),
      defaultConfiguration: { level: 'warning' },
      properties: { tags: ['accessibility'] },
    }
  }
  const name = criterionName(sc.id, locale) ?? sc.name.en
  const url = understandingUrl(sc.id) ?? PROJECT_URL
  const title = `WCAG ${sc.id} ${name} (${t(locale, 'levelName', { level: sc.level })})`
  return {
    id: ruleIdOf(finding),
    name: pascalCase(sc.name.en),
    shortDescription: { text: title },
    fullDescription: { text: t(locale, 'sarifRuleDescription', { id: sc.id, name, level: sc.level, version: sc.since === '2.2' ? '2.2' : version }) },
    help: {
      text: `${t(locale, 'understanding', { id: sc.id, name })}: ${url}\n${t(locale, 'sarifWaive', { file: WAIVERS_FILE })}`,
      markdown: `[${t(locale, 'understanding', { id: sc.id, name })}](${url})\n\n${t(locale, 'sarifWaive', { file: `\`${WAIVERS_FILE}\`` })}`,
    },
    helpUri: url,
    defaultConfiguration: { level: 'error' },
    properties: { tags: ['accessibility', 'wcag', sc.since === '2.2' ? 'wcag22' : 'wcag21', `wcag-${sc.level.toLowerCase()}`, `wcag-${sc.id}`], wcagLevel: sc.level },
  }
}

function resultOf(finding: Finding, kind: Kind, report: Report, artifact: ArtifactLocation, rule: { id: string; index: number }): SarifResult {
  const locale = report.locale
  const parts = [finding.message]
  if (finding.evidence) parts.push(`${t(locale, 'evidence')}: "${finding.evidence}".`)
  // The id people put in the waivers file, since code scanning shows the message and not the properties.
  parts.push(`(id ${finding.fingerprint})`)
  const location: Location = { physicalLocation: { artifactLocation: artifact } }
  if (finding.location) {
    const { startLine, startColumn, endLine, endColumn, snippet } = finding.location
    location.physicalLocation.region = { startLine, startColumn, endLine, endColumn, ...(snippet !== undefined ? { snippet: { text: snippet } } : {}) }
  }
  const selector = finding.ref ?? finding.target
  if (selector) location.logicalLocations = [{ fullyQualifiedName: selector, kind: 'element' }]

  const result: SarifResult = {
    ruleId: rule.id,
    ruleIndex: rule.index,
    level: kind === 'below-threshold' ? 'note' : levelOf(finding.confidence),
    message: { text: plainText(parts.join(' ')) },
    locations: [location],
    partialFingerprints: { [FINGERPRINT_KEY]: stableFingerprint(finding, artifact.uri) },
    properties: {
      findingId: finding.fingerprint,
      source: finding.source,
      confidence: finding.confidence,
      ...(finding.ruleId ? { engineRule: finding.ruleId } : {}),
      ...(safeUrl(finding.helpUrl) ? { engineHelpUri: safeUrl(finding.helpUrl) } : {}),
      ...(finding.agreement ? { agreement: finding.agreement } : {}),
      ...(finding.model ? { model: finding.model } : {}),
      ...(finding.patch?.before && finding.patch.after ? { patch: { before: finding.patch.before, after: finding.patch.after } } : {}),
      ...(kind === 'below-threshold' ? { belowThreshold: true } : {}),
    },
  }
  const fix = finding.location?.fix
  if (fix && finding.patch) {
    const what =
      finding.patch.kind === 'set-attribute'
        ? t(locale, 'fixSetAttribute', { attribute: finding.patch.attribute ?? '', value: finding.patch.to })
        : t(locale, 'fixSetText', { value: finding.patch.to })
    result.fixes = [
      {
        description: { text: what },
        artifactChanges: [{ artifactLocation: artifact, replacements: [{ deletedRegion: fix.region, insertedContent: { text: fix.text } }] }],
      },
    ]
  }
  if (kind === 'waived') result.suppressions = [{ kind: 'external', status: 'accepted', justification: t(locale, 'sarifWaived', { file: WAIVERS_FILE }) }]
  return result
}

/** How sure the finding is, as SARIF's severity: GitHub fails a pull request check on errors by default. */
function levelOf(confidence: Confidence): 'error' | 'warning' | 'note' {
  return confidence === 'high' ? 'error' : confidence === 'medium' ? 'warning' : 'note'
}

/**
 * The same element, rule and page give the same value in every run: a quote the model
 * picks or the line the element moves to never changes it, so code scanning keeps tracking one alert.
 */
export function stableFingerprint(finding: Finding, artifactUri: string): string {
  return sha256([artifactUri, finding.criterion, finding.ruleId ?? 'judgment', finding.ref ?? finding.target ?? ''].join('|')).slice(0, 32)
}

/** A relative path for a local page, under the repository root; the address otherwise. */
function artifactLocationOf(report: Report): ArtifactLocation {
  const file = report.sourceFile
  if (file !== undefined) {
    if (isAbsolute(file)) return { uri: pathToFileURL(file).href }
    return { uri: file.split('/').map(encodeURIComponent).join('/'), uriBaseId: SOURCE_ROOT }
  }
  return { uri: uriOf(report.target) }
}

/** A target as a valid URI reference: addresses as they are, anything else percent-encoded. */
function uriOf(target: string): string {
  try {
    if (/^[a-z][a-z0-9+.-]*:/i.test(target) && !/^[a-z]:[\\/]/i.test(target)) return new URL(target).href
  } catch {
    // not an absolute URI
  }
  if (isAbsolute(target)) return pathToFileURL(target).href
  return target.replaceAll('\\', '/').split('/').map(encodeURIComponent).join('/')
}

function engineUrl(name: string): string {
  return name === 'axe-core' ? 'https://github.com/dequelabs/axe-core' : PROJECT_URL
}

function pascalCase(text: string): string {
  return text
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((word) => word[0]?.toUpperCase() + word.slice(1))
    .join('')
}

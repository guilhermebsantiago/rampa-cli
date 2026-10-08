import type { Report } from '../core/types.ts'
import type { Painter } from './color.ts'
import { renderHtml } from './html.ts'
import { renderMarkdown } from './markdown.ts'
import { renderReport } from './pretty.ts'
import { toSarif } from './sarif.ts'

export const FORMATS = ['pretty', 'json', 'sarif', 'markdown', 'html'] as const
export type Format = (typeof FORMATS)[number]

/** The formats that can also go to a file of their own, next to the main output: `--sarif <file>`. */
export const FILE_FORMATS = ['json', 'sarif', 'markdown', 'html'] as const satisfies readonly Format[]

export interface FormatOptions {
  verbose: boolean
  paint: Painter
}

/** The whole output of a check in one format, ready to print or to write to a file. */
export function formatReports(format: Format, reports: Report[], options: FormatOptions): string {
  switch (format) {
    case 'pretty':
      return `\n${reports.map((report) => renderReport(report, options)).join('\n\n')}\n`
    case 'json':
      return `${JSON.stringify(reports.length === 1 ? reports[0] : reports, null, 2)}\n`
    case 'sarif':
      return `${JSON.stringify(toSarif(reports, options), null, 2)}\n`
    case 'markdown':
      return renderMarkdown(reports, options)
    case 'html':
      return renderHtml(reports, options)
  }
}

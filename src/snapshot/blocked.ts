import { type Locale, t } from '../i18n.ts'
import type { Blocked } from './schema.ts'

/**
 * The report's note on a page the site replaced with a bot check or a refusal (snapshot `blocked`,
 * surfaces/bot-check.ts): what it sent, what gave it away, and that nothing on it was checked.
 */
export function blockedNote(blocked: Blocked, locale: Locale): string {
  const vendor = blocked.vendor ? ` (${blocked.vendor})` : ''
  const first =
    blocked.kind === 'refused'
      ? t(locale, 'blockedRefused', { code: blocked.status ?? '?', vendor, title: blocked.title ? `, "${blocked.title}"` : '' })
      : t(locale, 'blockedChallenge', {
          vendor,
          status: blocked.status && blocked.status >= 400 ? t(locale, 'blockedStatus', { code: blocked.status }) : '',
          evidence: t(locale, blocked.evidence === 'header' ? 'blockedEvidenceHeader' : blocked.evidence === 'mark' ? 'blockedEvidenceMark' : 'blockedEvidenceTitle', { detail: blocked.detail }),
        })
  return `${first} ${t(locale, 'blockedNothing')}`
}

/** The report's note on a page checked as the error page it is (snapshot `httpStatus`). */
export function httpErrorNote(status: number, locale: Locale): string {
  return t(locale, 'httpError', { code: status })
}

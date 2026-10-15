import type { Confidence } from '../../core/types.ts'
import type { Locale } from '../../i18n.ts'
import { type CogaData, type CogaShift, OBSERVE_VARIANT } from '../../probes/cognitive-kit.ts'
import type { InPageRect } from '../../probes/kit.ts'
import type { AdvisoryCheck, AdvisoryHit } from '../check.ts'
import { cogaBasis } from '../coga.ts'
import { am } from '../messages.ts'
import { elementFacts, experimental, htmlOf, nameOf, observedLoad, rectText, score, when } from '../observed.ts'
import type { Impact } from '../types.ts'

/**
 * COGA o4p01 Ensure Controls and Content Do Not Move Unexpectedly
 * (https://www.w3.org/WAI/WCAG2/supplemental/patterns/o4p01-unexpected-movement/), Avoid: "Controls and content that
 * move without the user’s request", and What to Do: "ensuring controls and content do not move about as the page loads
 * or refreshes".
 *
 * Facts from the observe load of the cognitive observation: the browser's own layout-shift entries
 * (PerformanceObserver, from the start of the document), during the load and the window after it, with no input, so
 * none has hadRecentInput. Shifts are grouped in session windows as Cumulative Layout Shift groups them (less than 1 s
 * apart, 5 s at most), and a session is reported when one of its shifts:
 * - scores 0.05 or more. Google rates a page's CLS (its worst session) good up to 0.1; one shift at 0.05 spends half
 *   of that by itself: content filling the window moved by 5% of its height, 40 px on an 800 px window. Smaller
 *   scores are mostly images and fonts settling by a few pixels, and would flood;
 * - or moves a link or a control (or what holds one) that was on screen by 24 CSS px or more, whatever its score: a
 *   score weighs the area that moved, so one button pushed aside scores next to nothing, yet 24 px is the minimum
 *   target size of WCAG 2.5.8, so a click aimed at where it was may land on something else.
 * Reported with the element that moved most, its box before and after, and the score; at most 5 sessions a page.
 * One that moves links or controls is a hurdle, one that moves only text or images a suggestion.
 */

export const SHIFT_SCORE = 0.05
export const CONTROL_MOVE_PX = 24
/** Session windows as CLS defines them. */
const SESSION_GAP_MS = 1000
const SESSION_SPAN_MS = 5000
const MAX_SESSIONS = 5

export interface ShiftReport {
  atMs: number
  /** The largest single shift's score, and the session's sum. */
  score: number
  total: number
  count: number
  /** The page's CLS as this load measured it: its worst session. */
  cls: number
  source: CogaShift['sources'][number]
  /** The other elements the browser named for the same shift, with their boxes. */
  others: CogaShift['sources']
  distance: number
  direction: 'down' | 'up' | 'left' | 'right'
  interactive: boolean
  /** Reported for the score (0.05 or more), or only because a control moved 24 px or more. */
  by: 'score' | 'control'
}

const areaOf = (rect: InPageRect) => rect.width * rect.height

/** How far a source moved, and where: 0 when it was not on screen before or after (it appeared or left). */
export function moveOf(source: { before: InPageRect; after: InPageRect }): { distance: number; direction: ShiftReport['direction'] } {
  if (areaOf(source.before) <= 0 || areaOf(source.after) <= 0) return { distance: 0, direction: 'down' }
  const dx = source.after.x - source.before.x
  const dy = source.after.y - source.before.y
  if (Math.abs(dy) >= Math.abs(dx)) return { distance: Math.abs(dy), direction: dy >= 0 ? 'down' : 'up' }
  return { distance: Math.abs(dx), direction: dx >= 0 ? 'right' : 'left' }
}

/** Shifts with no input, in session windows. */
export function sessionsOf(shifts: readonly CogaShift[]): CogaShift[][] {
  const sessions: CogaShift[][] = []
  for (const shift of [...shifts].filter((s) => !s.input).sort((a, b) => a.atMs - b.atMs)) {
    const current = sessions[sessions.length - 1]
    const first = current?.[0]
    const last = current?.[current.length - 1]
    if (current && first && last && shift.atMs - last.atMs < SESSION_GAP_MS && shift.atMs - first.atMs <= SESSION_SPAN_MS) current.push(shift)
    else sessions.push([shift])
  }
  return sessions
}

/** The shifts to report, one per session. Pure: the thresholds above, applied to the observe record. */
export function layoutShifts(observe: CogaData): ShiftReport[] {
  const sessions = sessionsOf(observe.shifts)
  const sum = (session: CogaShift[]) => session.reduce((total, shift) => total + shift.score, 0)
  const cls = Math.max(0, ...sessions.map(sum))
  const reports: ShiftReport[] = []
  for (const session of sessions) {
    const controlMoved = (shift: CogaShift) => shift.sources.some((source) => source.interactive && areaOf(source.before) > 0 && moveOf(source).distance >= CONTROL_MOVE_PX)
    const qualifying = session.filter((shift) => shift.score >= SHIFT_SCORE || controlMoved(shift))
    if (qualifying.length === 0) continue
    const sources = qualifying.flatMap((shift) => shift.sources.map((source) => ({ shift, source, move: moveOf(source) }))).filter((entry) => entry.move.distance > 0)
    // The control that moved most, else whatever moved most; of equals, the one highest on the page, where the eye is.
    const pick = [...sources].sort(
      (a, b) => Number(b.source.interactive) - Number(a.source.interactive) || Math.round(b.move.distance) - Math.round(a.move.distance) || a.source.before.y - b.source.before.y,
    )[0]
    if (!pick) continue
    const top = Math.max(...qualifying.map((shift) => shift.score))
    reports.push({
      atMs: pick.shift.atMs,
      score: top,
      total: Math.round(sum(session) * 10000) / 10000,
      count: session.length,
      cls: Math.round(cls * 10000) / 10000,
      source: pick.source,
      others: pick.shift.sources.filter((source) => source !== pick.source),
      distance: Math.round(pick.move.distance),
      direction: pick.move.direction,
      interactive: pick.source.interactive,
      by: top >= SHIFT_SCORE ? 'score' : 'control',
    })
  }
  // One report per element: the same container pushed down twice is one thing that moves.
  const seen = new Set<string>()
  return reports
    .sort((a, b) => Number(b.interactive) - Number(a.interactive) || b.score - a.score)
    .filter((report) => {
      const key = report.source.el.ref ?? `${report.source.el.tag}|${report.source.el.label}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .slice(0, MAX_SESSIONS)
}

export function shiftImpact(report: ShiftReport): Impact {
  return report.interactive ? 'hurdle' : 'suggestion'
}

function messageOf(report: ShiftReport, data: CogaData, locale: Locale): string {
  const direction = am(locale, report.direction === 'down' ? 'lsDown' : report.direction === 'up' ? 'lsUp' : report.direction === 'left' ? 'lsLeft' : 'lsRight')
  const session = report.count > 1 ? am(locale, 'lsSession', { count: report.count, total: score(report.total, locale) }) : ''
  const moved = am(locale, 'lsShift', { when: when(report.atMs, data, locale), what: nameOf(report.source.el), distance: report.distance, direction, score: score(report.score, locale), session })
  return [moved, report.interactive ? am(locale, 'lsControls') : '', am(locale, 'lsRecommend'), experimental(data, locale)].filter(Boolean).join(' ')
}

export const layoutShift: AdvisoryCheck = {
  id: 'coga/layout-shift',
  version: '1',
  maturity: 'experimental',
  pattern: 'o4p01',
  surfaces: ['web'],
  observes: true,

  run({ page, locale, coga }) {
    const observe = observedLoad(page.snapshot, OBSERVE_VARIANT, locale, coga)
    if (!observe.data) return { ran: false, reason: observe.reason, candidates: 0, hits: [] }
    const data = observe.data
    const basis = cogaBasis('o4p01', 'avoid', 'Controls and content that move without the user’s request.')
    const reports = layoutShifts(data)
    const hits: AdvisoryHit[] = reports.map((report) => {
      const confidence: Confidence = report.by === 'score' ? 'high' : 'medium'
      return {
        kind: 'advisory',
        basis,
        impact: shiftImpact(report),
        source: 'rule',
        ref: report.source.el.ref,
        html: htmlOf(page, report.source.el),
        message: messageOf(report, data, locale),
        evidence: `${nameOf(report.source.el)}: ${rectText(report.source.before)} → ${rectText(report.source.after)} at ${report.atMs} ms, score ${report.score}`,
        subject: report.interactive ? 'shift:controls' : 'shift',
        facts: {
          atMs: report.atMs,
          loadMs: data.loadMs,
          score: report.score,
          sessionScore: report.total,
          shifts: report.count,
          cls: report.cls,
          before: rectText(report.source.before),
          after: rectText(report.source.after),
          distance: report.distance,
          direction: report.direction,
          interactive: report.interactive,
          reportedBy: report.by,
          ...elementFacts(report.source.el),
          ...(report.others.length > 0
            ? { otherSources: report.others.slice(0, 4).map((source) => `${source.el.ref ?? `<${source.el.tag}>`} ${rectText(source.before)} → ${rectText(source.after)}`).join(' | ') }
            : {}),
        },
        confidence,
      } satisfies AdvisoryHit
    })
    return { ran: true, candidates: sessionsOf(data.shifts).length, hits }
  },
}

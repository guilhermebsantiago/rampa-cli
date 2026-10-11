import type { A11yNode } from '../snapshot/schema.ts'
import type { CdpSessionLike } from './form-issues.ts'

/**
 * What a page does with the device's motion sensors, read after collection for 2.5.4 Motion Actuation (src/rules/scope.ts):
 *
 * - the `devicemotion`, `deviceorientation` and `deviceorientationabsolute` listeners on `window`, over the DevTools
 *   protocol (DOMDebugger.getEventListeners), with the script and line that added each;
 * - in the page's scripts (Debugger.getScriptSource, within a budget), the calls that add such a listener, set an
 *   `ondevicemotion` handler, ask for the permission iOS requires (`DeviceMotionEvent.requestPermission`) or start a
 *   motion sensor (`new Accelerometer()`, `new Gyroscope()`…): a page that listens only after a tap shows there.
 *
 * Facts, never verdicts: a fraud check or an analytics script listens too, and nothing on the page moves. The record
 * goes on the document node (`native.motion`), so a saved snapshot is judged again offline.
 */

export interface MotionListener {
  type: string
  /** The script that added it, by its address; '' for one written in the page or evaluated. */
  script: string
  line?: number | undefined
}

export interface MotionMention {
  /** addEventListener, handler, requestPermission or sensor. */
  api: 'addEventListener' | 'handler' | 'requestPermission' | 'sensor'
  /** The event, the permission's interface or the sensor named: devicemotion, DeviceOrientationEvent, Gyroscope. */
  name: string
  script: string
  /** The code around it, on one line. */
  quote: string
}

export interface MotionFacts {
  listeners: MotionListener[]
  mentions: MotionMention[]
  /** Scripts left out of the reading, past the budget or too large to read: what they do is not known. */
  leftOut: number
}

export const MOTION_EVENTS = ['devicemotion', 'deviceorientation', 'deviceorientationabsolute'] as const

const PATTERNS: ReadonlyArray<[MotionMention['api'], RegExp]> = [
  ['addEventListener', /addEventListener\(\s*(['"`])(devicemotion|deviceorientation(?:absolute)?)\1/g],
  ['handler', /\.on(devicemotion|deviceorientation(?:absolute)?)\s*=(?!=)/g],
  ['requestPermission', /(Device(?:Motion|Orientation)Event)\s*\.\s*requestPermission\s*\(/g],
  ['sensor', /new\s+(Accelerometer|LinearAccelerationSensor|GravitySensor|Gyroscope|AbsoluteOrientationSensor|RelativeOrientationSensor)\s*\(/g],
]

const BUDGET = { ms: 3000, bytes: 16_000_000, scripts: 300, scriptBytes: 4_000_000 }
const MAX_MENTIONS = 12
const REPLAY_WAIT_MS = 100
/** Of each kind of call, in one script: a bundle that listens in ten places says so in two. */
const PER_KIND = 2

/** The calls in one script's source, each kind once or twice; a quote of about 80 characters around each. */
export function scanScript(source: string, script: string): MotionMention[] {
  const found: MotionMention[] = []
  for (const [api, pattern] of PATTERNS) {
    pattern.lastIndex = 0
    let kept = 0
    for (let match = pattern.exec(source); match && kept < PER_KIND; match = pattern.exec(source), kept++) {
      const name = (api === 'addEventListener' ? match[2] : match[1]) ?? ''
      const start = Math.max(0, match.index - 30)
      const quote = source.slice(start, match.index + match[0].length + 30).replace(/\s+/g, ' ').trim()
      found.push({ api, name, script, quote })
    }
  }
  return found
}

interface ScriptParsed {
  scriptId: string
  url?: string
  length?: number
}

interface ListenerRecord {
  type: string
  scriptId: string
  lineNumber: number
}

/** Reads the motion listeners and the scripts' motion calls onto the document node (`native.motion`). Never throws. */
export async function attachMotionFacts(open: () => Promise<CdpSessionLike | undefined>, root: A11yNode, budget: Partial<typeof BUDGET> = {}): Promise<void> {
  const limits = { ...BUDGET, ...budget }
  let opened: CdpSessionLike | undefined
  try {
    opened = await open()
  } catch {
    return
  }
  if (!opened) return
  const session = opened
  const deadline = Date.now() + limits.ms
  const scripts = new Map<string, { url: string; length: number }>()
  try {
    session.on('Debugger.scriptParsed', (event) => {
      const parsed = event as ScriptParsed
      scripts.set(parsed.scriptId, { url: parsed.url ?? '', length: parsed.length ?? 0 })
    })
    // The page's scripts as the engine parsed them; a page that pauses on `debugger` must not stop the reading.
    await session.send('Debugger.enable', {})
    await session.send('Debugger.setSkipAllPauses', { skip: true })
    // The scripts already parsed arrive as events next to the answer to Debugger.enable: a short wait lets them all in.
    await new Promise((resolve) => setTimeout(resolve, REPLAY_WAIT_MS))
    const { result } = (await session.send('Runtime.evaluate', { expression: 'window' })) as { result: { objectId?: string } }
    const listeners: MotionListener[] = []
    if (result.objectId) {
      const { listeners: all } = (await session.send('DOMDebugger.getEventListeners', { objectId: result.objectId, depth: 0 })) as { listeners: ListenerRecord[] }
      for (const listener of all) {
        if (!(MOTION_EVENTS as readonly string[]).includes(listener.type)) continue
        listeners.push({ type: listener.type, script: scripts.get(listener.scriptId)?.url ?? '', line: listener.lineNumber + 1 })
      }
    }
    const mentions: MotionMention[] = []
    // What Playwright and Rampa inject counts toward the budget too, so how much was read is not recorded: it varies.
    const scanned = { scripts: 0, bytes: 0, leftOut: 0 }
    for (const [scriptId, script] of scripts) {
      // What Playwright and Rampa ran in the page (the collector, axe-core) is not the page's.
      if (script.url.startsWith('__playwright') || script.url.startsWith('pptr:')) continue
      if (Date.now() > deadline || scanned.scripts >= limits.scripts || scanned.bytes >= limits.bytes || script.length > limits.scriptBytes) {
        scanned.leftOut++
        continue
      }
      const { scriptSource } = (await session.send('Debugger.getScriptSource', { scriptId }).catch(() => ({ scriptSource: '' }))) as { scriptSource: string }
      scanned.scripts++
      scanned.bytes += scriptSource.length
      for (const mention of scanScript(scriptSource, script.url)) if (mentions.length < MAX_MENTIONS) mentions.push(mention)
    }
    const facts: MotionFacts = { listeners, mentions, leftOut: scanned.leftOut }
    root.native.motion = facts
  } catch {
    // A page that navigated away or closed: no record, and the rule says nothing.
  } finally {
    await session.send('Debugger.disable').catch(() => undefined)
    await session.detach().catch(() => undefined)
  }
}

/** The motion record of a snapshot, when the collector read one. */
export function motionFactsOf(root: A11yNode): MotionFacts | undefined {
  const value = root.native.motion as MotionFacts | undefined
  return value && Array.isArray(value.listeners) && Array.isArray(value.mentions) ? value : undefined
}

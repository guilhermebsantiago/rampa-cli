import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { checkSnapshot } from '../src/core/check.ts'
import type { EngineResults, Report } from '../src/core/types.ts'
import { emptyEngine } from '../src/engine/axe.ts'
import { snapshotSignature } from '../src/probes/identity.ts'
import { type AutoplayFact, type MediaData, type MediaItem, playerOf } from '../src/probes/media.ts'
import { AUTOPLAY_ARGS, probeLaunchArgs } from '../src/probes/run.ts'
import { probeChecks } from '../src/rules/probes.ts'
import { PROBE_RULES } from '../src/rules/registry.ts'
import { renderReport } from '../src/report/pretty.ts'
import { paint } from '../src/report/color.ts'
import { A11ySnapshotSchema, type A11yNode, type A11ySnapshot, type ProbeRecord } from '../src/snapshot/schema.ts'
import { loadRecorded } from '../src/surfaces/targets.ts'
import { type Collected, collectWeb, launchBrowser } from '../src/surfaces/web.ts'
import { startFixtureServers } from './media-server.ts'
import { byRule, probeCheckOptions, reviewByRule } from './probe-helpers.ts'

const MEDIA = ['1.2.1', '1.2.2', '1.2.3', '1.2.4', '1.2.5', '1.4.2']

describe('media probe helpers', () => {
  it('knows the players that live in frames of another origin', () => {
    expect(playerOf('www.youtube.com')).toBe('YouTube')
    expect(playerOf('www.youtube-nocookie.com')).toBe('YouTube')
    expect(playerOf('player.vimeo.com')).toBe('Vimeo')
    expect(playerOf('w.soundcloud.com')).toBe('SoundCloud')
    expect(playerOf('open.spotify.com')).toBe('Spotify')
    expect(playerOf('ads.example.com')).toBeNull()
    expect(playerOf('notyoutube.com')).toBeNull()
  })

  it('lets media autoplay only in a browser started for the media probe', () => {
    expect(probeLaunchArgs([])).toEqual([])
    expect(probeLaunchArgs(['layout'])).not.toContain(AUTOPLAY_ARGS[0])
    expect(probeLaunchArgs(['layout', 'media'])).toEqual(expect.arrayContaining(['--force-color-profile=srgb', '--autoplay-policy=no-user-gesture-required']))
  })
})

/** A recorded media probe, built by hand: the rules read only these facts. */
const node = (ref: string, tag: string, attributes: Record<string, string> = {}): A11yNode => ({ ref, role: tag === 'iframe' ? 'iframe' : 'generic', states: [], native: { tag, attributes }, children: [] })
const identity = (n: A11yNode) => ({ tag: String(n.native.tag), sig: snapshotSignature(n) })

const VIDEO = node('#talk', 'video', { id: 'talk', src: 'talk.webm' })
const AUDIO = node('#music', 'audio', { id: 'music', src: 'voice.webm' })
const FRAME = node('#yt', 'iframe', { id: 'yt', src: 'https://www.youtube.com/embed/x' })

function snapshotOf(data: Partial<MediaData>, nodes: A11yNode[] = [VIDEO, AUDIO, FRAME], record: Partial<ProbeRecord> = {}): A11ySnapshot {
  const body: A11yNode = { ref: 'html > body', role: 'generic', states: [], native: { tag: 'body', attributes: {} }, children: nodes }
  const full: MediaData = {
    items: [],
    detached: [],
    frames: [],
    webAudio: { contexts: 0, running: 0, sources: 0, connected: false, audibleMs: null, peakDb: null, blocked: false },
    pageControls: [],
    pageTranscript: [],
    pageDescription: [],
    autoplayPolicy: 'allowed',
    watchMs: 4600,
    sampleMs: 2500,
    unsampled: 0,
    omitted: 0,
    ...data,
  }
  return {
    schemaVersion: 1,
    surface: 'web',
    target: 'https://example.com/',
    viewport: { width: 1280, height: 800, scale: 1 },
    root: { ref: 'html', role: 'document', states: [], native: { tag: 'html', attributes: {} }, children: [body] },
    observations: {
      probes: [
        {
          kind: 'media',
          version: '1',
          conditions: { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, browser: 'chromium 1 (headless)', variant: 'media' },
          status: 'complete',
          guard: { blocked: [], navigations: [], dialogs: [] },
          durationMs: 1,
          data: full,
          ...record,
        },
      ],
    },
    collectedAt: new Date(0).toISOString(),
    collector: { name: 'rampa-web', version: '0' },
  }
}

const item = (n: A11yNode, extra: Partial<MediaItem> = {}): MediaItem => ({
  ref: n.ref,
  id: identity(n),
  tag: String(n.native.tag),
  role: 'generic',
  label: '',
  kind: n.native.tag === 'audio' ? 'audio' : 'video',
  src: String((n.native.attributes as Record<string, string> | undefined)?.src ?? ''),
  crossOrigin: false,
  visible: true,
  box: { width: 320, height: 240 },
  attributes: { autoplay: false, loop: false, muted: false, controls: true, preload: '' },
  sample: 'played',
  duration: 6,
  live: false,
  hasAudio: true,
  hasVideo: n.native.tag !== 'audio',
  level: { peakDb: -12.5, audibleMs: 2400, sampledMs: 2500 },
  tracks: [],
  transcript: [],
  description: [],
  controls: [],
  name: '',
  ...extra,
})

const autoplay = (extra: Partial<AutoplayFact> = {}): AutoplayFact => ({
  started: true,
  blocked: false,
  at: 200,
  playedMs: 3700,
  audibleMs: 3500,
  peakDb: -12.5,
  decoded: true,
  playing: true,
  watchedMs: 3800,
  loop: false,
  ...extra,
})

const rows = (snapshot: A11ySnapshot) => Object.fromEntries(probeChecks(snapshot, 'en', PROBE_RULES).coverage.map((row) => [row.criterion, row]))
const run = (snapshot: A11ySnapshot) => probeChecks(snapshot, 'en', PROBE_RULES)

describe('media rules over recorded observations', () => {
  it('fails a captions track that does not load or holds no cues, and keeps one that loaded cues', () => {
    const broken = run(snapshotOf({ items: [item(VIDEO, { tracks: [{ kind: 'captions', label: 'English', srclang: 'en', src: 'missing.vtt', default: false, state: 'error', cues: 0 }] })] }))
    expect(broken.findings.map((f) => `${f.criterion} ${f.ruleId} ${f.ref} ${f.confidence}`)).toEqual(['1.2.2 rampa/captions #talk high'])
    expect(broken.findings[0]?.message).toMatch(/^This video's captions track does not load/)
    expect(broken.findings[0]?.evidence).toMatch(/^captions \(English, en\) missing\.vtt: failed to load; 6 s long; has an audio track/)
    const empty = run(snapshotOf({ items: [item(VIDEO, { tracks: [{ kind: 'subtitles', label: '', srclang: 'en', src: 'empty.vtt', default: true, state: 'loaded', cues: 0 }] })] }))
    expect(empty.findings[0]?.message).toMatch(/loads but holds no cues/)
    const good = snapshotOf({
      items: [
        item(VIDEO, {
          tracks: [
            { kind: 'captions', label: '', srclang: 'en', src: 'missing.vtt', default: false, state: 'error', cues: 0 },
            { kind: 'captions', label: '', srclang: 'pt', src: 'pt.vtt', default: false, state: 'loaded', cues: 3, first: 'Olá' },
          ],
        }),
      ],
    })
    expect(run(good).findings).toEqual([])
    expect(rows(good)['1.2.2']).toMatchObject({ status: 'no-failure-found', applicable: 1, failures: 0 })
    expect(rows(good)['1.2.2']?.note).toContain('1 video(s) with a captions track that loaded cues (their accuracy is not checked)')
  })

  it('sends a video with sound and no captions track to review, and leaves one with no audio track to 1.2.1', () => {
    const result = run(snapshotOf({ items: [item(VIDEO, { tracks: [] })] }))
    expect(result.findings).toEqual([])
    expect(result.review.map((f) => `${f.criterion} ${f.ruleId}`).sort()).toEqual(['1.2.2 rampa/captions', '1.2.3 rampa/media-alternative', '1.2.5 rampa/audio-description'])
    const silent = run(snapshotOf({ items: [item(VIDEO, { hasAudio: false, level: null, attributes: { autoplay: true, loop: true, muted: true, controls: false, preload: '' } })] }))
    expect(silent.review.map((f) => `${f.criterion} ${f.ruleId}`)).toEqual(['1.2.1 rampa/audio-video-only'])
    expect(silent.review[0]?.message).toMatch(/^Video only \(no audio track\).*if it only decorates the page, it needs no alternative\.$/)
    expect(rows(snapshotOf({ items: [item(VIDEO, { hasAudio: false })] }))['1.2.2']?.note).toContain('1 video(s) with no audio track, which need no captions')
  })

  it('lists what it found for 1.2.1, 1.2.3 and 1.2.5, and never fails them', () => {
    const transcript = { ref: '#t', id: { tag: 'a', sig: 'a|||||#t' }, tag: 'a', text: 'Read the transcript', near: true }
    const ad = { ref: '#ad', id: { tag: 'a', sig: 'a|||||#ad' }, tag: 'a', text: 'Audio described version', near: true }
    const result = run(
      snapshotOf({
        items: [item(VIDEO, { transcript: [transcript], description: [ad], tracks: [{ kind: 'captions', label: '', srclang: 'en', src: 'c.vtt', default: true, state: 'loaded', cues: 4 }] }), item(AUDIO, { transcript: [] })],
        pageTranscript: [{ ...transcript, ref: '#t2', text: 'Transcripts', near: false }],
      }),
    )
    expect(result.findings).toEqual([])
    const review = Object.fromEntries(result.review.map((f) => [`${f.criterion} ${f.ref}`, f.evidence]))
    expect(review['1.2.3 #talk']).toMatch(/^audio description near it: <a> "Audio described version"; transcript near it: <a> "Read the transcript"; elsewhere on the page: <a> "Transcripts"/)
    // At AA a transcript does not count: 1.2.5 lists only the description.
    expect(review['1.2.5 #talk']).toMatch(/^audio description near it: <a> "Audio described version"; 6 s long/)
    expect(review['1.2.1 #music']).toMatch(/^elsewhere on the page: <a> "Transcripts"; 6 s long/)
  })

  it('fails sound that plays on its own for more than 3 s with no way to stop it, high when measured', () => {
    const music = item(AUDIO, { visible: false, attributes: { autoplay: true, loop: false, muted: false, controls: false, preload: '' }, autoplay: autoplay() })
    const result = run(snapshotOf({ items: [music] }))
    expect(result.findings.map((f) => `${f.criterion} ${f.ref} ${f.confidence}`)).toEqual(['1.4.2 #music high'])
    expect(result.findings[0]?.evidence).toMatch(/^started 0\.2 s after the page began loading, with its sound on; played 3\.7 s, 3\.5 s of it above -50 dBFS \(loudest -12\.5 dBFS\); still playing when the watch ended; no native controls, and no pause, stop, mute or volume control shows on the page/)
    // Its level unread (media from another origin), but its audio decoded: medium.
    const unread = run(snapshotOf({ items: [{ ...music, crossOrigin: true, autoplay: autoplay({ audibleMs: null, peakDb: null }) }] }))
    expect(unread.findings.map((f) => `${f.ref} ${f.confidence}`)).toEqual(['#music medium'])
    // The probe settles axe-core's undecided no-autoplay-audio on the element it measured.
    expect(result.resolved).toEqual(expect.arrayContaining([{ engineRule: 'no-autoplay-audio', ref: '#music' }]))
  })

  it('lets native controls, a named control next to it or a sound control on the page stop it, and sends a far pause button to review', () => {
    const base = item(AUDIO, { attributes: { autoplay: true, loop: false, muted: false, controls: true, preload: '' }, autoplay: autoplay() })
    expect(run(snapshotOf({ items: [base] })).findings).toEqual([])
    expect(rows(snapshotOf({ items: [base] }))['1.4.2']?.note).toContain('sound on its own that a control may stop: its own controls (not pressed)')
    const noControls = { ...base, visible: false, attributes: { ...base.attributes, controls: false } }
    const mute = { ref: '#mute', id: { tag: 'button', sig: 'button|mute||button||' }, tag: 'button', label: 'Mute', kind: 'mute' as const, near: true }
    expect(run(snapshotOf({ items: [{ ...noControls, controls: [mute] }] })).findings).toEqual([])
    expect(run(snapshotOf({ items: [noControls], pageControls: [{ ...mute, label: 'Sound off', near: false }] })).findings).toEqual([])
    const weak = run(snapshotOf({ items: [noControls], pageControls: [{ ...mute, label: 'Pause slideshow', kind: 'play-pause', near: false }] }))
    expect(weak.findings).toEqual([])
    expect(weak.review.filter((f) => f.criterion === '1.4.2').map((f) => f.message)).toEqual([expect.stringMatching(/the only control found is "Pause slideshow", away from it/)])
  })

  it('does not fail sound that stops within 3 s, plays silence or has no audio track; reviews a blocked autoplay and a quiet one', () => {
    const muted = { autoplay: true, loop: false, muted: false, controls: false, preload: '' }
    const short = run(snapshotOf({ items: [item(AUDIO, { visible: false, attributes: muted, autoplay: autoplay({ playedMs: 2000, audibleMs: 1900, playing: false, stopped: { how: 'ended', at: 2200 } }) })] }))
    expect(short.findings).toEqual([])
    expect(short.coverage.find((r) => r.criterion === '1.4.2')?.note).toContain('1 sound(s) that stopped within 3 s')
    const silence = run(snapshotOf({ items: [item(VIDEO, { attributes: muted, autoplay: autoplay({ audibleMs: 0, peakDb: -112 }) })] }))
    expect(silence.findings.concat(silence.review).filter((f) => f.criterion === '1.4.2')).toEqual([])
    const noTrack = run(snapshotOf({ items: [item(VIDEO, { hasAudio: false, attributes: muted, autoplay: autoplay() })] }))
    expect(noTrack.findings).toEqual([])
    const blocked = run(snapshotOf({ items: [item(AUDIO, { visible: false, attributes: muted, autoplay: autoplay({ started: false, blocked: true, at: null, playedMs: 0, audibleMs: null, playing: false }) })] }))
    expect(blocked.review.filter((f) => f.criterion === '1.4.2').map((f) => f.message)).toEqual([expect.stringMatching(/the browser did not start it in this run/)])
    const quiet = run(snapshotOf({ items: [item(AUDIO, { visible: false, attributes: muted, autoplay: autoplay({ audibleMs: 1200 }) })] }))
    expect(quiet.review.filter((f) => f.criterion === '1.4.2').map((f) => `${f.confidence} ${f.message}`)).toEqual([expect.stringMatching(/^low .*sounded for only 1\.2 s of it/)])
  })

  it('fails sound from a script with no element, and from Web Audio, on the page body', () => {
    const result = run(
      snapshotOf({
        detached: [{ src: 'https://example.com/bgm.mp3', crossOrigin: false, autoplay: autoplay() }],
        webAudio: { contexts: 1, running: 1, sources: 2, connected: true, audibleMs: 4200, peakDb: -17, blocked: false },
      }),
    )
    expect(result.findings.map((f) => `${f.ref} ${f.confidence} ${f.message.slice(0, 40)}`)).toEqual([
      'html > body high Audio a script plays on load (https://ex',
      'html > body medium Sound made with the Web Audio API plays ',
    ])
    expect(new Set(result.findings.map((f) => f.fingerprint)).size).toBe(2)
  })

  it('says there was nothing to check, and what it may have missed', () => {
    const none = rows(snapshotOf({ frames: [{ ref: '#ad', id: { tag: 'iframe', sig: 'iframe|ad||||' }, src: 'https://ads.example.net/x', host: 'ads.example.net', player: null, visible: true }] }))
    for (const criterion of MEDIA) {
      expect(none[criterion]).toMatchObject({ status: 'no-failure-found', applicable: 0, failures: 0, review: 0 })
      expect(none[criterion]?.note).toMatch(/^no audio or video found in the page, its open shadow roots or its same-origin frames; players in frames of another origin \(YouTube, Vimeo and other embeds\), in closed shadow roots, or added after the probe's 4\.6 s watch may be missed; 1 other frame\(s\) of another origin not read$/)
    }
  })

  it('sends a known player in a frame of another origin to review for 1.2.2, and leaves the rest not checked', () => {
    const snapshot = snapshotOf({ frames: [{ ref: '#yt', id: identity(FRAME), src: 'https://www.youtube.com/embed/x', host: 'www.youtube.com', player: 'YouTube', visible: true }] })
    const result = run(snapshot)
    expect(result.findings).toEqual([])
    expect(result.review.map((f) => `${f.criterion} ${f.ref}`)).toEqual(['1.2.2 #yt'])
    expect(result.review[0]?.message).toMatch(/^A YouTube player in a frame of another origin: Rampa cannot read its media/)
    const byCriterion = rows(snapshot)
    expect(byCriterion['1.2.2']).toMatchObject({ status: 'needs-review', applicable: 1 })
    for (const criterion of ['1.2.1', '1.2.3', '1.2.4', '1.2.5']) expect(byCriterion[criterion]?.status).toBe('not-checked')
    expect(byCriterion['1.2.3']?.note).toContain('1 player(s) in frames of another origin not read (YouTube)')
    expect(byCriterion['1.4.2']?.status).toBe('no-failure-found')
    // Asked by its address to autoplay with sound: 1.4.2 to review; muted, nothing.
    const frame = { ref: '#yt', id: identity(FRAME), host: 'www.youtube.com', player: 'YouTube', visible: true }
    const autoplaying = run(snapshotOf({ frames: [{ ...frame, src: 'https://www.youtube.com/embed/x?autoplay=1&rel=0' }] }))
    expect(autoplaying.review.map((f) => `${f.criterion} ${f.ref} ${f.confidence}`)).toEqual(['1.2.2 #yt medium', '1.4.2 #yt low'])
    const muted = run(snapshotOf({ frames: [{ ...frame, src: 'https://www.youtube.com/embed/x?autoplay=1&mute=1' }] }))
    expect(muted.review.map((f) => f.criterion)).toEqual(['1.2.2'])
  })

  it('leaves a player with no source yet not checked, rather than saying nothing applies', () => {
    const player = item(AUDIO, { visible: false, sample: 'no-source', duration: null, hasAudio: null, level: null, attributes: { autoplay: false, loop: false, muted: false, controls: false, preload: 'none' } })
    const byCriterion = rows(snapshotOf({ items: [player] }))
    expect(byCriterion['1.2.1']).toMatchObject({ status: 'not-checked', applicable: 0 })
    expect(byCriterion['1.2.1']?.note).toContain('1 audio or video element(s) not read: no source yet (a player that loads its media when played) or a load error')
    // An audio element is not a video: 1.2.2 has nothing to apply to.
    expect(byCriterion['1.2.2']?.status).toBe('no-failure-found')
    // A hidden sound effect with a source, never played, is not counted.
    const effect = rows(snapshotOf({ items: [{ ...player, sample: 'not-showing', src: 'click.mp3' }] }))
    expect(effect['1.2.1']?.status).toBe('no-failure-found')
  })

  it('counts a fact whose element changed between loads as unmatched, never a finding', () => {
    const moved = item(VIDEO, { id: { tag: 'video', sig: 'video|other||||' }, tracks: [{ kind: 'captions', label: '', srclang: 'en', src: 'x.vtt', default: false, state: 'error', cues: 0 }] })
    const result = run(snapshotOf({ items: [moved] }))
    expect(result.findings).toEqual([])
    expect(result.coverage.find((r) => r.criterion === '1.2.2')).toMatchObject({ unmatched: 1, applicable: 0 })
  })

  it('settles axe-core undecided video-caption and no-autoplay-audio on the elements it read, in the report', async () => {
    const snapshot = snapshotOf({ items: [item(VIDEO, { tracks: [] }), item(AUDIO, { visible: false, attributes: { autoplay: true, loop: false, muted: false, controls: false, preload: '' }, autoplay: autoplay() })] })
    const incomplete = (ruleId: string, criterion: string, ref: string) => ({ ruleId, outcome: 'incomplete' as const, criteria: [criterion], help: ruleId, helpUrl: '', nodes: [{ ref, target: ref, html: '' }] })
    const engine: EngineResults = { ...emptyEngine('axe-core'), rules: [incomplete('video-caption', '1.2.2', '#talk'), incomplete('no-autoplay-audio', '1.4.2', '#music'), incomplete('video-caption', '1.2.2', '#elsewhere')] }
    const report = await checkSnapshot(snapshot, engine, probeCheckOptions())
    const axeReview = (report.needsReview ?? []).filter((r) => !r.ruleId.startsWith('rampa/'))
    expect(axeReview.map((r) => `${r.ruleId} ${r.ref}`)).toEqual(['video-caption #elsewhere'])
    expect(byRule(report, 'rampa/audio-control').map((f) => f.ref)).toEqual(['#music'])
    for (const criterion of MEDIA) expect(report.coverage.criteria?.find((c) => c.id === criterion)?.methods).toContainEqual(expect.objectContaining({ kind: 'probe', maturity: 'experimental' }))
  })

  it('writes in the report language', () => {
    const result = probeChecks(snapshotOf({ items: [item(VIDEO, { tracks: [{ kind: 'captions', label: '', srclang: 'en', src: 'x.vtt', default: false, state: 'error', cues: 0 }] })] }), 'pt-BR', PROBE_RULES)
    expect(result.findings[0]?.message).toMatch(/^A faixa de legendas deste vídeo não carrega/)
    expect(result.coverage.find((r) => r.criterion === '1.2.2')?.conditions).toMatch(/^observado ao carregar, depois tocado sem som por 2\.5 s · /)
  })
})

// Integration: needs Chrome or Edge, and the fixtures over HTTP (a file page cannot load its own tracks or read its media).
const servers = await startFixtureServers()
const browser = await launchBrowser({ args: probeLaunchArgs(['media']) }).catch((error: unknown) => {
  process.stderr.write(`\nSkipping the media probe tests: no browser started (${error instanceof Error ? error.message.split('\n')[0] : String(error)}).\n`)
  return undefined
})
// Closing Edge can take long on a loaded machine.
afterAll(async () => {
  await browser?.close()
  await servers.close()
}, 60_000)

const collected = new Map<string, Promise<Collected>>()
function probed(name: string): Promise<Collected> {
  if (!browser) throw new Error('no browser')
  let result = collected.get(name)
  if (!result) {
    const url = `${servers.origin}/${name}${name === 'media-frame.html' ? `?other=${encodeURIComponent(servers.other)}` : ''}`
    result = collectWeb(browser, url, { runAxe: true, locale: 'en', probes: ['media'] })
    collected.set(name, result)
  }
  return result
}
// The pages load at once: each probe watches its page for about 5 s and plays its media for 2.5 s.
if (browser) for (const name of ['media-fail.html', 'media-pass.html', 'media-review.html', 'media-frame.html', 'media-script.html', 'media-none.html']) probed(name).catch(() => undefined)

const dataOf = (snapshot: A11ySnapshot) => snapshot.observations?.probes.find((p) => p.kind === 'media')?.data as MediaData | undefined
const reviewOf = (report: Report) => (report.needsReview ?? []).filter((r) => r.ruleId.startsWith('rampa/')).map((r) => `${r.criterion} ${r.ruleId} ${r.ref}`)
const statusOf = (report: Report) => Object.fromEntries(MEDIA.map((id) => [id, report.coverage.criteria?.find((c) => c.id === id)?.status]))

describe.skipIf(!browser)('media probe (1.2.1–1.2.5, 1.4.2)', { timeout: 120_000 }, () => {
  it('watches the load, plays what shows muted, loads the tracks and puts everything back, behind the guard', async () => {
    const { snapshot } = await probed('media-fail.html')
    expect(A11ySnapshotSchema.safeParse(snapshot).success).toBe(true)
    const record = snapshot.observations?.probes.find((p) => p.kind === 'media')
    expect(record).toMatchObject({ kind: 'media', version: '1', status: 'complete', conditions: { variant: 'media' } })
    expect(record?.guard.blocked).toEqual([])
    const data = dataOf(snapshot)
    const byRef = Object.fromEntries((data?.items ?? []).map((i) => [i.ref, i]))
    expect(byRef['#broken']).toMatchObject({ kind: 'video', sample: 'played', duration: 6, live: false, hasAudio: true, hasVideo: true })
    expect(byRef['#broken']?.tracks).toEqual([expect.objectContaining({ kind: 'captions', src: 'media/missing.vtt', state: 'error' })])
    expect(byRef['#empty']?.tracks).toEqual([expect.objectContaining({ src: 'media/empty.vtt', state: 'loaded', cues: 0 })])
    expect(byRef['#broken']?.level?.peakDb).toBeGreaterThan(-20)
    expect(byRef['#music']).toMatchObject({ kind: 'audio', visible: false, sample: 'already-playing' })
    expect(byRef['#music']?.autoplay).toMatchObject({ started: true, blocked: false, playing: true })
    expect(byRef['#music']?.autoplay?.audibleMs).toBeGreaterThan(3000)
  })

  it('fails captions tracks that do not load or hold no cues, and audio that plays on its own with no control (ACT 80f0bf)', async () => {
    const { snapshot, engine } = await probed('media-fail.html')
    const report = await checkSnapshot(snapshot, engine, probeCheckOptions())
    expect(byRule(report, 'rampa/captions').map((f) => `${f.ref} ${f.confidence}`)).toEqual(['#broken high', '#empty high'])
    expect(byRule(report, 'rampa/audio-control').map((f) => `${f.ref} ${f.confidence}`)).toEqual(['#music high'])
    expect(byRule(report, 'rampa/audio-control')[0]).toMatchObject({ source: 'probe', experimental: true, criterion: '1.4.2' })
    // axe-core's undecided no-autoplay-audio on the same element is the probe's to report.
    expect((report.needsReview ?? []).filter((r) => r.ruleId === 'no-autoplay-audio')).toEqual([])
    expect(statusOf(report)).toMatchObject({ '1.2.2': 'failures', '1.4.2': 'failures', '1.2.1': 'needs-review', '1.2.3': 'needs-review', '1.2.5': 'needs-review', '1.2.4': 'no-applicable-content' })
  })

  it('finds no failure with captions that load, a muted loop, sound that stops within 3 s, native controls and named buttons next to it', async () => {
    const { snapshot, engine } = await probed('media-pass.html')
    const report = await checkSnapshot(snapshot, engine, probeCheckOptions())
    expect(report.findings.filter((f) => f.source === 'probe')).toEqual([])
    const data = dataOf(snapshot)
    const byRef = Object.fromEntries((data?.items ?? []).map((i) => [i.ref, i]))
    expect(byRef['#hero']).toMatchObject({ hasAudio: false, sample: 'already-playing' })
    expect(byRef['#hero']?.autoplay).toBeUndefined()
    expect(byRef['#captioned']?.transcript.map((s) => s.text)).toEqual(['Read the transcript'])
    expect(byRef['#captioned']?.description.map((s) => s.text)).toEqual(['audio described version'])
    expect(byRef['#trailer']?.controls.map((c) => `${c.kind} ${c.label}`)).toEqual(['play-pause Pause', 'mute Mute'])
    expect(byRef['#jingle']?.autoplay).toMatchObject({ started: true, playing: false, stopped: { how: 'ended' } })
    const note = report.coverage.probes?.find((r) => r.criterion === '1.4.2')?.note ?? ''
    expect(note).toContain('sound on its own that a control may stop: its own controls, "Pause" (not pressed)')
    expect(note).toContain('1 sound(s) that stopped within 3 s')
    expect(reviewOf(report)).toEqual(
      expect.arrayContaining(['1.2.1 rampa/audio-video-only #hero', '1.2.1 rampa/audio-video-only #podcast', '1.2.3 rampa/media-alternative #captioned', '1.2.5 rampa/audio-description #captioned']),
    )
    expect(statusOf(report)).toMatchObject({ '1.2.2': 'no-failure-found', '1.4.2': 'no-failure-found' })
  })

  it('sends a video with no captions track, a silent autoplay and a far pause button to review', async () => {
    const { snapshot, engine } = await probed('media-review.html')
    const report = await checkSnapshot(snapshot, engine, probeCheckOptions())
    expect(report.findings.filter((f) => f.source === 'probe')).toEqual([])
    expect(reviewOf(report)).toEqual(expect.arrayContaining(['1.2.2 rampa/captions #nocaptions', '1.4.2 rampa/audio-control #radio']))
    expect(reviewByRule(report, 'rampa/audio-control').map((r) => r.ref)).toEqual(['#radio'])
    expect(report.coverage.probes?.find((r) => r.criterion === '1.4.2')?.note).toContain('1 element(s) that played on their own with no sound')
    // The probe settles axe-core's undecided video-caption on the videos it read.
    expect((report.needsReview ?? []).filter((r) => r.ruleId === 'video-caption')).toEqual([])
  })

  it('reads media in a frame of the same origin, and lists a frame of another origin it cannot read', async () => {
    const { snapshot, engine } = await probed('media-frame.html')
    const report = await checkSnapshot(snapshot, engine, probeCheckOptions())
    expect(byRule(report, 'rampa/audio-control').map((f) => f.ref)).toEqual(['#local |> #frame-music'])
    expect(byRule(report, 'rampa/audio-control')[0]?.evidence).toContain('in the frame #local')
    expect(reviewOf(report)).toEqual(expect.arrayContaining(['1.2.2 rampa/captions #local |> #frame-video']))
    expect(dataOf(snapshot)?.frames.map((f) => `${f.ref} ${f.player}`)).toEqual(['#remote null'])
    expect(report.coverage.probes?.find((r) => r.criterion === '1.2.2')?.note).toContain('1 other frame(s) of another origin not read')
  })

  it('fails sound a script plays on load, from an Audio object and from Web Audio', async () => {
    const { snapshot, engine } = await probed('media-script.html')
    const report = await checkSnapshot(snapshot, engine, probeCheckOptions())
    expect(byRule(report, 'rampa/audio-control').map((f) => `${f.ref} ${f.confidence} ${f.message.slice(0, 24)}`)).toEqual(['html > body high Audio a script plays on ', 'html > body medium Sound made with the Web '])
    expect(dataOf(snapshot)?.webAudio).toMatchObject({ contexts: 1, connected: true, sources: 1 })
  })

  it('says there is no audio or video, and what it may have missed', async () => {
    const { snapshot, engine } = await probed('media-none.html')
    const report = await checkSnapshot(snapshot, engine, probeCheckOptions())
    for (const criterion of MEDIA) expect(statusOf(report)[criterion]).toBe('no-applicable-content')
    expect(report.coverage.probes?.find((r) => r.criterion === '1.2.2')?.note).toMatch(/^no audio or video found in the page.*may be missed$/)
    const text = renderReport(report, { verbose: true, paint: paint(false) })
    expect(text).toMatch(/1\.2\.2 +probe\/media@1 \(rampa\/captions\) · watched on load, then played muted for 2\.5 s/)
  })

  it('replays a saved snapshot offline to the same findings', async () => {
    const { snapshot, engine } = await probed('media-fail.html')
    const live = await checkSnapshot(snapshot, engine, probeCheckOptions())
    const dir = await mkdtemp(join(tmpdir(), 'rampa-media-'))
    const path = join(dir, 'media.snapshot.json')
    await writeFile(path, JSON.stringify(snapshot), 'utf8')
    await writeFile(join(dir, 'media.engine.json'), JSON.stringify(engine), 'utf8')
    const loaded = await loadRecorded(path, 'en')
    const replayed = await checkSnapshot(loaded.snapshot, loaded.engine, probeCheckOptions())
    const key = (report: Report) => report.findings.map((f) => `${f.fingerprint} ${f.evidence}`)
    expect(key(replayed)).toEqual(key(live))
    expect(replayed.coverage.probes).toEqual(live.coverage.probes)
  })
})

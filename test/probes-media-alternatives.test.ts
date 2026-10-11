import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { checkSnapshot } from '../src/core/check.ts'
import type { Report } from '../src/core/types.ts'
import { snapshotSignature } from '../src/probes/identity.ts'
import type { AltFetch, AltText, MediaAlternative } from '../src/probes/media-alternatives.ts'
import { type MediaData, type MediaFrame, type MediaItem, type MediaTrack, playerMedia, playerOf } from '../src/probes/media.ts'
import { probeLaunchArgs } from '../src/probes/run.ts'
import { isPlaceholderText, judgeAlternative, judgeTrack, placeholderCues } from '../src/rules/media-alternatives.ts'
import { type ProbeRuleResult, probeChecks } from '../src/rules/probes.ts'
import { PROBE_RULES } from '../src/rules/registry.ts'
import { A11ySnapshotSchema, type A11yNode, type A11ySnapshot } from '../src/snapshot/schema.ts'
import { loadRecorded } from '../src/surfaces/targets.ts'
import { type Collected, collectWeb, launchBrowser } from '../src/surfaces/web.ts'
import { startFixtureServers } from './media-server.ts'
import { byRule, probeCheckOptions, reviewByRule } from './probe-helpers.ts'

/**
 * WCAG 1.2.1 and 1.2.2 from the media probe's version 2 (docs/plans/wcag-coverage.md, D3): alternatives found, read and
 * quoted; a failure only when every alternative found is a placeholder or broken. Never a verdict on equivalence.
 */

describe('known players', () => {
  it('tells podcast and music hosts, which play audio, from video hosts', () => {
    expect(playerMedia('playlist.megaphone.fm')).toBe('audio')
    expect(playerMedia('w.soundcloud.com')).toBe('audio')
    expect(playerMedia('cdn.podigee.com')).toBe('audio')
    expect(playerOf('cdn.podigee.com')).toBe('Podigee')
    expect(playerMedia('www.youtube-nocookie.com')).toBe('video')
    expect(playerMedia('ads.example.com')).toBeNull()
  })
})

const text = (excerpt: string, extra: Partial<AltText> = {}): AltText => ({ chars: excerpt.length, words: excerpt ? excerpt.split(' ').length : 0, excerpt, ...extra })
const alt = (extra: Partial<MediaAlternative> = {}): MediaAlternative => ({
  how: 'link',
  by: 'name',
  offers: 'text',
  ref: '#t',
  id: { tag: 'a', sig: 'a|||||#' },
  tag: 'a',
  label: 'Transcript',
  near: true,
  ...extra,
})
const fetched = (extra: Partial<AltFetch>): AltFetch => ({ method: 'GET', url: 'https://example.com/t.html', status: 200, crossOrigin: false, ...extra })
const judge = (a: MediaAlternative) => {
  const v = judgeAlternative(a, 'en')
  return `${v.state} ${v.confidence}`
}
const track = (extra: Partial<MediaTrack>): MediaTrack => ({ kind: 'captions', label: '', srclang: 'en', src: 'c.vtt', default: false, state: 'loaded', cues: 3, ...extra })

describe('alternatives: broken, holding text, or not read', () => {
  it('fails a link that goes nowhere only when nothing on the page handles a press', () => {
    expect(judge(alt({ href: '#', placeholder: 'hash', handled: 'none' }))).toBe('broken high')
    expect(judgeAlternative(alt({ href: '#', placeholder: 'hash', handled: 'none' }), 'en').why).toBe('leads nowhere (href="#"), and nothing on the page handles a press')
    // A click listener on an ancestor or the document only: maybe delegation, often analytics.
    expect(judge(alt({ href: '#', placeholder: 'hash', handled: 'delegated' }))).toBe('broken medium')
    expect(judge(alt({ href: '#', placeholder: 'hash', handled: 'own' }))).toBe('unread medium')
    expect(judge(alt({ href: 'javascript:void(0)', placeholder: 'javascript', handled: 'markup' }))).toBe('unread medium')
    // Listeners that could not be read: cannot tell.
    expect(judge(alt({ href: '#', placeholder: 'hash' }))).toBe('unread medium')
    const missing = judgeAlternative(alt({ href: '#episode-5', missing: true, handled: 'none' }), 'en')
    expect(missing).toMatchObject({ state: 'broken', confidence: 'high' })
    expect(missing.why).toMatch(/^leads nowhere: no element of the page has the id "episode-5"/)
    // A link to "#" that names the region it opens in aria-controls: the region is read.
    expect(judge(alt({ href: '#', placeholder: 'hash', handled: 'markup', content: text('Host: welcome to the show.'), shown: 'collapsed' }))).toBe('content high')
  })

  it('reads what an address answers: 404, 410 and "not found" pages are broken; another origin only gets a HEAD', () => {
    const link = (f: Partial<AltFetch>) => judge(alt({ href: 't.html', url: 'https://example.com/t.html', fetched: fetched(f) }))
    expect(link({ status: 404 })).toBe('broken high')
    expect(link({ status: 410 })).toBe('broken high')
    expect(link({ method: 'HEAD', status: 404, crossOrigin: true })).toBe('broken medium')
    expect(link({ method: 'FILE', status: 404 })).toBe('broken high')
    expect(link({ status: 200, type: 'text/html', title: 'Page not found', text: text('Page not found. Try the home page.') })).toBe('broken medium')
    expect(link({ status: 200, type: 'text/html', title: 'Erro 404 | Portal', text: text('Ops') })).toBe('broken medium')
    expect(link({ status: 200, type: 'text/html', title: 'Episode 1 transcript', text: text('Host: welcome to the show.') })).toBe('content high')
    expect(link({ status: 200, type: 'text/html', text: text('') })).toBe('broken high')
    expect(link({ status: 200, type: 'text/plain', text: text('Transcript coming soon.') })).toBe('broken high')
    expect(link({ status: 200, type: 'text/vtt', cues: 0, text: text('') })).toBe('broken high')
    expect(link({ status: 200, type: 'application/pdf', bytes: 0 })).toBe('broken high')
    // What the probe does not read is never broken.
    expect(link({ status: 200, type: 'application/pdf', bytes: 123_456 })).toBe('unread medium')
    expect(link({ method: 'HEAD', status: 200, crossOrigin: true })).toBe('unread medium')
    expect(link({ status: 403 })).toBe('unread medium')
    expect(link({ status: 503 })).toBe('unread medium')
    expect(link({ status: null, error: 'Timeout 5000ms exceeded.' })).toBe('unread medium')
    expect(judge(alt({ href: 't.html', url: 'https://example.com/t.html' }))).toBe('unread medium')
  })

  it('reads text: empty and placeholder text is broken; hidden text next to the media too, unless something may show it', () => {
    expect(judge(alt({ how: 'details', tag: 'details', content: text(''), shown: 'collapsed' }))).toBe('broken high')
    expect(judge(alt({ how: 'section', tag: 'h3', content: text('Transcript coming soon.') }))).toBe('broken high')
    expect(judge(alt({ how: 'region', tag: 'div', content: text('Lorem ipsum dolor sit amet, consectetur adipiscing elit.') }))).toBe('broken high')
    // Empty, but found only by its id or class, or collapsed behind a control: a script may fill it.
    expect(judge(alt({ how: 'region', by: 'attribute', tag: 'div', content: text('') }))).toBe('unread high')
    expect(judge(alt({ how: 'button', tag: 'button', content: text(''), shown: 'collapsed' }))).toBe('unread high')
    expect(judge(alt({ how: 'region', tag: 'section', content: text('') }))).toBe('broken high')
    expect(judge(alt({ how: 'region', tag: 'section', content: text('', { embeds: 1 }) }))).toBe('unread medium')
    // Text no one can reach.
    expect(judge(alt({ how: 'adjacent', by: 'refers', tag: 'p', content: text('The audio above says: hello.'), shown: 'aria-hidden' }))).toBe('broken medium')
    expect(judge(alt({ how: 'adjacent', by: 'refers', tag: 'p', content: text('The video above shows a square.'), shown: 'hidden' }))).toBe('broken medium')
    expect(judge(alt({ how: 'section', tag: 'h2', near: false, content: text('Host: hello.'), shown: 'hidden' }))).toBe('unread medium')
    expect(judge(alt({ how: 'details', tag: 'details', content: text('Host: hello.'), shown: 'collapsed' }))).toBe('content high')
    expect(judge(alt({ how: 'button', tag: 'button' }))).toBe('unread medium')
  })

  it('tells placeholder text from real text, in English, Portuguese and Spanish', () => {
    for (const placeholder of ['Transcript coming soon.', 'Coming soon', 'TBD', 'Transcrição em breve', 'Em breve', 'Próximamente', 'Transcript to follow', 'Lorem ipsum dolor sit amet, consectetur.', '…'])
      expect(isPlaceholderText(text(placeholder)), placeholder).toBe(true)
    for (const real of ['Host: welcome to the show.', 'Transcript: a voice hums a low note.', 'Soon after, the note rises.', 'Coming soon to a theatre near you: our new film, in which a voice hums.'])
      expect(isPlaceholderText(text(real)), real).toBe(false)
  })

  it('reads tracks: no cues, empty cues and placeholder cues are broken; "[Music]" is a caption', () => {
    expect(judgeTrack(track({ state: 'error', cues: 0 }), 'en')).toMatchObject({ state: 'broken', why: 'does not load' })
    expect(judgeTrack(track({ cues: 0 }), 'en')).toMatchObject({ state: 'broken', why: 'holds no cues' })
    expect(placeholderCues(track({ cues: 2, blank: 2, distinct: 0, texts: [] }))).toBe('blank')
    expect(placeholderCues(track({ cues: 4, blank: 0, distinct: 2, texts: ['TODO', 'Lorem ipsum dolor.'] }))).toBe('placeholder')
    expect(placeholderCues(track({ cues: 4, blank: 0, distinct: 1, texts: ['[Music]'] }))).toBeUndefined()
    expect(placeholderCues(track({ cues: 40, blank: 0, distinct: 12, texts: ['TODO', 'Hello', 'there'] }))).toBeUndefined()
    // Version 1 records have no cue texts: never a placeholder.
    expect(placeholderCues(track({ cues: 2 }))).toBeUndefined()
    expect(judgeTrack(track({ cues: 3, blank: 0, distinct: 3, texts: ['Hello.', 'How are you?', 'Fine.'] }), 'en').state).toBe('content')
    expect(judgeTrack(track({ state: 'loading', cues: null }), 'en').state).toBe('unread')
  })
})

/** A recorded media probe of version 2, built by hand: the rules read only these facts. */
const node = (ref: string, tag: string, attributes: Record<string, string> = {}): A11yNode => ({ ref, role: tag === 'iframe' ? 'iframe' : 'generic', states: [], native: { tag, attributes }, children: [] })
const identity = (n: A11yNode) => ({ tag: String(n.native.tag), sig: snapshotSignature(n) })
const PODCAST = node('#podcast', 'audio', { id: 'podcast', src: 'ep1.webm' })
const OTHER = node('#other', 'audio', { id: 'other', src: 'ep2.webm' })
const CLIP = node('#clip', 'video', { id: 'clip', src: 'clip.webm' })
const TALK = node('#talk', 'video', { id: 'talk', src: 'talk.webm' })
const PLAYER = node('#player', 'iframe', { id: 'player', src: 'https://playlist.megaphone.fm/?e=1' })

function snapshotOf(data: Partial<MediaData>, version = '2'): A11ySnapshot {
  const body: A11yNode = { ref: 'html > body', role: 'generic', states: [], native: { tag: 'body', attributes: {} }, children: [PODCAST, OTHER, CLIP, TALK, PLAYER] }
  const full: MediaData = {
    items: [],
    detached: [],
    frames: [],
    webAudio: { contexts: 0, running: 0, sources: 0, connected: false, audibleMs: null, peakDb: null, blocked: false },
    pageControls: [],
    pageTranscript: [],
    pageDescription: [],
    pageAlternatives: [],
    fetched: [],
    anchors: 1,
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
          version,
          conditions: { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, browser: 'chromium 1 (headless)', variant: 'media' },
          status: 'complete',
          guard: { blocked: [], navigations: [], dialogs: [] },
          durationMs: 1,
          data: full,
        },
      ],
    },
    collectedAt: new Date(0).toISOString(),
    collector: { name: 'rampa-web', version: '0' },
  }
}

const media = (n: A11yNode, extra: Partial<MediaItem> = {}): MediaItem => ({
  ref: n.ref,
  id: identity(n),
  tag: String(n.native.tag),
  role: 'generic',
  label: '',
  kind: n.native.tag === 'audio' ? 'audio' : 'video',
  src: String((n.native.attributes as Record<string, string> | undefined)?.src ?? ''),
  crossOrigin: false,
  visible: true,
  box: { width: 300, height: 54 },
  attributes: { autoplay: false, loop: false, muted: false, controls: true, preload: '' },
  sample: 'played',
  duration: 6,
  live: false,
  hasAudio: n.native.tag === 'audio' ? true : true,
  hasVideo: n.native.tag !== 'audio',
  level: { peakDb: -12.5, audibleMs: 2400, sampledMs: 2500 },
  tracks: [],
  transcript: [],
  description: [],
  controls: [],
  name: '',
  alternatives: [],
  ...extra,
})

const frame = (extra: Partial<MediaFrame> = {}): MediaFrame => ({
  ref: '#player',
  id: identity(PLAYER),
  src: 'https://playlist.megaphone.fm/?e=1',
  host: 'playlist.megaphone.fm',
  player: 'Megaphone',
  media: 'audio',
  visible: true,
  alternatives: [],
  ...extra,
})

const run = (snapshot: A11ySnapshot, locale: 'en' | 'pt-BR' = 'en') => probeChecks(snapshot, locale, PROBE_RULES)
const of = (result: ProbeRuleResult, criterion: string) => ({
  findings: result.findings.filter((f) => f.criterion === criterion),
  review: result.review.filter((f) => f.criterion === criterion),
  row: result.coverage.find((r) => r.criterion === criterion),
})

const hash = alt({ ref: '#hash', href: '#', placeholder: 'hash', handled: 'none' })
const gone = alt({ ref: '#gone', label: 'Transcript (PDF)', href: 'ep1.pdf', url: 'https://example.com/ep1.pdf', fetched: fetched({ url: 'https://example.com/ep1.pdf', status: 404, type: 'text/html' }) })
const details = alt({ ref: '#details', how: 'details', tag: 'details', content: text('Host: welcome to the show. Today a voice hums one low note.'), shown: 'collapsed' })

describe('1.2.1 over recorded observations (probe version 2)', () => {
  it('fails audio whose only alternative is broken, naming it, and quotes what it found', () => {
    const result = of(run(snapshotOf({ items: [media(PODCAST, { alternatives: [hash] })] })), '1.2.1')
    expect(result.findings.map((f) => `${f.ref} ${f.ruleId} ${f.confidence}`)).toEqual(['#podcast rampa/audio-video-only high'])
    expect(result.findings[0]?.message).toBe(
      'Audio only: the one alternative found for this audio is broken (leads nowhere (href="#"), and nothing on the page handles a press), so nobody who cannot hear it gets its content (WCAG 1.2.1). Fix it, or publish the transcript next to the audio.',
    )
    expect(result.findings[0]?.evidence).toMatch(/^<a> "Transcript" → #: leads nowhere \(href="#"\), and nothing on the page handles a press; 6 s long; sound above -50 dBFS/)
    expect(result.row).toMatchObject({ status: 'failures', applicable: 1, failures: 1 })
    expect(result.row?.note).toContain('a failure here means every alternative found was a placeholder or broken; whether a working one is equivalent is never checked')
    // Two broken alternatives: as sure as the less sure one.
    const two = of(run(snapshotOf({ items: [media(PODCAST, { alternatives: [hash, { ...gone, fetched: fetched({ method: 'HEAD', status: 404, crossOrigin: true }) }] })] })), '1.2.1')
    expect(two.findings.map((f) => f.confidence)).toEqual(['medium'])
    expect(two.findings[0]?.message).toMatch(/^Audio only: all 2 alternatives found for this audio are placeholders or broken \(listed below\)/)
  })

  it('sends audio to review when an alternative holds text or was not read, quoting it and naming the broken one', () => {
    const mixed = of(run(snapshotOf({ items: [media(PODCAST, { alternatives: [gone, details] })] })), '1.2.1')
    expect(mixed.findings).toEqual([])
    expect(mixed.review[0]?.message).toBe(
      'Audio only: text that may be its transcript was found (quoted below). Check that it gives the same information as the audio (WCAG 1.2.1), unless the audio is itself an alternative for text on the page, labeled as such. One alternative found is broken or a placeholder (listed below).',
    )
    expect(mixed.review[0]?.evidence).toMatch(
      /^<a> "Transcript \(PDF\)" → ep1\.pdf \(GET 404, text\/html\): answers 404; <details> "Transcript": 59 characters, "Host: welcome to the show\. Today a voice hums one low note\." \(collapsed\); 6 s long/,
    )
    const unread = of(run(snapshotOf({ items: [media(PODCAST, { alternatives: [alt({ how: 'button', tag: 'button', label: 'Show transcript' })] })] })), '1.2.1')
    expect(unread.review[0]?.message).toMatch(/^Audio only: an alternative was found but not read \(listed below\)/)
    expect(unread.review[0]?.evidence).toMatch(/^<button> "Show transcript": a control the probe never presses; /)
    const none = of(run(snapshotOf({ items: [media(PODCAST)] })), '1.2.1')
    expect(none.review[0]?.message).toMatch(/^Audio only: no transcript was found\./)
    expect(none.review[0]?.evidence).toMatch(/^no transcript or other alternative was found on the page; /)
    // An audio described version is no transcript for audio: left out.
    const audioOffer = of(run(snapshotOf({ items: [media(PODCAST, { alternatives: [{ ...hash, offers: 'audio', label: 'Audio described version' }] })] })), '1.2.1')
    expect(audioOffer.findings).toEqual([])
    expect(audioOffer.review[0]?.message).toMatch(/^Audio only: no transcript was found\./)
  })

  it('takes what is elsewhere on the page as the alternative only of the one media there, and never fails on it otherwise', () => {
    const single = of(run(snapshotOf({ items: [media(PODCAST)], pageAlternatives: [{ ...hash, near: false }] })), '1.2.1')
    expect(single.findings.map((f) => f.ref)).toEqual(['#podcast'])
    expect(single.findings[0]?.evidence).toMatch(/^elsewhere on the page: <a> "Transcript" → #: leads nowhere/)
    // Two media: something elsewhere that holds text may be the alternative of either, so neither fails.
    const two = of(run(snapshotOf({ items: [media(PODCAST, { alternatives: [hash] }), media(OTHER)], pageAlternatives: [{ ...details, near: false }], anchors: 2 })), '1.2.1')
    expect(two.findings).toEqual([])
    expect(two.review.map((f) => f.ref)).toEqual(['#podcast', '#other'])
    expect(two.review[0]?.evidence).toContain('elsewhere on the page: <details> "Transcript": 59 characters')
    // … but something broken elsewhere does not save a media whose own alternative is broken.
    const brokenElsewhere = of(run(snapshotOf({ items: [media(PODCAST, { alternatives: [hash] }), media(OTHER)], pageAlternatives: [{ ...gone, near: false }], anchors: 2 })), '1.2.1')
    expect(brokenElsewhere.findings.map((f) => f.ref)).toEqual(['#podcast'])
  })

  it('reads a video with no sound: its tracks, an audio player next to it, a silent soundtrack', () => {
    const silentVideo = (extra: Partial<MediaItem>) => media(CLIP, { hasAudio: false, level: null, ...extra })
    const broken = of(run(snapshotOf({ items: [silentVideo({ tracks: [track({ kind: 'descriptions', state: 'error', cues: 0, src: 'd.vtt' })] })] })), '1.2.1')
    expect(broken.findings.map((f) => `${f.ref} ${f.confidence}`)).toEqual(['#clip high'])
    expect(broken.findings[0]?.message).toMatch(/^Video only \(no audio track\): the one alternative found for this video is broken \(does not load\)/)
    // A video that may only decorate (muted, looping, on its own, no controls) needs no alternative: to review, never failed.
    const decorative = of(
      run(snapshotOf({ items: [silentVideo({ attributes: { autoplay: true, loop: true, muted: true, controls: false, preload: '' }, tracks: [track({ kind: 'descriptions', state: 'error', cues: 0 })] })] })),
      '1.2.1',
    )
    expect(decorative.findings).toEqual([])
    expect(decorative.review[0]?.message).toMatch(/^Video only \(no audio track\): every alternative found is broken or a placeholder \(listed below\)\. Check whether it only decorates the page.*if it only decorates the page, it needs no alternative\.$/)
    const described = of(run(snapshotOf({ items: [silentVideo({ tracks: [track({ kind: 'descriptions', cues: 3, blank: 0, distinct: 3, texts: ['A rabbit climbs out.', 'He yawns.', 'He walks.'] })] })] })), '1.2.1')
    expect(described.review[0]?.message).toContain('The only alternative with content is a descriptions track, which browsers and screen readers seldom present (ACT c3232f counts it as no alternative).')
    expect(described.review[0]?.evidence).toMatch(/^descriptions track \(en\) c\.vtt: 3 cue\(s\), "A rabbit climbs out\.", "He yawns\."/)
    const withAudio = of(run(snapshotOf({ items: [silentVideo({ nearMedia: ['#podcast'] }), media(PODCAST)], anchors: 2 })), '1.2.1')
    expect(withAudio.review.find((f) => f.ref === '#clip')?.evidence).toMatch(/^an audio player next to it, <audio> #podcast \(ep1\.webm\), 6 s long; /)
    // An audio track silent at the start and at three more points: a video with no sound.
    const quiet = { level: { peakDb: -120, audibleMs: 0, sampledMs: 2500 }, points: { at: [3.4, 6.9, 10.3], sampledMs: 2300, peakDb: -120, audibleMs: 0 } }
    const result = run(snapshotOf({ items: [media(TALK, { ...quiet, alternatives: [alt({ how: 'adjacent', by: 'refers', tag: 'p', content: text('The above video shows a rabbit.') })] })] }))
    expect(of(result, '1.2.1').review[0]?.message).toMatch(/^Video only \(its audio track is silent\): an alternative was found \(quoted below\)/)
    expect(of(result, '1.2.1').review[0]?.evidence).toMatch(/^<p> next to it that refers to it: 31 characters, "The above video shows a rabbit\."; 6 s long; has an audio track; silent in the 2\.5 s played muted; silent again at 3\.4 s, 6\.9 s, 10\.3 s/)
    expect(of(result, '1.2.2').row).toMatchObject({ applicable: 0, review: 0 })
    expect(of(result, '1.2.2').row?.note).toContain('1 video(s) whose audio track was silent at its start and at three more points, taken as having no sound (1.2.1)')
    expect(of(result, '1.2.3').review).toEqual([])
    // Sound at one of the points: a video with sound, as before.
    const loud = run(snapshotOf({ items: [media(TALK, { ...quiet, points: { ...quiet.points, audibleMs: 600, peakDb: -20 } })] }))
    expect(of(loud, '1.2.1').review).toEqual([])
    expect(of(loud, '1.2.2').review.map((f) => f.ref)).toEqual(['#talk'])
  })

  it('counts a hidden audio element with a play control next to it (a custom player), not one with only the controls attribute', () => {
    const hidden = media(PODCAST, { visible: false, sample: 'not-showing', hasAudio: null, level: null })
    expect(of(run(snapshotOf({ items: [hidden] })), '1.2.1').row?.applicable).toBe(0)
    const play = { ref: '#play', id: { tag: 'div', sig: 'div||button|||' }, tag: 'div', label: 'Play', kind: 'play-pause' as const, near: true }
    const custom = of(run(snapshotOf({ items: [{ ...hidden, attributes: { ...hidden.attributes, controls: false }, controls: [play] }] })), '1.2.1')
    expect(custom.row?.applicable).toBe(1)
    expect(custom.review.map((f) => f.ref)).toEqual(['#podcast'])
  })

  it('sends a podcast or music player in a frame of another origin to review under 1.2.1, quoting the transcript, never failing it', () => {
    const transcript = alt({ ref: '#tr', how: 'section', tag: 'strong', content: text('Leah: Houston, we have a podcast. Welcome to episode 438.') })
    const result = run(snapshotOf({ frames: [frame({ alternatives: [transcript] })] }))
    expect(of(result, '1.2.1').review[0]?.message).toBe(
      'A Megaphone audio player in a frame of another origin: Rampa cannot read its audio. Check that a transcript gives the same information as what it plays (WCAG 1.2.1).',
    )
    expect(of(result, '1.2.1').review[0]?.evidence).toBe(
      'https://playlist.megaphone.fm/?e=1; <strong> "Transcript" and the text after it: 57 characters, "Leah: Houston, we have a podcast. Welcome to episode 438."',
    )
    expect(of(result, '1.2.1').row).toMatchObject({ status: 'needs-review', applicable: 1 })
    expect(of(result, '1.2.1').row?.note).not.toContain('no audio or video found')
    // Audio needs no captions: no 1.2.2 item for it, and 1.2.2 is not left "not checked" because of it.
    expect(of(result, '1.2.2').review).toEqual([])
    expect(of(result, '1.2.2').row?.status).toBe('no-failure-found')
    const broken = of(run(snapshotOf({ frames: [frame({ alternatives: [hash] })] })), '1.2.1')
    expect(broken.findings).toEqual([])
    expect(broken.review[0]?.message).toMatch(/Every transcript found for it is broken \(listed below\): check/)
    // A version 1 record: as before, the player goes to 1.2.2, and 1.2.1 is not checked.
    const v1 = run(snapshotOf({ frames: [frame()] }, '1'))
    expect(of(v1, '1.2.2').review.map((f) => f.ref)).toEqual(['#player'])
    expect(of(v1, '1.2.1').row?.status).toBe('not-checked')
  })

  it('writes in the report language', () => {
    const result = of(run(snapshotOf({ items: [media(PODCAST, { alternatives: [hash] })] }), 'pt-BR'), '1.2.1')
    expect(result.findings[0]?.message).toMatch(/^Só áudio: a única alternativa achada para este áudio está quebrada \(não leva a lugar nenhum \(href="#"\), e nada na página trata o acionamento\)/)
  })
})

describe('1.2.2 over recorded observations (probe version 2)', () => {
  it('fails a captions track whose cues are all empty or placeholders, and keeps "[Music]"', () => {
    const blank = of(run(snapshotOf({ items: [media(TALK, { tracks: [track({ src: 'blank.vtt', cues: 2, blank: 2, distinct: 0, texts: [] })] })] })), '1.2.2')
    expect(blank.findings.map((f) => `${f.ref} ${f.confidence}`)).toEqual(['#talk high'])
    expect(blank.findings[0]?.message).toMatch(/^This video's captions track holds only empty or placeholder cues/)
    expect(blank.findings[0]?.evidence).toMatch(/^captions \(en\) blank\.vtt: loaded, 2 cue\(s\), all empty; /)
    const lorem = of(run(snapshotOf({ items: [media(TALK, { tracks: [track({ cues: 2, blank: 0, distinct: 1, texts: ['Lorem ipsum dolor sit amet.'], first: 'Lorem ipsum dolor sit amet.' })] })] })), '1.2.2')
    expect(lorem.findings[0]?.evidence).toMatch(/^captions \(en\) c\.vtt: loaded, 2 cue\(s\), all placeholders: "Lorem ipsum dolor sit amet\."; /)
    const music = of(run(snapshotOf({ items: [media(TALK, { tracks: [track({ cues: 1, blank: 0, distinct: 1, texts: ['[Music]'] })] })] })), '1.2.2')
    expect(music.findings).toEqual([])
    expect(music.row?.note).toContain('1 video(s) with a captions track that loaded cues')
  })

  it('quotes the text found next to a video with no captions track: no caption, but the video may be its alternative', () => {
    const transcript = alt({ href: '#transcript', content: text('Narrator: a rabbit climbs out of a hole.') })
    const result = of(run(snapshotOf({ items: [media(TALK, { alternatives: [transcript] })] })), '1.2.2')
    expect(result.review[0]?.evidence).toMatch(/; text found next to it: <a> "Transcript" → #transcript: 40 characters, "Narrator: a rabbit climbs out of a hole\."$/)
  })
})

// Integration: needs Chrome or Edge, and the fixtures over HTTP, with a second origin for the links that only get a HEAD.
const servers = await startFixtureServers()
const browser = await launchBrowser({ args: probeLaunchArgs(['media']) }).catch((error: unknown) => {
  process.stderr.write(`\nSkipping the media alternatives tests: no browser started (${error instanceof Error ? error.message.split('\n')[0] : String(error)}).\n`)
  return undefined
})
afterAll(async () => {
  await browser?.close()
  await servers.close()
}, 60_000)

const collected = new Map<string, Promise<Collected>>()
function probed(name: string): Promise<Collected> {
  if (!browser) throw new Error('no browser')
  let result = collected.get(name)
  if (!result) {
    result = collectWeb(browser, `${servers.origin}/${name}?other=${encodeURIComponent(servers.other)}`, { runAxe: true, locale: 'en', probes: ['media'] })
    collected.set(name, result)
  }
  return result
}
const PAGES = ['media-alternatives-fail.html', 'media-alternatives-review.html', 'media-alternatives-hidden.html']
if (browser) for (const name of PAGES) probed(name).catch(() => undefined)

const dataOf = (snapshot: A11ySnapshot) => snapshot.observations?.probes.find((p) => p.kind === 'media')?.data as MediaData | undefined
const reviewOf = (report: Report, rule: string) => Object.fromEntries(reviewByRule(report, rule).map((r) => [r.ref, r]))

describe.skipIf(!browser)('media alternatives in the browser (1.2.1, 1.2.2)', { timeout: 120_000 }, () => {
  it('reads alternatives read-only: GET in the page origin, one HEAD to another, nothing else', async () => {
    const { snapshot } = await probed('media-alternatives-fail.html')
    expect(A11ySnapshotSchema.safeParse(snapshot).success).toBe(true)
    const record = snapshot.observations?.probes.find((p) => p.kind === 'media')
    expect(record).toMatchObject({ version: '2', status: 'complete' })
    expect(record?.guard.blocked).toEqual([])
    const requests = (dataOf(snapshot)?.fetched ?? []).map((f) => `${f.method} ${f.url.replace(servers.origin, 'here').replace(servers.other, 'other')} ${f.status}`).sort()
    expect(requests).toEqual(['GET here/media/no-such-transcript.html 404', 'GET here/media/not-found.html 200', 'HEAD other/media/no-such-transcript.html 404'])
    const hash = dataOf(snapshot)?.items.find((i) => i.ref === '#hash')?.alternatives
    expect(hash).toEqual([expect.objectContaining({ how: 'link', href: '#', placeholder: 'hash', handled: 'none', near: true })])
  })

  it('fails media whose every alternative is a placeholder or broken, and captions of placeholders', async () => {
    const { snapshot, engine } = await probed('media-alternatives-fail.html')
    const report = await checkSnapshot(snapshot, engine, probeCheckOptions())
    expect(byRule(report, 'rampa/audio-video-only').map((f) => `${f.ref} ${f.confidence}`)).toEqual([
      '#hash high',
      '#gone high',
      '#empty high',
      '#soon high',
      '#missing high',
      '#soft medium',
      '#remote medium',
      '#described high',
    ])
    const why = Object.fromEntries(byRule(report, 'rampa/audio-video-only').map((f) => [f.ref, (f.evidence ?? '').split('; ')[0]]))
    expect(why['#gone']).toBe('<a> "Read the transcript" → media/no-such-transcript.html (GET 404, text/plain): answers 404')
    expect(why['#empty']).toBe('<details> "Transcript": empty: no text')
    expect(why['#soon']).toBe('<h3> "Transcript" and the text after it: a placeholder: "Transcript coming soon."')
    expect(why['#soft']).toBe('<a> "Transcript" → media/not-found.html (GET 200, text/html, title "Page not found"): answers 200 with a "not found" page')
    expect(why['#described']).toBe('descriptions track (Descriptions, en) media/empty.vtt: holds no cues')
    expect(byRule(report, 'rampa/captions').map((f) => `${f.ref} ${f.confidence}`)).toEqual(['#lorem high', '#blank high'])
    expect(report.coverage.criteria?.find((c) => c.id === '1.2.1')?.status).toBe('failures')
  })

  it('finds transcripts and alternatives, reads them and quotes them for a person to compare', async () => {
    const { snapshot, engine } = await probed('media-alternatives-review.html')
    const report = await checkSnapshot(snapshot, engine, probeCheckOptions())
    expect(report.findings.filter((f) => f.source === 'probe')).toEqual([])
    const review = reviewOf(report, 'rampa/audio-video-only')
    expect(Object.keys(review).sort()).toEqual(['#details', '#inpage', '#linked', '#mixed', '#named', '#quietclip', '#region', '#remote', '#scripted', '#silent'])
    // A silent soundtrack, read again at three points: a video with no sound, under 1.2.1 and not 1.2.2.
    expect(review['#quietclip']?.message).toMatch(/^Video only \(its audio track is silent\): an alternative was found/)
    expect(review['#quietclip']?.evidence).toMatch(/; has an audio track; silent in the [\d.]+ s played muted; silent again at 1\.5 s, 3 s, 4\.5 s \(/)
    expect(reviewByRule(report, 'rampa/captions')).toEqual([])
    expect(report.coverage.probes?.find((r) => r.criterion === '1.2.2')?.note).toContain('1 video(s) whose audio track was silent at its start and at three more points')
    expect(review['#linked']?.evidence).toMatch(/^<a> "Transcript" → media\/transcript\.html \(GET 200, text\/html, title "Episode 1 transcript"\): \d+ characters, "Episode 1: the humming note Host: Welcome to the show\./)
    expect(review['#inpage']?.evidence).toMatch(/^<a> "Read the transcript" → #episode-2-text: \d+ characters, "Episode 2: transcript Host: Welcome back\./)
    expect(review['#details']?.evidence).toMatch(/^<details> "Transcrição": \d+ characters, "Locutor: uma voz cantarola/)
    expect(review['#silent']?.evidence).toMatch(/^<p> next to it that refers to it: \d+ characters, "The video above shows a yellow square/)
    expect(review['#scripted']?.message).toMatch(/^Audio only: an alternative was found but not read/)
    expect(review['#scripted']?.evidence).toMatch(/^<a> "Transcript" → #: leads nowhere \(href="#"\), but a script handles it; the probe never presses it/)
    expect(review['#mixed']?.message).toContain('One alternative found is broken or a placeholder (listed below).')
    expect(review['#mixed']?.evidence).toMatch(/^<a> "Transcript \(PDF\)" → media\/missing-transcript\.pdf \(GET 404[^)]*\): answers 404; <details> "Transcript": \d+ characters, "Host: a voice hums/)
    expect(review['#remote']?.evidence).toMatch(/^<a> "Transcript" → http:\/\/localhost:\d+\/media\/transcript\.html \(HEAD 200, text\/html\): answers 200 from another origin \(only a HEAD was sent; not read\)/)
    expect(review['#region']?.evidence).toMatch(/^<div> "div\.episode-transcript": \d+ characters, "Host: the note rises/)
    expect(review['#named']?.evidence).toMatch(/^<h2> "Interview with Ada Lovelace" and the text after it: \d+ characters, "Ada Lovelace: The Analytical Engine/)
  })

  it('fails text about the media that no one can reach: aria-hidden, or not rendered with nothing to show it', async () => {
    const { snapshot, engine } = await probed('media-alternatives-hidden.html')
    const report = await checkSnapshot(snapshot, engine, probeCheckOptions())
    expect(byRule(report, 'rampa/audio-video-only').map((f) => `${f.ref} ${f.confidence}`)).toEqual(['#aria medium', '#unrendered medium'])
    expect(byRule(report, 'rampa/audio-video-only')[1]?.evidence).toMatch(/\(hidden\); hidden \(not rendered\), and nothing on the page shows it; /)
  })

  it('replays a saved snapshot offline to the same findings and items to review', async () => {
    const { snapshot, engine } = await probed('media-alternatives-review.html')
    const live = await checkSnapshot(snapshot, engine, probeCheckOptions())
    const dir = await mkdtemp(join(tmpdir(), 'rampa-media-alt-'))
    const path = join(dir, 'media.snapshot.json')
    await writeFile(path, JSON.stringify(snapshot), 'utf8')
    await writeFile(join(dir, 'media.engine.json'), JSON.stringify(engine), 'utf8')
    const loaded = await loadRecorded(path, 'en')
    const replayed = await checkSnapshot(loaded.snapshot, loaded.engine, probeCheckOptions())
    const key = (report: Report) => [...report.findings, ...(report.needsReview ?? [])].map((f) => `${f.ruleId} ${f.ref} ${f.evidence ?? ''}`)
    expect(key(replayed)).toEqual(key(live))
  })
})

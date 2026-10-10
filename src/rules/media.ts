import type { Confidence, Finding, ProbeCoverage } from '../core/types.ts'
import type { Locale } from '../i18n.ts'
import { matchNode } from '../probes/identity.ts'
import { AUDIBLE_DB, type AutoplayFact, type MediaControl, type MediaData, type MediaFrame, type MediaItem, type MediaSignal, type MediaTrack, type WebAudioFact } from '../probes/media.ts'
import type { A11yNode, A11ySnapshot, ProbeRecord } from '../snapshot/schema.ts'
import { type ProbeRule, type ProbeRuleContext, type ProbeRuleResult, asArray, asRecord, conditionsText, coverageStatus, probeFinding, say } from './probes.ts'

/**
 * Rules over the media probe (src/probes/media.ts): 1.2.1–1.2.5 and 1.4.2. Only two things fail without a person:
 * a captions track that does not load or holds no cues (1.2.2), and sound that plays on its own for more than
 * 3 seconds with no control on the page that could stop it (1.4.2). The rest of 1.2.x is needs review by design
 * (docs/plans/wcag-coverage.md, section 6): whether captions, a description or a transcript is equivalent needs the
 * full meaning of the media. Each item to review lists what the probe found.
 */

/** Sound that plays on its own for more than this fails 1.4.2. */
export const AUTOPLAY_LIMIT_MS = 3000
const MAX_REPORTED = 10

const CAPTION_KINDS = new Set(['captions', 'subtitles'])

/** Narrowed from a record read back from a file. */
function mediaData(record: ProbeRecord): MediaData {
  const data = asRecord(record.data)
  const web = asRecord(data.webAudio)
  return {
    items: asArray<MediaItem>(data.items).map((item) => ({
      ...item,
      tracks: asArray<MediaTrack>(item.tracks),
      transcript: asArray<MediaSignal>(item.transcript),
      description: asArray<MediaSignal>(item.description),
      controls: asArray<MediaControl>(item.controls),
      attributes: { autoplay: false, loop: false, muted: false, controls: false, preload: '', ...asRecord(item.attributes) },
    })),
    detached: asArray<MediaData['detached'][number]>(data.detached),
    frames: asArray<MediaFrame>(data.frames),
    webAudio: {
      contexts: Number(web.contexts) || 0,
      running: Number(web.running) || 0,
      sources: Number(web.sources) || 0,
      connected: web.connected === true,
      audibleMs: typeof web.audibleMs === 'number' ? web.audibleMs : null,
      peakDb: typeof web.peakDb === 'number' ? web.peakDb : null,
      blocked: web.blocked === true,
    } satisfies WebAudioFact,
    pageControls: asArray<MediaControl>(data.pageControls),
    pageTranscript: asArray<MediaSignal>(data.pageTranscript),
    pageDescription: asArray<MediaSignal>(data.pageDescription),
    autoplayPolicy: typeof data.autoplayPolicy === 'string' ? data.autoplayPolicy : null,
    watchMs: Number(data.watchMs) || 0,
    sampleMs: Number(data.sampleMs) || 0,
    unsampled: Number(data.unsampled) || 0,
    omitted: Number(data.omitted) || 0,
  }
}

function pageNode(snapshot: A11ySnapshot): A11yNode {
  return snapshot.root.children.find((child) => child.native.tag === 'body') ?? snapshot.root
}

/** The media the probe could read: it loaded far enough to have a duration, or is live. */
const readable = (item: MediaItem) => item.sample !== 'error' && item.sample !== 'no-source' && item.sample !== 'did-not-start' && (item.duration !== null || item.live)
/** A video a person can see, or an audio player a person can see or hear. */
const shows = (item: MediaItem) => item.visible || (item.kind === 'audio' && (item.attributes.controls || item.autoplay?.started === true))
/** Video with sound, or whose sound could not be read: synchronized media. */
const withSound = (item: MediaItem) => item.kind === 'video' && item.hasAudio !== false && item.hasVideo !== false

const seconds = (ms: number) => `${Math.round(ms / 100) / 10} s`
const quote = (text: string) => `"${text}"`
const kindName = (item: MediaItem, locale: Locale) => (item.kind === 'audio' ? say(locale, 'audio', 'áudio') : say(locale, 'video', 'vídeo'))

function signalsText(near: readonly MediaSignal[], page: readonly MediaSignal[], locale: Locale): string {
  const list = (signals: readonly MediaSignal[]) => signals.map((s) => `<${s.tag}> ${quote(s.text)}`).join(', ')
  const parts: string[] = []
  if (near.length > 0) parts.push(say(locale, `near it: ${list(near)}`, `perto dele: ${list(near)}`))
  if (page.length > 0) parts.push(say(locale, `elsewhere on the page: ${list(page)}`, `em outro ponto da página: ${list(page)}`))
  return parts.join('; ')
}

function trackText(track: MediaTrack, locale: Locale): string {
  const state =
    track.state === 'error'
      ? say(locale, 'failed to load', 'não carregou')
      : track.state === 'loaded'
        ? track.cues === 0
          ? say(locale, 'loaded, no cues', 'carregou, sem nenhuma deixa')
          : say(locale, `loaded, ${track.cues} cue(s)`, `carregou, ${track.cues} deixa(s)`)
        : track.state === 'loading'
          ? say(locale, 'still loading', 'ainda carregando')
          : say(locale, 'not loaded', 'não carregado')
  const name = [track.label, track.srclang].filter(Boolean).join(', ')
  return `${track.kind}${name ? ` (${name})` : ''} ${track.src ? `${track.src}: ` : ''}${state}${track.first ? `, ${say(locale, 'first', 'primeira')}: ${quote(track.first)}` : ''}`
}

function factsText(item: MediaItem, locale: Locale): string {
  const parts: string[] = []
  parts.push(item.live ? say(locale, 'live (no end)', 'ao vivo (sem fim)') : item.duration !== null ? say(locale, `${item.duration} s long`, `${item.duration} s de duração`) : say(locale, 'duration unknown', 'duração desconhecida'))
  if (item.kind === 'video') {
    parts.push(
      item.hasAudio === true
        ? say(locale, 'has an audio track', 'tem faixa de áudio')
        : item.hasAudio === false
          ? say(locale, 'no audio track', 'sem faixa de áudio')
          : say(locale, 'audio track not read', 'faixa de áudio não lida'),
    )
  }
  if (item.level) {
    // The probe played it muted, or read it while the page played it.
    const how = item.sample === 'already-playing' ? say(locale, 'read while it played', 'lidos enquanto tocava') : say(locale, 'played muted', 'tocados sem som')
    parts.push(
      item.level.audibleMs > 0
        ? say(locale, `sound above ${AUDIBLE_DB} dBFS for ${seconds(item.level.audibleMs)} of the ${seconds(item.level.sampledMs)} ${how} (loudest ${item.level.peakDb} dBFS)`, `som acima de ${AUDIBLE_DB} dBFS em ${seconds(item.level.audibleMs)} dos ${seconds(item.level.sampledMs)} ${how} (pico ${item.level.peakDb} dBFS)`)
        : say(locale, `silent in the ${seconds(item.level.sampledMs)} ${how}`, `silencioso nos ${seconds(item.level.sampledMs)} ${how}`),
    )
  } else if (item.crossOrigin && item.hasAudio !== false) parts.push(say(locale, 'level not read (media from another origin)', 'nível não lido (mídia de outra origem)'))
  const flags = [item.attributes.autoplay && 'autoplay', item.attributes.muted && 'muted', item.attributes.loop && 'loop', item.attributes.controls && 'controls'].filter(Boolean)
  if (flags.length > 0) parts.push(say(locale, `attributes: ${flags.join(', ')}`, `atributos: ${flags.join(', ')}`))
  if (item.frame) parts.push(say(locale, `in the frame ${item.frame}`, `no frame ${item.frame}`))
  return parts.join('; ')
}

/** What a rule found it could not apply to, and the frames it cannot read: the coverage note. */
function commonNotes(data: MediaData, locale: Locale, nothing: string | undefined): string[] {
  const notes: string[] = []
  if (nothing) notes.push(nothing)
  const players = data.frames.filter((frame) => frame.player)
  if (players.length > 0) {
    const names = [...new Set(players.map((frame) => frame.player))].join(', ')
    notes.push(say(locale, `${players.length} player(s) in frames of another origin not read (${names})`, `${players.length} player(s) em frames de outra origem não lido(s) (${names})`))
  }
  const others = data.frames.length - players.length
  if (others > 0) notes.push(say(locale, `${others} other frame(s) of another origin not read`, `${others} outro(s) frame(s) de outra origem não lido(s)`))
  if (data.unsampled > 0) notes.push(say(locale, `${data.unsampled} media element(s) past the budget not played`, `${data.unsampled} elemento(s) de mídia além do limite não tocado(s)`))
  if (data.omitted > 0) notes.push(say(locale, `${data.omitted} media element(s) past the budget not listed`, `${data.omitted} elemento(s) de mídia além do limite não listado(s)`))
  return notes
}

/**
 * Media of these kinds the probe could not read: no source yet (a player that loads its media when played, often
 * hidden behind its own buttons), a load error, or a player that shows and did not start. A hidden element with a
 * source that was never played (a sound effect) is not counted.
 */
function unread(data: MediaData, kinds: ReadonlyArray<MediaItem['kind']>): number {
  return data.items.filter((item) => kinds.includes(item.kind) && !readable(item) && (shows(item) || item.sample === 'no-source' || item.sample === 'error')).length
}

function unreadNote(count: number, locale: Locale): string {
  return count > 0
    ? say(
        locale,
        `${count} audio or video element(s) not read: no source yet (a player that loads its media when played) or a load error`,
        `${count} elemento(s) de áudio ou vídeo não lido(s): ainda sem fonte (um player que carrega a mídia ao tocar) ou erro ao carregar`,
      )
    : ''
}

/** Nothing applied, but something may: a player in a frame of another origin, or media the probe could not read. */
function undecided(data: MediaData, t: Tally, kinds: ReadonlyArray<MediaItem['kind']>): boolean {
  return t.applicable === 0 && (data.frames.some((frame) => frame.player && frame.visible) || unread(data, kinds) > 0)
}

function noMediaNote(data: MediaData, locale: Locale): string {
  return say(
    locale,
    `no audio or video found in the page, its open shadow roots or its same-origin frames; players in frames of another origin (YouTube, Vimeo and other embeds), in closed shadow roots, or added after the probe's ${seconds(data.watchMs)} watch may be missed`,
    `nenhum áudio ou vídeo na página, em suas shadow roots abertas ou em seus frames da mesma origem; players em frames de outra origem (YouTube, Vimeo e outros embeds), em shadow roots fechadas, ou adicionados depois dos ${seconds(data.watchMs)} de observação podem passar despercebidos`,
  )
}

interface Tally {
  findings: Finding[]
  review: Finding[]
  applicable: number
  unmatched: number
  /** Engine results the probe settled: axe-core's undecided ones on the same elements. */
  resolved: Array<{ engineRule: string; ref: string }>
}

const tally = (): Tally => ({ findings: [], review: [], applicable: 0, unmatched: 0, resolved: [] })

function row(rule: ProbeRule, criterion: string, record: ProbeRecord, t: Tally, notes: string[], locale: Locale, notChecked = false): ProbeCoverage {
  return {
    criterion,
    method: `probe/media@${record.version}`,
    rule: rule.id,
    conditions: conditionsText(record, say(locale, `watched on load, then played muted for ${seconds(mediaData(record).sampleMs)}`, `observado ao carregar, depois tocado sem som por ${seconds(mediaData(record).sampleMs)}`)),
    status: notChecked ? 'not-checked' : coverageStatus(t.findings.length, t.review.length),
    applicable: t.applicable,
    failures: t.findings.length,
    review: t.review.length,
    unmatched: t.unmatched,
    note: notes.filter(Boolean).join('; '),
    maturity: 'experimental',
  }
}

function push(list: Finding[], finding: Finding): void {
  if (list.length < MAX_REPORTED) list.push(finding)
}

/** Readable media that matches the snapshot; facts about elements that do not are counted as unmatched. */
function matched(ctx: ProbeRuleContext, item: MediaItem, t: Tally): A11yNode | undefined {
  const node = matchNode(ctx.index, item.ref, item.id)
  if (!node) t.unmatched++
  return node
}

function result(t: Tally, coverage: ProbeCoverage): ProbeRuleResult {
  return { findings: t.findings, review: t.review, coverage: [coverage], ...(t.resolved.length > 0 ? { resolved: t.resolved } : {}) }
}

/** 1.2.2: captions tracks that fail to load or hold no cues fail; a video with sound and no captions track is to review. */
export const captionsRule: ProbeRule = {
  id: 'rampa/captions',
  kind: 'media',
  variant: 'media',
  versions: ['1'],
  criteria: ['1.2.2'],
  run(record, ctx) {
    const data = mediaData(record)
    const t = tally()
    let silent = 0
    let captioned = 0
    for (const item of data.items) {
      if (item.kind !== 'video' || !shows(item) || !readable(item) || item.live) continue
      const node = matched(ctx, item, t)
      if (!node) continue
      // A video the probe read has its own result here: axe-core's undecided video-caption is settled.
      t.resolved.push({ engineRule: 'video-caption', ref: item.ref })
      if (item.hasAudio === false || item.hasVideo === false) {
        silent++
        continue
      }
      t.applicable++
      const captions = item.tracks.filter((track) => CAPTION_KINDS.has(track.kind))
      const facts = factsText(item, ctx.locale)
      const tracks = captions.map((track) => trackText(track, ctx.locale)).join('; ')
      if (captions.some((track) => track.state === 'loaded' && (track.cues ?? 0) > 0)) {
        captioned++
        continue
      }
      const broken = captions.length > 0 && captions.every((track) => track.state === 'error' || (track.state === 'loaded' && track.cues === 0))
      if (broken) {
        const allError = captions.every((track) => track.state === 'error')
        const allEmpty = captions.every((track) => track.state === 'loaded')
        const message = allError
          ? say(
              ctx.locale,
              "This video's captions track does not load, so it plays with no captions (WCAG 1.2.2). Fix the track's address, its server's answer or its CORS headers (a track from another origin needs crossorigin on the video).",
              'A faixa de legendas deste vídeo não carrega, e ele toca sem legendas (WCAG 1.2.2). Corrija o endereço da faixa, a resposta do servidor ou os cabeçalhos CORS (uma faixa de outra origem pede crossorigin no vídeo).',
            )
          : allEmpty
            ? say(
                ctx.locale,
                "This video's captions track loads but holds no cues, so it plays with no captions (WCAG 1.2.2). Put the captions in the WebVTT file.",
                'A faixa de legendas deste vídeo carrega, mas não tem nenhuma deixa, e ele toca sem legendas (WCAG 1.2.2). Coloque as legendas no arquivo WebVTT.',
              )
            : say(
                ctx.locale,
                "None of this video's captions tracks gives captions: they fail to load or hold no cues (WCAG 1.2.2). Fix the tracks.",
                'Nenhuma das faixas de legendas deste vídeo dá legendas: elas não carregam ou não têm deixas (WCAG 1.2.2). Corrija as faixas.',
              )
        const confidence: Confidence = item.hasAudio === true ? 'high' : 'medium'
        push(t.findings, probeFinding({ criterion: '1.2.2', rule: this.id, node, message, evidence: `${tracks}; ${facts}`, confidence, subject: `broken|${captions.map((track) => track.src).join(',')}` }))
        continue
      }
      const loading = captions.length > 0
      const message = loading
        ? say(
            ctx.locale,
            "This video's captions track did not finish loading while the probe played it. Check that it loads and holds the captions (WCAG 1.2.2).",
            'A faixa de legendas deste vídeo não terminou de carregar enquanto a sonda o tocava. Confira se ela carrega e traz as legendas (WCAG 1.2.2).',
          )
        : say(
            ctx.locale,
            'This video has sound and no captions or subtitles track. Check that it has captions some other way (burned into the picture, or shown by its player), or that it is an alternative for text on the page, labeled as such (WCAG 1.2.2).',
            'Este vídeo tem som e nenhuma faixa de legendas. Confira se ele tem legendas de outra forma (gravadas na imagem, ou mostradas pelo player), ou se é uma alternativa a um texto da página, identificada como tal (WCAG 1.2.2).',
          )
      push(t.review, probeFinding({ criterion: '1.2.2', rule: this.id, node, message, evidence: tracks ? `${tracks}; ${facts}` : facts, confidence: 'medium', subject: loading ? 'loading' : 'no-track' }))
    }
    // Players in frames of another origin: Rampa reads none of their media.
    for (const frame of data.frames.filter((f) => f.player && f.visible)) {
      const node = matchNode(ctx.index, frame.ref, frame.id)
      if (!node) {
        t.unmatched++
        continue
      }
      t.applicable++
      push(
        t.review,
        probeFinding({
          criterion: '1.2.2',
          rule: this.id,
          node,
          message: say(
            ctx.locale,
            `A ${frame.player} player in a frame of another origin: Rampa cannot read its media, its captions or its audio description. Check its captions (1.2.2), its audio description (1.2.3, 1.2.5), and that it does not play sound on its own (1.4.2).`,
            `Um player ${frame.player} em um frame de outra origem: o Rampa não consegue ler a mídia, as legendas nem a audiodescrição. Confira as legendas (1.2.2), a audiodescrição (1.2.3, 1.2.5) e se ele não toca som sozinho (1.4.2).`,
          ),
          evidence: frame.src,
          confidence: 'medium',
          subject: `frame|${frame.host}`,
        }),
      )
    }
    const notes = [
      captioned > 0 ? say(ctx.locale, `${captioned} video(s) with a captions track that loaded cues (their accuracy is not checked)`, `${captioned} vídeo(s) com faixa de legendas que carregou deixas (a precisão não é conferida)`) : '',
      silent > 0 ? say(ctx.locale, `${silent} video(s) with no audio track, which need no captions`, `${silent} vídeo(s) sem faixa de áudio, que não precisam de legendas`) : '',
      unreadNote(unread(data, ['video']), ctx.locale),
      ...commonNotes(data, ctx.locale, data.items.length === 0 && data.frames.every((f) => !f.player) ? noMediaNote(data, ctx.locale) : undefined),
    ]
    return result(t, row(this, '1.2.2', record, t, notes, ctx.locale, undecided(data, t, ['video'])))
  },
}

/** 1.2.1: audio-only and video-only media, to review, with the transcript signals found. */
export const audioVideoOnlyRule: ProbeRule = {
  id: 'rampa/audio-video-only',
  kind: 'media',
  variant: 'media',
  versions: ['1'],
  criteria: ['1.2.1'],
  run(record, ctx) {
    const data = mediaData(record)
    const t = tally()
    for (const item of data.items) {
      if (!shows(item) || item.live) continue
      const audioOnly = item.kind === 'audio' && readable(item)
      const videoOnly = item.kind === 'video' && readable(item) && item.hasAudio === false && item.hasVideo !== false
      if (!audioOnly && !videoOnly) continue
      const node = matched(ctx, item, t)
      if (!node) continue
      t.applicable++
      const found = signalsText(item.transcript, data.pageTranscript, ctx.locale)
      const descriptions = item.tracks.filter((track) => track.kind === 'descriptions').map((track) => trackText(track, ctx.locale))
      const decorative = videoOnly && item.attributes.autoplay && item.attributes.loop && !item.attributes.controls && (item.attributes.muted || item.hasAudio === false)
      const message = audioOnly
        ? say(
            ctx.locale,
            'Audio only: check that a transcript gives the same information as this audio (WCAG 1.2.1), unless the audio is itself an alternative for text on the page, labeled as such.',
            'Só áudio: confira se uma transcrição dá a mesma informação que este áudio (WCAG 1.2.1), a menos que o próprio áudio seja uma alternativa a um texto da página, identificada como tal.',
          )
        : say(
            ctx.locale,
            `Video only (no audio track): check that a text alternative or an audio track gives the same information (WCAG 1.2.1), unless the video is itself an alternative for text on the page${decorative ? '. It plays on its own, muted, in a loop, with no controls: if it only decorates the page, it needs no alternative' : ''}.`,
            `Só vídeo (sem faixa de áudio): confira se uma alternativa em texto ou uma faixa de áudio dá a mesma informação (WCAG 1.2.1), a menos que o próprio vídeo seja uma alternativa a um texto da página${decorative ? '. Ele toca sozinho, sem som, em loop e sem controles: se só decora a página, não precisa de alternativa' : ''}.`,
          )
      const evidence = [
        found || say(ctx.locale, 'nothing that names a transcript was found on the page', 'nada que fale em transcrição foi achado na página'),
        ...descriptions,
        factsText(item, ctx.locale),
      ].join('; ')
      push(t.review, probeFinding({ criterion: '1.2.1', rule: this.id, node, message, evidence, confidence: 'medium', subject: audioOnly ? 'audio-only' : 'video-only' }))
    }
    const notes = [unreadNote(unread(data, ['audio', 'video']), ctx.locale), ...commonNotes(data, ctx.locale, data.items.length === 0 ? noMediaNote(data, ctx.locale) : undefined)]
    return result(t, row(this, '1.2.1', record, t, notes, ctx.locale, undecided(data, t, ['audio', 'video'])))
  },
}

function descriptionFound(item: MediaItem, data: MediaData, locale: Locale, withTranscript: boolean): string {
  const parts: string[] = []
  const tracks = item.tracks.filter((track) => track.kind === 'descriptions')
  if (tracks.length > 0) parts.push(`${say(locale, 'descriptions track', 'faixa de descrições')}: ${tracks.map((track) => trackText(track, locale)).join(', ')}`)
  const description = signalsText(item.description, data.pageDescription, locale)
  if (description) parts.push(`${say(locale, 'audio description', 'audiodescrição')} ${description}`)
  if (withTranscript) {
    const transcript = signalsText(item.transcript, data.pageTranscript, locale)
    if (transcript) parts.push(`${say(locale, 'transcript', 'transcrição')} ${transcript}`)
  }
  if (parts.length === 0) {
    parts.push(
      withTranscript
        ? say(locale, 'nothing that names an audio description or a transcript was found on the page, and no descriptions track', 'nada que fale em audiodescrição ou transcrição foi achado na página, e nenhuma faixa de descrições')
        : say(locale, 'nothing that names an audio description was found on the page, and no descriptions track', 'nada que fale em audiodescrição foi achado na página, e nenhuma faixa de descrições'),
    )
  }
  return parts.join('; ')
}

/** 1.2.3 and 1.2.5: prerecorded video with sound, to review, listing descriptions and transcripts found. */
function descriptionRule(id: string, criterion: '1.2.3' | '1.2.5'): ProbeRule {
  return {
    id,
    kind: 'media',
    variant: 'media',
    versions: ['1'],
    criteria: [criterion],
    run(record, ctx) {
      const data = mediaData(record)
      const t = tally()
      for (const item of data.items) {
        if (!shows(item) || item.live || !readable(item) || !withSound(item)) continue
        const node = matched(ctx, item, t)
        if (!node) continue
        t.applicable++
        const message =
          criterion === '1.2.3'
            ? say(
                ctx.locale,
                'Video with sound: check that an audio description, or a full text alternative (what is seen and heard, in order), gives what is only shown on screen (WCAG 1.2.3), unless the soundtrack already says it.',
                'Vídeo com som: confira se uma audiodescrição, ou uma alternativa completa em texto (o que se vê e se ouve, em ordem), dá o que só aparece na tela (WCAG 1.2.3), a menos que o som já diga tudo.',
              )
            : say(
                ctx.locale,
                'Video with sound: check that an audio description gives what is only shown on screen (WCAG 1.2.5; at level AA a transcript is not enough), unless the soundtrack already says it.',
                'Vídeo com som: confira se uma audiodescrição dá o que só aparece na tela (WCAG 1.2.5; no nível AA uma transcrição não basta), a menos que o som já diga tudo.',
              )
        const evidence = `${descriptionFound(item, data, ctx.locale, criterion === '1.2.3')}; ${factsText(item, ctx.locale)}`
        push(t.review, probeFinding({ criterion, rule: id, node, message, evidence, confidence: 'medium', subject: 'description' }))
      }
      const notes = [unreadNote(unread(data, ['video']), ctx.locale), ...commonNotes(data, ctx.locale, data.items.length === 0 ? noMediaNote(data, ctx.locale) : undefined)]
      return result(t, row(this, criterion, record, t, notes, ctx.locale, undecided(data, t, ['video'])))
    },
  }
}

export const mediaAlternativeRule = descriptionRule('rampa/media-alternative', '1.2.3')
export const audioDescriptionRule = descriptionRule('rampa/audio-description', '1.2.5')

/** 1.2.4: live video with sound applies here; live captions are not checked. */
export const liveCaptionsRule: ProbeRule = {
  id: 'rampa/live-captions',
  kind: 'media',
  variant: 'media',
  versions: ['1'],
  criteria: ['1.2.4'],
  run(record, ctx) {
    const data = mediaData(record)
    const t = tally()
    for (const item of data.items) {
      if (!shows(item) || !item.live || item.kind !== 'video' || item.hasAudio === false) continue
      const node = matched(ctx, item, t)
      if (!node) continue
      t.applicable++
      const captions = item.tracks.filter((track) => CAPTION_KINDS.has(track.kind)).map((track) => trackText(track, ctx.locale))
      push(
        t.review,
        probeFinding({
          criterion: '1.2.4',
          rule: this.id,
          node,
          message: say(
            ctx.locale,
            'Live video with sound: check that it has live captions (WCAG 1.2.4). Rampa does not check live captions.',
            'Vídeo ao vivo com som: confira se ele tem legendas ao vivo (WCAG 1.2.4). O Rampa não confere legendas ao vivo.',
          ),
          evidence: [...captions, factsText(item, ctx.locale)].join('; '),
          confidence: 'medium',
          subject: 'live',
        }),
      )
    }
    const notes = [
      unreadNote(unread(data, ['video']), ctx.locale),
      ...commonNotes(data, ctx.locale, data.items.length === 0 ? noMediaNote(data, ctx.locale) : say(ctx.locale, 'no live video found', 'nenhum vídeo ao vivo encontrado')),
    ]
    return result(t, row(this, '1.2.4', record, t, notes, ctx.locale, undecided(data, t, ['video'])))
  },
}

/** How a source of sound that plays on its own can be stopped, from what shows on the page. */
function mechanismOf(item: MediaItem | undefined, data: MediaData): { kind: 'native' | 'near' | 'page' | 'weak' | 'none'; control?: MediaControl | undefined } {
  if (item?.attributes.controls && item.visible) return { kind: 'native' }
  const near = item?.controls.find((control) => control.near)
  if (near) return { kind: 'near', control: near }
  const sound = data.pageControls.find((control) => control.kind === 'mute' || control.kind === 'volume')
  if (sound) return { kind: 'page', control: sound }
  const pause = data.pageControls.find((control) => control.kind === 'play-pause')
  if (pause) return { kind: 'weak', control: pause }
  return { kind: 'none' }
}

function autoplayText(a: AutoplayFact, locale: Locale): string {
  const parts: string[] = []
  if (a.at !== null) parts.push(say(locale, `started ${seconds(a.at)} after the page began loading, with its sound on`, `começou ${seconds(a.at)} depois do início do carregamento, com som`))
  parts.push(
    a.audibleMs !== null
      ? say(locale, `played ${seconds(a.playedMs)}, ${seconds(a.audibleMs)} of it above ${AUDIBLE_DB} dBFS${a.peakDb !== null ? ` (loudest ${a.peakDb} dBFS)` : ''}`, `tocou ${seconds(a.playedMs)}, ${seconds(a.audibleMs)} disso acima de ${AUDIBLE_DB} dBFS${a.peakDb !== null ? ` (pico ${a.peakDb} dBFS)` : ''}`)
      : say(locale, `played ${seconds(a.playedMs)} with its audio decoding (its level could not be read: media from another origin)`, `tocou ${seconds(a.playedMs)} com o áudio sendo decodificado (o nível não pôde ser lido: mídia de outra origem)`),
  )
  if (a.stopped) {
    const how = { paused: say(locale, 'paused', 'pausou'), ended: say(locale, 'ended', 'terminou'), muted: say(locale, 'was muted', 'foi silenciado'), volume: say(locale, 'had its volume set to 0', 'teve o volume zerado') }[a.stopped.how]
    parts.push(say(locale, `${how} at ${seconds(a.stopped.at)}`, `${how} em ${seconds(a.stopped.at)}`))
  } else if (a.playing) parts.push(say(locale, `still playing when the watch ended${a.loop ? ', in a loop' : ''}`, `ainda tocando quando a observação terminou${a.loop ? ', em loop' : ''}`))
  return parts.join('; ')
}

function mechanismText(m: ReturnType<typeof mechanismOf>, locale: Locale): string {
  if (m.kind === 'native') return say(locale, "the element's own controls show", 'os controles do próprio elemento aparecem')
  if (m.control) return say(locale, `a control named ${quote(m.control.label)} shows ${m.kind === 'near' ? 'next to it' : 'on the page'} (not pressed)`, `um controle chamado ${quote(m.control.label)} aparece ${m.kind === 'near' ? 'ao lado dele' : 'na página'} (não acionado)`)
  return say(locale, 'no native controls, and no pause, stop, mute or volume control shows on the page', 'sem controles nativos, e nenhum controle de pausar, parar, silenciar ou volume aparece na página')
}

/** 1.4.2: sound that plays on its own for more than 3 seconds, with no way to pause, stop or turn it down. */
export const audioControlRule: ProbeRule = {
  id: 'rampa/audio-control',
  kind: 'media',
  variant: 'media',
  versions: ['1'],
  criteria: ['1.4.2'],
  run(record, ctx) {
    const data = mediaData(record)
    const t = tally()
    const counted = { short: 0, silent: 0, controlled: [] as string[] }
    const judge = (source: { item?: MediaItem | undefined; autoplay: AutoplayFact; node: A11yNode; what: string; subject: string; detached?: string | undefined }) => {
      const a = source.autoplay
      const item = source.item
      if (item?.hasAudio === false) {
        counted.silent++
        return
      }
      t.applicable++
      const label = source.what
      if (a.blocked) {
        push(
          t.review,
          probeFinding({
            criterion: '1.4.2',
            rule: this.id,
            node: source.node,
            message: say(
              ctx.locale,
              `This ${label} is set to play on its own with its sound on, and the browser did not start it in this run (its autoplay policy, or a slow load). A browser that allows autoplay plays it: check that it stops within 3 seconds, or that a control can pause or mute it (WCAG 1.4.2).`,
              `Este ${label} está marcado para tocar sozinho com som, e o navegador não o iniciou nesta execução (a política de autoplay, ou um carregamento lento). Um navegador que permite autoplay o toca: confira se ele para em até 3 segundos, ou se um controle pode pausá-lo ou silenciá-lo (WCAG 1.4.2).`,
            ),
            evidence: `${mechanismText(mechanismOf(item, data), ctx.locale)}${item ? `; ${factsText(item, ctx.locale)}` : ''}`,
            confidence: 'medium',
            subject: `${source.subject}|blocked`,
          }),
        )
        return
      }
      const audible = a.audibleMs ?? (a.decoded ? a.playedMs : null)
      const measured = a.audibleMs !== null
      if (audible === null) {
        push(
          t.review,
          probeFinding({
            criterion: '1.4.2',
            rule: this.id,
            node: source.node,
            message: say(
              ctx.locale,
              `This ${label} played on its own with its sound on, and its sound could not be measured. Check whether it plays sound for more than 3 seconds with no way to pause or mute it (WCAG 1.4.2).`,
              `Este ${label} tocou sozinho com som, e o som não pôde ser medido. Confira se ele toca som por mais de 3 segundos sem forma de pausar ou silenciar (WCAG 1.4.2).`,
            ),
            evidence: autoplayText(a, ctx.locale),
            confidence: 'medium',
            subject: `${source.subject}|unmeasured`,
          }),
        )
        return
      }
      if (audible <= AUTOPLAY_LIMIT_MS) {
        if (a.playing && audible > 0) {
          push(
            t.review,
            probeFinding({
              criterion: '1.4.2',
              rule: this.id,
              node: source.node,
              message: say(
                ctx.locale,
                `This ${label} started on its own with its sound on and was still playing when the watch ended, but sounded for only ${seconds(audible)} of it. Check whether its sound lasts more than 3 seconds (WCAG 1.4.2).`,
                `Este ${label} começou sozinho com som e ainda tocava quando a observação terminou, mas soou só ${seconds(audible)} disso. Confira se o som dura mais de 3 segundos (WCAG 1.4.2).`,
              ),
              evidence: autoplayText(a, ctx.locale),
              confidence: 'low',
              subject: `${source.subject}|quiet`,
            }),
          )
        } else if (audible === 0) counted.silent++
        else counted.short++
        return
      }
      const mechanism = mechanismOf(item, data)
      const evidence = `${autoplayText(a, ctx.locale)}; ${mechanismText(mechanism, ctx.locale)}${item ? `; ${factsText(item, ctx.locale)}` : ''}`
      if (mechanism.kind === 'native' || mechanism.kind === 'near' || mechanism.kind === 'page') {
        counted.controlled.push(mechanism.kind === 'native' ? say(ctx.locale, 'its own controls', 'seus próprios controles') : quote(mechanism.control?.label ?? ''))
        return
      }
      if (mechanism.kind === 'weak') {
        push(
          t.review,
          probeFinding({
            criterion: '1.4.2',
            rule: this.id,
            node: source.node,
            message: say(
              ctx.locale,
              `This ${label} plays sound on its own for more than 3 seconds; the only control found is ${quote(mechanism.control?.label ?? '')}, away from it, which the probe did not press. Check that it pauses or mutes this sound (WCAG 1.4.2).`,
              `Este ${label} toca som sozinho por mais de 3 segundos; o único controle achado é ${quote(mechanism.control?.label ?? '')}, longe dele, que a sonda não acionou. Confira se ele pausa ou silencia esse som (WCAG 1.4.2).`,
            ),
            evidence,
            confidence: 'medium',
            subject: `${source.subject}|weak`,
          }),
        )
        return
      }
      const message = source.detached
        ? say(
            ctx.locale,
            `Audio a script plays on load (${source.detached}) sounds for more than 3 seconds, and the page shows no way to pause, stop or mute it (WCAG 1.4.2). Add a visible, named pause or mute control, or play it only when asked.`,
            `Um áudio que um script toca ao carregar (${source.detached}) soa por mais de 3 segundos, e a página não mostra forma de pausá-lo, pará-lo ou silenciá-lo (WCAG 1.4.2). Adicione um controle visível e nomeado de pausar ou silenciar, ou toque-o só quando pedido.`,
          )
        : say(
            ctx.locale,
            `This ${label} plays sound on its own for more than 3 seconds, and the page shows no way to pause or stop it or to turn its volume down (WCAG 1.4.2; ACT 80f0bf). Add the controls attribute or a visible, named pause or mute button next to it, or start it muted.`,
            `Este ${label} toca som sozinho por mais de 3 segundos, e a página não mostra forma de pausá-lo, pará-lo ou baixar o volume (WCAG 1.4.2; ACT 80f0bf). Adicione o atributo controls ou um botão visível e nomeado de pausar ou silenciar ao lado dele, ou comece sem som.`,
          )
      push(t.findings, probeFinding({ criterion: '1.4.2', rule: this.id, node: source.node, message, evidence, confidence: measured ? 'high' : 'medium', subject: `${source.subject}|no-control` }))
    }

    for (const item of data.items) {
      if (item.attributes.autoplay && readable(item)) t.resolved.push({ engineRule: 'no-autoplay-audio', ref: item.ref })
      if (!item.autoplay) continue
      // Sound plays whether or not the element shows: one the snapshot does not hold is reported on the page.
      const node = matchNode(ctx.index, item.ref, item.id) ?? (shows(item) ? undefined : pageNode(ctx.snapshot))
      if (!node) {
        t.unmatched++
        continue
      }
      judge({ item, autoplay: item.autoplay, node, what: kindName(item, ctx.locale), subject: item.kind })
    }
    for (const audio of data.detached) {
      judge({ autoplay: audio.autoplay, node: pageNode(ctx.snapshot), what: say(ctx.locale, 'audio', 'áudio'), subject: `detached|${audio.src}`, detached: audio.src || say(ctx.locale, 'no address', 'sem endereço') })
    }
    // A known player in a frame of another origin, asked by its address to start on its own with sound.
    for (const frame of data.frames.filter((f) => f.player && /[?&]autoplay=(1|true)\b/i.test(f.src) && !/[?&]mute(d)?=(1|true)\b/i.test(f.src))) {
      const node = matchNode(ctx.index, frame.ref, frame.id)
      if (!node) {
        t.unmatched++
        continue
      }
      t.applicable++
      push(
        t.review,
        probeFinding({
          criterion: '1.4.2',
          rule: this.id,
          node,
          message: say(
            ctx.locale,
            `A ${frame.player} player in a frame of another origin is asked by its address to start on its own (autoplay=1), with its sound on. Rampa cannot hear it: check that its sound stops within 3 seconds or that it can be paused or muted (WCAG 1.4.2).`,
            `Um player ${frame.player} em um frame de outra origem é chamado pelo endereço para começar sozinho (autoplay=1), com som. O Rampa não consegue ouvi-lo: confira se o som para em até 3 segundos ou se ele pode ser pausado ou silenciado (WCAG 1.4.2).`,
          ),
          evidence: frame.src,
          confidence: 'low',
          subject: `frame|${frame.host}|autoplay`,
        }),
      )
    }
    // Web Audio: a graph connected to the speakers, running on load.
    const web = data.webAudio
    if (web.connected && web.audibleMs !== null && web.audibleMs > AUTOPLAY_LIMIT_MS) {
      t.applicable++
      const mechanism = mechanismOf(undefined, data)
      const evidence = say(
        ctx.locale,
        `${web.contexts} audio context(s), ${web.sources} source(s) started; ${seconds(web.audibleMs)} above ${AUDIBLE_DB} dBFS (loudest ${web.peakDb} dBFS); ${mechanismText(mechanism, ctx.locale)}`,
        `${web.contexts} contexto(s) de áudio, ${web.sources} fonte(s) iniciada(s); ${seconds(web.audibleMs)} acima de ${AUDIBLE_DB} dBFS (pico ${web.peakDb} dBFS); ${mechanismText(mechanism, ctx.locale)}`,
      )
      if (mechanism.kind === 'page') counted.controlled.push(quote(mechanism.control?.label ?? ''))
      else {
        const finding = probeFinding({
          criterion: '1.4.2',
          rule: this.id,
          node: pageNode(ctx.snapshot),
          message:
            mechanism.kind === 'weak'
              ? say(
                  ctx.locale,
                  `Sound made with the Web Audio API plays on load for more than 3 seconds; the only control found is ${quote(mechanism.control?.label ?? '')}, which the probe did not press. Check that it stops this sound (WCAG 1.4.2).`,
                  `Um som feito com a Web Audio API toca ao carregar por mais de 3 segundos; o único controle achado é ${quote(mechanism.control?.label ?? '')}, que a sonda não acionou. Confira se ele para esse som (WCAG 1.4.2).`,
                )
              : say(
                  ctx.locale,
                  'Sound made with the Web Audio API plays on load for more than 3 seconds, and the page shows no way to pause, stop or mute it (WCAG 1.4.2). Add a visible, named control that stops it, or start it only when asked.',
                  'Um som feito com a Web Audio API toca ao carregar por mais de 3 segundos, e a página não mostra forma de pausá-lo, pará-lo ou silenciá-lo (WCAG 1.4.2). Adicione um controle visível e nomeado que o pare, ou toque-o só quando pedido.',
                ),
          evidence,
          confidence: 'medium',
          subject: `web-audio|${mechanism.kind}`,
        })
        push(mechanism.kind === 'weak' ? t.review : t.findings, finding)
      }
    } else if (web.blocked) {
      t.applicable++
      push(
        t.review,
        probeFinding({
          criterion: '1.4.2',
          rule: this.id,
          node: pageNode(ctx.snapshot),
          message: say(
            ctx.locale,
            'The page starts Web Audio sources on load, and the browser held them in this run (its autoplay policy). Check that the sound stops within 3 seconds, or that a control can stop it (WCAG 1.4.2).',
            'A página inicia fontes de Web Audio ao carregar, e o navegador as segurou nesta execução (a política de autoplay). Confira se o som para em até 3 segundos, ou se um controle pode pará-lo (WCAG 1.4.2).',
          ),
          evidence: say(ctx.locale, `${web.contexts} audio context(s), ${web.sources} source(s) started`, `${web.contexts} contexto(s) de áudio, ${web.sources} fonte(s) iniciada(s)`),
          confidence: 'low',
          subject: 'web-audio|blocked',
        }),
      )
    }
    const nothing =
      data.items.length === 0 && data.detached.length === 0 && web.contexts === 0
        ? noMediaNote(data, ctx.locale)
        : t.applicable === 0
          ? say(ctx.locale, `nothing played sound on its own in the ${seconds(data.watchMs)} watched`, `nada tocou som sozinho nos ${seconds(data.watchMs)} observados`)
          : undefined
    const notes = [
      counted.controlled.length > 0
        ? say(ctx.locale, `sound on its own that a control may stop: ${counted.controlled.join(', ')} (not pressed)`, `som sozinho que um controle pode parar: ${counted.controlled.join(', ')} (não acionado)`)
        : '',
      counted.short > 0 ? say(ctx.locale, `${counted.short} sound(s) that stopped within 3 s`, `${counted.short} som(ns) que pararam em até 3 s`) : '',
      counted.silent > 0 ? say(ctx.locale, `${counted.silent} element(s) that played on their own with no sound`, `${counted.silent} elemento(s) que tocaram sozinhos sem som`) : '',
      data.autoplayPolicy && data.autoplayPolicy !== 'allowed' ? say(ctx.locale, `the browser's autoplay policy was "${data.autoplayPolicy}"`, `a política de autoplay do navegador era "${data.autoplayPolicy}"`) : '',
      unreadNote(unread(data, ['audio', 'video']), ctx.locale),
      ...commonNotes(data, ctx.locale, nothing),
    ]
    return result(t, row(this, '1.4.2', record, t, notes, ctx.locale))
  },
}

export const MEDIA_RULES: readonly ProbeRule[] = [audioVideoOnlyRule, captionsRule, mediaAlternativeRule, liveCaptionsRule, audioDescriptionRule, audioControlRule]

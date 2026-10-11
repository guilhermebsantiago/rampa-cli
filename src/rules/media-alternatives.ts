import type { Confidence } from '../core/types.ts'
import type { Locale } from '../i18n.ts'
import type { AltFetch, AltText, MediaAlternative } from '../probes/media-alternatives.ts'
import type { MediaItem, MediaTrack } from '../probes/media.ts'
import { say } from './probes.ts'

/**
 * What the media probe found as alternatives (src/probes/media-alternatives.ts), sorted into three states. Rampa never
 * says an alternative is equivalent, complete or correct (docs/plans/wcag-coverage.md, section 6); it only tells
 * one that holds text (to quote, for a person to compare) from one that is broken or a placeholder, and from one it
 * could not read.
 *
 * - content: it holds or leads to text (or cues, or another audio player), quoted for review;
 * - broken: it leads nowhere (`href="#"` with nothing that handles a press, a fragment the page does not hold), to an
 *   address that answers 404 or 410 or a "not found" page, to nothing (an empty region, an empty file, a track with no
 *   cues), to a placeholder ("Transcript coming soon", lorem ipsum), or to text hidden from everyone with nothing on
 *   the page to show it;
 * - unread: it may hold the alternative, but the probe did not read it (a button it never presses, a link a script
 *   handles, an address of another origin that only got a HEAD, a PDF, an error).
 */

export type AltState = 'content' | 'broken' | 'unread'

export interface AltVerdict {
  state: AltState
  confidence: Confidence
  /** Why, in the report's language: "answers 404", "leads nowhere (href="#")". */
  why: string
  /** The reason already quotes the text (a placeholder), or there is none (empty): the evidence does not repeat it. */
  quoted?: boolean | undefined
}

/** A whole text that stands in for an alternative not written yet. */
const PLACEHOLDER =
  /^(?:(?:the |a )?(?:full |complete )?(?:transcri(?:pt|ption|ção|cao|pción)|text version|captions?|legendas?|subt[ií]tulos?|lyrics)\s*(?:[:\-–—]\s*)?)?(?:(?:is |are |will be |ser[aá] |estar[aá] )?(?:coming soon|available soon|to (?:follow|come)|(?:added|posted|available|publicad[oa]|adicionad[oa]|disponibilizad[oa])(?: soon| em breve)?)|tbd|tba|to ?do|placeholder|pending|em breve|dispon[ií]vel em breve|pr[oó]ximamente|disponible pronto|pendiente|n\/a|\.\.\.|…|-+|—|insert (?:the )?transcript here|transcript here|transcri[cç][aã]o aqui)[.!:]*$/i
const LOREM = /^lorem ipsum\b/i
/** A cue that is a placeholder, not a caption. "[Music]" alone is a real caption for a video with only music, and is not one. */
const CUE_PLACEHOLDER =
  /^(?:lorem ipsum\b.*|to ?do|tbd|placeholder|test(?:e|ing)?|prueba|caption(?: text)?(?: here)?|subtitles?(?: text)?(?: here)?|legenda(?: aqui)?|subt[ií]tulo(?: aqu[ií])?|sample (?:caption|subtitle)s?|\.\.\.|…|-+|\[?(?:no captions?|sem legendas?|sin subt[ií]tulos)\]?)$/i
/** An HTML answer that says the page is not there: a "soft 404". */
const NOT_FOUND = /\b404\b|\bpage not found\b|^not found$|\bnot found\s*[-|–]|p[aá]gina n[aã]o (?:foi )?encontrada|p[aá]gina no encontrada|no se (?:ha )?encontr[oó] la p[aá]gina|n[aã]o encontramos (?:a|esta) p[aá]gina/i

const quote = (text: string) => `"${text}"`
const cut = (value: string, n: number) => (value.length > n ? `${value.slice(0, n - 1)}…` : value)
const number = (n: number) => n.toLocaleString('en-US')

export function isPlaceholderText(text: AltText): boolean {
  return LOREM.test(text.excerpt) || (text.chars <= 80 && PLACEHOLDER.test(text.excerpt))
}

/** Every cue is blank, or every distinct text is a placeholder ("TODO", "Lorem ipsum", "Caption here"). */
export function placeholderCues(track: MediaTrack): 'blank' | 'placeholder' | undefined {
  const cues = track.cues ?? 0
  if (track.state !== 'loaded' || cues === 0 || track.blank === undefined) return undefined
  if (track.blank >= cues) return 'blank'
  const texts = track.texts ?? []
  if ((track.distinct ?? 0) > 0 && (track.distinct ?? 0) <= 3 && texts.length === track.distinct && texts.every((text) => CUE_PLACEHOLDER.test(text))) return 'placeholder'
  return undefined
}

function judgeText(text: AltText | undefined, locale: Locale, empty: { state: AltState; why: string } | undefined = undefined): AltVerdict {
  if (!text) return { state: 'unread', confidence: 'medium', why: say(locale, 'not read', 'não lido') }
  if (text.chars === 0) {
    if (text.embeds) return { state: 'unread', confidence: 'medium', why: say(locale, `holds ${text.embeds} frame(s) or object(s) the probe does not read`, `contém ${text.embeds} frame(s) ou objeto(s) que a sonda não lê`) }
    return { state: empty?.state ?? 'broken', confidence: 'high', why: empty?.why ?? say(locale, 'empty: no text', 'vazio: nenhum texto'), quoted: true }
  }
  if (isPlaceholderText(text)) return { state: 'broken', confidence: 'high', why: say(locale, `a placeholder: ${quote(cut(text.excerpt, 120))}`, `um texto provisório: ${quote(cut(text.excerpt, 120))}`), quoted: true }
  return { state: 'content', confidence: 'high', why: '' }
}

/** Text the probe found hidden, with nothing on the page that may show it, cannot serve as an alternative. */
function hiddenVerdict(a: MediaAlternative, locale: Locale): AltVerdict | undefined {
  if (a.shown === 'hidden') return { state: 'broken', confidence: 'medium', why: say(locale, 'hidden (not rendered), and nothing on the page shows it', 'oculto (não renderizado), e nada na página o mostra') }
  if (a.shown === 'aria-hidden') return { state: 'broken', confidence: 'medium', why: say(locale, 'hidden from assistive technology (aria-hidden), and nothing on the page exposes it', 'oculto das tecnologias assistivas (aria-hidden), e nada na página o expõe') }
  return undefined
}

function judgeContent(a: MediaAlternative, locale: Locale): AltVerdict {
  const empty =
    a.by === 'attribute'
      ? // An element named for a transcript only by its id or class, still empty: a script may fill it later (a player's transcript panel).
        { state: 'unread' as const, why: say(locale, 'empty when read: an element named for a transcript only by its id or class, which a script may fill', 'vazio quando lido: um elemento nomeado como transcrição só pelo id ou classe, que um script pode preencher') }
      : a.how === 'button'
        ? { state: 'unread' as const, why: say(locale, 'the region it controls is empty until it is pressed, which the probe never does', 'a região que ele controla fica vazia até ser acionado, o que a sonda nunca faz') }
        : undefined
  // Collapsed and empty behind a control (not a details, whose content is markup): a script may fill it when shown.
  const collapsedEmpty =
    a.shown === 'collapsed' && a.how !== 'details' && a.content?.chars === 0
      ? { state: 'unread' as const, why: say(locale, 'collapsed and empty: a script may fill it when it is shown, which the probe never does', 'recolhido e vazio: um script pode preenchê-lo ao mostrá-lo, o que a sonda nunca faz') }
      : undefined
  const text = judgeText(a.content, locale, empty ?? collapsedEmpty)
  if (text.state !== 'content') return text
  const hidden = hiddenVerdict(a, locale)
  // Hidden text elsewhere on the page may be anything (a template, a closed panel of another widget): never broken.
  if (hidden && !a.near) return { state: 'unread', confidence: 'medium', why: say(locale, 'hidden, elsewhere on the page', 'oculto, em outro ponto da página') }
  return hidden ?? text
}

function judgeFetch(f: AltFetch, locale: Locale): AltVerdict {
  const status = f.status
  if (status === null) return { state: 'unread', confidence: 'medium', why: say(locale, `could not be read (${f.error ?? 'no answer'})`, `não pôde ser lido (${f.error ?? 'sem resposta'})`) }
  if (status === 404 || status === 410) {
    const where = f.method === 'FILE' ? say(locale, 'the file does not exist', 'o arquivo não existe') : say(locale, `answers ${status}`, `responde ${status}`)
    return { state: 'broken', confidence: f.method === 'HEAD' ? 'medium' : 'high', why: where }
  }
  if (status >= 200 && status < 300) {
    if (f.method === 'HEAD') return { state: 'unread', confidence: 'medium', why: say(locale, `answers ${status} from another origin (only a HEAD was sent; not read)`, `responde ${status} de outra origem (só um HEAD foi enviado; não lido)`) }
    if ((f.title && NOT_FOUND.test(f.title)) || (f.heading && NOT_FOUND.test(f.heading))) {
      return { state: 'broken', confidence: 'medium', why: say(locale, `answers ${status} with a "not found" page`, `responde ${status} com uma página de "não encontrado"`), quoted: true }
    }
    if (f.cues === 0) return { state: 'broken', confidence: 'high', why: say(locale, 'a WebVTT file with no cues', 'um arquivo WebVTT sem nenhuma deixa') }
    if (f.text) return judgeText(f.text, locale)
    if (f.bytes === 0) return { state: 'broken', confidence: 'high', why: say(locale, 'an empty file (0 bytes)', 'um arquivo vazio (0 bytes)') }
    const kb = f.bytes !== undefined ? `, ${number(Math.max(1, Math.round(f.bytes / 1024)))} KB` : ''
    return { state: 'unread', confidence: 'medium', why: say(locale, `a file the probe does not read (${f.type ?? 'unknown type'}${kb})`, `um arquivo que a sonda não lê (${f.type ?? 'tipo desconhecido'}${kb})`) }
  }
  return { state: 'unread', confidence: 'medium', why: say(locale, `could not be read (answers ${status})`, `não pôde ser lido (responde ${status})`) }
}

export function judgeAlternative(a: MediaAlternative, locale: Locale): AltVerdict {
  if (a.how === 'link' && (a.placeholder || a.missing)) {
    // A link that leads nowhere by itself, unless a script acts on the press.
    if (a.content) return judgeContent(a, locale)
    const nowhere = a.missing
      ? say(locale, `leads nowhere: no element of the page has the id ${quote((a.href ?? '').replace(/^.*#/, ''))}`, `não leva a lugar nenhum: nenhum elemento da página tem o id ${quote((a.href ?? '').replace(/^.*#/, ''))}`)
      : say(locale, `leads nowhere (href=${quote(a.href ?? '')})`, `não leva a lugar nenhum (href=${quote(a.href ?? '')})`)
    if (a.handled === 'own' || a.handled === 'markup')
      return { state: 'unread', confidence: 'medium', why: say(locale, `${nowhere}, but a script handles it; the probe never presses it`, `${nowhere}, mas um script o trata; a sonda nunca o aciona`) }
    if (a.handled === 'delegated')
      return { state: 'broken', confidence: 'medium', why: say(locale, `${nowhere}; only a click listener on an ancestor or the document might act on it (often analytics)`, `${nowhere}; só um ouvinte de clique num ancestral ou no documento poderia agir (muitas vezes, análise de tráfego)`) }
    if (a.handled === 'none') return { state: 'broken', confidence: 'high', why: say(locale, `${nowhere}, and nothing on the page handles a press`, `${nowhere}, e nada na página trata o acionamento`) }
    return { state: 'unread', confidence: 'medium', why: say(locale, `${nowhere}; its listeners could not be read`, `${nowhere}; os ouvintes não puderam ser lidos`) }
  }
  if (a.how === 'link' && a.url) {
    if (!a.fetched)
      return {
        state: 'unread',
        confidence: 'medium',
        why: say(
          locale,
          'not read (the probe reads at most 6 addresses, those next to a media first, and those elsewhere only on a page with one media)',
          'não lido (a sonda lê no máximo 6 endereços, primeiro os ao lado de uma mídia, e os de outros pontos só numa página com uma mídia)',
        ),
      }
    return judgeFetch(a.fetched, locale)
  }
  if (a.how === 'button' && !a.content) return { state: 'unread', confidence: 'medium', why: say(locale, 'a control the probe never presses', 'um controle que a sonda nunca aciona') }
  return judgeContent(a, locale)
}

/** A text track offered as an alternative: broken when it does not load, holds no cues, or only blank or placeholder cues. */
export function judgeTrack(track: MediaTrack, locale: Locale): AltVerdict {
  if (track.state === 'error') return { state: 'broken', confidence: 'high', why: say(locale, 'does not load', 'não carrega') }
  if (track.state === 'loaded') {
    if ((track.cues ?? 0) === 0) return { state: 'broken', confidence: 'high', why: say(locale, 'holds no cues', 'não tem nenhuma deixa') }
    const placeholder = placeholderCues(track)
    if (placeholder === 'blank') return { state: 'broken', confidence: 'high', why: say(locale, 'every cue is empty', 'todas as deixas estão vazias') }
    if (placeholder === 'placeholder') return { state: 'broken', confidence: 'high', why: say(locale, `its cues are placeholders (${(track.texts ?? []).map(quote).join(', ')})`, `as deixas são provisórias (${(track.texts ?? []).map(quote).join(', ')})`) }
    return { state: 'content', confidence: 'high', why: '' }
  }
  return { state: 'unread', confidence: 'medium', why: track.state === 'loading' ? say(locale, 'still loading', 'ainda carregando') : say(locale, 'not loaded', 'não carregado') }
}

function textFacts(text: AltText, locale: Locale): string {
  const size = say(locale, `${number(text.chars)}${text.more ? '+' : ''} characters`, `${number(text.chars)}${text.more ? '+' : ''} caracteres`)
  return text.excerpt ? `${size}, ${quote(cut(text.excerpt, 200))}` : size
}

function shownText(shown: MediaAlternative['shown'], locale: Locale): string {
  if (shown === 'collapsed') return say(locale, ' (collapsed)', ' (recolhido)')
  if (shown === 'hidden') return say(locale, ' (hidden)', ' (oculto)')
  if (shown === 'aria-hidden') return ' (aria-hidden)'
  return ''
}

function fetchText(f: AltFetch, locale: Locale): string {
  const parts = [`${f.method === 'FILE' ? say(locale, 'file', 'arquivo') : f.method} ${f.status ?? say(locale, 'no answer', 'sem resposta')}`]
  if (f.final) parts.push(say(locale, `ended at ${f.final}`, `terminou em ${f.final}`))
  if (f.type) parts.push(f.type.split(';')[0] ?? f.type)
  if (f.title) parts.push(say(locale, `title ${quote(cut(f.title, 80))}`, `título ${quote(cut(f.title, 80))}`))
  if (f.cues !== undefined) parts.push(say(locale, `${f.cues} cue(s)`, `${f.cues} deixa(s)`))
  if (f.fragmentMissing) parts.push(say(locale, 'the fragment is not on that page', 'o fragmento não está nessa página'))
  return parts.join(', ')
}

/** One alternative, as evidence: what it is, what it leads to, what it holds (quoted), and what is wrong with it. */
export function describeAlternative(a: MediaAlternative, v: AltVerdict, locale: Locale): string {
  const label = quote(cut(a.label, 80))
  let head: string
  if (a.how === 'link') head = `<${a.tag}> ${label} → ${a.href ? cut(a.href, 120) : say(locale, 'no href', 'sem href')}`
  else if (a.how === 'section') head = say(locale, `<${a.tag}> ${label} and the text after it`, `<${a.tag}> ${label} e o texto depois dele`)
  else if (a.how === 'described') head = say(locale, `what aria-describedby names, <${a.tag}>`, `o que o aria-describedby indica, <${a.tag}>`)
  else if (a.how === 'adjacent') head = a.near ? say(locale, `<${a.tag}> next to it that refers to it`, `<${a.tag}> ao lado que se refere a ele`) : say(locale, `<${a.tag}> that refers to a media`, `<${a.tag}> que se refere a uma mídia`)
  else head = `<${a.tag}> ${label}`
  const parts: string[] = []
  if (a.fetched) parts.push(`(${fetchText(a.fetched, locale)})`)
  // The text it holds, quoted, unless the reason already says it.
  const text = v.quoted ? undefined : (a.fetched?.text ?? a.content)
  const body = text ? textFacts(text, locale) : ''
  const tail = [body ? `${body}${a.fetched ? '' : shownText(a.shown, locale)}` : '', v.state === 'content' ? '' : v.why].filter(Boolean).join('; ')
  return `${head}${parts.length > 0 ? ` ${parts.join(' ')}` : ''}${tail ? `: ${tail}` : ''}`
}

export function describeTrack(track: MediaTrack, v: AltVerdict, locale: Locale): string {
  const name = [track.label, track.srclang].filter(Boolean).join(', ')
  const what = say(locale, `${track.kind} track${name ? ` (${name})` : ''}${track.src ? ` ${track.src}` : ''}`, `faixa ${track.kind}${name ? ` (${name})` : ''}${track.src ? ` ${track.src}` : ''}`)
  if (v.state !== 'content') return `${what}: ${v.why}`
  const texts = (track.texts ?? (track.first ? [track.first] : [])).slice(0, 2).map(quote).join(', ')
  return `${what}: ${say(locale, `${track.cues} cue(s)`, `${track.cues} deixa(s)`)}${texts ? `, ${texts}` : ''}`
}

/** An audio player next to a video with no sound, as a possible audio version of it. */
export function describeAudio(item: MediaItem, locale: Locale): string {
  const length = item.duration !== null ? say(locale, `, ${item.duration} s long`, `, ${item.duration} s de duração`) : ''
  return say(locale, `an audio player next to it, <audio> ${item.ref}${item.src ? ` (${cut(item.src, 100)})` : ''}${length}`, `um player de áudio ao lado, <audio> ${item.ref}${item.src ? ` (${cut(item.src, 100)})` : ''}${length}`)
}

const RANK: Record<Confidence, number> = { low: 0, medium: 1, high: 2 }

/** The weakest of the confidences: a failure is as sure as its least sure part. */
export function weakest(values: readonly Confidence[]): Confidence {
  return values.reduce<Confidence>((low, value) => (RANK[value] < RANK[low] ? value : low), 'high')
}

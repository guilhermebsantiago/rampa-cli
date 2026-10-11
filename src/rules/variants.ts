import { agreement, loadLanguageIdentifier, readLanguage } from '../core/language-id.ts'
import type { Finding, ProbeCoverage } from '../core/types.ts'
import { canonicalLanguageTag, normalizeForMatch, primarySubtag, truncate } from '../core/util.ts'
import { type Locale, languageName } from '../i18n.ts'
import { matchNode } from '../probes/identity.ts'
import { type CarouselRecord, type LanguageVersion, type VariantPicture, type VariantsData, thumbDistance } from '../probes/variants.ts'
import type { ProbeRecord } from '../snapshot/schema.ts'
import { type ProbeRule, type ProbeRuleContext, asArray, asRecord, conditionsText, coverageStatus, probeFinding, say } from './probes.ts'

/**
 * Rules over the state-variants probe (src/probes/variants.ts), D6 of the coverage plan.
 *
 * - `rampa/carousel-name` (1.1.1, F20): a carousel, or an image a script swaps, shows pictures that its pixels tell
 *   apart, and every one of them has the same name. F20's test asks whether a text alternative describes content other
 *   than the picture now showing; one name for several different pictures can describe one of them at most, unless it
 *   says nothing about any (a person checks that, below the threshold). Pictures whose addresses differ but that were not
 *   captured go to review: the pixels did not tell.
 * - `rampa/language-versions` (3.1.1): a version of the page in another language (an `hreflang` alternate, a link of
 *   the language switcher) whose root declares a language its text is not in, as the language identifier reads it
 *   clearly (150 letters and 20 words at least, one language well ahead). Short or mixed text is never judged.
 */

export const CAROUSEL_RULE = 'rampa/carousel-name'
export const LANGUAGE_VERSIONS_RULE = 'rampa/language-versions'

/** Two captures this far apart, in mean grey level of their 16×16 cells (0 to 255), are two pictures. */
export const PICTURE_DISTANCE = 16

const variantsData = (record: ProbeRecord): VariantsData => asRecord(record.data) as unknown as VariantsData

const fileOf = (src: string): string => {
  try {
    return new URL(src).pathname.split('/').pop() || src
  } catch {
    return src.split(/[?#]/)[0]?.split('/').pop() || src
  }
}

/** Each element's last picture, a captured one when it has one, in the order the elements first showed. */
export function lastPerElement(pictures: readonly VariantPicture[]): VariantPicture[] {
  const last = new Map<string, VariantPicture>()
  for (const picture of pictures) {
    const kept = last.get(picture.ref)
    if (!kept || picture.thumb || !kept.thumb) last.set(picture.ref, picture)
  }
  return [...last.values()]
}

/**
 * The pictures told apart by their pixels: each capture further than PICTURE_DISTANCE from every one kept before it.
 * Two images with one address are one picture, whatever their captures show (a slide captured off its place).
 */
export function distinctPictures(pictures: readonly VariantPicture[]): VariantPicture[] {
  const distinct: VariantPicture[] = []
  for (const picture of pictures) {
    const thumb = picture.thumb
    if (!thumb || distinct.some((kept) => kept.src === picture.src)) continue
    if (distinct.every((kept) => thumbDistance(kept.thumb as string, thumb) >= PICTURE_DISTANCE)) distinct.push(picture)
  }
  return distinct
}

const CAROUSEL_TEXT: Record<Locale, { carousel: string; swap: string; review: string }> = {
  en: {
    carousel:
      'This carousel shows {count} different pictures, and every one of them is named “{name}”: the text alternative stays the same while the picture changes, so it describes one slide at most (WCAG 1.1.1, F20). Give each slide’s image an alternative for what it shows.',
    swap: 'A script changes the picture this image shows ({count} different pictures), and its name stays “{name}”: the text alternative is not updated with the picture, so it describes one of them at most (WCAG 1.1.1, F20). Update the alternative when the picture changes.',
    review:
      'This carousel’s images show {count} different addresses, and every one is named “{name}”, but not every picture could be captured to compare: check that the name fits each picture (WCAG 1.1.1, F20).',
  },
  'pt-BR': {
    carousel:
      'Este carrossel mostra {count} imagens diferentes, e todas se chamam “{name}”: o texto alternativo continua o mesmo enquanto a imagem muda, então descreve um slide no máximo (WCAG 1.1.1, F20). Dê à imagem de cada slide um texto alternativo para o que ela mostra.',
    swap: 'Um script troca a imagem que este elemento mostra ({count} imagens diferentes), e o nome continua “{name}”: o texto alternativo não acompanha a imagem, então descreve uma delas no máximo (WCAG 1.1.1, F20). Atualize o texto alternativo quando a imagem mudar.',
    review:
      'As imagens deste carrossel têm {count} endereços diferentes, e todas se chamam “{name}”, mas nem todas puderam ser capturadas para comparar: confira se o nome serve para cada imagem (WCAG 1.1.1, F20).',
  },
}

export const carouselNameRule: ProbeRule = {
  id: CAROUSEL_RULE,
  kind: 'variants',
  versions: ['1'],
  criteria: ['1.1.1'],
  run(record: ProbeRecord, ctx: ProbeRuleContext) {
    const data = variantsData(record)
    const findings: Finding[] = []
    const review: Finding[] = []
    let applicable = 0
    let unmatched = 0
    let renamed = 0
    let decorative = 0
    const carousels = asArray<CarouselRecord>(data.carousels)
    for (const carousel of carousels) {
      const all = asArray<VariantPicture>(carousel.pictures).filter((picture) => typeof picture.name === 'string' && typeof picture.src === 'string')
      // In a carousel of several slides, each slide's image counts once, as it last showed: an image that changed its
      // picture there was loading late. Only an image a script swaps over and over is followed picture by picture.
      const pictures = carousel.why === 'swap' ? all : lastPerElement(all)
      if (pictures.length < 2) continue
      applicable++
      const names = new Set(pictures.map((picture) => normalizeForMatch(picture.name)))
      // The name changes with the picture: what each name says is 1.1.1's judgment, picture by picture.
      if (names.size > 1) {
        renamed++
        continue
      }
      const name = (pictures[0] as VariantPicture).name.trim()
      if (name === '') {
        decorative++
        continue
      }
      const distinct = distinctPictures(pictures)
      const sources = new Set(pictures.map((picture) => picture.src))
      const uncaptured = pictures.filter((picture) => !picture.thumb).length
      if (distinct.length < 2 && !(uncaptured > 0 && sources.size >= 2)) continue
      const node = matchNode(ctx.index, carousel.el?.ref, carousel.el?.id)
      if (!node) {
        unmatched++
        continue
      }
      const swap = carousel.why === 'swap'
      const shown = pictures.filter((picture) => picture.shown === 'clock').length
      const how = swap
        ? say(ctx.locale, `the picture changed on its own as the clock ran on, in steps of ${data.stepMs / 1000} s`, `a imagem mudou sozinha com o relógio avançando, em passos de ${data.stepMs / 1000} s`)
        : shown >= 2
          ? say(ctx.locale, `${shown} shown by the carousel on its own, on the clock`, `${shown} mostradas pelo próprio carrossel, no relógio`)
          : say(ctx.locale, `slides made visible one at a time`, `slides tornados visíveis um de cada vez`)
      if (distinct.length >= 2) {
        const text = CAROUSEL_TEXT[ctx.locale][swap ? 'swap' : 'carousel']
        findings.push(
          probeFinding({
            criterion: '1.1.1',
            rule: CAROUSEL_RULE,
            node,
            message: text.replace('{count}', String(distinct.length)).replace('{name}', truncate(name, 80)),
            evidence: `${say(ctx.locale, `${distinct.length} pictures told apart by their pixels`, `${distinct.length} imagens distinguidas pelos pixels`)}: ${distinct.map((picture) => fileOf(picture.src)).join(', ')}; ${say(ctx.locale, 'each named', 'todas com o nome')} “${truncate(name, 80)}”; ${how}`,
            // One name may fit every picture when it says little about any ("Our campus"): a person checks.
            confidence: 'medium',
            subject: `carousel|${normalizeForMatch(name)}`,
          }),
        )
      } else {
        review.push(
          probeFinding({
            criterion: '1.1.1',
            rule: CAROUSEL_RULE,
            node,
            message: CAROUSEL_TEXT[ctx.locale].review.replace('{count}', String(sources.size)).replace('{name}', truncate(name, 80)),
            evidence: `${[...sources].map(fileOf).join(', ')}; ${say(ctx.locale, `${uncaptured} not captured`, `${uncaptured} não capturada(s)`)}: ${[...new Set(pictures.flatMap((picture) => (picture.skipped ? [picture.skipped] : [])))].join(', ')}`,
            confidence: 'low',
            subject: `carousel|${normalizeForMatch(name)}`,
          }),
        )
      }
    }
    const notes = [
      data.clock === false ? say(ctx.locale, 'the fake clock did not work: only the pictures as the page loaded were seen', 'o relógio simulado não funcionou: só as imagens do carregamento foram vistas') : '',
      renamed > 0 ? say(ctx.locale, `${renamed} carousel(s) whose names change with the picture`, `${renamed} carrossel(éis) cujo nome muda com a imagem`) : '',
      decorative > 0 ? say(ctx.locale, `${decorative} with empty names (decorative)`, `${decorative} com nome vazio (decorativo)`) : '',
      unmatched > 0 ? say(ctx.locale, `${unmatched} not found in the snapshot`, `${unmatched} não encontrado(s) no snapshot`) : '',
      applicable === 0 ? say(ctx.locale, 'no carousel with two pictures or more, and no image a script swapped', 'nenhum carrossel com duas imagens ou mais, e nenhuma imagem trocada por script') : '',
    ].filter(Boolean)
    const coverage: ProbeCoverage = {
      criterion: '1.1.1',
      method: `probe/variants@${record.version}`,
      rule: CAROUSEL_RULE,
      conditions: conditionsText(record, say(ctx.locale, `carousels over ${((data.steps ?? 0) * (data.stepMs ?? 0)) / 1000} s of fake clock`, `carrosséis em ${((data.steps ?? 0) * (data.stepMs ?? 0)) / 1000} s de relógio simulado`)),
      // A page with no carousel says nothing about 1.1.1 from this probe.
      status: applicable === 0 ? 'not-checked' : coverageStatus(findings.length, review.length),
      applicable,
      failures: findings.length,
      review: review.length,
      unmatched,
      note: notes.join('; '),
      maturity: 'experimental',
    }
    return { findings, review, coverage: [coverage] }
  },
}

const LANGUAGE_TEXT: Record<Locale, string> = {
  en: 'The {claimed} version of this page ({url}) is marked lang="{declared}", but its text is in {detected}: screen readers read it with the wrong pronunciation (WCAG 3.1.1, on that page). Set lang="{code}" on its html element. Read by the language identifier from {letters} letters of text, with no model asked.',
  'pt-BR':
    'A versão em {claimed} desta página ({url}) está marcada como lang="{declared}", mas o texto está em {detected}: o leitor de tela lê com a pronúncia errada (WCAG 3.1.1, naquela página). Declare lang="{code}" no elemento html dela. Lido pelo identificador de idioma em {letters} letras de texto, sem consultar um modelo.',
}

export const languageVersionsRule: ProbeRule = {
  id: LANGUAGE_VERSIONS_RULE,
  kind: 'variants',
  versions: ['1'],
  criteria: ['3.1.1'],
  prepare: loadLanguageIdentifier,
  run(record: ProbeRecord, ctx: ProbeRuleContext) {
    const data = variantsData(record)
    const findings: Finding[] = []
    const versions = asArray<LanguageVersion>(data.languages)
    let applicable = 0
    let notRead = 0
    let undeclared = 0
    let unsure = 0
    const root = ctx.snapshot.root
    for (const version of versions) {
      if (version.reason || typeof version.text !== 'string') {
        notRead++
        continue
      }
      const declared = typeof version.declared === 'string' ? version.declared.trim() : ''
      // A version with no valid lang is that page's own failure, which axe-core reports when it is checked.
      if (declared === '' || !canonicalLanguageTag(declared)) {
        undeclared++
        continue
      }
      const text = [version.title, version.text].filter(Boolean).join(' ')
      const reading = readLanguage(text)
      applicable++
      // Only long text, read clearly: a short or mixed one is never judged.
      const verdict = agreement(reading, declared, 'clear')
      if (verdict !== 'other' || !reading) {
        if (verdict === 'unsure') unsure++
        continue
      }
      const node = (version.link ? matchNode(ctx.index, version.link.ref, version.link.id) : undefined) ?? root
      const url = version.url ?? version.href
      findings.push(
        probeFinding({
          criterion: '3.1.1',
          rule: LANGUAGE_VERSIONS_RULE,
          node,
          message: LANGUAGE_TEXT[ctx.locale]
            .replace('{claimed}', languageName(version.claimed, ctx.locale))
            .replace('{url}', truncate(url, 100))
            .replace('{declared}', declared)
            .replace('{detected}', languageName(reading.language, ctx.locale))
            .replace('{code}', reading.language)
            .replace('{letters}', String(reading.letters)),
          evidence: `${truncate(url, 100)}: lang="${declared}"; ${say(ctx.locale, 'read as', 'lido como')} ${reading.language}: “${truncate(reading.sample ?? '', 120)}”`,
          confidence: 'high',
          subject: `version|${primarySubtag(version.claimed)}|${declared}`,
        }),
      )
    }
    const left = Number(data.languagesLeftOut) || 0
    const notes = [
      notRead > 0 ? say(ctx.locale, `${notRead} version(s) not read`, `${notRead} versão(ões) não lida(s)`) : '',
      undeclared > 0 ? say(ctx.locale, `${undeclared} declare(s) no valid lang (that page's own html-has-lang)`, `${undeclared} sem lang válido (o html-has-lang daquela página)`) : '',
      unsure > 0 ? say(ctx.locale, `${unsure} with too little or mixed text to judge`, `${unsure} com texto curto ou misturado demais para julgar`) : '',
      left > 0 ? say(ctx.locale, `${left} more language(s) past the limit, not read`, `mais ${left} idioma(s) além do limite, não lido(s)`) : '',
      versions.length === 0 ? say(ctx.locale, 'no other language version linked (hreflang or a language switcher)', 'nenhuma versão em outro idioma ligada (hreflang ou seletor de idioma)') : '',
    ].filter(Boolean)
    const coverage: ProbeCoverage = {
      criterion: '3.1.1',
      method: `probe/variants@${record.version}`,
      rule: LANGUAGE_VERSIONS_RULE,
      conditions: conditionsText(record, say(ctx.locale, `${versions.length} language version(s) loaded`, `${versions.length} versão(ões) em outro idioma carregada(s)`)),
      status: applicable === 0 ? 'not-checked' : coverageStatus(findings.length, 0),
      applicable,
      failures: findings.length,
      review: 0,
      unmatched: 0,
      note: notes.join('; '),
      maturity: 'experimental',
    }
    return { findings, review: [], coverage: [coverage] }
  },
}

export const VARIANTS_RULES: readonly ProbeRule[] = [carouselNameRule, languageVersionsRule]

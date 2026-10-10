import type { Finding } from '../core/types.ts'
import type { Locale } from '../i18n.ts'
import { SKIP_LINK_VARIANT, SKIP_LINK_VERSION, type SkipActivation, type SkipStop } from '../probes/bypass.ts'
import { matchNode, nameOf } from '../probes/identity.ts'
import { type BypassFacts, type BypassUnit, type SkipProblem, bypassFacts, judgeBypass } from '../site/bypass-blocks.ts'
import type { A11yNode } from '../snapshot/schema.ts'
import { type ProbeRule, asArray, asRecord, conditionsText, coverageStatus, probeFinding, say } from './probes.ts'

/**
 * 2.4.1 Bypass Blocks on one page (`--probe keyboard`). Whether a skip link among the first Tab stops works, and
 * whether the page has some other way past its header and navigation (a main landmark, a heading where its
 * content starts). One page cannot show which blocks repeat on other pages, so this rule never fails 2.4.1: a
 * page with no way past its leading links, or a skip link that does not work, goes to review. Failures come from
 * comparing the pages of a crawl (src/site/bypass-blocks.ts).
 */

const TEXT: Record<Locale, Record<SkipProblem | 'none' | 'unverified', string>> = {
  en: {
    'no-target': 'This skip link points to #{fragment}, but nothing on the page has that id or anchor name: it goes nowhere.',
    'not-moved':
      'Pressing Enter on this skip link did not move focus to #{fragment}: the next Tab went to {next}, before it. Keyboard users cannot use it to pass the blocks before the content.',
    navigated: 'Pressing Enter on this link to #{fragment} tried to load another page instead of moving within this one.',
    'hidden-on-focus':
      'This skip link works, but it never shows on screen, even with keyboard focus (it stays off screen, clipped, or under other content): sighted keyboard users cannot see it. Make it visible at least while it has focus (G1).',
    none: 'The page starts with {count} link(s) and control(s) before its content (a header, a menu), and Rampa found no skip link, main landmark or heading after them that lets someone pass them. If they repeat on other pages of the site, 2.4.1 fails: check it with --crawl, which compares the pages.',
    unverified: 'The page starts with {count} link(s) and control(s) before its content (a header, a menu), and the only way past them Rampa found is a control it cannot try ({control}). Check that it moves focus past them or hides them (2.4.1).',
  },
  'pt-BR': {
    'no-target': 'Este link de pular aponta para #{fragment}, mas nada na página tem esse id ou nome de âncora: ele não leva a lugar nenhum.',
    'not-moved':
      'Acionar este link de pular com Enter não levou o foco para #{fragment}: o Tab seguinte foi para {next}, antes dele. Quem usa teclado não consegue passar com ele pelos blocos antes do conteúdo.',
    navigated: 'Acionar este link para #{fragment} com Enter tentou carregar outra página em vez de se mover dentro desta.',
    'hidden-on-focus':
      'Este link de pular funciona, mas nunca aparece na tela, nem com o foco do teclado (fica fora da tela, recortado ou sob outro conteúdo): quem enxerga e usa teclado não o vê. Deixe-o visível pelo menos enquanto tem o foco (G1).',
    none: 'A página começa com {count} link(s) e controle(s) antes do conteúdo (um cabeçalho, um menu), e o Rampa não achou link de pular, landmark main ou título depois deles que permita pulá-los. Se eles se repetem em outras páginas do site, o 2.4.1 falha: confira com --crawl, que compara as páginas.',
    unverified: 'A página começa com {count} link(s) e controle(s) antes do conteúdo (um cabeçalho, um menu), e a única forma de pulá-los que o Rampa achou é um controle que ele não pode testar ({control}). Confira se ele leva o foco para depois deles ou os esconde (2.4.1).',
  },
}

const WORDS: Record<Locale, Record<string, string>> = {
  en: { target: 'the target', 'inside-target': 'inside the target', link: 'the link', document: 'the document', elsewhere: 'another element', inside: 'inside', after: 'after', before: 'before', same: 'back to the link', none: 'out of the page' },
  'pt-BR': { target: 'o alvo', 'inside-target': 'dentro do alvo', link: 'o link', document: 'o documento', elsewhere: 'outro elemento', inside: 'dentro do alvo', after: 'depois do alvo', before: 'antes do alvo', same: 'de volta ao link', none: 'para fora da página' },
}

const fill = (template: string, vars: Record<string, string | number>) => template.replace(/\{(\w+)\}/g, (_, name: string) => String(vars[name] ?? `{${name}}`))

/**
 * What probably repeats, from one page alone: what sits in the header and navigation landmarks, and, before the
 * first heading or sentence of the page's own, the links and controls outside the main landmark and the asides.
 */
export function likelyRepeated(facts: BypassFacts): (unit: BypassUnit) => boolean {
  const chrome = (unit: BypassUnit) => unit.region === 'banner' || unit.region === 'navigation'
  const content = facts.units.find(
    (unit) => !chrome(unit) && unit.region !== 'complementary' && unit.region !== 'contentinfo' && (unit.kind === 'heading' || (unit.kind === 'text' && unit.chars >= 25)),
  )
  const before = (unit: BypassUnit) => content !== undefined && unit.i < content.i
  return (unit) =>
    chrome(unit) || (before(unit) && (unit.region === 'complementary' || ((unit.kind === 'link' || unit.kind === 'control') && unit.region !== 'main')))
}

export const bypassBlocksRule: ProbeRule = {
  id: 'rampa/bypass-blocks',
  kind: 'keyboard',
  variant: SKIP_LINK_VARIANT,
  versions: [SKIP_LINK_VERSION],
  criteria: ['2.4.1'],
  run(record, ctx) {
    const data = asRecord(record.data)
    const stops = asArray<SkipStop>(data.stops).filter((stop) => stop && typeof stop.n === 'number')
    const activations = asArray<SkipActivation>(data.activations).filter((activation) => activation && typeof activation.n === 'number')
    const facts = bypassFacts(ctx.snapshot)
    const judgment = judgeBypass(facts, likelyRepeated(facts))
    const text = TEXT[ctx.locale]
    const review: Finding[] = []
    let unmatched = 0

    // Each skip link with a problem, on the link.
    for (const link of facts.probed) {
      const problem = link.verdict.problem as SkipProblem
      const node = ctx.index.get(link.ref)?.node
      if (!node) {
        unmatched++
        continue
      }
      const stop = stops.find((candidate) => candidate.el?.ref === link.ref)
      const activation = stop ? activations.find((candidate) => candidate.n === stop.n) : undefined
      const next = activation?.next?.el ? `<${activation.next.el.tag}> "${activation.next.el.label}"` : say(ctx.locale, 'the next element', 'o elemento seguinte')
      const keys = stop ? `Tab ×${stop.n}` : ''
      const evidence = [
        keys && say(ctx.locale, `${keys}: focus on ${nameOf(node, stop?.el ?? undefined)}`, `${keys}: foco em ${nameOf(node, stop?.el ?? undefined)}`),
        stop?.shown === false ? say(ctx.locale, 'not on screen with focus', 'fora da tela com o foco') : '',
        activation?.focus ? say(ctx.locale, `after Enter, focus on ${WORDS.en[activation.focus]}`, `depois do Enter, foco em ${WORDS['pt-BR'][activation.focus]}`) : '',
        activation?.next
          ? say(
              ctx.locale,
              `the next Tab went ${activation.next.relation === 'inside' || activation.next.relation === 'after' || activation.next.relation === 'before' ? `${WORDS.en[activation.next.relation]} the target` : WORDS.en[activation.next.relation]} (${next})`,
              `o Tab seguinte foi ${WORDS['pt-BR'][activation.next.relation]} (${next})`,
            )
          : '',
        link.verdict.between !== undefined ? say(ctx.locale, `${link.verdict.between} element(s) between the link and #${link.fragment}`, `${link.verdict.between} elemento(s) entre o link e #${link.fragment}`) : '',
      ]
        .filter(Boolean)
        .join('; ')
      review.push(
        probeFinding({
          criterion: '2.4.1',
          rule: this.id,
          node,
          message: fill(text[problem], { fragment: link.fragment, next }),
          evidence: evidence || `#${link.fragment}`,
          confidence: problem === 'hidden-on-focus' ? 'low' : 'medium',
          subject: `skip-link|${problem}|${link.fragment}`,
        }),
      )
    }

    // No way past the leading links at all, or only one Rampa cannot try: on the page, since no element is at fault.
    const leading = judgment.block.filter((unit) => unit.kind === 'link' || unit.kind === 'control').length
    if (judgment.status === 'fail' || judgment.status === 'review') {
      const root: A11yNode = ctx.snapshot.root
      const control = judgment.unverified[0]
      const node = judgment.status === 'review' && control ? (ctx.index.get(control.ref)?.node ?? root) : root
      review.push(
        probeFinding({
          criterion: '2.4.1',
          rule: this.id,
          node,
          message: fill(judgment.status === 'fail' ? text.none : text.unverified, { count: leading, control: control ? `“${control.name}”` : '' }),
          evidence: say(
            ctx.locale,
            `before the content (“${judgment.content?.name ?? ''}”): ${judgment.block.slice(0, 6).map((unit) => `“${unit.name}”`).join(', ')}${judgment.block.length > 6 ? ', …' : ''}`,
            `antes do conteúdo (“${judgment.content?.name ?? ''}”): ${judgment.block.slice(0, 6).map((unit) => `“${unit.name}”`).join(', ')}${judgment.block.length > 6 ? ', …' : ''}`,
          ),
          confidence: 'low',
          subject: judgment.status === 'fail' ? 'no-mechanism' : `unverified|${control?.name ?? ''}`,
        }),
      )
    }

    const working = facts.anchors.filter((anchor) => anchor.verdict?.works === true && !anchor.verdict.problem)
    const notes: string[] = []
    if (working.length > 0) {
      notes.push(
        working
          .map((anchor) =>
            say(ctx.locale, `link “${anchor.name}” → #${anchor.fragment} works (${anchor.verdict?.between ?? 0} element(s) skipped)`, `link “${anchor.name}” → #${anchor.fragment} funciona (${anchor.verdict?.between ?? 0} elemento(s) pulado(s))`),
          )
          .join('; '),
      )
    }
    if (judgment.status === 'pass') {
      const others = judgment.mechanisms.filter((mechanism) => !mechanism.startsWith('link '))
      if (others.length > 0) notes.push(say(ctx.locale, `also: ${others.join(', ')}`, `também: ${others.join(', ')}`))
    }
    if (judgment.status === 'none') {
      notes.push(
        judgment.reason === 'small'
          ? say(
              ctx.locale,
              `only ${judgment.block.length} item(s) before the content, fewer than a block to pass (2 links or 40 characters)`,
              `só ${judgment.block.length} item(ns) antes do conteúdo, menos que um bloco a pular (2 links ou 40 caracteres)`,
            )
          : judgment.reason === 'nothing-repeated'
            ? say(ctx.locale, 'no header, menu or aside before the content', 'nenhum cabeçalho, menu ou barra lateral antes do conteúdo')
            : say(ctx.locale, 'nothing after the header and the menus', 'nada depois do cabeçalho e dos menus'),
      )
    }
    if (stops.length === 0) notes.push(say(ctx.locale, 'Tab reached no element', 'o Tab não chegou a nenhum elemento'))
    // The rule looked at the page as a whole: one element, decided or sent to review.
    const applicable = 1
    return {
      findings: [],
      review,
      coverage: [
        {
          criterion: '2.4.1',
          method: `probe/keyboard@${record.version}`,
          rule: this.id,
          conditions: conditionsText(record, say(ctx.locale, `first ${stops.length} Tab stop(s), skip links pressed: ${activations.length}`, `primeiras ${stops.length} parada(s) de Tab, links de pular acionados: ${activations.length}`)),
          status: coverageStatus(0, review.length),
          applicable,
          failures: 0,
          review: review.length,
          unmatched,
          ...(notes.length > 0 ? { note: notes.join('; ') } : {}),
          maturity: 'experimental',
        },
      ],
      // axe-core's bypass can only pass or leave the page undecided; this rule's result on the page replaces it.
      resolved: [{ engineRule: 'bypass', ref: ctx.snapshot.root.ref }],
    }
  },
}

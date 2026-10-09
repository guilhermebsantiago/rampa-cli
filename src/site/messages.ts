import type { Locale } from '../i18n.ts'

/** Words of the site criteria, their findings and their section of the site report. */
const messages = {
  en: {
    navigation: 'The navigation',
    banner: 'The header links',
    contentinfo: 'The footer links',
    navOrder: '{subject} {named} lists {items} in a different relative order on {pages} than on {others}.',
    navOrderTie: '{subject} {named} lists {items} in one relative order on some pages of the set and in another on the rest ({pages}).',
    navFix: 'Keep repeated navigation in the same relative order on every page of the set (F66); links may be added or left out.',
    reviewLowOverlap: 'Needs review: these blocks share few links, so they may not be the same component.',
    reviewHidden: 'Needs review: the block is hidden on some of these pages and shown on others.',
    reviewFewItems: 'Needs review: only two items, outside a navigation landmark.',
    contactDetails: 'The contact detail',
    humanContact: 'The contact link',
    selfHelp: 'The self-help link',
    chat: 'The chat widget',
    helpMoved: '{subject} {named} is {zoneA} on {pages}, and {zoneB} on {others}.',
    helpMovedTie: '{subject} {named} is {zoneA} on some pages of the set and {zoneB} on the others ({pages}).',
    helpOrder: '{subject} {named} changed place among {items} on {pages}, compared with {others}.',
    helpOrderTie: '{subject} {named} has a different place among {items} on {pages}.',
    helpFix: 'Help repeated on several pages must keep the same order relative to the rest of the page (3.2.6).',
    helpInMain: '{subject} {named} is in the page chrome on {others}, and only inside the main content on {pages}: check that it is the same help, in the same place.',
    reviewByName: 'Needs review: recognized as help by its text only.',
    'before-main': 'before the main content',
    'after-main': 'after the main content',
    unknown: 'outside the main content',
    order: 'Order on {pages}: {order}',
    zone: '{zone} on {pages}',
    andMore: 'and {count} more',
    otherPages: 'the other pages of the set',
    mainContent: '(main content)',
    sectionTitle: 'Across pages',
    sectionLine: 'Navigation (3.2.3) and help (3.2.6) compared between the pages of each set',
    setLine: 'Set {label}: {count} pages{lang}, {viewport}: {pages}',
    setConfig: '"{label}" (config)',
    setTemplate: 'template {n} (shared header, navigation and footer)',
    noSet: 'No set of two or more pages that share a header, navigation or footer: nothing to compare.',
    unassignedNoNav: 'No navigation found on: {pages}',
    unassignedAlone: 'In a set of their own: {pages}',
    review: 'Needs review',
    experimental: 'experimental',
    elementsOn: 'on {page}: {refs}',
    belowThreshold: '{count} finding(s) across pages from experimental checks are below the threshold (--verbose or --min-confidence low shows them).',
    reviewHidden2: '{count} item(s) need review (--verbose lists them).',
    coverageLabel: 'Compared across pages:',
    coverageRan: '{id} ({sets} set(s), {compared} compared)',
    coverageNothing: '{ids}: no set of two or more pages to compare',
    singlePage: 'Not checked on a single page: 3.2.3 Consistent Navigation and 3.2.6 Consistent Help compare the pages of a site; run with --crawl or --sitemap.',
  },
  'pt-BR': {
    navigation: 'A navegação',
    banner: 'Os links do cabeçalho',
    contentinfo: 'Os links do rodapé',
    navOrder: '{subject} {named} lista {items} em outra ordem relativa em {pages} do que em {others}.',
    navOrderTie: '{subject} {named} lista {items} em uma ordem relativa em algumas páginas do conjunto e em outra nas demais ({pages}).',
    navFix: 'Mantenha a navegação repetida na mesma ordem relativa em todas as páginas do conjunto (F66); links podem ser acrescentados ou omitidos.',
    reviewLowOverlap: 'Revisar: estes blocos têm poucos links em comum e podem não ser o mesmo componente.',
    reviewHidden: 'Revisar: o bloco está oculto em algumas destas páginas e visível em outras.',
    reviewFewItems: 'Revisar: só dois itens, fora de um landmark de navegação.',
    contactDetails: 'O contato',
    humanContact: 'O link de contato',
    selfHelp: 'O link de autoajuda',
    chat: 'O widget de chat',
    helpMoved: '{subject} {named} fica {zoneA} em {pages}, e {zoneB} em {others}.',
    helpMovedTie: '{subject} {named} fica {zoneA} em algumas páginas do conjunto e {zoneB} nas demais ({pages}).',
    helpOrder: '{subject} {named} mudou de lugar entre {items} em {pages}, em comparação com {others}.',
    helpOrderTie: '{subject} {named} tem outro lugar entre {items} em {pages}.',
    helpFix: 'Ajuda repetida em várias páginas deve manter a mesma ordem em relação ao resto da página (3.2.6).',
    helpInMain: '{subject} {named} fica na moldura da página em {others}, e só dentro do conteúdo principal em {pages}: confira se é a mesma ajuda, no mesmo lugar.',
    reviewByName: 'Revisar: reconhecido como ajuda só pelo texto.',
    'before-main': 'antes do conteúdo principal',
    'after-main': 'depois do conteúdo principal',
    unknown: 'fora do conteúdo principal',
    order: 'Ordem em {pages}: {order}',
    zone: '{zone} em {pages}',
    andMore: 'e mais {count}',
    otherPages: 'as outras páginas do conjunto',
    mainContent: '(conteúdo principal)',
    sectionTitle: 'Entre páginas',
    sectionLine: 'Navegação (3.2.3) e ajuda (3.2.6) comparadas entre as páginas de cada conjunto',
    setLine: 'Conjunto {label}: {count} páginas{lang}, {viewport}: {pages}',
    setConfig: '"{label}" (config)',
    setTemplate: 'modelo {n} (mesmo cabeçalho, navegação e rodapé)',
    noSet: 'Nenhum conjunto de duas ou mais páginas com cabeçalho, navegação ou rodapé em comum: nada a comparar.',
    unassignedNoNav: 'Sem navegação encontrada em: {pages}',
    unassignedAlone: 'Num conjunto só seu: {pages}',
    review: 'Revisar',
    experimental: 'experimental',
    elementsOn: 'em {page}: {refs}',
    belowThreshold: '{count} achado(s) entre páginas, de verificações experimentais, abaixo do limiar (--verbose ou --min-confidence low mostra).',
    reviewHidden2: '{count} item(ns) a revisar (--verbose lista).',
    coverageLabel: 'Comparado entre páginas:',
    coverageRan: '{id} ({sets} conjunto(s), {compared} comparado(s))',
    coverageNothing: '{ids}: nenhum conjunto de duas ou mais páginas para comparar',
    singlePage: 'Não verificados numa página isolada: 3.2.3 Navegação consistente e 3.2.6 Ajuda consistente comparam as páginas de um site; rode com --crawl ou --sitemap.',
  },
} as const

export type SiteMessage = keyof (typeof messages)['en']

export function sm(locale: Locale, key: SiteMessage, vars: Record<string, string | number> = {}): string {
  const template: string = messages[locale]?.[key] ?? messages.en[key]
  return template.replace(/\{(\w+)\}/g, (_, name: string) => String(vars[name] ?? `{${name}}`))
}

/** A page's path, enough to tell pages of one site apart. */
export function pathOf(url: string): string {
  try {
    const parsed = new URL(url)
    return `${parsed.pathname}${parsed.search}` || '/'
  } catch {
    return url
  }
}

const MAX_PAGES = 5
const MAX_ITEMS = 8

export function listPages(pages: readonly string[], locale: Locale): string {
  const paths = pages.map(pathOf)
  if (paths.length <= MAX_PAGES) return paths.join(', ')
  return `${paths.slice(0, MAX_PAGES - 1).join(', ')} ${sm(locale, 'andMore', { count: paths.length - (MAX_PAGES - 1) })}`
}

export function listItems(names: readonly string[], locale: Locale, separator = ', '): string {
  const quoted = names.map((name) => `“${name}”`)
  if (quoted.length <= MAX_ITEMS) return quoted.join(separator)
  return `${quoted.slice(0, MAX_ITEMS - 1).join(separator)} ${sm(locale, 'andMore', { count: quoted.length - (MAX_ITEMS - 1) })}`
}

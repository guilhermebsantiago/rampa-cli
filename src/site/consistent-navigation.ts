import type { PageSet, SiteCriterion, SiteElement, SiteFinding, SitePageFacts } from '../core/site.ts'
import type { Confidence } from '../core/types.ts'
import { normalizeForMatch, sha256 } from '../core/util.ts'
import type { Locale } from '../i18n.ts'
import { listItems, listPages, sm } from './messages.ts'
import { type Observation, compareOrders, involvedKeys, ordersObserved, repeatedKeys } from './order.ts'
import { type Component, navigationComponents } from './page.ts'

export interface NavigationFacts {
  components: Component[]
}

/** A block is matched with a block of another page when this share of the smaller one's links is in it. */
const MATCH = 0.5
/** Below this, an inversion between two matched blocks is only needs review. */
const CLEAR_MATCH = 0.75

interface Member {
  page: string
  component: Component
  /** How well it matched the group when it joined: shared links over the smaller block. */
  ratio: number
}

interface Group {
  kind: Component['kind']
  members: Member[]
  links: Set<string>
}

/**
 * The same navigation block on different pages: each block joins the group of
 * the same kind it shares the most links with, one block per page and group.
 */
export function matchComponents(pages: ReadonlyArray<SitePageFacts<NavigationFacts>>): Group[] {
  const groups: Group[] = []
  for (const page of pages) {
    const components = page.facts.components.filter((component) => new Set(component.items.map((item) => item.key)).size >= 2)
    const options: Array<{ component: number; group: number; shared: number; ratio: number; alike: number }> = []
    components.forEach((component, componentIndex) => {
      const keys = new Set(component.items.map((item) => item.key))
      groups.forEach((group, groupIndex) => {
        if (group.kind !== component.kind) return
        const shared = [...keys].filter((key) => group.links.has(key)).length
        const ratio = shared / Math.max(1, Math.min(keys.size, group.links.size))
        // A desktop menu and its hidden mobile twin share every link: the label and the visibility tell them apart.
        const first = (group.members[0] as Member).component
        const alike = Number(first.name === component.name) + Number(first.hidden === component.hidden)
        if (shared >= 2 && ratio >= MATCH) options.push({ component: componentIndex, group: groupIndex, shared, ratio, alike })
      })
    })
    options.sort((a, b) => b.shared - a.shared || b.alike - a.alike || b.ratio - a.ratio || a.component - b.component || a.group - b.group)
    const usedComponents = new Set<number>()
    const usedGroups = new Set<number>()
    for (const option of options) {
      if (usedComponents.has(option.component) || usedGroups.has(option.group)) continue
      usedComponents.add(option.component)
      usedGroups.add(option.group)
      const group = groups[option.group] as Group
      const component = components[option.component] as Component
      group.members.push({ page: page.url, component, ratio: option.ratio })
      for (const item of component.items) group.links.add(item.key)
    }
    components.forEach((component, index) => {
      if (usedComponents.has(index)) return
      groups.push({ kind: component.kind, members: [{ page: page.url, component, ratio: 1 }], links: new Set(component.items.map((item) => item.key)) })
    })
  }
  return groups
}

/** WCAG 3.2.3: navigation repeated on pages of a set keeps its relative order (F66). */
export const consistentNavigation: SiteCriterion<NavigationFacts> = {
  id: '3.2.3',
  level: 'AA',
  name: { en: 'Consistent Navigation', 'pt-BR': 'Navegação consistente' },
  version: '1',
  maturity: 'experimental',
  facts: (snapshot) => ({ components: navigationComponents(snapshot) }),
  compare(set, pages, locale) {
    const findings: SiteFinding[] = []
    let compared = 0
    for (const group of matchComponents(pages)) {
      if (group.members.length < 2) continue
      compared++
      const finding = compareGroup(group, set, locale)
      if (finding) findings.push(finding)
    }
    return { compared, findings }
  },
}

function compareGroup(group: Group, set: PageSet, locale: Locale): SiteFinding | undefined {
  const orders = group.members.map((member) => member.component.items.map((item) => item.key))
  const repeated = repeatedKeys(orders)
  const observations: Observation[] = group.members.map((member, index) => ({
    page: member.page,
    order: (orders[index] as string[]).filter((key) => !repeated.has(key)),
  }))
  const comparison = compareOrders(observations)
  if (comparison.inverted.length === 0) return undefined

  const names = new Map<string, string>()
  const refs = new Map<string, Map<string, string>>()
  for (const member of group.members) {
    const byKey = new Map<string, string>()
    for (const item of member.component.items) {
      if (!names.has(item.key)) names.set(item.key, item.name)
      if (!byKey.has(item.key)) byKey.set(item.key, item.ref)
    }
    refs.set(member.page, byKey)
  }
  const keys = involvedKeys(comparison, observations)
  const tie = comparison.deviants.length === 0
  const flagged = tie ? [...new Set(comparison.ties.flatMap((pair) => [...pair.aFirst, ...pair.bFirst]))] : comparison.deviants
  const others = group.members.map((member) => member.page).filter((page) => !flagged.includes(page))
  const flaggedMembers = group.members.filter((member) => flagged.includes(member.page))
  const first = group.members[0] as Member

  const reasons: string[] = []
  if (flaggedMembers.some((member) => member.ratio < CLEAR_MATCH)) reasons.push(sm(locale, 'reviewLowOverlap'))
  if (new Set(group.members.filter((m) => flagged.includes(m.page) || others.includes(m.page)).map((m) => m.component.hidden)).size > 1) {
    reasons.push(sm(locale, 'reviewHidden'))
  }
  if (group.kind !== 'navigation' && keys.length <= 2) reasons.push(sm(locale, 'reviewFewItems'))
  const status = reasons.length > 0 ? 'review' : 'failure'
  const confidence: Confidence = group.kind === 'navigation' && !tie ? 'high' : 'medium'

  const subject = sm(locale, group.kind)
  const named = describeComponent(first.component)
  const itemNames = keys.map((key) => names.get(key) ?? key)
  const message = [
    tie
      ? sm(locale, 'navOrderTie', { subject, named, items: listItems(itemNames, locale), pages: listPages(flagged, locale) })
      : sm(locale, 'navOrder', {
          subject,
          named,
          items: listItems(itemNames, locale),
          pages: listPages(flagged, locale),
          others: others.length > 0 ? listPages(others, locale) : sm(locale, 'otherPages'),
        }),
    ...(status === 'failure' ? [sm(locale, 'navFix')] : reasons),
  ].join(' ')

  const observed = ordersObserved(observations, keys).map((entry) => ({ pages: entry.pages, order: entry.order.map((key) => names.get(key) ?? key) }))
  const evidence = observed.map((entry) => sm(locale, 'order', { pages: listPages(entry.pages, locale), order: entry.order.join(' → ') })).join(' · ')

  const elements: SiteElement[] = []
  const cite = (member: Member) => {
    elements.push({ page: member.page, ref: member.component.ref, name: member.component.name || undefined })
    for (const key of keys) {
      const ref = refs.get(member.page)?.get(key)
      if (ref) elements.push({ page: member.page, ref, name: names.get(key) })
    }
  }
  for (const member of flaggedMembers.slice(0, 3)) cite(member)
  const reference = group.members.find((member) => others.includes(member.page))
  if (reference) cite(reference)

  return {
    fingerprint: sha256(['3.2.3', group.kind, normalizeForMatch(first.component.name), [...keys].sort().join('\u0001')].join('|')).slice(0, 12),
    criterion: '3.2.3',
    level: 'AA',
    source: 'site',
    status,
    set: set.id,
    subject: `${subject} ${named}`.trim(),
    message,
    evidence,
    pages: flagged,
    comparedWith: others,
    items: itemNames,
    elements: elements.slice(0, 24),
    observed,
    confidence,
    experimental: consistentNavigation.maturity === 'experimental',
  }
}

/** `"Main"` by its label, or by its first links when it has none. */
function describeComponent(component: Component): string {
  if (component.name) return `“${component.name}”`
  const first = component.items.slice(0, 3).map((item) => item.name)
  return `(${first.join(', ')}${component.items.length > 3 ? ', …' : ''})`
}

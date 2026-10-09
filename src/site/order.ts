/**
 * Relative order across pages, as WCAG 3.2.3 and 3.2.6 mean it: items that
 * repeat must keep their order with respect to each other. Items added on one
 * page or missing from another do not matter (F66 allows them); only pairs of
 * items found on the same pages are compared.
 */

export interface Observation {
  page: string
  /** Keys in the order the page presents them; each key once. */
  order: readonly string[]
}

export interface InvertedPair {
  a: string
  b: string
  /** Pages where a comes before b. */
  aFirst: string[]
  /** Pages where b comes before a. */
  bFirst: string[]
}

export interface OrderComparison {
  inverted: InvertedPair[]
  /** Pages in the minority for at least one pair: the pages whose order differs from the rest. */
  deviants: string[]
  /** Pairs with as many pages one way as the other, where no page can be called the odd one out. */
  ties: InvertedPair[]
  /** For each page, the pairs it was compared on and how many of those it has in the minority order. */
  perPage: Map<string, { compared: number; minority: number }>
}

/**
 * Compares every pair of keys that two or more pages share; with `focus`, only
 * pairs that include a focused key (a help mechanism against the rest of the page).
 */
export function compareOrders(observations: readonly Observation[], focus?: ReadonlySet<string>): OrderComparison {
  const positions = observations.map((observation) => new Map(observation.order.map((key, index) => [key, index])))
  const counts = new Map<string, number>()
  for (const observation of observations) for (const key of observation.order) counts.set(key, (counts.get(key) ?? 0) + 1)
  const keys = [...counts.keys()].filter((key) => (counts.get(key) ?? 0) >= 2)
  const inverted: InvertedPair[] = []
  const perPage = new Map<string, { compared: number; minority: number }>(observations.map((o) => [o.page, { compared: 0, minority: 0 }]))
  const deviants = new Set<string>()
  const ties: InvertedPair[] = []

  for (let i = 0; i < keys.length; i++) {
    for (let j = i + 1; j < keys.length; j++) {
      const a = keys[i] as string
      const b = keys[j] as string
      if (focus && !focus.has(a) && !focus.has(b)) continue
      const aFirst: string[] = []
      const bFirst: string[] = []
      positions.forEach((position, index) => {
        const pa = position.get(a)
        const pb = position.get(b)
        if (pa === undefined || pb === undefined) return
        const page = (observations[index] as Observation).page
        ;(pa < pb ? aFirst : bFirst).push(page)
      })
      if (aFirst.length + bFirst.length < 2) continue
      const minority = aFirst.length === bFirst.length ? [] : aFirst.length < bFirst.length ? aFirst : bFirst
      for (const page of [...aFirst, ...bFirst]) {
        const tally = perPage.get(page)
        if (!tally) continue
        tally.compared++
        if (minority.includes(page)) tally.minority++
      }
      if (aFirst.length === 0 || bFirst.length === 0) continue
      const pair = { a, b, aFirst, bFirst }
      inverted.push(pair)
      if (minority.length === 0) ties.push(pair)
      for (const page of minority) deviants.add(page)
    }
  }
  const pageOrder = observations.map((observation) => observation.page)
  return { inverted, deviants: pageOrder.filter((page) => deviants.has(page)), ties, perPage }
}

/** Keys in any inverted pair, in the order the first page that has them lists them. */
export function involvedKeys(comparison: OrderComparison, observations: readonly Observation[]): string[] {
  const involved = new Set(comparison.inverted.flatMap((pair) => [pair.a, pair.b]))
  const ordered: string[] = []
  for (const observation of observations) for (const key of observation.order) if (involved.has(key) && !ordered.includes(key)) ordered.push(key)
  return ordered
}

/** Pages grouped by the order they give the keys, the most common order first. */
export function ordersObserved(observations: readonly Observation[], keys: readonly string[]): Array<{ pages: string[]; order: string[] }> {
  const wanted = new Set(keys)
  const groups = new Map<string, { pages: string[]; order: string[] }>()
  for (const observation of observations) {
    const order = observation.order.filter((key) => wanted.has(key))
    if (order.length < 2) continue
    const id = order.join('\u0000')
    const group = groups.get(id) ?? { pages: [], order }
    group.pages.push(observation.page)
    groups.set(id, group)
  }
  return [...groups.values()].sort((a, b) => b.pages.length - a.pages.length)
}

/** Keys that occur more than once in any one order: which of their places counts is ambiguous, so they are left out. */
export function repeatedKeys(orders: ReadonlyArray<readonly string[]>): Set<string> {
  const repeated = new Set<string>()
  for (const order of orders) {
    const seen = new Set<string>()
    for (const key of order) {
      if (seen.has(key)) repeated.add(key)
      seen.add(key)
    }
  }
  return repeated
}

/** A page a crawl read, with its title: what 2.4.2 compares a page's title with. */
export interface Sibling {
  url: string
  title: string
}

/** Titles given to the prompt at most; the closest pages by address come first. */
const MAX_SIBLINGS = 10

/**
 * The other pages of a crawl for one page: those whose address shares the longest leading path with it first, then
 * in address order, so the same set of pages gives the same list. Which pages are in the set depends on what the
 * crawl had read when the page was judged.
 */
export function siblingsOf(url: string, pages: readonly Sibling[]): Sibling[] {
  const segments = (address: string) => {
    try {
      return new URL(address).pathname.split('/').filter(Boolean)
    } catch {
      return address.split('/').filter(Boolean)
    }
  }
  const own = segments(url)
  const shared = (address: string) => {
    const other = segments(address)
    let count = 0
    while (count < own.length && count < other.length && own[count] === other[count]) count++
    return count
  }
  return pages
    .filter((page) => page.url !== url)
    .map((page) => ({ page, shared: shared(page.url) }))
    .sort((a, b) => b.shared - a.shared || a.page.url.localeCompare(b.page.url))
    .slice(0, MAX_SIBLINGS)
    .map(({ page }) => page)
}

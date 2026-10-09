import { Option } from 'commander'
import { LOAD_STATES } from '../surfaces/browser-options.ts'
import { DEFAULT_CRAWL_CONCURRENCY, DEFAULT_MAX_PAGES } from '../surfaces/crawl.ts'

const repeat = (value: string, previous: string[] | undefined): string[] => [...(previous ?? []), value]

/** `rampa check --crawl` and its limits; docs/crawl.md has the details. */
export function crawlOptions(): Option[] {
  return [
    new Option('--crawl', 'check the pages the URL links to on the same origin, as one site'),
    new Option('--sitemap [url]', 'take the pages from a sitemap instead of following links (default: robots.txt, then /sitemap.xml)'),
    new Option('--max-pages <n>', `pages to load per site (default: ${DEFAULT_MAX_PAGES})`),
    new Option('--max-depth <n>', 'links to follow away from the start page (default: no limit)'),
    new Option('--include <pattern>', 'only pages whose path matches, in robots.txt syntax (repeatable)').argParser(repeat),
    new Option('--exclude <pattern>', 'skip pages whose path matches, in robots.txt syntax (repeatable)').argParser(repeat),
    new Option('--ignore-query', 'addresses that differ only in the query are one page'),
    new Option('--crawl-concurrency <n>', `pages loaded at the same time (default: ${DEFAULT_CRAWL_CONCURRENCY})`),
  ].map((option) => option.helpGroup('Crawl options (docs/crawl.md):'))
}

/** How pages open in any web check: session, emulation and waits; docs/browser-options.md has the details. */
export function browserOptions(): Option[] {
  return [
    new Option('--storage-state <file>', 'signed-in session saved by Playwright (cookies and localStorage)'),
    new Option('--header <header>', '"Name: value" sent to the site checked, never to third parties (repeatable)').argParser(repeat),
    new Option('--cookie <cookie>', 'name=value set on the site checked (repeatable)').argParser(repeat),
    new Option('--viewport <size>', 'width x height in CSS pixels, such as 390x844 (default: 1280x800)'),
    new Option('--device <name>', 'emulate a Playwright device, such as "iPhone 13" or "Pixel 7"'),
    new Option('--color-scheme <scheme>', 'emulate prefers-color-scheme').choices(['light', 'dark']),
    new Option('--reduced-motion', 'emulate prefers-reduced-motion: reduce'),
    new Option('--browser-locale <bcp47>', 'browser language (navigator.language, Accept-Language), such as pt-BR'),
    new Option('--wait-for <condition>', `before collecting: ${LOAD_STATES.join(', ')}, a visible selector, or milliseconds (repeatable)`).argParser(repeat),
    new Option('--timeout <ms>', 'limit for loading a page and for each --wait-for (default: 30000)'),
    new Option('--user-agent <ua>', 'user agent string'),
  ].map((option) => option.helpGroup('Browser options (docs/browser-options.md):'))
}

# Checking a whole site

`rampa check <url> --crawl` checks the pages a site links to, not just one. Each page goes through the same engine and judgment as a single check; the report then shows, once, the findings that repeat across pages (a header or footer flagged everywhere is one problem to fix in one component), then what is particular to each page, what was not checked, and the coverage of the whole run.

```sh
rampa check https://example.com --crawl                         # follow links, up to 10 pages
rampa check https://example.com --crawl --max-pages 50 --max-depth 2
rampa check https://example.com --sitemap                       # the pages the sitemap lists
rampa check https://example.com --sitemap /sitemap_index.xml --include /blog/
rampa check https://example.com --crawl --exclude /admin --exclude logout --ignore-query
rampa check https://example.com --crawl --no-llm --format json -o site.json
```

Everything in [browser options](browser-options.md) works during a crawl too: sign in with `--storage-state`, crawl as a phone with `--device "iPhone 13"`, in dark mode with `--color-scheme dark`.

## Options

| Option | Default | Effect |
| --- | --- | --- |
| `--crawl` | | Follow links from each URL given, on the same origin, and report the pages as one site |
| `--sitemap [url]` | | Take the pages from a sitemap instead of following links; implies `--crawl` |
| `--max-pages <n>` | `10` | Pages loaded per site, at most |
| `--max-depth <n>` | no limit | Links followed away from a start page; `0` checks only the URLs given |
| `--include <pattern>` | | Follow only pages whose path matches; repeatable |
| `--exclude <pattern>` | | Never load pages whose path matches; repeatable, and it wins over `--include` |
| `--ignore-query` | | Addresses that differ only in their query string are one page |
| `--crawl-concurrency <n>` | `2` | Pages loading at the same time |

The crawl options need `--crawl` or `--sitemap`; given alone, they stop the run with exit code 2 so a forgotten `--crawl` does not go unnoticed.

## How pages are found

**Following links** (the default). Rampa loads each URL given, reads every `<a href>` and `<area href>` of the page as rendered (so links a script adds count), and queues the ones on the same origin: the same scheme, host and port. Pages are visited breadth first, so the pages one link away from the start come before the pages two links away. Links to `mailto:`, `tel:`, `javascript:` and other origins are ignored, and so are links to files (PDF, images, archives, office documents, feeds, scripts and the like), which are never requested.

**From a sitemap** (`--sitemap`). Rampa reads the sitemap you name (a URL, or a path on the site such as `/sitemap_index.xml`), or else the `Sitemap:` lines of robots.txt, or else `/sitemap.xml`. It follows sitemap indexes, reads gzipped (`.xml.gz`) and plain-text sitemaps, and ignores the entries of the image and video extensions, which are files rather than pages. It reads at most 20 sitemap files. With `--sitemap`, links are not followed and `--max-depth` does not apply. If no sitemap can be read, the run stops with exit code 2.

**The URLs you give are always checked**, unless robots.txt disallows them. `--include` and `--exclude` filter only the pages the crawl finds. A start page that redirects to its `www.` twin or from http to https moves the site there; one that redirects to another host, such as a login provider, is reported and not followed. That is also what an expired session looks like: see [signed-in pages](browser-options.md#signed-in-pages).

### One page, once

An address is reduced to a key before it is queued, so the same page is not checked twice:

- the fragment goes: `/about#team` is `/about`;
- a trailing slash goes, except the root's: `/about/` is `/about`;
- with `--ignore-query`, the query goes: `/blog?page=2` is `/blog` (the first one found is the one checked).

A page that redirects to a page already checked is dropped without a word. Pages that answer with an HTTP error (4xx or 5xx) or with something other than HTML are listed under "Not checked" with the reason and the page that links to them.

### What --max-pages counts

Every page Rampa loads counts, including the ones that turn out to be errors, files served without an extension or redirects to a page already checked. Pages that are never requested do not count: the ones robots.txt disallows, the ones `--include` or `--exclude` leave out, links to files and links to other origins. When the limit stops the crawl, the report says how many pages it found and did not load.

With `--crawl-concurrency 1` the order of a crawl is fixed. With two or more pages loading at once, a page two links away can be queued before another one, so which pages fit under `--max-pages` can change between runs when the limit cuts through the second level or deeper.

### --include and --exclude

Patterns use robots.txt syntax and match the path and query of the address:

| Pattern | Matches |
| --- | --- |
| `/blog` | anything that starts with `/blog`: `/blog`, `/blog/post`, also `/blogger` |
| `/blog/` | pages under `/blog/` only |
| `/*.html$` | paths that end in `.html`, with no query |
| `/docs/*/old` | `/docs/v1/old`, `/docs/v2/beta/old/page` |
| `logout` | a pattern without a leading `/` matches anywhere: `/account/logout?next=/` |
| `https://example.com/docs/` | the site's own address is read as its path |

A page outside the filters is never loaded, so the links on it are never followed. When a section is only reachable through pages you exclude, `--sitemap` gives the crawl the full list.

In Git Bash on Windows, an argument that starts with `/` is turned into a Windows path before Rampa sees it (`/blog/` arrives as `C:/Program Files/Git/blog/`), and the pattern would match nothing. Rampa stops with a message instead. Run the command with `MSYS_NO_PATHCONV=1` in front, or start the pattern with `*` (`--include "*/blog/"`). PowerShell, cmd and the shells of Linux and macOS pass patterns as they are.

## robots.txt

Rampa reads `/robots.txt` before it loads any page of a site and follows it as [RFC 9309](https://www.rfc-editor.org/rfc/rfc9309) specifies. Its product token is `Rampa`:

- It follows the group for `User-agent: Rampa` when the file has one, and the group for `User-agent: *` otherwise. Several groups for the same agent are combined.
- The longest matching rule decides; when an `Allow` and a `Disallow` match with the same length, `Allow` wins. `*` matches anything and a final `$` anchors the end of the path. Rules match the path and the query.
- No robots.txt (a 4xx answer) means no rules. A robots.txt that cannot be read (a 5xx or 429 answer, or a network error) means nothing is crawled, and the report says so.
- `Crawl-delay` in the chosen group is honored: page loads start at least that many seconds apart, whatever `--crawl-concurrency` says.

A site that keeps every crawler out, a staging site for instance, can let Rampa in, and keep it out of a part of the site:

```
User-agent: *
Disallow: /

User-agent: Rampa
Allow: /
Disallow: /admin/
```

robots.txt governs crawling. A single page you name without `--crawl` is checked without reading it, as a browser would open it. Within a crawl, the browser follows redirects on its own, so a page whose redirect lands on an address robots.txt disallows has already been requested when Rampa sees where it landed; that page is not checked and is listed as disallowed.

## The site report

```
Site https://example.com · 6 page(s) checked
Surface: web · axe-core 4.14.0
Crawl: links from / · up to 10 pages · robots.txt: rules for every crawler

On several pages, most likely a shared component: fix it once

WCAG 1.1.1 (A) — Non-text Content
  ✗ html > body > header > a > img
    Images must have alternative text
    high · rule image-alt
    on 6 of 6 pages: /, /about, /pricing/, /blog, /blog/post-1, /blog?page=2

WCAG 2.4.4 (A) — Link Purpose (In Context)
  ✗ html > body > header > a
    Links must have discernible text
    high · rule link-name
    on 6 of 6 pages: /, /about, /pricing/, /blog, /blog/post-1, /blog?page=2

Page by page
/about
  WCAG 1.1.1 (A) — Non-text Content
    ✗ html > body > main > img
      Images must have alternative text
      high · rule image-alt

Nothing found only on: /, /pricing/, /blog, /blog/post-1, /blog?page=2

Not checked
  /private/secret  robots.txt disallows it · linked from /
  /members         HTTP 401 · linked from /
  /broken          HTTP 404 · linked from /blog
```

The coverage block that closes the report joins what was checked on any page, adds how many pages were checked of the ones found, and states that the report does not declare the site accessible.

### When two findings are the same

Two findings on different pages are reported once when they share the criterion, the rule, the element and the message. The element is its start tag and its accessible name or text. Attributes that change from page to page on the same component are left out of the start tag: `id`, `class`, `style`, `data-*`, `aria-current`, `aria-expanded`, `aria-selected`, `aria-pressed`, `aria-checked`, and the attributes that point at ids (`for`, `aria-labelledby`, `aria-describedby`, `aria-controls` and the like). Addresses in `href`, `src` and the like are resolved against the page, so `img/logo.png` on `/about` and `../img/logo.png` on `/docs/start` are the same image, while an in-page link such as `#main` stays as it is. So the menu link marked `aria-current="page"` on its own page is the same link everywhere, and the CSS path of the element can differ from page to page. For a finding about the whole page, such as its language, the message tells pages apart, not the page's text.

A finding on one page only, even one that repeats within that page, stays under "Page by page".

In the terminal, engine findings with the same rule, message and pages are printed as one block that lists their elements (the first ten), so a template with twenty images without a text alternative reads as one problem with twenty places to fix. The JSON keeps one entry per element.

### The judgment cache across pages

Pages load in parallel, but they are judged one at a time, in turn. The judgment cache is keyed by the prompt, the image, the model and its settings, so when a later page asks the same question (the same header link in the same context, the same logo as rendered), the answer comes from the cache and the model is not called again. The usage line says how many judgments that saved. On the six-page test site of `test/crawl-site.test.ts`, judging 2.4.4 with a stand-in model, the six menu links of the shared header were asked about once:

```
Model calls: 14 new, 33 from cache · 4.7k in / 0.9k out tokens · 33 reused from an earlier page with the same input
```

The same crawl with `--model ollama:gemma4:12b` made the same 14 calls and reused 33.

Only identical inputs are reused. A page title (2.4.2) is judged with the page's address, so it is asked once per page; a heading is judged with the content under it; and pages in different languages rarely share an input, because the prompt names the language to answer in. Cached judgments from earlier runs count as "from cache" but not as reused, unless the same input also came up on an earlier page of this run.

## Criteria across pages

A crawl also compares its pages with each other for 3.2.3 Consistent Navigation and 3.2.6 Consistent Help: whether repeated navigation and help keep their relative order from page to page. The site report shows the sets of pages it compared and what changed order; [site-criteria.md](site-criteria.md) has the details, and `siteCriteria` holds them in the JSON.

## JSON

`--format json` (or `-o file.json`) writes one object per site; with URLs on several origins, an array of them.

| Key | What it holds |
| --- | --- |
| `kind` | `"site"` |
| `site`, `start` | The origin crawled, and each URL given with where it led |
| `crawl` | Mode (`links` or `sitemap`), limits, filters, the robots.txt status and group, the sitemaps read |
| `browser` | What the browser emulated. Header and cookie names are recorded, never their values |
| `notChecked` | Pages found and not checked, each with a `reason` (`robots`, `http`, `not-html`, `off-site`, `error`), a `detail` and the page that links to it |
| `notLoaded`, `beyondDepth` | Pages found and never loaded, and how many of them were beyond `--max-depth` |
| `summary.repeated` | Each repeated finding once, with its `pages`, its `occurrences` (indexes into `pages` and into that page's `findings`) and the `fingerprints` to waive it everywhere |
| `summary.pageSpecific` | For each page, the indexes of its findings that are not in a repeated group |
| `summary.usage` | Model calls and tokens of the whole crawl, and `reusedAcrossPages` |
| `summary.coverage` | Criteria covered on at least one page |
| `pages` | The full report of every page, the same object `rampa check` writes for a single page |

`--save <dir>` records the snapshot and engine results of every page, and `--screenshots` saves every page, as they do for a single check.

## Exit codes

The same as a check: `0` when no page has a confirmed failure, `1` when one does (`--fail-on` applies as usual), and `2` when the run could not do its job: no page of a site could be checked, a sitemap you asked for could not be read, a flag was wrong, or the model failed on every candidate of a criterion.

## Limits

- One origin is one site. `www.example.com` and `blog.example.com` are separate sites; pass both URLs to check both, each with its own report.
- Only links in `href` are followed. Navigation done by click handlers, forms and frames is not.
- A page that answers 200 with a "not found" message is checked like any page.
- Rampa does not click, type or submit anything, and it is not a security scanner.

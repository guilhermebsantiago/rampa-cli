# Criteria across pages: 3.2.3 and 3.2.6

Two WCAG criteria cannot be checked on one page, because they are about what stays the same from page to page:

- **3.2.3 Consistent Navigation (AA).** Navigation repeated on several pages of a set keeps the same relative order.
- **3.2.6 Consistent Help (A, new in WCAG 2.2).** Help repeated on several pages of a set (contact details, a way to reach a person, self-help, a chat) keeps the same order relative to the rest of the page.

With `--crawl` or `--sitemap`, Rampa compares the pages it checked, and the site report gets an "Across pages" section. No model is involved: these are rules over the snapshots, and a saved snapshot gives the same result. A single-page check cannot compare anything, so its report says so in a note: "Not checked on a single page: 3.2.3 Consistent Navigation and 3.2.6 Consistent Help compare the pages of a site; crawl its address with --crawl or --sitemap."

```sh
rampa check https://example.com --crawl --no-llm --max-pages 30
rampa check https://example.com --crawl --no-llm --verbose     # also the experimental findings and the items to review
rampa check https://example.com --sitemap --min-confidence low  # experimental findings as failures, in the exit code
```

They run on every crawl, whatever `--criteria` says: that option picks the judgment modules, and these two need no model. A folder of `.html` files is checked page by page, not as a site; serve it and crawl its address to compare its pages.

Both checks are **experimental**. Their findings sit below the default confidence threshold, as every new check does until it passes the evaluation gate (section 4.9 of the [coverage plan](plans/wcag-coverage.md)). The report counts them and `--verbose` shows them. `--min-confidence low` reports them as failures, and then they count in the exit code.

## Sets of pages

WCAG applies both criteria to a "set of web pages", and leaves it to the author to say which pages form one. Rampa does not decide that by itself (see section 6 of the plan). It proposes sets, and the report lists them so you can check them:

1. **Sets you name.** `pageSets` in the config maps a name to path patterns, in the same robots.txt syntax as `--include`: a prefix, `*` for anything, `$` for the end. A page goes to the first set whose patterns match it.

   A value that is not a name with a list of patterns stops the run before any page is loaded; a single pattern may be a string.

   ```json
   {
     "pageSets": {
       "docs": ["/docs/"],
       "store": ["/shop/", "/cart$", "/checkout"]
     }
   }
   ```

2. **Sets proposed from templates.** The other pages are grouped by language (the primary subtag of `<html lang>`) and by viewport. Within a group, two pages share a template when at least two links, and at least 60% of the links in the smaller page's header, navigation and footer, are also in the other page's. Shared templates are chained, so a docs page with an extra sidebar stays in the set of the home page whose header it shares. Language versions, such as `/` and `/pt/`, are always separate sets.

Pages with no navigation landmark, header or footer links are listed as "No navigation found", and pages that share a template with no other page, or that are alone in a set you named, as "In a set of their own". Neither is compared. A page is compared only once its own report exists: a page whose judgment failed is in no set.

## 3.2.3 Consistent Navigation

**What counts as navigation.** Each outermost `navigation` landmark (`<nav>` or `role="navigation"`), wherever it is on the page, a docs sidebar inside `<main>` included. Also the links of the page's header (`banner`) and footer (`contentinfo`) outside any navigation landmark, when there are two or more. A header or footer inside an `article` or `section` is not the page's.

**Items.** Links and buttons (and `menuitem` and `tab`) in document order. A link is known by where it leads, resolved against its page: `about` on `/docs/` and `/docs/about` elsewhere are one item, and so are `#how` on `/` and `/#how` on another page. A trailing slash does not matter. A button is known by its name. An address a block links to twice, such as a logo and a Home link both pointing to `/`, is left out of the comparison, because which of its two places counts is ambiguous.

**Matching blocks across pages.** A block on one page is the same component as a block on another when they are of the same kind and share at least two items and half of the smaller one's. Each page gives one block per component. When two blocks match equally well, the one with the same label and the same visibility wins, so a desktop menu is compared with the desktop menu and its hidden mobile twin with the mobile twin.

**Relative order.** For every pair of items that two or more pages of the set share, Rampa counts the pages where one comes first and the pages where the other does. Items added on some pages or missing from others are allowed, as F66 says; only pairs found on the same pages are compared. When the pages disagree on a pair, the pages in the minority are the ones named. When as many pages go one way as the other, such as two pages that disagree, no page can be called the odd one out, and all of them are named.

A finding names the component, the items whose order changed, the pages, the elements on each page (the block and its items, by ref) and the order observed:

```
WCAG 3.2.3 (AA) — Consistent Navigation
  ✗ The navigation “Main” · experimental
    The navigation “Main” lists “Docs”, “Pricing” in a different relative order on /pricing than on /, /docs/, /blog, /contact and 3 more. Keep repeated navigation in the same relative order on every page of the set (F66); links may be added or left out.
    Order on /, /docs/, /blog, /contact and 3 more: Docs → Pricing
    Order on /pricing: Pricing → Docs
    on /pricing: html > body > header > nav · html > body > header > nav > ul > li:nth-of-type(3) > a · html > body > header > nav > ul > li:nth-of-type(2) > a
    on /: html > body > header > nav · html > body > header > nav > ul > li:nth-of-type(2) > a · html > body > header > nav > ul > li:nth-of-type(3) > a
    id 0cea0af775c5
```

**Needs review instead of a failure** when:

- the blocks share less than 75% of the smaller one's items, so they may not be the same component;
- the block is hidden on some of the pages compared and shown on others;
- the block is a header or footer link group, not a navigation landmark, and only two items changed order.

## 3.2.6 Consistent Help

**Help mechanisms recognized.**

| WCAG's kind | Recognized by | Certain |
| --- | --- | --- |
| Human contact details | `mailto:`, `tel:` and `sms:` links | yes |
| Human contact mechanism | `wa.me`, `api.whatsapp.com`, `whatsapp:`, `m.me` and Messenger links; paths such as `/contact`, `/contato`, `/fale-conosco`, `/atendimento`, `/contacto` | yes |
| Self-help option | paths such as `/help`, `/ajuda`, `/ayuda`, `/support`, `/suporte`, `/faq`, `/perguntas-frequentes`; hosts such as `help.` and `suporte.` | yes |
| Fully automated contact mechanism | chat widgets from Intercom, Drift, Crisp, Tawk.to, Zendesk, HubSpot, LiveChat, Freshchat, Tidio, JivoChat, Olark, Chatwoot, Gorgias, Help Scout, Smartsupp, Userlike, Octadesk, Blip, Kommunicate and Landbot, by their ids, classes and frame addresses | yes |
| Any of the above | only the link text: "Contact us", "Fale conosco", "Help", "Ajuda", "FAQ", "Chat"… | no: needs review |

**A hidden copy.** When a link outside the main content is also in a hidden or off-screen copy, such as a collapsed mobile menu repeating the desktop one, the visible one gives the page's order and the copy is left out.

**Where help sits.** Each link, button or widget outside the main content is placed before or after the `main` landmark. On a page with no `main`, the header counts as before it and the footer as after it, and anything else is not compared for a move.

**What is a failure.**

- **It moved.** The same help mechanism is before the main content on some pages and after it on others (for example, the support e-mail in the footer everywhere, and in the header on one page). The pages where it is in the minority place are named.
- **It changed place among its neighbours.** Within the same part of the page, the help is out of order with at least half of the items repeated around it. When one other link moves past it, the help did not move: that is the other link's change, and 3.2.3 reports it.

```
WCAG 3.2.6 (A) — Consistent Help
  ✗ The contact detail “help@acme.test” (mailto:help@acme.test) · experimental
    The contact detail “help@acme.test” (mailto:help@acme.test) is before the main content on /pricing, and after the main content on /, /docs/, /blog, /contact and 3 more. Help repeated on several pages must keep the same order relative to the rest of the page (3.2.6).
    after the main content on /, /docs/, /blog, /contact and 3 more
    before the main content on /pricing
    on /: html > body > footer > ul > li:nth-of-type(2) > a
    on /pricing: html > body > header > a:nth-of-type(3)
    id ab7b39c0615d
```

**Needs review.** Help recognized only by its text; and help that is in the header or footer of some pages and only inside the main content of others, which may be a moved mechanism or just a mention in the text.

Missing help is not a failure: 3.2.6 does not require help on every page, only the same order where it repeats.

## JSON

The site report gets a `siteCriteria` object:

| Key | What it holds |
| --- | --- |
| `sets` | Each set: `id` (`config:<name>` or `template-<n>`), `label`, `source` (`config` or `template`), `lang`, `viewport` and its `pages` |
| `unassigned` | Pages in no set compared, with `reason`: `no-navigation` or `alone` |
| `criteria` | Per criterion: `version`, `maturity`, `setsCompared`, `compared` (components or help mechanisms found on two or more pages of a set), `findings`, `review` |
| `findings`, `belowThreshold` | Failures at or above `--min-confidence`, and the rest; experimental checks are always below it unless the threshold is `low` |
| `review` | Needs review: never a failure, never in the exit code |
| `waived` | Findings whose fingerprint is in the waivers file |

Each finding has `criterion`, `level`, `status` (`failure` or `review`), `set`, `subject`, `message`, `evidence` (the order observed, as text, one line per distinct order), `pages` (the pages named), `comparedWith`, `items`, `elements` (`page`, `ref`, `name`, `html`), `observed` (for each distinct order, its `pages` and the `order`), `confidence`, `experimental` and a `fingerprint`. The fingerprint is made of the criterion, the set (its name in the config, or the language and viewport of a proposed set), the component and the items, never the pages, so it stays the same when the crawl finds the problem from other pages, and the same problem in the English and the Portuguese pages are two findings; put it in the waivers file to waive the finding.

`summary.coverage.notChecked` no longer lists 3.2.3 once a set was compared, and the coverage block prints a line such as `Compared across pages: 3.2.3 (2 set(s), 10 compared); 3.2.6 (2 set(s), 0 compared)`.

## From saved snapshots, without a browser

The criteria read only the snapshots, so a crawl saved with `--save <dir>` can be compared again later, with other sets or after an update, through the API:

```ts
import { readdir } from 'node:fs/promises'
import { loadSnapshot, runSiteCriteria, siteFactsOf } from 'rampa'

const files = (await readdir('.rampa/crawl')).filter((file) => file.endsWith('.snapshot.json'))
const pages = await Promise.all(files.map(async (file) => siteFactsOf(await loadSnapshot(`.rampa/crawl/${file}`))))
const report = runSiteCriteria(pages, { origin: 'https://example.com', locale: 'en', minConfidence: 'low', pageSets: { docs: ['/docs/'] } })
```

Pages are compared in the order given, which is the crawl's order in a live run.

## Exit codes

A finding across pages counts like a page's finding: with the default `--fail-on confirmed`, only findings at or above the threshold make the exit code 1, which means none while the checks are experimental, unless `--min-confidence low`. `--fail-on any` also counts the ones below the threshold. Needs review never changes the exit code.

## Limits

- **Document order, not visual order.** Items are compared in DOM order, which is what a screen reader follows and what a menu shows when CSS does not reorder it. CSS `order`, `flex-direction: row-reverse` or absolute positioning can show another order on screen; that is not compared yet.
- **One viewport per crawl.** Pages are compared at the viewport they were crawled at. Run the crawl again with `--device "iPhone 13"` to compare the phone layout, where menus are often different.
- **Landmarks are needed.** A site that marks up its header, menu and footer with plain `div`s has no navigation Rampa can find; its pages are listed under "No navigation found".
- **A main landmark around the whole page.** When `<main>` wraps the header and the footer too, as some single-page apps do, nothing is outside it, and 3.2.6 has no header or footer to compare; navigation landmarks are still compared for 3.2.3.
- **Help that is not a link or a known widget** is not recognized: a phone number in plain text, a contact form, a chat widget from a vendor not on the list, or one that loads only after a consent banner or a delay.
- **Sets are a proposal.** A site may mean several sets where Rampa sees one template, or one set across two templates. Name the sets in the config when it matters.
- **A page cut short** by the collector's limit of elements loses what comes last, often its footer; what is missing is not compared.
- **What a crawl did not load** is not compared: pages beyond `--max-pages`, pages behind a sign-in without `--storage-state`, and states a person reaches by clicking.
- **Changes a person asked for** (3.2.3 and 3.2.6 both allow them, such as a reordered personal menu) look the same as any other change.
- **3.2.6 is a WCAG 2.2 criterion.** A report that targets WCAG 2.1 shows it, but it is beyond that target.

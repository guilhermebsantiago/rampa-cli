# Criteria across pages: 2.4.1, 2.4.2, 2.4.5, 3.2.3, 3.2.4 and 3.2.6

Some WCAG criteria cannot be decided on one page, because they are about what stays the same from page to page, or about how pages are found:

- **2.4.1 Bypass Blocks (A).** Blocks repeated on several pages (a header, a menu) can be passed to reach each page's own content.
- **2.4.2 Page Titled (A), across pages.** Titles tell pages apart: several pages with one title and different content need review. Each page's own title is checked on the page ([rules](rules.md), and the judged criterion).
- **2.4.5 Multiple Ways (AA).** More than one way to find a page of a set. Rampa lists the ways it found, for review; it never fails this criterion.
- **3.2.3 Consistent Navigation (AA).** Navigation repeated on several pages of a set keeps the same relative order.
- **3.2.4 Consistent Identification (AA).** Components with the same function on the pages of a set (search, sign-in, a cart, a language link, a newsletter form…) are identified the same way.
- **3.2.6 Consistent Help (A, new in WCAG 2.2).** Help repeated on several pages of a set (contact details, a way to reach a person, self-help, a chat) keeps the same order relative to the rest of the page.

With `--crawl` or `--sitemap`, Rampa compares the pages it checked, and the site report gets an "Across pages" section. These are rules over the snapshots, and a saved snapshot gives the same result. A model is asked only two narrow questions the rules leave open, three times each (see [Questions for a model](#questions-for-a-model)); without one, those items stay to review. A single-page check cannot compare anything, so its report says so in a note: "Not checked on a single page: 3.2.3 Consistent Navigation, 3.2.4 Consistent Identification and 3.2.6 Consistent Help compare the pages of a site, 2.4.5 Multiple Ways lists the ways to find them, and 2.4.1 Bypass Blocks needs them to tell the blocks that repeat from the content; crawl its address with --crawl or --sitemap."

```sh
rampa check https://example.com --crawl --no-llm --max-pages 30
rampa check https://example.com --crawl --no-llm --verbose     # also the experimental findings and the items to review
rampa check https://example.com --sitemap --min-confidence low  # experimental findings as failures, in the exit code
```

They run on every crawl, whatever `--criteria` says: that option picks the judgment modules of each page, and these comparisons need no model. A folder of `.html` files is checked page by page, not as a site; serve it and crawl its address to compare its pages.

All of these checks are **experimental**. Their findings sit below the default confidence threshold, as every new check does until it passes the evaluation gate (section 4.9 of the [coverage plan](plans/wcag-coverage.md)). The report counts them and `--verbose` shows them. `--min-confidence low` reports them as failures, and then they count in the exit code.

## Sets of pages

WCAG applies 2.4.5, 3.2.3, 3.2.4 and 3.2.6 to a "set of web pages", and leaves it to the author to say which pages form one. Rampa does not decide that by itself (see section 6 of the plan). It proposes sets, and the report lists them so you can check them:

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

Pages with no navigation landmark, header or footer links are listed as "No navigation found", and pages that share a template with no other page, or that are alone in a set you named, as "In a set of their own". Neither is compared for 3.2.3, 3.2.4 or 3.2.6. 2.4.1, the shared titles of 2.4.2 and 2.4.5 compare every page of a language and viewport instead (see [2.4.1](#241-bypass-blocks)). A page is compared only once its own report exists: a page whose judgment failed is in no set.

## 2.4.1 Bypass Blocks

2.4.1 asks for a way to bypass blocks of content that are repeated on multiple pages, such as a header and a menu. Which blocks repeat is a question about several pages, so this check fails a page only in a crawl; on a single page, the skip-link probe (`--probe keyboard`, see [probes](probes.md)) sends what it finds to review at most.

**What repeats.** Each page is read as a sequence of content in document order: links and controls (with their text), headings, images with a name, and texts. A piece of content repeats when the same text (normalized, case ignored) is on another page of the same language and viewport, as ACT cf77f2 defines a block of repeated content: a block for which another page the page links to has an equivalent one. In a landmark other than `main` (a menu, a header) whose content mostly repeats, a piece of the page's own, such as the current section or a cart count, counts with the block. Unlike 3.2.3, 3.2.4 and 3.2.6, 2.4.1 compares every page of a language and viewport, whether it shares a template with another page or not (sets named in the config are kept as they are): a page with no landmarks, which no template set takes, is the one most likely to fail. These pools are not listed in the report's sets; each finding names its pages.

**The first repeated block.** From the start of the page, the first piece of content that repeats begins the block; the block runs until the first piece that does not, which is where the page's own content starts. Repeated content at the end of the page (a footer) needs no bypass, as ACT's assumptions say. A block of fewer than two links or controls and under 40 characters is too small to report.

**Ways past the block**, each read leniently, so that a failure means none is there at all:

| Mechanism | Counts when |
| --- | --- |
| A landmark (ARIA11) | It holds where the page's own content starts, or it is the `main` landmark, starts after the block begins and holds content of the page's own (a breadcrumb may come first) |
| A heading (H69) | A heading of the page's own comes after the block |
| A link into the page (G1, G123, G124) | Its fragment names an element after the start of the block, and focus would land on content of the page's own, or in an element that holds where it starts. When the skip-link probe ran (not in a crawl yet), a link it found not working does not count |
| A control Rampa cannot try | A button or link named like a skip link with no target in the page (a script may handle it), or a control named like a menu toggle ("Menu", "Toggle navigation", "Hide table of contents"), before the content: the page goes to review instead of failing |

**What is a failure.** A page with a repeated block before its own content and no mechanism at all. One finding per set lists the pages, the repeated items and where the content starts:

```
WCAG 2.4.1 (A) — Bypass Blocks
  ✗ Blocks repeated before the content · experimental
    On /, /about, 4 link(s) and control(s) repeat on other pages of the site and come before the page’s own content, and nothing lets someone pass them: no skip link to the content, no landmark around it, no heading at its start (WCAG 2.4.1, ACT cf77f2). Add a “Skip to main content” link first in the page, pointing to a main landmark (G1, ARIA11).
    on /: 4 repeated item(s) before the content (“Home”, “About”, “Stores”, “Blog”); the content starts at “Spring coats, made to last and easy to repair.”; no landmark, heading or skip link after them
```

**Needs review** when the only way past is a control Rampa cannot try. The finding's fingerprint is made of the criterion, the language and viewport (or the set's name) and the repeated items, never the pages. In the coverage, a crawl that compared pages and failed none gives 2.4.1 "no failure found", in place of the "needs review" that axe-core's `bypass` (which can only pass or ask for review) leaves on each page when nothing else is listed to review.

**Real sites (2.4.1).** On 2026-10-10, `rampa check <url> --crawl --no-llm --min-confidence low`: on rampa.guilhermebs.com.br (10 pages; 9 in English compared, the Portuguese home page alone in its language), every page has its header and menu before a main landmark, and nothing failed, which is right. On agenciabrasil.ebc.com.br with `--max-pages 5`, the 3 Portuguese pages compared have a main landmark and a skip link after the repeated header; the English and Spanish pages are one page each in their language, so not compared. Nothing failed, which is right; the skip link that does not show on focus is what `--probe keyboard` reports, on one page.

**ACT cf77f2.** `rampa eval --rules site/2.4.1` loads each test page and the first page of the same site it links to (the plan's "following one link per page"; every test page links to the rule's chapter 2), and compares the two as a crawl would. On 2026-10-10, with Edge 154 headless and the ACT file whose SHA-256 starts with `a9a1483e`, on the rule's 13 HTML test cases (the SVG one is left out): the failed example fails, none of the 12 passed examples fails (precision and recall 1.00), and Passed Example 8, whose way past is a button that moves focus by script, goes to review. Passed Examples 1 and 11 (a link and a button that hide the menu) have a menu of two items, under the size Rampa reports, so they say nothing rather than going to review. axe-core alone fails none of them: its `bypass` can only pass or ask for review.

## 2.4.2 Page Titled, across pages

Each page's title is checked on its page: axe-core's `document-title`, the rule for framework default titles, and the judged criterion, which a crawl gives the titles of the pages read before it. Across pages, Rampa lists titles that several pages of a language share while their content differs: a title tells pages apart when it says what is specific to each. It is **needs review only**: a shared title can still describe the purpose of each page (the steps of one form), and only a person can say. Pages whose main content is the same (one page at two addresses, `/` and `/index.html`) are one page, not a shared title. When every page of the crawl has the same title, the message says so: a single-page app that keeps its title when its route changes looks like that, since the crawl loads each route by its address.

```
  ? 2.4.2 The title “Blog post · Acme” · experimental
    2 pages share the title “Blog post · Acme”: /blog/first, /blog/second. Needs review: a title tells pages apart when it says what is specific to each (2.4.2); check that each of these titles describes its own page.
```

## 2.4.5 Multiple Ways

2.4.5 asks for more than one way to locate a page within a set of pages, except a page that is the result or a step of a process. Rampa **never fails it**: a crawl is never known to hold every page of a site, and which pages are steps of a process is the author's to say (section 6 of the plan). For each language and viewport it lists, as one item to review, the ways it found and on how many pages:

| Way | Found when |
| --- | --- |
| A navigation menu | A navigation landmark or a header with three or more links to pages of the site |
| Search | A search landmark, a search field (`type="search"`, or a field named `q`, `s`, `query`, `busca`…), or a form whose action is a search address (`/search`, `/busca`, `/pesquisa`…) |
| A site map link | A link to `/sitemap`, `/site-map`, `/mapa-do-site`… (not `sitemap.xml`), or named "Site map", "Mapa do site" |
| A table of contents | A list or navigation of three or more other pages of the site named "Contents", "Table of contents", "Sumário", "Índice", or a navigation beside the content (a docs sidebar). A list of the page's own sections ("On this page") helps within the page, not to find it, and does not count |
| Related links | A heading, an aside or a section named "Related", "See also", "Veja também", "Leia também", "Relacionados"… with two or more links |
| Breadcrumbs | A navigation or list named, or with a class, "breadcrumb", "trilha", "Você está aqui" |

It also counts the pages that the header, navigation or footer of another page links to, and names the ones none does (a page reached only from a link in some text, or from nowhere the crawl saw).

```
  ? 2.4.5 Ways to find the pages · experimental
    Ways to find the 7 pages compared: a navigation menu on 7, search on 7, a site map link on 7, a table of contents on 0, related links on 0, breadcrumbs on 0; 5 of 7 pages are linked from the navigation of another page. 2.4.5 asks for more than one way to locate a page within a set of pages, except a page that is a step in a process. Needs review: Rampa lists what it found and never fails this criterion, since a crawl is never known to hold every page; check that each page of the set can be found in two ways.
    a navigation menu: 7 of 7 pages: /, /products, /about, /blog and 3 more
    …
    Not linked from the header, navigation or footer of another page: /blog/first, /blog/second
```

In the coverage, 2.4.5 moves from "not checked" to "needs review only", never to "no failure found".

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

## 3.2.4 Consistent Identification

3.2.4 asks that components with the same function on the pages of a set be identified consistently. Rampa reads what each component does from the page code, never from its name, so that a difference in names can be found (F31: two labels for one function).

**What a component does.**

| Component | Its function is read from | Rampa is |
| --- | --- | --- |
| A link | Where it leads, with what belongs to its page set apart: an address in its query becomes `{url}` (`/login?next=/about` and `/login?next=/pricing` are one sign-in link), a fragment of the page itself `{page}#top`, and the page's own path in a link to another site (`…/edit/main/docs/{page}.md`); tracking parameters (`utm_*`, `ref`) are dropped | sure |
| "Next", "Previous", "Back", "Older", "Próximo", "Anterior", "Voltar", "«", "»"… | The word itself: the next page's link is "Previous" on the page after it, so the destination says nothing | sure |
| A language link | The language it leads to: `hreflang`, `lang`, a language's own name as its text ("Português"), or a code its address shares ("PT" to `/pt/`) | sure |
| A share link | The service it shares to (`twitter.com/intent/tweet`, `facebook.com/sharer`, `wa.me/?text=`, a `mailto:` with only a subject or body…) | sure |
| A search field or button | Its search form: a search landmark, a `type="search"` field, a field named `q`, `s`, `query`, `busca`…, or an action such as `/search` | sure |
| A field or a submit button of another form | The form's action and the field's `name` (`/newsletter` and `email`) | sure |
| A button with an id written by a person | Its id (`#theme-toggle`); generated ids (`:r1:`, `radix-…`, long numbers) are not used | sure |
| Any other button | Its icon: the drawing of its svg, the address of its image, its icon font class (`fa-search`, `bi-list`) or ligature | unsure: one icon may serve different functions |

Components are compared within the part of the page they sit in: the header, a navigation landmark (by its label), the footer, a sidebar, or outside every landmark of a page that has a main one (on a page with no main landmark, that may be its content); search, language and share links wherever they are. So a logo and a Home link that both lead to `/` are two components, each compared with itself on the other pages. Links inside the main content are left out, except search, language and share links: a link in a text names its destination in context, which 2.4.4 judges. A page where one component has two different names (a menu and a copy worded otherwise) is left out of that comparison.

**Comparing names.** Names are folded: case, accents, spaces and punctuation do not count ("Log in" and "Login" are one name). Two names are consistent when only numbers differ ("Cart (0)" and "Cart (2)", "Go to page 4" and "Go to page 5"), or only words of each page's own title or first heading (words every title of the set shares, such as the site's name, are not a page's own). A component named differently on every page names something of its page, which is consistent too.

**What is a failure.** A component whose function Rampa is sure of, named with words the other name does not share at all, on some pages of the set: the pages in the minority are named, with the names and pages on each side, and the elements on each.

```
WCAG 3.2.4 (AA) — Consistent Identification
  ✗ The search button · experimental
    The search button is named “Search” on /, /products, /blog, /sitemap and 2 more, and “Find” on /about. Components with the same function must be identified the same way on every page of the set (3.2.4, F31): give it one name.
    “Search” on /, /products, /blog, /sitemap and 2 more
    “Find” on /about
    on /about: #top > header > form > button
    on /: #top > header > form > button
```

**Needs review.**

- Names that share some words ("Dark mode" and "Toggle dark mode"): consistent identification does not mean identical names, so a person decides.
- Buttons grouped only by their icon, named differently: one icon may serve different functions ("Search" and "Filter"). A model may answer whether the two names identify the same function (below).
- The same name in the same part of the page leading somewhere else on a few pages ("Privacy" to `/privacy` on most pages and to `/legal/privacy` on one): maybe two functions under one name. Only when most pages agree on the destination; a name whose destination changes on every page names something relative to its page.

**Real sites (3.2.4, 2.4.2, 2.4.5).** On 2026-10-11, `rampa check <url> --crawl --no-llm --max-pages 10 --min-confidence low`:

- rampa.guilhermebs.com.br: 9 English pages compared (the Portuguese home page alone in its language). 3.2.4 compared 13 components (logo, language link, theme toggle, the main navigation, the footer) and found no name that changes, which is right for a site built from one layout. No two pages share a title. 2.4.5 lists a navigation menu on 9 pages, breadcrumbs on 8, and the list of the other criteria pages on 7 as a table of contents; no search and no site map; every page is linked from another page's navigation.
- docs.python.org/3/tutorial/ (with `--include /3/tutorial/`): 10 pages, 34 components compared, nothing named differently. The first run flagged eight links named "next" on one page and "previous" on the next, which lead to the same page from either side: that is why "Next", "Previous" and their kin are now read by their word, not their destination. 2.4.5 lists the menu and the search on all 10 pages; the tutorial's index, a table of contents in its main content, is not recognized (a list without a name), so a person sees it in review.

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

**Needs review.** Help recognized only by its text (a model may answer whether it is help, below); and help that is in the header or footer of some pages and only inside the main content of others, which may be a moved mechanism or just a mention in the text.

Missing help is not a failure: 3.2.6 does not require help on every page, only the same order where it repeats.

## Questions for a model

The rules leave two questions open, and with a model (not with `--no-llm`), Rampa asks them after comparing the pages, three times each; the majority decides, and a tie is no answer:

- **3.2.4:** two buttons drawn with the same icon in the same part of the page, named differently. "Do these two names identify the same function?", quoting both names, the role and the page of each. The same function, with names that share no word, makes a failure; with names that share some words, it stays to review with the answer. Different functions clear the item.
- **3.2.6:** help recognized only by its text that moved or changed place. "Does this link lead to a way to get help?", quoting its text and address. Help makes the change a failure; not help clears it.

The answer must quote the names or the text it was asked about, folded as Rampa folds them, or it is set aside and the item stays to review. A model never creates an item: it only decides one the rules found. Answers are cached like any judgment (`--cache-dir`), `--offline` reads them from the cache, and their cost is in the site's usage line. Items a model cleared are counted in one line (`--verbose` lists them, with the answer), and kept in `siteCriteria.cleared`. Each finding a model answered has a `judgment`: the `verdict`, `votes` of `total` runs, the `model`, its `reason`, and the `outcome` (`failure`, `review` or `cleared`; `discarded` when its quotes did not match). On a fixture site with `ollama:gemma4:12b`, the menu button named "Menu" on six pages and "Navigation" on one was judged the same function in 3 of 3 runs, which made it a failure.

## JSON

The site report gets a `siteCriteria` object:

| Key | What it holds |
| --- | --- |
| `sets` | Each set: `id` (`config:<name>` or `template-<n>`), `label`, `source` (`config` or `template`), `lang`, `viewport` and its `pages` |
| `unassigned` | Pages in no set compared, with `reason`: `no-navigation` or `alone` |
| `criteria` | Per criterion: `version`, `maturity`, `setsCompared`, `compared` (components or help mechanisms found on two or more pages of a set; pages with a title, for 2.4.2; pages, for 2.4.5), `findings`, `review`, `reviewOnly` (2.4.2 and 2.4.5, which only list items to review), and `judged` and `cleared` when a model answered questions |
| `findings`, `belowThreshold` | Failures at or above `--min-confidence`, and the rest; experimental checks are always below it unless the threshold is `low` |
| `review` | Needs review: never a failure, never in the exit code |
| `waived` | Findings whose fingerprint is in the waivers file |
| `beyondTarget` | Under `--wcag 2.1` only: failures on 3.2.6, which is new in WCAG 2.2. Reported, never counted toward the target or the exit code |
| `cleared` | Items to review a model cleared, with its `judgment` |
| `usage` | What the questions for a model cost: `calls`, `cachedCalls`, tokens and latency; also added to `summary.usage` |

Each finding has `criterion`, `level`, `status` (`failure` or `review`), `set`, `subject`, `message`, `evidence` (the order observed, as text, one line per distinct order), `pages` (the pages named), `comparedWith`, `items`, `elements` (`page`, `ref`, `name`, `html`), `observed` (for each distinct order, its `pages` and the `order`), `confidence`, `experimental`, a `fingerprint`, and, for an item a model may decide, its `question` (and `judgment` once answered). The fingerprint is made of the criterion, the set (its name in the config, or the language and viewport of a proposed set), the component and the items, never the pages, so it stays the same when the crawl finds the problem from other pages, and the same problem in the English and the Portuguese pages are two findings; put it in the waivers file to waive the finding.

`summary.coverage.notChecked` no longer lists 3.2.3 or 3.2.4 once a set was compared, nor 2.4.5 once it listed something to review, `summary.coverage.site` lists the criteria that compared something (2.4.5 needs review instead), and the coverage block prints a line such as `Compared across pages: 2.4.1 (1 set(s), 9 compared); 2.4.2 (1 set(s), 9 compared); 2.4.5 (1 set(s), 9 compared); 3.2.3 (2 set(s), 10 compared); 3.2.4 (1 set(s), 13 compared, 1 judged by a model); 3.2.6 (2 set(s), 0 compared)`. For 2.4.1, "compared" counts the pages with a repeated block before their own content, and its sets are the pools of pages of one language and viewport. In the per-criterion coverage (`summary.coverage.criteria`, see [WCAG 2.2](wcag-2-2.md)), each criterion that ran has a method of kind `site` (`site/3.2.3@<version>`) with what it compared, its failures and what needs review, and the status it found: failures, needs review (a failure below the threshold, or an item to review), no failure found (something compared), or no applicable content (sets compared, nothing found on two pages of one). Across the pages, the most telling status wins.

## From saved snapshots, without a browser

The criteria read only the snapshots, so a crawl saved with `--save <dir>` can be compared again later, with other sets or after an update, through the API:

```ts
import { readdir } from 'node:fs/promises'
import { loadSnapshot, runSiteCriteria, siteFactsOf } from 'rampa-cli'

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
- **3.2.6 is new in WCAG 2.2.** A run that targets WCAG 2.1 (`--wcag 2.1`) still compares it, and puts its failures in `siteCriteria.beyondTarget`: one line in the report says how many there are (`--verbose` lists them), they never change the exit code, and the coverage lists 3.2.6 as beyond the target, with its status.
- **2.4.1 reads repeated content by its text.** A menu worded differently on each page is not seen as repeated, and a short text that two pages share by chance ("Read more") can join a block. Equivalence in ACT's sense (the same purpose, other words) is not judged.
- **2.4.1 does not try skip links in a crawl.** Probes do not run with `--crawl` yet, so a link into the page counts as a way past the block from its markup alone, even if it does not work; `--probe keyboard` on a single page tries it. Controls that would need a click (a skip button, a menu toggle) are never pressed, so they send the page to review.
- **3.2.4 reads a function from the page code.** Two components that do the same thing through different code (a search form in the header of some pages and a search link on others, two forms with different actions) are not compared, and a button with no id and no icon is not read at all. Components inside the main content are left out, except search, language and share links. Within one page, two components with one function and different names (a logo and a Home link) are not compared: they are two components.
- **3.2.4 names are read as the browser would name them**, from the collector's accessible name; a name that changes with state (a cart's contents in words, "Sign in" and "My account" after signing in) changes with what the crawl saw.
- **2.4.2 compares titles only**: a title shared with a page the crawl did not load is not seen, and a title that changes only when the route of a single-page app changes in place (without a new load) is not seen either.
- **2.4.5 lists what the crawl saw**: a search reached only through a button, a site map not linked from the pages crawled, or ways that appear only after a click are not found. It never fails.
- **2.4.1 looks at the first repeated block only**, as ACT cf77f2 does: blocks interleaved with content further down are not checked. Each way past it is read leniently (any heading of the page's own after it, not one at the very start of the content), so pages that pass may still need a person to check that the mechanism lands where the content starts.

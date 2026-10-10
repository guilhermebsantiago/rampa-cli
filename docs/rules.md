# Rampa's rules

Rampa's rules are deterministic checks over the snapshot, with no model. They sit next to axe-core: axe-core checks syntax across the whole page, and each Rampa rule reports one narrow failure that axe-core does not, where the page's own text or markup gives the failure away. Findings from a rule have `source: "rule"` and a rule id in the `rampa/` namespace.

The content rules are wave A3 of the [WCAG coverage plan](plans/wcag-coverage.md), and the structure rules are wave A4. A rule ships only when its false-positive risk is very low. Anything a rule cannot decide is left to judgment or to a person.

## Where rules run

Rules run inside the check itself (`checkSnapshot`), after axe-core and before the judged criteria. They therefore run everywhere a check runs:

- `rampa check`, with or without a model;
- `rampa site`;
- the Playwright, Puppeteer and Node APIs;
- `rampa mcp`;
- a saved snapshot replayed offline.

A rule reads only the snapshot and axe-core's results. It never opens a page.

The collector records three facts for rules, as additive fields on the root node's `native`, so `schemaVersion` stays 1:

| Field | What it holds |
|---|---|
| `metaViewport` | Each `<meta name="viewport">` that has a `content` attribute: `{ ref, content }`. |
| `httpRefresh` | The `Refresh` response header of the page, when it has one. |
| `redirectedTo` | Where the page went when it redirected on its own right after loading, through a 0 s meta refresh or a `Refresh: 0` header. |

**Immediate redirects.** A page that redirects as soon as it loads used to make collection fail ("Execution context was destroyed"). Rampa now waits for the page the redirect leads to, collects that page and records the address in `redirectedTo`. The report keeps the address that was asked for.

**Components.** When a check covers only a component (`checkPage` with `include`), the rules about the page as a whole are skipped: `default-title`, `meta-viewport` and `refresh-header`. A component has no title, head or response.

## Maturity, confidence and the exit code

Every rule ships as `experimental`, as the plan requires, until it passes the evaluation gate in section 4.9 of the plan. That gate has four parts:

- ACT test cases;
- fixture pairs;
- 35 findings on real pages reviewed by a person with no false positive;
- stability.

An experimental rule's findings are reported at **low** confidence. That is below the default threshold (`medium`), so:

- they appear with `--verbose` or `--min-confidence low`;
- they never change the exit code under the default settings.

The pretty report prints them with `Rampa rule rampa/<id>` and the finding's id, which waivers and baselines use.

When a rule is promoted to `stable`, its findings keep the rule's own confidence, high by default.

## How rules and the other layers interact

- **axe-core comes first.** A rule never reports an element that axe-core already failed for the same criterion or through one of the rule's `engineRules`. The failure is reported once, as axe-core's.
- **A stable rule decides.** When a stable rule fails an element, the judged criterion with the same id does not send that element to the model. The rule already decided, and a model call would only repeat it at a cost.
- **An experimental rule does not decide.** The model is still asked about the element. If the model also fails it, the report keeps one finding, the judgment's, because it says more and carries a suggested fix. If the model passes the element, or no model runs, the rule's finding stays, at low confidence.
- **Review is not a failure.** A hit a rule cannot decide (a table still loading, a header with no scope that heads neither its row nor its column) goes to the report's **Needs review**, next to what axe-core could not decide, and never to the findings. It never changes the exit code, whatever `--min-confidence` says. In JSON it is in `needsReview`, with the rule's id and what it read as `evidence`.
- **Coverage.** A criterion where a rule decided at least one element (it failed it or let it be, rather than sending it to review) is listed on a separate coverage line: "Checked by Rampa rules (partial)". It is also removed from "Not checked automatically". The JSON report has this line as `coverage.rules`, and the MCP summary as `checked_by_rules`. Like axe-core's line, it means that some failures could be found, not that the criterion was tested. In the per-criterion coverage (`coverage.criteria`, see [WCAG 2.2](wcag-2-2.md)), each rule is a method of kind `rule` for each of its criteria, with its maturity: an experimental rule's failure, below the threshold, gives its criterion the status "needs review", and a rule with only review hits does not make the criterion count as checked.

## The rules

### Content rules

| Rule | WCAG | Reports | Leaves out on purpose | Patch |
|---|---|---|---|---|
| `rampa/placeholder-alt` | 1.1.1 (F30) | An image whose text alternative is a file name (`IMG_2034.jpg`, `/assets/hero.webp`), a camera or screenshot file name (`DSC01234`, `PXL_20230812_142233`, `Screenshot 2023-08-12 …`), a placeholder word with an optional number (`image`, `foto 3`, `spacer`, `alt text`), or its own file name when that name has a separator (`hero-banner` for `hero-banner.png`) | `logo`, `icon`, `banner` and single real words such as `team`, which may be all an image needs and stay with judgment; product names such as `RX100` or `Canon EOS R5`; images hidden from assistive technology | none: only a person, or the 1.1.1 judgment, can write the alternative |
| `rampa/default-title` | 2.4.2 | A page title that a framework or an editor wrote and nobody changed: `React App`, `Vite + React + TS`, `Create Next App`, `Document`, `Untitled Document`, `Insert title here`, `Documento sem título`… An exact match on the whole title, ignoring case and spacing | A title that only contains one of these words (`Document management · Acme`); product names that are also real sites (`Vite`, `Astro`, `Next.js`); `Home` | the page's only `h1` as the title, when it has exactly one |
| `rampa/placeholder-text` | 2.4.6 | A heading or a field label that still holds a template's text: lorem ipsum; phrases that page builders put in a new heading block (`Add Your Heading Text Here`, `Adicione seu título aqui`); field labels made of a word and a number (`Field 1`, `Campo 2`) | `Heading 1` or a bare `Heading`, which a design system's style guide shows on purpose; a bare `Label` or `Field`, which can be a real label (a "Label" field when creating a tag) | none |
| `rampa/meta-viewport` | 1.4.4 (ACT b4f0c3) | A viewport meta element with `user-scalable=no` (or 0, or any value between -1 and 1), or a `maximum-scale` below 2, parsed as browsers parse it: `yes` is 1, `no` is 0, `device-width` is 10, `1px` is 1, and anything that is not a number is 0. This adds what axe-core 4.14 passes: `maximum-scale=no`, `user-scalable=invalid`, `maximum-scale=invalid`, and properties separated only by spaces | a negative `maximum-scale`, which browsers drop | the `content` attribute without the properties that block zoom |
| `rampa/refresh-header` | 2.2.1 | A `Refresh` HTTP header that reloads or redirects the page after more than 0 seconds and at most 20 hours, parsed by the HTML declarative refresh steps. axe-core's `meta-refresh` cannot see headers | `Refresh: 0`, an immediate redirect, which is not a time limit; delays over 20 hours, which the 20-hour exception allows; values browsers ignore (`+5`, `; 30`, `0: url`) | none: the fix is on the server (a 301 or 302 redirect, or no refresh) |
| `rampa/language-switcher-lang` | 3.1.2 | A link, button, tab, option or menu item whose whole text is a language's own name in that language (`Português`, `Deutsch`, `日本語`, `English (United States)`, from CLDR through `Intl.DisplayNames`), when that language is not the page's and nothing in the control declares `lang` | the page's own language; names spelled the same in the page's language (`Italiano` on a Portuguese page); text that only contains a language's name (`Read in English`); a page with no declared language, which axe-core's `html-has-lang` reports; controls hidden from assistive technology | `lang="<code>"` on the control |
| `rampa/no-visible-label` | 3.3.2 | A field whose name comes only from `aria-label`, `title` or a hidden label (including one on screen whose text the collector's pixel test found does not show, docs/criteria.md), with no visible label, no placeholder, no option shown, no legend, and no visible text, button or picture near it. The candidates are the 3.3.2 module's own, so the rule sees what the model would see | search fields, whose magnifier icon is often drawn in CSS and is not in the snapshot; fields with any visible text or button within the three levels that 3.3.2 looks at; fields next to an image, an `svg` or a CSS background | a visible `<label>` holding the field's current name (inputs only) |

### Structure rules: 1.3.1 and 4.1.2

These rules are wave A4 of the plan. They read structure that the markup states and the browser computes, from facts the collector records on each node's `native`:

| Field | What it holds |
|---|---|
| `table` | On each `table` element, and on each element with role `table`, `grid` or `treegrid`: the cells on the HTML table grid. Each cell has its ref, header or not, x, y, colspan and rowspan, `scope`, `headers` ids, `id`, explicit role, and whether it is empty or hidden. The table also records `aria-busy`, its caption and its `summary`. The record stops at 1,000 cells and says when it did. An ARIA table is read from its `row` elements and their cells, `aria-colspan` included. |
| `labelControl` | On each `label`, the ref of the control it labels (`label.control`), or `null` when it labels nothing. |
| `presentational` | On an element with `role="presentation"` or `role="none"`: `true` when the browser keeps that role, `false` when focus or a global ARIA attribute makes the browser ignore it. |

A `fieldset` now has the role `group`, named by its `legend`. 2.4.6 reads that name when it compares field labels within a group.

| Rule | WCAG | Reports | Leaves out on purpose | Patch |
|---|---|---|---|---|
| `rampa/table-header-cells` | 1.3.1 (ACT d0f69e) | A header cell that heads no cell. It ports the HTML algorithm that assigns header cells to cells: the `headers` attribute when a cell has one; otherwise a scan left along the cell's rows and up its columns, where a block of headers hides the headers beyond it. As in the ACT rule, header cells count as cells, and an empty cell counts. axe-core's `th-has-data-cells` can only pass or return incomplete | empty or hidden header cells, and header cells whose role was changed to `cell`; tables marked presentational. These go to **review** instead of failing: a table that holds only headers; a table marked `aria-busy`; a table with `rowgroup` or `colgroup` scopes, which the port reads as row and column scopes; and a header with no `scope` whose row and column both hold data cells. The HTML model makes that last kind of header head neither its row nor its column, and browsers guess. Wikipedia's navboxes, where a picture cell spans the header row, are like this. The message asks for `scope="col"` or `scope="row"` | none |
| `rampa/presentational-table` | 1.3.1 (F46, F92) | A table with `role="presentation"` or `role="none"`, a role the browser keeps, that still has visible header cells, a caption or a `summary` | a table where focus or a global ARIA attribute makes the browser ignore the role, so it is still a table | none: the fix depends on whether the table holds data (remove the role) or layout (use `td` and no caption) |
| `rampa/orphan-label` | 1.3.1 (the narrow case of F111) | A visible `<label>` that labels nothing, is referenced by no `aria-labelledby`, and sits in a container with exactly one field and no other label, while the field's name does not contain the label's text. The finding is on the field | labels that wrap their field; labels above a group of fields, such as a date of birth with three selects; fields whose name already says the label's words; fields axe-core already fails for having no name (`label`, `select-name`) | `for="<field id>"` on the label, when the field has an id |
| `rampa/duplicate-id-reference` | 4.1.2 | An `aria-labelledby`, `aria-describedby` or `label for` that points at an id used by more than one element, when the browser resolves it to the first element but a closer one with the same id is the one beside the reference. This is the repeated-component case, where every card's button gets the first card's title as its name | duplicates whose texts are the same, which a person would hear the same way; a `for` whose nearer element is not a field | none: each id must become unique |

**Experimental axe-core rules.** `td-has-header` and `table-fake-caption` are experimental in axe-core 4.14, so a tag run leaves them out. Rampa enables them in the same axe-core run through `rules`, and reports what they find as needs review only (`AXE_REVIEW_RULES` in `src/engine/axe.ts`): in the report's **Needs review**, never in the findings, and they never make 1.3.1 count as checked.

The plan also named `p-as-heading`. It is left out because every hit on the real pages below was wrong:

- the verdict words "✓ Passes" and "✗ Fails" on rampa.guilhermebs.com.br;
- three statistics such as "1,9%" on ibge.gov.br.

None of them was a heading.

**2.5.3 Label in Name.** axe-core's `label-content-name-mismatch` compares letters exactly. It fails "E-mail" against the name "Email address", and "Info" against "Information about shipping". Speech input may well match those; whether it does is for a person to try. Rampa moves those failures below the threshold, with the reason added to the message, when either of these holds:

- the visible label and the name differ only by hyphens;
- every visible word of three letters or more begins a word of the name, in order.

Every other mismatch stays as axe-core reported it, for example "Previous" for "Next page", or "Qty" for "Quantity". The visible label includes text hidden only from assistive technology, which is still on screen: "Download <span aria-hidden>gizmo</span> specification" against "Download specification" stays a failure. This review runs inside the check on axe-core's own findings (`src/rules/label-in-name.ts`). It is not a rule with hits of its own.

On the 38 test pages of ACT 2ee8b8, axe-core alone fails all 16 failed examples and 2 inapplicable ones: "University Ave." for "University Avenue", and "nonstandard" for "non-standard". After the review, the 16 failures stay, with no new miss, and both of those flags go to review.

## Evaluating the rules

`rampa eval --rules <ids>` measures rules against the ACT test cases they list, with no model:

```sh
rampa eval --rules meta-viewport,refresh-header
```

The ACT test cases are downloaded at run time and never redistributed. Each test page is collected and scored three ways:

- axe-core alone;
- the rule alone;
- both together, as `rampa check` reports them.

The command prints the test cases each way gets wrong, and writes `results.jsonl` and `summary.json` under `.rampa/runs/`. A rule that lists no ACT rule is measured by its fixtures in `test/fixtures/rules/`, and the command says so.

Results on 2026-10-09, with the ACT file whose SHA-256 starts with `a9a1483e`:

| Rule · ACT | Pages | axe-core alone (P / R) | Rule alone (P / R) | Both (P / R) |
|---|:---:|:---:|:---:|:---:|
| `meta-viewport` · b4f0c3 | 16 | 1.00 / 0.71 | 1.00 / 1.00 | 1.00 / 1.00 |
| `refresh-header` · bc659a | 15 | 1.00 / 1.00 | — / 0.00 | 1.00 / 1.00 |
| `table-header-cells` · d0f69e | 16 | — / 0.00 | 1.00 / 1.00 | 1.00 / 1.00 |

- **b4f0c3.** axe-core misses Failed Examples 3 and 7 of the second version of the rule in the ACT file: `user-scalable=invalid` and `maximum-scale=invalid`. The rule finds both, and flags no passed or inapplicable page.
- **bc659a.** The test cases are all meta elements, so the header rule never fires on them. What this set measures is that collection survives the two immediate redirects (Passed Examples 1 and 2), which now land on github.com and w3.org and are recorded. A local server in `test/rules-web.test.ts` checks the header itself: a timed header fails, and an immediate one is recorded.

- **d0f69e.** axe-core's `th-has-data-cells` never fails a page, so it finds none of the three failed examples. The rule finds all three and flags none of the passed or inapplicable examples.
- **Other rules' pages.** Every rule also ran on the 73 test pages of ACT a25f45, bc4a75, ff89c9 and 6cfa84, which test other failures. Nothing failed on a passed or inapplicable page. a25f45 Passed Example 6, a table that holds only headers, goes to review, not to failure. The hits on a25f45 Failed Examples 1 and 3 are true d0f69e failures: their `headers` attributes point at ids that do not exist, or at the cell itself.

The fixtures in `test/fixtures/rules/` come in pairs of three pages:

- `content-fail.html` and `structure-fail.html`: one planted failure for each rule, each found exactly once;
- `content-pass.html` and `structure-pass.html`: the same page fixed, with nothing reported;
- `content-controls.html` and `structure-controls.html`: near misses, each of which looks like a failure and is not, with nothing reported. They include the d0f69e passed examples, a table where `role="presentation"` loses to `aria-label`, and an id used twice with the same text.

### Real pages

On 2026-10-09 the rules ran with `rampa check <url> --no-llm --min-confidence low` on nine public pages:

- rampa.guilhermebs.com.br;
- en.wikipedia.org/wiki/Main_Page;
- gov.br/pt-br;
- un.org/en;
- pt.wikipedia.org/wiki/Brasil;
- ibge.gov.br;
- MDN's `<table>` reference;
- correios.com.br;
- europa.eu/youreurope.

| Page | Rampa rule hits | Read by hand |
|---|---|---|
| rampa.guilhermebs.com.br, en.wikipedia.org, gov.br, un.org, MDN, correios.com.br, europa.eu | none | — |
| ibge.gov.br | `language-switcher-lang`: the "English" link, with no `lang`, on a pt-BR page | true |
| pt.wikipedia.org/wiki/Brasil | `table-header-cells`: 8 headers of a navbox, now as review | The HTML table model assigns them to no cell, because a picture cell spans their row. Browsers guess. The headers now go to review with a request for `scope` (they were failures before this was found) |

Rampa's rules found one failure on these pages, and it was true. They found no false positive. This is far from the plan's gate: 35 reviewed findings per rule are needed before a rule becomes stable. Every rule stays experimental.

## The interface

A rule is a `RuleCheck` (`src/rules/types.ts`):

```ts
interface RuleCheck {
  id: string                       // 'rampa/placeholder-alt'
  version: string
  criteria: readonly string[]      // WCAG ids; the first is the finding's criterion
  maturity: 'stable' | 'experimental'
  surfaces: readonly Surface[]
  page?: boolean                   // reads the page as a whole: skipped for a component
  act: readonly string[]
  engineRules: readonly string[]   // axe-core rules on the same failure
  help: Text
  helpUrl: string
  run(snapshot, engine, ctx): { hits: Hit[]; applicable: number }
  message(hit: Hit, locale: Locale): string
  patch?(hit: Hit, snapshot): Patch | undefined
}
```

`RuleCheck` is the deterministic half of the `Check` interface in the [cognitive profile plan](plans/cognitive-profile.md) (WI-1). It has the same `id`, `version`, `maturity`, `surfaces`, `run`, `message` and `patch`, with WCAG criteria where `Check` has a basis, and it never has a `judge`. A `Hit` carries:

- `ref`;
- `outcome` (`fail` or `review`);
- `subject`: what the hit is about, read from the page; it keys the fingerprint;
- `evidence`;
- `facts`: the values the message and the patch are built from.

The registry is `RULE_CHECKS` in `src/rules/index.ts`, re-exported from `src/engine/rules.ts` next to the tree rules of the native surfaces. Adding a rule takes four steps:

1. Write the rule in `src/rules/`.
2. Add it to the registry.
3. Give it failing, passing and near-miss cases in `test/fixtures/rules/`.
4. List its ACT rules, when they exist, so that `rampa eval --rules` measures it.

# Rampa's rules

Rampa's rules are deterministic checks over the snapshot, with no model. They sit next to axe-core: axe-core checks syntax across the whole page, and each Rampa rule reports one narrow failure that axe-core does not, where the page's own text or markup gives the failure away. Findings from a rule have `source: "rule"` and a rule id in the `rampa/` namespace.

The content rules are wave A3 of the [WCAG coverage plan](plans/wcag-coverage.md), the structure rules are wave A4, and the error state rules are B8. A rule ships only when its false-positive risk is very low. Anything a rule cannot decide is left to judgment or to a person.

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
- **A rule can settle what axe-core left undecided.** A rule that lists an axe-core rule in `resolves` (the pixel rules list `color-contrast`) takes over that rule's undecided results for the elements it measured: each becomes the rule's failure, its "no failure found" or its own item to review, with what it measured. Those elements leave axe-core's review list and axe-core's coverage counts, so each is reported once. What the rule did not measure stays axe-core's to review. Probe rules settle the same way (`resolved` in their result): the media probe's rules take over `video-caption` and `no-autoplay-audio` on the video and audio elements the probe read ([probes](probes.md)).
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
| `rampa/field-label-in-name` | 2.5.3 | A field with a `<label>` on screen whose `aria-label` or `aria-labelledby` names it with other words (`CPF*` on screen, `document` read out). axe-core's `label-content-name-mismatch` looks only at controls named by their content, so a text field is never checked | names that contain the label's words in order, ignoring case, punctuation, hyphens, the asterisk and "(required)"; a label that is only a shortened form of words in the name (`Info`, `Information about shipping`), sent to review; a field with no label on screen but a placeholder the name leaves out (`Nome*` named `name`), sent to review, since whether a placeholder is the visible label is for a person to say; hidden labels; buttons and other inputs named by their value | without `aria-label`, so the `<label>` names the field (inputs only) |

### Error states: 3.3.1 and 3.3.3

These rules are B8 of the plan (the cognitive profile plan's WI-17). They read errors a page **already shows**: a server that rendered a form with its errors, or a test that drove the page there (fill a field, leave it, then `checkPage`). Nothing is submitted. Few pages load in an error state, so on most pages they find nothing to read, and both are narrow (`narrow`): with no field in an error state they say nothing, and 3.3.1 and 3.3.3 stay "not checked", never "no applicable content".

**What the collector records.** `aria-invalid`, `aria-errormessage` and `aria-live` are kept with each node's attributes. For an `input`, `select` or `textarea` marked invalid (`aria-invalid` set and not `false`, or the browser's own `:user-invalid`, which needs someone to have typed), the collector adds `native.userInvalid` and `native.validity`: the constraints the value breaks, as the browser reads them (`valueMissing`, `typeMismatch`, `patternMismatch`, `tooShort`, `tooLong`, `rangeUnderflow`, `rangeOverflow`, `stepMismatch`, `badInput`, `customError`).

**A field in an error state** (`src/criteria/error-messages.ts`) has `aria-invalid`, `:user-invalid`, or an error class on itself or its wrapper (`is-invalid`, `has-error`, `govuk-input--error`, `usa-input--error`, `mat-form-field-invalid`, `ant-form-item-has-error`, `p-invalid`, `error`, `erro`…). **Its messages** are what its `aria-errormessage` names; what its `aria-describedby` names when that has an error class or role or is worded as an error (otherwise it is a hint); text with an error class (`error-message`, `invalid-feedback`, `govuk-error-message`, `mat-error`, `text-danger`…), `role="alert"` or error wording in its container, up to three levels up short of a container with other fields; the same for the fieldset or group around it (a date as day, month and year, whose message GOV.UK ties to the fieldset); and links of an error summary that lead to it (`href="#id"`). Error wording is English, Portuguese and Spanish ("invalid", "is required", "cannot be empty", "inválido", "é obrigatório", "não pode ficar em branco", "obligatorio"…), never words that also open instructions ("must", "at least", "deve").

| Rule | WCAG | Reports | Leaves out on purpose |
|---|---|---|---|
| `rampa/error-without-text` | 3.3.1 | A field with `aria-invalid` and no message a person sees and assistive technology reads: none at all (the error shows only by its state or its color), only one that is hidden, or only one under `aria-hidden` (ACT 36b590's third expectation). A field marked only by an error class goes to review | a field marked only by the browser's `:user-invalid`: the page shows nothing unless it styles it, and the browser names the error itself when the form is sent; a message anywhere listed above counts, a summary link included |
| `rampa/error-suggestion` | 3.3.3 | A field the browser finds invalid against a constraint its markup states, with an error message, where neither the message, the label nor a hint tied to the field states the constraint: the number for `minlength`, `maxlength`, `min` and `max`; for `type=email` an `@` or the word "email"; for `url`, `number`, `tel` and dates their words or digits. Failure for those; review for a `pattern` with no example the pattern accepts (as in 3.3.2), for `step`, and for a date range | `valueMissing` (a required field left empty: saying so is 3.3.1's), `customError` and a field the browser finds valid (the server rejected it for a reason the markup does not state: nothing to compare); a field with no message (3.3.1's) |

Both are experimental, so their failures are reported at low confidence, below the default threshold. **The judgment** that ACT 36b590 asks for (does an error message let a person tell which field is in error, and does it say what is wrong?) is the 3.3.1 module in [judged criteria](criteria.md#331-error-identification), run with `--criteria 3.3.1`.

**Fixtures.** `test/fixtures/rules/errors-fail.html` (an email marked invalid with no text, a message under `aria-hidden`, "Invalid age." for `min="18"`, "This CEP is invalid." for a CEP pattern, a field with only a class), `errors-pass.html` (a GOV.UK-style summary, "Enter an email address like name@example.com", "You must be 18 or older", "Enter the CEP in the format 12345-678", a hidden template and `aria-invalid="false"`), and `errors-live.html`, which a test fills and leaves, then checks with `checkPage`: "Invalid password." for `minlength="8"` fails 3.3.3, "Use at least 3 characters." for `minlength="3"` does not, and a field left to the browser's own validation is not reported.

**Real pages.** On 2026-10-09, two public pages that render errors on load:

| Page | Fields in an error state | Rule hits | Read by hand |
|---|---|---|---|
| design-system.service.gov.uk, the error message example (a date of issue) | 3 (day, month, year, by class) | none | Right: the message "The date your passport was issued must be in the past" is tied to the fieldset by `aria-describedby`, which before the group was read left all three to review |
| getbootstrap.com/docs/5.3/forms/validation | 5 (by class, the server-side example) | none | Right: each has its `invalid-feedback` text, tied with `aria-describedby`. 3.3.3 has nothing to read: the browser's validity is recorded only for a field marked with `aria-invalid` or `:user-invalid`, and these are marked by class |

Neither page exercises 3.3.3, which needs a field the browser finds invalid: static pages rarely have one, which is why the plan expects B8 to earn its value in tests that drive a page into an error state.

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

### Pixel rules: 1.4.3 and 1.4.11

These rules are wave B3 of the plan. axe-core reads text contrast from the style sheet. When something other than one flat color lies behind the text (a background image, a gradient, an element under or over it, text shadows, a pseudo-element), it cannot, and returns *incomplete*: until now those elements were only listed for review. axe-core does not check placeholders at all, and nothing checked the icon of an icon-only control.

**How the collector measures.** After axe-core runs, the web collector (`src/surfaces/contrast-capture.ts`) takes each element in turn:

1. It scrolls the element into view, but only when it is not in view already, and puts the page's scroll back afterwards. Content that a script animates with the scroll position, such as a pinned hero or a scrubbed fade, is therefore measured as it rests.
2. It waits for fonts, for images under the element, and for scripts that restyle the element or its ancestors as it comes into view (until they leave it alone for 150 ms, at most 600 ms). Finite CSS animations on the element are finished. Fixed and sticky layers that do not hold the element are hidden, as for image captures.
3. It captures the element's box three times: twice as rendered, then with its own text made transparent (the placeholder removed, the icon made transparent), everything else as it was. Text shadows stay: they are part of what lies behind the glyphs.
4. It puts the page back: styles, the placeholder, scroll positions.

`src/pixels/pair-contrast.ts` compares the captures. The pixels that differ between the first capture and the last are the glyphs, and the last capture holds, for each glyph pixel, the color right behind it. When the two captures as rendered differ (a playing video, a canvas animation, a carousel), the pixels cannot tell, and the element goes to review.

The text's color is the style sheet's when nothing blends it: no opacity below 1, filter or blend mode on the element or its ancestors, and no text clipped to a background. A color with alpha is composited over what lies behind each pixel. The style sheet's color must show up in the pixels, and the pixels must not show more contrast than it gives. If either check fails (a color read in the middle of a transition, a mask), the color is read from the pixels instead: the most contrasting color that enough glyph pixels share. SVG text is read from its `fill`.

**What the rules decide.** The reading is ACT's highest possible contrast (afw4f7, 09o5cg), between the text's color and each color behind its glyphs:

| Outcome | When |
|---|---|
| Failure | Even the highest contrast is below the threshold. The top 0.5% of pixels is left out as noise. |
| No failure found | Even the lowest contrast reaches the threshold. The bottom 1% is left out. |
| Needs review | Part of the text reaches the threshold and part does not. Or the measurement is not sure enough to fail: a color read from strokes under 3 captured pixels wide, which may be a blend; several text colors, as in a gradient fill; an element that was translucent when captured, which may be a fade under way. Or the pixels could not tell, and the item says why: not shown, cut off by its container, outside the page, too large, a moving background, a box that moved, nothing changed. |

The thresholds are those of WCAG: 4.5:1 for text, 3:1 for large text (18 pt, or 14 pt bold, computed from CSS pixels as axe-core does), and 3:1 for icons.

| Rule | WCAG | Reports | Leaves out on purpose | Patch |
|---|---|---|---|---|
| `rampa/pixel-contrast` | 1.4.3 (ACT afw4f7, 09o5cg) | Text that axe-core's `color-contrast` left undecided because of a background image, a gradient, an image in the element, an element over or under it, text shadows, a translucent color, an element that partly covers it, a position outside the viewport, a pseudo-element, a color it could not parse, or no stated reason, when the measured contrast is below the threshold | what axe-core left undecided for other reasons, which stays in its review: a single character or only symbols (`shortTextContent`, `nonBmp`), text the same color as its background (`equalRatio`, usually hidden on purpose) and an empty field (`emptyValue`); disabled elements | none: the fix is a color, an overlay or a text shadow, and only a person can choose it |
| `rampa/placeholder-contrast` | 1.4.3 | The placeholder of an empty field, which axe-core does not check, when its contrast with the field is below the threshold. A placeholder is text | disabled fields, which are inactive components; fields with a value, which show no placeholder | none |
| `rampa/icon-contrast` | 1.4.11 (G207) | A link or button whose only content, to the eye, is an `svg`, an `img` or an icon-font glyph, when the icon's highest contrast with what lies behind it is below 3:1. An icon font is text in the Unicode Private Use Area, or a font whose name says it is one ("Material Symbols", "Font Awesome", "…icons"); text hidden the sr-only way does not count as content. The parts of a multi-color icon count against each other, so a white glyph on its own colored disc passes | controls with visible text; icons smaller than 8 px or larger than 64 px; logos (`logo` or `brand` in the alt text, the address, the class or the id); disabled controls (`disabled`, `aria-disabled="true"`), recorded as exempt and counted in the coverage note; native controls the browser draws (checkboxes, radio buttons, selects, date fields), which are never candidates, because their look is the user agent's | none |

**Facts in the snapshot.** The collector records what it measured as additive fields on `native`, so `schemaVersion` stays 1 and a saved snapshot is judged again offline:

| Field | Where | What it holds |
|---|---|---|
| `pixelContrast` | each measured node | By kind (`text`, `placeholder`, `icon`): measured, unmeasured with the reason, or exempt; axe-core's reason key; the font size and weight; the text's color and where it came from (`css` or `pixels`); the most common color behind the glyphs and those with the lowest and highest contrast; the highest and lowest contrast; the glyph pixels compared; the stroke width; and the opacity, when below 1 |
| `pixelContrastRun` | the root | The limits per kind, and how many candidates were found, measured and left out, and whether the limit or the time budget stopped it |

The collector also keeps axe-core's reason key on each `color-contrast` result (`reasonKey`, such as `bgImage`).

**Budget.** At most 20 texts, 10 placeholders and 20 icons per page, in document order, and 6 s for all of them. What is left out is counted. Undecided texts that were left out stay in axe-core's review, and the coverage line says how many, for example `rampa/pixel-contrast (20 applicable, 3 failed, 5 to review; experimental; 57 not measured: the page's time budget ran out)`. Each element costs three screenshots of its box. On the pages below, the measurement took about 0.4 s on Rampa's site (3 elements), 2.6 s on nasa.gov (28) and 6 s, the budget, on stripe.com. `collectWeb` takes `pixelContrast: false` to turn it off, or other limits and another budget; `collectPage` takes `pixelContrast: false`. The CLI has no flag for it.

**A narrow rule.** Icon-only controls are one kind of content among many that 1.4.11 covers. On a page with none, `rampa/icon-contrast` says nothing, and 1.4.11 stays "not checked", never "no applicable content" (`narrow` in `RuleCheck`). The same holds for the two 1.4.3 rules on a page with nothing to measure.

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
| `pixel-contrast` · afw4f7 | 34 | 1.00 / 0.73 | 1.00 / 0.27 | 1.00 / 1.00 |
| `pixel-contrast` · 09o5cg, passed and inapplicable pages | 22 | none flagged | none flagged | none flagged |

- **b4f0c3.** axe-core misses Failed Examples 3 and 7 of the second version of the rule in the ACT file: `user-scalable=invalid` and `maximum-scale=invalid`. The rule finds both, and flags no passed or inapplicable page.
- **bc659a.** The test cases are all meta elements, so the header rule never fires on them. What this set measures is that collection survives the two immediate redirects (Passed Examples 1 and 2), which now land on github.com and w3.org and are recorded. A local server in `test/rules-web.test.ts` checks the header itself: a timed header fails, and an immediate one is recorded.

- **d0f69e.** axe-core's `th-has-data-cells` never fails a page, so it finds none of the three failed examples. The rule finds all three and flags none of the passed or inapplicable examples.
- **afw4f7.** axe-core fails 8 of the 11 failed examples and leaves the other three undecided: Failed Example 2 (`#AAA` on a white-to-blue gradient), 3 (`#555` on a dark photograph) and 7 (translucent gray across a white and black split). The pixel rule fails all three, at 2.31:1, 2.72:1 and 4.23:1, and flags none of the 11 passed and 11 inapplicable examples. The passed examples axe-core leaves undecided, `#333` on a gradient and `#ccc` with a dark text shadow on the photograph, measure 5.08:1 and 5.50:1 at their lowest. SVG text (Inapplicable Example 4) is measured from its fill, at 21:1. The two sets share several pages under different addresses, and each set measures its own copy.
- **09o5cg.** It asks for 7:1, the enhanced level, so its failed examples may still meet 4.5:1. Only its passed and inapplicable examples measure the rule (`actPassedOnly`): none is flagged.
- **Review is not a flag here.** `rampa eval --rules` counts a rule's review hit as flagging the page, except for rules whose review only means that the measurement could not decide (`undecidedReview`), as for axe-core's own incompletes. The pixel rules are such rules. The command lists the pages they sent to review, apart. In the run above there were none.
- **Other rules' pages.** Every rule also ran on the 73 test pages of ACT a25f45, bc4a75, ff89c9 and 6cfa84, which test other failures. Nothing failed on a passed or inapplicable page. a25f45 Passed Example 6, a table that holds only headers, goes to review, not to failure. The hits on a25f45 Failed Examples 1 and 3 are true d0f69e failures: their `headers` attributes point at ids that do not exist, or at the cell itself.

The fixtures in `test/fixtures/rules/` come in pairs of three pages:

- `content-fail.html` and `structure-fail.html`: one planted failure for each rule, each found exactly once;
- `content-pass.html` and `structure-pass.html`: the same page fixed, with nothing reported;
- `content-controls.html` and `structure-controls.html`: near misses, each of which looks like a failure and is not, with nothing reported. They include the d0f69e passed examples, a table where `role="presentation"` loses to `aria-label`, and an id used twice with the same text.

The pixel rules have one page per kind, each with failing, passing and near-miss cases side by side. The colors keep a margin of at least 0.15 from each threshold, so the outcomes hold whatever font a platform draws the text in:

- `contrast-text.html`: gradients, striped background images, a picture under the text and a pseudo-element; near misses at 4.29:1 (fails) and 4.66:1 (passes); 3.25 to 3.45:1 at 24 px (passes) and at 16 px (fails); and text half on white, half on black (review);
- `contrast-placeholders.html`: placeholders at 1.61, 1.92 and 4.29:1 (fail) and at 4.95 and 7.46:1 (pass); 3.45:1 at 24 px (passes); a disabled field and a filled one, which are not measured;
- `contrast-icons.html`: svg, img and visually-labeled icons at 1.42 to 2.81:1 (fail) and 3.23 to 8.39:1 (pass, one of them a white icon on the link's own dark disc); a disabled control, exempt; a button with text, a logo, a photo link and a checkbox, which are not candidates;
- `contrast-scroll.html`: text a script fades out as the page scrolls, which must be measured as the page loaded;
- `contrast-moving.html`: text over a canvas redrawn every frame, which goes to review.

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

### Real pages: the pixel rules

On 2026-10-09 the pixel rules ran with `rampa check <url> --no-llm --min-confidence low` on three public pages: Rampa's own site, and two pages with text over images and gradients.

| Page | Candidates (measured) | Failures | Review | Read by hand |
|---|---|---|---|---|
| rampa.guilhermebs.com.br | 2 texts (2 measured), 1 icon (1) | none | the "1 : 12" label of the hero drawing: not shown when the page loads | Right: the label appears only as the drawing animates with the scroll. The caption over the drawing measures 7.0:1 with its style sheet color; before the page's scroll was put back after each element, it read as a fade under way. The theme button's icon measures 12.9:1 |
| www.nasa.gov | 40 texts (20 measured), 1 placeholder (1), 7 icons (7) | none | 8 texts and 2 icons over the hero: what is behind them moves | Right: a video plays behind the hero. The 12 card texts over photographs, white on a dark overlay, measure 5.18:1 to 20.62:1 at their lowest; the search placeholder, `#757575` on a black field, 4.56:1; the 5 footer and image icons, 4.74:1 to 13.52:1. 20 texts were past the limit and stay in axe-core's review |
| stripe.com | 77 texts (20 measured), 8 icons (4 measured, 1 disabled) | 3: "in payments volume processed in 2025", "for Stripe services" and the link "historical uptime", `#7d8ba4` on a lavender gradient at 16 px, weight 300, 2.98:1 to 3.05:1 | 5: the hero heading and subheading, twice each, and the "Pricing" menu link, over the animated gradient canvas | The failures are true while those statistics are dimmed: the section highlights one statistic at a time and dims the other three, so the dimmed state is what most visitors read. The same gray in the 48 px figures passes as large text (3.04:1 to 3.10:1 at their lowest). The reviews are right to be reviews: the canvas changes between captures. The time budget left 57 texts and 3 icons unmeasured |

What these runs changed: the page's scroll is put back after each element and only moved when needed (Rampa's hero caption read as half faded), it is put back instantly (nasa.gov scrolls smoothly, so the next captures were taken mid-scroll), the box is captured twice as rendered (Stripe's hero canvas passed for glyphs), and a style sheet color that the pixels contradict is not used (a link captured during its color transition read at 1.18:1). The pixel rules found 3 failures on these pages, all true, and no false positive; like every rule they stay experimental until the gate in the plan is met.

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
  resolves?: readonly string[]     // axe-core rules whose undecided results the rule settles
  narrow?: boolean                 // one kind of content among many: silent where there is none
  actPassedOnly?: readonly string[] // ACT rules for a stricter requirement: only their passed pages count
  undecidedReview?: boolean        // its review means "could not decide": the eval does not count it as a flag
  help: Text
  helpUrl: string
  run(snapshot, engine, ctx): { hits: Hit[]; applicable: number; resolved?: string[]; note?: string }
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

A run may also return `resolved`, the refs of the axe-core results it settled (with `resolves`), and `note`, what limits its result, such as elements left out past a budget. The note follows the rule's counts on its coverage line.

The registry is `RULE_CHECKS` in `src/rules/index.ts`, re-exported from `src/engine/rules.ts` next to the tree rules of the native surfaces. Adding a rule takes four steps:

1. Write the rule in `src/rules/`.
2. Add it to the registry.
3. Give it failing, passing and near-miss cases in `test/fixtures/rules/`.
4. List its ACT rules, when they exist, so that `rampa eval --rules` measures it.

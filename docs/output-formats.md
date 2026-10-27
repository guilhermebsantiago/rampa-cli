# Output formats and exit codes

`rampa check` writes the same report in five formats: `pretty` for the terminal, `json` for other tools, `sarif` for code scanning, `markdown` for pull request comments and `html` for a file you can attach to a ticket. Every format states what was checked, what was judged and what nobody checked. None of them says a page is accessible.

## Choosing formats

`--format` picks what goes to the terminal, or to `-o`. `--json`, `--sarif`, `--markdown` and `--html` write more formats to their own files in the same run, in any combination.

```sh
rampa check site/                                    # pretty, in the terminal
rampa check site/ --format markdown                  # Markdown, in the terminal
rampa check site/ --format sarif -o rampa.sarif      # SARIF to a file, nothing in the terminal
rampa check site/ --sarif rampa.sarif --markdown rampa.md --html rampa.html   # pretty in the terminal, three files
```

| Flags | Terminal | Files |
| --- | --- | --- |
| `--format pretty` (default) | pretty | |
| `--format pretty -o report.json` | pretty | JSON, as before: pretty is for a terminal, so `-o` gets JSON |
| `--format <json\|sarif\|markdown\|html>` | that format | |
| `--format <json\|sarif\|markdown\|html> -o <file>` | nothing | that format |
| `--json <file>`, `--sarif <file>`, `--markdown <file>`, `--html <file>` | unchanged | one more file each |

Folders for output files are created when missing. `--locale pt-BR` writes Markdown and HTML in Portuguese, and the messages in SARIF. JSON always has both lists, `belowThreshold` and `waived`.

## The confidence threshold and experimental checks

`--min-confidence` (default `medium`, or `minConfidence` in the config) splits the findings: those at or above it are confirmed, and the rest are below the threshold. A check that has not passed the evaluation gate is experimental, and its findings are below the threshold unless `--min-confidence low`. Every report records the threshold, and every format says how many findings are below it and what the threshold was:

- **pretty:** a note such as "3 finding(s) below the confidence threshold (medium) are not listed; --verbose shows them." With `--verbose` they are listed after the confirmed findings, under the heading "Below the confidence threshold (medium): not confirmed failures; only --fail-on any counts them", each one marked `~` instead of `✗` and tagged "below the confidence threshold (medium)", and the note says they are listed.
- **Markdown and HTML:** the same note; with `--verbose` each such finding is listed and tagged "below the confidence threshold (medium)".
- **JSON:** `minConfidence` on the report, and `failOn`, the `--fail-on` policy the run gated on (set by `rampa check`).
- **SARIF:** `minConfidence` and `failOn` in the run's properties, and each page's `belowThreshold` count in its coverage. Findings below the threshold are results (level `note`) with `--verbose`, and also without it when `--fail-on any` counts them; otherwise a `below-threshold` notification counts them.

A finding is experimental (`experimental: true` in JSON) when the method behind it is, whatever its source: an experimental Rampa rule (all of them, for now), axe-core's `target-size`, an experimental judgment module (1.3.1, 1.3.2, 1.3.3, 2.5.3 and 3.3.1, asked for with `--criteria`, and 2.4.3 over the focus-order probe), a probe rule, or a judgment over a probe's facts. pretty, Markdown and HTML tag it "experimental" next to its confidence. The coverage says the same per method (`maturity` in JSON and SARIF, "experimental" after a method's counts), and the lines "Checked by Rampa rules" and "Judged with verified evidence" read "(partial, experimental)" and "(experimental)" when every method behind them is experimental, or list the experimental criteria apart ("3.1.1; experimental: 1.1.1, 2.4.2") when only some are.

Each finding also says what found it: an axe-core rule ("rule image-alt (axe-core)"), a Rampa rule ("Rampa rule rampa/placeholder-alt"), a probe rule ("probe rule rampa/reflow"), or a model ("evidence verified", with the votes).

## Exit codes and `--fail-on`

| Code | Meaning |
| --- | --- |
| `0` | Nothing fails the `--fail-on` policy |
| `1` | At least one finding fails the policy |
| `2` | Rampa could not vouch for the run: a usage or configuration error, a page that did not load, a bot check or a refusal sent in place of the page, a model that failed on every candidate of a criterion, or judgment asked for and nothing judged |

| `--fail-on` | Exits `1` when there is |
| --- | --- |
| `confirmed` (default) | a confirmed finding: one at or above `--min-confidence` |
| `any` | any finding, also below `--min-confidence` |
| `A` | a confirmed finding on a Level A criterion |
| `AA` | a confirmed finding on a Level A or AA criterion: anything that blocks AA conformance |
| `none` (or `never`) | never; only errors exit `2` |

The levels are read in any case, so `--fail-on aa` works. Waived findings never count. A [group of near-identical findings](#groups-of-near-identical-findings) changes none of this: each of its members is counted as a finding, so a group fails the run exactly when one of its members does. With `A` or `AA`, a finding on a rule outside WCAG A/AA does not fail the run; with `confirmed` it does. What needs review never fails a run, and neither does a finding beyond the target (a WCAG 2.2 criterion in a `--wcag 2.1` run).

A usage error, such as an unknown `--format`, exits `2`. Earlier versions exited `1` there, which CI could not tell apart from a failure on the page. So does an error while Rampa's modules load, such as a broken install.

A config file is checked when it loads: a value Rampa cannot use (`"minConfidence": "hgih"`) or a key it does not know (`"failOn"`, which only the command line sets) exits `2` with a message that names the key and what it takes. Earlier versions ignored both, and an unknown threshold hid every finding, so the gate passed whatever the page had.

**Nothing judged.** When judgment is on (no `--no-llm`), the page has candidates that need a model, and the model judged none of them, the run exits `2`, whatever `--fail-on` says: `--offline` with nothing in the cache, no model found, or `--time-limit` run out before the first answer. A note in the report and a line on stderr say how many candidates were left and why, and SARIF marks the run as not successful. Pass `--no-llm` to gate on the deterministic layer alone; a page with nothing to judge, and a run where the model judged some candidates and not others, exit as usual, with notes on what was left.

**A page cut at the collector's limit.** The collector reads at most 5,000 elements of a page's own document (and as many again in its shadow roots and frames). On a longer page, such as a shop listing with a filter sidebar, it stops there, and the snapshot records `truncated: true` and `elementLimit`. Every report then says so in its notes, in its language: "The page was cut at 5000 elements, the collector's limit: what comes after them is not in the snapshot, so the checks that read the snapshot (Rampa's rules and judged criteria) did not run past that point. Checked only up to the cut: 1.1.1, 2.4.6, 4.1.2. axe-core read the whole page." The criteria listed are those Rampa's rules or judgment checked on the page; with probes, the note adds that what a probe found past the cut could not be pointed at. JSON has `coverage.truncated` (`elements` and `criteria`), SARIF the same with the `note` in the page's coverage properties and in its coverage notification, pretty, Markdown and HTML the note. A snapshot recorded before the collector kept its limit gives the number of the page's own elements it holds.

**A bot check in place of the page.** A site behind bot protection often answers an automated browser with a challenge page, a captcha or a short "Access denied" page instead of its content. Rampa recognizes one by strong signs only: a response header that names a challenge (Cloudflare's `cf-mitigated: challenge`), or, on a short page, a vendor's challenge script, form or frame (Cloudflare, DataDome, HUMAN, Imperva, AWS WAF, Amazon's captcha), an Akamai reference number, a challenge page's title ("Access to this page has been denied", "Prove your humanity"), or an HTTP refusal (403, 429). A site's own page that merely loads a vendor's script is checked as usual. It does not read that page, since its findings would be about the vendor's page and say nothing of the site: every criterion is not checked, no probe and no check of the cognitive profile runs, the headline of every format says "Nothing on this page was checked", the run exits `2`, stderr says so, and the first note says what the site sent and what gave it away, for example "The site sent a bot check (Cloudflare) in place of the page, with HTTP 403 (the response header cf-mitigated: challenge)." JSON has `blocked` (`kind`, `vendor`, `evidence`, `detail`, `status`, `title`), as does the snapshot. Rampa never solves or gets around a bot check; if the site is yours, let the machine that runs Rampa through, or check a copy without the protection.

**An error page.** When the server answers the address with an HTTP error (a 404 page, say) and the page is not a bot check, Rampa checks the page that came, and the first note says with which status: "The server answered HTTP 404 for this address: what was checked is the page that came with that status, an error page, not the page the address names." JSON has `httpStatus`. The exit code is as usual.

**An engine that stops.** If axe-core stops with an error on a page (it did on an element whose properties a page script had masked), the rest of the check still runs, the engine's rules count as not run, and a note gives the error; the engine results record it as `error`.

**A page read without its stylesheets.** When the stylesheets a page links did not apply (a request that failed or was refused, a sheet with no rules), the page is loaded once more. If none of them, or none of the page's own, applies even then, the snapshot records it (`reach.stylesheets`, with `unstyled: true` and `retried: true`), the first note says so, every judgment that rests on what is visible is listed as the model's suggestion instead of a finding, and contrast and label visibility are not measured from pixels. An unstyled page is not what people see: www.ufpe.br's theme CSS did not apply once in the third real-page study, a hidden type-ahead list of 1,628 links became visible, and 50 "ambiguous link" findings followed. A stylesheet that failed on a page otherwise styled is recorded too (`reach.stylesheets.failed`), with a note and no other effect. A page with no author stylesheet at all, the browser's default body look (16 px Times, black) and at least 150 elements is unstyled too: it is loaded once more and then read the same way. In the fourth real-page study, www.museudoamanha.org.br served the automated browser such a page. A stylesheet link that resolves to the page itself does not count as a stylesheet that failed.

**A layer over the viewport.** A consent banner's backdrop or a dialog that lies over most of the viewport (on top at seven or more of nine points sampled, out of the flow or hosting a shadow root, holding little of the page's text) is recorded (`reach.overlay`) and hidden while images, labels and contrast are captured, so the pixels measured are the page's own: www.ed.ac.uk's consent backdrop, in a closed shadow root, had dimmed every pixel the contrast rules measured.

## Groups of near-identical findings

On real pages, almost every false finding Rampa reported came from one page that repeated one claim dozens of times: 50 2.4.4 findings "shared by N links" from one hidden menu on www.toolstation.com, 50 more on www.ufpe.br ([notes](studies/notes-precision-check.md)). True findings come in bursts too: eight images with a file name for an alternative are one pattern to fix. Every report shows such a burst once, as a group a person reviews together: if its example is a false positive, check whether the others share the mistake; if it is right, one fix may cover them all.

**What makes a group** (`src/core/groups.ts`). On one page and in one list (`findings`, or `belowThreshold`), findings form a group when more than five of them, so six or more, have all of:

- the same criterion: `criterion`;
- the same check: the rule's id (`ruleId`) for an engine, Rampa or probe finding, such as `color-contrast` or `rampa/placeholder-alt`; `judgment/<criterion>` for a model's judgment (`source: "judgment"`), such as `judgment/2.4.4`;
- the same claim kind: `claim`, a field judgment findings now carry. It is the model's `problem` where the criterion's answer names one: 1.1.1's question about an alternative (`filename_or_placeholder`, `generic`, `wrong_content`, `missing_information`, `decorative`), 2.4.2 (`generic`, `filename_or_url`, `mismatch`), 2.4.4 (`generic`, `url_or_filename`, `mismatch`, `ambiguous`), 2.4.6 (`generic`, `mismatch`, `placeholder_text`), 3.3.1 (`field_not_identified`, `cause_not_described`, `hidden_from_assistive_technology`) and 3.3.2 (`no_visible_label`, `rule_not_explained`); or its `relation` for 1.3.2 (`sequence`, `heading`, `sentence`, `grouping`, `table`); never `none`. The other judgments (3.1.1, 3.1.2, 1.1.1's question about a hidden image, and the rest) and every rule have no `claim`: their check makes one kind of claim, and the check alone decides.

Five findings stay findings on their own, and findings on two pages, in two lists, of two criteria, two checks or two claims never share a group. The definition is fixed in advance, and the real-page studies count by it.

**What does not change.** A group is a way of showing findings, never a filter:

- Every member stays in `findings` (or `belowThreshold`) exactly as it was, with its id, evidence and patch, so what reads findings (CI gates, `--fail-on`, the GitHub Action, the baseline, waivers, Rampa Lab's review mode) reads them as before. A group of 50 confirmed findings is 50 confirmed findings, each checked like any other.
- The exit code and `--fail-on` count each member: a group fails the run whenever one of its members would.
- `rampa eval` scores each ACT test case from the findings, one per element, so its numbers do not move. `test/finding-groups-eval.test.ts` runs the eval's scoring on pages with a burst, with grouping and with grouping taken out, and gets the same records and scores.
- Counts in headlines are counts of findings, with a clause for the groups: "16 confirmed findings on 1 page checked against WCAG 2.2 A/AA: 13 at Level A, 3 at Level AA. 8 of them are in 1 group of near-identical findings, listed once."
- A waiver names one finding. To dismiss a group, waive each member; every format lists their ids.
- Waived findings are never grouped.

**How each format shows a group.** Every format says what the group is ("8 near-identical findings, grouped to review together"), why ("Same check (judgment/2.4.4) and same claim (generic) on 8 elements of this page, so a person can review them together"), and that each member is still a finding ("Each one is a finding of its own, checked and counted like any other"), in English or Portuguese ("8 achados quase idênticos, agrupados para revisar juntos").

- **pretty:** one entry under its criterion, the first member as the example, shown as any finding is, then the elements with their ids: the first ten, and all of them with `--verbose`, then the group's id. A group below the threshold, listed with `--verbose`, is marked `~` like its members.
- **Markdown:** one block, with the example's diff, and every element (up to 100) with its id in a `<details>`. A group is one of the five blocks a page shows before the rest fold, and the fold's summary counts the findings it holds, members included.
- **HTML:** one item with the example inside, and the elements in a `<details>`.
- **JSON:** `groups`, below.
- **SARIF:** one result per group, below.
- **MCP** (`check_page`, `check_html`): `findings` lists a group once, by its example, which gets a `group` field with the group's id, and the group takes one place against `max_findings`. `groups` lists each group: `id`, `criterion`, `check`, `claim`, `count`, `example`, and `members`, each with its `id`, `selector` and what it is `about` (the link text, the alternative, or its evidence). `summary.findings` still counts every member, and `summary.groups` counts the groups. `explain_finding` takes any member's id. The text block says the same in words, with up to 20 elements.
- **`rampa site`:** a page's own bursts show as groups in the page-by-page part; in the part about findings on several pages, more than five judgments with the same criterion, check and claim on the same pages print as one block.

**JSON.** A report has `groups` when a group formed, and no `groups` field otherwise:

```json
"groups": [
  {
    "id": "g-72f2ca9f4e63",
    "list": "findings",
    "criterion": "2.4.4",
    "level": "A",
    "source": "judgment",
    "check": "judgment/2.4.4",
    "claim": "generic",
    "count": 8,
    "members": ["1af8a73e209d", "cb28876e7301", "147d2b906002", "a44645d29c92", "840cf65fe3fa", "b7b02a47b8a8", "f03047096a64", "b40081e119cd"],
    "example": "1af8a73e209d"
  }
]
```

`members` are the members' fingerprints in the list's order, and `example` is the first. `id` hashes the list, criterion, check and claim, so the same group keeps its id from run to run whichever elements it holds; it is never a finding's id, and a waiver of it does nothing. `rampa check` computes the groups from the lists it writes, after a baseline left out what it already had, so a group names only findings that are in its list. [schema/report.schema.json](../schema/report.schema.json) describes the report, its findings and its groups. **The schema version stays 1**: `groups` and `claim` are new fields, every field a version-1 reader used is where it was and means what it meant, and Rampa Lab refuses any version other than 1.

**SARIF.** A group is one result, located at its example, with every member a related location. SARIF 2.1.0 has room for several locations on one result only when "the condition indicated by the result ... can only be corrected by making a change at every location specified" (§3.27.12), which is not so for elements that each fail on their own, and GitHub code scanning reads only a result's first location. Related locations are "relevant to understanding the result" (§3.27.22): each member is one, with `id` 1, 2, …, its region in the file or its selector, and a message with its own text and id. The result's message links to the first ten (`[selector](1)`, §3.11.6) and lists the ids a waiver takes, up to 100. Its level is the strictest of its members': `error` when any member fails the gate, as `rampa check` exits `1` then. Its properties have `group` (`id`, `list`, `check`, `claim`, `count`), `findingIds`, `failsGate`, and `maturity` (`mixed` when only some members are experimental). It carries no `fixes`: each member's patch is a change of its own, and the JSON has every one. `partialFingerprints["rampa/v1"]` hashes the page, the criterion, the check and the claim. The run's coverage lists each page's `groups`.

What this means in code scanning: a burst is one alert instead of one per element, and dismissing it there dismisses the group. When a repository first uploads a report with groups, the earlier per-element alerts of each group are no longer reported and close, and when a group falls to five members or fewer, its alert closes and its members come back as alerts of their own. Code scanning calls a closed alert fixed; here it only means the results were regrouped, so read the newest report before taking an alert as fixed.

## Where a finding is in the source

For a local page (an `.html` file, a folder of them, or a snapshot recorded from one), each finding gets the file and the line and columns of its element, and its patch becomes an edit of the file. Paths are relative to the repository root (the closest folder with `.git`), or to the working directory outside a repository, so they match what GitHub shows.

The snapshot holds the page as the browser built it, which is not always what the file says. Rampa finds the element by what it shares with its tag in the file: the tag name and the attributes the collector keeps (`id`, `class`, `href`, `src`, `alt`, `lang`, the ARIA names and a few more). The k-th element with that signature in the snapshot is the k-th tag with it in the file. Rampa would rather leave an element without a line than give it a wrong one, so it drops every pair of a signature when:

- the counts differ, because a script added or removed elements (an element's full start tag can still single it out when no other element shares it);
- the order disagrees with the file, because the parser moved content (a link misplaced inside a table) or a script moved elements;
- an element with twins, or any element of a truncated snapshot, records other attributes or another text than its tag in the file.

An element in a frame or a shadow root (a ref with ` |> ` or ` >>> `, see [docs/api.md](api.md#frames-and-shadow-roots)) gets no line: a frame's document is another file or a `srcdoc`, and a shadow root is built by script. The page title, which 2.4.2 anchors to the page, is found at its `<title>`.

A fix is made only when the file still says what the patch replaces: the attribute value, or the plain text of the element. A link whose text is split by markup keeps its location but gets no fix. Remote pages have no file: their findings are located by address and CSS selector.

## JSON

The report as before: one object for one page, an array for several, with these optional fields.

- `sourceFile` on a report: the local file behind the target, relative as above.
- `minConfidence` and `failOn` on a report: the threshold that split `findings` from `belowThreshold`, and the `--fail-on` policy of the run.
- `experimental` on a finding: the method behind it has not passed the evaluation gate (see above).
- `claim` on a judgment finding, and `groups` on a report: the kind of claim, and the [groups of near-identical findings](#groups-of-near-identical-findings) on the page. [schema/report.schema.json](../schema/report.schema.json) describes the report; its version stays 1.
- `location` on a finding: `file`, `startLine`, `startColumn`, `endLine`, `endColumn` (1-based, end column exclusive, in UTF-16 code units as in SARIF), the source `snippet` when the region is 500 characters or less, and `fix` when the patch applies to the file: the `region` to replace, the `text` to put there, and the element `before` and `after`.

## SARIF

[SARIF 2.1.0](https://docs.oasis-open.org/sarif/sarif/v2.1.0/sarif-v2.1.0.html), the format of GitHub code scanning and of IDE viewers such as the SARIF extension for VS Code. A test validates the output against the official OASIS schema.

- **Rules.** One per WCAG success criterion, such as `WCAG-2.4.4` (`LinkPurposeInContext`), with its level in the description and the tags (`wcag-a`, `wcag-aa`), and `helpUri` pointing to W3C's Understanding page. A finding from an axe-core rule outside WCAG A/AA keeps the rule's own id.
- **Results.** The message, the evidence and the finding id (the one waivers use), with brackets escaped as SARIF requires of plain text. The level follows the run's gate, so code scanning blocks on what `rampa check` exits `1` for: `error` for a finding that fails `--fail-on` under the run's `--min-confidence`, `note` for one below the threshold that does not, and `warning` for any other finding reported (on a level `--fail-on A` or `AA` leaves out, or with `--fail-on none`). With the default `--fail-on confirmed`, every confirmed finding is an `error`, medium confidence included; earlier versions made medium a `warning` while the run still failed on it. A waived finding (with `--verbose`) is suppressed, at `note` or `warning` by the threshold. Properties carry the source (engine, rule, probe or judgment), the confidence, `maturity` (`stable` or `experimental`) and `experimental`, `failsGate`, the votes, the model, the rule and its help page, and the patch as text.
- **Rules.** Besides its tags, a rule's properties say the `maturity` of its results in the log: `stable`, `experimental` (also added as an `experimental` tag), or `mixed` when both share the criterion.
- **Locations.** For a local page, the file relative to `%SRCROOT%` (the repository root) with the line and columns of the element and its source as the snippet. For a remote page, the URL. Both carry a logical location: the CSS selector of the element.
- **Fixes.** The patch as a replacement in the file, when it applies (see above).
- **Fingerprints.** `partialFingerprints["rampa/v1"]` hashes the page, the criterion, the rule and the element's selector. It survives a model quoting different words and the element moving to another line, so code scanning keeps tracking one alert. A change in the structure around the element, such as a new sibling of the same tag before it, changes the selector, and code scanning then sees a new alert.
- **Coverage.** Each page gets a `note` notification with its coverage statement, and `runs[0].properties.coverage` lists what the engine checked, what was judged, what needs review and what was not checked, with each criterion's status, each method's `maturity`, the page's `minConfidence` and `belowThreshold` count, and the run's `wcagTarget`. What axe-core could not decide is counted there (`needsReview`), never as a result, since code scanning would show it as an alert. A log without results still says what nobody checked. A page where judgment was asked for and nothing was judged gets an `error` notification (`nothing-judged`) and a `notJudged` count, and the invocation is not successful. A page the collector cut at its limit of elements has `truncated` in its coverage (`elements`, `criteria`, `note`).
- **Suppressions.** With `--verbose`, waived findings are included with an external, accepted suppression.
- **Groups.** A [group of near-identical findings](#groups-of-near-identical-findings) is one result at its example, with every member a related location.

GitHub code scanning shows results located in files of the repository. Results for remote pages are valid SARIF, but GitHub has no file to show them on; for a deployed site, read the Markdown or HTML report instead.

## Markdown

Made for a pull request comment, and readable as a file:

```
WCAG 2.4.4 (A) — examples/store/before.html:31
The link text "Click here" does not tell where the link goes, and nothing around it does.
- <a href="shipping.html">Click here</a>
+ <a href="shipping.html">View shipping information</a>
Evidence: "Click here" · confidence high · 1/1 runs · evidence verified · id 1af8a73e209d
```

- It starts with a hidden marker, `<!-- rampa-report -->`, so a bot can find its earlier comment and edit it instead of posting a new one.
- A summary line counts the confirmed findings by level, then each page with findings gets one block per finding: the criterion and level (linked to W3C's Understanding page), `file:line` or the selector, the message, the patch as a `diff` against the source as written, the evidence, the confidence, "experimental" when it is, what found it and the id.
- A [group of near-identical findings](#groups-of-near-identical-findings) is one block, with its elements in a `<details>`.
- A page's findings past the fifth fold into a `<details>`. The report stays under 60,000 characters, below GitHub's limit for a comment: notes, coverage rows and pages without findings are listed up to 20 each, and findings that do not fit are counted and left to the SARIF, JSON and HTML reports.
- Notes, the coverage of the run and the statement that the report does not declare the page accessible come at the end, then how to waive a false positive.
- Text from the page is escaped: it cannot add Markdown or HTML, mention a person (`@name`) or reference an issue (`#12`, `GH-12`). An address in it still becomes a link, as GitHub does with any text.

## HTML

One file with everything inline: no script, no font or stylesheet to fetch, so it opens offline and can be attached to a ticket. It follows the reader's light or dark preference, prints cleanly, and works without JavaScript; folded parts use `<details>`.

It holds itself to what it reports: landmarks, one `h1` and a heading per criterion, tables with captions and header cells, a skip link, and text colors at 4.5:1 or more in both themes. A test runs axe-core on it in light and dark mode at 1280 and 320 pixels, and checks that the page never scrolls sideways. `rampa check --no-llm` on a generated report finds nothing.

## False positives

Every report prints a finding id, the `fingerprint` in JSON. To dismiss a finding on purpose, add it to `.rampa/waivers.json` in the directory where `rampa check` runs, and commit the file so the decision is reviewed like code:

```json
[
  { "fingerprint": "1af8a73e209d", "reason": "The card heading names the product, so the link text is clear in context" }
]
```

Rampa reads `fingerprint` and ignores the other fields, so `reason` is free. A waived finding leaves the report and the exit code; the report counts the waived ones.

## From code

The formats are part of the package's API:

```ts
import { checkSnapshot, locateReport, readPageSource, renderHtml, renderMarkdown, toSarif } from 'rampa-cli'

const report = await checkSnapshot(snapshot, engine, options)
const source = await readPageSource(snapshot.target, process.cwd())
const located = source ? locateReport(report, snapshot, source) : report
const sarif = toSarif([located])
const markdown = renderMarkdown([located], { maxLength: 30_000 })
const html = renderHtml([located])
```

`checkSnapshot` sets `groups` on the report it returns. A program that changes a report's lists afterwards (a filter of its own, say) gets the groups of what is left from `withGroups(report)`, or the list alone from `findingGroups(report)`; `formatReports('json', reports, options)` does it before writing.

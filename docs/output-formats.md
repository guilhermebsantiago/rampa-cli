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

Folders for output files are created when missing. `--locale pt-BR` writes Markdown and HTML in Portuguese, and the messages in SARIF. `--verbose` shows the findings below the confidence threshold in the pretty, Markdown and HTML reports (marked as such) and in SARIF (as notes), and adds the waived findings to SARIF; JSON always has both lists, `belowThreshold` and `waived`.

## Exit codes and `--fail-on`

| Code | Meaning |
| --- | --- |
| `0` | Nothing fails the `--fail-on` policy |
| `1` | At least one finding fails the policy |
| `2` | Rampa could not vouch for the run: a usage or configuration error, a page that did not load, or a model that failed on every candidate of a criterion |

| `--fail-on` | Exits `1` when there is |
| --- | --- |
| `confirmed` (default) | a confirmed finding: one at or above `--min-confidence` |
| `any` | any finding, also below `--min-confidence` |
| `A` | a confirmed finding on a Level A criterion |
| `AA` | a confirmed finding on a Level A or AA criterion: anything that blocks AA conformance |
| `none` (or `never`) | never; only errors exit `2` |

The levels are read in any case, so `--fail-on aa` works. Waived findings never count. With `A` or `AA`, a finding on a rule outside WCAG 2.1 A/AA does not fail the run; with `confirmed` it does.

A usage error, such as an unknown `--format`, exits `2`. Earlier versions exited `1` there, which CI could not tell apart from a failure on the page.

## Where a finding is in the source

For a local page (an `.html` file, a folder of them, or a snapshot recorded from one), each finding gets the file and the line and columns of its element, and its patch becomes an edit of the file. Paths are relative to the repository root (the closest folder with `.git`), or to the working directory outside a repository, so they match what GitHub shows.

The snapshot holds the page as the browser built it, which is not always what the file says. Rampa finds the element by what it shares with its tag in the file: the tag name and the attributes the collector keeps (`id`, `class`, `href`, `src`, `alt`, `lang`, the ARIA names and a few more). The k-th element with that signature in the snapshot is the k-th tag with it in the file. Rampa would rather leave an element without a line than give it a wrong one, so it drops every pair of a signature when:

- the counts differ, because a script added or removed elements (an element's full start tag can still single it out when no other element shares it);
- the order disagrees with the file, because the parser moved content (a link misplaced inside a table) or a script moved elements;
- an element with twins, or any element of a truncated snapshot, records other attributes or another text than its tag in the file.

An engine result on an element outside the snapshot (in a shadow root or a frame) gets no line. The page title, which 2.4.2 anchors to the page, is found at its `<title>`.

A fix is made only when the file still says what the patch replaces: the attribute value, or the plain text of the element. A link whose text is split by markup keeps its location but gets no fix. Remote pages have no file: their findings are located by address and CSS selector.

## JSON

The report as before: one object for one page, an array for several. Two optional fields are new.

- `sourceFile` on a report: the local file behind the target, relative as above.
- `location` on a finding: `file`, `startLine`, `startColumn`, `endLine`, `endColumn` (1-based, end column exclusive, in UTF-16 code units as in SARIF), the source `snippet` when the region is 500 characters or less, and `fix` when the patch applies to the file: the `region` to replace, the `text` to put there, and the element `before` and `after`.

## SARIF

[SARIF 2.1.0](https://docs.oasis-open.org/sarif/sarif/v2.1.0/sarif-v2.1.0.html), the format of GitHub code scanning and of IDE viewers such as the SARIF extension for VS Code. A test validates the output against the official OASIS schema.

- **Rules.** One per WCAG success criterion, such as `WCAG-2.4.4` (`LinkPurposeInContext`), with its level in the description and the tags (`wcag-a`, `wcag-aa`), and `helpUri` pointing to W3C's Understanding page. A finding from an axe-core rule outside WCAG 2.1 A/AA keeps the rule's own id.
- **Results.** The message, the evidence and the finding id (the one waivers use), with brackets escaped as SARIF requires of plain text. The level follows the confidence: `error` for high, `warning` for medium, `note` for low and for findings below the threshold. GitHub fails a pull request check on `error` by default, so only high-confidence findings block there unless you change that setting; Rampa's own exit code follows `--fail-on`. Properties carry the source (engine or judgment), the confidence, the votes, the model, the axe-core rule and its help page, and the patch as text.
- **Locations.** For a local page, the file relative to `%SRCROOT%` (the repository root) with the line and columns of the element and its source as the snippet. For a remote page, the URL. Both carry a logical location: the CSS selector of the element.
- **Fixes.** The patch as a replacement in the file, when it applies (see above).
- **Fingerprints.** `partialFingerprints["rampa/v1"]` hashes the page, the criterion, the rule and the element's selector. It survives a model quoting different words and the element moving to another line, so code scanning keeps tracking one alert. A change in the structure around the element, such as a new sibling of the same tag before it, changes the selector, and code scanning then sees a new alert.
- **Coverage.** Each page gets a `note` notification with its coverage statement, and `runs[0].properties.coverage` lists what the engine checked, what was judged and what was not checked. A log without results still says what nobody checked.
- **Suppressions.** With `--verbose`, waived findings are included with an external, accepted suppression.

GitHub code scanning shows results located in files of the repository. Results for remote pages are valid SARIF, but GitHub has no file to show them on; for a deployed site, read the Markdown or HTML report instead.

## Markdown

Made for a pull request comment, and readable as a file:

```
WCAG 2.4.4 (A) — examples/store/before.html:31
The link text "Click here" does not tell where the link goes, and nothing around it does.
- <a href="shipping.html">Click here</a>
+ <a href="shipping.html">View shipping information</a>
Evidence: "Click here" · confidence high · 1/1 runs · id 1af8a73e209d
```

- It starts with a hidden marker, `<!-- rampa-report -->`, so a bot can find its earlier comment and edit it instead of posting a new one.
- A summary line counts the confirmed findings by level, then each page with findings gets one block per finding: the criterion and level (linked to W3C's Understanding page), `file:line` or the selector, the message, the patch as a `diff` against the source as written, the evidence, the confidence and the id.
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
import { checkSnapshot, locateReport, readPageSource, renderHtml, renderMarkdown, toSarif } from 'rampa'

const report = await checkSnapshot(snapshot, engine, options)
const source = await readPageSource(snapshot.target, process.cwd())
const located = source ? locateReport(report, snapshot, source) : report
const sarif = toSarif([located])
const markdown = renderMarkdown([located], { maxLength: 30_000 })
const html = renderHtml([located])
```

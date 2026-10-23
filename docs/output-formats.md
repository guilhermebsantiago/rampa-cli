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

The levels are read in any case, so `--fail-on aa` works. Waived findings never count. With `A` or `AA`, a finding on a rule outside WCAG A/AA does not fail the run; with `confirmed` it does. What needs review never fails a run, and neither does a finding beyond the target (a WCAG 2.2 criterion in a `--wcag 2.1` run).

A usage error, such as an unknown `--format`, exits `2`. Earlier versions exited `1` there, which CI could not tell apart from a failure on the page. So does an error while Rampa's modules load, such as a broken install.

A config file is checked when it loads: a value Rampa cannot use (`"minConfidence": "hgih"`) or a key it does not know (`"failOn"`, which only the command line sets) exits `2` with a message that names the key and what it takes. Earlier versions ignored both, and an unknown threshold hid every finding, so the gate passed whatever the page had.

**Nothing judged.** When judgment is on (no `--no-llm`), the page has candidates that need a model, and the model judged none of them, the run exits `2`, whatever `--fail-on` says: `--offline` with nothing in the cache, no model found, or `--time-limit` run out before the first answer. A note in the report and a line on stderr say how many candidates were left and why, and SARIF marks the run as not successful. Pass `--no-llm` to gate on the deterministic layer alone; a page with nothing to judge, and a run where the model judged some candidates and not others, exit as usual, with notes on what was left.

**A page cut at the collector's limit.** The collector reads at most 5,000 elements of a page's own document (and as many again in its shadow roots and frames). On a longer page, such as a shop listing with a filter sidebar, it stops there, and the snapshot records `truncated: true` and `elementLimit`. Every report then says so in its notes, in its language: "The page was cut at 5000 elements, the collector's limit: what comes after them is not in the snapshot, so the checks that read the snapshot (Rampa's rules and judged criteria) did not run past that point. Checked only up to the cut: 1.1.1, 2.4.6, 4.1.2. axe-core read the whole page." The criteria listed are those Rampa's rules or judgment checked on the page; with probes, the note adds that what a probe found past the cut could not be pointed at. JSON has `coverage.truncated` (`elements` and `criteria`), SARIF the same with the `note` in the page's coverage properties and in its coverage notification, pretty, Markdown and HTML the note. A snapshot recorded before the collector kept its limit gives the number of the page's own elements it holds.

**A bot check in place of the page.** A site behind bot protection often answers an automated browser with a challenge page, a captcha or a short "Access denied" page instead of its content. Rampa recognizes one by strong signs only: a response header that names a challenge (Cloudflare's `cf-mitigated: challenge`), or, on a short page, a vendor's challenge script, form or frame (Cloudflare, DataDome, HUMAN, Imperva, AWS WAF, Amazon's captcha), an Akamai reference number, a challenge page's title ("Access to this page has been denied", "Prove your humanity"), or an HTTP refusal (403, 429). A site's own page that merely loads a vendor's script is checked as usual. It does not read that page, since its findings would be about the vendor's page and say nothing of the site: every criterion is not checked, no probe and no check of the cognitive profile runs, the headline of every format says "Nothing on this page was checked", the run exits `2`, stderr says so, and the first note says what the site sent and what gave it away, for example "The site sent a bot check (Cloudflare) in place of the page, with HTTP 403 (the response header cf-mitigated: challenge)." JSON has `blocked` (`kind`, `vendor`, `evidence`, `detail`, `status`, `title`), as does the snapshot. Rampa never solves or gets around a bot check; if the site is yours, let the machine that runs Rampa through, or check a copy without the protection.

**An error page.** When the server answers the address with an HTTP error (a 404 page, say) and the page is not a bot check, Rampa checks the page that came, and the first note says with which status: "The server answered HTTP 404 for this address: what was checked is the page that came with that status, an error page, not the page the address names." JSON has `httpStatus`. The exit code is as usual.

**An engine that stops.** If axe-core stops with an error on a page (it did on an element whose properties a page script had masked), the rest of the check still runs, the engine's rules count as not run, and a note gives the error; the engine results record it as `error`.

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

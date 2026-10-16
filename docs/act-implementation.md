# ACT implementation report

Rampa's results on the W3C ACT test cases, in the format the [W3C ACT implementation pages](https://www.w3.org/WAI/standards-guidelines/act/implementations/) read, with the consistency those pages would compute from it. **Status: prepared, not submitted.** The steps that remain are in [Submission](#submission). The entry for the W3C Evaluation Tools List is in [w3c-evaluation-tools-list.md](w3c-evaluation-tools-list.md).

In short:

- **Reported:** Rampa 0.1.1, the released `rampa-cli` package installed from npm, with no language model (`rampa check --no-llm`), at its default confidence threshold, on all 977 test cases the report reads, in one run from 2026-10-15 23:59 to 2026-10-16 01:38 UTC: [`bench/act-report/rampa.earl.json`](../bench/act-report/rampa.earl.json). Every outcome comes from that version.
- **Its consistency**, as act-tools (the code W3C runs) computes it: of the approved ACT rules, 27 consistent, 0 partial, 2 inconsistent and 8 not implemented; of the proposed rules, 4, 8, 2 and 36. Rampa 0.1.0 had 19, 8, 2 and 8; 4, 3, 7 and 36. axe-core 4.14.0's own report, scored the same way on the same day: 30, 0, 2 and 5; 5, 9, 4 and 32.
- **All of it is axe-core.** Every rule that report gets consistent or partial comes from an axe-core rule that Rampa runs. Rampa's own rules are all experimental: at the default threshold they report only items to review. With Gemma 4 12B, Rampa's judgments make 2 more rules consistent and 4 partial, all on rules whose test cases Rampa's prompts were written against. That report is still the benchmark's run from before 0.1.0, and was not regenerated (below).
- **Where Rampa is behind axe-core's own report,** it is because Rampa runs fewer axe-core rules: no best-practice, deprecated or Level AAA rule, and only two experimental ones, for review. Of the approved rules axe-core's report makes consistent, that leaves 4 not implemented here: 2 Level AAA rules and 2 whose axe-core rule Rampa does not run. One approved rule goes the other way (8fc3b6), and one is inconsistent here where axe-core's report has no procedure for it (2t702h).

## How W3C takes implementation reports

Sources, read on 2026-10-15:

- [ACT Rules Implementation in Test Tools and Methodologies](https://www.w3.org/WAI/standards-guidelines/act/implementations/), its [source](https://github.com/w3c/wcag-act-rules/blob/main/content/implementations.md), [Submit an Implementation](https://www.w3.org/WAI/standards-guidelines/act/report/submit/), [EARL Reporting Format](https://www.w3.org/WAI/standards-guidelines/act/report/earl/), [ACT Test Cases](https://www.w3.org/WAI/standards-guidelines/act/report/testcases/) and [Mapping to ACT rules](https://www.w3.org/WAI/standards-guidelines/act/report/mapping/), all in [w3c/wcag-act-rules](https://github.com/w3c/wcag-act-rules).
- The update job that turns reports into those pages: [implementation-update.yml](https://github.com/w3c/wcag-act-rules/blob/main/.github/workflows/implementation-update.yml), [implementation-update.mjs](https://github.com/w3c/wcag-act-rules/blob/main/.github/scripts/implementation-update.mjs) and the list of implementations, [act-implementations.yml](https://github.com/w3c/wcag-act-rules/blob/main/_data/wcag-act-rules/act-implementations.yml).
- The code that computes consistency: [act-rules/act-tools](https://github.com/act-rules/act-tools), `src/map-implementation/`, at commit `9ee7046`, the one [W3C's package-lock.json](https://github.com/w3c/wcag-act-rules/blob/main/package-lock.json) pins. act-tools is not published on npm.
- The ACT Rules Community Group's own pages, [Submit an Implementation](https://act-rules.github.io/pages/implementations/reporting/) and [Mapping To Rule](https://act-rules.github.io/pages/implementations/mapping/) (the outcome table below), from [act-rules/act-rules.github.io](https://github.com/act-rules/act-rules.github.io).
- Recent submissions: [#311](https://github.com/w3c/wcag-act-rules/issues/311) (Webmate, 2024), [#352](https://github.com/w3c/wcag-act-rules/issues/352) (UsableNet, 2025), [#451](https://github.com/w3c/wcag-act-rules/issues/451) (AODAChecker, open). The policy question: [#107](https://github.com/w3c/wcag-act-rules/issues/107).

**Format.** EARL in JSON-LD, with the context `https://www.w3.org/WAI/content-assets/wcag-act-rules/earl-context.json`. There is one `TestSubject` per test case, whose `source` is the test case's address, and one `Assertion` per outcome. An assertion's `test.title` names the tool's rule or procedure, and `test.isPartOf` lists the WCAG criteria that fail when that procedure fails, as `WCAG2:<id>` (the ids of act-tools' `sc-urls.json`). The outcome is `earl:passed`, `failed`, `inapplicable`, `cantTell` or `untested`. Only the first `Assertor` counts, for the name and version.

**Procedures and rules.** A procedure does not have to match an ACT rule one to one: several can cover one rule, and one can cover several rules. act-tools treats every procedure that has an assertion on a rule's test cases as a candidate for that rule. So a report should give each test case only the procedures that implement its rule. The ACT Test Cases page suggests either running only the tests for the rule's success criteria, or keeping a many-to-many mapping. Axe-core's own report keeps a mapping: it runs only the axe-core rules whose `actIds` name the ACT rule.

**Consistency.** In act-tools, `get-consistency.ts` and `find-procedure-set.ts`, applied per rule and per procedure. Only approved test cases count when a rule has any:

- *False positive*: a passed or inapplicable example with a `failed` outcome. A procedure with one is never consistent or partial.
- *Consistent* (act-tools: `complete`): no false positive, at least one failed example failed, no failed example only `passed`, `inapplicable` or `untested`, an outcome for every example, and requirements that match. The procedure's failures must name all of the rule's WCAG criteria except the secondary ones, and no WCAG criterion outside the rule's list. `cantTell` is allowed anywhere: it is neither a false positive nor a miss.
- *Partial*: no false positive, and either at least one failed example failed, or some `cantTell` while every inapplicable example is `passed` or `inapplicable`.
- *Inconsistent*: procedures map to the rule, but none is consistent or partial.
- *Untested* (this page says "not implemented"): no procedure maps to the rule.
- The rule takes the best level any procedure reaches. If no single procedure is consistent, the partial ones are combined, and the combination can be consistent.

The CG's [outcome table](https://act-rules.github.io/pages/implementations/mapping/) says the same: a passed example allows `passed`, `cantTell` or `inapplicable`, a failed example `failed` or `cantTell`, an inapplicable example `inapplicable`, `cantTell` or `passed`. **So `passed` and `inapplicable` count alike.**

**Submitting.** Open an issue at https://github.com/w3c/wcag-act-rules/issues/new with the implementation's name and the address of its EARL report, or e-mail group-act-rules@w3.org. The report must stay at a permanent address. The submit page says it is downloaded daily, and the update job runs every six hours. W3C staff add the entry to `act-implementations.yml` in a pull request and share a preview first (#311, #352). Metadata changes go by issue or pull request. Someone submitting for another person's tool needs the owner's written permission. The CG's own page, mostly unchanged since 2019, also asks implementers to join the [ACT Rules Community Group](https://www.w3.org/community/act-r/) so that the Community Contributor License Agreement is signed, and to open the issue in act-rules/act-rules.github.io. The current pipeline and the recent submissions are all in w3c/wcag-act-rules.

**A tool that embeds another implementation.** There is no written policy. [#107](https://github.com/w3c/wcag-act-rules/issues/107), open since 2022, asks: "Can one implementation include results from another. For example, could Accessibility Insights include results from axe-core?" The same issue records a second answer, from TPAC 2023, on using ACT test cases as training data: "allowed, but it is recommended not to". The precedents:

- **Axe DevTools Pro** is listed apart from axe-core, though it "combines the automated results of axe-core" with Deque's guided tests. It names the tool behind each procedure in brackets.
- **Lighthouse and Accessibility Insights**, built on axe-core, have no ACT entry. Neither has Pa11y, which can run axe-core.
- **In the Evaluation Tools List,** Deque's axe-based products link their "ACT Rules" field to axe-core's page.

So the CG has not asked embedding tools to report separately, nor forbidden it. This report says plainly what comes from axe-core and asks the CG in the submission issue.

## What is reported

### Which configuration

**Rampa with no model (`rampa check --no-llm`) is the implementation to submit.**

- Anyone can reproduce it without a GPU, a model or a key.
- It is deterministic. A rerun at the 0.1.0 release gave the same record as the benchmark run on 855 of 856 pages. The one other page redirects at once to the live w3.org home page, whose content had changed, and no procedure mapped to that page's rule saw a difference. The 0.1.1 run gave the same outcome as the earlier records on every test case ([below](#which-test-cases)).
- It is a release anyone can install: `rampa-cli@0.1.1` on npm, published by the release workflow with provenance, not a build of a working copy.
- It is what a CI job runs with `--no-llm`.
- W3C downloads a report again and recomputes it, and implementers are expected to keep it current with their releases. A report anyone can rebuild from a release suits that.

Plain `rampa check`, with no model configured, looks for Ollama or a provider and exits 2 if it finds none, so `--no-llm` is the deterministic setting.

**Rampa with Gemma 4 12B** is built too ([`rampa-gemma.earl.json`](../bench/act-report/rampa-gemma.earl.json)) and shown in the results, but it is not proposed for submission now:

- Its prompts were written while reading these test cases. Every rule its judgments decide is one of those, and the CG recommended against using the test cases that way (#107).
- Reproducing it needs a local 12B model.
- It is the benchmark run at commit `927cf63`, from before the 0.1.0 release. The judgment code changed after it (verification of quotes in passes), and it was not run again: no model is called for this report. It also lacks the supplementary test cases below: 126 examples of rules it reports on have no outcome.
- It was not regenerated for 0.1.1 either. Its files are rebuilt from the same records and come out the same: afw4f7 is still partial there, and its SVG and XML examples are "not run".

The format allows a second entry, as Alfa (automated and assisted) and UsableNet (auto and semi-auto) have. A full run of the model configuration at a release could become one later.

### What is axe-core and what is Rampa

Rampa runs axe-core 4.14.0 on the WCAG 2.0, 2.1 and 2.2 A/AA tags: 64 rules. It also runs two experimental rules, `td-has-header` and `table-fake-caption`, whose results are only items to review ([src/engine/axe.ts](../src/engine/axe.ts)). Axe-core has its own report on the W3C pages, by Deque, with every rule run, experimental ones included.

In the reported configuration:

- **Every `failed` outcome comes from an axe-core rule.**
- **Rampa's own procedures** in this report are the 6 of its 28 rules that name ACT rules: `rampa/meta-viewport`, `rampa/refresh-header`, `rampa/table-header-cells`, `rampa/pixel-contrast`, `rampa/widget-name` and `rampa/button-label-in-name`. All 28 are experimental. At the default threshold their findings are below it, so in the EARL they give only `cantTell` (an item to review) or `passed`.
- **A procedure's name says where it comes from:** `image-alt (axe-core)` is an axe-core rule as Rampa runs and reports it, and `rampa/widget-name` is Rampa's own rule. Model judgments, in the Gemma report only, are `rampa/judgment/<criterion>`. This follows Axe DevTools Pro, which names the tool behind each procedure.

Rampa also changes a few axe-core results:

- `bypass`, `video-caption`, `th-has-data-cells`, `no-autoplay-audio`, `form-field-multiple-labels` and `duplicate-id-aria` never fail in axe-core 4.14. Their undecided results are items to review in Rampa, so they are `cantTell` here, as in axe-core's own report.
- `target-size` is reported below the threshold, as experimental. No ACT rule maps to it.
- An experimental Rampa rule can take over elements that axe-core left undecided (`resolves` in [src/rules/types.ts](../src/rules/types.ts)). Since 0.1.1, axe-core's item to review leaves the report only when the report shows the rule's result instead ([rules](rules.md#how-rules-and-the-other-layers-interact)). An experimental rule's verdict is below the default threshold, so here axe-core's items stay. On afw4f7 (text contrast), axe-core leaves 3 failed examples undecided. `rampa/pixel-contrast` measures and fails them, below the threshold, and axe-core's items to review stay, so they are `cantTell`, as in axe-core's own report. In 0.1.0 the items were gone and the default output showed nothing ([below](#two-fixes-in-011)).

### Which test cases

| Set | Test cases | Rampa | Where |
| --- | ---: | --- | --- |
| The benchmark's: every HTML test case of the ACT rules that map to a WCAG 2.2 A/AA criterion for conformance, without the device motion rules ([docs/benchmark.md](benchmark.md)). Two of them, 2ee8b8's Inapplicable Examples 5 and 6, are no longer in the published file | 856, 854 of them still published | 0.1.1 | [`bench/act-report/records/rampa-0.1.1.jsonl`](../bench/act-report/records/rampa-0.1.1.jsonl) |
| The ones the benchmark left out among the rules a no-model Rampa procedure maps to (`build.mjs --missing rampa`): the ARIA rules with no WCAG criterion for conformance (674b10, 6a7281, 5f99a7, 4e8ab6, 5c01ea), the rules that axe-core's `bypass` maps to, and the SVG and XML examples of the benchmark's rules | 123: 110 HTML, 11 SVG, 2 XML | 0.1.1 | the same file |

After the run, `build.mjs --missing rampa` lists no test case: every test case of every rule a procedure maps to has a record, and none is an error.

**Earlier runs**, kept in git and out of the build: the benchmark's records at commit `927cf63` ([`bench/results/2026-10-11/raw/rampa.jsonl`](../bench/results/2026-10-11/raw/rampa.jsonl)), the 123 at 0.1.0 ([`records/rampa-0.1.0.jsonl`](../bench/act-report/records/rampa-0.1.0.jsonl)), and the 47 that the fixes below change, run again at commit `b09ef9d` before the release ([`records/rampa-b09ef9d.jsonl`](../bench/act-report/records/rampa-b09ef9d.jsonl)). The report built from those three had the same consistency as this one.

**Against those earlier records,** the 0.1.1 run gives the same outcome for every procedure on every test case. 7 of the 977 records differ, each only by an axe-core `color-contrast` item to review that 0.1.1 keeps where `rampa/pixel-contrast` measured the text and passed it below the threshold (the second fix below): 7d6734 Failed Example 4, 0ssw9k Inapplicable Example 1, 0va7u6 Inapplicable Example 2, 5effbb Failed Example 3, fd3a94 Failed Examples 3 and 7, and 59br37 Inapplicable Example 2. `color-contrast` maps to none of those rules, so no outcome changes. The `b09ef9d` run covered afw4f7, the one rule it does map to. 0.1.1's other changes (the dev-split fixes in the [CHANGELOG](../CHANGELOG.md)) change nothing here: `rampa/link-color-only`, `rampa/focus-visible` and `rampa/focus-indicator-contrast` are probe rules, which this configuration does not run, `rampa/placeholder-text` names no ACT rule, the 1.1.1 changes are to model judgments, and the note on a page cut at the collector's limit is a note.

Not reported:

- Rules whose failed examples fail only Level AAA criteria: 09o5cg, bisz58, aizyf1, b20e66, 1a02b0. Rampa reports against A and AA. Through axe-core's `actIds`, its 4.5:1 `color-contrast` would otherwise be scored against the 7:1 rule.
- Rules that no Rampa procedure maps to.

Both count as untested on the W3C pages.

### Two fixes in 0.1.1

Building this report found two faults in Rampa 0.1.0. Both were fixed at commit `b09ef9d` and released in 0.1.1 ([CHANGELOG](../CHANGELOG.md)). What follows compares 0.1.1 with 0.1.0.

- **Standalone SVG and XML documents.** 13 test cases are SVG or XML documents. 0.1.0 stopped with an error on each when it added axe-core to the page (`page.addScriptTag` needs an HTML head, and a script element outside the HTML namespace never runs), so they were `untested`. Now axe-core is evaluated in the page, as it already was in frames, and Rampa reads the kind of document first:
  - It checks an SVG document with axe-core and the rules that read the tree. Contrast from pixels, the reading presentation and the probes do not run on it, and the report says so. On the 11 SVG test cases, axe-core's HTML rules did not apply, and `avoid-inline-spacing` passed the `style` attributes. axe-core's `color-contrast` raised an error on 10 of them, which Rampa lists as an item to review under 1.4.3, a procedure mapped to none of these rules.
  - It does not check an XML document that the browser shows as its source tree. The 2 XML test cases (`<math>` with no namespace, served as `application/xml`) are such documents. Chromium replaces the document with a viewer of its own, an XHTML page with no title and no `lang`; checking that viewer would fail `html-has-lang` on b5c3f8's inapplicable example, a false positive. The report says that nothing on the page was checked, and every criterion is "not checked".
  - So all 13 now have outcomes: `passed` for every procedure mapped to them (see `passed` in the next section). axe-core's own runner reports them `inapplicable` without loading them (`inapplicableFileExtensions` in [act-reports-axe](https://github.com/dequelabs/act-reports-axe/blob/main/src/config.ts)). 7 approved rules go from partial to consistent (24afc2, 78fd32, 9e45ec, 2779a5, bf051a, b5c3f8, 6a7281), and 5 proposed rules from inconsistent to partial (cf77f2, 3e12e1, ye5d6e, 047fe0, b40fd1), as in axe-core's own report.
- **Items to review that an experimental rule hid (afw4f7).** In 0.1.0 a rule that takes over axe-core's undecided results (`resolves`) removed axe-core's item to review whatever its own verdict. `rampa/pixel-contrast` failed afw4f7's three undecided failed examples below the default threshold, so the default output showed neither a failure nor an item to review, and they counted as missed. Now axe-core's item stays unless the report shows the rule's result instead, and its evidence says what the pixel rule measured. The three failed examples are `cantTell`, and afw4f7 goes from partial to consistent, as in axe-core's own report. Three of its passed and inapplicable examples, which the pixel rule passes below the threshold, are now `cantTell` too, which ACT allows. The same principle applies to every rule that takes over axe-core's results: the media, skip-link and link-color probe rules, which do not run in this configuration.

### From Rampa's results to ACT outcomes

For each test case, and for each procedure that implements the test case's rule:

| What the page's record says about the procedure | Outcome |
| --- | --- |
| A finding at or above the default threshold, under any criterion | `failed` |
| An item to review (a needs-review item that names the procedure) | `cantTell` |
| Both | `failed` and `cantTell`, two assertions |
| Nothing, or only a finding below the threshold | `passed` |
| The page could not be checked | `untested` |

- **Passed or inapplicable.** Rampa's records do not tell "nothing applied" from "applied and passed". Both are `passed`, which ACT counts the same as `inapplicable` on passed and inapplicable examples (above). The expected outcome is never read to choose between them.
- **A document Rampa does not read.** On an XML document the browser shows as its source tree, Rampa's report says that nothing was checked, and its record is empty, so it is `passed` like any page where nothing applied. Here that is the right outcome, not an error turned into a pass: the procedures mapped to the two XML test cases (`html-has-lang`, `aria-valid-attr-value`) apply to HTML pages and to HTML, SVG and MathML elements, and the document holds none. A page Rampa fails to check is still `untested`.
- **Below the threshold.** A finding below the threshold is not reported by the configuration: `rampa check` lists it only with `--verbose`, and it never fails a build. It is therefore `passed`. The notes of each rule count those on failed examples.
- **Status with no rule.** A criterion's needs-review or failure status in the report's coverage, recorded without the rule behind it, is left out. It cannot be tied to a procedure, and leaving it out can only lower consistency. In these results that never happened for a failure.
- **Which procedures implement which rule.** This comes from Rampa's own metadata, as `rampa eval` scores: axe-core's `actIds` for axe-core rules, and the `act` lists of Rampa's rules and judged criteria. None of it is chosen from the results. A finding of a procedure that does not implement the rule (`aria-required-attr` on a form field example) is not an outcome of that rule. The notes still count every such finding under the rule's criteria, so nothing Rampa reported is hidden.
- **`isPartOf`.** The criteria Rampa reports a procedure's failures under: axe-core's tags as Rampa maps them, a rule's `criteria`, or a judgment's criterion.
- **1.1.1 judgments** answer two questions: whether the image's name describes it (23a2a8, qt1vmo), and whether a hidden image is decorative (e88epe). The records do not say which question a failure answered, so a failure counts for all three rules. That can add false positives, never remove them.

## How to regenerate

```sh
# dist/ built at the release's tag: the script reads the mapping of procedures to ACT rules from it
# (dist/ is not in git, so it stays when you come back to the branch with this script, where tools/rampa.mjs takes --cli)
git checkout v0.1.1 && pnpm install && pnpm build && git checkout -

# the release, from npm, in a folder of its own outside the repository
mkdir ../rampa-0.1.1 && cd ../rampa-0.1.1
echo '{ "private": true }' > package.json
pnpm add rampa-cli@0.1.1
cd ../rampa-cli

# act-tools at the commit W3C pins, outside the repository; it is not on npm, and it is never a dependency of Rampa
git clone https://github.com/act-rules/act-tools.git ../act-tools
git -C ../act-tools checkout 9ee7046e2413391270a4260aa40bd8304a20b5fe
(cd ../act-tools && pnpm import && pnpm install --frozen-lockfile --ignore-scripts && pnpm exec tsc)

cd bench
node tools/rampa.mjs rampa --cli ../../rampa-0.1.1/node_modules/rampa-cli/dist/cli.mjs --pages <pages.json> \
  --out act-report/records/rampa-0.1.1.jsonl --meta act-report/records/rampa-0.1.1.meta.json --work .cache/act-0.1.1
node act-report/build.mjs --act-tools ../../act-tools --docs
```

`<pages.json>` lists the test cases to run, as `{ "id": "act:<rule>:<test case>", "url": "<its address>", "kind": "act" }`: the ids of `results/2026-10-11/cases.json` and of `act-report/records/rampa-0.1.0.jsonl`, with their addresses from the published test cases file, less any that file no longer has. `--cli` runs the installed release instead of the repository's `dist/cli.mjs`, and its meta file records the package and version. `pnpm add` refuses to run the build script of one dependency, `tesseract.js` (OCR, used only by a judged criterion); nothing here needs it, and it was not approved. The installed package's `dist/` was byte-identical to the tag's build. The run took about 100 minutes with two workers; pages that did not load in time were tried again one at a time, and none ended in an error.

`pnpm import` turns act-tools' `yarn.lock` into a pnpm lockfile with the same versions, `--ignore-scripts` keeps its install scripts from running, and `tsc` builds it. The script needs no package of `bench/`. It writes the following files to `bench/act-report/`:

- `rampa.earl.json` and `rampa-gemma.earl.json`: the EARL reports.
- `rampa.act.json` and `rampa-gemma.act.json`: what act-tools computes from them, the same data W3C keeps in `_data/wcag-act-rules/implementations/`.
- `summary.md` and `summary.json`.

With `--docs`, it also writes the results below. It first checks that act-tools reads back every assertion it wrote. Without `--act-tools`, it writes the EARL reports only.

The test cases are the file W3C publishes, read at run time (`--testcases <file>` reads a saved copy). The comparison column is axe-core's own report, read from the address W3C reads (`--axe-earl none` leaves it out). Run on axe-core's report, the same act-tools reproduced the published axe-core numbers exactly: approved 30, 0, 2, 5 and proposed 5, 9, 4, 32.

After a new release:

1. Install it as above, and run `tools/rampa.mjs` with `--cli` on the same list, plus whatever `node act-report/build.mjs --missing rampa <file>` lists for the new records.
2. Point `DEFAULTS` in `build.mjs` at the new records file and version, and keep the old file in git.
3. Build again, and compare the outcomes with the report before it.

## Results

<!-- act:report:start -->
<!-- Generated by bench/act-report/build.mjs --docs from rampa: act-report/records/rampa-0.1.1.jsonl; rampa-gemma: results/2026-10-11/raw/rampa-gemma.jsonl (results folder results/2026-10-11); do not edit by hand. -->

Test cases: the published ACT file, 1211 test cases of 87 rules (SHA-256 `49051da603af`, read 2026-10-16). Consistency computed by act-tools at `9ee7046`, the commit W3C's update job pins. axe-core 4.14.0 inside Rampa. axe-core's own report read the same day from https://raw.githubusercontent.com/dequelabs/act-reports-axe/act-reports-axe/reports/axe-core.json.

### Rules by consistency

| Implementation | Approved rules: consistent / partial / inconsistent / not implemented | Proposed rules: consistent / partial / inconsistent / not implemented |
| --- | :---: | :---: |
| Rampa, no model (`rampa check --no-llm`) | 27 / 0 / 2 / 8 | 4 / 8 / 2 / 36 |
| Rampa with Gemma 4 12B (`rampa check --model ollama:gemma4:12b`); 126 examples of the rules it reports on were not run | 17 / 7 / 3 / 10 | 4 / 7 / 5 / 34 |
| axe-core 4.14.0, its own report (all its rules, experimental ones included; every rule run) | 30 / 0 / 2 / 5 | 5 / 9 / 4 / 32 |

### Which procedures make a rule consistent

| Implementation | Consistent rules: by axe-core rules / by Rampa's own procedures / by both | Partial rules: by axe-core rules / by Rampa's own / by both |
| --- | :---: | :---: |
| Rampa, no model (`rampa check --no-llm`) | 31 / 0 / 0 | 8 / 0 / 0 |
| Rampa with Gemma 4 12B (`rampa check --model ollama:gemma4:12b`) | 19 / 2 / 0 | 10 / 4 / 0 |

### Per ACT rule

Every rule the benchmark ran or a Rampa procedure maps to (65). "Not implemented" is W3C's "untested": no procedure of that configuration maps to the rule. "Not run": procedures map to it, but that configuration was not run on its examples (W3C counts it as untested too). ★ marks the rules Rampa may have been tuned on, the benchmark's conservative reading: their ids appear in Rampa's code or tests, so its prompts, rules or thresholds may have been adjusted while reading their test cases. The notes say what the consistency leaves out.

| ACT rule | Criteria | Status | No model | Gemma 4 12B | axe-core 4.14.0, own report | Procedures | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| [qt1vmo](https://www.w3.org/WAI/standards-guidelines/act/rules/qt1vmo/) Image accessible name is descriptive ★ | 1.1.1 | approved | not implemented | consistent | not implemented | `rampa/judgment/1.1.1` |  |
| [59796f](https://www.w3.org/WAI/standards-guidelines/act/rules/59796f/) Image button has non-empty accessible name ★ | 1.1.1, 4.1.2 | approved | consistent | consistent | consistent | `input-image-alt (axe-core)` |  |
| [23a2a8](https://www.w3.org/WAI/standards-guidelines/act/rules/23a2a8/) Image has non-empty accessible name ★ | 1.1.1 | approved | consistent | consistent | consistent | `image-alt (axe-core)`, `role-img-alt (axe-core)` |  |
| [e88epe](https://www.w3.org/WAI/standards-guidelines/act/rules/e88epe/) Image not in the accessibility tree is decorative ★ | 1.1.1 | proposed | not implemented | inconsistent | not implemented | `rampa/judgment/1.1.1` | Gemma 4 12B: below-threshold findings on 5 failed examples, not reported |
| [8fc3b6](https://www.w3.org/WAI/standards-guidelines/act/rules/8fc3b6/) Object element rendering non-text content has non-empty accessible name | 1.1.1 | approved | consistent | consistent | inconsistent | `object-alt (axe-core)` |  |
| [7d6734](https://www.w3.org/WAI/standards-guidelines/act/rules/7d6734/) SVG element with explicit role has non-empty accessible name | 1.1.1 | approved | consistent | consistent | consistent | `svg-img-alt (axe-core)` |  |
| [e7aa44](https://www.w3.org/WAI/standards-guidelines/act/rules/e7aa44/) Audio element content has text alternative | 1.2.1 | proposed | not implemented | not implemented | not implemented | — |  |
| [c3232f](https://www.w3.org/WAI/standards-guidelines/act/rules/c3232f/) Video element visual-only content has accessible alternative ★ | 1.2.1 | proposed | not implemented | not implemented | not implemented | — |  |
| [eac66b](https://www.w3.org/WAI/standards-guidelines/act/rules/eac66b/) Video element auditory content has accessible alternative | 1.2.2 | proposed | inconsistent | inconsistent | inconsistent | `video-caption (axe-core)` |  |
| [c5a4ea](https://www.w3.org/WAI/standards-guidelines/act/rules/c5a4ea/) Video element visual content has accessible alternative | 1.2.3 | proposed | not implemented | not implemented | not implemented | — |  |
| [1ec09b](https://www.w3.org/WAI/standards-guidelines/act/rules/1ec09b/) Video element visual content has strict accessible alternative | 1.2.5 | proposed | not implemented | not implemented | not implemented | — |  |
| [ff89c9](https://www.w3.org/WAI/standards-guidelines/act/rules/ff89c9/) ARIA required context role | 1.3.1 | proposed | consistent | consistent | consistent | `aria-required-parent (axe-core)`, `aria-required-children (axe-core)` |  |
| [bc4a75](https://www.w3.org/WAI/standards-guidelines/act/rules/bc4a75/) ARIA required owned elements | 1.3.1 | proposed | partial | partial | partial | `aria-required-children (axe-core)` | No model: procedures not mapped to the rule failed 6 failed examples under its criteria (aria-required-parent (axe-core), list (axe-core)); Gemma 4 12B: procedures not mapped to the rule failed 6 failed examples under its criteria (aria-required-parent (axe-core), list (axe-core)) |
| [a25f45](https://www.w3.org/WAI/standards-guidelines/act/rules/a25f45/) Headers attribute specified on a cell refers to cells in the same table element | 1.3.1 | approved | consistent | consistent | consistent | `td-headers-attr (axe-core)` |  |
| [d0f69e](https://www.w3.org/WAI/standards-guidelines/act/rules/d0f69e/) Table header cell has assigned cells ★ | 1.3.1 | proposed | partial | partial | partial | `th-has-data-cells (axe-core)` | No model: partial through cannot-tell outcomes only: no failed example failed; No model: below-threshold findings on 3 failed examples, not reported; Gemma 4 12B: partial through cannot-tell outcomes only: no failed example failed; Gemma 4 12B: below-threshold findings on 3 failed examples, not reported |
| [9bd38c](https://www.w3.org/WAI/standards-guidelines/act/rules/9bd38c/) Content has alternative for visual reference ★ | 1.3.3 | proposed | not implemented | not implemented | not implemented | — |  |
| [b33eff](https://www.w3.org/WAI/standards-guidelines/act/rules/b33eff/) Orientation of the page is not restricted using CSS transforms ★ | 1.3.4 | approved | not implemented | not implemented | consistent | — |  |
| [73f2c2](https://www.w3.org/WAI/standards-guidelines/act/rules/73f2c2/) `autocomplete` attribute has valid value ★ | 1.3.5 | approved | consistent | consistent | consistent | `autocomplete-valid (axe-core)` |  |
| [80f0bf](https://www.w3.org/WAI/standards-guidelines/act/rules/80f0bf/) Audio or video element avoids automatically playing audio ★ | 1.4.2 | proposed | inconsistent | inconsistent | inconsistent | `no-autoplay-audio (axe-core)` |  |
| [afw4f7](https://www.w3.org/WAI/standards-guidelines/act/rules/afw4f7/) Text has minimum contrast ★ | 1.4.3 | approved | consistent | partial | consistent | `color-contrast (axe-core)` | No model: below-threshold findings on 3 failed examples, not reported; Gemma 4 12B: below-threshold findings on 3 failed examples, not reported |
| [b4f0c3](https://www.w3.org/WAI/standards-guidelines/act/rules/b4f0c3/) Meta viewport allows for zoom ★ | 1.4.4 | approved | consistent | consistent | consistent | `meta-viewport (axe-core)` | No model: below-threshold findings on 2 failed examples, not reported; Gemma 4 12B: below-threshold findings on 2 failed examples, not reported |
| [59br37](https://www.w3.org/WAI/standards-guidelines/act/rules/59br37/) Zoomed text node is not clipped with CSS overflow ★ | 1.4.4 | proposed | not implemented | not implemented | not implemented | — |  |
| [0va7u6](https://www.w3.org/WAI/standards-guidelines/act/rules/0va7u6/) HTML images contain no text ★ | 1.4.5 | approved | not implemented | not implemented | not implemented | — |  |
| [24afc2](https://www.w3.org/WAI/standards-guidelines/act/rules/24afc2/) Important letter spacing in style attributes is wide enough | 1.4.12 | approved | consistent | partial | consistent | `avoid-inline-spacing (axe-core)` | Gemma 4 12B: 1 examples not run |
| [78fd32](https://www.w3.org/WAI/standards-guidelines/act/rules/78fd32/) Important line height in style attributes is wide enough | 1.4.12 | approved | consistent | partial | consistent | `avoid-inline-spacing (axe-core)` | Gemma 4 12B: 1 examples not run |
| [9e45ec](https://www.w3.org/WAI/standards-guidelines/act/rules/9e45ec/) Important word spacing in style attributes is wide enough | 1.4.12 | approved | consistent | partial | consistent | `avoid-inline-spacing (axe-core)` | Gemma 4 12B: 1 examples not run |
| [akn7bn](https://www.w3.org/WAI/standards-guidelines/act/rules/akn7bn/) Iframe with interactive elements is not excluded from tab-order ★ | 2.1.1 | approved | inconsistent | inconsistent | inconsistent | `frame-focusable-content (axe-core)` |  |
| [0ssw9k](https://www.w3.org/WAI/standards-guidelines/act/rules/0ssw9k/) Scrollable content can be reached with sequential focus navigation | 2.1.1 | approved | consistent | consistent | consistent | `scrollable-region-focusable (axe-core)` |  |
| [80af7b](https://www.w3.org/WAI/standards-guidelines/act/rules/80af7b/) Focusable element has no keyboard trap ★ | 2.1.2 | proposed | not implemented | not implemented | not implemented | — |  |
| [ffbc54](https://www.w3.org/WAI/standards-guidelines/act/rules/ffbc54/) No keyboard shortcut uses only printable characters ★ | 2.1.4 | proposed | not implemented | not implemented | not implemented | — |  |
| [bc659a](https://www.w3.org/WAI/standards-guidelines/act/rules/bc659a/) Meta element has no refresh delay ★ | 2.2.1 | approved | consistent | consistent | consistent | `meta-refresh (axe-core)` |  |
| [efbfc7](https://www.w3.org/WAI/standards-guidelines/act/rules/efbfc7/) Text content that changes automatically can be paused, stopped or hidden ★ | 2.2.2 | proposed | not implemented | not implemented | not implemented | — |  |
| [cf77f2](https://www.w3.org/WAI/standards-guidelines/act/rules/cf77f2/) Bypass Blocks of Repeated Content ★ | 2.4.1 | proposed | partial | inconsistent | partial | `bypass (axe-core)` | No model: partial through cannot-tell outcomes only: no failed example failed; Gemma 4 12B: 1 examples not run |
| [2779a5](https://www.w3.org/WAI/standards-guidelines/act/rules/2779a5/) HTML page has non-empty title ★ | 2.4.2 | approved | consistent | partial | consistent | `document-title (axe-core)` | Gemma 4 12B: 1 examples not run |
| [c4a8a4](https://www.w3.org/WAI/standards-guidelines/act/rules/c4a8a4/) HTML page title is descriptive ★ | 2.4.2 | approved | not implemented | inconsistent | not implemented | `rampa/judgment/2.4.2` | Gemma 4 12B: 1 examples not run; Gemma 4 12B: below-threshold findings on 2 failed examples, not reported |
| [c487ae](https://www.w3.org/WAI/standards-guidelines/act/rules/c487ae/) Link has non-empty accessible name ★ | 2.4.4, 4.1.2 | approved | consistent | consistent | consistent | `link-name (axe-core)`, `area-alt (axe-core)` | No model: procedures not mapped to the rule failed 1 passed or inapplicable examples under its criteria (aria-hidden-focus (axe-core)); Gemma 4 12B: procedures not mapped to the rule failed 1 passed or inapplicable examples under its criteria (aria-hidden-focus (axe-core)) |
| [5effbb](https://www.w3.org/WAI/standards-guidelines/act/rules/5effbb/) Link in context is descriptive ★ | 2.4.4 | proposed | not implemented | consistent | not implemented | `rampa/judgment/2.4.4` |  |
| [fd3a94](https://www.w3.org/WAI/standards-guidelines/act/rules/fd3a94/) Links with identical accessible names and same context serve equivalent purpose ★ | 2.4.4 | proposed | not implemented | inconsistent | not implemented | `rampa/judgment/2.4.4` |  |
| [cc0f0a](https://www.w3.org/WAI/standards-guidelines/act/rules/cc0f0a/) Form field label is descriptive ★ | 2.4.6 | proposed | not implemented | partial | not implemented | `rampa/judgment/2.4.6` |  |
| [b49b2e](https://www.w3.org/WAI/standards-guidelines/act/rules/b49b2e/) Heading is descriptive ★ | 2.4.6 | proposed | not implemented | partial | not implemented | `rampa/judgment/2.4.6` | Gemma 4 12B: partial through cannot-tell outcomes only: no failed example failed |
| [oj04fd](https://www.w3.org/WAI/standards-guidelines/act/rules/oj04fd/) Element in sequential focus order has visible focus ★ | 2.4.7 | approved | not implemented | not implemented | not implemented | — |  |
| [2ee8b8](https://www.w3.org/WAI/standards-guidelines/act/rules/2ee8b8/) Visible label is part of accessible name ★ | 2.5.3 | proposed | consistent | consistent | consistent | `label-content-name-mismatch (axe-core)` |  |
| [bf051a](https://www.w3.org/WAI/standards-guidelines/act/rules/bf051a/) HTML page `lang` attribute has valid language tag ★ | 3.1.1 | approved | consistent | partial | consistent | `html-lang-valid (axe-core)` | Gemma 4 12B: 1 examples not run |
| [b5c3f8](https://www.w3.org/WAI/standards-guidelines/act/rules/b5c3f8/) HTML page has lang attribute ★ | 3.1.1 | approved | consistent | partial | consistent | `html-has-lang (axe-core)` | No model: procedures not mapped to the rule failed 1 failed examples under its criteria (html-lang-valid (axe-core)); Gemma 4 12B: 2 examples not run; Gemma 4 12B: procedures not mapped to the rule failed 1 failed examples under its criteria (html-lang-valid (axe-core)) |
| [ucwvc8](https://www.w3.org/WAI/standards-guidelines/act/rules/ucwvc8/) HTML page language subtag matches default language ★ | 3.1.1 | proposed | not implemented | partial | not implemented | `rampa/judgment/3.1.1` | No model: procedures not mapped to the rule failed 4 passed or inapplicable examples under its criteria (html-has-lang (axe-core), html-lang-valid (axe-core)); Gemma 4 12B: 1 examples not run; Gemma 4 12B: procedures not mapped to the rule failed 4 passed or inapplicable examples under its criteria (html-has-lang (axe-core), html-lang-valid (axe-core)) |
| [de46e4](https://www.w3.org/WAI/standards-guidelines/act/rules/de46e4/) Element with lang attribute has valid language tag ★ | 3.1.2 | approved | consistent | consistent | consistent | `valid-lang (axe-core)` |  |
| [off6ek](https://www.w3.org/WAI/standards-guidelines/act/rules/off6ek/) HTML element language subtag matches language ★ | 3.1.2 | proposed | not implemented | partial | not implemented | `rampa/judgment/3.1.2` | Gemma 4 12B: 1 examples not run |
| [36b590](https://www.w3.org/WAI/standards-guidelines/act/rules/36b590/) Error message describes invalid form field value ★ | 3.3.1 | proposed | not implemented | not implemented | not implemented | — |  |
| [97a4e1](https://www.w3.org/WAI/standards-guidelines/act/rules/97a4e1/) Button has non-empty accessible name ★ | 4.1.2 | approved | consistent | consistent | consistent | `button-name (axe-core)`, `aria-command-name (axe-core)` |  |
| [6cfa84](https://www.w3.org/WAI/standards-guidelines/act/rules/6cfa84/) Element with aria-hidden has no content in sequential focus navigation | 4.1.2 | approved | consistent | consistent | consistent | `aria-hidden-focus (axe-core)` | No model: procedures not mapped to the rule failed 1 passed or inapplicable examples under its criteria (aria-valid-attr-value (axe-core)); Gemma 4 12B: procedures not mapped to the rule failed 1 passed or inapplicable examples under its criteria (aria-valid-attr-value (axe-core)) |
| [307n5z](https://www.w3.org/WAI/standards-guidelines/act/rules/307n5z/) Element with presentational children has no focusable content | 4.1.2 | approved | consistent | consistent | consistent | `nested-interactive (axe-core)` | No model: procedures not mapped to the rule failed 1 failed examples under its criteria (label (axe-core)); Gemma 4 12B: procedures not mapped to the rule failed 1 failed examples under its criteria (label (axe-core)) |
| [e086e5](https://www.w3.org/WAI/standards-guidelines/act/rules/e086e5/) Form field has non-empty accessible name ★ | 4.1.2 | approved | consistent | consistent | consistent | `label (axe-core)`, `aria-input-field-name (axe-core)`, `select-name (axe-core)` | No model: procedures not mapped to the rule failed 2 passed or inapplicable examples under its criteria (aria-required-attr (axe-core)); Gemma 4 12B: procedures not mapped to the rule failed 2 passed or inapplicable examples under its criteria (aria-required-attr (axe-core)) |
| [cae760](https://www.w3.org/WAI/standards-guidelines/act/rules/cae760/) Iframe element has non-empty accessible name | 4.1.2 | proposed | consistent | consistent | consistent | `frame-title (axe-core)` |  |
| [4b1c6c](https://www.w3.org/WAI/standards-guidelines/act/rules/4b1c6c/) Iframe elements with identical accessible names have equivalent purpose | 4.1.2 | proposed | partial | partial | partial | `frame-title-unique (axe-core)` | No model: partial through cannot-tell outcomes only: no failed example failed; No model: procedures not mapped to the rule failed 3 passed or inapplicable examples under its criteria (frame-title (axe-core)); Gemma 4 12B: partial through cannot-tell outcomes only: no failed example failed; Gemma 4 12B: procedures not mapped to the rule failed 3 passed or inapplicable examples under its criteria (frame-title (axe-core)) |
| [m6b1q3](https://www.w3.org/WAI/standards-guidelines/act/rules/m6b1q3/) Menuitem has non-empty accessible name ★ | 4.1.2 | approved | consistent | consistent | consistent | `button-name (axe-core)` |  |
| [2t702h](https://www.w3.org/WAI/standards-guidelines/act/rules/2t702h/) Summary element has non-empty accessible name ★ | 4.1.2 | approved | inconsistent | inconsistent | not implemented | `rampa/widget-name` | No model: procedures not mapped to the rule failed 3 failed examples under its criteria (summary-name (axe-core)); Gemma 4 12B: procedures not mapped to the rule failed 3 failed examples under its criteria (summary-name (axe-core)) |
| [5f99a7](https://www.w3.org/WAI/standards-guidelines/act/rules/5f99a7/) ARIA attribute is defined in WAI-ARIA | — | approved | consistent | not run | consistent | `aria-valid-attr (axe-core)` | Gemma 4 12B: 8 examples not run |
| [6a7281](https://www.w3.org/WAI/standards-guidelines/act/rules/6a7281/) ARIA state or property has valid value | — | approved | consistent | not run | consistent | `aria-valid-attr-value (axe-core)` | Gemma 4 12B: 21 examples not run |
| [5c01ea](https://www.w3.org/WAI/standards-guidelines/act/rules/5c01ea/) ARIA state or property is permitted | — | proposed | consistent | not run | consistent | `aria-allowed-attr (axe-core)` | Gemma 4 12B: 17 examples not run |
| [3e12e1](https://www.w3.org/WAI/standards-guidelines/act/rules/3e12e1/) Block of repeated content is collapsible | — | proposed | partial | not run | partial | `bypass (axe-core)` | No model: partial through cannot-tell outcomes only: no failed example failed; Gemma 4 12B: 8 examples not run |
| [b40fd1](https://www.w3.org/WAI/standards-guidelines/act/rules/b40fd1/) Document has a landmark with non-repeated content | — | proposed | partial | not run | partial | `bypass (axe-core)` | No model: partial through cannot-tell outcomes only: no failed example failed; Gemma 4 12B: 8 examples not run |
| [ye5d6e](https://www.w3.org/WAI/standards-guidelines/act/rules/ye5d6e/) Document has an instrument to move focus to non-repeated content | — | proposed | partial | not run | partial | `bypass (axe-core)` | No model: partial through cannot-tell outcomes only: no failed example failed; Gemma 4 12B: 12 examples not run |
| [047fe0](https://www.w3.org/WAI/standards-guidelines/act/rules/047fe0/) Document has heading for non-repeated content | — | proposed | partial | not run | partial | `bypass (axe-core)` | No model: partial through cannot-tell outcomes only: no failed example failed; Gemma 4 12B: 14 examples not run |
| [4e8ab6](https://www.w3.org/WAI/standards-guidelines/act/rules/4e8ab6/) Element with role attribute has required states and properties | — | approved | consistent | not run | consistent | `aria-required-attr (axe-core)` | Gemma 4 12B: 16 examples not run |
| [674b10](https://www.w3.org/WAI/standards-guidelines/act/rules/674b10/) Role attribute has valid value | — | approved | consistent | not run | consistent | `aria-roles (axe-core)` | Gemma 4 12B: 11 examples not run |

### Where Rampa and axe-core's own report differ

| ACT rule | Status | No model | axe-core 4.14.0, own report |
| --- | --- | --- | --- |
| [09o5cg](https://www.w3.org/WAI/standards-guidelines/act/rules/09o5cg/) Text has enhanced contrast (Level AAA only) | approved | not implemented | consistent |
| [2eb176](https://www.w3.org/WAI/standards-guidelines/act/rules/2eb176/) Audio element content has transcript | proposed | not implemented | inconsistent |
| [2t702h](https://www.w3.org/WAI/standards-guidelines/act/rules/2t702h/) Summary element has non-empty accessible name | approved | inconsistent | not implemented |
| [46ca7f](https://www.w3.org/WAI/standards-guidelines/act/rules/46ca7f/) Element marked as decorative is not exposed | approved | not implemented | consistent |
| [8fc3b6](https://www.w3.org/WAI/standards-guidelines/act/rules/8fc3b6/) Object element rendering non-text content has non-empty accessible name | approved | consistent | inconsistent |
| [afb423](https://www.w3.org/WAI/standards-guidelines/act/rules/afb423/) Audio element content is media alternative for text | proposed | not implemented | inconsistent |
| [b20e66](https://www.w3.org/WAI/standards-guidelines/act/rules/b20e66/) Links with identical accessible names have equivalent purpose (Level AAA only) | proposed | not implemented | partial |
| [b33eff](https://www.w3.org/WAI/standards-guidelines/act/rules/b33eff/) Orientation of the page is not restricted using CSS transforms | approved | not implemented | consistent |
| [bisz58](https://www.w3.org/WAI/standards-guidelines/act/rules/bisz58/) Meta element has no refresh delay (no exception) (Level AAA only) | approved | not implemented | consistent |
| [ffd0e9](https://www.w3.org/WAI/standards-guidelines/act/rules/ffd0e9/) Heading has non-empty accessible name | proposed | not implemented | consistent |

### Rules not in the table

Rampa has no outcome for these; the W3C pages count them as untested.

- **No Rampa procedure maps to the rule, and the benchmark did not run it** (17): [kb1m8s](https://www.w3.org/WAI/standards-guidelines/act/rules/kb1m8s/) ARIA global properties not used where prohibited (axe-core: not implemented); [2eb176](https://www.w3.org/WAI/standards-guidelines/act/rules/2eb176/) Audio element content has transcript (axe-core: inconsistent); [afb423](https://www.w3.org/WAI/standards-guidelines/act/rules/afb423/) Audio element content is media alternative for text (axe-core: inconsistent); [4c31df](https://www.w3.org/WAI/standards-guidelines/act/rules/4c31df/) Audio or video element that plays automatically has a control mechanism (axe-core: not implemented); [aaa1bf](https://www.w3.org/WAI/standards-guidelines/act/rules/aaa1bf/) Audio or video element that plays automatically has no audio that lasts more than 3 seconds (axe-core: not implemented); [7677a9](https://www.w3.org/WAI/standards-guidelines/act/rules/7677a9/) Device motion based changes to the content can also be created from the user interface (axe-core: not implemented); [c249d5](https://www.w3.org/WAI/standards-guidelines/act/rules/c249d5/) Device motion based changes to the content can be disabled (axe-core: not implemented); [46ca7f](https://www.w3.org/WAI/standards-guidelines/act/rules/46ca7f/) Element marked as decorative is not exposed (axe-core: consistent); [ebe86a](https://www.w3.org/WAI/standards-guidelines/act/rules/ebe86a/) Focusable element has no keyboard trap via non-standard navigation (axe-core: not implemented); [a1b64e](https://www.w3.org/WAI/standards-guidelines/act/rules/a1b64e/) Focusable element has no keyboard trap via standard navigation (axe-core: not implemented); [ffd0e9](https://www.w3.org/WAI/standards-guidelines/act/rules/ffd0e9/) Heading has non-empty accessible name (axe-core: consistent); [f51b46](https://www.w3.org/WAI/standards-guidelines/act/rules/f51b46/) Video element auditory content has captions (axe-core: not implemented); [ab4d13](https://www.w3.org/WAI/standards-guidelines/act/rules/ab4d13/) Video element content is media alternative for text (axe-core: not implemented); [1ea59c](https://www.w3.org/WAI/standards-guidelines/act/rules/1ea59c/) Video element visual content has audio description (axe-core: not implemented); [d7ba54](https://www.w3.org/WAI/standards-guidelines/act/rules/d7ba54/) Video element visual-only content has audio track alternative (axe-core: not implemented); [ee13b5](https://www.w3.org/WAI/standards-guidelines/act/rules/ee13b5/) Video element visual-only content has transcript (axe-core: not implemented); [fd26cf](https://www.w3.org/WAI/standards-guidelines/act/rules/fd26cf/) Video element visual-only content is media alternative for text (axe-core: not implemented).
- **Level AAA only: Rampa reports against A and AA** (5): [1a02b0](https://www.w3.org/WAI/standards-guidelines/act/rules/1a02b0/) Audio and visuals of video element have transcript (axe-core: not implemented); [aizyf1](https://www.w3.org/WAI/standards-guidelines/act/rules/aizyf1/) Link is descriptive (axe-core: not implemented); [b20e66](https://www.w3.org/WAI/standards-guidelines/act/rules/b20e66/) Links with identical accessible names have equivalent purpose (axe-core: partial); [bisz58](https://www.w3.org/WAI/standards-guidelines/act/rules/bisz58/) Meta element has no refresh delay (no exception) (axe-core: consistent); [09o5cg](https://www.w3.org/WAI/standards-guidelines/act/rules/09o5cg/) Text has enhanced contrast (axe-core: consistent).
<!-- act:report:end -->

### Reading the results

- **Consistent and partial rules are axe-core's.** With no model: 31 consistent and 8 partial rules, every one from axe-core rules. With Gemma 4 12B, judgments make qt1vmo (image name describes the image, approved) and 5effbb (link in context, proposed) consistent. They make ucwvc8, off6ek, cc0f0a and b49b2e partial; b49b2e only through items to review. All six are ★ rules. The judgments are also inconsistent on c4a8a4 and e88epe, where no failed example fails: what they find there stays below the threshold. On fd3a94 they make 2 false positives.
- **Against axe-core's own report,** the section above lists every difference. They come from:
  - axe-core rules Rampa does not run: `css-orientation-lock` (experimental, b33eff), `presentation-role-conflict` and `empty-heading` (best practices, 46ca7f and ffd0e9), `audio-caption` (deprecated, 2eb176 and afb423).
  - Level AAA rules: 09o5cg, bisz58, b20e66.
  - 2t702h: Rampa's experimental `rampa/widget-name` maps to it and reports below the threshold. axe-core's `summary-name` fails the 3 failed examples but has no `actIds`, so axe-core's own report says not implemented.
  - 8fc3b6: in axe-core's own run, `object-alt` is inapplicable on every example, so that report is inconsistent there. In Rampa's run, the same rule fails all six failed examples.
- **In 0.1.0,** 13 more rules differed: the 7 approved and 5 proposed rules of the SVG and XML documents, and afw4f7 ([above](#two-fixes-in-011)).
- **Nothing here measures model judgments on real pages.** On real pages, Rampa's judged findings were right about 0.38 of the time at the default threshold ([fresh-page study](studies/real-pages-2026-10-fresh.md)). The ACT examples are small and were read while the prompts were written.

## Submission

**Status: pending.** Nothing has been submitted: no issue, pull request or e-mail. To submit:

1. Merge `docs/act-0.1.1` into `main` and push. The report then has its permanent address, `https://raw.githubusercontent.com/guilhermebsantiago/rampa-cli/main/bench/act-report/rampa.earl.json`, which W3C downloads again, so rebuild it after each release. The tag `v0.1.1` has no copy of this report (it was built after the release), so the issue also gives the address of the commit that added it, `26e0c24`; that address works once the commit is on GitHub.
2. Optionally, join the [ACT Rules Community Group](https://www.w3.org/community/act-r/), which the CG's own page asks for. It needs a W3C account and the CG's Contributor License Agreement. W3C's page does not mention it, and recent submissions did not either.
3. Open an issue at https://github.com/w3c/wcag-act-rules/issues/new with the text below, or send the same text to group-act-rules@w3.org.
4. Once W3C lists Rampa, add the ACT page's address to the Evaluation Tools List entry ([w3c-evaluation-tools-list.md](w3c-evaluation-tools-list.md)), and record the date and the issue here.

**Title:** New ACT Implementation Request: Rampa

**Body:**

```markdown
This issue is created to submit a new ACT implementation.

Tool name: Rampa
Version: 0.1.1 (https://www.npmjs.com/package/rampa-cli/v/0.1.1)
Webpage: https://rampa.guilhermebs.com.br (source: https://github.com/guilhermebsantiago/rampa-cli, MIT License)
By: Guilherme Santiago (an individual open-source project)
Implementation type: Automated tool
EARL report: https://raw.githubusercontent.com/guilhermebsantiago/rampa-cli/main/bench/act-report/rampa.earl.json
The same report at the commit that added it: https://raw.githubusercontent.com/guilhermebsantiago/rampa-cli/26e0c2490cf171d81941a52215c75bc7685e248f/bench/act-report/rampa.earl.json

Before you list it, please note:

- Rampa runs axe-core 4.14.0, and in this report every failed outcome comes from an axe-core rule; so does every procedure that makes a rule consistent or partial. Procedures named "<rule> (axe-core)" are axe-core rules as Rampa runs and reports them; "rampa/..." procedures are Rampa's own rules, which are experimental and only report items to review at the default threshold. axe-core already has its own implementation on these pages. If the group would rather not list a tool that embeds another implementation (the question in #107), please say so and I will withdraw this request.
- The report is the released rampa-cli 0.1.1, installed from npm, with no language model (`rampa check --no-llm`), at its default confidence threshold, run on every test case it reports on. Rampa's optional model judgments are not part of it.
- Some of Rampa's own rules and thresholds, and its model prompts, were checked against these test cases while they were written; the documentation marks the rules where that may have happened. On using the test cases that way, #107 records the group's answer: "allowed, but it is recommended not to". In this report those rules are experimental and give no failed outcome.
- Rampa does not test Level AAA. It checks standalone SVG documents with axe-core, and it does not check an XML document the browser shows as its source tree: its report says nothing was checked, and the outcome is passed, as for any page where nothing applied.
- How the report is built, how Rampa's results map to EARL outcomes, and the consistency act-tools computes from it (approved rules: 27 consistent, 0 partial, 2 inconsistent): https://github.com/guilhermebsantiago/rampa-cli/blob/main/docs/act-implementation.md

A proposed entry for act-implementations.yml:

    - name: Rampa
      homepage: https://rampa.guilhermebs.com.br/
      vendor: Guilherme Santiago
      vendorHomepage: https://github.com/guilhermebsantiago
      uniqueKey: rampa
      type: Automated tool
      standards:
        - WCAG 2.2 Level A, AA
      jsonReport: https://raw.githubusercontent.com/guilhermebsantiago/rampa-cli/main/bench/act-report/rampa.earl.json
      description: |
        Results of `rampa check --no-llm` (no language model) at the default confidence threshold.
        Rampa runs axe-core: procedures named "<rule> (axe-core)" are axe-core rules as Rampa runs
        and reports them; "rampa/..." procedures are Rampa's own rules, which are experimental and
        report only items to review at this threshold. XML documents that the browser shows as their
        source tree are not checked, and are passed as pages where nothing applies.
```

The entry leaves out `version`: act-tools then takes it from the report's assertor (0.1.1), as W3C now prefers for axe-core ([#452](https://github.com/w3c/wcag-act-rules/issues/452)).

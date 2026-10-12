# Performance: where a check's time goes, and how to make it shorter

A check of a real page takes seconds before any model call, and the judgment layer adds one call per candidate. This page measures where that time goes, and the options built on those measurements: `--fast` for CI and pre-commit hooks, batched judgment, and `--changed` for pull requests. Every number here comes from one machine on 2026-10-11 (see [Method](#method)); read them as orders of magnitude, and measure your own pages with `--timings`.

## --timings

`rampa check --timings` records where each page's time goes. The terminal report prints a breakdown after the model usage, and the JSON report carries it as `timings`; without the flag nothing is recorded, so reports of the same page stay the same from run to run. From code, `check(targets, { timings: true })` and `checkPage(page, { timings: true })` do the same.

```text
Time on this page: 4.02 s (--timings)
  browser launch                0.16 s   4%
  navigation                    0.98 s  24%
  settle after load             0.35 s   9%
  collection                    0.35 s   9%
  axe-core                      0.15 s   4%
  browser accessibility tree    0.02 s   0%
  label visibility (pixels)     0.00 s   0%
  contrast (pixels)             1.82 s  45%
  closing the page              0.01 s   0%
  rules                         0.01 s   0%
  judgment 2.4.4                0.00 s   0% · 27 candidate(s), 0 judged
  judgment 3.1.1                0.14 s   3% · 1 candidate(s), 0 judged, 0.14 s preparing
  ...
  other                         0.01 s   0%
```

| Stage | What it covers |
| --- | --- |
| browser launch | Starting Chrome or Edge; the first web page of a run pays for it |
| navigation | A new browser context, the request, the load event and any `--wait-for` |
| settle after load | The wait until the network and the DOM have been quiet for 300 ms, at most 3 s ([browser-options.md](browser-options.md)) |
| collection | Reading the page into the snapshot: the in-page walk, refs, the browser's form issues, closed shadow roots, motion facts |
| axe-core | Injecting axe-core and running it in the page and its frames |
| browser accessibility tree | The roles and names Chromium computes, over CDP |
| image capture | Screenshots of images (and CSS backgrounds) for the criteria that judge pixels; only with the judgment layer |
| label visibility | Two captures per label 3.3.2 relies on, to tell whether it shows its text |
| contrast (pixels) | Contrast measured from pixels where axe-core could not decide, and for placeholders and icons ([rules.md](rules.md)) |
| link following | Reading where links lead, for 2.4.4; only with the judgment layer |
| page screenshot | `--screenshots` |
| probes | `--probe`, one entry per kind ([probes.md](probes.md)) |
| closing the page | Closing the page's browser context |
| rules | Rampa's rules over the snapshot and the probe facts |
| judgment *criterion* | From the criterion's start to its last verified answer: preparing (OCR for 1.4.5, the language data for 3.1.x), its candidates, the model's answers, verification; with its candidates, the candidates judged, and the model calls made and read from the cache |
| advisory profiles | `--profile` |
| source lines | Tracing findings back to a local file's lines |
| other | What no stage holds: building the report, and in a crawl the wait for a page's turn to be judged |

Stages that did not run are left out. The JSON has the same in milliseconds:

```json
"timings": {
  "totalMs": 4016,
  "stages": [{ "stage": "navigation", "ms": 983 }, { "stage": "probes", "ms": 9120, "parts": [{ "name": "keyboard", "ms": 6200 }, { "name": "layout", "ms": 2920 }] }],
  "criteria": [{ "criterion": "2.4.6", "ms": 14610, "prepareMs": 0, "candidates": 20, "judged": 10, "calls": 2, "cachedCalls": 0, "batches": 2 }],
  "otherMs": 12
}
```

## Where the time goes

Three real pages ([Method](#method)), in seconds: the median of three runs without a model (`--no-llm`) and with the judgment layer on but no model call made (every candidate a cache miss, `--offline`), and one run with Gemma 4 12B on the local GPU. A stage under 0.05 s on every page is left out.

| Stage | gov.br, no model | gov.br, judgment, no calls | gov.br, Gemma | webaim.org, no model | webaim.org, judgment, no calls | webaim.org, Gemma | debian.org, no model | debian.org, judgment, no calls | debian.org, Gemma |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| **Total** | **6.70** | **12.24** | **237.0** | **6.08** | **14.01** | **292.5** | **4.02** | **7.38** | **165.0** |
| browser launch | 0.15 | 0.15 | 0.23 | 0.17 | 0.18 | 0.29 | 0.16 | 0.23 | 0.41 |
| navigation (network) | 2.16 | 3.84 | 2.07 | 1.56 | 6.80 | 2.07 | 0.98 | 0.91 | 1.13 |
| settle after load | 0.41 | 0.38 | 0.37 | 0.31 | 0.31 | 0.32 | 0.35 | 0.31 | 0.33 |
| collection | 1.20 | 1.29 | 1.26 | 0.41 | 0.47 | 0.51 | 0.35 | 0.38 | 0.42 |
| axe-core | 0.56 | 0.59 | 0.58 | 0.44 | 0.52 | 0.57 | 0.15 | 0.19 | 0.18 |
| browser accessibility tree | 0.09 | 0.09 | 0.09 | 0.04 | 0.04 | 0.04 | 0.02 | 0.03 | 0.02 |
| image capture | – | 1.02 | 1.17 | – | 1.42 | 1.54 | – | 1.28 | 2.04 |
| label visibility | 0.00 | 0.00 | 0.00 | 0.21 | 0.21 | 0.19 | 0.00 | 0.00 | 0.00 |
| contrast (pixels) | 2.05 | 2.28 | 2.56 | 1.70 | 1.85 | 2.19 | 1.82 | 1.93 | 2.84 |
| link following | – | 1.46 | 1.51 | – | 2.06 | 2.09 | – | 1.84 | 0.54 |
| rules | 0.04 | 0.04 | 0.04 | 0.02 | 0.02 | 0.03 | 0.01 | 0.01 | 0.01 |
| judgment 1.1.1 | – | – | 32.7 (10 calls) | – | – | 25.1 (10) | – | – | 29.3 (8) |
| judgment 2.4.4 | – | – | 175.8 (50 of 101 candidates) | – | – | 138.8 (47) | – | – | 65.6 (27) |
| judgment 2.4.6 | – | – | 18.4 (6) | – | – | 99.9 (29) | – | – | 61.9 (20) |
| other criteria | 0.14 | 0.15 | 0.24 | 0.20 | 0.24 | 18.7 (1.3.5, 2.4.2) | 0.14 | 0.17 | 0.27 |

- **Without a model**, the page's own load is the largest part (navigation is the network), and of what Rampa runs itself, **contrast from pixels** is the largest stage on every page: 1.7 to 2.4 s, 30 to 45% of the check. Every finding it made on these pages was experimental, below the default threshold. axe-core took 0.15 to 0.6 s, Rampa's rules under 0.05 s, the browser's accessibility tree under 0.1 s. The wait after load stayed under half a second: every page settled long before its 3 s cap.
- **The judgment layer before any call** adds image capture (1.0 to 1.4 s) and link following (1.5 to 2.1 s): about 4 to 8 s more a page.
- **With a model**, the model is nearly all of it: 55 to 89 calls a page, 165 to 292 s, of which 2.4.4 alone took 40 to 74%. That is about 3 s of wall time a call, with four calls in flight (`--concurrency 4`); nothing in the collection compares.

## --fast

`rampa check --fast` (`fast: true` in the config, or from code) is a preset for CI and pre-commit hooks. It leaves out what the timings above show is expensive and rarely decides a finding at the default threshold, and keeps what is cheap:

| What | Without `--fast` | With `--fast` | Why |
| --- | --- | --- | --- |
| Candidates the model judges per criterion and page | 50 | 10, those with a generic text first (as `--max-candidates` picks them) | Model calls are most of a judged page's time ([below](#before-and-after)), and the generic texts are the ones whose findings keep their confidence ([criteria.md](criteria.md)) |
| Candidates per model call | 1 | up to 8, for 2.4.6, 3.1.2 and 3.3.2 ([Batched judgment](#batched-judgment)) | Fewer calls and input tokens; only where the scores held |
| Where links lead (2.4.4) | read, same origin | not read (`--follow-links none`) | 1.5 to 2.1 s a page with the judgment layer. A destination only lets a link fail as a mismatch, which needs it read; generic and ambiguous texts are judged from text and context either way |
| Contrast from pixels | measured | not measured | 1.7 to 2.8 s on every page in two rounds, the largest stage Rampa runs itself (30 to 55% of a check without a model); on the three pages every finding it made was experimental, below the default threshold. What axe-core could not decide stays in "needs review" |
| Image captures | 25 images and 10 CSS backgrounds, within 15 s | 15 images within 5 s; CSS backgrounds only when 1.4.5 is judged | 1.0 to 1.4 s a page here, but up to 15 s on a page of lazy images. Backgrounds serve only 1.4.5, which is not a default criterion. A first try at 10 images left one image on webaim.org uncaptured, and with it a confirmed 1.1.1 finding; 15 holds the images 1.1.1 judged on all three pages |
| Wait after load | up to 3 s | up to 1 s | The three pages settled in 0.31 to 0.45 s; the cap only matters on a page that never settles (a ticker, a poll), which then costs 1 s instead of 3 |
| Probes, OCR (1.4.5) | only when asked | only when asked | Probes took about 20 s a page even on the small ACT pages ([benchmark.md](benchmark.md)) |
| axe-core, Rampa's rules, the browser's tree, label visibility, the language identifier | run | run | 0.15 to 0.6 s, under 0.05 s, under 0.1 s, under 0.35 s and 0.14 s: cheap, and they decide most findings |

**What you set wins.** The preset fills in only what the run left at Rampa's defaults: `--max-candidates`, `--follow-links`, `--probe`, `--criteria` and `--no-batch` given on the command line, and `maxCandidates`, `criteria` and `batch` in the config, keep their values. `--no-fast` turns off the config's `fast` for one run. `rampa eval --fast` runs the preset on every test page, and `rampa baseline --fast` records what `rampa check --fast` sees.

**The report says so.** The terminal header says "fast mode (--fast)", and every format lists, first under the coverage, what fast mode left out and the limits it lowered, for example:

```text
Fast mode (--fast):  left out probes, link following (2.4.4 judged from text and context), OCR (1.4.5), contrast from pixels (axe-core's undecided contrast stays to review), CSS background captures; lowered to at most 10 candidates per criterion, 15 image captures, 1 s of waiting after load
```

The JSON report has it as `coverage.fast`: `{ "skipped": ["probes", "link-following", "ocr", "pixel-contrast", "css-backgrounds"], "maxCandidates": 10, "imageLimit": 15, "settleCapMs": 1000 }`. Candidates past the cap are counted as not judged in each criterion's summary and coverage, and a note names them, as with `--max-candidates`; images past the capture limit are in the note on images without a capture. A criterion with candidates left unjudged is never "no failure found", and a baseline entry about one of them is not counted as fixed.

## Batched judgment

With batched judgment (`--batch`, `batch: true` in the config or from code, and on with `--fast`), a criterion that opts in sends the model several of its candidates in one call instead of one call each. The candidates it asks the same way (the same instructions and answer schema, no picture) go in batches of up to 8, in page order, and of at most 4,000 characters of question, so a batch stays well inside the 4,096-token context Ollama gives a local model by default. Each candidate keeps its own question, wrapped in an `<item>` with an id, under the criterion's instructions and a note to judge every item as if it were the only one; the answer holds one judgment per id. Then every judgment goes through the criterion's own `settle` and `verify`, as one from a call of its own: an answer that quotes another item's text fails verification and is discarded, never reported.

- **Cache.** A batch is cached under its own prompt, never under a candidate's: a batch's answer never answers a candidate asked alone, and the other way round. Offline, a batch that is not in the cache is looked up one candidate at a time.
- **Fallbacks.** A candidate the answer leaves out is asked alone, for all its runs, so its votes never mix the two; so is every candidate of a batch whose call fails. A candidate alone in its group, and one with a picture (1.1.1), are always asked alone.
- **What the report says.** Each criterion's summary counts the candidates judged in batches and the calls (`batched`), the timings count the batches, usage counts each batch once, and a note lists the criteria judged that way.

### Which criteria batch

Each criterion opts in with `batch` in its module, and only where its scores held batched. The measurement: `rampa eval` on the default criteria with Gemma 4 12B, once one call per candidate and once with `--batch` and every text criterion opted in, each from an empty cache. ACT test pages are small, so batches formed only where a page had two or more candidates of a criterion:

| Criterion | Pages with 2+ candidates | Candidates batched (calls) | Calls, single → batched | Sets that changed (F1, single → batched) | Decision |
| --- | ---: | ---: | --- | --- | --- |
| 2.4.4 Link Purpose | 33 | 73 (33) | 99 → 59 | 5effbb 1.00 → 0.83 (one passed example failed, one failed example passed); pairs 0.98 → 0.95 (link-generic 11/11 → 10/11); fd3a94 0.70 → 0.74; 2 discarded claims (0 before) | **no batching** |
| 2.4.6 Headings and Labels | 3 | 18 (3) | 45 → 30 | none (cc0f0a 0.91, b49b2e 0.89, pairs 0.95, heading-generic 8/9 both ways) | batches |
| 3.1.2 Language of Parts | 7 | 17 (7) | 32 → 22 | none (de46e4 1.00, off6ek 1.00, pairs 0.75 both ways); 3 discarded claims (1 before) | batches |
| 3.3.2 Labels or Instructions | 2 | 8 (2) | 16 → 10 | none (pairs 1.00, label-hidden and label-unseen 7/7 both ways) | batches |
| 1.3.5 Identify Input Purpose | 0 | 0 | 26 → 26 | none | **no batching**: no test page asks about two fields, so batching is unmeasured |
| 1.1.1, 2.4.2, 3.1.1 | 0 | – | – | – | one picture, or one candidate, per page |

Across the run, batching took the model calls from 274 to 203 and the input tokens from 217k to 176k; output tokens rose from 22.7k to 25.0k (each item's id and wrapper). Paired on the 343 test cases, three verdicts differed, all 2.4.4 (McNemar p = 1.0). The batched run took longer, 996 s against 816 s. The evaluation checks four pages at a time, so Ollama already had several calls side by side, and a batch writes its answers one after another in a single call; and every call waited longer during that run, batched or not (1.1.1, never batched, went from 6.9 to 18.7 s a call), so the wall times of these two runs say little either way. What batching saves for sure is calls and input tokens, which is what a hosted model bills and rate-limits; on real pages, checked one at a time, it also saved time ([Before and after](#before-and-after)).

The evidence for 2.4.6 and 3.3.2 is thin, three and two batched pages: they batch because nothing dropped, not because they were shown to hold on long pages. [Before and after](#before-and-after) compares batched and single judgments on three real pages.

## --changed

`--changed` keeps, of the local HTML files a run would check, those changed since a git ref: committed since it, staged, modified, or new and not ignored. Without a value the ref is the merge base of `HEAD` with the default branch (`origin/HEAD`, else `origin/main`, `origin/master`, `main` or `master`), which is what a pull request changed; `--changed=<ref>` names another, such as `--changed=HEAD` for what is not committed yet. URLs and other targets are always checked. stderr says how many files it checked and skipped, and each report lists the skipped ones in a note; when nothing changed, the terminal says so and the run exits 0.

Put `--changed` after the targets, or write `--changed=<ref>`: `rampa check --changed site` would read `site` as the ref (Rampa says so). In CI the merge base needs the history: `actions/checkout` with `fetch-depth: 0` ([github-action.md](github-action.md#fast-checks-on-pull-requests)). A changed style sheet or script changes pages whose HTML did not; `--changed` does not see that, so keep a full check on `main`.

## Before and after

### Three real pages

Seconds per page, without and with `--fast`, run back to back. Without a model, the median of three runs; with Gemma 4 12B, one run each, from an empty cache. The runs without a model came two hours after those of the stage table above, which is why their totals differ by up to a second: mostly the network, and the contrast measurement.

| Page | No model | No model, `--fast` | Gemma | Gemma, `--fast` | Model calls | Confirmed findings, default → fast |
| --- | ---: | ---: | ---: | ---: | --- | --- |
| gov.br/pt-br | 7.64 | 5.85 (−23%) | 237.0 | 87.1 (−63%) | 66 → 22 | no model 4 → 4; Gemma 6 → 5 |
| webaim.org/techniques/alttext | 6.47 | 4.01 (−38%) | 292.5 | 102.7 (−65%) | 89 → 26 | no model 0 → 0; Gemma 8 → 8 |
| debian.org | 5.12 | 2.30 (−55%) | 165.0 | 73.9 (−55%) | 55 → 20 | no model 11 → 11; Gemma 13 → 14 |

- **Without a model**, `--fast` saved 1.8 to 2.8 s a page, nearly all of it the contrast from pixels; the confirmed findings were the same, and the findings below the threshold went from 17 to 9 on gov.br (the pixel checks' experimental ones).
- **With Gemma**, it cut the calls by about two thirds and the time by 55 to 65%. 2.4.4 went from 50, 47 and 27 calls to 10 each (176 s to 32 s on gov.br), and 2.4.6, batched and capped, from 99.9 s to 18.6 s on webaim.org.
- **What fast mode did not judge.** It judged 10 of 101, 47 and 27 links (2.4.4) and 10 of 29 and 20 headings and labels (2.4.6). The confirmed 2.4.4 findings, the two "More..." links on debian.org, were found both ways: generic texts go first. What it missed were failures below the default threshold: on webaim.org the full run's three 2.4.4 and one 2.4.6 failures, on debian.org two of its three 2.4.4 failures; and its own below-threshold 2.4.6 failure on debian.org ("People") was another heading than the full run's two ("More..."). The reports count the candidates left out as not judged.
- **The changes in confirmed findings are the model's, not fast mode's.** Both are 1.1.1, which fast mode neither capped on these pages (8 to 10 images) nor batches: an image on gov.br ("Trabalhador") failed in two of the four runs with the model, and a screenshot on debian.org in one of four. Even at temperature 0 a local model answers a little differently from run to run when calls run side by side.
- **Batched judgment on these pages.** Run with `--batch` and nothing else changed, 2.4.6 judged its 6, 29 and 20 headings in 1, 7 and 3 calls, with the same verdicts, the same discarded claims and the same findings as one call each, in 15, 38 and 25 s instead of 18, 100 and 62 s.

### The ACT evaluation

`rampa eval` on the default criteria, 343 test pages (257 ACT test cases, 79 corrupted copies and 7 intact pages lent for pairs), each run from an empty cache:

| Run | ACT cases: precision / recall / F1 | Corrupted pairs told apart | Model calls (new) | Input / output tokens | Wall time |
| --- | --- | --- | ---: | --- | ---: |
| default | 0.867 / 0.978 / 0.919 | 71 of 79 | 274 | 217k / 22.7k | 816 s |
| `--batch`, every text criterion opted in (the measurement) | 0.865 / 0.968 / 0.914 | 70 of 79 | 203 | 176k / 25.0k | 996 s |
| `--fast` (the final preset) | 0.850 / 0.978 / 0.910 | 72 of 79 | 243 | 202k / 25.2k | 742 s |

Under `--fast` seven verdicts changed, all 2.4.4, nearly all on fd3a94, whose test cases turn on where links lead: without link following, four passed examples failed and two inapplicable ones passed (fd3a94 F1 0.70 → 0.64). One more mismatch pair was told apart (link-mismatch 9/10 → 10/10). The cap never bit on these small pages, and batching (2.4.6, 3.1.2, 3.3.2) changed no verdict. Paired over the 343 cases the default run was right on 320 and `--fast` on 319 (McNemar p = 1.0). ACT pages are tiny, so the evaluation measures what fast mode does to verdicts, not the time it saves: that is the table above.

## Method

- **Machine.** AMD Ryzen 5 7600X (12 threads), 31 GB, NVIDIA GeForce RTX 5060 Ti 16 GB, Windows 11, Node 24.21.0, Microsoft Edge 155 headless. Model: `ollama:gemma4:12b` (Q4_K_M) on Ollama 0.40.2 with its default 4,096-token context, reasoning off, temperature 0.
- **Pages.** Three public pages of the [real-page study](studies/real-pages-2026-10.md)'s development split, chosen to differ: a government home page with many links and images (`https://www.gov.br/pt-br`), an accessibility article (`https://webaim.org/techniques/alttext/`) and an open-source project's home page (`https://www.debian.org/`). They are live pages: their content, and the network, change between runs.
- **Timings.** `node scripts/timings.ts <label> [--repeats n] -- <rampa check options>` runs `rampa check --timings --format json` on each page, each run in a fresh working directory, so no judgment, destination or OCR cache carries over, and keeps the median of each stage over the repeats in `.rampa/timings/<label>.json`. Each run is its own process, so each total includes the browser's launch (about 0.2 s). Runs without a model were repeated three times; runs with the model once, since the model's time varies less than the network's.
- **"Judgment on, no calls".** To see what the judgment layer costs before any model call (image capture, link following), the pages were also checked with `--model ollama:gemma4:12b --offline` and an empty cache: every candidate is an offline miss, and every collection stage runs as it would with the model.
- **The evaluation.** `rampa eval` on the default criteria (1.1.1, 1.3.5, 2.4.2, 2.4.4, 2.4.6, 3.1.1, 3.1.2, 3.3.2), with its corrupted pairs, ACT test cases `a9a1483e`, 343 cases, four pages at a time, each run from an empty cache and destination cache: once as is, once with `--batch` (every text criterion opted in, for the measurement), once with `--fast`. `rampa compare` gave the per-set scores and the paired comparison. The eval records its wall time since this change (`wallMs` in summary.json).
- **The machine was not idle.** The stage table's runs without a model ran while a benchmark used the browser on the same machine; the model runs came after it. The network dropped twice during a first round of `--fast` runs; that round was left out and the before-and-after runs were made later, back to back.

## Limits

- **Three pages, one machine, one model.** The timings show where the time goes and roughly how much `--fast` saves; they are not a benchmark of pages in general. A page with hundreds of links, many images or slow third-party scripts spends its time differently. Measure yours with `--timings`.
- **Fast mode judges less.** Ten candidates per criterion means the 11th "Read more" on a long page is not judged; the report counts it as not judged and leaves the criterion to review, but a CI gate on `--fast` can pass a page a full check would fail. Run the full check where it matters.
- **Batched judgment is measured on small pages.** ACT test pages hold few candidates, so 2.4.6 and 3.3.2 batched on three and two pages. On a long real page a batch holds up to 8 questions; the real-page comparison above is about agreement, with no ground truth.
- **Batching and a small context.** Batches stop at 4,000 characters of question so they fit a 4,096-token context with the instructions and the answers. A model server with a smaller context, or a criterion with longer instructions, could still cut a batch's prompt short; verification then discards what does not match, and the candidates count as discarded rather than judged.
- **`--changed` sees HTML files only.** A style sheet, a script or a template change that alters rendered pages without touching their HTML is not a change to it; neither is a page generated by a build from changed sources, unless the build output is what you check. Keep a full check on `main`.

# Held-out pages: a fourth real-page study (October 2026)

The [third real-page study](real-pages-2026-10-round3.md) found 0.43 on its dev pages and 0.24 on its test pages at the default threshold. A [probe over the three studies' labels](notes-precision-probe.md) then traced most of the false positives to three causes, and the changes it led to were merged into `main` on 2026-10-24 with the robustness fixes and narrower 2.4.4 facts: a guard for a page captured without its stylesheets and one for a layer over the viewport, a one-word second pass over the 1.1.1 claims that rest on the model's reading, three kinds of claim moved to suggestions, three small 1.1.1 facts, and destination reads through undici with per-origin pacing. Replayed on the recorded snapshots of the pages they were chosen from, they gave 0.30 on the third study's test half (0.77 without www.ufpe.br), 0.77 on the second study's and 0.84 pooled; those numbers are in-sample. This study runs that code, `main` at `6e0947a`, on 24 pages none of it has seen, with the third study's method, rubric and two-judge labels, plus a run with the second pass turned off and a labelled sample of suggestions.

**In short.** With Gemma 4 12B, at the default threshold (what `rampa check` shows and fails on), **0.54 of the judged findings on the test pages were real failures (14 of 26 decided, 95% Wilson 0.35–0.71), the pre-registered primary measure.** Against the third study's test half, 0.24 (24 of 99), the difference is +0.30 (Newcombe 95% interval +0.09 to +0.48): **by the reading fixed in advance, precision went up.** Against the second study's test half after its 2.4.4/2.4.6 change, 0.38 (12 of 32), it is +0.16 (−0.09 to +0.39): **no measurable change.** Three things limit what that says. Sixteen of the 26 findings sit on two pages (8 true 2.4.4 findings on tst.jus.br, 8 false 3.1.2 findings on museudoamanha.org.br), and resampling the 12 test pages gives 0.13–0.92 for the same number. **The dev half, which the code had not seen either, came out at 0.19 (13 of 67, 0.12–0.30)**: 50 of its 67 decided findings are 2.4.4 false positives on one store page, every link the per-criterion cap let through. Over all 24 pages the precision is **0.29 (27 of 93, 0.21–0.39), the same as the third study's 0.29 (40 of 136)**; that pooled comparison was not pre-registered. Each study has one page with 50 false 2.4.4 findings, and the half it fell in sets that half's number; without those two pages, 0.63 (27 of 43) against 0.47 (40 of 86), +0.16 (−0.02 to +0.33), exploratory too. The parts that can be measured on their own did what they were built for: **the second pass removed 12 of the 17 false 1.1.1 reading claims and 1 of the 4 true ones** (1.1.1 went from 0.23 to 0.44 over both halves, and the test half from 0.43 to 0.54, with the pass off and on, on the same answers), and **1 of 39 sampled suggestions was a real failure** (1 of the 38 decided, 0.03, 0.01–0.14), so the claims sent to review hold about 2 true failures in 72. The unstyled-page guard fired once, on a page whose screenshot is styled, and the layer guard hid a consent layer on 3 pages. All labels come from Claude agents, not people, and the run is a single run.

**Future tuning may use the dev split only.** The test half's false positives were counted, not read, and are listed below by check and cause only. Only the dev half's may be studied to change Rampa.

## Question and pre-registration

When Rampa reports a failure on a page it has never seen, how often is the failure real, now that the precision work is merged? Precision only, per criterion and per check; pages were not audited for what Rampa missed.

The pages, the seeded split, the method and the analysis plan were committed before Rampa ran on any of them: [`e4825c4`](../../study/round-4-2026-10-24/preregistration.md), 2026-10-24 01:29:16 (UTC−3); the first collection started 8 seconds later. Only the pre-screen in headless Edge and the link listing used to pick inner pages had loaded the pages before that. The pre-registration fixes:

- **the primary measure**: test-split precision at the default threshold over the judged criteria, from the main run, with its 95% Wilson interval;
- **the comparison** with the third study's test half (0.24, 24 of 99) and the second study's after its 2.4.4/2.4.6 change (0.38, 12 of 32), by the difference and its Newcombe hybrid score interval (method 10), and its reading: **went up** when the interval lies above 0, **went down** when it lies below, otherwise **no measurable change**;
- **nine secondary measures**: the dev half and every finding counted; each criterion; the run with `--no-confirm` on the same snapshots and answers; the second pass's shares of confirmed, denied and not asked claims; each page's capture state; precision without the 1.1.1 findings under 0.99; a labelled sample of suggestions, 20 a split, drawn with a fixed seed; sensitivity (without the top page, uncertain counted both ways, a page-level bootstrap); the experimental rules and the judges' agreement;
- **the rules**: a network drop is retried, a refusal waits ten minutes and then goes to the slot's next backup, an unstyled capture is not a refusal, everything runs once, `src/` does not change, and the test half is counted, not read.

What changed after it is listed under "Differences" and "Deviations".

## Pages

**Exclusions.** No registrable domain of the first, second or third study, the re-measure or the robustness study's 53 sites, and none that any file or commit message of the repository names on any of its 8 branches: 2,111 domains by the Public Suffix List's rule, the benchmark's among them (`scripts/exclusions.py`, `data/excluded-domains.json`). Three backups were named in the repository and were replaced before the screen (em.com.br, jota.info and weather.gov by correiodopovo.com.br, nsctotal.com.br and recreation.gov).

**Design.** The third study's: twelve strata, Brazil or international, times government, education, news, e-commerce, health, and culture or public services; in each, a home page and an inner page from two different sites. Brazilian pages are in Portuguese, the others in English (United Kingdom, United States, Ireland).

**Selection.** A primary and backups per slot were written down before the screen (`scripts/candidates.tsv`), and each was loaded in headless Edge (`scripts/screen.mjs`, `data/screen-*.json`). The connection dropped during the screen and the link listing; those loads were tried again once it answered. Three primaries were replaced: ufrj.br sent the browser to its English site (ufpr.br took the slot), bristol.ac.uk answered 403 "Content blocked" (leeds.ac.uk), and ryman.co.uk and the first backup hobbycraft.co.uk showed a Cloudflare challenge (toolstation.com). Inner pages were picked from each site's navigation (`scripts/links.mjs`) by the slot's rule: the first article on a news or health home page, the first category of a store's menu, a contact page, an admissions page. Two pages declare a language other than their text's, es.gov.br (`lang="en"`) and the theconversation.com article (`lang="pt-BR"`); both were kept as they are. `scripts/pages.tsv` says why each page was chosen.

**Split.** In each stratum a seeded coin (Python `random.Random(20261024)`) sends the home or the inner page to dev and the other to test (`scripts/split.py`, `data/pages-input.json`). No probe subset was drawn.

| Split | Page | Category | Country | Language | Type |
| --- | --- | --- | --- | --- | --- |
| dev | https://osesp.art.br/osesp/pt/fale-conosco | culture | BR | pt-BR | contact |
| dev | https://www.cobasi.com.br/c/cachorro | e-commerce | BR | pt-BR | listing |
| dev | https://www.mackenzie.br/processos-seletivos/vestibular-graduacao/universidade-campus-alphaville | education | BR | pt-BR | info |
| dev | https://www.es.gov.br/ | government | BR | pt-BR | home |
| dev | https://www.hospitalmoinhos.org.br/institucional | health | BR | pt-BR | home |
| dev | https://www.infomoney.com.br/politica/lula-e-flavio-fazem-promessas-sobre-dividas-seguranca-e-saude-no-ultimo-debate/ | news | BR | pt-BR | article |
| dev | https://www.nls.uk/contact/ | culture | UK | en | contact |
| dev | https://www.toolstation.com/plumbing/c15 | e-commerce | UK | en | listing |
| dev | https://www.leeds.ac.uk/undergraduate | education | UK | en | info |
| dev | https://www.gov.scot/ | government | UK | en | home |
| dev | https://www.bhf.org.uk/informationsupport/heart-matters-magazine/nutrition/eat-well-on-a-budget | health | UK | en | article |
| dev | https://theconversation.com/the-jackdaw-gasfield-passed-the-legal-test-for-north-sea-drilling-rosebank-will-find-it-much-harder-295029 | news | UK | en | article |
| test | https://museudoamanha.org.br/ | culture | BR | pt-BR | home |
| test | https://www.tramontina.com.br/ | e-commerce | BR | pt-BR | home |
| test | https://ufpr.br/ | education | BR | pt-BR | home |
| test | https://www.tst.jus.br/ouvidoria | government | BR | pt-BR | contact |
| test | https://dasa.com.br/blog/dasa-educa/vacinacao-em-idosos/ | health | BR | pt-BR | article |
| test | https://www.r7.com/ | news | BR | pt-BR | home |
| test | https://www.nhm.ac.uk/ | culture | UK | en | home |
| test | https://thepihut.com/ | e-commerce | UK | en | home |
| test | https://www.gla.ac.uk/ | education | UK | en | home |
| test | https://www.fueleconomy.gov/feg/findacar.shtml | government | US | en | form |
| test | https://www.mdanderson.org/ | health | US | en | home |
| test | https://www.thejournal.ie/ | news | IE | en | home |

## Method

### The same as the third study

- **Collection, no model call.** `rampa check <url> --model ollama:gemma4:12b --offline --locale en --min-confidence low --save <dir> --screenshots`, with Edge 155 through playwright-core (`scripts/collect.sh main`), on 2026-10-24 from 01:29 to 01:38. Every page was collected on its first attempt, with no network error in any log and no refusal page.
- **Judgment on the saved snapshot.** `rampa check <snapshot> --model ollama:gemma4:12b --locale en --min-confidence low --time-limit 900 --concurrency 2` (`scripts/run-judged.sh default`), the second pass on, as it is by default. Pages one at a time, 01:40 to 02:21. No page reached the time limit and no report lists an error.
- **Model.** Gemma 4 12B (`gemma4:12b`, digest `6114515d63c1`), on Ollama 0.40.3, on a local GPU.
- **Labels.** Two Claude agents per packet, an auditor and a skeptic, each told not to read the other's work, with the third study's rubric, prompt (including its one-line reply) and packet format, without Rampa's `confidence` and `patch`. Final label: the label both gave, else `uncertain`; a false positive's cause is the one both named, else `disputed`. Precision is TP / (TP + FP) with uncertain findings left out; 95% Wilson intervals; Cohen's kappa over the three labels. Engine (axe-core) findings, 737 of them, were not labelled.

### Differences from the third study

1. **Code.** `main` at `6e0947a` against `d23cfb5`: the merged branches `fix/robustness` (bot walls, crashes, load handling), `fix/remaining-errors` (version 5 of the 1.1.1 question, narrower 2.4.4 facts) and `probe/precision` (the capture guards `reach.stylesheets` and `reach.overlay`; 2.4.6 labels several fields share, 3.3.2 claims on a collapsed or search field and 2.4.4 addresses in a sentence moved to suggestions; three 1.1.1 facts; the 1.1.1 second pass in `src/core/confirm.ts`, which asks three one-word framings and keeps a finding only when all three confirm and the lowest probability is at least 0.9; destination reads through undici 8 with per-origin pacing).
2. **No probe run.** The merged work does not change the probes, and with at most two judge agents at a time the labelling went to the judged criteria, the ablation and the suggestion sample. Decided in the pre-registration.
3. **The ablation.** Each snapshot judged again with the same flags plus `--offline --no-confirm`, from a fresh copy of the page's judgment cache (`scripts/run-noconfirm.sh`, 02:21 to 02:22). Every first-pass answer is read back from the cache (0 offline misses), so the two runs differ only by the second pass: a claim it denied is a finding in the ablation and a suggestion in the main run. The findings the ablation has and the main run lacks were labelled with the rest.
4. **A sample of suggestions.** Of the main run's suggestions (review items that name a model) other than the second pass's, 20 a split were drawn after a fixed ordering with `random.Random(20261024)`, at most 3 from a page (`scripts/sample_suggestions.py`, `data/suggestion-sample.json`): 20 of the test half's 50, and 19 of the dev half's 22, since two dev pages held 9 of them and the cap of 3 a page left 19.
5. **One packet a page holding three origins**, in a seeded shuffled order and in the same form, so that a judge could not tell them apart: the main run's findings at any confidence (as before), the ablation's own findings, and the drawn suggestions (whose `patch` and quote are left out like a finding's). 22 packets, 175 items; mackenzie.br and hospitalmoinhos.org.br had nothing to label.
6. **Judge agents.** 44 agents (Claude Opus 5.5) for 44 label files, one packet's pair at a time, from 02:26 to 03:49. None was launched again, every label file was valid the first time, and every judge replied with the count line only (`run-log-notes.txt`).

### Deviations

- **Analysis scripts changed after the pre-registration.** The pre-registration says a script changes after it only to fix a bug that stops it. `scripts/analyze.py` and `scripts/tables.py` were changed, and `scripts/extras.py` written, to compute the pre-registered measures (the three origins, the third study's row, the ablation, shares, capture, the 0.99 cut, the sample, the bootstrap). They were committed in `a04ff17` at 02:22, before the first label file (02:26), so no label was known when they were written. `scripts/exploratory.py` was written after the numbers were known, and every number it gives is marked exploratory below.
- **The person running the study looked at thejournal.ie's screenshot**, a test page, to check what the unstyled guard recorded (below). No finding or label of that page was read.
- Nothing else: no retry, no replacement, no page collected or judged twice.

## Capture state

From each snapshot's `reach` (pre-registered secondary 5). A page with nothing listed had all its stylesheets applied, no layer over the viewport, and no limit reached.

| Split | Page | Stylesheets (linked, applied, failed) | Unstyled, retried | Layer over the viewport | Other |
| --- | --- | --- | --- | --- | --- |
| dev | es.gov.br | 18, 17, 1 ("no rules", a fonts sheet) | | | |
| dev | mackenzie.br | | | | cut at 5,000 elements |
| dev | hospitalmoinhos.org.br | | | | still changing after 3 s |
| dev | toolstation.com | | | OneTrust consent, 0.89 of the viewport, hidden | |
| dev | bhf.org.uk (article) | | | OneTrust consent, 0.89, hidden | |
| test | tst.jus.br (ouvidoria) | 20, 19, 1 ("no rules") | | | |
| test | dasa.com.br (article) | 27, 23, 4 ("no rules") | | | |
| test | r7.com | | | | cut at 5,000 elements; still changing after 3 s |
| test | tramontina.com.br | | | | cut at 5,000 elements |
| test | thepihut.com | | | | cut at 5,000 elements; still changing after 3 s |
| test | mdanderson.org | | | | still changing after 3 s |
| test | thejournal.ie | 7, 6, 1 (the page's own address, "not loaded") | **yes, yes** | a `div`, 0.89, hidden | |

- **The unstyled guard fired once, on a styled page.** On thejournal.ie, six of seven linked stylesheets applied; the seventh is a `link rel="stylesheet"` whose address resolves to the page itself, which never loads as a sheet. The guard calls a page unstyled when none of its same-origin sheets applied, and that link was the only same-origin one (the other six come from other origins), so the page was loaded again, recorded as unstyled, and its judgment fails became suggestions (3 on 2.4.6, 1 on 1.1.1); its screenshot is styled. Kept as recorded, by the pre-registered rule. Of those four suggestions, three were drawn: the 1.1.1 one is a true failure by both judges, the two 2.4.6 ones false. This comes from a test page's capture, so a change to the rule would have to be measured on new pages. No page like www.ufpe.br in the third study (a capture without its theme) appeared, so the guard's intended effect is not measured here.
- **The layer guard** hid a consent layer covering 0.89 of the viewport on three pages while images, labels and contrast were captured.
- **Load.** No page hit the load timeout; four were still changing when the 3-second settle cap ran out.
- **Two dev pages gave almost nothing to judge**, only the page's title and language. mackenzie.br was cut at 5,000 elements, with no image, link, heading or field candidate in what was kept, and on hospitalmoinhos.org.br 315 of its 316 links were `aria-hidden` when it was read.

## Results

All 24 pages were judged. The main run produced 97 findings from the judged criteria (95 at the default threshold) and 25 from experimental rules and judgments; the ablation added 14, and 39 suggestions were drawn: 175 labelled items.

### The primary measure

| | Test, default threshold | Difference | Reading |
| --- | --- | --- | --- |
| **This study (`6e0947a`)** | 14 / 12 / 0: **0.54** (0.35–0.71) | | |
| Third study (`d23cfb5`) | 24 / 75 / 4: 0.24 (0.17–0.34) | **+0.30 (+0.09 to +0.48)** | **went up** |
| Second study after the 2.4.4/2.4.6 change (`4fd54fc`) | 12 / 20 / 0: 0.38 (0.23–0.55) | +0.16 (−0.09 to +0.39) | no measurable change |

Cells are true positives / false positives / uncertain, then precision and its 95% Wilson interval; differences with Newcombe's 95% interval. The page-level bootstrap of the primary measure (10,000 resamples of the 12 test pages) gives **0.13–0.92**: findings cluster on pages, and the Wilson and Newcombe intervals assume they do not.

### The judged criteria

| Criterion | Dev, default threshold | Dev, all findings | Test, default threshold | Test, all findings |
| --- | --- | --- | --- | --- |
| 1.1.1 Non-text Content | 2 / 2 / 1: **0.50** (0.15–0.85) | 2 / 2 / 1: **0.50** (0.15–0.85) | 2 / 3 / 0: **0.40** (0.12–0.77) | 2 / 3 / 0: **0.40** (0.12–0.77) |
| 1.3.5 Identify Input Purpose | 2 / 0 / 0: **1.00** (0.34–1.00) | 2 / 0 / 0: **1.00** (0.34–1.00) | 3 / 0 / 0: **1.00** (0.44–1.00) | 3 / 0 / 0: **1.00** (0.44–1.00) |
| 2.4.2 Page Titled | – | 0 / 2 / 0: **0.00** (0.00–0.66) | – | – |
| 2.4.4 Link Purpose (In Context) | 0 / 52 / 1: **0.00** (0.00–0.07) | 0 / 52 / 1: **0.00** (0.00–0.07) | 9 / 0 / 0: **1.00** (0.70–1.00) | 9 / 0 / 0: **1.00** (0.70–1.00) |
| 3.1.1 Language of Page | 1 / 0 / 0: **1.00** (0.21–1.00) | 1 / 0 / 0: **1.00** (0.21–1.00) | – | – |
| 3.1.2 Language of Parts | 8 / 0 / 0: **1.00** (0.68–1.00) | 8 / 0 / 0: **1.00** (0.68–1.00) | 0 / 8 / 0: **0.00** (0.00–0.32) | 0 / 8 / 0: **0.00** (0.00–0.32) |
| 3.3.2 Labels or Instructions | – | – | 0 / 1 / 0: **0.00** (0.00–0.79) | 0 / 1 / 0: **0.00** (0.00–0.79) |
| **All** | 13 / 54 / 2: **0.19** (0.12–0.30) | 13 / 56 / 2: **0.19** (0.11–0.30) | 14 / 12 / 0: **0.54** (0.35–0.71) | 14 / 12 / 0: **0.54** (0.35–0.71) |

Both halves together: 0.29 at the default threshold (27 of 93, 0.21–0.39) and 0.28 with all findings (27 of 95, 0.20–0.38). By criterion over both halves: 1.1.1 4 / 5 / 1 (0.44, 0.19–0.73), 1.3.5 5 / 0 / 0, 2.4.4 9 / 52 / 1 (0.15, 0.08–0.26), 3.1.2 8 / 8 / 0 (0.50). 2.4.6 had no finding: all 32 of its fails are suggestions.

- **Each half's number is a page or two.** Dev: 50 of the 67 decided findings are 2.4.4 on toolstation.com, all false; the other 17 are 13 true. Test: 8 true 2.4.4 findings on tst.jus.br and 8 false 3.1.2 findings on museudoamanha.org.br are 16 of 26.
- **1.3.5 is right again**, 5 of 5: contact and newsletter fields with no `autocomplete`.
- **1.1.1 is down to 10 findings** on 24 pages (65 in the third study), right about half the time.
- **2.4.4 is either all right or all wrong on a page**: 0 of 52 on dev (50 on one page, 2 on another), 9 of 9 on test.

**Sensitivity (pre-registered).** Without the page with the most default-threshold findings, dev is 13 of 17 (0.76, 0.53–0.90; without toolstation.com, 50 findings) and test 6 of 18 (0.33, 0.16–0.56; without tst.jus.br, 8). Counting every uncertain finding as a true positive, the default threshold reads 0.22 on dev and 0.54 on test; as a false positive, 0.19 and 0.54.

### Against the second and third studies

Same rubric and two-judge method, same model; different pages and code.

| Run | Dev, default threshold | Dev, all findings | Test, default threshold | Test, all findings |
| --- | --- | --- | --- | --- |
| Second study (`ebd4d07`) | 18 / 25 / 4: 0.42 (0.28–0.57) | 20 / 56 / 6: 0.26 (0.18–0.37) | 9 / 17 / 0: 0.35 (0.19–0.54) | 11 / 68 / 9: 0.14 (0.08–0.23) |
| Second study after the 2.4.4/2.4.6 change (`4fd54fc`) | 20 / 21 / 4: 0.49 (0.34–0.64) | 21 / 23 / 4: 0.48 (0.34–0.62) | 12 / 20 / 0: 0.38 (0.23–0.55) | 14 / 23 / 1: 0.38 (0.24–0.54) |
| Third study (`d23cfb5`) | 16 / 21 / 1: 0.43 (0.29–0.59) | 16 / 22 / 1: 0.42 (0.28–0.58) | 24 / 75 / 4: 0.24 (0.17–0.34) | 24 / 75 / 5: 0.24 (0.17–0.34) |
| **This study (`6e0947a`)** | 13 / 54 / 2: **0.19** (0.12–0.30) | 13 / 56 / 2: **0.19** (0.11–0.30) | 14 / 12 / 0: **0.54** (0.35–0.71) | 14 / 12 / 0: **0.54** (0.35–0.71) |

By criterion at the default threshold, the second study after its change, the third study, then this study:

| Criterion | Dev, second after | Dev, third | Dev, now | Test, second after | Test, third | Test, now |
| --- | --- | --- | --- | --- | --- | --- |
| 1.1.1 | 7 / 19 / 4: 0.27 | 7 / 20 / 0: 0.26 | 2 / 2 / 1: **0.50** | 8 / 12 / 0: 0.40 | 18 / 18 / 2: 0.50 | 2 / 3 / 0: **0.40** |
| 1.3.5 | 10 / 0 / 0: 1.00 | 7 / 0 / 0: 1.00 | 2 / 0 / 0: **1.00** | 1 / 0 / 0: 1.00 | 1 / 0 / 0: 1.00 | 3 / 0 / 0: **1.00** |
| 2.4.4 | 2 / 0 / 0: 1.00 | 2 / 1 / 1: 0.67 | 0 / 52 / 1: **0.00** | 3 / 4 / 0: 0.43 | 5 / 54 / 2: 0.09 | 9 / 0 / 0: **1.00** |
| 2.4.6 | – | – | – | 0 / 4 / 0: 0.00 | 0 / 2 / 0: 0.00 | – |
| 3.1.1 | – | – | 1 / 0 / 0: **1.00** | – | – | – |
| 3.1.2 | 1 / 0 / 0: 1.00 | – | 8 / 0 / 0: **1.00** | – | – | 0 / 8 / 0: **0.00** |
| 3.3.2 | 0 / 2 / 0: 0.00 | – | – | – | 0 / 1 / 0: 0.00 | 0 / 1 / 0: **0.00** |

### The split, and the two pages of 50 (exploratory)

Not pre-registered; computed after the numbers were known (`scripts/exploratory.py`, `data/exploratory.json`). The frozen code had seen neither half of this study, so the dev half is as much a held-out measure as the test half; the split only decides which half may be read. Each study holds one page on which 50 2.4.4 findings, every candidate the cap judged, were all false: www.ufpe.br on the third study's test half, www.toolstation.com on this study's dev half.

| Set | This study | Third study | Difference (Newcombe) | Difference (page bootstrap) |
| --- | --- | --- | --- | --- |
| Test half (the primary) | 14 of 26: **0.54** (0.35–0.71) | 24 of 99: 0.24 (0.17–0.34) | +0.30 (+0.09 to +0.48) | −0.31 to +0.74 |
| Dev half | 13 of 67: **0.19** (0.12–0.30) | 16 of 37: 0.43 (0.29–0.59) | −0.24 (−0.41 to −0.06) | −0.54 to +0.51 |
| Both halves | 27 of 93: **0.29** (0.21–0.39) | 40 of 136: 0.29 (0.22–0.38) | −0.00 (−0.12 to +0.12) | −0.40 to +0.57 |
| Both halves, without each study's page of 50 | 27 of 43: **0.63** (0.48–0.76) | 40 of 86: 0.47 (0.36–0.57) | +0.16 (−0.02 to +0.33) | −0.21 to +0.47 |

The page bootstrap resamples each study's pages with replacement, 10,000 times. Read together: the pre-registered test-half comparison went up, the dev-half one went down by the same rule, the pooled one did not move, and at the level of pages none of the four differences is distinguishable from zero. With the two pages of 50 set aside, the point estimate rises from 0.47 to 0.63, below the 0.84 the changes reached in-sample.

### The second pass

The ablation's findings are the main run's plus the claims the second pass denied (the cache made every other answer the same, with 0 offline misses).

| Split | Second pass on (main), default | Off (`--no-confirm`), default | Removed by the pass | 1.1.1, on | 1.1.1, off |
| --- | --- | --- | --- | --- | --- |
| dev | 13 / 54 / 2: **0.19** (0.12–0.30) | 13 / 58 / 2: 0.18 (0.11–0.29) | 0 / 4 / 0 | 2 / 2 / 1: **0.50** (0.15–0.85) | 2 / 6 / 1: 0.25 (0.07–0.59) |
| test | 14 / 12 / 0: **0.54** (0.35–0.71) | 15 / 20 / 1: 0.43 (0.28–0.59) | 1 / 8 / 1 | 2 / 3 / 0: **0.40** (0.12–0.77) | 3 / 11 / 1: 0.21 (0.08–0.48) |
| both | 27 / 66 / 2: **0.29** (0.21–0.39) | 28 / 78 / 3: 0.26 (0.19–0.35) | 1 / 12 / 1 | 4 / 5 / 1: **0.44** (0.19–0.73) | 5 / 17 / 2: 0.23 (0.10–0.43) |

With all findings counted the numbers are the same but for dev's two 2.4.2 findings below the threshold (0.19 on, 0.18 off).

**Shares** (pre-registered secondary 4). The pass ran on 22 claims, the 1.1.1 reading claims: on dev it confirmed 4 and denied 4, on test it confirmed 4 and denied 10; it could ask every claim (none not asked). The confirmed claims were 2 / 2 on dev and 1 / 3 on test; the denied ones 0 / 4 / 0 and 1 / 8 / 1. So, over both halves, **the reading claims were 4 true, 17 false and 1 uncertain, and the pass kept 3 of the 4 true ones and 5 of the 17 false ones**; the in-sample notes had it keep 34 of 40 and 12 of 61. The two 1.1.1 findings the pass does not ask about, claims a pattern decides, were 1 true and 1 uncertain, so the two halves' 1.1.1 findings are 4 / 5 / 1.

**The 0.99 cut** (secondary 6). Leaving out the 1.1.1 findings whose lowest confirming probability is under 0.99 would remove two dev findings, both false (0.987 each), and none on test: dev 13 / 52 / 2 (0.20), test unchanged, both 27 / 64 / 2 (0.30). Every confirmed test finding had a lowest probability above 0.999.

### Suggestions

A fail the checked facts do not support, a claim moved to review (2.4.6, 3.3.2 on a collapsed or search field, a 2.4.4 address in a sentence), a claim the second pass denied, and a judgment on a page read without its stylesheets are suggestions: listed for review, not findings.

| Split | 2.4.4 | 2.4.6 | 1.1.1 | 3.3.2 | All | Third study |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| dev | 11 | 11 | 4 | 0 | 26 | 65 |
| test | 26 | 21 | 11 | 2 | 60 | 46 |

The 1.1.1 suggestions are the 14 claims the second pass denied and the one the unstyled guard moved. **The labelled sample** (secondary 7), drawn from the 72 that are not the second pass's:

| Split | Drawn (pool) | TP / FP / uncertain | Share of true failures | True failures in the pool |
| --- | --- | --- | --- | --- |
| dev | 19 (22) | 0 / 19 / 0 | **0.00** (0.00–0.17) | 0 (0 to 3.7) |
| test | 20 (50) | 1 / 18 / 1 | **0.05** (0.01–0.25) | 2.6 (0.4 to 12.3) |
| both | 39 (72) | 1 / 37 / 1 | **0.03** (0.01–0.14) | 1.9 (0.4 to 9.7) |

By criterion over both halves: 2.4.6 0 / 20 / 0, 2.4.4 0 / 16 / 1, 3.3.2 0 / 1 / 0, and 1.1.1 1 / 0 / 0, the claim the unstyled guard moved on thejournal.ie. The claims moved to review are wrong almost every time: keeping them out of the findings cost about two true failures in 72, most likely none outside the guard's misfire.

### Experimental rules and judgments

All report below the default threshold.

| Check | Dev | Test | Both | Third study, both |
| --- | --- | --- | --- | --- |
| `rampa/pixel-contrast` (1.4.3) | – | 5 / 0 / 0: **1.00** (0.57–1.00) | 5 / 0 / 0: **1.00** (0.57–1.00) | 21 / 13 / 0: 0.62 |
| `rampa/placeholder-contrast` (1.4.3) | 1 / 1 / 0: **0.50** (0.10–0.91) | 2 / 0 / 0: **1.00** (0.34–1.00) | 3 / 1 / 0: **0.75** (0.30–0.95) | 5 / 2 / 0: 0.71 |
| `rampa/icon-contrast` (1.4.11) | 1 / 0 / 0: **1.00** (0.21–1.00) | 1 / 0 / 0: **1.00** (0.21–1.00) | 2 / 0 / 0: **1.00** (0.34–1.00) | 13 / 4 / 1: 0.77 |
| `rampa/language-switcher-lang` (3.1.2) | 2 / 0 / 0: **1.00** (0.34–1.00) | 1 / 0 / 4: **1.00** (0.21–1.00) | 3 / 0 / 4: **1.00** (0.44–1.00) | – |
| `rampa/custom-control` (4.1.2) | 1 / 0 / 0: **1.00** (0.21–1.00) | – | 1 / 0 / 0: **1.00** (0.21–1.00) | – |
| `rampa/widget-name` (4.1.2) | – | 0 / 2 / 0: **0.00** (0.00–0.66) | 0 / 2 / 0: **0.00** (0.00–0.66) | 3 / 0 / 2: 1.00 |
| `rampa/no-visible-label` (3.3.2) | – | 0 / 1 / 0: **0.00** (0.00–0.79) | 0 / 1 / 0: **0.00** (0.00–0.79) | – |
| `rampa/placeholder-alt` (1.1.1) | 0 / 0 / 1: **–** | – | 0 / 0 / 1: **–** | 11 / 1 / 0: 0.92 |
| Hidden images, judgment (1.1.1, ACT e88epe) | 1 / 0 / 0: **1.00** (0.21–1.00) | 0 / 1 / 0: **0.00** (0.00–0.79) | 1 / 1 / 0: **0.50** (0.10–0.91) | 0 / 6 / 0: 0.00 |
| **All** | 6 / 1 / 1: **0.86** (0.49–0.97) | 9 / 4 / 4: **0.69** (0.42–0.87) | 15 / 5 / 5: **0.75** (0.53–0.89) | 53 / 26 / 3: 0.67 |

Too few findings to compare check by check (25, against 82). `rampa/pixel-contrast` had no false positive, where the third study's 13 sat on one page under a consent backdrop, the case the layer guard was built for; that is consistent with the guard, not evidence for it.

### Findings and time per page

| Split | Page | Collect s | Judge s | Model calls | Judged, default | Judged, all | Experimental | Engine (axe) |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| dev | osesp.art.br (contact) | 15 | 56 | 40 | 5 | 6 | 3 | 4 |
| dev | www.cobasi.com.br (listing) | 79 | 194 | 127 | 1 | 1 | 1 | 140 |
| dev | www.mackenzie.br (admissions) | 8 | 2 | 2 | 0 | 0 | 0 | 85 |
| dev | www.es.gov.br | 6 | 35 | 19 | 1 | 1 | 0 | 2 |
| dev | www.hospitalmoinhos.org.br | 13 | 2 | 2 | 0 | 0 | 0 | 1 |
| dev | www.infomoney.com.br (article) | 19 | 107 | 70 | 3 | 3 | 2 | 6 |
| dev | www.nls.uk (contact) | 6 | 3 | 2 | 0 | 1 | 0 | 0 |
| dev | www.toolstation.com (listing) | 36 | 136 | 90 | 50 | 50 | 2 | 9 |
| dev | www.leeds.ac.uk (undergraduate) | 29 | 139 | 97 | 0 | 0 | 0 | 0 |
| dev | www.gov.scot | 14 | 154 | 108 | 0 | 0 | 0 | 0 |
| dev | www.bhf.org.uk (article) | 22 | 125 | 87 | 0 | 0 | 0 | 0 |
| dev | theconversation.com (article) | 14 | 122 | 82 | 9 | 9 | 0 | 2 |
| test | museudoamanha.org.br | 20 | 61 | 43 | 8 | 8 | 0 | 42 |
| test | www.tramontina.com.br | 14 | 30 | 18 | 0 | 0 | 1 | 19 |
| test | ufpr.br | 24 | 135 | 81 | 2 | 2 | 0 | 40 |
| test | www.tst.jus.br (ouvidoria) | 20 | 138 | 93 | 8 | 8 | 2 | 59 |
| test | dasa.com.br (article) | 13 | 96 | 58 | 0 | 0 | 0 | 9 |
| test | www.r7.com | 24 | 163 | 84 | 1 | 1 | 1 | 98 |
| test | www.nhm.ac.uk | 39 | 129 | 90 | 3 | 3 | 1 | 0 |
| test | thepihut.com | 25 | 138 | 86 | 0 | 0 | 4 | 81 |
| test | www.gla.ac.uk | 21 | 159 | 117 | 1 | 1 | 1 | 0 |
| test | www.fueleconomy.gov (car finder) | 16 | 137 | 107 | 1 | 1 | 3 | 3 |
| test | www.mdanderson.org | 30 | 141 | 98 | 2 | 2 | 2 | 13 |
| test | www.thejournal.ie | 22 | 73 | 48 | 0 | 0 | 2 | 124 |

- **Findings per page.** At the default threshold, 5.8 judged findings a page on dev (69 on 12; 1.7 without toolstation.com) and 2.2 on test (26 on 12). Six dev pages and four test pages had none.
- **Time.** Collection took 6 to 79 s a page (median 20 s); judging the saved snapshot, 2 to 194 s (median 127 s), with 2 to 127 model calls; the two together 9 to 273 s (median 150 s), at `--concurrency 2`. The third study's median was 242 s.

### How often the model flags

| Split | Criterion | Candidates | Judged | Reported failing | Share | Third study |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| dev | 1.1.1 | 88 | 88 | 6 | 6.8% | 21.1% |
| dev | 2.4.4 | 1,034 | 381 | 53 | 13.9% | 0.7% |
| dev | 2.4.6 | 211 | 201 | 0 | 0.0% | 0.0% |
| dev | 3.1.2 | 11 | 11 | 8 | 72.7% | 0.0% |
| test | 1.1.1 | 130 | 130 | 6 | 4.6% | 36.8% |
| test | 2.4.4 | 1,140 | 519 | 9 | 1.7% | 11.7% |
| test | 2.4.6 | 186 | 186 | 0 | 0.0% | 0.8% |
| test | 3.1.2 | 13 | 13 | 8 | 61.5% | 12.5% |

"Reported failing" counts findings after verification and the second pass; the 1.1.1 rows include the experimental hidden-image findings (1 on each half). On toolstation.com the cap judged 50 of 477 link candidates and all 50 failed.

### Agreement between the judges

| Set | Findings | Observed agreement | Cohen's kappa | Third study's kappa |
| --- | ---: | ---: | ---: | ---: |
| All | 175 | 0.95 | 0.88 | 0.84 |
| Dev | 102 | 0.97 | 0.91 | 0.69 |
| Test | 73 | 0.92 | 0.84 | 0.90 |
| Judged criteria (with the ablation's findings and the suggestions) | 150 | 0.97 | 0.92 | 0.91 |
| Experimental rules | 25 | 0.80 | 0.56 | 0.92 |

The judges disagreed on 9 items, which became `uncertain`: 5 where one said true and the other uncertain, 3 true against false, 1 uncertain against false. On why a finding is wrong, over the 122 both called false positives, the cause kappa was 0.85. The experimental kappa is low on few items: 4 of its 5 disagreements are `rampa/language-switcher-lang` findings on two test pages. High agreement between two agents of one model family measures consistency, not accuracy.

## What moved compared with the third study

- **The second pass** is the one change this study measures apart from the pages, since the ablation replays the same answers. It removed 12 false and 1 true 1.1.1 findings (and 1 uncertain), and raised 1.1.1 from 0.23 to 0.44 and all judged findings from 0.26 to 0.29 over both halves (0.43 to 0.54 on test). The share it removes held out (12 of 17 false, 1 of 4 true) is close to the in-sample share (49 of 61, 6 of 40). It cannot touch a claim the three framings all accept: the two 1.1.1 false positives left on dev passed all three, at 0.987.
- **1.1.1 overall** (version 5, three facts, the pass): 10 findings on 24 pages against 65, with precision 0.44 against 0.40. Fewer claims, about as often right; whether real failures went missing is not measured, beyond the one the pass denied and the one the guard moved.
- **Claims moved to suggestions.** 2.4.6 reported no finding, 3.3.2 one (false), 2.4.2 two below the threshold (false). The sample says the moved claims are almost all wrong (1 of 39 true), so moving them cost little.
- **2.4.4.** The narrower facts did not stop the shared-text fact from grounding 50 false findings on one page (below); elsewhere 2.4.4 was 9 of 9 on test, and 0 of 2 with 1 uncertain on two other dev pages.
- **The capture guards.** The unstyled guard fired once, wrongly; no unstyled capture happened, so its purpose is not measured. The layer guard fired on three consent layers, and `rampa/pixel-contrast` had no false positive.
- **Destination reads and robustness.** Every page was collected on its first attempt, with no crash, rate limit or refusal; the third study lost a probe page to a rate limit and a crash.

## False positives, dev split only

Every pattern below comes from dev pages, from the two judges' rationales, checked against the packets. They are candidates for future fixes, chosen on this dev half only; whatever is changed from them must be measured on pages that neither half of this study holds.

### The judged criteria (56 false positives, 52 of them 2.4.4)

1. **2.4.4, "shared by N links that lead to different places", in a menu whose nested lists tell them apart, 50 findings** (toolstation.com). The page's "Site Navigation" (`h2` "All Departments", visually hidden, exposed to screen readers) lists every department, and under the list items "Deals" and "Sale & Clearance" nests the same department names again: "Adhesives & Sealants" leads to `/adhesives-sealants/c13`, `/deals/adhesives-sealants/c1517` and `/sale-clearance/adhesives-sealants/c173`. Each link's parent list item names what sets it apart, which is programmatically determined context (H81), and the top-level department links say where they go by their text alone. The shared-text fact grounded all 50 links the cap let through (of 477 candidates), at the model's "high": 21 distinct texts, each shared by 2 to 4 links. Causes: model error 30, criterion misapplied 20. **Fix:** before grounding a shared-text claim, compare the links' nearest enclosing list items' own link texts (and headings), and drop the claim when they differ; count a link whose text names its destination section as passing however many nested copies there are.
2. **2.4.4, two addresses for one place, 2 findings** (osesp.art.br). Two "Ouvidoria" links lead to `fala.sp.gov.br` and to `ouvidoria.sp.gov.br/Portal/Default.aspx`, and the second sends the browser to the first by script (`window.location`). **Fix:** follow a script or `meta` redirect when reading a destination, or compare destination titles before saying two links lead to different places.
3. **1.1.1, "describes something the image does not show", on an alternative that is right, 2 findings left after the pass.** infomoney.com.br's author photo "Autor avatar" (generic, but it is the author's avatar), and theconversation.com's Creative Commons wordmark "CC BY ND" (it names the licence, not only what is drawn). All three framings confirmed both, at 0.987. The pass denied four more of this kind (a dog illustration, a news photo described exactly, a logo "BHF logo", a 52-pixel curry thumbnail described exactly), and they are not findings. **Fix:** the 0.99 cut would drop the two; a generic alternative ("avatar", a licence name) is a 1.1.1 quality issue, not a wrong description, and could be its own milder claim.
4. **2.4.2, below the threshold, 2 findings**: "Fale conosco" and "Contact us | National Library of Scotland" on contact pages, both describing the page.

### Suggestions (19 drawn, all false)

- **2.4.6 headings that name a site or an organisation** (5): "Governo ES" as the header and footer site title, "The Scottish Government" as gov.scot's `h1`, footer column headings "Sobre nós" and "Mundo Cobasi" over the links they group.
- **2.4.6 labels that do say what to enter** (4): "Search" and "Search leeds.ac.uk" on search fields (the second a real `label`), the placeholder "ex.: nome@email.com" read as the label of a field labelled "E-mail", and "Abrir/Fechar" on a 0×0 menu checkbox nobody sees.
- **2.4.4 links whose sentence says where they go** (6, theconversation.com and bhf.org.uk): "within three months", "the approval shows", "at the time", "stroke", "sugar", "salt".
- **2.4.4 links named by context or by their destination's own name** (4): a breadcrumb's "Study", a menu category "Aprenda" that opens its submenu, the government service "SIC", and "A=" with a `title` that says it resets the text size (H33).

These were already suggestions, and the sample confirms that they belong there.

### Experimental rules (1 false positive, 1 uncertain)

- **`rampa/placeholder-contrast` on a placeholder the site does not color** (cobasi.com.br): no stylesheet sets `::placeholder` for the search field, so the browser default applies (`rgb(117, 117, 117)`), but the rule measured `#e9b687` on white (3.96:1). **Fix:** read the placeholder's color from `getComputedStyle(input, '::placeholder')` when the page's rules do not target that field.
- *Uncertain:* `rampa/placeholder-alt` on infomoney.com.br's "Logo_Infomoney_Branco_transparente".

### What the true positives look like on dev

- **3.1.2**, 8: theconversation.com serves its English article with `lang="pt-BR"`, and each of the 8 paragraphs judged was reported as English text read as Portuguese. Its 3.1.1 claim was dropped by the language identifier, which read the page's text as Portuguese. The judges called the 8 real failures; a person might count them as one.
- **3.1.1**, 1: es.gov.br, marked `lang="en"`, in Portuguese, decided by the language identifier with no model call.
- **1.3.5**, 2: osesp.art.br's contact form, "Nome" and "E-mail" without `autocomplete`.
- **1.1.1**, 2: "Ilustração SVG demonstrativa cachorro" (a dog illustration) copied onto a cobasi.com.br illustration of trees and leaves with no dog, and "Patrocinador" (sponsor) on a sponsor's logo, which gives the role the heading above it already states and not the sponsor's name.
- **Experimental**, 6: language links "English" and "Español" without `lang`, a pale placeholder (3.66:1), a gray icon at 2.52:1, a list item ("Shop All") that takes focus and handles clicks but is exposed as a list item, and an image hidden with `alt=""` that holds the words of a spreadsheet offer the text around it does not say.

## The test split: counts only

The test half's false positives and uncertain items, by origin, check, threshold and the judges' cause. They were not read for patterns.

| Origin | Check | Threshold | Cause | False positives |
| --- | --- | --- | --- | ---: |
| main | judgment 3.1.2 | default | collector error | 8 |
| main | judgment 1.1.1 | default | model error, criterion misapplied, disputed | 1, 1, 1 |
| main | judgment 3.3.2 | default | disputed | 1 |
| main | judgment 1.1.1, hidden image (experimental) | below | model error | 1 |
| main | `rampa/widget-name` | below | criterion misapplied | 2 |
| main | `rampa/no-visible-label` | below | model error | 1 |
| ablation only | judgment 1.1.1 | default | model error, criterion misapplied | 5, 3 |
| suggestion sample | judgment 2.4.6 | suggestion | model error, disputed, criterion misapplied, context missing, collector error | 4, 3, 2, 1, 1 |
| suggestion sample | judgment 2.4.4 | suggestion | model error, disputed | 4, 2 |
| suggestion sample | judgment 3.3.2 | suggestion | model error | 1 |

By page, the main run's 12 default-threshold false positives: 8 on museudoamanha.org.br (all 3.1.2), 1 each on fueleconomy.gov, gla.ac.uk, mdanderson.org and ufpr.br. The ablation's 8: 5 on fueleconomy.gov and 3 on tst.jus.br. Uncertain: 4 `rampa/language-switcher-lang` on two pages, 1 ablation 1.1.1, 1 suggested 2.4.4.

## Caveats

- **Labels by Claude agents, pending human review.** Every label comes from two Claude agents of one model family; they are a pre-annotation, not ground truth, and their mistakes are likely correlated. The labels can be reviewed in Rampa Lab's review mode (<https://rampalab.guilhermebs.com.br/>) with `data/findings.json` and `data/pages.json`.
- **Clustered findings.** One page holds 50 of dev's 67 decided findings, two pages 16 of test's 26. The Wilson and Newcombe intervals treat findings as independent; the page bootstrap, which does not, gives 0.13–0.92 for the primary measure. The pre-registered reading "went up" rests on intervals that are too narrow for data this clustered.
- **The primary measure depends on the split.** The same rule applied to the dev half reads "went down", and pooled it reads no change. The pre-registered measure is reported as it came out; it should not be read alone.
- **Small numbers.** 26 test findings; 22 reading claims for the second pass; 39 suggestions.
- **Different pages, not a replay.** The comparison with the second and third studies is between sets of pages and versions of the code; the changes' effect is mixed with how hard each set of pages is. The ablation is a replay, and it isolates the second pass only.
- **Dropped claims are not labelled.** Verification, the facts and the second pass decide what becomes a finding; this study labels what the second pass denied and a sample of suggestions, not the claims verification dropped, and it does not audit the pages for failures Rampa missed.
- **Judges kept apart by instruction only.** The two judges of a packet worked on one machine and filesystem.
- **One run, a nondeterministic model.**
- **The test half is spent.** Its numbers are known, and its pages may not be used to choose a change. The next held-out measurement needs fresh pages again.

## Data and reproduction

All paths are under `study/round-4-2026-10-24/`. Run from the repository root after `pnpm install --frozen-lockfile` and `pnpm build`.

- **Pre-registration.** `preregistration.md`, committed in `e4825c4` with the pages, the split and the collection and judging scripts.
- **Selection.** `scripts/exclusions.py <public_suffix_list.dat> build|check` and `data/excluded-domains.json`; `scripts/candidates*.tsv`, `scripts/screen.mjs` and `data/screen-*.json`; `scripts/links.mjs`; `scripts/pages.tsv`; `scripts/split.py` and `data/pages-input.json`.
- **Collection.** `bash scripts/collect.sh main [slug ...]`, `collect-log.txt`, `pages/<slug>/run-main-collect-*.json` and `main-collect-console.txt`.
- **Judgment.** `bash scripts/run-judged.sh default [slug ...]` and `bash scripts/run-noconfirm.sh [slug ...]`, `run-log.txt`, `pages/<slug>/report.json` and `noconfirm-report.json`, with their consoles and `run-*-judged.json`.
- **Labels.** `python -I scripts/sample_suggestions.py` writes `data/suggestion-sample.json`; `python -I scripts/packets.py` writes `packets/<slug>.json` and `data/findings-raw.json`; `NODE=<node.exe> python -I scripts/judge_prompt.py <slug> auditor|skeptic` prints each judge's exact prompt; `labels/<slug>.<role>.json`; `python -I scripts/check_labels.py`; `run-log-notes.txt`.
- **Numbers.** `python -I scripts/analyze.py` writes `data/findings.json`, `data/pages.json` and `data/summary.json`; `python -I scripts/tables.py` and `python -I scripts/extras.py` (`data/extras.json`) print the pre-registered tables; `python -I scripts/exploratory.py` (`data/exploratory.json`) the exploratory ones; `python -I scripts/dump_fp.py dev [check]` lists the dev false positives with both rationales (`test` prints counts only).
- **Kept out of git.** The recordings, screenshots, judgment caches and crops: 141.7 MB for the 72 files hashed in `data/recordings.json`. A full copy of the study folder is kept outside the repository, and its files matched their SHA-256 when copied. With a copy of `pages/<slug>/recording/` and `pages/<slug>/cache/`, a page's judgments can be read back offline: `rampa check pages/<slug>/recording/<name>.snapshot.json --model ollama:gemma4:12b --locale en --min-confidence low --offline --cache-dir pages/<slug>/cache`, and with `--no-confirm` and a copy of the cache, the ablation.

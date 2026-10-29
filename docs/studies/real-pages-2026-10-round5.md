# Held-out pages after the precision fixes: a fifth real-page study (October 2026)

The [fourth real-page study](real-pages-2026-10-round4.md) measured 0.54 on its test half, 0.19 on its dev half and 0.29 pooled, and almost all of its false positives, and the third study's, were bursts on a few pages. Four fixes were then written and their rules frozen ([precision-fixes notes](notes-precision-fixes.md)): the list items a link is nested in now count as its context for the 2.4.4 shared-text fact (H81), a page with no style at all and the browser's default body look is read as unstyled, the 1.1.1 second pass needs a probability of 0.99 instead of 0.9, and 2.4.2 and 3.3.2 fails with no checked fact behind them are suggestions; reports also group near-identical findings. Replayed on the 72 pages they were chosen from, they gave 0.86 per element, an in-sample number. This study runs that code, `main` at `b759128`, on 24 pages none of it has seen, with the fourth study's method, rubric and two-judge labels, and replays three ablations on the same snapshots and answers.

**In short.** With Gemma 4 12B, at the default threshold (what `rampa check` shows and fails on), **0.83 of the judged findings on the test pages were real failures (20 of 24 decided, 1 uncertain; Wilson 95% 0.64–0.93, page bootstrap 0.62–1.00), the pre-registered primary measure.** Against the fourth study's test half, 0.54 (14 of 26), the difference is +0.29: Newcombe's interval (+0.04 to +0.50) lies above 0, but the page bootstrap's (−0.14 to +0.75) does not, so **by the reading fixed in advance, which needs both, there is no measurable change.** Against the fourth study's two halves pooled, 0.29 (27 of 93), it is +0.54 (Newcombe +0.33 to +0.67, page bootstrap −0.04 to +0.82): **no measurable change either**, by the same rule. The dev half, which the code had not seen either, came out at **0.80 (31 of 39, 0.65–0.89)** and both halves at **0.81 (51 of 63, 0.70–0.89; page bootstrap 0.62–0.97)**. **Of the in-sample 0.86, about 95% held on new pages** (0.83 on test, 0.80 on dev, 0.81 pooled); per group, the pooled precision is 0.86 (38 of 44 units), and 13 of the 18 pages with a decided finding had only true ones. No page held a burst of false positives like the fourth study's 50: the one false burst is 7 "Leia mais" news-card links on a dev page, and the largest group of findings, 14 shared-text "View More" links on another dev page, was true. The ablations, exact replays, say what each fix did here: **the second pass removed 13 false and 6 true 1.1.1 claims** (and 10 uncertain ones), raising 1.1.1 from 0.60 to 0.83 and all findings from 0.69 to 0.81; the 0.99 cut moved 3 claims, 1 true, 1 false, 1 uncertain; the H81 nesting told 6 links apart that the model did not claim, so it changed no finding; no page was read as unstyled, so the body-look guard was not exercised; and the 8 2.4.2 and 3.3.2 suggestions, all labelled, were all false. Of 40 sampled other suggestions, 3 were real failures (0.08). Every label comes from two Claude agents of one model family, a pre-annotation; the blind human sample the notes asked for before this round has not been done. The run is a single run.

**Future tuning may use the dev split only.** The test half's false positives were counted, not read, and are listed below by check and cause only.

## Question and pre-registration

When Rampa reports a failure on a page it has never seen, how often is the failure real, now that the fixes written after the fourth study are merged? Precision only, per criterion and per check; pages were not audited for what Rampa missed.

The pages, the seeded split, the frozen code and its thresholds, the method and the analysis plan were committed before Rampa ran on any of them: [`77173ed`](../../study/round-5-2026-10-28/preregistration.md), 2026-10-28 20:56:17 (UTC−3); the first collection started 11 seconds later. Only the pre-screen in headless Edge, the link listing used to pick inner pages and one look at three inner pages' text had loaded the pages before that. The pre-registration fixes:

- **the code**: `main` at `b759128`, frozen, with the rules and thresholds of section 2 of the [precision-fixes notes](notes-precision-fixes.md) (the H81 nesting context, the default body look and its family list, the 150-element floor, the self-link correction, the 0.99 cut on the second pass, the 2.4.2 and 3.3.2 grounding, the group of 6 or more);
- **the primary measure**: test-half precision per element at the default threshold over the judged criteria, with two co-primary 95% intervals, Wilson's and a page bootstrap (10,000 resamples of the 12 test pages, `random.Random(20261027)`);
- **the comparison** with the fourth study's test half (14 of 26) and its pooled halves (27 of 93), each by Newcombe's hybrid score interval (method 10) and a page-bootstrap interval of the difference, and its reading: **went up** only when both intervals lie above 0, **went down** only when both lie below, otherwise **no measurable change**;
- **secondary measures**: per group (6 or more findings of one claim on one page, one unit, labelled by the plurality of its labelled members), always next to per element; per page (the share of pages whose decided findings are all true, the mean page precision); the dev half, both halves and every finding counted; per criterion; three ablations by replay of the same snapshots and answers (the second pass off, the 1.1.1 cut at 0.9, the shared-text fact without the H81 nesting) and the capture log of every page; a labelled sample of what the rules move to review; every burst listed with its mechanism (read on dev only); sensitivity; the experimental rules and the judges' agreement;
- **the rules**: a network drop is retried, a refusal waits ten minutes and then goes to the slot's next backup, an unstyled capture is not a refusal, everything runs once, `src/` does not change, and the test half is counted, not read.

What changed after it is listed under "Differences" and "Deviations".

## Pages

**Exclusions.** No registrable domain (Public Suffix List) of any earlier study (the first, its re-measure, the second, third and fourth studies and the robustness study's 53 sites: 136 domains), and none that any file of the repository's 12 branches or any commit message names (2,283 domains, the benchmark's among them): `scripts/exclusions.py`, `data/excluded-domains.json`, built again on 2026-10-28 at `b759128`. Six of the first candidates were named by the repository and were replaced before the screen (cbsnews.com, waterstones.com, hopkinsmedicine.org, heart.org, britishmuseum.org and metmuseum.org).

**Design.** The fourth study's: twelve strata, Brazil or international, times government, education, news, e-commerce, health, and culture or public services; in each, a home page and an inner page from two different sites. Brazilian pages are in Portuguese, the others in English (United Kingdom, United States, Ireland).

**Selection.** A primary and three backups per slot were written down on 2026-10-27, before the screen (`scripts/candidates.tsv`), and each was loaded in headless Edge (`scripts/screen.mjs`, `data/screen-*.json`). Inner pages were picked from each site's navigation (`scripts/links.mjs`) by the slot's rule: the first article on a news or health home page, the first category of a store's menu, the undergraduate page, a contact page. Ten of the 24 slots went to a backup: for a bot challenge or a refusal (tjdft.jus.br 403 and mpsp.mp.br, hospitaloswaldocruz.org.br 403 and accamargo.org.br, london.gov.uk, nhtsa.gov, royalalberthall.com 403, breakingnews.ie, ao.com, stroke.org.uk 403, mind.org.uk, wickes.co.uk's geographic block, ba.gov.br's security block page, and the first article of alzheimers.org.uk), for a load that failed three times (bienal.org.br, dunelm.com, macmillan.org.uk), for a subscription wall (the first article of newstatesman.com, "Exclusive Subscriber Only Content" after two paragraphs), and for two Brazilian sites that served headless Edge their English site (pequenoprincipe.org.br, theatromunicipal.org.br), as ufrj.br did in the fourth study. One slot, the international health article, ran out of its four candidates, and three more backups were written down before they were loaded (`scripts/candidates-extra.tsv`); the first, patient.info, passed. `scripts/pages.tsv` says why each page was chosen.

**Split.** In each stratum a seeded coin (Python `random.Random(20261027)`) sends the home or the inner page to dev and the other to test (`scripts/split.py`, `data/pages-input.json`). No probe subset was drawn.

| Split | Page | Category | Country | Language | Type |
| --- | --- | --- | --- | --- | --- |
| dev | https://www.museudalinguaportuguesa.org.br/ | culture | BR | pt-BR | home |
| dev | https://www.hering.com.br/ | e-commerce | BR | pt-BR | home |
| dev | https://portal.pucrs.br/ensino/graduacao/ | education | BR | pt-BR | info |
| dev | https://www.ms.gov.br/ | government | BR | pt-BR | home |
| dev | https://santacasasp.org.br/ | health | BR | pt-BR | home |
| dev | https://www.correio24horas.com.br/ | news | BR | pt-BR | home |
| dev | https://www.horniman.ac.uk/ | culture | UK | en | home |
| dev | https://www.lakeland.co.uk/ | e-commerce | UK | en | home |
| dev | https://www.ncl.ac.uk/ | education | UK | en | home |
| dev | https://ratings.food.gov.uk/ | government | UK | en | form |
| dev | https://patient.info/features/eye-health/halloween-and-bonfire-night-how-to-protect-your-eyes-this-spooky-season | health | UK | en | article |
| dev | https://www.irishcentral.com/news/colleague-saved-life-stroke | news | US | en | article |
| test | https://cinemateca.org.br/fale-conosco/ | culture | BR | pt-BR | contact |
| test | https://www.madeiramadeira.com.br/moveis | e-commerce | BR | pt-BR | listing |
| test | https://ufg.br/ | education | BR | pt-BR | home |
| test | https://www.trf4.jus.br/trf4/controlador.php?acao=pagina_menu_listar&id_pai=253 | government | BR | pt-BR | contact |
| test | https://www.oncoguia.org.br/conteudo/cancer-e-fertilidade-em-uma-conversa-sobre-escolhas-e-possibilidades/18273/1414/ | health | BR | pt-BR | article |
| test | https://www.agazeta.com.br/colunas/abdo-filho/as-maiores-empresas-do-espirito-santo-veja-a-lista--1026 | news | BR | pt-BR | article |
| test | https://www.abbeytheatre.ie/contact/get-in-touch/ | culture | IE | en | contact |
| test | https://www.cotswoldoutdoor.com/c/mens.html | e-commerce | UK | en | listing |
| test | https://www.nottingham.ac.uk/studywithus/ugstudy/find-uon.html | education | UK | en | info |
| test | https://www.oregon.gov/Pages/index.aspx | government | US | en | home |
| test | https://www.cedars-sinai.org/home.html | health | US | en | home |
| test | https://www.irishexaminer.com/ | news | IE | en | home |

## Method

### The same as the fourth study

- **Collection, no model call.** `rampa check <url> --model ollama:gemma4:12b --offline --locale en --min-confidence low --save <dir> --screenshots`, with Edge through playwright-core (`scripts/collect.sh main`), one page at a time, on 2026-10-28 from 20:56 to 21:07. Every page was collected on its first attempt, with no network error in any log and no bot check or refusal page.
- **Judgment on the saved snapshot.** `rampa check <snapshot> --model ollama:gemma4:12b --locale en --min-confidence low --time-limit 900 --concurrency 2` (`scripts/run-judged.sh default`), the second pass on, as it is by default, one page at a time, 21:08 to 22:10. No page reached the time limit and no report lists an error.
- **Model.** Gemma 4 12B (`gemma4:12b`, digest `6114515d63c1`), on Ollama 0.40.3, on a local GPU. No other model or provider was used.
- **The `--no-confirm` ablation.** Each snapshot judged again with the same flags plus `--offline --no-confirm`, from a fresh copy of the page's cache (`scripts/run-noconfirm.sh`, 22:10): every first-pass answer is read back (0 offline misses), so the two runs differ only by the second pass.
- **Labels.** One packet per page (`scripts/packets.py`) with, in a seeded shuffled order and in one form, every judgment and rule finding of the main run at any confidence, every finding of the ablation the main run does not have, and the page's chosen suggestions; no `confidence` or `patch`, no quote for a suggestion. Two Claude agents per packet (Claude Opus 5.5), an auditor and a skeptic, each told not to read the other's work, with the fourth study's rubric and prompt (including its one-line reply). Final label: the label both gave, else `uncertain`; a false positive's cause is the one both named, else `disputed`. Precision is TP / (TP + FP) with uncertain findings left out; Cohen's kappa over the three labels. Engine (axe-core) findings, 599 of them, were not labelled.

### Differences from the fourth study

1. **Code.** `main` at `b759128` against `6e0947a`: the four fixes of the [precision-fixes notes](notes-precision-fixes.md) (the H81 nesting context of the 2.4.4 shared-text fact; a page with no style at all and the browser's default body look read as unstyled, and the self-link correction; the 1.1.1 second pass's cut at 0.99; 2.4.2 and 3.3.2 fails with no checked fact behind them moved to suggestions) and the groups of near-identical findings in reports (`src/core/groups.ts`), which change what a person reads, not what is found or counted.
2. **Two co-primary intervals and a stricter reading.** The page bootstrap, a sensitivity analysis in the fourth study, is co-primary here, and "went up" needs both it and Newcombe's interval above 0.
3. **Two more ablations, both exact replays.** The 1.1.1 cut at 0.9 (`scripts/run-cut090.sh`: a copy of the build with that one constant changed, checked to differ from `dist/` in that one line, `--offline` on a copy of the main cache, 22:10–22:11, 0 offline misses) and the shared-text fact without the nesting (`scripts/shared-text.sh`, no model, on the copy of `link-purpose.ts` at `6a8de75`, whose only difference from `b759128`'s is the nesting). The capture guard's trigger and the body-look signal are logged for every page (`scripts/capture.ts`).
4. **The suggestion sample.** Before the fourth study's seeded draw of 20 a split, every suggestion the new rules could have moved is labelled in full: those on a page read as unstyled, the 2.4.4 "shared by" claims on links the nesting tells apart, and every 2.4.2 and 3.3.2 suggestion.
5. **Judge pacing.** Up to 8 judge agents ran at once, the auditor and skeptic of up to 4 packets, a new packet's pair launched when two running agents had finished, largest packets first (22:12 to 22:42); the fourth study ran one packet's pair at a time. Each judge was still told not to read the other's work, the prompt is the fourth study's, and no model or effort was set on the agents. None was launched again, every label file was valid the first time (`scripts/check_labels.py`: 0 problems), and every judge replied with the count line only (`run-log-notes.txt`).
6. **What git keeps.** The full reports and consoles stay out of git with the recordings, as the precision-fixes notes kept them; `scripts/compact.py` keeps the part the analysis reads (`pages/<slug>/*.judged.json`). The fourth study had committed its full reports and consoles.

### Deviations

- **The study was paused and resumed.** The candidate list and the first exclusion build were written on 2026-10-27, and a first screen was cut off when the session stopped, writing no result (its console is `data/screen-0-interrupted.txt`). The study resumed on 2026-10-28: the folder is dated that day, the exclusions were built again (the same 2,283 + 136 domains), the screen was run again in full, and the seed fixed on 2026-10-27, before any page loaded, was kept. All of this precedes the pre-registration commit.
- **One slot's backups were extended after the screen.** Every candidate of the international health article failed, and three more were written down before they were loaded (`scripts/candidates-extra.tsv`). Recorded in the pre-registration.
- **A subscription wall was read as a sign-in wall, and three inner pages' text was read to decide it.** The fourth study's rule names a sign-in wall; the New Statesman article shows two paragraphs and then a subscription prompt. The text of newstatesman.com's, agazeta.com.br's and oncoguia.org.br's inner pages was read once in headless Edge; the last two, open articles, were kept and fell on the test half. No Rampa result existed then. Recorded in the pre-registration.
- **One address is redacted** in the screen's files: camicado.com.br's redirect to a Radware challenge, whose query string carried the client's IP address.
- **The blind human sample the notes asked for has not been done.** Section 6 of the [precision-fixes notes](notes-precision-fixes.md) asked for a blind human sample of the third and fourth studies' labels (every finding on the three burst pages and a stratified 100) before this round. It was not done; the person running the studies will do it later. Every label here, as before, is a pre-annotation by two Claude agents of one model family.
- **Analysis scripts written after the pre-registration**, as it said they would be: `scripts/analyze.py`, `extras.py` and `tables.py` were adapted from the fourth study's and from `study/notes-precision-fixes/analyze.py`, and committed in `9766a47` at 22:12:03, before the first label file (22:18:52).
- **What the person running the study saw of the test half**: each test page's capture notes (pre-registered: the capture state of every page) and each judge's one-line count, as the fourth study's runner did. No test finding or label was read before the counts below.
- Nothing else: no retry, no replacement after the pre-registration, no page collected or judged twice, `src/` unchanged (`git diff b759128 -- src` is empty).

## Capture state

From each snapshot, with the frozen code's own functions (`scripts/capture.ts`, `data/capture.md`). A page not listed had all its stylesheets applied, author styles, no layer over the viewport and no limit reached.

| Split | Page | Stylesheets (linked, applied, failed) | Read as unstyled | Body look default | Layer over the viewport | Other |
| --- | --- | --- | --- | --- | --- | --- |
| dev | santacasasp.org.br | 34, 33, 1 | no | no | | |
| dev | www.ncl.ac.uk | | no | no | | cut at 5,000 elements |
| dev | www.irishcentral.com (article) | | no | no | | cut at 5,000 elements; accessibility tree not read (47,993 elements, over 40,000) |
| test | www.abbeytheatre.ie (contact) | 5, 4, 1 | no | no | | |
| test | www.cotswoldoutdoor.com (listing) | | no | no | a consent dialog, 0.89 of the viewport, hidden | cut at 5,000 elements |

- **The capture guards were not exercised.** No page recorded an unstyled capture, none was loaded again for it, and none has the browser's default body look (16 px, weight 400, black, a default serif): the 24 body looks are 13 to 20 px, none in a default serif. The body-look signal and the trigger were logged for every page and fired on none, so this study measures neither fix F2's effect nor its cost; it shows only that it did not misfire on these 24 pages.
- **The layer guard** hid one consent dialog while images, labels and contrast were captured.

## Results

All 24 pages were judged. The main run produced 66 findings from the judged criteria (65 at the default threshold) and 215 from experimental rules and judgments; the `--no-confirm` run added 29, and 48 suggestions were chosen: 358 labelled items.

### The primary measure

| | Test, default threshold | Page bootstrap | Difference: Newcombe | Difference: page bootstrap | Reading |
| --- | --- | --- | --- | --- | --- |
| **This study (`b759128`)** | 20 / 4 / 1: **0.83** (0.64–0.93) | 0.62–1.00 | | | |
| Fourth study, test half (`6e0947a`) | 14 / 12 / 0: 0.54 (0.35–0.71) | 0.13–0.92 | **+0.29 (+0.04 to +0.50)** | **−0.14 to +0.75** | **no measurable change** |
| Fourth study, both halves | 27 / 66 / 2: 0.29 (0.21–0.39) | | **+0.54 (+0.33 to +0.67)** | **−0.04 to +0.82** | **no measurable change** |

Cells are true positives / false positives / uncertain, then precision and its 95% Wilson interval. The page bootstrap resamples each set's pages with replacement, 10,000 times; for a difference, each study's pages independently. Newcombe's interval alone would read "went up" against both references; the page bootstrap, which treats a page and not a finding as the unit, does not, because the fourth study's numbers were set by one or two pages each. The reading fixed in advance needs both.

**Against the in-sample replay.** The notes' 0.86 (95 of 111, 0.78–0.91; page bootstrap 0.78–0.92) was measured on the pages the fixes were built from. On new pages:

| Set | Per element | Page bootstrap | Share of the in-sample 0.86 | Per group | Pages with a decided finding: all true | Mean page precision |
| --- | --- | --- | ---: | --- | --- | ---: |
| Test (the primary) | 20 / 4 / 1: **0.83** (0.64–0.93) | 0.62–1.00 | 0.97 | 20 / 4 / 1: **0.83** (0.64–0.93) | 6 of 9 | 0.80 |
| Dev | 31 / 8 / 1: **0.80** (0.65–0.89) | 0.52–1.00 | 0.93 | 18 / 2 / 1: **0.90** (0.70–0.97) | 7 of 9 | 0.82 |
| Both halves | 51 / 12 / 2: **0.81** (0.70–0.89) | 0.62–0.97 | 0.95 | 38 / 6 / 2: **0.86** (0.73–0.94) | 13 of 18 | 0.81 |
| In-sample replay (notes) | 95 / 16 / 5: 0.86 (0.78–0.91) | 0.78–0.92 | 1 | 69 / 14: 0.83 (0.74–0.90) | 27 of 39 | 0.81 |

Every row of this study is held-out: the code saw neither half. The dev and pooled comparisons with the fourth study were not pre-registered as readings and are exploratory: dev +0.26 against its test half (Newcombe +0.03 to +0.46, page bootstrap −0.23 to +0.77), both halves +0.52 against its pooled halves (+0.37 to +0.63; −0.06 to +0.81). Per group counts each group of 6 or more findings of one claim on one page as one unit: the test half had no group, the dev half two (below).

### The judged criteria

| Criterion | Dev, default threshold | Dev, all findings | Test, default threshold | Test, all findings |
| --- | --- | --- | --- | --- |
| 1.1.1 Non-text Content | 13 / 0 / 1: **1.00** (0.77–1.00) | 13 / 0 / 1: **1.00** (0.77–1.00) | 7 / 4 / 1: **0.64** (0.35–0.85) | 7 / 4 / 1: **0.64** (0.35–0.85) |
| 1.3.5 Identify Input Purpose | 4 / 0 / 0: **1.00** (0.51–1.00) | 4 / 0 / 0: **1.00** (0.51–1.00) | 5 / 0 / 0: **1.00** (0.57–1.00) | 5 / 0 / 0: **1.00** (0.57–1.00) |
| 2.4.2 Page Titled | – | 0 / 1 / 0: **0.00** (0.00–0.79) | – | – |
| 2.4.4 Link Purpose (In Context) | 14 / 8 / 0: **0.64** (0.43–0.80) | 14 / 8 / 0: **0.64** (0.43–0.80) | 5 / 0 / 0: **1.00** (0.57–1.00) | 5 / 0 / 0: **1.00** (0.57–1.00) |
| 2.4.6 Headings and Labels | – | – | 1 / 0 / 0: **1.00** (0.21–1.00) | 1 / 0 / 0: **1.00** (0.21–1.00) |
| 3.1.2 Language of Parts | – | – | 2 / 0 / 0: **1.00** (0.34–1.00) | 2 / 0 / 0: **1.00** (0.34–1.00) |
| **All** | 31 / 8 / 1: **0.80** (0.65–0.89) | 31 / 9 / 1: **0.78** (0.62–0.88) | 20 / 4 / 1: **0.83** (0.64–0.93) | 20 / 4 / 1: **0.83** (0.64–0.93) |

Both halves together: 0.81 at the default threshold (51 of 63, 0.70–0.89) and 0.80 with all findings (51 of 64, 0.68–0.88). By criterion over both halves: 1.1.1 20 / 4 / 2 (0.83, 0.64–0.93), 1.3.5 9 / 0 / 0, 2.4.4 19 / 8 / 0 (0.70, 0.52–0.84), 2.4.6 1 / 0, 3.1.2 2 / 0. No 3.1.1 or 3.3.2 finding; the one 2.4.2 finding is below the threshold, and false.

Against the fourth study at the default threshold, both halves (different pages and code): 1.1.1 4 / 5 / 1 then 20 / 4 / 2; 1.3.5 5 / 0 then 9 / 0; 2.4.4 9 / 52 / 1 then 19 / 8 / 0; 3.1.2 8 / 8 then 2 / 0.

**Sensitivity (pre-registered).** Without the page with the most default-threshold findings, dev is 17 of 25 (0.68, 0.48–0.83; without lakeland.co.uk, 14 findings, all true) and test 14 of 18 (0.78, 0.55–0.91; without its page with 6). Counting every uncertain finding as a true positive, the default threshold reads 0.80 on dev and 0.84 on test; as a false positive, 0.78 and 0.80.

### The ablations

Each is a replay of the same snapshots and answers, so its effect is exact (`data/extras.json`).

| Split | Main run | Second pass off (`--no-confirm`) | Claims the pass moved to review | Cut at 0.9 | Claims between 0.9 and 0.99 | Without the nesting |
| --- | --- | --- | --- | --- | --- | --- |
| dev | 31 / 8 / 1: **0.80** (0.65–0.89) | 37 / 13 / 11: 0.74 (0.60–0.84) | 6 / 5 / 10 | 32 / 9 / 2: 0.78 (0.63–0.88) | 1 / 1 / 1 | 31 / 8 / 1: 0.80 |
| test | 20 / 4 / 1: **0.83** (0.64–0.93) | 20 / 12 / 1: 0.62 (0.45–0.77) | 0 / 8 / 0 | 20 / 4 / 1: 0.83 | – | 20 / 4 / 1: 0.83 |
| both | 51 / 12 / 2: **0.81** (0.70–0.89) | 57 / 25 / 12: 0.69 (0.59–0.78) | 6 / 13 / 10 | 52 / 13 / 3: 0.80 (0.69–0.88) | 1 / 1 / 1 | 51 / 12 / 2: 0.81 |

- **The second pass.** It ran on 44 1.1.1 reading claims and could ask every one: on dev it confirmed 7 and denied 21, on test it confirmed 8 and denied 8. Over both halves the claims were 15 true, 17 false and 12 uncertain; **it kept 9 of the 15 true ones and 4 of the 17 false ones** (the fourth study: 3 of 4 and 5 of 17). 1.1.1 at the default threshold goes from 26 / 17 / 12 (0.60) with the pass off to 20 / 4 / 2 (0.83) with it on, and on test from 7 / 12 / 1 (0.37) to 7 / 4 / 1 (0.64). Its 6 true claims sent to review are all on one dev page (below). The 4 false 1.1.1 findings left on test passed all three framings at 0.991 or more, out of reach of the cut.
- **The 0.99 cut.** Three claims every framing confirmed fell between 0.9 and 0.99, all on dev: a true one at 0.959 (a footer payment logo whose alternative is "payment"), a false one at 0.985 ("ico login" on a person icon in a "Sou PUCRS" link) and an uncertain one at 0.979 ("Ícone representativo do benefício"). With the fourth study's 0.9, dev would read 32 / 9 / 2 (0.78) and both halves 0.80; test is unchanged. The lowest confirmed probability on test was 0.991.
- **The H81 nesting.** Without the nesting, the shared-text fact grounds 26 of the 2,787 link candidates of the 24 snapshots; with it, 20: it tells apart 6 links (2 on museudalinguaportuguesa.org.br, dev, and 4 on a test page) and grounds none it did not before (`data/shared-text.md`). The model claimed none of those 6 as "shared by", in findings or suggestions, so no finding changes and there was no claim to label. This replays the fact only: those 6 links were judged with the prompt the nesting writes, and whether the model would have failed them with the prompt before is not asked.
- **The capture guard and the body-look signal** fired on no page (above); with no unstyled page, no judgment was moved to suggestions for it.

### Suggestions

A fail the checked facts do not support, a claim the second pass denied, a 2.4.2 or 3.3.2 claim with no grounding fact, and a judgment on a page read as unstyled are suggestions: listed for review, not findings.

| Split | 1.1.1 | 2.4.2 | 2.4.4 | 2.4.6 | 3.3.2 | All |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| dev | 21 | 1 | 19 | 17 | 0 | 58 |
| test | 8 | 4 | 23 | 45 | 3 | 83 |

The 1.1.1 suggestions are the 29 claims the second pass denied (labelled through the `--no-confirm` run, above). **The labelled sample** (`data/suggestion-sample.json`):

| What | Labelled | TP / FP / uncertain | True failures moved to review |
| --- | --- | --- | --- |
| Suggestions on a page read as unstyled | all (none) | – | 0 |
| 2.4.4 "shared by" claims the nesting tells apart | all (none) | – | 0 |
| 2.4.2 suggestions (the new grounding) | all 5 (1 dev, 4 test) | 0 / 5 / 0: **0.00** (0.00–0.43) | 0 |
| 3.3.2 suggestions | all 3 (test) | 0 / 3 / 0: **0.00** (0.00–0.56) | 0 |
| 1.1.1 claims between 0.9 and 0.99 (the cut) | all 3 (dev) | 1 / 1 / 1 | 1 |
| 1.1.1 claims the second pass denied (all, the cut's among them) | all 29 | 6 / 13 / 10: **0.32** (0.15–0.54) | 6 |
| Other suggestions, seeded: dev | 20 of 36 | 0 / 17 / 3: **0.00** (0.00–0.18) | 0 (0 to 6.6) |
| Other suggestions, seeded: test | 20 of 68 | 3 / 17 / 0: **0.15** (0.05–0.36) | 10.2 (3.5 to 24.5) |
| Other suggestions, seeded: both | 40 of 104 | 3 / 34 / 3: **0.08** (0.03–0.21) | 8.4 (2.9 to 22.2) |

By criterion, the seeded sample is 2.4.4 2 / 17 / 1 and 2.4.6 1 / 17 / 2 over both halves. **The recall the frozen rules cost on these pages**: the 2.4.2 and 3.3.2 suggestions held no true failure of 8; the nesting and the unstyled guard had nothing to move; the 0.99 cut cost one true failure of 3; the second pass as a whole cost 6 true failures (and 10 uncertain claims) to remove 13 false ones; the other suggestions hold an estimated 8 true failures in 104 (3 to 22).

### Bursts

Every page with 6 or more findings, suggestions or `--no-confirm` claims of one criterion and claim (pre-registered secondary 7). Mechanisms are read on dev only; the test half's are counted.

| Split | Page | What | Size | Labels | Mechanism (dev only) |
| --- | --- | --- | ---: | --- | --- |
| dev | www.lakeland.co.uk | findings, 2.4.4 "shared by" | 14 | 14 true: one true group | Mega-menu "View More" links (26 of them, desktop and mobile copies, to 13 collections) under column titles that are plain links in `div`s, not headings or list items, so nothing programmatic tells them apart; two "Download our App" links likewise |
| dev | portal.pucrs.br (undergraduate) | findings, 2.4.4 generic | 7 | 7 false: one false group | "Leia mais" and "Saiba mais" at the end of news and carousel cards, each just after an `h3` that is itself a link to the same article, in the same container; the generic-text fact counts the link's sentence, list item, cell, header cells and description as its context, not the heading or sibling link of a card built of `div`s (H80) |
| dev | www.hering.com.br | `--no-confirm` claims, 1.1.1 | 10 | 6 true, 4 uncertain | Seven footer payment logos all with `alt="payment"` (the pass confirmed one, a finding, and denied six, all true), and four benefit icons all "Ícone representativo do benefício" (uncertain) |
| dev | portal.pucrs.br (undergraduate) | `--no-confirm` claims, 1.1.1 "describes something the image does not show" | 6 | 3 false, 3 uncertain | Icon alternatives that name the icon inside the links they decorate ("ico login", "ico search", "ico pucrs store": false) and icon file names ("fi-book-open-cover-dark-80x80": uncertain); the pass denied all |
| test | (one page) | suggestions, 2.4.6 | 35 | 3 drawn: 3 false | counted only |

No group of default-threshold findings on the test half. Outside the pre-registered rule, the experimental `rampa/widget-name` (below the threshold) made the largest groups: 65 story-card links on correio24horas.com.br (dev; links wrapping an `article`, to which Chrome's accessibility tree gives no name while the AccName computation includes the descendants: the auditor said true, the skeptic uncertain, so all are uncertain) and 43 on a test page (2 true, 41 uncertain).

### Experimental rules and judgments

All report below the default threshold.

| Check | Dev | Test | Both | Fourth study, both |
| --- | --- | --- | --- | --- |
| `rampa/pixel-contrast` (1.4.3) | 21 / 0 / 0: **1.00** (0.84–1.00) | 8 / 0 / 0: **1.00** (0.68–1.00) | 29 / 0 / 0: **1.00** (0.88–1.00) | 5 / 0 / 0 |
| `rampa/icon-contrast` (1.4.11) | 14 / 0 / 0: **1.00** (0.79–1.00) | 9 / 0 / 0: **1.00** (0.70–1.00) | 23 / 0 / 0: **1.00** (0.86–1.00) | 2 / 0 / 0 |
| `rampa/placeholder-alt` (1.1.1) | 6 / 0 / 3: **1.00** (0.61–1.00) | 15 / 3 / 0: **0.83** (0.61–0.94) | 21 / 3 / 3: **0.88** (0.69–0.96) | 0 / 0 / 1 |
| `rampa/language-switcher-lang` (3.1.2) | 8 / 0 / 0: **1.00** (0.68–1.00) | – | 8 / 0 / 0: **1.00** (0.68–1.00) | 3 / 0 / 4 |
| `rampa/placeholder-contrast` (1.4.3) | 2 / 0 / 0: **1.00** (0.34–1.00) | 2 / 0 / 0: **1.00** (0.34–1.00) | 4 / 0 / 0: **1.00** (0.51–1.00) | 3 / 1 / 0 |
| `rampa/custom-control` (4.1.2) | 1 / 0 / 0: **1.00** (0.21–1.00) | 2 / 0 / 0: **1.00** (0.34–1.00) | 3 / 0 / 0: **1.00** (0.44–1.00) | 1 / 0 / 0 |
| `rampa/widget-name` (4.1.2) | 0 / 1 / 66: **0.00** (0.00–0.79) | 2 / 1 / 41: **0.67** (0.21–0.94) | 2 / 2 / 107: **0.50** (0.15–0.85) | 0 / 2 / 0 |
| `rampa/tab-state` (4.1.2) | – | 0 / 1 / 0: **0.00** (0.00–0.79) | 0 / 1 / 0: **0.00** (0.00–0.79) | – |
| Hidden images, judgment (1.1.1, ACT e88epe) | 4 / 1 / 0: **0.80** (0.38–0.96) | 1 / 3 / 0: **0.25** (0.05–0.70) | 5 / 4 / 0: **0.56** (0.27–0.81) | 1 / 1 / 0 |
| **All** | 56 / 2 / 69: **0.97** (0.88–0.99) | 39 / 8 / 41: **0.83** (0.70–0.91) | 95 / 10 / 110: **0.91** (0.83–0.95) | 15 / 5 / 5 |

The two contrast rules measured from pixels were 52 of 52. `rampa/widget-name` is mostly uncertain: 107 of its findings are where the two judges disagreed (below).

### Findings and time per page

| Split | Page | Collect s | Judge s | Model calls | Judged, default | Judged, all | Experimental | Engine (axe) |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| dev | www.museudalinguaportuguesa.org.br | 32 | 145 | 63 | 0 | 0 | 10 | 22 |
| dev | www.hering.com.br | 33 | 241 | 127 | 4 | 4 | 3 | 3 |
| dev | portal.pucrs.br (undergraduate) | 28 | 322 | 152 | 13 | 14 | 10 | 20 |
| dev | www.ms.gov.br | 40 | 246 | 102 | 3 | 3 | 1 | 5 |
| dev | santacasasp.org.br | 47 | 115 | 47 | 2 | 2 | 13 | 29 |
| dev | www.correio24horas.com.br | 28 | 162 | 64 | 0 | 0 | 73 | 131 |
| dev | www.horniman.ac.uk | 38 | 132 | 81 | 1 | 1 | 1 | 14 |
| dev | www.lakeland.co.uk | 30 | 109 | 78 | 14 | 14 | 4 | 78 |
| dev | www.ncl.ac.uk | 22 | 47 | 24 | 1 | 1 | 0 | 1 |
| dev | ratings.food.gov.uk | 16 | 98 | 44 | 0 | 0 | 1 | 0 |
| dev | patient.info (article) | 37 | 130 | 76 | 1 | 1 | 11 | 20 |
| dev | www.irishcentral.com (article) | 22 | 17 | 13 | 1 | 1 | 0 | 32 |
| test | cinemateca.org.br (contact) | 38 | 152 | 66 | 1 | 1 | 3 | 14 |
| test | www.madeiramadeira.com.br (listing) | 26 | 182 | 73 | 1 | 1 | 0 | 15 |
| test | ufg.br | 32 | 264 | 110 | 5 | 5 | 11 | 94 |
| test | www.trf4.jus.br (ombudsman) | 12 | 89 | 34 | 0 | 0 | 1 | 16 |
| test | www.oncoguia.org.br (article) | 27 | 180 | 68 | 1 | 1 | 5 | 9 |
| test | www.agazeta.com.br (article) | 20 | 78 | 31 | 6 | 6 | 2 | 27 |
| test | www.abbeytheatre.ie (contact) | 16 | 112 | 76 | 3 | 3 | 1 | 6 |
| test | www.cotswoldoutdoor.com (listing) | 21 | 134 | 105 | 2 | 2 | 58 | 1 |
| test | www.nottingham.ac.uk (undergraduate) | 28 | 169 | 76 | 0 | 0 | 1 | 6 |
| test | www.oregon.gov | 29 | 239 | 117 | 5 | 5 | 0 | 0 |
| test | www.cedars-sinai.org | 24 | 144 | 98 | 0 | 0 | 1 | 7 |
| test | www.irishexaminer.com | 35 | 202 | 117 | 1 | 1 | 5 | 49 |

- **Findings per page.** At the default threshold, 3.3 judged findings a page on dev (40 on 12; 2.4 without lakeland.co.uk) and 2.1 on test (25 on 12). Three pages on each half had none.
- **Time.** Collection took 12 to 47 s a page (median 28 s); judging the saved snapshot, 17 to 322 s (median 145 s), with 13 to 152 model calls; the two together 39 to 350 s (median 174 s), at `--concurrency 2`. The fourth study's median was 150 s.

### How often the model flags

| Split | Criterion | Candidates | Judged | Reported failing | Share | Fourth study |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| dev | 1.1.1 | 91 | 91 | 19 | 20.9% | 6.8% |
| dev | 1.3.5 | 11 | 11 | 4 | 36.4% | |
| dev | 2.4.4 | 1,627 | 470 | 22 | 4.7% | 13.9% |
| dev | 2.4.6 | 296 | 191 | 0 | 0.0% | 0.0% |
| dev | 3.1.2 | 19 | 19 | 0 | 0.0% | 72.7% |
| test | 1.1.1 | 91 | 91 | 16 | 17.6% | 4.6% |
| test | 1.3.5 | 16 | 16 | 5 | 31.2% | |
| test | 2.4.4 | 1,160 | 526 | 5 | 1.0% | 1.7% |
| test | 2.4.6 | 390 | 274 | 1 | 0.4% | 0.0% |
| test | 3.1.2 | 4 | 4 | 2 | 50.0% | 61.5% |

"Reported failing" counts findings after verification and the second pass, at any confidence; the 1.1.1 rows include the experimental hidden-image findings.

### Agreement between the judges

| Set | Items | Observed agreement | Cohen's kappa | Fourth study's kappa |
| --- | ---: | ---: | ---: | ---: |
| All | 358 | 0.65 | 0.41 | 0.88 |
| Dev | 210 | 0.61 | 0.35 | 0.91 |
| Test | 148 | 0.72 | 0.47 | 0.84 |
| Judged criteria (with the ablation's claims and the suggestions) | 143 | 0.90 | 0.82 | 0.92 |
| Experimental rules | 215 | 0.49 | 0.10 | 0.56 |

The judges disagreed on 124 items, which became `uncertain`: 107 are `rampa/widget-name` findings on three pages (66 true against uncertain, 41 true against false), 3 `rampa/placeholder-alt`, and 14 judged items (10 of them 1.1.1 claims the second pass denied, 2 main 1.1.1 findings, 2 suggestions). Without `rampa/widget-name`, agreement is 0.93 and kappa 0.86 over 247 items (exploratory). By criterion, kappa is 0.96 on 2.4.4, 0.85 on 2.4.6 and 0.60 on 1.1.1. On why a finding is wrong, over the 78 both called false positives, the cause kappa was 0.46. High agreement between two agents of one model family measures consistency, not accuracy; here it is low on one experimental rule, where the auditor and the skeptic read Chrome's empty accessible name differently.

## False positives, dev split only

Every pattern below comes from dev pages, from the two judges' rationales, checked against the packets. They are candidates for future fixes, chosen on this dev half only; whatever is changed from them must be measured on pages that neither half of this study holds.

### The judged criteria (8 false positives at the default threshold, 1 below)

1. **2.4.4, generic text in a card with a heading, 7 findings** (portal.pucrs.br, one false group). "Leia mais" (6) and "Saiba mais" (1) close news and carousel cards. In each card, in the same container, the `h3` just before the link is itself a link to the same article ("Fisioterapia: conheça a profissão…"), so the purpose is determinable in context (H80, and the sibling link to the same place). The cards are `div`s, so the link has no sentence, list item or cell, and the generic-text fact (`genericLinkText(name) && !context && !headers && !description`) grounds it; the model said "high". Cause: model error, by both judges. **Fix:** count the nearest preceding heading of the link's own card or section (H80), or a sibling link with the same destination, as context before grounding a generic-text claim.
2. **2.4.4, "More" that opens a submenu, 1 finding** (horniman.ac.uk). The main navigation's "More" is `<a href="#" aria-label="More">`, a disclosure toggle whose submenu sits in the same list item right after it. **Fix:** treat a link to `#` that precedes a nested list in its own list item as a menu control, as the 2.4.4 mismatch fact already leaves controls out.
3. **2.4.2, below the threshold, 1 finding**: "Portal | Ensino | Graduação | PUCRS" called a title that says nothing, on the undergraduate page it names.

### The second pass (the claims it denied)

5 false, 6 true and 10 uncertain on dev. The true ones are six footer payment logos (Pix, Apple Pay, Mastercard, Elo, Diners Club, American Express) that share `alt="payment"` with a seventh the pass confirmed: of the six denied, two drew a passing word from one framing, three were confirmed by every framing at a lowest probability under 0.9 (0.53 to 0.69), and one at 0.959, under the cut. The false ones are icon alternatives that name the icon ("ico login", "ico search", "ico pucrs store" inside the links they decorate), a partners strip "Barra de parceiros" and a museum photo described exactly. **Candidate:** claims with the same alternative and the same verdict on one page could be confirmed together, so that one framing's answer on one copy does not split identical failures.

### Suggestions (21 on dev: 18 false, 3 uncertain)

- **2.4.6 headings and labels that do say what they head** (9): "Mais" over the second column of three mega-menu sections, a newspaper section's proper name ("Asteriscão"), "Entretenimento" over entertainment stories, "Ano base: 2025" under a statistics heading, an image card titled with the person it shows, a search field whose placeholder gives examples beside a "BUSCAR SERVIÇO" button (G167), and a cookie banner's "Necessary" checkbox.
- **2.4.4 links named by their sentence, card or section** (8): "Clique Aqui" in "Para visualizar a Política de Privacidade Clique Aqui" and under a section heading, footer sitemap links ("RECONSTRUÇÃO", "EDUCATIVO", "GESTÃO") that redirect to their section's first page, "Help" leading to the contact and FAQ page, "Membership Find out more", and an inline cross-reference "setting off fireworks" to an article on fireworks season.
- **2.4.2** (1): a news article's title, close to its `h1`, read as naming another topic.

These were already suggestions, and the sample confirms that they belong there.

### Experimental rules (2 false positives, 69 uncertain)

- **`rampa/widget-name` on links that wrap an `article`** (correio24horas.com.br, 65 uncertain, and 1 on horniman.ac.uk): Chrome's accessibility tree gives these story-card links an empty name, which a screen reader on Chrome would announce as "link", while the AccName 1.2 computation includes the article's text. The auditor called it a real failure in the browser, the skeptic uncertain; the rule reports what the browser computes. **Candidate:** report it with the browser named, or only when the spec's name is empty too.
- *Uncertain:* 3 `rampa/placeholder-alt` findings. *False:* a hidden-image judgment, and `rampa/widget-name` on one element.

### What the true positives look like on dev

- **2.4.4**, 14: lakeland.co.uk's mega-menu "View More" links and two "Download our App" links (the burst above).
- **1.1.1**, 13: file names as alternatives ("2025-11-17-banner-informacoes-financeiras", "thumb_certificaoes_estudos", "HOME_GERAL_TV1_ALTO_VERAO"), "logo" alone on two sites' logos, "not found", "Contraste" and "Rodapé 2" on images that show something else, and "payment" on a payment logo.
- **1.3.5**, 4: name and e-mail fields of contact and newsletter forms without `autocomplete`.
- **Experimental**, 56: pale text and icons measured from pixels (35) and pale placeholders (2), language links without `lang` (8), placeholder alternatives (6), hidden images that hold information (4), a custom control (1).

## The test split: counts only

The test half's false positives and uncertain items, by origin, check, threshold and the judges' cause. They were not read for patterns.

| Origin | Check | Threshold | Cause | False positives | Uncertain |
| --- | --- | --- | --- | ---: | ---: |
| main | judgment 1.1.1 | default | model error, disputed | 3, 1 | 1 |
| main | judgment 1.1.1, hidden image (experimental) | below | model error | 3 | |
| main | `rampa/placeholder-alt` | below | disputed | 3 | |
| main | `rampa/tab-state` | below | criterion misapplied | 1 | |
| main | `rampa/widget-name` | below | disputed | 1 | 41 |
| `--no-confirm` only | judgment 1.1.1 | default | model error, disputed | 7, 1 | |
| suggestion sample | judgment 2.4.2 | suggestion | model error | 4 | |
| suggestion sample | judgment 2.4.4 | suggestion | model error, disputed, criterion misapplied | 4, 3, 2 | |
| suggestion sample | judgment 2.4.6 | suggestion | model error, criterion misapplied | 4, 4 | |
| suggestion sample | judgment 3.3.2 | suggestion | model error | 3 | |

By page, the main run's 4 default-threshold false positives: 2 on oregon.gov, 1 on irishexaminer.com, 1 on abbeytheatre.ie, all 1.1.1 claims all three framings confirmed at 0.991 or more. The `--no-confirm` run's 8: 4 on irishexaminer.com, 2 on oregon.gov, 1 each on abbeytheatre.ie and cedars-sinai.org.

## Limits

- **Labels by Claude agents, pending human review.** Every label comes from two Claude agents of one model family; they are a pre-annotation, not ground truth, and their mistakes are likely correlated. The blind human sample of the third and fourth studies that the notes asked for before this round has not been done. The labels can be reviewed in Rampa Lab's review mode with `data/findings.json` and `data/pages.json`.
- **The primary reading rests on the page bootstrap.** Newcombe's interval, which treats findings as independent, lies above 0 against both references; the page bootstrap, which resamples pages, does not, mainly because the fourth study's references are set by one or two pages each (its test half's bootstrap runs from 0.13 to 0.92). With 12 test pages, a difference of +0.29 is not distinguishable from zero at the level of pages.
- **The new guards were barely exercised.** No page was unstyled, the nesting changed no claim, and the cut moved 3 claims. This study measures that the fixes did not cost precision on 24 new pages; it says little about whether F1 and F2 would catch the next burst of their kind, which the in-sample replay showed on the pages they were built from.
- **Small numbers.** 25 test findings at the default threshold, 63 decided over both halves; 44 reading claims for the second pass; 48 labelled suggestions.
- **Different pages, not a replay.** The comparison with the fourth study is between sets of pages and versions of the code. The ablations are replays and isolate the second pass, the cut and the nesting fact only.
- **Dropped claims and missed failures are not counted.** Verification, the facts and the second pass decide what becomes a finding; the study labels what the second pass denied and a sample of suggestions, not the claims verification dropped, and it does not audit the pages for failures Rampa missed.
- **Judges kept apart by instruction only**, on one machine and filesystem, up to 8 at once.
- **One run, a nondeterministic model.**
- **The test half is spent.** Its pages may not be used to choose a change; the next held-out measurement needs fresh pages.

## Data and reproduction

All paths are under `study/round-5-2026-10-28/`. Run from the repository root after `pnpm install --frozen-lockfile` and `pnpm build` at `b759128`.

- **Pre-registration.** `preregistration.md`, committed in `77173ed` with the pages, the split and the collection, judging and ablation scripts.
- **Selection.** `scripts/exclusions.py <public_suffix_list.dat> build|check` and `data/excluded-domains.json`; `scripts/candidates*.tsv`, `scripts/screen.mjs` and `data/screen-*.json` (and `data/screen-0-interrupted.txt`, the cut-off first screen); `scripts/links.mjs`; `scripts/pages.tsv`; `scripts/split.py` and `data/pages-input.json`.
- **Collection and judgment.** `bash scripts/collect.sh main`, `collect-log.txt`; `bash scripts/run-judged.sh default`, `bash scripts/run-noconfirm.sh`, `bash scripts/run-cut090.sh` (`data/cut090-variant.diff`), `run-log.txt`; `python -I scripts/compact.py` writes `pages/<slug>/report.judged.json`, `noconfirm.judged.json` and `cut090.judged.json`, the part of each report git keeps.
- **Snapshot-only replays.** `bash scripts/shared-text.sh` (`data/shared-text.md`, `data/shared-text.json`); `node scripts/capture.ts` (`data/capture.md`, `data/capture.json`).
- **Labels.** `python -I scripts/sample_suggestions.py` writes `data/suggestion-sample.json`; `python -I scripts/packets.py` writes `packets/<slug>.json` and `data/findings-raw.json`; `NODE=<node.exe> python -I scripts/judge_prompt.py <slug> auditor|skeptic` prints each judge's exact prompt; `labels/<slug>.<role>.json`; `python -I scripts/check_labels.py`; `run-log-notes.txt`.
- **Numbers.** `python -I scripts/analyze.py` writes `data/findings.json`, `data/pages.json` and `data/summary.json`; `python -I scripts/extras.py` (`data/extras.json`) prints the primary measure, the comparisons, groups, pages, ablations, sample and bursts; `python -I scripts/tables.py` the per-criterion, page, flag-rate and agreement tables; `python -I scripts/dump_fp.py dev [check]` lists the dev false positives with both rationales (`test` prints counts only).
- **Kept out of git.** The recordings, screenshots, judgment caches, crops, full reports and consoles: 125.7 MB for the 72 recording and screenshot files hashed in `data/recordings.json`. A full copy of the study folder is in `C:/Users/guilh/dev/rampa-study-recordings/round-5`. With a copy of `pages/<slug>/recording/` and `pages/<slug>/cache/`, a page's judgments can be read back offline: `rampa check pages/<slug>/recording/<name>.snapshot.json --model ollama:gemma4:12b --locale en --min-confidence low --offline --cache-dir pages/<slug>/cache`, and with `--no-confirm` or the 0.9 build and a copy of the cache, the ablations.

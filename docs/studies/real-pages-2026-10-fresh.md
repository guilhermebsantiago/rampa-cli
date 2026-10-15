# Fresh pages: a second real-page study (October 2026)

The [first real-page study](real-pages-2026-10.md) measured how often the judgment layer is wrong on 24 real pages, and its [re-measure](real-pages-2026-10-remeasure.md) ran the improved code on the other half, the test pages. Their findings had already been read when the first study described its patterns, so that was not a clean held-out measurement, and that half is now spent: it can no longer tell whether the changes generalise. This study runs the current code on 24 pages that neither study, nor the repository's docs, code or commit messages, had ever touched, with the same rubric and the same two-judge labelling.

**In short.** With Gemma 4 12B, at the default threshold, which is what `rampa check` shows and fails on, **0.42 of the judged findings on the dev pages were real failures (18 of 43 decided, 95% Wilson 0.28–0.57) and 0.35 on the test pages (9 of 26, 0.19–0.54)**. That is close to the re-measure's 0.38 on the old test pages and far above the first study's 0.12, so the gain held on fresh pages. Counting the findings below the threshold too, precision falls to 0.26 on dev and 0.14 on test: those are still mostly wrong. By criterion, 1.3.5 was right 11 times out of 11, 1.1.1 a third of the time (15 of 46), and 2.4.4, 2.4.6 and 2.4.2 almost never (1 of 91 together, nearly all below the threshold). The experimental rules did much better than the judgments: `rampa/pixel-contrast` was right 60 times out of 60, and the experimental rules and judgments together 0.79 (87 of 110). The probes, run on 8 of the pages, were right 0.69 of the time (45 of 65). All labels come from Claude agents, not people, and the run is a single run.

**Future tuning may use the dev split only.** This round reports numbers on both halves, but the test half's false positives were not read to find patterns, and only the dev half may be studied to change Rampa. The test half stays held out for the next measurement.

## Question

When Rampa reports a failure on a page it has never seen, how often is the failure real? The question is asked per criterion and per check, at the default threshold and with every finding counted, and it is about precision only. Pages were not audited for what Rampa missed, so recall is out of scope.

## Method

### Pages

**What was excluded.** No page or site of the first study, and no site the repository names anywhere (docs, source, tests, benchmark, commit messages): www.gov.br, gov.uk, mozilla.org, wikipedia.org, nasa.gov, kabum.com.br and every other host named there were left out, so that no page had been used to develop or tune Rampa. No page needs a sign-in, and none has adult or harmful content.

**Design.** Twelve strata: Brazil or international (United States, United Kingdom, Ireland, the Netherlands), times six categories: government, education, news, e-commerce, health, and culture or public services. Each stratum has two pages from two different sites, a home page and an inner page (an article, a listing, a form, a contact or information page). Pages in Brazil are in Portuguese, the others in English. This follows the shape the coverage plan asks of its real-page sample (EVAL-1: half pt-BR and half en, home pages plus inner pages).

**Selection.** For each slot a primary site and up to two backups were written down before any check ran (`study/fresh-2026-10-11/scripts/candidates.tsv`). Each candidate was loaded once in headless Edge, the browser the study runs, to see whether it loads with no bot challenge, error page or sign-in wall (`scripts/screen.mjs`, results in `data/screen-*.json`). A backup replaced its primary only when the primary failed that screen. For inner slots, the inner page was then picked from the site's own navigation: the first article on a news home page, a category listing from a store's menu, a contact or newsletter form. Nine of the 24 slots used a backup: sp.gov.br loaded an empty page; gov.ie answered 403; www.ox.ac.uk, www.ucl.ac.uk, www.hse.ie, www.britishmuseum.org, tfl.gov.uk, www.loc.gov, www.powells.com and www.decathlon.co.uk showed a bot challenge; www.patagonia.com showed a queue page; studentaid.gov failed with an HTTP/2 error. Sites that turn headless browsers away are therefore missing from the sample by construction.

**Split.** At random, with a recorded seed: in each stratum one seeded coin (Python `random.Random(20261011)`) sends either the home page or the inner page to dev, and the other to test. Each half has one page per stratum, six in Portuguese and six in English. The same generator then drew the 8 pages of the probe run: two Brazilian and two international pages from each half (`scripts/split.py`, `data/pages-input.json`).

| Split | Page | Category | Country | Language | Type | Probes |
| --- | --- | --- | --- | --- | --- | :---: |
| dev | https://pinacoteca.org.br/ | culture | BR | pt-BR | home | |
| dev | https://www.martinsfontespaulista.com.br/livros/literatura-brasileira | e-commerce | BR | pt-BR | listing | yes |
| dev | https://www.unicamp.br/ | education | BR | pt-BR | home | |
| dev | https://www.ce.gov.br/ | government | BR | pt-BR | home | |
| dev | https://fiocruz.br/ | health | BR | pt-BR | home | yes |
| dev | https://www.poder360.com.br/ | news | BR | pt-BR | home | |
| dev | https://www.rijksmuseum.nl/en/newsletter?slug=NEWSLETTER_EN | culture | NL | en | form | |
| dev | https://www.ikea.com/gb/en/cat/tables-chairs-fu002/ | e-commerce | UK | en | listing | |
| dev | https://www.berkeley.edu/admissions/ | education | US | en | info | yes |
| dev | https://www.ons.gov.uk/ | government | UK | en | home | |
| dev | https://medlineplus.gov/diabetes.html | health | US | en | article | yes |
| dev | https://www.propublica.org/article/draftkings-sports-gambling-problem-vip-fanduel | news | US | en | article | |
| test | https://www.metro.sp.gov.br/fale-conosco/ | culture | BR | pt-BR | contact | |
| test | https://chicorei.com/ | e-commerce | BR | pt-BR | home | yes |
| test | https://www.fuvest.br/vestibular-da-usp | education | BR | pt-BR | info | |
| test | https://www12.senado.leg.br/institucional/falecomosenado | government | BR | pt-BR | contact | yes |
| test | https://www.tuasaude.com/dengue/ | health | BR | pt-BR | article | |
| test | https://apublica.org/2026/10/flavio-bolsonaro-e-o-risco-de-um-presidente-com-esqueletos-no-armario/ | news | BR | pt-BR | article | |
| test | https://www.bl.uk/ | culture | UK | en | home | yes |
| test | https://www.thomann.co.uk/ | e-commerce | UK | en | home | |
| test | https://www.tcd.ie/ | education | IE | en | home | |
| test | https://tools.usps.com/zip-code-lookup.htm | government | US | en | form | |
| test | https://www.cdc.gov/ | health | US | en | home | yes |
| test | https://www.theguardian.com/international | news | UK | en | home | |

### Collection, then judgment on the saved snapshot

Every page was collected once, live, and judged later from what was saved, so the judgments can be run again on exactly the same input.

- **Collection, no model.** `rampa check <url> --model ollama:gemma4:12b --offline --locale en --min-confidence low --save <dir>`, with Edge through playwright-core, on 2026-10-11 between 18:19 and 18:35 (UTC−3). Naming the model makes the collector capture each image for 1.1.1 and read where links lead for 2.4.4; `--offline` means Rampa never calls the model (it reads cached judgments only, and the cache was empty). Each recording is the page's snapshot and its axe-core results.
- **Judgment.** After the GPU was free, each saved snapshot was checked with `rampa check <snapshot> --model ollama:gemma4:12b --locale en --min-confidence low --time-limit 900`: the default configuration (the eight default criteria, at most 50 candidates per criterion, one run, no `--runs`), with every finding listed. Pages ran one at a time, on 2026-10-11 from 19:45 to 21:16. No page reached the time limit.
- **Probes.** The 8 pages of the probe subset were collected live a second time with `--probe all` (layout, keyboard, hover, orientation, shortcuts, media, color and states), the same way, from 18:35 to 18:59, and that recording was judged afterwards with a copy of the page's judgment cache, so prompts that were the same on both loads were not asked again. Only what the probe run adds was labelled: probe findings, and judgments of criteria the default run does not judge. A probe cannot be replayed from a recording made without it, which is why these pages were loaded twice.
- **Model.** Gemma 4 12B (`gemma4:12b`, 11.9B, Q4_K_M, digest `6114515d63c1`) on Ollama 0.40.2, reasoning off, temperature 0, on a local GPU that other jobs were also using.
- **Rampa** at `ebd4d07`, the head of `main` when the study started; the study branch adds only the study's files.

**What went wrong during collection.** The machine's connection dropped for about two minutes during the collection; the attempts in that window (berkeley.edu, theguardian.com, propublica.org and one of thomann.co.uk) are not counted, and those pages were collected again once it was back. www.tuasaude.com never reached `load`: twice at the default 30 s and twice at 60 s. It was collected with `--wait-for domcontentloaded`, the option Rampa offers for this, and is the only page collected with a non-default option. Every attempt is in `collect-log.txt` and `pages/<slug>/run-*.json`.

**Default threshold.** `rampa check` shows, and fails on, findings of medium confidence or above from checks that are not experimental. That is the "default threshold" column. Every experimental check (all of Rampa's own rules and every probe) reports below it whatever confidence it gives, and so do judgments of titles, link texts, headings and labels that are not on Rampa's lists of generic text. "All findings" adds everything below the threshold. The run used `--min-confidence low`, so one report gives both.

### Labels

As in the first study and the re-measure:

- **What was labelled.** Every judgment finding and every rule finding of the default run, and every probe finding of the probe run, at any confidence: 356 findings. Engine (axe-core) findings, 825 of them, were not labelled.
- **Two judges per page.** For each page, two Claude agents were spawned and told not to read each other's work: an **auditor**, which decides whether the finding is a real failure of the criterion as an auditor would, and a **skeptic**, which looks for concrete reasons the finding could be wrong. Each got the rubric (`study/fresh-2026-10-11/judge-rubric.md`, the re-measure's rubric with a paragraph on probe findings added) and an evidence packet with each finding as reported (Rampa's `confidence` and `patch` included), the element from the snapshot with its HTML, ancestors and nearby headings, where a link leads when Rampa read it, and the image crop the model saw. They could also open the page's snapshot and screenshot and the live page, and, for probe findings, drive the live page in headless Edge. They were told not to open the other studies, the other packets or any label, nor to run a script they had not written (`scripts/judge-prompt.txt`). They ran on one machine and filesystem, so that instruction is what kept them apart; one lapse is below. The exact prompt of each judge is printed by `scripts/judge_prompt.py`. This took 62 agents: two for each of the 24 pages and of the 7 probe packets (one probed page had no probe finding).
- **Final label.** The label both judges gave; when they differ, `uncertain`. A false positive's cause is the one both named, or `disputed`. Precision is TP / (TP + FP), uncertain findings left out, with 95% Wilson intervals; agreement is Cohen's kappa over the three labels.

One judge reported that it had run, by accident, a leftover script from an earlier study that it found in a shared temporary folder. The script wrote a copy of one of the first study's label files to a new folder outside the repository; the copy matched the committed file and was deleted, and the judge's own labels for its page were checked against its packet. Later judges were told not to run any script they had not written.

## Results

All 24 pages were judged. They produced 170 findings from the judged criteria (73 at the default threshold), 115 from experimental rules and judgments, and 71 from probes on the 7 probed pages that had any.

### The judged criteria

The eight criteria Rampa judges by default. Each cell is true positives / false positives / uncertain, then precision and its 95% Wilson interval.

| Criterion | Dev, default threshold | Dev, all findings | Test, default threshold | Test, all findings |
| --- | --- | --- | --- | --- |
| 1.1.1 Non-text Content | 7 / 19 / 4: **0.27** (0.14–0.46) | 7 / 19 / 4: **0.27** (0.14–0.46) | 8 / 12 / 0: **0.40** (0.22–0.61) | 8 / 12 / 0: **0.40** (0.22–0.61) |
| 1.3.5 Identify Input Purpose | 10 / 0 / 0: **1.00** (0.72–1.00) | 10 / 0 / 0: **1.00** (0.72–1.00) | 1 / 0 / 0: **1.00** (0.21–1.00) | 1 / 0 / 0: **1.00** (0.21–1.00) |
| 2.4.2 Page Titled | – | 0 / 2 / 0: **0.00** (0.00–0.66) | – | 0 / 2 / 0: **0.00** (0.00–0.66) |
| 2.4.4 Link Purpose (In Context) | 0 / 4 / 0: **0.00** (0.00–0.49) | 1 / 18 / 1: **0.05** (0.01–0.25) | 0 / 5 / 0: **0.00** (0.00–0.43) | 0 / 40 / 3: **0.00** (0.00–0.09) |
| 2.4.6 Headings and Labels | – | 0 / 15 / 1: **0.00** (0.00–0.20) | – | 0 / 13 / 5: **0.00** (0.00–0.23) |
| 3.1.2 Language of Parts | 1 / 0 / 0: **1.00** (0.21–1.00) | 2 / 0 / 0: **1.00** (0.34–1.00) | – | 2 / 1 / 1: **0.67** (0.21–0.94) |
| 3.3.2 Labels or Instructions | 0 / 2 / 0: **0.00** (0.00–0.66) | 0 / 2 / 0: **0.00** (0.00–0.66) | – | – |
| **All** | 18 / 25 / 4: **0.42** (0.28–0.57) | 20 / 56 / 6: **0.26** (0.18–0.37) | 9 / 17 / 0: **0.35** (0.19–0.54) | 11 / 68 / 9: **0.14** (0.08–0.23) |

Both halves together: **0.39 at the default threshold** (27 of 69, 0.28–0.51) and **0.20 with all findings** (31 of 155, 0.14–0.27). 3.1.1 judged 24 pages and failed none.

- **1.3.5 is the one judged criterion that is reliably right**: 11 of 11, all of them newsletter and contact fields with no `autocomplete` (pinacoteca.org.br, propublica.org, rijksmuseum.nl, poder360.com.br and one test page).
- **1.1.1 is right about a third of the time**, at the default threshold, where all of its findings are. Its true positives are file names and placeholders ("Tarja-Especiais-Site-Interna-1", "Banner padrão", "Advertisement" on a linked ad) and linked photos whose alternative describes the picture rather than where the link goes.
- **2.4.4, 2.4.6 and 2.4.2 are still almost always wrong**: 1 true positive in 91 decided findings. Most sit below the threshold. The 9 that a user sees are 2.4.4 claims, all false positives; on dev they are four "Learn more" links (below).
- **3.3.2's two findings, both on dev, were wrong**, and both on the same search widget (below).

**Sensitivity.** Findings cluster on a few pages. Without the page with the most default-threshold findings, dev is 15 of 32 (0.47; without rijksmuseum.nl, 11 findings) and test 4 of 19 (0.21; without fuvest.br, 7 findings). Counting every uncertain finding as a true positive, the default threshold reads 0.47 on dev and 0.35 on test; counting them all as false positives, 0.38 and 0.35.

### Experimental rules and judgments

Rampa's own rules (all experimental) and the experimental 1.1.1 question about images hidden from assistive technology. All of these report below the default threshold.

| Check | Dev | Test | Both |
| --- | --- | --- | --- |
| `rampa/pixel-contrast` (1.4.3) | 26 / 0 / 2: **1.00** (0.87–1.00) | 34 / 0 / 0: **1.00** (0.90–1.00) | 60 / 0 / 2: **1.00** (0.94–1.00) |
| `rampa/language-switcher-lang` (3.1.2) | 3 / 0 / 0: **1.00** (0.44–1.00) | 6 / 0 / 1: **1.00** (0.61–1.00) | 9 / 0 / 1: **1.00** (0.70–1.00) |
| `rampa/placeholder-contrast` (1.4.3) | 3 / 0 / 0: **1.00** (0.44–1.00) | 3 / 0 / 0: **1.00** (0.44–1.00) | 6 / 0 / 0: **1.00** (0.61–1.00) |
| `rampa/placeholder-alt` (1.1.1) | – | 4 / 0 / 0: **1.00** (0.51–1.00) | 4 / 0 / 0: **1.00** (0.51–1.00) |
| `rampa/widget-name` (4.1.2) | 1 / 0 / 0: **1.00** (0.21–1.00) | 2 / 0 / 0: **1.00** (0.34–1.00) | 3 / 0 / 0: **1.00** (0.44–1.00) |
| `rampa/custom-control` (4.1.2) | – | 1 / 0 / 0: **1.00** (0.21–1.00) | 1 / 0 / 0: **1.00** (0.21–1.00) |
| `rampa/icon-contrast` (1.4.11) | 0 / 1 / 1: **0.00** (0.00–0.79) | 2 / 0 / 1: **1.00** (0.34–1.00) | 2 / 1 / 2: **0.67** (0.21–0.94) |
| Hidden images, judgment (1.1.1, ACT e88epe) | – | 2 / 3 / 0: **0.40** (0.12–0.77) | 2 / 3 / 0: **0.40** (0.12–0.77) |
| `rampa/css-reading-order` (1.3.2) | – | 0 / 19 / 0: **0.00** (0.00–0.17) | 0 / 19 / 0: **0.00** (0.00–0.17) |
| **All** | 33 / 1 / 3: **0.97** (0.85–0.99) | 54 / 22 / 2: **0.71** (0.60–0.80) | 87 / 23 / 5: **0.79** (0.71–0.86) |

- **The pixel rules are the strongest result of the study.** `rampa/pixel-contrast` reported 62 texts on 10 pages whose contrast axe-core could not decide (a gradient, an image or a pseudo-element behind them), and the judges, who sampled the screenshots themselves, found all 60 they decided to fail. `rampa/placeholder-contrast` was 6 of 6. Together with `rampa/language-switcher-lang` (9 of 9 here, 2 of 2 in the re-measure), these are the first rules with enough findings to be put before a person for the coverage plan's gate (35 reviewed findings with no false positive).
- **`rampa/css-reading-order` reported 19 findings, all on one test page, and all were false positives.** Following the dev-only rule, its causes are not described here; they are in the labels.
- **The hidden-image judgment** was right 2 times out of 5, all on test pages.

### Probes

Run on the 8 pages of the probe subset (4 dev, 4 test). One page (berkeley.edu) had no probe finding. Every probe reports below the default threshold.

| Check | Dev | Test | Both |
| --- | --- | --- | --- |
| `rampa/focus-indicator-contrast` (1.4.11) | 3 / 1 / 0: **0.75** (0.30–0.95) | 15 / 0 / 0: **1.00** (0.80–1.00) | 18 / 1 / 0: **0.95** (0.75–0.99) |
| `rampa/focus-visible` (2.4.7) | 9 / 1 / 0: **0.90** (0.60–0.98) | 2 / 0 / 0: **1.00** (0.34–1.00) | 11 / 1 / 0: **0.92** (0.65–0.99) |
| `rampa/focus-obscured` (2.4.11) | 3 / 0 / 0: **1.00** (0.44–1.00) | 6 / 0 / 6: **1.00** (0.61–1.00) | 9 / 0 / 6: **1.00** (0.70–1.00) |
| `rampa/hover-content` (1.4.13) | 2 / 0 / 0: **1.00** (0.34–1.00) | – | 2 / 0 / 0: **1.00** (0.34–1.00) |
| `rampa/state-indicator-contrast` (1.4.11) | 1 / 0 / 0: **1.00** (0.21–1.00) | – | 1 / 0 / 0: **1.00** (0.21–1.00) |
| `rampa/state-text-contrast` (1.4.3) | 1 / 0 / 0: **1.00** (0.21–1.00) | 2 / 3 / 0: **0.40** (0.12–0.77) | 3 / 3 / 0: **0.50** (0.19–0.81) |
| `rampa/reflow` (1.4.10) | 1 / 0 / 0: **1.00** (0.21–1.00) | 0 / 1 / 0: **0.00** (0.00–0.79) | 1 / 1 / 0: **0.50** (0.09–0.91) |
| `rampa/link-color-only` (1.4.1) | 0 / 10 / 0: **0.00** (0.00–0.28) | – | 0 / 10 / 0: **0.00** (0.00–0.28) |
| `rampa/text-spacing` (1.4.12) | – | 0 / 2 / 0: **0.00** (0.00–0.66) | 0 / 2 / 0: **0.00** (0.00–0.66) |
| `rampa/keyboard-reach` (2.1.1) | – | 0 / 1 / 0: **0.00** (0.00–0.79) | 0 / 1 / 0: **0.00** (0.00–0.79) |
| `rampa/character-key-shortcuts` (2.1.4) | – | 0 / 1 / 0: **0.00** (0.00–0.79) | 0 / 1 / 0: **0.00** (0.00–0.79) |
| **All** | 20 / 12 / 0: **0.62** (0.45–0.77) | 25 / 8 / 6: **0.76** (0.59–0.87) | 45 / 20 / 6: **0.69** (0.57–0.79) |

The keyboard walk's checks (focus indicator contrast, focus visible, focus obscured) were right 38 times out of 40 they decided. `rampa/link-color-only` was wrong 10 times out of 10, all on one dev page. The probes added no judgment finding: the probe run's judgments repeated the default criteria. Probing cost time: collecting a page with `--probe all` took 107 to 253 s, against 10 to 22 s without probes for the same pages.

### Findings and time per page

| Split | Page | Collect s | Judge s | Model calls | Judged, default | Judged, all | Experimental | Engine (axe) |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| dev | pinacoteca.org.br | 57 | 284 | 96 | 5 | 7 | 2 | 13 |
| dev | martinsfontespaulista.com.br (listing) | 22 | 83 | 27 | 1 | 3 | 1 | 223 |
| dev | www.unicamp.br | 15 | 465 | 85 | 6 | 8 | 1 | 44 |
| dev | www.ce.gov.br | 24 | 418 | 82 | 5 | 5 | 2 | 2 |
| dev | fiocruz.br | 17 | 275 | 80 | 7 | 9 | 6 | 6 |
| dev | www.poder360.com.br | 30 | 424 | 118 | 5 | 15 | 12 | 25 |
| dev | www.rijksmuseum.nl (newsletter form) | 16 | 82 | 52 | 11 | 14 | 6 | 0 |
| dev | www.ikea.com (listing) | 22 | 193 | 114 | 4 | 5 | 0 | 4 |
| dev | www.berkeley.edu/admissions | 11 | 92 | 60 | 0 | 4 | 0 | 0 |
| dev | www.ons.gov.uk | 13 | 194 | 84 | 0 | 3 | 0 | 0 |
| dev | medlineplus.gov/diabetes | 12 | 170 | 112 | 1 | 4 | 7 | 48 |
| dev | www.propublica.org (article) | 30 | 151 | 86 | 2 | 5 | 0 | 15 |
| test | www.metro.sp.gov.br/fale-conosco | 24 | 261 | 79 | 2 | 5 | 1 | 14 |
| test | chicorei.com | 19 | 240 | 75 | 0 | 6 | 4 | 8 |
| test | www.fuvest.br (information page) | 13 | 413 | 100 | 7 | 13 | 16 | 199 |
| test | www12.senado.leg.br/falecomosenado | 10 | 273 | 56 | 3 | 11 | 4 | 19 |
| test | www.tuasaude.com/dengue | 29 | 303 | 93 | 1 | 1 | 20 | 69 |
| test | apublica.org (article) | 24 | 322 | 86 | 0 | 14 | 4 | 42 |
| test | www.bl.uk | 14 | 125 | 78 | 2 | 5 | 0 | 0 |
| test | www.thomann.co.uk | 15 | 123 | 74 | 4 | 7 | 2 | 47 |
| test | www.tcd.ie | 43 | 201 | 76 | 3 | 6 | 7 | 6 |
| test | tools.usps.com (form) | 16 | 139 | 65 | 0 | 9 | 0 | 35 |
| test | www.cdc.gov | 16 | 71 | 43 | 3 | 6 | 1 | 0 |
| test | www.theguardian.com/international | 31 | 169 | 108 | 1 | 5 | 19 | 6 |

- **Findings per page.** At the default threshold, 3.9 judged findings a page on dev (47 on 12 pages) and 2.2 on test (26 on 12); five pages had none. With every finding counted, about 7 a page in each half, plus 4.8 experimental rule findings a page. The first study's test pages had 11 a page, all shown; the re-measure's, 4.3 shown.
- **Time.** Collection took 10 to 57 s a page (median 18 s); judging the saved snapshot, 71 to 465 s (median 198 s), with 27 to 118 model calls; the two together 87 to 480 s (median 230 s). The first study's pages took 168 to 858 s (median 460 s) and the re-measure's 92 to 290 s (median 167 s), each on a GPU shared with other jobs, as this one was.

### How often the model flags

| Split | Criterion | Candidates | Judged | Reported failing | Share |
| --- | --- | ---: | ---: | ---: | ---: |
| dev | 1.1.1 | 160 | 160 | 30 | 18.8% |
| dev | 2.4.4 | 1367 | 535 | 20 | 3.7% |
| dev | 2.4.6 | 320 | 261 | 16 | 6.1% |
| test | 1.1.1 | 118 | 118 | 25 | 21.2% |
| test | 2.4.4 | 1043 | 543 | 43 | 7.9% |
| test | 2.4.6 | 328 | 239 | 18 | 7.5% |

The cap of 50 candidates per criterion left out 61% of the link candidates on dev and 48% on test. On test, 1.1.1's count includes the 5 experimental hidden-image findings. As in the first study, a small share of passing links and headings flagged still makes more false findings than there are real failures.

### Agreement between the judges

| Set | Findings | Observed agreement | Cohen's kappa |
| --- | ---: | ---: | ---: |
| All | 356 | 0.96 | 0.92 |
| Dev | 151 | 0.97 | 0.95 |
| Test | 205 | 0.95 | 0.90 |
| Judged criteria | 170 | 0.98 | 0.94 |
| Experimental rules | 115 | 0.96 | 0.88 |
| Probes | 71 | 0.92 | 0.81 |

The judges disagreed on 15 findings, which became `uncertain`: 4 on dev pages (two pixel-contrast findings next to a high-contrast toggle, a linked cover named "Capa AFN", a faint developer logo) and 11 on test pages, six of them focus-obscured findings on one page. On why a finding is wrong they agreed far more than before: a cause kappa of 0.90 on the 167 findings both called false positives, against 0.33 in the first study and 0.40 in the re-measure. Agreement this high between two agents of the same model family measures how consistent they are, not whether they are right.

### Against the first study and the re-measure

Same rubric, same two-judge method, same model; different pages and code.

| | First study (`46029c1`) | Re-measure (`cf7991a`) | This study (`ebd4d07`) |
| --- | --- | --- | --- |
| Pages | 24 chosen, 19 finished | the first study's 12 test pages | 24 fresh pages, all finished |
| Dev, default threshold | 9 / 61: 0.13 (0.07–0.23) | – | 18 / 25: **0.42** (0.28–0.57) |
| Dev, all findings | same (every finding was `high`) | – | 20 / 56: **0.26** (0.18–0.37) |
| Test, default threshold | 14 / 98: 0.12 (0.08–0.20) | 17 / 28: 0.38 (0.25–0.52) | 9 / 17: **0.35** (0.19–0.54) |
| Test, all findings | same | 17 / 71: 0.19 (0.12–0.29) | 11 / 68: **0.14** (0.08–0.23) |
| 1.1.1 | dev 0.04, test 0.32 | 0.42 | dev 0.27, test 0.40 |
| 1.3.5 | dev 8 of 9, test 2 of 5 | 2 of 5 | 11 of 11 |
| 2.4.4 | 0 of 55 | 0 of 3 shown, 0 of 27 in all | 0 of 9 shown, 1 of 59 in all |
| 2.4.6 | 0 of 45 | 0 of 19, all below | 0 of 28, all below |
| 2.4.2 | 0 of 5 | none | 0 of 4, all below |
| Experimental rules | not built | 3 of 6 | 87 of 110 |
| Probes | not run | not run | 45 of 65, on 8 pages |
| Judges' kappa | 0.69 | 0.78 | 0.92 |

- **What held up.** At the default threshold, precision on fresh test pages (0.35) is within the interval of the re-measure's 0.38, so the gain from the first study's 0.12 did not depend on the pages it was tuned against. 1.1.1 kept roughly its re-measure precision on test.
- **What did not change.** The judgments of ordinary link texts, headings and titles are still wrong almost every time (1 of 91 here). Moving them below the threshold hid them; it did not fix them.
- **What is new.** The experimental rules and the keyboard probes did far better than the judged criteria, on the same pages.

## False positives, dev split only

Every pattern below comes from dev pages, described from the two judges' rationales and checked against the snapshots and the model's cached answers. Test-split false positives were counted but not read for patterns, so that the test half can measure whatever is changed next. The suggestions are for future work on dev evidence only.

### What a user sees: the default threshold (25 false positives on dev)

1. **1.1.1, an accurate logo name with a word glued to it, 7 findings.** The footer of rijksmuseum.nl names its logos "Instagramlogo", "Facebooklogo", "Youtubelogo", "Tiktoklogo", "Linkedinlogo", "Ministry of Education, Culture and Sciencelogo" and "ING - Engelslogo". Each was reported as "describes something the image does not show", while the model's own answer said what it saw ("A white outline of the Instagram logo on a black background") and suggested "Instagram", "YouTube", "TikTok" and so on. Rampa already drops a suggestion that only removes words of the current alternative, but it compares whole words, and "Instagramlogo" is one word. **Fix:** treat a suggestion as a rewording when, case, spaces and punctuation aside, it is contained in the current alternative or contains it (unless the current alternative is itself a generic word such as "logo" or "imagem"). That drops six of these seven ("ING - Engelslogo" → "ING logo" stays), and also pinacoteca.org.br "Pinacoteca" → "Pinacoteca de São Paulo" (item 3), and fiocruz.br "Tour 360º" → "Tour 360º do Castelo" (item 4) if the check applies to that claim too. It drops no true positive on dev.
2. **1.1.1, a pictogram inside a link that repeats the link's own text, 3 findings.** In ce.gov.br's "Mais acessados" list, each service link holds a 32 px icon and a visible text, and the icon's `alt` repeats that text: "Emitir o licenciamento anual do veículo (CRLV)", "DAE para pagamento de IPVA - boleto/pix", "Transferir a propriedade do veículo". The model wanted the icon described ("Ícone de veículo", "Ícone de documento com cifrão"). The icon is not all its link holds, so the functional-image handling did not apply. The `alt` names what the link does; it is redundant at worst, and technique H2 would make it empty, which is not a 1.1.1 failure either. **Fix:** drop a "describes something the image does not show" claim when the alternative equals, or is contained in, the visible text of the same link or button.
3. **1.1.1, a short alternative that is true, called wrong, 4 findings.** unicamp.br "Imagem do campus" on a photo of the campus entrance, and "Capa da edição 751" on the cover of that edition, with "ED. 751" printed on it; fiocruz.br "Boletim InfoGripe" on the bulletin's map cover with its logo; the pinacoteca.org.br header logo "Pinacoteca", a wordmark reading "PINACOTECA DE SÃO PAULO". In two of them the model's own description contradicts its claim ("A wide shot of the entrance to the UNICAMP campus…", "The front cover of Jornal da Unicamp…"). **Fix:** drop a "wrong content" claim when the alternative's content words, generic words such as "imagem", "foto" or "capa" aside, appear in the model's own description of the image. That description is written in English while these alternatives are Portuguese, so ask for it in the page's language, or compare through a second question.
4. **1.1.1, "is all its link holds, and does not say where the link leads" when it does, 4 findings.** unicamp.br "Imagem aérea da área da saúde com o selo Nova Saúde Unicamp" leads to a page titled "Nova Saúde - Portal Unicamp"; rijksmuseum.nl "ANBIlogo" leads to "ANBI information"; fiocruz.br "Tour 360º" leads to the page that embeds the castle's 360° tour; medlineplus.gov "X", the X logo in a share row next to "Facebook", "Pinterest" and "Print", with `title="X"`. Rampa drops this claim only when the alternative has nothing but words of the link's title or destination, so one descriptive word too many keeps it. **Fix:** drop it when the alternative contains the destination's distinctive name (its title without the site name), and split glued words as in item 1. A share or social icon named for its service names its purpose.
5. **1.1.1, a person's name taken for a file name, 1 finding.** poder360.com.br's election widget shows Lula's photo with `alt="Lula"`, from `Lula.png`, and the finding called it a file name or placeholder. The crop also held the "16%" of a vote bar drawn over the photo by another element, and the suggestion became "Lula com um selo de 16%". **Fix:** an alternative equal to its file's name is a placeholder only when the name looks like a file name (digits, underscores, camera prefixes, a hyphenated slug), not when it is a word or a proper name; and a crop that other elements paint over is not the image's own pixels.
6. **2.4.4, "Learn more" in a card with its own heading, 4 findings.** On ikea.com, three "Learn more" links each close a card with an h3 and a sentence ("Delivery", "Finance", "Click and collect"), and a fourth in the footer has `aria-describedby` pointing to the heading "Join IKEA Family". "Learn more" is on the generic list, so the claim kept the model's high confidence, and the model said "nothing around it does". These are the only 2.4.4 findings dev showed at the default threshold, and all are wrong. **Fix:** for a generic text, drop "nothing around it" when the link's closest block container holds a heading, or when the link has `aria-describedby`; and give the model that heading and description explicitly.
7. **3.3.2, a search box that was not on screen, 2 findings.** Both are Google Programmable Search boxes, reported as "Nothing on screen tells what to enter in the field 'pesquisar': its name is in aria-label". On unicamp.br the box is collapsed to a magnifying-glass icon (the input has opacity 0 until clicked, then shows "Buscar no site"); on poder360.com.br it sits in a closed slide-out menu, at y = −1077. The Understanding document for 3.3.2 accepts a magnifying-glass icon as the visible label of a search field. **Fix:** leave out fields that are not visible when the page is read (off screen, transparent, in a closed menu), as honeypots already are, and pass a search field shown with a search icon or button.

### Below the threshold (shown with `--min-confidence low`, 31 more false positives)

- **2.4.6, news-grid headings judged against the next card, 10 findings.** On poder360.com.br, section kickers ("PODER BRASIL", "PODER INTERNACIONAL", "CONTEÚDO DE MARCA", "PODERDATA/AYA") and headlines were reported as "names a different topic than the content under it": the content compared was the next teaser in the DOM, and some patches would have given a headline another story's title. **Fix:** for a heading inside a card or a link, its content is the card; stop reading at the card's container.
- **2.4.4, menu toggles and navigation links, 6 findings.** pinacoteca.org.br "Visita" and "Pina" are dropdown toggles (`href="#"`, `aria-haspopup`, `aria-expanded`) judged as if they led somewhere. ons.gov.uk names its primary navigation links "Economy sub menu toggle" and the like, and the model called the extra words a mismatch with the page "Economy - Office for National Statistics" (3 findings). berkeley.edu's "Skip to main menu", whose target is the first item of the main menu ("About"), was read as leading to "About". **Fix:** leave out toggles; accept a name that contains the destination's title; do not compare a same-page fragment link with the name of its target.
- **2.4.4, footer links read out of their context, 3 findings.** berkeley.edu's footer links "Visit" and "Give" were judged with a nearby "Study Abroad" card as their context, and the patches were "Visit Berkeley Study Abroad" and "Donate to Study Abroad"; its footer link "Accessibility", which leads to the university's page for reporting accessibility issues, was called vague.
- **2.4.4 and 2.4.6, names the collector cut or joined, 2 findings.** A unicamp.br news card's link name was cut at 300 characters, inside the photo's long `alt` and before the headline that names the article. martinsfontespaulista.com.br's sidebar heading was read as "CategoriasLivros": CSS draws "Categorias" and hides the link text "Livros", and the two were joined with no space.
- **Other model errors.** 2.4.6 on propublica.org's visually hidden label "Please enter your email address:", said not to say what to enter, on its footer heading "INFO" over links about the organization, and on medlineplus.gov's "Start Here" and its hidden "Topic Image" heading; 2.4.2 on medlineplus.gov's title "Diabetes | Type 1 Diabetes | Type 2 Diabetes | MedlinePlus" and on rijksmuseum.nl's "Keep me informed", the title of its newsletter form; 2.4.4 on an in-sentence citation link on propublica.org, on "Explore now" beside its heading on ikea.com, on "Simplifique!", the name of the federal service it links to in fiocruz.br's gov.br bar, and on rijksmuseum.nl's "Youtubelink".

### Experimental rules and probes on dev (13 false positives)

- **`rampa/link-color-only` (1.4.1), 10 of 10 wrong, one page.** medlineplus.gov's resource lists start each item with a title link (#006699, 14 px, underlined only on hover). The rule compared it with the list item's computed color, #444444, which colors no visible text; the text next to the link is a 12 px #666666 source note. The links are also the first thing in their list items, not words in running text. **Fix:** compare with the color of the text actually rendered next to the link, count a difference in size or weight as a cue that is not color, and leave out links that start a list item.
- **Text fields and their caret, 2 findings.** On martinsfontespaulista.com.br's search field, `rampa/focus-visible` found no pixel changing on focus, but the field shows a blinking caret, and Playwright hides the caret in screenshots by default. On medlineplus.gov's search field, `rampa/focus-indicator-contrast` measured a pale border and glow under 3:1, but the caret (#444444, 9.7:1) is the indicator that the Understanding document for 1.4.11 accepts for a text input. **Fix:** capture text fields with the caret shown, and count the caret as an indicator for them.
- **`rampa/icon-contrast` on a brand logo, 1 finding.** poder360.com.br's WhatsApp link is the white WhatsApp glyph on WhatsApp green (1.97:1). Logos are exempt from 1.4.11, and that carries over when a logo is a control.

### What the true positives look like on dev

- **1.3.5**, 10 of 10: newsletter and contact fields with no `autocomplete` ("Email*", "Nome*", "Telefone", "Firstname", "Lastname*").
- **1.1.1**, 7: file names and placeholders ("Tarja-Especiais-Site-Interna-1", "Banner padrão"), a linked advertisement named "Advertisement", and linked images whose alternative describes the picture ("Mulher de touca e luva fita tubo de ensaio", which leads to an internship call; "Mapa do Brasil", which leads to "Unidades e escritórios"; "Selo comemorativo", which leads to the university's 60th anniversary site).
- **3.1.2**, 2: English text on Portuguese pages with no `lang`.
- **Pixel and probe rules**: 26 texts under their contrast minimum on gradients and images; 9 controls with no visible focus indicator and 3 focus indicators under 3:1; 3 links that focus leaves entirely under a search-suggestion panel which stays open in a fixed header; a hover panel (the gov.br bar's VLibras link) that closes before the pointer can reach it; a page that scrolls sideways at 320 px; a "GO" button under 4.5:1.

### A collector gap, not a finding

The martinsfontespaulista.com.br listing has 2,446 links and 1,612 form fields, most of them checkboxes of its filter sidebar (456 are in the part the collector read). The collector stopped at its budget of 5,000 elements, which the snapshot records (`truncated: true`), before it reached the products: 2.4.4 found 16 link candidates on the page, and axe-core, which reads the whole page, reported 223 violations. The report does not say the page was cut short; it says so only for shadow roots and frames. A long listing is the kind of page the first study lost to time-outs, and it is still only partly checked, now silently.

**Follow-up.** `rampa/link-color-only`, the text-field caret in `rampa/focus-visible` and `rampa/focus-indicator-contrast`, and this collector gap were then fixed from these dev patterns alone, with Rampa Lab's `rampa/placeholder-text` false positive; [the notes](notes-rules-dev-fixes.md) give what changed and its effect on the dev pages (the 12 false positives gone, no true positive lost). The test split was not used.

## Caveats

- **One run, a nondeterministic model.** Ollama ran at temperature 0, but the GPU was shared with other work and the prompts depend on what the collector saw when the page loaded. A second load of the same pages would not give exactly the same findings. The probe run is a second load, judged with the first load's cache where the prompts matched.
- **Judges kept apart by instruction only.** The two judges of a page were Claude agents on one machine and filesystem, told not to read each other's labels; nothing enforced it, and one judge did run a leftover script of another study (see Labels). Their packets held Rampa's own `confidence` and `patch`, which can anchor a label toward Rampa's answer.
- **LLM-judge labels, pending human review.** Every label comes from two Claude agents. They are a pre-annotation, not ground truth. The judges agree with each other much more than in the first study (kappa 0.92 against 0.69), possibly because of a more capable model or richer packets, but two agents of one model family make correlated mistakes, and high agreement is not accuracy. **The labels can be reviewed by a person in Rampa Lab's review mode** (<https://rampalab.guilhermebs.com.br/>): load `study/fresh-2026-10-11/data/findings.json` with `data/pages.json`, which show each finding with both judges' labels and rationales, and add the pages' `report.json` and recordings to see each element's HTML, crop and destination.
- **A small, hand-picked sample.** 24 pages, chosen by hand within strata, not at random from the web, and only from sites that let a headless browser in. Most counts per criterion and per check are small and their intervals wide. Findings on one page are correlated, and the Wilson intervals assume they are not: one page holds 11 of dev's 47 default-threshold findings, `rampa/css-reading-order`'s 19 findings are on one page, and `rampa/link-color-only`'s 10 on another.
- **The probes ran on 8 pages**, 65 decided findings; several probe rules have one or two findings.
- **Time is approximate.** The GPU and the machine were shared with other agents, and the probe run's judging reused cached answers, so its time is collection and probes, not the model.
- **What was not measured.** Recall (pages were not audited for what Rampa missed); the criteria Rampa judges only on request (1.3.1, 1.3.2, 1.3.3, 1.4.5, 2.5.3, 3.3.1); probe kinds outside `--probe all`; axe-core's own findings; other models, `--runs` voting or reasoning.
- **The pages change.** The judges looked at the live pages an hour or more after Rampa read them, and said so when it mattered. One page (www.tuasaude.com) was collected at `domcontentloaded` because it never reached `load`.
- **The test half's numbers have been seen.** Its false positives were not read for patterns, but its precision is now known. The next held-out measurement can use these test pages only if no change is chosen from them; fresh pages again would be better.

## Data and reproduction

All paths are under `study/fresh-2026-10-11/`.

- **Selection.** `scripts/candidates.tsv` (primaries and backups), `scripts/screen.mjs` and `data/screen-*.json` (the pre-screen), `scripts/links.mjs` (how inner pages were picked), `scripts/pages.tsv` (the 24 pages and why each was chosen), `scripts/split.py` and `data/pages-input.json` (the seeded split and the probe subset).
- **Collection.** `scripts/collect.sh main|probe`, `collect-log.txt`, `pages/<slug>/run-*-collect-*.json` and `*-collect-console*.txt`. `scripts/rename_dirs.py` moved the first page folders to short names, since the full addresses made paths too long for Windows.
- **Judgment.** `scripts/run-judged.sh default|probe`, `run-log.txt`, `pages/<slug>/report.json` (default run) and `probe-report.json` (probe run), with `console.txt`, `probe-console.txt` and `run-*-judged.json`.
- **Labels.** `scripts/packets.py` builds the evidence packets (`packets/<slug>.json` and `packets/<slug>--probe.json`); `judge-rubric.md`, `scripts/judge-prompt.txt` and `scripts/judge_prompt.py` give each judge's exact prompt; `labels/<packet>.auditor.json` and `.skeptic.json` hold both judges' labels and rationales; `scripts/check_labels.py` checks them against the packets.
- **Numbers.** `python -I study/fresh-2026-10-11/scripts/analyze.py` rebuilds `data/findings.json` (one row per labelled finding, with both labels), `data/pages.json` and `data/summary.json`; `scripts/tables.py` prints the tables above, and `scripts/dump_fp.py` lists a split's false positives with the judges' rationales.
- **Kept out of git.** The recordings (snapshots and engine results), screenshots, image crops and judgment caches, 178 MB. `data/recordings.json` has the size and SHA-256 of every recording file and screenshot. With a copy of `pages/<slug>/recording/`, the judgments can be run again offline: `rampa check pages/<slug>/recording/<name>.snapshot.json --model ollama:gemma4:12b --locale en --min-confidence low`, with `--offline` and the page's cache to read the same answers back.

## After the 2.4.4/2.4.6 change

After this study ran, 2.4.4 and 2.4.6 changed ([notes](notes-244-246.md), commits `d6ebe8a` and `ab2d4dc`): a model's fail on them is a finding only when a fact Rampa checks supports it (a generic text with no context of its own, a raw address, links that share a text and lead to different places, a numbered heading under no subject, a label several fields share); every other fail is the model's suggestion, reported in the report's `needsReview`, never as a finding, not even below the threshold; and when a criterion has more than 50 candidates, the cap judges first those a fact could ground. This section re-judges the study's saved snapshots with the code that includes the change and measures its effect on both halves.

**The change was not designed on either half of this study, so the test half measures it held out.** It was designed on the first study's dev split and the ACT test cases, and its notes list this study as not used. Its first commit (`d6ebe8a`, 18:54) came before any label of this study existed; the second (`ab2d4dc`, 20:53), which narrows when a generic link text is a finding, came while the judges were labelling (the first label files were written from 19:58) and before the labels were committed (`d188fdd`, 21:47). Its message cites only the first study's dev pages. This section does not read the test half's false positives for patterns either: it counts them and names the fact that made each one a finding.

**In short.** Counting every finding (`--min-confidence low`, what `rampa eval` and `--verbose` count), **precision on the test pages rose from 0.14 to 0.38** (14 of 37 decided, 95% Wilson 0.24–0.54) **and on the dev pages from 0.26 to 0.48** (21 of 44, 0.34–0.62), because nearly all the 2.4.4 and 2.4.6 claims that sat below the threshold are now suggestions. **At the default threshold, test went from 0.35 to 0.38** (12 of 32, 0.23–0.55) **and dev from 0.42 to 0.49** (20 of 41, 0.34–0.64): intervals that overlap widely, so no measurable change. The 2.4.4 and 2.4.6 findings went from 97 (1 true positive, 86 false positives, 10 uncertain; 9 of them at the default threshold) to 13, all at the default threshold: **5 true positives and 8 false positives** (on test, 3 of 11: 0.27, 0.10–0.57). The one true failure the study had among them, a link named "0", is now a suggestion: lost as a finding, still shown for review. The 5 new true positives are links that share a text and lead to different places, which the study never judged because they were past the cap. The suggestions are as wrong as the claims they replace: of the 80 in the new run, 75 sit on a finding the study labelled, and 1 of those is a true failure.

### Method

- **Code and input.** `main` at `4fd54fc`, which includes the change, built with `pnpm install --frozen-lockfile` and `pnpm build`. The same 24 saved snapshots, checked against `data/recordings.json` (all 48 recording files matched their SHA-256); nothing was loaded live.
- **Same flags,** plus `--concurrency 2` because the GPU was shared with a benchmark run (the number of parallel calls changes no prompt). Pages ran one at a time on 2026-10-11 from 21:51 to 22:48 (UTC−3), with Gemma 4 12B on Ollama 0.40.2 (same digest, `6114515d63c1`). No page reached the time limit and no call failed.
- **The study's judgments reused.** Each page's judgment cache started as a copy of the study's: every prompt of the other six criteria was read back (354 answers, no new call). 2.4.4 and 2.4.6 have new versions (3 and 4), which are part of the cache key, so all their 1,578 judged candidates were asked again.
- **Two runs.** *After, asked again* (`scripts/run-after.sh`) is what the code does today. *After, the study's answers replayed* (`scripts/run-replay.sh`) holds the model fixed: a model on a shared GPU does not always give the same answer twice, so the first run mixes the change with the model's variation. The replay patches a copy of the build back to the old versions (whose prompts are the same) and runs `--offline` with the study's cache; the 14 candidates with no answer there, which the new order brought into the cap, stay unjudged.
- **Matching and labels.** Each finding was matched to a labelled finding of the study's run on the same page, by fingerprint, else by criterion, element and claim, and reused the study's two labels (`scripts/after.py match`); every matched finding kept the study's claim word for word. **9 findings matched nothing**, all in the run asked again: 2 on a dev page and 7 on three test pages. As in the study, each page with new findings got two Claude judges, an auditor and a skeptic told not to read each other's work (8 judges), with the same rubric, the same prompt (`scripts/judge_prompt.py`) and the same packet format (`packets/<slug>--after.json`; labels in `labels/<slug>--after.*.json`). **They gave the same label to all 9** (Cohen's kappa 1.00); on why the 4 false positives were wrong they agreed for one page and not the other.
- **Suggestions** are the `needsReview` items that name a model, counted per page. Each is matched by criterion and element to a finding the study labelled, to count its label. They are not findings and are in no precision below.

### Precision before and after

The eight judged criteria; each cell is true positives / false positives / uncertain, then precision and its 95% Wilson interval.

| Run | Dev, default threshold | Dev, all findings | Test, default threshold | Test, all findings |
| --- | --- | --- | --- | --- |
| Before (the study, `ebd4d07`) | 18 / 25 / 4: **0.42** (0.28–0.57) | 20 / 56 / 6: **0.26** (0.18–0.37) | 9 / 17 / 0: **0.35** (0.19–0.54) | 11 / 68 / 9: **0.14** (0.08–0.23) |
| After, asked again (`4fd54fc`) | 20 / 21 / 4: **0.49** (0.34–0.64) | 21 / 23 / 4: **0.48** (0.34–0.62) | 12 / 20 / 0: **0.38** (0.23–0.55) | 14 / 23 / 1: **0.38** (0.24–0.54) |
| After, the study's answers replayed | 18 / 21 / 4: **0.46** (0.32–0.61) | 19 / 23 / 4: **0.45** (0.31–0.60) | 9 / 17 / 0: **0.35** (0.19–0.54) | 11 / 20 / 1: **0.35** (0.21–0.53) |

Both halves together, after: 0.44 at the default threshold (32 of 73, 0.33–0.55) and 0.43 with all findings (35 of 81, 0.33–0.54), against 0.39 and 0.20 before. 1.1.1, 1.3.5, 2.4.2, 3.1.2 and 3.3.2 are unchanged finding for finding (their answers came from the cache), and so are the experimental rules. Only 2.4.4 and 2.4.6 moved:

| 2.4.4 and 2.4.6 | Dev, default threshold | Dev, all findings | Test, default threshold | Test, all findings |
| --- | --- | --- | --- | --- |
| Before | 0 / 4 / 0: **0.00** (0.00–0.49) | 1 / 33 / 2: **0.03** (0.01–0.15) | 0 / 5 / 0: **0.00** (0.00–0.43) | 0 / 53 / 8: **0.00** (0.00–0.07) |
| After, asked again | 2 / 0 / 0: **1.00** (0.34–1.00) | 2 / 0 / 0: **1.00** (0.34–1.00) | 3 / 8 / 0: **0.27** (0.10–0.57) | 3 / 8 / 0: **0.27** (0.10–0.57) |
| After, the study's answers replayed | – | – | 0 / 5 / 0: **0.00** (0.00–0.43) | 0 / 5 / 0: **0.00** (0.00–0.43) |

By criterion, after asking again: on test, 2.4.4 3 / 4 / 0 (0.43, 0.16–0.75) and 2.4.6 0 / 4 / 0; on dev, 2.4.4 2 / 0 / 0 and no 2.4.6 finding. Every one of these findings carries the model's "high", so the default threshold and all findings are the same.

Fewer findings reach a person: counting every judged finding, about 4 a page on dev and 3 on test, against about 7 before; at the default threshold, 45 on dev (47 before) and 32 on test (26 before). The suggestions add a median of 2 a page on dev and 3.5 on test.

### What happened to the study's 2.4.4 and 2.4.6 findings

The study's 97 labelled findings of these criteria, and what the run asked again did with each. In parentheses, their labels (TP / FP / uncertain).

| Split | Criterion | The study's findings | Still a finding | Now a suggestion | Discarded by verification | The new call passed it | Past the cap now |
| --- | --- | --- | --- | --- | --- | --- | --- |
| dev | 2.4.4 | 20 (1 / 18 / 1) | – | 13 (1 TP, 12 FP) | 2 (1 FP, 1 unc.) | 1 (1 FP) | 4 (4 FP) |
| dev | 2.4.6 | 16 (0 / 15 / 1) | – | 14 (13 FP, 1 unc.) | – | 2 (2 FP) | – |
| test | 2.4.4 | 43 (0 / 40 / 3) | 2 (2 FP), default threshold | 36 (34 FP, 2 unc.) | 2 (1 FP, 1 unc.) | 2 (2 FP) | 1 (1 FP) |
| test | 2.4.6 | 18 (0 / 13 / 5) | 2 (2 FP), default threshold | 12 (7 FP, 5 unc.) | 1 (1 FP) | 3 (3 FP) | – |

With the study's answers replayed, the "discarded" and "passed" columns are empty: 87 of the 97 are suggestions, 5 are still findings (all false positives, on test) and 5 are past the cap. Those two columns are the model's own variation: of the 1,564 candidates both runs judged, the new call gave the study's verdict for 98.5% (12 fails became passes and 12 passes became fails).

- **True failures kept or lost.** The study had one true positive among these findings: dev's martinsfontespaulista.com.br cart link named "0", below the threshold. In both runs it is now a suggestion: no checked fact grounds it ("0" is on no generic list), so it is lost as a finding but kept for review. No uncertain finding is still a finding.
- **True failures gained.** The run asked again found 5 true positives, all of the "links that share a text and lead to different places" fact: dev's poder360.com.br "INSCREVA-SE" pair and test's tuasaude.com share links (Facebook, WhatsApp and Pinterest, each named only "compartilhe"). In the study these candidates were past the cap of 50 and never judged; the new order brought them in. On these pages the change found real failures through what it judges first, not by reading old answers differently.
- **False positives still shown, test.** 8, all at "high": 2 links whose text is an address with a path (the study already showed them); 4 labels on one page grounded by the shared-label fact (2 were below the threshold in the study, whose third such finding the new call lost to verification; the other 2 are fields with the same label whose fail the study's verification had discarded); and 2 links on one page grounded by the shared-text fact, which the study never judged. The judges' reasons are in the labels and are not summarised here.
- **False positives gone from the default threshold.** On test, 3 of the study's 5 shown 2.4.4 false positives (2 now suggestions, 1 past the cap). On dev, all 4 shown "Learn more" links on ikea.com are past the cap now: with a context of their own they are no longer judged first. With the answers held fixed, those 4 are all of dev's change at the default threshold (0.42 to 0.46).

### Suggestions per page

The run asked again, with the replay's count for comparison. "Labelled" counts the suggestions that sit on a finding the study labelled, by its label.

| Split | Page | Suggestions (2.4.4 + 2.4.6) | Labelled: TP / FP / uncertain | Not labelled | Replay |
| --- | --- | ---: | --- | ---: | ---: |
| dev | berkeley.edu/admissions | 3 (3 + 0) | 0 / 3 / 0 | 0 | 4 |
| dev | www.ce.gov.br | 0 | – | 0 | 0 |
| dev | fiocruz.br | 1 (1 + 0) | 0 / 1 / 0 | 0 | 1 |
| dev | ikea.com (listing) | 1 (1 + 0) | 0 / 1 / 0 | 0 | 1 |
| dev | martinsfontespaulista.com.br (listing) | 1 (1 + 0) | 1 / 0 / 0 | 0 | 2 |
| dev | medlineplus.gov/diabetes | 3 (1 + 2) | 0 / 2 / 0 | 1 | 2 |
| dev | www.ons.gov.uk | 3 (3 + 0) | 0 / 3 / 0 | 0 | 3 |
| dev | pinacoteca.org.br | 3 (2 + 1) | 0 / 2 / 0 | 1 | 2 |
| dev | www.poder360.com.br | 9 (0 + 9) | 0 / 9 / 0 | 0 | 10 |
| dev | propublica.org (article) | 2 (0 + 2) | 0 / 2 / 0 | 0 | 3 |
| dev | rijksmuseum.nl (newsletter form) | 2 (1 + 1) | 0 / 1 / 1 | 0 | 2 |
| dev | www.unicamp.br | 1 (1 + 0) | 0 / 1 / 0 | 0 | 2 |
| test | apublica.org (article) | 12 (10 + 2) | 0 / 10 / 0 | 2 | 13 |
| test | www.bl.uk | 3 (2 + 1) | 0 / 2 / 1 | 0 | 3 |
| test | www.cdc.gov | 2 (2 + 0) | 0 / 1 / 1 | 0 | 3 |
| test | chicorei.com | 4 (3 + 1) | 0 / 4 / 0 | 0 | 5 |
| test | www.fuvest.br (information page) | 7 (3 + 4) | 0 / 5 / 2 | 0 | 8 |
| test | metro.sp.gov.br/fale-conosco | 2 (1 + 1) | 0 / 1 / 1 | 0 | 3 |
| test | senado.leg.br/falecomosenado | 7 (7 + 0) | 0 / 7 / 0 | 0 | 7 |
| test | www.tcd.ie | 1 (1 + 0) | 0 / 1 / 0 | 0 | 1 |
| test | theguardian.com/international | 4 (2 + 2) | 0 / 2 / 1 | 1 | 3 |
| test | www.thomann.co.uk | 3 (1 + 2) | 0 / 2 / 1 | 0 | 3 |
| test | tuasaude.com/dengue | 0 | – | 0 | 0 |
| test | tools.usps.com (form) | 6 (6 + 0) | 0 / 6 / 0 | 0 | 6 |
| **dev** | 12 pages | **29** (14 + 15), median 2, at most 9 | 1 / 25 / 1 | 2 | 32 |
| **test** | 12 pages | **51** (38 + 13), median 3.5, at most 12 | 0 / 41 / 7 | 3 | 55 |

The 5 suggestions not labelled sit on elements the study's run did not report (they come from the new call), and were not labelled: suggestions are not findings. As the notes expected, what moved to review is mostly the model's misreading: 1 true failure in the 67 decided.

### Caveats of this re-measure

- **Small and clustered.** The 13 findings of 2.4.4 and 2.4.6 sit on 5 pages and come in sets (a pair, a trio, two links, four labels); the 5 true positives are two link sets. The Wilson intervals treat findings as independent, and these are not.
- **The change has three parts**: reclassifying fails, the facts that ground them, and the order of the cap. The new true positives come from the cap order; on a page with fewer than 50 link candidates the study would have judged them too. The replay shows the reclassification alone: it leaves test's default threshold where it was (9 of 26), though not with the same findings.
- **One new run, on a shared GPU.** Its 2.4.4 and 2.4.6 answers differ from the study's on 1.5% of candidates, which moves a few findings either way. The replay is the measure without that variation, but it cannot judge candidates the study never asked.
- **Labels reused by element.** A matched finding keeps the study's labels; every matched claim was the same word for word, so no label was carried to a different claim. A suggestion's label is that of the study's finding on the same element and criterion.
- **Labels from Claude agents.** The 9 new labels come from two Claude judges, like the study's, kept apart by instruction only and shown Rampa's `confidence` and `patch`. Their full agreement is consistency, not accuracy, and every label still awaits review by a person.
- **The test half has now been used twice.** No change was chosen from it, here or in the notes, but its numbers have been seen; the next held-out measurement should use fresh pages.
- **Not measured here:** the ACT test cases (the notes measure them), other models, and the probe run, which was not repeated.

### Data and reproduction

All paths are under `study/fresh-2026-10-11/`; run from the repository root after `pnpm build`.

- `bash scripts/run-after.sh` judges each snapshot again: `pages/<slug>/after-report.json`, `after-console.txt`, `run-after-judged.json`, `after-run-log.txt`.
- `bash scripts/run-replay.sh` builds the patched copy in `.rampa/dist-replay` and reads each snapshot offline with the study's answers: `pages/<slug>/replay-report.json`, `replay-console.txt`, `replay-run-log.txt`.
- `bash scripts/run-fates.sh after|replay` (`scripts/fates.ts`): every 2.4.4 and 2.4.6 candidate's fate, with the model's answer, in `data/after/fates/` and `data/after/fates-replay/`.
- `python -I scripts/after.py match` matches findings to the study's labels (`data/after/matches.json`) and writes the packets of the unmatched ones; once the judges have labelled them, `python -I scripts/after.py analyze` writes `data/after/findings.json` and `data/after/summary.json` and prints the tables above.
- **Kept out of git:** the two runs' judgment caches (`pages/<slug>/cache-after/`, `cache-replay/`) and the patched build.

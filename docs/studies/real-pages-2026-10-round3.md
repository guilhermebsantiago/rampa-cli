# Held-out pages: a third real-page study (October 2026)

The [second real-page study](real-pages-2026-10-fresh.md) measured Rampa on 24 fresh pages and listed, from its dev half only, the false positives worth fixing. Five changes followed. Four were chosen from that dev half: facts that refute 1.1.1 claims ([notes](notes-111-dev-fixes.md)), `rampa/link-color-only` comparing a link with the text around it, a text field's caret counted as its focus indicator, and a shorter list for `rampa/placeholder-text` ([notes](notes-rules-dev-fixes.md)). The fifth, the rule that a 2.4.4 or 2.4.6 fail is a finding only when a checked fact supports it, was designed on the first study and measured only on the second study's saved snapshots. On the pages they were chosen from, the fixes looked large: 1.1.1 went from 0.27 to 0.70, and the dev half's judged findings from 0.49 to 0.80. This study runs the code as it is now, at `d23cfb5`, on 24 pages none of those changes has seen, with the second study's method, rubric, scripts and two-judge labels.

**In short.** With Gemma 4 12B, at the default threshold (what `rampa check` shows and fails on), **0.43 of the judged findings on the dev pages were real failures (16 of 37 decided, 95% Wilson 0.29–0.59) and 0.24 on the test pages (24 of 99, 0.17–0.34)**. Counting the findings below the threshold too, 0.42 and 0.24. The second study, judged again after the 2.4.4/2.4.6 change, had 0.49 and 0.38 at the default threshold and 0.48 and 0.38 with every finding counted. **So the fixes made no measurable difference on pages they were not tuned on, and the test half came out lower.** Most of that drop is one page: 50 of the test half's 103 default-threshold findings are 2.4.4 links on one university home page, and both judges called all 50 false positives; without that page the test half is 0.49 (24 of 49, 0.36–0.63). 1.1.1, the target of the largest fix, was right 0.26 of the time on dev and 0.50 on test, against 0.27 and 0.40 before it: the gain to 0.70 measured on the second study's dev pages did not appear here. 1.3.5 was right 8 times out of 8. The experimental rules were right 0.92 of the time on dev and 0.44 on test, where 15 of their 23 false positives sit on one page. The probes, run on 7 pages, were right 116 times out of 121 (0.96 on both halves, against 0.62 and 0.76 in the second study), but three of the five fixes were hardly exercised: `rampa/link-color-only` and `rampa/placeholder-text` reported nothing, and the caret rule left out one text field. All labels come from Claude agents, not people, and the run is a single run.

**Future tuning may use the dev split only.** The test half's false positives were counted, not read, and are listed below by check and cause only. Only the dev half's may be studied to change Rampa.

## Question and pre-registration

When Rampa reports a failure on a page it has never seen, how often is the failure real, now that the second study's dev-split fixes are in? The question is about precision only, per criterion and per check, at the default threshold and with every finding counted. Pages were not audited for what Rampa missed.

The pages, the seeded split and the method were committed before Rampa ran on any of them: [`38aa28c`](../../study/round-3-2026-10-23/preregistration.md), 2026-10-23 11:00:09 (UTC−3); the first collection started 8 seconds later. Only the pre-screen in headless Edge and the link listing used to pick inner pages had loaded the pages before that. The pre-registration names the outcomes (precision with Wilson intervals, dev and test apart, both thresholds, judged criteria overall and per criterion, experimental rules, probes; Cohen's kappa), the comparison (the second study after the 2.4.4/2.4.6 change: test 0.38 and 0.38, dev 0.49 and 0.48) and the rule that the test half is counted, not read. It sets no threshold for success. What changed after it is listed under "Differences".

## Pages

**Exclusions.** No registrable domain of the first study, its re-measure or the second study, and none that any file or commit message of the repository names, on any of its six branches: 1,785 domains, by the Public Suffix List's rule, so `metro.sp.gov.br` and `www.mg.gov.br` are separate sites (`scripts/exclusions.py`, `data/excluded-domains.json`). A second check flagged domains that share a name with an excluded one across suffixes; one backup was flagged and not used. Four first candidates were excluded this way (stanford.edu, nih.gov, heart.org and si.edu are named in the repository) and replaced before the screen.

**Design.** The second study's: twelve strata, Brazil or international, times government, education, news, e-commerce, health, and culture or public services; in each, a home page and an inner page from two different sites. Brazilian pages are in Portuguese, the others in English (United Kingdom, United States, Ireland, Canada).

**Selection.** A primary and two backups per slot were written down before the screen (`scripts/candidates.tsv`), and each was loaded once in headless Edge (`scripts/screen.mjs`, `data/screen-*.json`). The connection dropped during the first screen; the 48 candidates that failed with a network error were screened again. A backup replaced its primary only when the primary failed: the government home slot took canada.ca (nyc.gov answered "Access Denied"), and the international e-commerce home slot took its fourth backup, shop.pimoroni.com, after Waterstones, Bookshop.org, LEGO and Blackwell's showed a Cloudflare challenge and the slot's partner's backups failed too (the last three backups were added after the first two screens, before any Rampa run). Inner pages were picked from each site's navigation (`scripts/links.mjs`): the first article on a news home page, the first category of a store's menu, a contact page or form, an admissions page. Sites that turn headless browsers away are missing by construction. `scripts/pages.tsv` says why each page was chosen.

**Split.** At random, with a recorded seed: in each stratum a seeded coin (Python `random.Random(20261023)`) sends the home or the inner page to dev and the other to test; the same generator then drew the 8 pages of the probe run, two Brazilian and two international from each half (`scripts/split.py`, `data/pages-input.json`). One probe page, kcl.ac.uk, had to leave the probe run (below), so 7 were probed.

| Split | Page | Category | Country | Language | Type | Probes |
| --- | --- | --- | --- | --- | --- | :---: |
| dev | https://museudoipiranga.org.br/ | culture | BR | pt-BR | home | yes |
| dev | https://www.travessa.com.br/ | e-commerce | BR | pt-BR | home | |
| dev | https://www.puc-rio.br/vestibular/ | education | BR | pt-BR | info | |
| dev | https://www.cnj.jus.br/ouvidoria-cnj/ | government | BR | pt-BR | contact | |
| dev | https://www.hcor.com.br/ | health | BR | pt-BR | home | yes |
| dev | https://www.metropoles.com/ | news | BR | pt-BR | home | |
| dev | https://www.tate.org.uk/about-us/contact-us | culture | UK | en | contact | |
| dev | https://www.halfords.com/motoring/ | e-commerce | UK | en | listing | |
| dev | https://www.kcl.ac.uk/study/undergraduate | education | UK | en | info | drawn, dropped |
| dev | https://www.canada.ca/en.html | government | CA | en | home | |
| dev | https://my.clevelandclinic.org/ | health | US | en | home | |
| dev | https://www.pbs.org/newshour/show/doj-monitoring-plans-and-dhs-voter-checks-raise-concerns-of-election-interference | news | US | en | article | yes |
| test | https://www.itaucultural.org.br/contato | culture | BR | pt-BR | contact | |
| test | https://www.kalunga.com.br/depto/apresentacao/17 | e-commerce | BR | pt-BR | listing | |
| test | https://www.ufpe.br/ | education | BR | pt-BR | home | |
| test | https://www.mg.gov.br/ | government | BR | pt-BR | home | |
| test | https://www.fleury.com.br/noticias/a-sua-saude-mental-importa | health | BR | pt-BR | article | yes |
| test | https://www.correiobraziliense.com.br/politica/2026/10/7526242-real-time-flavio-bolsonaro-tem-52-e-lula-48-a-dois-dias-do-2-turno.html | news | BR | pt-BR | article | yes |
| test | https://www.vam.ac.uk/ | culture | UK | en | home | |
| test | https://shop.pimoroni.com/ | e-commerce | UK | en | home | |
| test | https://www.ed.ac.uk/ | education | UK | en | home | |
| test | https://www.nps.gov/findapark/index.htm | government | US | en | form | yes |
| test | https://www.cancerresearchuk.org/about-cancer/acute-lymphoblastic-leukaemia-all | health | UK | en | article | |
| test | https://www.irishtimes.com/ | news | IE | en | home | yes |

## Method

### The same as the second study

- **Collection, no model call.** `rampa check <url> --model ollama:gemma4:12b --offline --locale en --min-confidence low --save <dir>`, with Edge 155 through playwright-core (`scripts/collect.sh main`), on 2026-10-23 from 11:00 to 11:10. Naming the model makes the collector capture images for 1.1.1 and read where links lead for 2.4.4; `--offline` keeps it from calling the model.
- **Judgment on the saved snapshot.** `rampa check <snapshot> --model ollama:gemma4:12b --locale en --min-confidence low --time-limit 900` (`scripts/run-judged.sh default`): the eight default criteria, at most 50 candidates per criterion, one run, every finding listed. Pages one at a time, 11:37 to 13:07. No page reached the time limit and no report lists an error.
- **Probes.** The probe subset collected live again with `--probe all` (layout, keyboard, hover, orientation, shortcuts, media, color, states; the same kinds as the second study), judged with a copy of the page's judgment cache. Only what the probe run adds was labelled: probe findings and judgments of criteria the default run does not judge.
- **Model.** Gemma 4 12B (`gemma4:12b`, Q4_K_M, digest `6114515d63c1`, the second study's), reasoning off, temperature 0, on a local GPU that other work was using too.
- **Labels.** Every judgment and rule finding of the default run and every probe finding of the probe run, at any confidence: 366 findings. Engine (axe-core) findings, 3,837 of them (3,315 on one page), were not labelled. Two Claude agents per packet, an auditor and a skeptic, each told not to read the other's work; the rubric, prompt and packet format of the second study (`judge-rubric.md`, `scripts/judge-prompt.txt`, `scripts/judge_prompt.py`, `scripts/packets.py`). Final label: the label both gave, else `uncertain`; a false positive's cause is the one both named, else `disputed`. Precision is TP / (TP + FP) with uncertain findings left out; 95% Wilson intervals; Cohen's kappa over the three labels. The analysis is the second study's `analyze.py` and `tables.py`.

### Differences from the second study

1. **Code and runtime.** `main` at `d23cfb5` (rampa-cli 0.1.1), against `ebd4d07` for the study and `4fd54fc` for its re-judged run. Between `4fd54fc` and `d23cfb5`, 28 commits touch `src/`: the five fixes above, and others (the cognitive profile, which is off by default; a check that a pass quoting the page quotes it right; SVG documents; escaped tag names in refs; an exit code of 2 when nothing could be judged). Ollama 0.40.3 (0.40.2 in the second study). The collection runs now exit 2 (judgment asked for, nothing judged offline) where they exited 1; the snapshot is saved either way.
2. **`--concurrency 2` when judging**, because the GPU could be shared. The second study's main run used the default of 4 (its re-judged run used 2). The number of parallel calls changes no prompt.
3. **Packets without Rampa's `confidence` and `patch`.** An audit of the second study named them as an anchor toward Rampa's answer, so the judges saw only the finding's criterion, message, evidence and subject, with the element and its context; the rubric says so. `data/findings-raw.json` keeps both for the analysis. The judge prompt also names the pages' reports and logs, other checkouts and worktrees of the repository, and the folder of study backups (which holds the second study's labels) as off limits.
4. **A one-line reply.** Of the first four judges, three answered with a description of their labels instead of the one line asked for; two of them were the judges of mg.gov.br, a test page, so the person running the study read that page's two labels. From the fifth judge on, the prompt's last line asks for the count only and says why, and every later judge complied. Those two test findings were not used for anything.
5. **`scripts/dump_fp.py` prints only counts for the test split**, so the test half could not be read by mistake; the dev half is printed in full, as before.
6. **Exclusion by registrable domain**, with the Public Suffix List, of every host named anywhere in the repository on any branch, where the second study excluded the hosts its authors found named.
7. **Suggestions counted.** The 2.4.4 and 2.4.6 claims that no fact supports are review items, not findings; they are counted per page (as the second study's re-judged run did), not labelled.
8. **Judge agents.** 67 agents (Claude Opus 5.5, the model of the session that ran the study) for 58 label files: two per packet, plus 9 launched again (below). From 19:45 at most two ran at a time.

### What went wrong, and what was done

- **The connection dropped several times** in the morning. The main collection was not hit (no network error in any of its logs), but the probe collection was: 13, 25, 15, 4 and 1 of the 26 probe checks failed with `ERR_INTERNET_DISCONNECTED` or `ERR_NETWORK_CHANGED` on hcor.com.br, museudoipiranga.org.br, nps.gov, pbs.org and irishtimes.com. As the second study did with its connection drop, those five probe runs were set aside (`pages/<slug>/discarded-network/`) and collected again, with the same command, from 19:14 to 19:50; only correio and fleury.com.br kept their morning probe runs (11:11 and 11:20). museudoipiranga.org.br did not reach `load` within 30 s twice in the evening and was collected with `--timeout 60000`, the only non-default option of the study. In the new runs, 4 checks of nps.gov (the color probe) and 1 of pbs.org (reflow) did not reach `load` on the probe's own reload; they are kept as Rampa reported them.
- **kcl.ac.uk limits repeated loads.** After the screen, the link listing and a second screen, its first main collection attempt exited with Node's internal assertion `assert(!this.paused)` and the second recorded the page "Rate limit exceeded. Please wait 10 minutes before retrying." Both were set aside and the page was collected again at 11:35, in full. Its probe run then recorded the rate-limit page twice (at 11:37 as its snapshot; at 11:52 on the probes' own reloads, each of which saw one element), and twice more exited with the same assertion (19:33). **kcl.ac.uk left the probe run**, so the probe run has 7 pages: 3 dev and 4 test. Its default run stands; it gave no finding to label.
- **The PC was shut down** at about 13:30, and from 13:27 the judges still running had stopped on an API session limit. No label file was half-written: 27 were complete and valid, and the 9 judges that had written nothing (one judge of itaucultural.org.br, both of ed.ac.uk, irishtimes.com, pbs.org and pimoroni.com) were launched again from scratch at 19:10 with the same prompt, after their helper files were moved out of the packet folders. Every one of the probe packets was labelled after the re-collection.
- **Truncated pages.** ufpe.br and halfords.com were cut at the collector's 5,000 elements, and both reports now say so (the second study's dev fix).

## Results

All 24 pages were judged. They produced 143 findings from the judged criteria (141 at the default threshold), 82 from experimental rules and judgments, and 141 from probes on the 6 probed pages that had any (irishtimes.com had none).

### The judged criteria

Each cell is true positives / false positives / uncertain, then precision and its 95% Wilson interval.

| Criterion | Dev, default threshold | Dev, all findings | Test, default threshold | Test, all findings |
| --- | --- | --- | --- | --- |
| 1.1.1 Non-text Content | 7 / 20 / 0: **0.26** (0.13–0.45) | 7 / 20 / 0: **0.26** (0.13–0.45) | 18 / 18 / 2: **0.50** (0.34–0.66) | 18 / 18 / 2: **0.50** (0.34–0.66) |
| 1.3.5 Identify Input Purpose | 7 / 0 / 0: **1.00** (0.65–1.00) | 7 / 0 / 0: **1.00** (0.65–1.00) | 1 / 0 / 0: **1.00** (0.21–1.00) | 1 / 0 / 0: **1.00** (0.21–1.00) |
| 2.4.2 Page Titled | – | 0 / 1 / 0: **0.00** (0.00–0.79) | – | – |
| 2.4.4 Link Purpose (In Context) | 2 / 1 / 1: **0.67** (0.21–0.94) | 2 / 1 / 1: **0.67** (0.21–0.94) | 5 / 54 / 2: **0.09** (0.04–0.18) | 5 / 54 / 2: **0.09** (0.04–0.18) |
| 2.4.6 Headings and Labels | – | – | 0 / 2 / 0: **0.00** (0.00–0.66) | 0 / 2 / 0: **0.00** (0.00–0.66) |
| 3.1.2 Language of Parts | – | – | – | 0 / 0 / 1: **–** |
| 3.3.2 Labels or Instructions | – | – | 0 / 1 / 0: **0.00** (0.00–0.79) | 0 / 1 / 0: **0.00** (0.00–0.79) |
| **All** | 16 / 21 / 1: **0.43** (0.29–0.59) | 16 / 22 / 1: **0.42** (0.28–0.58) | 24 / 75 / 4: **0.24** (0.17–0.34) | 24 / 75 / 5: **0.24** (0.17–0.34) |

Both halves together: **0.29 at the default threshold** (40 of 136, 0.22–0.38) and 0.29 with all findings (40 of 137, 0.22–0.37). 3.1.1 judged 24 pages and failed none.

- **Nearly every judged finding is now at the default threshold** (141 of 143): the claims that used to sit below it are suggestions, so the two thresholds give the same numbers.
- **1.3.5 is still the one judged criterion that is reliably right**: 8 of 8, newsletter and contact fields with no `autocomplete` or with `autocomplete="off"`.
- **1.1.1 is right a quarter of the time on dev and half the time on test**, all at the default threshold.
- **2.4.4 has 65 findings, all with the model's "high"**: 4 on one dev page (2 true, 1 false, 1 uncertain) and 61 on four test pages, of which 50 on one page. On that page the cap judged 50 of 1,646 link candidates, the ones a fact could ground first, and all 50 became findings; both judges called all 50 false positives. Without it, test 2.4.4 is 5 / 4 / 2.
- **2.4.6, 2.4.2 and 3.3.2 had 4 findings in all, none right.**

**Sensitivity.** Without the page with the most default-threshold findings, dev is 12 of 28 (0.43, 0.27–0.61; without cnj.jus.br, 10 findings) and test 24 of 49 (0.49, 0.36–0.63; without ufpe.br, 50 findings). Counting every uncertain finding as a true positive, the default threshold reads 0.45 on dev and 0.27 on test; counting them all as false positives, 0.42 and 0.23.

### Against the second study

Same rubric and two-judge method, same model; different pages and code.

| Run | Dev, default threshold | Dev, all findings | Test, default threshold | Test, all findings |
| --- | --- | --- | --- | --- |
| Second study (`ebd4d07`) | 18 / 25 / 4: **0.42** (0.28–0.57) | 20 / 56 / 6: **0.26** (0.18–0.37) | 9 / 17 / 0: **0.35** (0.19–0.54) | 11 / 68 / 9: **0.14** (0.08–0.23) |
| Second study after the 2.4.4/2.4.6 change (`4fd54fc`) | 20 / 21 / 4: **0.49** (0.34–0.64) | 21 / 23 / 4: **0.48** (0.34–0.62) | 12 / 20 / 0: **0.38** (0.23–0.55) | 14 / 23 / 1: **0.38** (0.24–0.54) |
| The second study's dev half with the 1.1.1 facts ([notes](notes-111-dev-fixes.md), tuned there) | 20 / 5 / 3: 0.80 (0.61–0.91) | 21 / 7 / 3: 0.75 (0.57–0.87) | – | – |
| **This study (`d23cfb5`)** | 16 / 21 / 1: **0.43** (0.29–0.59) | 16 / 22 / 1: **0.42** (0.28–0.58) | 24 / 75 / 4: **0.24** (0.17–0.34) | 24 / 75 / 5: **0.24** (0.17–0.34) |

On the dev half the intervals overlap almost entirely: no measurable change. On the test half the point estimate fell from 0.38 to 0.24; the intervals overlap (0.23–0.55 and 0.17–0.34), and the fall is the one page of 50 link findings. The 0.80 that the 1.1.1 facts reached on the pages they were tuned on did not carry over.

By criterion, the second study after the change, then this study:

| Criterion | Dev before | Dev now | Test before | Test now |
| --- | --- | --- | --- | --- |
| 1.1.1 | 7 / 19 / 4: 0.27 (0.14–0.46) | 7 / 20 / 0: **0.26** (0.13–0.45) | 8 / 12 / 0: 0.40 (0.22–0.61) | 18 / 18 / 2: **0.50** (0.34–0.66) |
| 1.3.5 | 10 / 0 / 0: 1.00 (0.72–1.00) | 7 / 0 / 0: **1.00** (0.65–1.00) | 1 / 0 / 0: 1.00 (0.21–1.00) | 1 / 0 / 0: **1.00** (0.21–1.00) |
| 2.4.4 | 2 / 0 / 0: 1.00 (0.34–1.00) | 2 / 1 / 1: **0.67** (0.21–0.94) | 3 / 4 / 0: 0.43 (0.16–0.75) | 5 / 54 / 2: **0.09** (0.04–0.18) |
| 2.4.6 | – | – | 0 / 4 / 0: 0.00 (0.00–0.49) | 0 / 2 / 0: **0.00** (0.00–0.66) |
| 2.4.2 (all findings) | 0 / 2 / 0 | 0 / 1 / 0 | 0 / 2 / 0 | – |
| 3.1.2 (all findings) | 2 / 0 / 0 | – | 2 / 1 / 1 | 0 / 0 / 1 |
| 3.3.2 | 0 / 2 / 0 | – | – | 0 / 1 / 0 |

The 1.1.1 and 1.3.5 rows are at the default threshold, where all their findings are.

### Experimental rules and judgments

Rampa's own rules (all experimental) and the experimental 1.1.1 question about images hidden from assistive technology; all report below the default threshold. The second study's numbers come from its own run (these checks were not re-run after the 2.4.4/2.4.6 change).

| Check | Dev | Test | Both | Second study, both |
| --- | --- | --- | --- | --- |
| `rampa/pixel-contrast` (1.4.3) | 7 / 0 / 0: **1.00** (0.65–1.00) | 14 / 13 / 0: **0.52** (0.34–0.69) | 21 / 13 / 0: **0.62** (0.45–0.76) | 60 / 0 / 2: 1.00 |
| `rampa/icon-contrast` (1.4.11) | 11 / 1 / 0: **0.92** (0.65–0.98) | 2 / 3 / 1: **0.40** (0.12–0.77) | 13 / 4 / 1: **0.77** (0.53–0.90) | 2 / 1 / 2: 0.67 |
| `rampa/placeholder-alt` (1.1.1) | 11 / 1 / 0: **0.92** (0.65–0.98) | – | 11 / 1 / 0: **0.92** (0.65–0.98) | 4 / 0 / 0: 1.00 |
| `rampa/placeholder-contrast` (1.4.3) | 3 / 0 / 0: **1.00** (0.44–1.00) | 2 / 2 / 0: **0.50** (0.15–0.85) | 5 / 2 / 0: **0.71** (0.36–0.92) | 6 / 0 / 0: 1.00 |
| `rampa/widget-name` (4.1.2) | 3 / 0 / 1: **1.00** (0.44–1.00) | 0 / 0 / 1: **–** | 3 / 0 / 2: **1.00** (0.44–1.00) | 3 / 0 / 0: 1.00 |
| Hidden images, judgment (1.1.1, ACT e88epe) | 0 / 1 / 0: **0.00** (0.00–0.79) | 0 / 5 / 0: **0.00** (0.00–0.43) | 0 / 6 / 0: **0.00** (0.00–0.39) | 2 / 3 / 0: 0.40 |
| **All** | 35 / 3 / 1: **0.92** (0.79–0.97) | 18 / 23 / 2: **0.44** (0.30–0.59) | 53 / 26 / 3: **0.67** (0.56–0.76) | 87 / 23 / 5: 0.79 |

- **`rampa/pixel-contrast` has its first false positives**: 13, all on one test page, all with the cause `collector_error` from both judges. It was 7 of 7 on dev, and 60 of 60 in the second study. Following the dev-only rule, the test page's causes are not described.
- **The hidden-image judgment was wrong all 6 times.**
- `rampa/language-switcher-lang`, `rampa/css-reading-order` and `rampa/custom-control` reported nothing on these pages, and neither did `rampa/placeholder-text`.

### Probes

Run on 7 pages (3 dev, 4 test); irishtimes.com had no probe finding (its keyboard walk stopped after 4 stops). Every probe reports below the default threshold.

| Check | Dev | Test | Both | Second study, both |
| --- | --- | --- | --- | --- |
| `rampa/focus-obscured` (2.4.11) | 41 / 0 / 0: **1.00** (0.91–1.00) | 16 / 1 / 0: **0.94** (0.73–0.99) | 57 / 1 / 0: **0.98** (0.91–1.00) | 9 / 0 / 6: 1.00 |
| `rampa/focus-visible` (2.4.7) | 11 / 0 / 9: **1.00** (0.74–1.00) | 13 / 1 / 0: **0.93** (0.69–0.99) | 24 / 1 / 9: **0.96** (0.81–0.99) | 11 / 1 / 0: 0.92 |
| `rampa/hover-content` (1.4.13) | 14 / 0 / 0: **1.00** (0.79–1.00) | – | 14 / 0 / 0: **1.00** (0.79–1.00) | 2 / 0 / 0: 1.00 |
| `rampa/focus-indicator-contrast` (1.4.11) | 0 / 0 / 8: **–** | 13 / 0 / 3: **1.00** (0.77–1.00) | 13 / 0 / 11: **1.00** (0.77–1.00) | 18 / 1 / 0: 0.95 |
| `rampa/state-text-contrast` (1.4.3) | 3 / 0 / 0: **1.00** (0.44–1.00) | 1 / 0 / 0: **1.00** (0.21–1.00) | 4 / 0 / 0: **1.00** (0.51–1.00) | 3 / 3 / 0: 0.50 |
| `rampa/text-spacing` (1.4.12) | – | 3 / 0 / 0: **1.00** (0.44–1.00) | 3 / 0 / 0: **1.00** (0.44–1.00) | 0 / 2 / 0: 0.00 |
| `rampa/on-focus` (3.2.1) | 1 / 0 / 0: **1.00** (0.21–1.00) | – | 1 / 0 / 0: **1.00** (0.21–1.00) | – |
| `rampa/keyboard-reach` (2.1.1) | 0 / 1 / 0: **0.00** (0.00–0.79) | – | 0 / 1 / 0: **0.00** (0.00–0.79) | 0 / 1 / 0: 0.00 |
| `rampa/character-key-shortcuts` (2.1.4) | 0 / 1 / 0: **0.00** (0.00–0.79) | – | 0 / 1 / 0: **0.00** (0.00–0.79) | 0 / 1 / 0: 0.00 |
| `rampa/state-indicator-contrast` (1.4.11) | 0 / 1 / 0: **0.00** (0.00–0.79) | – | 0 / 1 / 0: **0.00** (0.00–0.79) | 1 / 0 / 0: 1.00 |
| `rampa/link-color-only` (1.4.1) | – | – | – | 0 / 10 / 0: 0.00 |
| **All** | 70 / 3 / 17: **0.96** (0.89–0.99) | 46 / 2 / 3: **0.96** (0.86–0.99) | 116 / 5 / 20: **0.96** (0.91–0.98) | 45 / 20 / 6: 0.69 |

The keyboard walk's checks (focus obscured, focus visible, focus indicator contrast) were right 94 times out of 96 they decided. The 20 uncertain findings are two dev clusters and three test findings: the judges agreed on what the page does and disagreed on whether it fails (below).

### Suggestions to review

A 2.4.4 or 2.4.6 fail that no checked fact supports is the model's suggestion, listed with the items to review. They are not findings and were not labelled.

| Split | 2.4.4 | 2.4.6 | All | Per page: median, most | Second study after the change |
| --- | ---: | ---: | ---: | --- | --- |
| dev | 44 | 21 | 65 | 2.5, 22 | 29 (median 2, most 9) |
| test | 35 | 11 | 46 | 3, 17 | 51 (median 3.5, most 12) |

### Findings and time per page

| Split | Page | Collect s | Judge s | Model calls | Judged, default | Judged, all | Experimental | Engine (axe) |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| dev | museudoipiranga.org.br | 70 | 172 | 72 | 3 | 3 | 10 | 26 |
| dev | www.travessa.com.br | 32 | 161 | 72 | 2 | 2 | 5 | 42 |
| dev | www.puc-rio.br/vestibular | 20 | 164 | 41 | 3 | 3 | 0 | 4 |
| dev | www.cnj.jus.br/ouvidoria-cnj | 22 | 271 | 70 | 10 | 10 | 8 | 52 |
| dev | www.hcor.com.br | 15 | 205 | 93 | 3 | 3 | 3 | 24 |
| dev | www.metropoles.com | 26 | 298 | 117 | 1 | 1 | 6 | 57 |
| dev | www.tate.org.uk (contact) | 15 | 110 | 47 | 0 | 0 | 1 | 0 |
| dev | www.halfords.com/motoring | 21 | 190 | 66 | 1 | 1 | 3 | 1 |
| dev | www.kcl.ac.uk (undergraduate) | 28 | 210 | 75 | 0 | 0 | 0 | 0 |
| dev | www.canada.ca | 47 | 535 | 89 | 0 | 1 | 0 | 0 |
| dev | my.clevelandclinic.org | 24 | 240 | 95 | 10 | 10 | 0 | 1 |
| dev | www.pbs.org (article) | 20 | 196 | 77 | 5 | 5 | 3 | 77 |
| test | www.itaucultural.org.br/contato | 23 | 54 | 22 | 3 | 3 | 1 | 4 |
| test | www.kalunga.com.br (listing) | 20 | 140 | 72 | 2 | 2 | 2 | 44 |
| test | www.ufpe.br | 57 | 224 | 56 | 50 | 51 | 0 | 3,315 |
| test | www.mg.gov.br | 18 | 328 | 75 | 1 | 1 | 1 | 0 |
| test | www.fleury.com.br (article) | 10 | 100 | 41 | 2 | 2 | 2 | 15 |
| test | www.correiobraziliense.com.br (article) | 32 | 166 | 71 | 15 | 15 | 3 | 17 |
| test | www.vam.ac.uk | 19 | 253 | 107 | 4 | 4 | 1 | 26 |
| test | shop.pimoroni.com | 29 | 226 | 95 | 5 | 5 | 4 | 58 |
| test | www.ed.ac.uk | 12 | 230 | 86 | 8 | 8 | 15 | 1 |
| test | www.nps.gov/findapark | 28 | 399 | 84 | 10 | 10 | 0 | 2 |
| test | www.cancerresearchuk.org (article) | 14 | 234 | 93 | 1 | 1 | 0 | 6 |
| test | www.irishtimes.com | 36 | 277 | 103 | 2 | 2 | 14 | 65 |

- **Findings per page.** At the default threshold, 3.2 judged findings a page on dev (38 on 12) and 8.6 on test (103 on 12; 4.8 without ufpe.br). Three dev pages had none.
- **Time.** Collection took 10 to 70 s a page (median 22.5 s); judging the saved snapshot, 54 to 535 s (median 217 s), with 22 to 117 model calls; the two together 77 to 582 s (median 242 s), on a GPU shared with other work. Collecting a page with `--probe all` took 139 to 426 s.

### How often the model flags

| Split | Criterion | Candidates | Judged | Reported failing | Share |
| --- | --- | ---: | ---: | ---: | ---: |
| dev | 1.1.1 | 133 | 133 | 28 | 21.1% |
| dev | 2.4.4 | 1,167 | 543 | 4 | 0.7% |
| dev | 2.4.6 | 329 | 218 | 0 | 0.0% |
| test | 1.1.1 | 117 | 117 | 43 | 36.8% |
| test | 2.4.4 | 2,798 | 523 | 61 | 11.7% |
| test | 2.4.6 | 249 | 237 | 2 | 0.8% |

"Reported failing" counts findings, after verification; the 1.1.1 rows include the experimental hidden-image findings (1 on dev, 5 on test). The cap of 50 candidates left out 53% of the link candidates on dev and 81% on test.

### Agreement between the judges

| Set | Findings | Observed agreement | Cohen's kappa | Second study's kappa |
| --- | ---: | ---: | ---: | ---: |
| All | 366 | 0.92 | 0.84 | 0.92 |
| Dev | 168 | 0.89 | 0.69 | 0.95 |
| Test | 198 | 0.95 | 0.90 | 0.90 |
| Judged criteria | 143 | 0.96 | 0.91 | 0.94 |
| Experimental rules | 82 | 0.96 | 0.92 | 0.88 |
| Probes | 141 | 0.86 | 0.30 | 0.81 |

The judges disagreed on 29 findings, which became `uncertain`: 19 on dev pages (17 of them probe findings on two pages: 9 focus-visible findings under a popup, 8 focus-indicator findings on carousel arrows) and 10 on test pages. On why a finding is wrong, over the 128 findings both called false positives, the cause kappa was 0.91. The probes' kappa is low because almost every probe finding is a true positive, so the few disagreements weigh heavily; observed agreement is 0.86. High agreement between two agents of one model family measures consistency, not accuracy.

## What moved compared with the second study

- **1.1.1 facts (four facts, tuned on the second study's dev half).** No measurable change on new pages: 0.26 on dev and 0.50 on test, against 0.27 and 0.40 (both halves 25 of 63, 0.40, against 15 of 46, 0.33). The facts did fire: verification dropped 12 claims for the two reasons they added ("the alternative repeats the visible text of the link or button it sits in", 4; "the suggested alternative keeps every word of the current one", 8), and 16 more for the older reasons they widened (a linked image that names its link's purpose, 15; a suggestion that only rewords, 1). Dropped claims are not findings and were not labelled, so this study cannot say whether those drops were right. What it can say is that the 1.1.1 findings left on new pages are still wrong most of the time on dev, for reasons the facts do not cover (below).
- **2.4.4 and 2.4.6, fact-backed (designed on the first study).** On dev, 4 findings, all on one page: three links that share a text and lead to two places (2 right, 1 uncertain) and a raw address (wrong); the second study's re-judged run had 2 of 2 on dev. On test, 5 of 61 right, 50 of the false positives on one page. Without that page, test 2.4.4 is 5 / 4 / 2, against 3 / 4 / 0 before. A fact-backed claim is shown at the model's "high", so a fact that fires on many candidates of one page puts all of them before a user. The suggestions are about as many as before (111 in all, against 80).
- **`rampa/link-color-only` (compare a link with the text around it).** Nothing to measure: on the 7 probed pages it found 5 links in blocks of text (on correio, fleury.com.br and museudoipiranga.org.br), all set apart by more than color, and reported no finding. In the second study all 10 of its findings were false positives, on one page this study does not have. That it reported nothing here is consistent with the fix, but not evidence for it.
- **The caret as a focus indicator.** It left out one text field (museudoipiranga.org.br), and no focus finding on any page is on a text field. `rampa/focus-visible` was 24 / 1 / 9 and `rampa/focus-indicator-contrast` 13 / 0 / 11; the one field left out was not labelled.
- **`rampa/placeholder-text`.** No finding on any page, before or after the change would apply; nothing measured.
- **What held.** 1.3.5 (8 of 8), the keyboard walk's checks (94 of 96 decided), hover content (14 of 14), placeholder alternatives that are file names (11 of 12), and the experimental rules on dev (35 of 38).
- **What got worse.** `rampa/pixel-contrast`, 60 of 60 in the second study, had 13 false positives on one test page; the experimental rules on test fell from 0.71 to 0.44. The hidden-image judgment was 0 of 6.

## False positives, dev split only

Every pattern below comes from dev pages, from the two judges' rationales, checked against the packets. They are candidates for future fixes, chosen on this dev half only; whatever is changed from them must be measured on pages that neither half of this study holds.

### The judged criteria (22 false positives, 20 of them 1.1.1)

1. **1.1.1, "describes something the image does not show" on an alternative that is right, 16 findings.** Four kinds:
   - *A flag in a language link, named by its language code* (3, cnj.jus.br): `alt="pt"`, `"en"`, `"es"` on the flags of the GTranslate links, whose visible text is "PT", "EN", "ES" and whose `title` is the language. The flag stands for the language, and the alternative names it. **Fix:** inside a language link (`hreflang`, a language name or code in the link's text or title), an alternative that names the same language serves the image's purpose.
   - *An icon named for what it stands for, above a heading of the same words* (5, my.clevelandclinic.org): "cancer icon" on an awareness ribbon over the heading "Cancer", "stomach icon", "heart icon", "primary care icon", "get care icon". The existing fact for an alternative that repeats its control's text needs the image to sit in a link or a button; these sit in a card next to an `h2`. **Fix:** extend that fact to the nearest heading or the card's own text, so the claim is redundancy at worst.
   - *An accurate description called wrong* (6): my.clevelandclinic.org "Person sitting on a couch looking at their mobile phone."; puc-rio.br "Imagem de alunos no Campus da PUC-Rio" on two carousel photos of students outdoors; cnj.jus.br "banner web da ouvidoria do cnj. Fundo verde com letras brancas" on exactly that; hcor.com.br "Alerta de Golpe" on a scam-alert banner (twice, the second a carousel clone). In the first, the model's own description, in the alternative's language, begins "A woman sitting on a couch looking at her phone" and adds the four care options drawn around her, which the paragraph next to the image lists. This is the second study's item 3, not targeted by the fixes, and it is not only a matter of language. **Fix:** compare the model's own `imageShows` with the alternative, content words aside from the kind words, and drop the claim when the alternative's words are in it.
   - *An avatar named after the column it illustrates* (1, metropoles.com "Blog do Noblat" on the columnist's photo), and *a thumbnail named for the episode it opens* (1, pbs.org "fullepisode", the cause disputed).
2. **1.1.1, "is all its link holds, and does not say where the link leads" when it does, 4 findings.** my.clevelandclinic.org's header logo "Cleveland Clinic logo" links to the site's home page; pbs.org's funder logo "Viewers Like You" links to the donation page; puc-rio.br's footer seal "Selo da Arquidiocese de São Sebastião do Rio de Janeiro" links to arqrio.org.br with `title="Site da Arquidiocese de São Sebastião do Rio de Janeiro"`; hcor.com.br's "Banner FAQ - Portal do Paciente" leads to a page titled "FAQ - Hcor" (the destination was read by the judge, not by Rampa). **Fix:** a logo that links to its own site's home page and names the site names its purpose (the fact now sets the site's own name aside); a link's `title` that names the destination counts as its name; read the destinations of linked images before those of text links.
3. **2.4.4, a raw address in a sentence that says where it leads, 1 finding.** cnj.jus.br "www.cnj.jus.br/comopeticionar." ends the sentence "… conforme orientações previstas na página …". The raw-address fact grounds a claim whatever surrounds the link; a sentence is programmatically determined context (G53). **Fix:** let a sentence that states the purpose refute the raw-address fact, as it already refutes the generic-text one.
4. **2.4.2, "Home - Canada.ca", below the threshold, 1 finding.** The site's home page titled with the site's name.

### Experimental rules (3 false positives, 1 uncertain)

- **`rampa/icon-contrast` on a brand logo**, travessa.com.br's floating WhatsApp link, white glyph on WhatsApp green (1.98:1). The second study listed the same case on its dev half and it was not fixed. **Fix:** leave out a glyph that is a known brand mark in its brand colors (logos are exempt from 1.4.11).
- **`rampa/placeholder-alt` on a brand name that is also the file name**, halfords.com's "american-express" from `american-express.png`, among the payment logos "visa", "mastercard", "paypal" and "klarna". **Fix:** a hyphenated name with no extension and no digit, among siblings that name brands, is not a file-name placeholder.
- **The hidden-image judgment on a figure with a caption**, tate.org.uk's lead image `alt=""` whose `figcaption` names the artwork. **Fix:** an image with `alt=""` in a `figure` whose caption is exposed is described by the caption; do not ask the hidden-image question.
- *Uncertain:* `rampa/widget-name` on halfords.com's search field, whose `label` is empty and whose placeholder names it; the judges split on whether HTML-AAM's placeholder fallback names it.

### Probes (3 false positives, 17 uncertain)

- **A popup that opens by itself and covers the page, 10 findings.** On museudoipiranga.org.br a welcome modal opens a few seconds after load, takes no focus and covers the navigation; the keyboard walk tabbed behind it and found no pixel change on 9 links (uncertain: the auditor called it a real failure, the skeptic a covered element whose outline shows once the modal is closed). On pbs.org a donation popup's dark, blurred backdrop was measured as the carousel dot's colors (`rampa/state-indicator-contrast`, a false positive, `collector_error`). **Fix:** when a hit test at the focused element finds another element on top, report focus obscured (2.4.11) and do not judge 2.4.7 or 1.4.11 from those pixels; dismiss or wait out such a popup before measuring states.
- **A focus cue that is only a size change, 8 findings (uncertain).** hcor.com.br's carousel arrows lose their outline and only scale by 1.08 on focus. The judges agree nothing that marks focus reaches 3:1, but `rampa/focus-indicator-contrast` reported a pale color "next to" the same color (1.00:1), pixels that moved with the glyph. **Fix:** recognise a capture that differs only by a scale transform and measure the enlarged edge against what is behind it.
- **`rampa/character-key-shortcuts` on a page that moves by itself**, hcor.com.br: pixels changed while "I" was pressed because a carousel and an animated button move on their own; both judges reproduced the same change with no key at all. **Fix:** compare each key with a wait of the same length and no key.
- **`rampa/keyboard-reach` on a background video**, museudoipiranga.org.br's hero video, a YouTube frame with `role="presentation"`, no controls and `pointer-events: none`. **Fix:** leave out frames that take no pointer events and expose no control.

### What the true positives look like on dev

- **1.3.5**, 7 of 7: newsletter and contact fields with no `autocomplete` or with `autocomplete="off"`.
- **1.1.1**, 7: "Botão Rybená LIBRAS" copied onto the accessibility widget's other buttons (2), "Gray gradient" on decorative images (3), "logo-museu", and a linked advertisement "Web ad - adjusted (1)".
- **2.4.4**, 2: "Registre sua manifestação" on links to two different forms, told apart only by icons with no text alternative.
- **Experimental rules**, 35: white social icons on light blue and gray carousel arrows under 3:1, text under its contrast minimum on colored panels, ten file names used as alternatives ("TERRITORIOS-EM-DISPUTA.jpg"), pale placeholders, links with no name.
- **Probes**, 70: 41 controls that focus leaves entirely hidden (20 under museudoipiranga.org.br's welcome modal, 11 under hcor.com.br's fixed header, 10 under pbs.org's donation popup: where the popups spoiled 2.4.7 and 1.4.11, both judges still called focus obscured a real 2.4.11 failure), 14 hover menus and panels that cover content and do not close with Esc, 11 controls with no visible focus indicator, 3 hover states whose text falls under 4.5:1, and a search button that moves focus to its field as soon as it is focused.

## The test split: counts only

The test half's 100 false positives and 10 uncertain findings, by check, threshold and the judges' cause. They were not read for patterns.

| Check | Threshold | Cause | False positives |
| --- | --- | --- | ---: |
| judgment 2.4.4 | default | criterion misapplied | 42 |
| judgment 2.4.4 | default | context missing | 8 |
| judgment 2.4.4 | default | model error | 4 |
| judgment 1.1.1 | default | model error | 14 |
| judgment 1.1.1 | default | criterion misapplied | 3 |
| judgment 1.1.1 | default | collector error | 1 |
| judgment 1.1.1, hidden image (experimental) | below | collector error | 5 |
| judgment 2.4.6 | default | model error, disputed | 1, 1 |
| judgment 3.3.2 | default | disputed | 1 |
| `rampa/pixel-contrast` | below | collector error | 13 |
| `rampa/icon-contrast` | below | criterion misapplied | 3 |
| `rampa/placeholder-contrast` | below | collector error | 2 |
| `rampa/focus-visible` | below | collector error | 1 |
| `rampa/focus-obscured` | below | disputed | 1 |

By page: 50 on ufpe.br (all judgment 2.4.4), 17 on ed.ac.uk (13 pixel-contrast, 2 placeholder-contrast, 2 judgment 1.1.1), 10 on nps.gov (judgment 1.1.1), 7 on correiobraziliense.com.br, 6 on shop.pimoroni.com, 5 on vam.ac.uk and 5 on three other pages. Uncertain: 2 judgment 1.1.1, 2 judgment 2.4.4, 1 judgment 3.1.2, 3 focus-indicator-contrast, 1 icon-contrast, 1 widget-name.

## Caveats

- **Labels by Claude agents, pending human review.** Every label comes from two Claude agents of one model family; they are a pre-annotation, not ground truth, and their mistakes are likely correlated. Agreement was lower than in the second study (kappa 0.84 against 0.92), mostly on two dev probe clusters. The labels can be reviewed in Rampa Lab's review mode (<https://rampalab.guilhermebs.com.br/>) with `data/findings.json` and `data/pages.json`.
- **Clustered findings.** Findings on one page are correlated, and the Wilson intervals assume they are not. ufpe.br holds 50 of the test half's 103 default-threshold findings; ed.ac.uk 15 of its 43 experimental findings; cnj.jus.br and my.clevelandclinic.org 20 of dev's 38; two pages 71 of the 141 probe findings. One page can move a half's precision by more than the difference this study set out to measure.
- **Small numbers.** Most checks have fewer than ten findings a half, and three of the five fixes produced almost nothing to label: no `rampa/link-color-only` or `rampa/placeholder-text` finding, one text field left out by the caret rule.
- **Different pages, not a replay.** The comparison with the second study is between two sets of pages and two versions of the code. The fixes' effect is mixed with how hard each set of pages is, and the old code was not run on these pages. A replay of `4fd54fc` on these snapshots, with the same answers read from the cache, would separate them for the judged criteria.
- **Dropped claims are not labelled.** The 1.1.1 facts dropped 12 claims for their new reasons; whether those drops were right, and whether a fact hid a real failure, is not measured.
- **The probe run** is 7 pages, not the 8 drawn: kcl.ac.uk could not be probed. Five of the seven were collected again about eight hours after their main recording, because of the morning's connection drops; correio and fleury.com.br kept their morning runs. Two pages' keyboard walks stopped after 4 and 6 stops.
- **Judges kept apart by instruction only.** The two judges of a packet worked on one machine and filesystem; nothing enforced their separation. The person running the study read two test findings' labels through the first judges' replies. Nine judges were launched again after an API limit and a shutdown; no partial label file was kept.
- **One run, a nondeterministic model,** on a GPU shared with other work.
- **The test half is spent.** Its numbers are now known, and its pages may not be used to choose a change. The next held-out measurement needs fresh pages again.

## Data and reproduction

All paths are under `study/round-3-2026-10-23/`. Run from the repository root after `pnpm install --frozen-lockfile` and `pnpm build`.

- **Pre-registration.** `preregistration.md`, committed in `38aa28c` with the pages, the split and the scripts.
- **Selection.** `scripts/exclusions.py <public_suffix_list.dat> build|check` and `data/excluded-domains.json`; `scripts/candidates*.tsv`, `scripts/screen.mjs` and `data/screen-*.json`; `scripts/links.mjs`; `scripts/pages.tsv`; `scripts/split.py` and `data/pages-input.json`.
- **Collection.** `bash scripts/collect.sh main|probe [slug ...]`, `collect-log.txt`, `pages/<slug>/run-*-collect-*.json` and `*-collect-console*.txt`; attempts set aside are in `pages/<slug>/discarded-*/`.
- **Judgment.** `bash scripts/run-judged.sh default|probe [slug ...]`, `run-log.txt`, `pages/<slug>/report.json` and `probe-report.json`, with their consoles and `run-*-judged.json`.
- **Labels.** `python -I scripts/packets.py` writes `packets/<packet>.json` and `data/findings-raw.json`; `NODE=<node.exe> python -I scripts/judge_prompt.py <packet> auditor|skeptic` prints each judge's exact prompt; `labels/<packet>.<role>.json`; `python -I scripts/check_labels.py`; `run-log-notes.txt` records what happened to the judges.
- **Numbers.** `python -I scripts/analyze.py` writes `data/findings.json`, `data/pages.json` and `data/summary.json`; `python -I scripts/tables.py` prints the tables above; `python -I scripts/dump_fp.py dev [check]` lists the dev false positives with both rationales (`test` prints counts only).
- **Kept out of git.** The recordings, screenshots, judgment caches and crops, 189 MB for the 93 files hashed in `data/recordings.json`. A full copy of the study folder is kept outside the repository, and all 93 files matched their SHA-256 when copied. With a copy of `pages/<slug>/recording/`, a page's judgments can be read back offline: `rampa check pages/<slug>/recording/<name>.snapshot.json --model ollama:gemma4:12b --locale en --min-confidence low --offline --cache-dir pages/<slug>/cache`.

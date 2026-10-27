# Precision check: an independent recount and second analysis after round 4 (2026-10-27)

A 30-minute desk study, written as an assurance pass over the question "how can precision on real pages be raised further, and how far". It recounts the labels itself, ranks what is left, simulates the candidate fixes on the labelled findings and the recorded snapshots, and only then reads the other analysis of the same question (`probe/precision-next`). Nothing in `src/` changed. Scripts and their outputs are in `study/notes-precision-check/`.

**Every number here is in-sample unless marked otherwise.** All six halves of studies 2, 3 and 4 have been read. The labels are the studies' two Claude judges, not people.

## 1. Recount

Default-threshold judgment findings of the current code: round 4's main run (`study/round-4-2026-10-24/data/findings.json`, `origin = main`, `group = judged`, `shown = true`, final label = the label both judges gave), and the merged code replayed on studies 2 and 3 (the probe's `compare-impl.md`: the labelled rows of `rows-latest.json` minus the findings the replay removed). Precision is TP / (TP + FP), uncertain left out.

| Set | TP | FP | unc. | Precision (Wilson 95%) | FP on the top page | FP on top two |
| --- | ---: | ---: | ---: | --- | --- | ---: |
| r4 test | 14 | 12 | 0 | 0.54 (0.35–0.71) | museudoamanha 8 (67%) | 9 |
| r4 dev | 13 | 54 | 2 | 0.19 (0.12–0.30) | toolstation 50 (93%) | 52 |
| r4 pooled | 27 | 66 | 2 | 0.29 (0.21–0.39) | | |
| s3 test (replay) | 24 | 57 | 2 | 0.30 (0.21–0.40) | ufpe 50 (88%) | 53 |
| s3 dev (replay) | 15 | 3 | 1 | 0.83 (0.61–0.94) | one each | 2 |
| s2 test (replay) | 10 | 3 | 0 | 0.77 (0.50–0.92) | thomann 2 | 3 |
| s2 dev (replay) | 19 | 0 | 2 | 1.00 (0.83–1.00) | – | – |
| **all three** | **95** | **129** | 7 | **0.42 (0.36–0.49)** | 100 of 129 on two pages (78%) | 108 (84%) |

Round 4 by criterion: dev 1.1.1 2/2 (+1 unc), 1.3.5 2/0, 2.4.4 0/52 (+1 unc), 3.1.1 1/0, 3.1.2 8/0; test 1.1.1 2/3, 1.3.5 3/0, 2.4.4 9/0, 3.1.2 0/8, 3.3.2 0/1. By page: dev cobasi 1/0, conversation 8/1, es.gov.br 1/0, infomoney 0/1 (+2 unc), osesp 3/2, toolstation 0/50; test fueleconomy 0/1, gla 0/1, mdanderson 1/1, museudoamanha 0/8, nhm 3/0, r7 1/0, tst 8/0, ufpr 1/1. False-positive causes as the judges named them (round 4): model error 32, criterion misapplied 22, collector error 8, disputed 2, context missing 2.

**Agreement with the docs' tables.** Every round-4 cell matches the round-4 report. The s2/s3 replay matches `compare-impl.md`. One wording to flag: the round-4 report's introduction says the merged work "gave 0.30 on the third study's test half (0.77 without www.ufpe.br), 0.77 on the second study's and 0.84 pooled"; the 0.84 is the pooled figure *without* ufpe.br (68 / 81), while the replay's pooled figure with every finding is 0.52 (68 / 63). The parenthesis applies only to the first number as written.

## 2. The remaining false-positive causes, ranked

| # | Cause | FP | Pages (half) | Evidence | Fix | Effect (labels) |
| --- | --- | ---: | --- | --- | --- | --- |
| 1 | **2.4.4 shared text in a nested footer list.** Every flagged link sits in `footer > nav > ul > li:nth-of-type(1) > ul > li > a`: a department list nested under the item "Deals" (and "Sale & Clearance"), sharing its text with the top-level department link. The parent item is the context WCAG technique H81 names. | 50 | toolstation.com (r4 dev) | `ancestry.py` on the recorded snapshot: 50 of 50 flagged links have a parent list item with a name; the two judges' rationales say the same | **F1**: a deterministic fact for the shared-text claim: when the link's list item is itself inside a list item whose first text or link differs between the sharers, the context tells them apart (H81); the claim becomes a suggestion | −50 FP, **0 TP lost**: none of the 21 true shared-text links in the three studies (tst.jus.br 8, ufpr 1, cnj 2, correio 3, kalunga 2, poder360 2, tuasaude 3) sits in any list item at all (`h81-context.py`). r4 dev 0.19 → 0.76 (dev-read: the fix was chosen on it); the TP check on the test halves is a read-but-not-tuned check |
| 2 | **A page served as a stripped crawler rendering**: no stylesheet linked, every CMS field dumped as raw `<p>`/`<h4>`, Portuguese and English twins side by side. The existing unstyled guard checks *linked* sheets that failed, so a page with *no* sheets never fires it. | 8 | museudoamanha.org.br (r4 test) | The snapshot's `root.native.bodyLook` is `times new roman, 16, 400, rgb(0,0,0)`, the browser default; `reach.stylesheets` is null. The only other page with that signature in the 27 snapshots I read is www.ufpe.br (s3 test), the other burst page. The 25 other pages all have an author font | **F2**: treat the page as unstyled when the body look equals the browser default *and* no author stylesheet applied (none linked, or `applied = 0`); retry the load once, then move judgment findings to suggestions, as the guard does today | −8 FP on r4 test (test-half number: a hypothesis, not a result); on s3 it is a second signal for ufpe's 50, which the present guard would have needed a recorded failure to catch; 0 TP lost on both pages (0 TP on either). 0 misfires on the 25 styled pages, including thejournal.ie, where today's guard misfired |
| 3 | **1.1.1 `wrong_content` on an alternative that is right or generic, confirmed by all three framings.** "Autor avatar" (0.987), "CC BY ND" (0.987), "Flexible-Fuel" (0.999), "shield" (0.99997; the model read overlaid HTML text as part of the image), plus clevelandclinic, pbs, puc-rio, ed.ac.uk, mg.gov.br in s3 | 9 | 9 pages, one each (every half but s2) | round 4's `confirmation.minProbability`: the FP sit at 0.987, 0.987, 0.999, 0.99997; the 4 round-4 TP at 0.99991–0.999999 | **F3**: threshold 0.99 (round 4 pre-registered "without the 1.1.1 findings under 0.99" as a secondary, so it is not a new idea tuned here). Beyond it: a milder claim "the alternative is generic" as a suggestion | F3: −2 FP, 0 TP on round 4 (both on dev); s2/s3 unknown, the replay reports do not carry the probabilities (reasoned: the probe found the 0.9 pass kept 34 of 40 TP, so 0.99 may cost 1–3 TP of 40). A 0.999 cut would remove 4 FP and 0 TP in round 4, but with only 4 TP above it that margin is thin: not recommended on this sample |
| 4 | **2.4.4 shared text, residue**: osesp's two "Ouvidoria" (one in `navigation` inside the Osesp `contentinfo`, one in a `region` of the gov.sp `contentinfo`; neither destination read, one redirects by script), thomann 2 (disputed), correio 2 and pimoroni 1 (criterion misapplied) | 7 | osesp (r4 dev), thomann (s2 test), correio, pimoroni (s3 test) | `ancestry.py`: the osesp pair has no list item; it is told apart by the landmark it sits in | **F4** (reasoned): the context fact also reads the nearest named landmark or region heading; or read the destinations and compare titles | −2 FP on osesp, 0 TP (reasoned, not simulated by code); the other 5 need the destination read or stay |
| 5 | Singles: ufpr "Logo Boletim UFPR" functional link (disputed), gla.ac.uk 3.3.2 (disputed), correio generic text, fleury "App Store Badge", tcd "istagram" | 5 | s2–r4 test | | 3.3.2 has 0 TP across four studies (0 / 1 here, 0 / 6 in the probe): make it a suggestion | −1 FP, 0 TP; the rest stay |

`simulate.py` applies F1–F4 as filters over the 224 decided findings:

| Filter | r4 test | r4 dev | r4 all | s3 test | s3 dev | s2 test | s2 dev | all three | all test halves |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| today | 14/12 0.54 | 13/54 0.19 | 27/66 0.29 | 24/57 0.30 | 15/3 0.83 | 10/3 0.77 | 19/0 1.00 | 95/129 **0.42** (0.36–0.49) | 48/72 0.40 |
| F1 H81 nested list | 0.54 | 13/4 0.76 | 27/16 0.63 | 0.30 | 0.83 | 0.77 | 1.00 | 95/79 0.55 (0.47–0.62) | 0.40 |
| F2 default body look | 14/4 0.78 | 0.19 | 27/58 0.32 | 24/7 0.77 | 0.83 | 0.77 | 1.00 | 95/71 0.57 (0.50–0.65) | 48/14 0.77 |
| F1 + F2 | 0.78 | 0.76 | 27/8 **0.77** (0.61–0.88) | 0.77 | 0.83 | 0.77 | 1.00 | 95/21 **0.82** (0.74–0.88) | 48/14 0.77 (0.66–0.86) |
| F1 + F2 + F3 (0.99) | 0.78 | 13/2 0.87 | 27/6 0.82 | 0.77 | 0.83 | 0.77 | 1.00 | 95/19 0.83 (0.75–0.89) | 0.77 |
| F1 + F2 + F3 + F4 (reasoned) | 0.78 | 13/0 1.00 | 27/4 0.87 | 0.77 | 0.83 | 0.77 | 1.00 | 95/17 0.85 (0.77–0.90) | 0.77 |

No filter loses a true positive on these labels. Labels: F1 is dev-chosen (r4 dev) with its TP cost checked on every half; F2 is a test-half observation (r4 test) whose signal was then checked on all 27 snapshots; F3 is dev-only; F4 is reasoned. The 14 false positives that remain on the test halves after F1 + F2 are singles on 11 pages (section 2, rows 3–5).

## 3. Projection for fresh pages

- **Non-burst precision today is about 0.8 and stable across rounds**: r4 without its two burst pages 27 / 8 (0.77), s3 without ufpe 39 / 10 (0.80), s2 29 / 3 (0.91). F1 and F2 do not touch those findings; they stop two of the three burst mechanisms seen so far.
- **Bursts are the whole story.** In 72 pages over three rounds there were three false bursts (ufpe 50, toolstation 50, museudoamanha 8) and one true burst (theconversation 8), each from a *new* mechanism: a theme stylesheet that did not apply, a nested footer list, a server that serves crawlers a stripped page. About one false burst per 24 pages, and the half it lands in goes to 0.2–0.3 regardless of everything else.
- **Projection, realistic, for a 24-page round with F1 + F2 (+ F3) merged**: a point estimate of **0.75**, with a plausible range **0.60–0.85** over the whole round, and any single half anywhere from **0.3 to 0.9**, depending on whether a burst with a fourth mechanism appears in it. The in-sample 0.82–0.83 is the ceiling; the per-criterion cap of 50 means a single new burst mechanism costs up to 50 false findings, so the main risk is not the rules measured here but the next unseen page shape. Two safeguards that do not cost true positives would narrow that interval: report a burst of more than N same-claim findings on one page as one page-level finding (a reporting change; it also makes theconversation's 8 true 3.1.2 findings one), and run every new fact on the recorded snapshots of all 72 pages before round 5, since that corpus now holds 21 true shared-text links and 4 burst pages to replay against.
- These are reasoned numbers; the pre-registered measure for them is a round 5 with F1 + F2 merged.

## 4. Against the other analysis (`probe/precision-next`)

Read after sections 1–3 were written.

**Agree.**
- Recount: identical in every half (95 / 129, 0.42 pooled; r4 13/54 and 14/12; s3 24/57 and 15/3; s2 10/3 and 19/0), and the same burst shares (100 of 129 FP on two pages).
- P0 (the guard on ufpe plus H81 on toolstation) is worth about +0.35 pooled at 0 TP lost; my F1 + the guard give the same 95 / 29 → 0.77.
- The 0.99 cut: both find 2 FP, 0 TP on r4 dev and note the pre-registration; both say it caps out quickly because the other `wrong_content` FP confirm above 0.99.
- 3.3.2 to suggestions; a hard per-page cap rejected (it costs tst.jus.br's and theconversation's true bursts); a second pass on 2.4.4 rejected on the probe's AUROC 0.47–0.60; collapsing a burst into one page-level finding as a reporting change.

**Disagree, or add evidence they lacked.**
- **The H81 fact's cost to true positives.** They list it as a risk "unknown until it runs". I measured it on the snapshots: 0 of the 21 true shared-text links sit in any list item, and 50 of 50 toolstation links have a parent list item with a name. The fact loses nothing on these labels (in-sample for the check, but not tuned on the true links). They are right that it should be replayed on all 72 pages before round 5; this is that replay for the labelled findings.
- **museudoamanha's cause.** They rank it as cause 1, "3.1.2 burst, collector error, the page was not read", and propose a page-level language policy (report one 3.1.1 finding, send per-paragraph 3.1.2 claims to suggestions), which on dev turns theconversation's 8 true findings into 1. I read the snapshot: the page is a stripped crawler rendering with no stylesheet linked and a default body look, the same signature as www.ufpe.br and no other page in the 27 I checked. The root cause is the capture, not 3.1.2, and the next such page would burst on 2.4.4 or 1.1.1 as well; a default-body-look guard (F2) removes the 8 and would have been a second signal on ufpe, at 0 misfires on styled pages, including the thejournal.ie misfire they mention. Their language policy is still a sound reporting change (one page-level language finding instead of eight), but it is a counting fix, not the fix for this error. Where I can tell: the snapshot evidence (`bodyLook`, `reach.stylesheets = null`) is on my side for the cause; their policy stands on its own merits for the burst count.
- Their C1 ("the 3.1.2 burst gone", s4 test 0.54 → 0.78) and my F2 reach the same test-half number by different mechanisms; mine generalises to other criteria, theirs to true language bursts. Both are test-half numbers and hypotheses for round 5.
- Their pooled "after everything" 0.86 (C4) against my 0.83–0.85: the same magnitude; the difference is their 3.1.2 policy also touching dev's 8 TP (counted as 1) versus my leaving them.
- I did not read their sections past item 8 of "Ideas beyond rule tweaks" (time), so their projection, if any, is not compared here.

## 5. Unfinished

- F3's TP cost on s2/s3: the replay reports (`data/impl`) lack the second-pass probabilities; a re-run with `--confirm` recorded would settle whether 0.99 loses 1–3 of 40 true 1.1.1 findings.
- F2 was checked on 27 snapshots (24 of round 4, 2 of round 3, 1 of study 2); the other 45 recorded pages were not read for a default body look.
- F4 (landmark context) and the burst-collapse policy were reasoned, not simulated.
- No human has reviewed any label.

## 6. Scripts

`study/notes-precision-check/`: `h81-context.py` (every labelled shared-text 2.4.4 finding of the three studies against its snapshot: list-item and parent-item context; output `h81-context.md`), `ancestry.py` (the round-4 flagged links resolved by `ref`, with their ancestor chain; `ancestry.md`), `simulate.py` (the counterfactual table; `simulate.md`). Run from the repository root with `python -I <script> C:/Users/guilh/dev/rampa-study-recordings` where a recordings root is needed.

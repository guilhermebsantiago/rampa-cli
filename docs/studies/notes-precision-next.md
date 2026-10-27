# Precision, next: what is left after round 4, and what to do about it (2026-10-27)

A 30-minute desk study over the labelled findings of the second, third and fourth real-page studies, written to answer "how do we raise precision further" with evidence rather than ideas. It reads the [round 4 report](real-pages-2026-10-round4.md), the [precision probe](notes-precision-probe.md) and the [round 3 report](real-pages-2026-10-round3.md), and the literature report kept outside the repository ("Como elevar a precisão do Rampa"). The numbers come from `study/notes-precision-next/remaining.py`, whose output is `study/notes-precision-next/remaining.md`. **Nothing in `src/` changed.**

Three things are already planned and are only sized here, not re-derived: the 2.4.4 shared-text fact reading the links' list-item context (H81) and hidden menus; no per-page bursts of near-identical findings; the unstyled guard's misfire on a stylesheet link that resolves to the page itself.

## 1. The data

The labelled default-threshold findings of the judged criteria, as the merged code (`main` 62bbf37's precision work) shows them:

- **Studies 2 and 3**: the merged code replayed on the recorded snapshots (`study/notes-precision-probe/data/impl`, section 9 of the probe), matched to the two-judge labels. **In-sample**: those pages were read to choose the merged work. The replay cannot apply the unstyled guard to ufpe.br, so its 50 findings are still counted here and removed by hand below.
- **Study 4**: the main run's labelled findings. **Out-of-sample** for the code; the dev half has since been read (round 4's "False positives, dev split only"), the test half only counted.
- The first study and its re-measure are left out: their code is two versions back, and every one of their causes was folded into the probe's ranking already.

| Half | TP / FP (uncertain) | Precision | Sample |
| --- | --- | --- | --- |
| s2 dev | 19 / 0 (2) | 1.00 (0.83–1.00) | in |
| s2 test | 10 / 3 (0) | 0.77 (0.50–0.92) | in |
| s3 dev | 15 / 3 (1) | 0.83 (0.61–0.94) | in |
| s3 test | 24 / 57 (2) | 0.30 (0.21–0.40) | in |
| s4 dev | 13 / 54 (2) | 0.19 (0.12–0.30) | out |
| s4 test | 14 / 12 (0) | 0.54 (0.35–0.71) | out |
| **all** | **95 / 129 (7)** | **0.42 (0.36–0.49)** | mixed |

## 2. How much of the error is burst pages

Plainly: **almost all of it.** Of the 129 false positives, 100 sit on two pages (www.ufpe.br, 50 2.4.4; www.toolstation.com, 50 2.4.4) and 8 more on a third (museudoamanha.org.br, 3.1.2). The other 21 are spread one or two to a page over 17 pages.

| Half | FP | On its top FP page | Share | On its top two pages |
| --- | ---: | --- | ---: | ---: |
| s3 test | 57 | ufpe-br, 50 | 88% | 53 |
| s4 dev | 54 | toolstation-plumbing, 50 | 93% | 52 |
| s4 test | 12 | museudoamanha, 8 | 67% | 9 |
| s2 test | 3 | thomann-co-uk, 2 | 67% | 3 |
| s3 dev | 3 | one each | 33% | 2 |
| s2 dev | 0 | – | – | – |

The true positives cluster too: tst.jus.br holds 8 of s4 test's 14 TP (2.4.4), theconversation.com 8 of s4 dev's 13 (3.1.2), correio and ed.ac.uk 6 and 6 of s3 test's 24 (1.1.1). So every half's number is a statement about one or two pages, in both directions. Section 5 says what to do with that when counting.

## 3. False-positive causes after the planned fixes, ranked

Applying the planned fixes as if they were perfect (P0: ufpe.br's 50 go to the unstyled guard, toolstation.com's 50 to the H81 context fact) leaves **95 TP / 29 FP, 0.77 (0.68–0.83) pooled**, with 0 TP lost. In-sample for ufpe.br (the guard was built on it), dev-read for toolstation.com. The 29 that remain, by cause:

| # | Cause | FP | Pages | Half(s) | Notes |
| --- | --- | ---: | --- | --- | --- |
| 1 | **3.1.2 burst, "collector error"** | 8 | museudoamanha.org.br | s4 test | The judges' cause only; the page was not read. It is a burst of per-paragraph claims on one page, the mirror image of theconversation.com's 8 true 3.1.2 findings on dev, where the page's `lang` was wrong. Both say the same thing: a page-level language problem is being reported 8 times. |
| 2 | **1.1.1 `wrong_content` on an alternative that is right or generic**, confirmed by all three framings | 9 | clevelandclinic, pbs, puc-rio (s3 dev); ed.ac.uk, mg.gov.br (s3 test); infomoney, theconversation (s4 dev); fueleconomy.gov, mdanderson (s4 test) | every half but s2 | 1 a page. 3 of the 9 sit under 0.99 (0.987 twice on s4 dev, one on s3 dev); the other 6 confirm above 0.99. The model reads "Autor avatar", "CC BY ND", "Imagem de alunos no Campus" as wrong descriptions; a person reads them as thin or generic but not false. |
| 3 | **2.4.4 shared text, residue** | 7 | osesp (2: two addresses, one destination by script redirect, `context_missing`), thomann (2, disputed), correio (2) and pimoroni (1, `criterion_misapplied`) | s2 test, s3 test, s4 dev | After P0 the shared-text claim stands at 21 TP / 7 FP (0.75). The osesp pair is fixable deterministically (follow a script or `meta` redirect, or compare destination titles). The other five are 2 to 4 links the judges thought a context did tell apart; whether the H81 fact catches them is unknown until it runs. |
| 4 | 1.1.1 functional image "does not say where the link leads" | 2 | tcd.ie (s2 test, disputed), fleury (s3 test) | | 18 TP / 2 FP (0.90); leave alone. |
| 5 | Singles | 3 | ufpr 1.1.1 (disputed), gla.ac.uk 3.3.2 (disputed), correio 2.4.4 generic text | s3 test, s4 test | 3.3.2 has 0 TP in every study (0 / 1 here, 0 / 6 in the probe); the one 3.3.2 claim left as a finding could go to suggestions at no cost. |

After P0, by claim: 2.4.4 shared text 21 / 7; 1.1.1 `wrong_content` 5 / 9 (**0.36**, the weakest claim that is still a finding); 1.1.1 functional 18 / 2; 1.3.5 24 / 0; 3.1.2 8 / 8; 1.1.1 placeholder, decorative, generic 15 / 0; 3.1.1 1 / 0; 3.3.2 0 / 1.

## 4. What each fix does to precision and to true positives

Counterfactual filters over the same labels. "s4 test" is the only column no one has read; s4 dev was read to name the causes, so a filter chosen from it is tuned on it. All s2/s3 columns are in-sample.

| Filter | s3 test | s4 dev | s4 test | all | TP lost | Sample |
| --- | --- | --- | --- | --- | ---: | --- |
| today | 0.30 | 0.19 | 0.54 | 0.42 | | |
| **P0** planned fixes (guard on ufpe.br, H81 on toolstation.com) | 0.77 | 0.76 | 0.54 | 0.77 (0.68–0.83) | 0 | in / dev-read / out |
| **C1** P0 + the 3.1.2 burst gone | 0.77 | 0.76 | **0.78** | 0.82 (0.74–0.88) | 0 | the s4 test gain is a test-half number: a fix must be designed on dev (section 5, item 2) and measured on round 5 |
| **C2** P0 + 1.1.1 findings under 0.99 dropped | 0.83 | 0.87 | 0.54 | 0.80 (0.72–0.86) | 0 | 3 FP gone (1 s3 dev, 2 s4 dev), both dev; pre-registered in round 4 as a secondary, so the threshold is not new |
| **C4** P0 + C1 + C2 | 0.83 | 0.87 | 0.78 | **0.86 (0.78–0.91)** | 0 | |
| C3 every 2.4.4 shared-text claim a suggestion (no P0) | 0.83 | 0.87 | **0.29** | 0.77 | **21** | not recommended: trades tst.jus.br's 8 true findings and 13 more for what P0 removes anyway |
| B3 P0 + hard cap of 3 per page and criterion | 0.76 | 0.67 | 0.56 | 0.77 | 22 | a hard cap costs TP on every burst of true findings (tst, theconversation, correio) for 5 extra FP |
| B5 P0 + hard cap of 5 | 0.78 | 0.71 | 0.55 | 0.77 | 9 | same, less |
| B8 P0 + hard cap of 8 | 0.77 | 0.76 | 0.54 | 0.77 | 0 | removes nothing beyond P0 |
| K1 collapse groups of more than 5 (page, criterion, claim) into one page-level finding; no fix | 0.64 | 0.55 | 0.58 | 0.75 | counts change, not findings | a counting policy: a wrong burst costs 1 FP, a right one keeps 1 TP |
| K2 P0 + collapse | 0.67 | 0.60 | 0.58 | 0.76 | | |

Reading: the planned fixes are worth about +0.35 pooled on their own and cost nothing, because 100 of 129 false positives are the two bursts. Beyond them, the two zero-cost moves are the 0.99 cut (3 FP, dev-side) and whatever stops a page-level language problem from becoming 8 findings (8 FP on test, and 8 TP on dev that a person would count as one). A hard per-page cap is the wrong tool: it removes true findings on the pages Rampa gets right and barely touches what P0 leaves. Collapsing a burst into one page-level finding is the right shape for the same idea, and it is a reporting change, not a filter.

## 5. Ideas beyond rule tweaks

Each with expected gain, cost and risk. Gains are on the labels above unless marked "reasoned estimate".

1. **The planned fixes, as planned** (H81 context and hidden-menu awareness in the shared-text fact; the unstyled guard counting a same-origin `link rel=stylesheet` that resolves to the document as not a stylesheet; burst collapse). Gain: +0.35 pooled (P0), 0 TP lost; in-sample for ufpe.br, dev-read for toolstation.com. Risk: the H81 fact may also silence true shared-text sets whose list items differ for no reason; the labels hold 21 true shared-text findings on 6 pages to replay it on (in-sample) before round 5 says anything.

2. **A page-level language policy for 3.1.1 / 3.1.2** (not a second pass). Both 3.1.2 bursts in round 4 are one fact about the page repeated per paragraph: theconversation.com serves English under `lang="pt-BR"` (8 TP), and museudoamanha's 8 are a collector error by the judges' cause. Policy: when the language identifier reads most of the page's text as one language, report the page once (3.1.1 if `lang` disagrees, nothing otherwise) and send per-part 3.1.2 claims whose detected language equals the page's main text language to suggestions; keep 3.1.2 findings for parts whose detected language differs from both `lang` and the page's main text. Gain: s4 test 0.54 → 0.78 (C1, a test-half number, so a hypothesis for round 5, not a result); on dev it turns 8 TP into 1 (theconversation's 3.1.1 was dropped because the identifier read the page as Portuguese: that identifier mistake is the dev-side bug to fix first, and it is readable). Cost: a day; risk low, deterministic. Note that 3.1.2 had 4 TP / 1 FP across studies 1–3 and 8 / 8 in round 4: it was never measured on enough pages to trust either way.

3. **The 0.99 cut on the 1.1.1 second pass.** Gain: 3 FP, 0 TP on the labels (C2); it was pre-registered as a secondary in round 4, so adopting it is not tuning on new data. Risk: the 6 remaining `wrong_content` FP all confirm above 0.99, so it caps out quickly. The deeper fix is a milder claim: "the alternative is generic (avatar, licence name, role word)" as a 1.1.1 suggestion, with `wrong_content` kept for descriptions that contradict the image. Reasoned estimate: removes most of the 9 at the cost of 0–2 of the 5 true `wrong_content` findings; needs the dev pages to write and round 5 to measure.

4. **A second pass for other criteria (2.4.4, 3.1.2, 3.3.2).** The probe measured the one-word framings' AUROC: 0.89–0.91 on 1.1.1, but **0.47–0.60 on 2.4.4**, where P(fail) is 0.95–1.00 on true and false alike. A second pass on 2.4.4 would keep almost everything; the data say no. 3.3.2 has 0 TP in 4 studies: a pass cannot help a claim with nothing to keep; make it a suggestion (item 6). 3.1.2 is a page-level fact (item 2). Gain: ~0; cost: 3 calls per candidate; **not recommended on this evidence**.

5. **A stronger or second local model as verifier.** Not measured here. What the labels say: the errors that remain after P0 are not reading errors (the model read "Autor avatar" and the image correctly) but criterion judgments (is a generic alternative a 1.1.1 failure; do nested list items give link context). A larger model may judge those better; the literature report expects a panel of two families to help and notes no measurement at ~12B. Reasoned estimate: at most the 9 `wrong_content` and 5 disputed/misapplied 2.4.4 FP are in reach (14 of 29), at a 2× call cost and a second 8–12 GB model; risk that the two models agree on the same mistake, since Gemma's confirmations on them were above 0.99. Worth one experiment on the dev halves only after items 1–3, with a fixed verifier prompt written before looking at any s4 test finding.

6. **Per-criterion "report or only suggest" policies.** The labels now support a table: 1.3.5 (24 / 0), 1.1.1 placeholder, decorative, generic (15 / 0), 3.1.1 (1 / 0), 1.1.1 functional (18 / 2) are safe to report; 2.4.4 shared text is 21 / 7 after P0 and should stay a finding; 1.1.1 `wrong_content` at 5 / 9 is at the edge and is the case for item 3's split; **3.3.2 (0 / 1 here, 0 / 6 before) and 2.4.2 (0 / 5 before, 0 / 2 below threshold now) should be suggestions until a study shows a true one.** Gain: 1–2 FP, 0 TP; cost: a line each; risk: none measured. The literature's "Learn then Test" thresholds per criterion need 100–500 human labels per criterion, which only 1.1.1 and 2.4.4 will have soon.

7. **Page-level burst control as collapse, not cap.** Section 4: a hard cap costs 9–22 TP for 3–5 extra FP (B3/B5); collapsing a group of more than 5 same-claim findings on one page into one page-level finding ("21 department links share text with 2–4 others; see the list") costs no finding a person would miss and makes a wrong burst cost one error. Gain: a finding-level precision that stops being decided by one page (K2: s3 test 0.67, s4 dev 0.60, s4 test 0.58, no half under 0.58); cost: a reporting change plus the Lab review mode; risk: the headline number drops where bursts were true (s4 test 0.58 against 0.54 is flat; s3 test's 24 TP become 14). Report both counts.

8. **Calibration with the human-label sample.** The 39-item suggestion sample and the 93 findings of round 4 are the start of a blind human sample. Priorities from the data: (a) label every finding on museudoamanha, toolstation.com and ufpe.br by hand first, since three pages decide three halves and the Claude judges' cause on them ("collector error", "criterion misapplied") is what the fixes rest on; (b) a stratified 100 across claims with at least 15 `wrong_content` and 15 shared-text; (c) compute Claude-judge agreement with the humans per claim before any threshold is fit. Gain: not precision but the right to report it; cost: ~3–4 hours of two people; risk: the two Claude judges' kappa 0.84–0.92 measures consistency, and the human sample may move the 0.54 in either direction.

9. **Capture improvements.** Round 4's capture table shows the remaining risks: 4 pages cut at 5,000 elements (mackenzie.br kept no image, link or heading at all), 4 still changing at 3 s, 315 of 316 links `aria-hidden` on hospitalmoinhos.org.br when read, consent layers on 3 pages. None produced a labelled FP in round 4, but mackenzie.br and hospitalmoinhos.org.br produced nothing to judge, which is a recall hole, and the cut's order decides which candidates the model sees. Gain for precision: ~0 on these labels; the unstyled-guard fix is the one capture item with a measured misfire (4 suggestions on thejournal.ie, 1 of them a true 1.1.1 finding lost). Cost: medium; risk: low.

10. **Reporting precision per page as well as per finding.** The page bootstrap in round 4 (0.13–0.92 for a point estimate of 0.54) already says the finding-level interval is false precision. Report three numbers from round 5 on: findings (as now), collapsed findings (item 7), and the share of pages with at least one finding on which every finding is right. On round 4 that last number is 8 of 14 pages with findings (dev: osesp 1 of its 6 wrong, cobasi, es.gov.br, infomoney 1 wrong, theconversation 1 wrong, toolstation all wrong, nls wrong; test: museudoamanha all wrong, ufpr 1 wrong, tst right, r7, nhm, gla 1 wrong, fueleconomy wrong, mdanderson 1 wrong), a rough count from the per-page FP list, to be recomputed by script.

11. **What the data show that was not on the list.** The remaining per-page errors (section 3, rows 2–5) are 1 a page, 21 over 17 pages, and most are *disputed* or *criterion misapplied* rather than *model error*: the model and its second pass agree with each other above 0.99 and disagree with the judges on what the criterion means. Prompt or verifier changes aimed at reading will not move these; a clearer rubric for the two contested claims (generic alternative; context from enclosing list item or heading) will, and the same rubric must go to the human labellers, or the labels and the code will keep disagreeing by definition.

## 6. Ranked plan for the next iteration

| # | Item | Expected precision effect | TP cost | Evidence |
| --- | --- | --- | --- | --- |
| 1 | H81 / hidden-menu context in the shared-text fact; unstyled-guard self-reference fix | pooled 0.42 → 0.77; s4 dev 0.19 → 0.76 | 0 of 95 on the labels; the H81 fact must be replayed on the 21 true shared-text findings first | in-sample (ufpe) / dev-read (toolstation) |
| 2 | Page-level language policy (3.1.1 once, 3.1.2 per part only when the part differs from the page's main text); fix the identifier that read theconversation.com as Portuguese | s4 test 0.54 → 0.78 if museudoamanha's 8 are what the cause says | 8 dev TP become 1 | the s4 test number is a hypothesis: design on dev, measure in round 5 |
| 3 | The 0.99 cut (already pre-registered) and a "generic alternative" suggestion class split off `wrong_content` | +0.03 pooled from the cut; the split is a reasoned estimate of up to 6 more FP | 0 from the cut; 0–2 from the split | dev-side, in-sample |
| 4 | 3.3.2 and 2.4.2 judgment claims to suggestions until a true one is seen | +1–2 FP | 0 | 0 TP in four studies |
| 5 | Burst collapse in the report, plus per-page precision alongside per-finding | changes what is counted: no half under 0.58 after items 1–4 (K2) | none; fewer rows | counting policy |
| 6 | Human labels: the three deciding pages by hand, then a stratified 100 | none directly; the right to report | – | – |
| 7 | Second-model verifier experiment on dev halves only, fixed prompt | reasoned: up to 14 of the 29 remaining FP in reach; likely less | unknown | not measured |
| – | Second pass on 2.4.4 / 3.3.2; hard per-page caps; all 2.4.4 to suggestions | no (AUROC 0.47–0.60; 9–22 TP lost; 21 TP lost) | | measured, rejected |

Expected after items 1–4, on these labels: 0.86 (0.78–0.91) pooled, 0.78 on the only unread half, 0 TP lost. In-sample for everything but that 0.78, which itself must be re-earned on new pages.

## 7. Measuring it honestly: round 5

- **Pre-register before any page loads**: 24 new pages by the round 4 design and exclusions (2,111 + round 4's 24 domains); the seeded split; the primary measure = test-half precision at the default threshold over judged criteria, with Wilson and the **page-level bootstrap as a co-primary interval**; the comparison with round 4's test half (0.54, 14 of 26) by Newcombe and by the page bootstrap, reading "went up" only when both exclude 0.
- **Pre-registered secondaries**: collapsed-finding precision (item 5) and per-page all-right share; 3.1.x findings per page and whether a 3.1.1 page-level finding co-occurs with 3.1.2 parts; the H81 fact's denials labelled (as the second pass's were in round 4) so its TP cost is measured; the 0.99 cut's effect; a suggestion sample again (20 a split), stratified to include the new suggestion classes (generic alternative, 3.3.2, 2.4.2, 3.1.2 parts); capture state per page, with the unstyled guard's trigger logged.
- **Ablations by replay** (same snapshots, cache read back): with and without the H81 fact; with and without the language policy; with and without the 0.99 cut. Each is one filter over the same answers, so its TP cost is exact.
- **Human sample**: before round 5 is run, two people label blind, in shuffled order, with the round 3 rubric: every finding on museudoamanha, toolstation.com and ufpe.br, and a stratified 100 of rounds 3–4's findings. Report human–Claude agreement per claim; if it is under 0.8 on `wrong_content` or shared text, the Claude labels on those claims are a pre-annotation only and round 5's numbers on them must say so.
- **Rules**: `src/` frozen at the pre-registration commit; the test half counted, not read; one run; nothing chosen from a test page; every exploratory number marked.

## 8. Not finished in the 30 minutes

- The H81 fact was not replayed on the 21 true shared-text findings; item 1's "0 TP lost" assumes the fact only removes toolstation's 50.
- The page-level all-right share (item 10) is a hand count from the FP list, not a script.
- The 3.1.2 policy's effect on museudoamanha rests on the judges' cause word; the page was not read, by the round 4 rule.
- No second-model or Ollama experiment was run.
- The literature report was skimmed for its ranked levers only (deterministic facts first, logprobs and agreement as signals, per-criterion thresholds after 100–500 human labels, a second judge of another family as a later experiment); its sample-size tables were not reconciled with the plan above.

## Data

`study/notes-precision-next/remaining.py` (run from the repository root with `python -I`) and its output `remaining.md`. It reads `study/notes-precision-probe/data/rows.json` and `data/impl/*.report.json`, `study/round-3-2026-10-23/data/pages-input.json`, `study/fresh-2026-10-11/data/pages-input.json` and `study/round-4-2026-10-24/data/findings.json`.

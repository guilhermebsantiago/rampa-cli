# After round 5: what would move precision toward 0.9, and what it would take to show it (2026-10-29)

Analysis and research only. Nothing here changes Rampa's shipped behaviour; the one prototype is a diff under `study/notes-precision-round5/data/` that was built apart, replayed, and reverted. Every number is marked **held-out** (the fifth study's test half, counted and never read), **dev** (the fifth study's dev half, read), **in-sample** (the second to fourth studies, all read, or the fifth study's dev half once a rule has been chosen on it) or **projected**. The fifth study's test half was used only for counts of a rule's effect, and only for the rules chosen first on the other data.

**In short.** The [fifth study](real-pages-2026-10-round5.md) measured 0.83 on its test half (held-out, 20 / 4, Wilson 0.64–0.93) and 0.81 pooled (51 / 12). The twelve pooled false positives have three sources: a burst of 7 generic "Leia mais" links on one dev page plus one "More" menu toggle (2.4.4, 8), and 4 1.1.1 reading claims on the test half that every second-pass framing confirmed at 0.991 or more. On the other side, the second pass denied 6 true 1.1.1 findings on one dev page. Three deterministic changes, replayed offline on every recorded snapshot of the second to fifth studies (84 pages) and on the W3C ACT 2.4.4 cases, would remove 8 of the 12 pooled false positives and recover 6 of the denied true findings at **no measured cost**: on the labelled claims of four studies they move no true finding, change no ACT case or pair, and ask no new model call. On the fifth study's pages that would read **57 / 4 (0.93, pooled; in-sample, since the rules were chosen on its dev half)**; on the test half alone nothing changes (20 / 4, 0.83, held-out), because the test half had no generic 2.4.4 finding and no repeated alternative text. The four false positives that remain are the hard kind: the model misreads an image and repeats the misreading with high probability under every framing; no threshold on the second pass reaches them, and a deterministic fact catches only the social-icon subset (4 of 14 such in-sample false positives, 0 true findings). **Reaching 0.9 on fresh pages is plausible after these fixes but not shown**: the honest projection for a sixth round is **0.84–0.92 pooled per element (central 0.88)**, with the lower end set by whichever new burst mechanism the next 24 pages bring, as every round so far has brought one. **Showing "0.9 or more" is a sampling problem before it is a precision problem**: with 2.6 findings a page and a page design effect of 1.9 (fifth study), a lower bound of 0.85 at an observed 0.92 needs about 90 effective findings, about 180 raw findings, about 70 pages; at an observed 0.90 it needs 184 effective, about 360 raw, about 140 pages. A 24-page round cannot show it whatever its result. And every label so far is a pre-annotation by two Claude judges; the blind human sample is still owed.

## 1. Where the false positives are now

Judgment findings at the default threshold over the judged criteria, after the fixes of [notes-precision-fixes](notes-precision-fixes.md), by what caused them. Sources: the in-sample replay (`study/notes-precision-fixes/data/after/summary.json`: 95 / 16 / 5 on 72 pages, s2–s4), the fifth study's dev half (31 / 8 / 1, read) and its test half (20 / 4 / 1, counted by check and cause only).

| Cause | In-sample s2–s4 (after the fixes) | Fifth, dev | Fifth, test (counts) | Pool |
| --- | ---: | ---: | ---: | ---: |
| 1.1.1 reading claim confirmed by every framing at ≥ 0.99 | 7 | 0 | 4 | 11 |
| 2.4.4 generic text in a card with a heading (H80) | 0 | 7 | 0 | 7 |
| 2.4.4 generic text on a disclosure toggle (`href="#"` + submenu) | 0 | 1 | 0 | 1 |
| 2.4.4 generic text inside an ad's own link (nested `role=link`) | 1 | 0 | 0 | 1 |
| 2.4.4 shared text, the link names its destination | 2 | 0 | 0 | 2 |
| 2.4.4 shared text, other (two videos with one title; a scripted redirect; a logo and a department) | 5 | 0 | 0 | 5 |
| 3.3.2 field named by `title` only | 1 | 0 | 0 | 1 |
| **All** | **16** | **8** | **4** | **28** |

Three readings. First, **the generic-text claim of 2.4.4 has never been right at the default threshold on a real page**: over the four studies it produced 9 false, 2 uncertain and 0 true findings (in-sample and dev), while the same criterion's shared-text claim is 35 true to 7 false. Second, **1.1.1 is now the largest residual and the only one on the held-out half**: 11 of the 28 pooled false positives are confirmed reading claims, and the second pass's probability cannot separate them (the 4 held-out ones passed every framing at 0.991 or more, the 7 in-sample ones at 0.998 or more, while true findings are confirmed from 0.992 up). Third, **bursts still decide a half**: 7 of the dev half's 8 false positives are one page's one mechanism, as in rounds 3 and 4.

The other side of the ledger, what the rules cost: the second pass denied 6 true claims on one dev page (hering, seven payment logos with `alt="payment"`, one confirmed and six denied), 1 in-sample (tst-ouvidoria), and 10 uncertain; the labelled suggestion sample held 3 true failures in 40 (0.08, held-out).

## 2. Proposals, ranked

Each proposal states the data it was chosen on, the false positives it removes (by page), the true findings it costs, its cost on the ACT cases and the suggestions, the effort, and the overfitting risk. P1–P4 are measured by offline replay (`study/notes-precision-round5/`); P5–P9 are projected.

### P1. The card's heading completes a generic link text (H80), and a disclosure toggle is not a link to judge — measured

**What.** Two facts added to the 2.4.4 `generic` grounding (`groundedLink`, `src/criteria/link-purpose.ts`), prototype in `data/g1-variant.diff`:

- `cardHeading`: the nearest preceding heading, when it and the link share an ancestor at most **2 levels** above the link whose whole text is at most **300 characters**. That is a news card built of `div`s: heading (itself a link to the article), blurb, "Leia mais". The link has no sentence, list item or cell of its own, and today's `linkContext` sees a block of over 250 characters and gives up; the prompt already tells the model that "the heading above it" is context, but the fact did not, so the model's "nothing around it says where it leads" was grounded. With the fact, such a fail is a suggestion.
- `menuToggle`: an `href` of `#`, none or a script, with a list after the link inside the link's own list item. Horniman's "More" opens a submenu; the 2.4.4 mismatch fact already leaves controls out, the generic fact did not.

**Chosen on:** the fifth study's dev half (pucrs, horniman) and the in-sample generic findings of s3 and s4.

**Effect, replayed on every snapshot (`link-facts.ts`, `analyze_links.py`):**

| Set | Generic findings moved to suggestions | Of them false | True | Uncertain |
| --- | ---: | ---: | ---: | ---: |
| In-sample s2–s4 | 1 (infomoney "Veja mais", `menuToggle`) | 0 | 0 | 1 |
| Fifth, dev | 8 (pucrs 7 by `cardHeading`, horniman 1 by `menuToggle`) | 8 | 0 | 0 |
| Fifth, test (counts only) | 0 | 0 | 0 | 0 |

Every threshold of the card rule from depth 2 / 300 characters up to depth 8 / 2,000 moves the same 7 and nothing else, so the rule is not sitting on an edge; the frozen choice is the tightest (2 / 300). A sibling rule, "another link in the same card leads to the same place with a non-generic name", moves 6 of the 7 and is kept as a note, not a proposal. On all 84 snapshots the generic fact grounds 58 link candidates; the card rule un-grounds 54 of them (42 on pucrs, 11 on correio24horas, where the model passed them anyway) and 1 of the 4 on the test pages.

**True findings cost:** 0 of 0. There is no true generic finding in any study to lose.

**ACT cost:** none. `rampa eval --criteria 2.4.4` with the main build and the prototype build, same cache, 102 candidates, 0 new model calls: identical results on c487ae (28), 5effbb (18, recall 0.83), fd3a94 (24, 0.88), the 34 pairs (0.95), link-generic pairs 11 / 11, link-mismatch 9 / 10 (`data/evals/244-main.txt`, `244-g1.txt`). The 5effbb failed examples have no heading in a card around the link and no toggle.

**Suggestions cost:** the 8 moved claims are false, so the suggestion list gains 8 false items and 0 true; the test half's suggestion list would gain 1 item (count only, its label unknown).

**Effort:** small; the prototype is 121 diff lines, typed and built. It should also pass `cardHeading` into the prompt as "Heading of the card the link sits in", which changes the cache key for 2.4.4 and so costs one re-judging of recorded pages before any replay.

**Overfitting risk:** medium-low. The mechanism (a `div` card with a heading that is itself a link) is the commonest layout of a news or course list on the web, and H80 names it; but the 7 findings it was measured on are one page's. It must be measured on fresh pages before it counts.

### P2. Confirm identical reading claims on one page together — measured

**What.** In the 1.1.1 second pass (`src/core/confirm.ts`), on one page, claims with the same normalised alternative text and the same verdict form a group; **one confirmed member confirms the group** ("C-any"). Today the three framings are asked of each copy, so seven payment logos with `alt="payment"` split into one finding and six suggestions on the luck of one framing's word on one copy (two copies drew a passing word from one framing; three were confirmed by every framing at 0.53–0.69; one at 0.959).

**Chosen on:** the fifth study's dev half (hering), checked against s2–s4.

**Effect, on the 165 labelled reading claims with recorded second-pass answers (`confirm_groups.py`: s2 and s3 from the precision probe's verifier runs, s4 and s5 dev from the main reports' probabilities):**

| Rule | Confirmed: TP / FP / uncertain | Gained | Lost |
| --- | --- | --- | --- |
| Shipped (every framing confirms, min ≥ 0.99) | 41 / 12 / 2 (0.77) | | |
| C-any | 48 / 14 / 2 (0.77) | +7 TP (hering 6, cnj-ouvidoria 1), +2 FP (puc-rio 1, cobasi 1) | 0 |
| C-majority | 40 / 12 / 2 (0.77) | 0 | 1 TP (hering) |
| C-mean (group's mean min ≥ 0.99) | 38 / 11 / 2 (0.78) | 0 | 3 TP, 1 FP |

The s2 and s3 rows of this pool are the precision probe's verifier run over the studies' first-pass claims, an approximation of the shipped pass: 5 of its 12 confirmed false claims are ones the shipped pipeline no longer reports for other reasons (the in-sample residual of the fixes notes is 7). The s4 and s5 rows are the shipped pass's own probabilities.

Groups of two or more claims with one alternative on one page: 11 (34 claims), with mixed verdicts in 4 (hering `payment` 1 confirmed of 7, all true; cnj "Botão Rybená LIBRAS" 1 of 2, both true; puc-rio "Imagem de alunos no Campus" 1 of 2, both false; cobasi "ilustracao svg demonstrativa cachorro" 1 of 2, one true and one false). On the fifth study's test half there is no group of two (16 claims, counts only), so C-any changes nothing there.

**Gain:** 7 true findings for 2 false, precision of the confirmed set unchanged at 0.77 in-sample; on the fifth study's dev half +6 TP and 0 FP, which moves 1.1.1 from 13 / 0 to 19 / 0 on dev and the pooled fifth-study count from 51 / 12 to 57 / 12. The two false ones it adds were already half-confirmed: their twin was a finding.

**ACT cost:** none to measure: no ACT 1.1.1 test page repeats an alternative on images with a reading claim. **Suggestions:** 7 true items leave the review list.

**Effort:** small (group by page and alternative before the pass; or run the pass on one representative and copy its outcome). **Risk:** low-medium: the gain is one page's; the mechanism (identical alternatives on identical logos) is common in footers.

### P3. An image-only link to a social network whose alternative names the network is not a 1.1.1 failure — measured, small

Of the 12 confirmed false 1.1.1 claims in the pool above, 4 are social icons: "istagram" (a typo of Instagram, link to instagram.com), "X" (the X logo, link to twitter.com), "x icon" (the same), and one more where a word of the alternative is within edit distance 2 of a label of the link's hostname. On the 55 confirmed claims, the fact `altNamesHost` (a word of the alternative is a known network's name or within edit distance 2 of a hostname label of the link) selects **4 false, 0 true, 0 uncertain** (`image-facts.ts`). Moving them to suggestions costs nothing measured. It is a narrow rule; its value is that this is one of the few residual 1.1.1 patterns a fact can name. The other residual patterns (an alternative that names the card's topic rather than the picture, "Connect with us" above an `h3` of the same text; a stock photo described as "students on campus"; a thumbnail named "fullepisode") need a reading of the picture, not a fact: a broader fact, "the alternative occurs in the card's own text", selects 9 false but also 24 true (file names and placeholders repeated in a caption), so it is no use.

**Chosen on:** in-sample (s2–s4); dev and test have no such claim. **Risk:** low (the rule is tiny and keyed to a fixed list plus the link's own host). **Effort:** small.

### P4. A shared-text claim on a link whose text names its destination — measured, small

When Rampa read the destination and its title or heading contains the link's text ("Direito e Justiça" to the section "Direito e Justiça"; "Pimoroni" to the collection "Pimoroni"), the ambiguity is with another link that leads elsewhere under the same text, but this link names where it goes; ACT fd3a94 would still fail it, the judges did not. The fact selects **2 false, 0 true** of the 44 shared-text findings in-sample (`analyze_links.py`, A1). Rampa read the destination of only 15 of the 44, so the fact rarely applies. The remaining 5 shared-text false positives have no deterministic handle (two YouTube videos with one title apart from casing; a scripted redirect that makes two "Ouvidoria" one place; a logo and a department both named "Pimoroni"; "Capa" to the home page). **Effort:** small. **Risk:** low; the gain is small too.

### P5. Report the generic-text claim of 2.4.4 as a suggestion unless the ACT-style fact holds — projected, not recommended as a whole

The claim's record on real pages is 0 true in 11 at the default threshold (sections 1 and P1). A per-claim abstention, "generic fails are suggestions", would have removed 9 false and 0 true findings over the four studies, but on the ACT cases it costs 5 of the 6 failed examples of 5effbb and 8 of the 11 link-generic pairs, which are exactly this claim (`data/evals/demo-after` from the precision-fixes notes). P1 takes the same false positives for no ACT cost, so the whole-claim abstention is not needed. What is worth doing is the policy in P7: the claim's held-out record should be in the report.

### P6. The 1.1.1 residual: what could reach the 11 confirmed misreadings — projected

The 4 held-out and 7 in-sample false 1.1.1 findings all passed every framing at ≥ 0.991. Options, with what can be said of each without a new model run:

- **Self-consistency on the first pass** (several samples at temperature, keep the majority; [Wang et al. 2022](https://arxiv.org/abs/2203.11171)). The second pass is already a three-framing vote on the same model, and these 11 claims passed all three with near-certainty: a model that is confidently wrong at temperature 0 will mostly be confidently wrong at temperature 0.7. Projected gain on these 11: small. Cost: 3–5× the first-pass calls (judging already takes a median of 145 s a page at concurrency 2). Not recommended for 1.1.1; it may help the calibration of `confidence` elsewhere (P8).
- **A second, different model as verifier.** The misreadings are of the picture (a stock photo of students called wrong for "Imagem de alunos no Campus"; a logo called wrong for "Connect with us"), so a second reading by the same model family inherits the same error. A different family breaks the correlation. What fits beside Gemma 4 12B (8.0 GB at Q4_K_M) on a 16 GB RTX 5060 Ti: a second 4B-class vision model (2–3 GB) at the same time, or a 12B-class one loaded in turn (Ollama unloads the first; each switch costs seconds). A 26B or 31B Gemma 4 (third-party reports of the Ollama tags put them at 16–19 GB and 19–20 GB at Q4_K_M; not pulled, see the sources) does not fit in 16 GB with its KV cache; a Q8 12B (~13 GB) would, as a check of whether quantisation noise is part of the misreadings. **No model was pulled for these notes.** Projected: the only route to the residual 1.1.1 false positives; its cost on true findings is unknown until measured on the 165 labelled claims, which the recorded crops make possible offline (`confirm-claims.json` has every claim with its image ref).
- **Stricter evidence for a `wrong_content` claim.** Require the model to name what the image shows (`imageShows`, already in the output) and fail only when a deterministic comparison finds no shared word between `imageShows`, the alternative and the card's text. On "Connect with us" (a photo of two people talking) the alternative shares no word with `imageShows`, so this would not have helped; on "Imagem de alunos no Campus" (two students) it would have. Projected: catches some; measurable offline on the 55 confirmed claims since every first-pass output is cached. Effort: medium.
- **Visual check from the screenshot** is what the second pass already does (the framings carry the crop). The failure is the reading, not the absence of the picture.

### P7. Report precision by claim, and gate the default threshold on it — projected, policy

Rampa's held-out record is now by claim kind: 1.3.5 9 / 0, 2.4.4 shared text 19 / 0 held-out (35 / 7 with in-sample), 2.4.4 generic 0 / 8, 1.1.1 placeholder and file-name claims 20 / 0 (in-sample, confirmed by no pass), 1.1.1 reading claims 9 / 4 held-out after the pass, 3.1.2 2 / 0, 2.4.6 1 / 0. The report could carry the measured record of each claim kind next to its findings (as the benchmark page does for rules), and the default threshold could admit only claim kinds whose pooled held-out lower bound (Wilson 95%) is at or above a stated value, the rest listed as suggestions until a round shows otherwise. This is axe-core's "incomplete" and IBM's "Needs review" design applied per claim with a measured rule rather than a judgment of the rule's author. Cost: the generic 2.4.4 claim and the 1.1.1 reading claim would both fall below a 0.8 bound today; the first costs nothing on real pages (P5), the second would cost 9 held-out true findings (and 41 in-sample) for 4 (14) false, which is too much, so the reading claim stays and P2/P6 work on it. **Effort:** medium (a table of records in the repository, read by the report). **Risk:** none on precision; the risk is recall and that the table goes stale.

### P8. Calibration of `confidence` — projected

The default threshold reads the model's own `confidence` word (medium or high). On the fifth study the only finding below the threshold among the judged criteria was false, and all 8 dev false positives were "high": the word carries little. A calibrated score would come from (a) the second pass's minimum probability, already computed for 1.1.1, extended to 2.4.4 and 2.4.6 fails by asking the same one-word framings (cost: 3 short calls per fail, under a second each on this GPU; the fails are 1–5% of the candidates); (b) a small table mapping (claim kind, grounding fact present, min probability bin) to a measured precision from the labelled pools, with [conformal abstention](https://arxiv.org/abs/2405.01563) giving a bound on the error of what is shown. The labelled pools (165 1.1.1 claims, 118 2.4.4 claims) are large enough for coarse bins, not for a bound. Effort: medium. Risk: in-sample until a round 6.

### P9. Deduplication across bursts, in the counting — policy

The report already groups 6 or more findings of one claim on one page (`src/core/groups.ts`), and the fifth study reports per group next to per element (0.86 against 0.81). The per-element number should stay primary (it is what a reader of the report sees), but the pre-registration of round 6 should keep both and add a third: **the share of pages whose decided findings are all true** (13 of 18 in the fifth study), which is the number a person running Rampa on one page cares about. No code.

## 3. What the measured proposals add up to

On the fifth study's pages (both halves), replayed: P1 removes 8 false findings (dev), P2 adds 6 true (dev), P3 and P4 nothing (no such claim on those pages). Pooled 51 / 12 (0.81) becomes **57 / 4 (0.93)**; per group 38 / 6 becomes 44 / 5 (0.90); the test half stays **20 / 4 (0.83, held-out)**. Over the four studies' 183 pooled default-threshold findings (in-sample s2–s4 95 / 16, fifth both halves 51 / 12): 146 / 28 (0.84) becomes 161 / 14 (0.92), in-sample.

These are in-sample numbers in the sense that matters: P1 and P2 were chosen on the pages they are measured on, and the record of this project is that an in-sample 0.86 became 0.81–0.83 held-out, with each new round bringing one burst mechanism not seen before (toolstation's hidden footer list, ufpe's unstyled capture, pucrs's cards). The residual after P1–P4 is almost all 1.1.1 misreadings (4 held-out, 7 in-sample), at roughly 1 in 6 of the confirmed reading claims, and no measured proposal touches them.

**Projection for a sixth round of 24 pages (projected):** pooled per element 0.84–0.92, central 0.88, if P1–P4 ship and nothing else changes; the lower end is one new burst on one page (as 7 findings on 60 would cost 0.10), the upper end is a round with none. A test half of 12 pages would carry a Wilson interval about ±0.13 wide around whatever it measures, so a sixth round of the fifth's size cannot show 0.9 even if it reaches it. With P6's second verifier, if it halves the confirmed misreadings at no true cost, the central projection is 0.91; that "if" is unmeasured.

## 4. What showing "0.9 or more" would take

**Sample size** (`sample_size.py`). Wilson's 95% lower bound reaches 0.85 at an observed 0.90 only from n = 184 decided findings; at an observed 0.92 from n = 92; at 0.95 from n = 45. Findings cluster on pages: the fifth study's 63 decided findings on 18 pages have an intra-page correlation of 0.375 and a design effect of 1.94, so the effective n is about half the raw n. At the fifth study's rate (2.6 decided findings per collected page, 3.5 per page with a finding):

| Effective findings | Raw findings (design effect 1.94) | Pages | What it shows |
| ---: | ---: | ---: | --- |
| 92 | ~180 | ~70 | lower bound 0.85 if the observed precision is 0.92 |
| 120 | ~230 | ~90 | lower bound 0.85 at 0.91; 0.83 at 0.90 |
| 184 | ~360 | ~140 | lower bound 0.85 at an observed 0.90 |

The chance that a round gives a lower bound ≥ 0.85 when the true precision is 0.90 is 0.11 at n = 63 and 0.56 at n = 200 (no clustering); at a true 0.92, 0.25 and 0.88. **A round 6 that wants a 0.9 lower bound around 0.85 needs about 90 pages if precision is really about 0.91–0.92, and about 140 if it is 0.90.** Three rounds of the fifth's design, pooled under one pre-registration, is the practical shape: 72 pages, 12 strata × 6, the same exclusions, collected and judged over three sessions, with the primary measure defined on the pooled set and the page bootstrap co-primary. It is also the sample at which the per-criterion numbers (1.1.1 20 / 4 today) start to say something on their own.

**Labels.** All labels are two Claude judges of one family, with kappa 0.82 on the judged criteria and 0.10 on the experimental rules; their mistakes are correlated and the human sample the notes have asked for twice has not been done. A defensible claim needs: (1) a blind human sample, stratified by label and criterion, of at least 100 findings over rounds 3–5 (every finding on the burst pages plus a seeded draw), with the human–Claude agreement per criterion reported, and the human label taking precedence where they differ; (2) in round 6, a human adjudication of every disagreement between the two judges and of a seeded 30% of the agreements, before the counts; (3) the rubric fixed as it is (`study/round-5-2026-10-28/judge-rubric.md`), so that the human and the judges answer the same question. Two human raters on the sample, with their own agreement reported, would make the ground truth independent of this project's author; one rater is the minimum. Without this, "0.9" is "0.9 by Claude's reading", and should be written so.

**Precision only.** No round audits pages for what Rampa misses; the ACT cases (recall 0.71 of failed examples at the default threshold) and the suggestion samples (3 true in 40) are the only recall numbers. A claim of reliability needs both; the pre-registration of round 6 should include an expert audit of 1.1.1 and 2.4.4 on a seeded 6 of the 24 pages, so that recall on real pages is measured once.

## 5. What other checkers and the research do about false positives

- **axe-core** states "zero false positives" as a design principle and returns, beside violations, an `incomplete` array of what it could not decide, which the Deque extension calls "Needs Review": a result the tool does not have enough information to pass or fail, left to a person ([axe-core README](https://github.com/dequelabs/axe-core); [Deque, Needs Review vs Incomplete](https://docs.deque.com/devtools-for-web/4/en/needs-review-incomplete)). Rampa's `needsReview` is the same shape; what Rampa adds is measuring, per claim kind, how often the "decided" bucket is right (P7).
- **IBM Equal Access** reports Violation, Needs review and Recommendation, and its own verification guidance treats a Needs review as something to resolve, not to ignore ([IBM, Verify with automated tools](https://www.ibm.com/able/toolkit/verify/automated)).
- **Siteimprove (Alfa)** writes that false positives are the reason some criteria stay manual: "if a test produces too many false positives, we can't in good conscience recommend automated testing", and recounts one faulty rule that produced tens of millions of false positives before a fix ([Siteimprove, how accessibility testing rules are created](https://www.siteimprove.com/blog/behind-curtain-how-accessibility-testing-rules-are-created/)). Alfa's ACT implementation report lists 27 WCAG rules consistent in fully automated mode and 29 in semi-automated ([W3C, Alfa ACT implementation](https://www.w3.org/WAI/standards-guidelines/act/implementations/alfa), [assisted](https://www.w3.org/WAI/standards-guidelines/act/implementations/alfa-assisted)); the ACT rules format's `cantTell` outcome is the standard's name for the same bucket.
- **Vigo, Brown and Conway (W4A 2013)** benchmarked six tools against an expert audit: coverage at most 50% of criteria, completeness 14–38%, and the tools that caught more also produced more false positives, with correctness of 66–71% ([DOI 10.1145/2461121.2461124](https://doi.org/10.1145/2461121.2461124)). Rampa's 0.81–0.83 held-out, with a model in the loop, sits above that range for the criteria it judges, on a different page sample and a different labeller; the comparison is loose.
- **Self-consistency** (Wang et al., ICLR 2023) samples several reasoning paths and keeps the majority answer, with large gains on arithmetic; it addresses variance, not confident systematic error, which is what the residual 1.1.1 misreadings are ([arXiv 2203.11171](https://arxiv.org/abs/2203.11171)).
- **Conformal abstention** (Abbasi-Yadkori et al. 2024) calibrates an abstention rule on a held-out set so that the error rate of what the model does answer is bounded ([arXiv 2405.01563](https://arxiv.org/abs/2405.01563)); applied to Rampa, the calibration set would be the labelled claims, the score the second pass's minimum probability, and the guarantee would hold for pages drawn like the calibration pages, which is the same exchangeability the studies already assume. Conformal intervals for LLM judges ([Sheng et al. 2025, arXiv 2509.18658](https://arxiv.org/abs/2509.18658)) are the matching tool for the labels themselves.
- **LLMs for accessibility evaluation**: a 2026 systematic review of 38 studies finds WCAG the dominant frame and few studies with users with disabilities ([arXiv 2605.13873](https://arxiv.org/abs/2605.13873)); an ASSETS 2025 benchmark of five LLMs on document accessibility reports accuracy up to 0.85 and trouble with "cannot tell" classes ([arXiv 2509.18965](https://arxiv.org/abs/2509.18965)). None found reports precision on live pages with human labels at the scale Rampa's rounds already have, which is a reason to publish the rounds' data.
- **WCAG-EM 2.0** gives the shape of a page sample (a structured part and a random part) and says a sample never supports a conformance claim for a whole site ([W3C, WCAG-EM 2.0](https://www.w3.org/TR/wcag-em-2/)); Rampa's rounds measure the tool, not a site, and should keep saying so.
- **Model sizes** (for P6, not pulled): third-party guides to the Ollama `gemma4` tags list `12b` at about 7.6–8.0 GB, `26b` (a mixture of experts, 25.2B total) at 16–19 GB and `31b` (dense) at 19–20 GB at Q4_K_M ([one such guide](https://www.swfte.com/deploy-models/ollama-gemma-4)); the library page is the authoritative check, and the local `ollama list` shows `gemma4:12b` at 8.0 GB, Q4_K_M, on a 16 GB RTX 5060 Ti.

## 6. Recommended order

1. **Ship P1 and P2** (with P3 and P4 if cheap), each with its unit cases, the prompt line for `cardHeading`, and the thresholds frozen as above; replay on the 84 recorded pages to confirm the exact counts of section 3 (no model call for P1; P2 needs none either, the answers are cached).
2. **Do the human sample first** (section 4), on rounds 3–5, before round 6 is collected; report human–Claude agreement per criterion and re-state rounds 3–5 with the human labels where they differ.
3. **Pre-register round 6 as three sessions of 24 pages (72)** with the fifth round's design, P1–P4 frozen, per element, per group and per page as co-reported measures, and an expert recall audit of 6 pages.
4. **Measure P6 offline** on the 165 labelled reading claims before deciding on a second model: the crops and first-pass outputs are recorded, so a verifier can be scored with no new collection.
5. **Add the per-claim record to the report** (P7) once round 6 gives held-out counts per claim kind large enough to state.

## 7. Data and reproduction

All paths under `study/notes-precision-round5/`. Run from the repository root at `c0db24b` after `pnpm install --frozen-lockfile` and `pnpm build`; the recordings are in `C:/Users/guilh/dev/rampa-study-recordings` (`$RECORDINGS`).

- `link-facts.ts`: the 2.4.4 facts (card heading, sibling link, destination name, menu toggle) for every generic or shared-text link candidate on the 72 + 12 dev snapshots, no model; `node study/notes-precision-round5/link-facts.ts` writes `data/link-facts.json`; with `r5test`, the test half's to `data/link-facts-r5test.json` (counted only).
- `analyze_links.py`: joins the facts with the labels and prints what each rule variant moves; writes `data/link-joined.json`.
- `data/g1-variant.diff`: the P1 prototype against `src/criteria/link-purpose.ts` at `c0db24b` (not applied on the branch). Built apart into `.rampa/dist-g1` and run with `rampa eval --criteria 2.4.4 --model ollama:gemma4:12b --cache-dir <copy of the precision-fixes eval cache>`; `data/evals/244-main.txt` and `244-g1.txt` are the two consoles (0 new model calls each).
- `confirm_groups.py`: the second pass replayed with the group rules on every labelled reading claim with recorded answers; writes `data/confirm-claims.json`.
- `image-facts.ts`: the social-icon and nearby-text facts on the confirmed claims; writes `data/image-facts.json`.
- `sample_size.py`: Wilson bounds by n, the fifth study's page design effect, pages needed, and the chance of a bound ≥ 0.85.
- Not run and not pulled: any model other than `gemma4:12b`; nothing in `src/` changed on the branch.

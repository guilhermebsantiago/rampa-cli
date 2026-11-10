# P2: a claim the second pass denied with confidence is not confirmed by an identical one (2026-11-09)

Since 2026-10-29 ([notes](notes-precision-p1p2.md)), identical 1.1.1 claims on one page are confirmed together: when the second pass confirms one claim of a group (the same alternative, the same verdict), every claim of the group it denied is confirmed too. Now a denied claim is confirmed with its group only when its own lowest probability of a confirming word is at least a fixed floor, **0.05**. Under it, the claim stays what the second pass made it: the model's suggestion. These notes record the rule, the evidence it was fixed from, an offline replay and the limits.

**What each number is.** Every number below is on the dev halves of the second to fifth real-page studies (12 pages each, 48 pages), the pages the floor was chosen on: **in-sample** and **counted**. No cache, snapshot, report or finding of a test page was opened. The fifth study's test half has no finding of this kind (counted when P2 was measured, [notes](notes-precision-p1p2.md)), so nothing held out measures the floor. The labels are the studies' two Claude judges, not people, and no specialist has checked them.

## 1. The rule

In `src/core/confirm.ts`:

- **`CONFIRM_TOGETHER_MIN_PROBABILITY = 0.05`**, exported.
- **`confirmTogether`**: in a group of two or more identical claims where the pass confirmed at least one, a claim whose outcome is `denied` is confirmed and marked `identical`, as before, only when its own `minProbability` is undefined or at least the floor. A denied claim under the floor is returned unchanged. `identical.claims` and `identical.confirmed` are counted as before: the group's size, the claims under the floor included, and how many the pass confirmed on their own.
- **A claim with no probability** (a provider that reports none) behaves exactly as before: it is confirmed with its group. The floor has no evidence there.
- **What does not change**: `decide`, `confirmClaim`, `confirmKey`, `identicalClaimKey`, `CONFIRM_MIN_PROBABILITY` (0.99), the call in `src/core/check.ts` and the report's wording. A claim left denied is reported as every unconfirmed claim is ("did not confirm it", with what each framing answered). No new question is asked, so the judgment cache hits as before.

**When the floor was fixed.** The value 0.05 was written into the brief for this change on 2026-11-09, before any replay of this code, from the eight findings of section 2. It was not tuned: no other value was tried, and none is reported.

## 2. The evidence: eight findings that existed only through an identical claim

On the dev pages, with the studies' flags (`--min-confidence low`), `main` (`f3d20e7`) reports eight 1.1.1 findings that the second pass denied on their own answers and confirmed only because an identical claim on the page was confirmed (`confirmation.identical`). All eight read "describes something the image does not show". The table lists each one's own lowest probability of a confirming word, read from the replay's "before" reports (section 3), and the two Claude judges' final label from the study's `data/findings.json` (dev rows, the same page, criterion and element; the origins in the order `study/notes-precision-p1p2/labels.py` reads them; "ablation" is a label given in the study's `--no-confirm` run).

| Study | Page | Alternative | Element | Own lowest probability | Group: claims, confirmed on their own | Claude label | With the floor |
| --- | --- | --- | --- | --- | --- | --- | --- |
| s3 | puc-rio-vestibular | Imagem de alunos no Campus da PUC-Rio | the second linked image | 0.013 | 2, 1 | false | suggestion |
| s4 | cobasi-cachorro | Ilustração SVG demonstrativa cachorro | the `picture` image | 0.00068 | 2, 1 | false (ablation) | suggestion |
| s5 | hering | payment | footer logo 1 | 0.959 | 7, 1 | true (ablation) | finding |
| s5 | hering | payment | footer logo 2 | 0.336 | 7, 1 | true (ablation) | finding |
| s5 | hering | payment | footer logo 3 | 0.655 | 7, 1 | true (ablation) | finding |
| s5 | hering | payment | footer logo 5 | 0.694 | 7, 1 | true (ablation) | finding |
| s5 | hering | payment | footer logo 6 | 0.120 | 7, 1 | true (ablation) | finding |
| s5 | hering | payment | footer logo 7 | 0.528 | 7, 1 | true (ablation) | finding |

- **The six true ones** are www.hering.com.br's payment logos with `alt="payment"`, the case P2 was built for. Their own lowest probabilities run from 0.12 to 0.96; their twin, footer logo 4, was confirmed at 0.992.
- **The two false ones** were denied far more firmly: 0.013 and 0.00068. On puc-rio.br, both images are labelled false; the denied copy's answers were "rules: fail (1.00), claim: no (0.01), reversed: no (0.99)", and its twin was confirmed at 0.99998. On cobasi.com.br, the denied image is the dog its alternative describes (the model's own suggestion for it is a leaf, a sprout and a blue dog); its answers were "rules: fail (0.93), claim: no (0.00), reversed: yes (0.06)". The confirmed twin, labelled true, is another image with the same alternative, confirmed at 0.999999.
- **The gap.** Between the highest false one (0.013) and the lowest true one (0.120) nothing lies on these pages, and 0.05 sits in that gap. Any value in it would split these eight the same way, which is why section 5 calls this a floor chosen on three groups of pages and nothing more.

## 3. The replay (offline, dev pages, 1.1.1 only)

Only 1.1.1 has a second pass (`confirm` exists in `src/criteria/non-text-content.ts` alone). `study/notes-p2-floor/replay.sh` runs `rampa check` on each dev page's recorded snapshot with `--model ollama:gemma4:12b --locale en --min-confidence low --time-limit 900 --concurrency 2 --offline --criteria 1.1.1`, a fresh copy of that page's judgment cache from the P3/P4 replay's final caches (`rampa-study-recordings/notes-precision-p3p4-2026-10-29/caches-after/<study>/<slug>/cache`), each page in its own work directory, every API key variable unset. `--offline` asks no model. **Before** is `dist` built at `main` (`f3d20e7`). **After** is this branch's build of the code commit (`054d306`); the build that was replayed was made just before a comment in `confirm.ts` was reworded, and differs from a build of `054d306` by that comment and the chunk names only. `study/notes-p2-floor/compare.ts` compares the two reports of each page (`data/compare.md`, `data/compare.json`).

| Study | Pages | Same sets | Misses before / after | Model calls before / after | Findings that became suggestions | Unexpected changes | Other differences |
| --- | --- | --- | --- | --- | --- | --- | --- |
| s2 | 12 | 12 / 12 | 0 / 0 | 0 / 0 | 0 | 0 | 0 |
| s3 | 12 | 11 / 12 | 0 / 0 | 0 / 0 | 1 | 0 | 0 |
| s4 | 12 | 11 / 12 | 0 / 0 | 0 / 0 | 1 | 0 | 0 |
| s5 | 12 | 12 / 12 | 0 / 0 | 0 / 0 | 0 | 0 | 0 |

- **On 46 of the 48 pages the sets are identical**: findings, below-threshold findings (by criterion, ref, fingerprint, source and rule) and suggestions (by criterion, ref and rule). Neither run had a cache miss or made a model call.
- **On the other two, one finding each became a suggestion**, and they are the two of section 2 under the floor: puc-rio-vestibular's second linked image (0.013) and cobasi-cachorro's `picture` image (0.00068). Each suggestion's evidence carries the answers, as an unconfirmed claim's does: "A second pass, asked one word at a time three ways, did not confirm it (rules: fail (1.00), claim: no (0.01), reversed: no (0.99))" and "(rules: fail (0.93), claim: no (0.00), reversed: yes (0.06))".
- **hering's six findings stay**, with the same `identical: { claims: 7, confirmed: 1 }`.
- **Field by field, nothing else differs** (`createdAt` aside), once the two moved items are taken out of both reports, apart from the counts that follow from the moves on those two pages: the criterion's `failed` and `confirmed` down by one, `unconfirmed` and `suggested` up by one, and in the coverage the 1.1.1 judgment method's `failures` down by one, `review` and `suggestions` up by one.
- **What it means for the counts**: on these dev pages, P2's in-sample record goes from 6 true and 2 false findings added to 6 true and 0 false added, with no true finding lost. That is a count on the pages the floor was chosen from, not a measure.

## 4. The W3C ACT cases

`rampa eval --criteria 1.1.1 --model ollama:gemma4:12b --concurrency 2 --offline`, with each build on its own copy of the P3/P4 evaluation cache (`rampa-study-recordings/notes-precision-p3p4-2026-10-29/eval-cache`), ran offline with no model. The list of test cases was downloaded from the W3C (`testcases.json`, ACT `49051da6`, the same set as the P3/P4 runs), and the test pages were loaded from the W3C's site, as every evaluation does. Both builds: 0 new model calls, 44 answers from the cache, and the same record as the P3/P4 runs: ACT 23a2a8 1.00 / 1.00 (n = 18), qt1vmo 1.00 / 1.00 (16), e88epe 1.00 / 1.00 (20), pairs 1.00 / 1.00 (3), both pair discriminations 1 / 1, 32 candidates, none discarded, none "cannot tell" (`data/evals/`). The 56 result rows have the same outcome, verdicts and findings in both runs. One row differs, and only in its token count: the cached first-pass answer of e88epe's Passed Example 3 ("passed" in both runs) was read with 65 output tokens in one run and 67 in the other. The P3/P4 evaluation records show the same run-to-run variation in token totals: 2,407 and 2,385 output tokens, with no new call in either; these two runs read 2,382 and 2,384. No ACT 1.1.1 page has two reading claims with one alternative, so the floor has nothing to act on there.

## 5. Limits

- **A floor chosen on three groups of dev pages.** Two false findings on two pages and six true ones on one page. The gap it sits in (0.013 to 0.120) is one sample's, and a true finding denied that firmly on another page would be lost. Copies of one picture that one framing's word split kept some probability for the claim here; that this holds elsewhere is a reading of eight findings, not a result.
- **Claude labels.** The eight labels are the two Claude judges', and no specialist has checked them.
- **No held-out measure until round 6.** The fifth study's test half has no finding of this kind (counted), so the change is justified by dev evidence only, and only fresh pages can say what it does.
- **A provider with no probabilities is untouched.** There a denied claim is confirmed with its group as before, and the two false findings above would come back.
- **One model.** The probabilities are Gemma 4 12B's first-token probabilities through Ollama. Another model's probabilities may be calibrated differently, and the floor was not checked on any.

## 6. Data and reproduction

All paths under `study/notes-p2-floor/`. Run from the repository root with the recordings in `C:/Users/guilh/dev/rampa-study-recordings` (`RECORDINGS`) and Node 24 on `PATH`.

- Build `main` (`pnpm build`) and copy `dist` to `.rampa/p2-floor/dist-before`. Build this branch and copy `dist` to `.rampa/p2-floor/dist-after` (`.rampa/` is ignored by git).
- `bash replay.sh before .rampa/p2-floor/dist-before` and `bash replay.sh after .rampa/p2-floor/dist-after`. The full reports, consoles and cache copies go to `.rampa/p2-floor/`, out of git.
- `node compare.ts before after > data/compare.md`: section 3 (`data/compare.json`, with each twin-confirmed finding, its probability, whether it stays and its label).
- For each build, copy the evaluation cache and run `node <dist>/cli.mjs eval --criteria 1.1.1 --model ollama:gemma4:12b --concurrency 2 --offline --cache-dir <copy> --out-dir .rampa/p2-floor/eval-<before|after>`: section 4 (`data/evals/`, the consoles, `results.jsonl` and `summary.json` of both runs).

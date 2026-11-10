# Every judged 1.1.1 and 2.4.4 candidate, and a dry run of round 6's pass-sample draw (2026-11-09)

A report lists failures, not passes: `Report.criteria` holds counts only (`src/core/types.ts`, `CriterionSummary`). Round 6 will sample what Rampa judged and did not report for 1.1.1 and 2.4.4 (its draft pre-registration, `study/round-6-2026-10-29/preregistration-draft.md` on the branch `study/round-6-passes`, section 3, "What Rampa passed", and section 5, item 7), so something must name each such element. These notes record a script that lists every candidate of the two criteria with its outcome, with no model call, the counts it gives on the 48 dev pages of the second to fifth real-page studies, and the draft's draw run on those rows as a dry run. Nothing under `src/` changed.

**What each number is.** Every count here is on the dev halves of the second to fifth studies (s2–s5, 12 pages each), which earlier rounds read and tuned on: **counted, in-sample (dev)**. No page whose split is `test` was opened, in any study. The judgments are a replay of `main` (`f3d20e7`) from cached answers of Gemma 4 12B, not a fresh run. No item was labelled, so nothing here estimates a rate.

## 1. What the listing does

`study/notes-pass-sample/list.ts`, per dev page and criterion (s2: 1.1.1 only, see below), builds the candidates as `rampa check` does (the browser's names where the criterion reads them, the elements a rule already failed left out, the cap of 50 with its judge-first order) and writes one row per candidate: `study`, `slug`, `criterion`, `ref`, `subject` (the alternative, `hidden <file>` for a hidden image, or the link's text) and `outcome`:

| Outcome | What it is | In the draft's draw |
| --- | --- | --- |
| `finding` | a verified fail reported at or above `rampa check`'s default threshold (medium) | no (labelled as a finding) |
| `below_threshold` | a verified fail reported below that threshold | no (labelled whole, as its own stratum) |
| `held_back` | a verified fail that is the model's suggestion; `held` says why: `unconfirmed` (the second pass did not confirm it), `ungrounded` (no fact Rampa checks supports it; for 1.1.1 that is the P3 social icon), `unstyled` (the page was read without its styles) | stratum "held back" |
| `discarded` | a fail verification discarded | stratum "discarded" |
| `passed` | the model's verdict is pass and verification kept it | stratum "passed" |
| `discarded_pass` | a pass verification discarded (a bad quote, or a pass whose answer names a problem) | counted, never drawn |
| `cannot_tell` | the model could not tell | counted, never drawn |
| `capped` | past the cap of 50, never judged | counted, never drawn |
| `not_judged`, `offline_miss`, `error` | past the time limit; no cached answer; a judgment that ended in an error | counted, never drawn |

How each outcome is read. The model's status of each candidate comes from `judgeCandidates` (`src/core/judge.ts`), the function the check calls, over the same candidates and a copy of the page's cache, offline. Which verified fails are findings, below the threshold or suggestions is read, by element, from Rampa's own report of the page (`checkSnapshot`, run in the same process with the replay's flags), so the second pass, its identical-claim groups and the confidence rules are the tool's own and not re-implemented. The reason a claim is held back follows the order `heldBack` in `src/core/check.ts` asks in: the page's styles (`captureStyle`), then the criterion's facts (`Criterion.grounded`), else the second pass.

**The check that the listing is right.** Each page is also judged by the built CLI, offline, as the replays do (`node dist/cli.mjs check <snapshot> --model ollama:gemma4:12b --locale en --min-confidence low --time-limit 900 --concurrency 2 --offline --criteria <ids> --cache-dir <copy> --json <out>`, the API key variables unset, the page's own work folder as working directory). Per criterion, the listing must give the CLI report's judgment findings (the same elements, split by the default threshold), `belowThreshold`, the model's suggestions in `needsReview` (the same elements), `discarded` (the same elements, split by verdict), and in `criteria[]` the fields `candidates`, `discarded`, `passed`, `cannotTell`, `capped`, `timedOut`, `offlineMisses` and `errors`; the script stops at the first difference. It ran to the end on all 48 pages (84 page-and-criterion pairs). Two full runs wrote the same `data/outcomes.json`, byte for byte, and two runs of the draw the same `data/draw.json`.

**Where the listing follows the round 6 draft rather than the task's list of outcomes:**

- *Discarded passes* have their own outcome, `discarded_pass`: verification can discard a pass as well as a fail (`conclude` in `src/core/judge.ts`), and the draft counts such passes without drawing them. `criteria[].discarded` in a report adds the two.
- *Held back* is every verified fail the code makes a suggestion of: besides a claim the second pass did not confirm, a P3 social-icon claim and a fail on a page read without its styles, as the draft says. On these 48 pages neither of the last two occurs (section 2).
- *Below the threshold* means below the default threshold (medium), the draft's "findings below the default threshold". At `--min-confidence low`, the replay's flag, `meetsThreshold` admits every finding, experimental ones included, so a report's `belowThreshold` is always empty for these criteria; the check therefore compares the split of the CLI report's findings by the default threshold, and requires its `belowThreshold` to be empty.
- *Errors* (`error`, `offline_miss`) and the time limit (`not_judged`) have outcomes of their own, which the draft counts and never draws. All are 0 here.

**The second study's 2.4.4** was not judged in the P3/P4 replay whose caches are read here (see the header of `study/notes-precision-p3p4/replay.sh`): its 2.4.4 was carried from an earlier run, so its caches do not answer what `main` asks. The listing gives s2's 1.1.1 only; 2.4.4 covers 36 pages.

## 2. Outcomes per criterion

Counted, in-sample (dev); 48 pages for 1.1.1, 36 for 2.4.4.

| Criterion | Candidates | finding | below_threshold | held_back | discarded | passed | discarded_pass | cannot_tell | capped | not_judged, offline_miss, error |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1.1.1 | 472 | 39 | 8 | 34 | 102 | 289 | 0 | 0 | 0 | 0 |
| 2.4.4 | 3,828 | 19 | 0 | 77 | 86 | 1,188 | 23 | 1 | 2,434 | 0 |

- **Held back, by reason.** 1.1.1: all 34 are claims the second pass did not confirm (in each the report's line says the pass "did not confirm it"); P3 holds back 0 and a page without its styles 0. 2.4.4: all 77 are claims no checked fact supports; a page without its styles holds back 0 (no dev page was read unstyled).
- **Below the threshold.** The 8 of 1.1.1 are all claims about hidden images, whose confidence the criterion caps at low (`confidenceCap`), 4 of them on one page (lakeland, payment-card icons in its footer).
- **By study** (`data/outcomes.json`, `byStudy`), 1.1.1 passed / discarded / held back: s2 120 / 28 / 5, s3 82 / 32 / 9, s4 66 / 12 / 5, s5 21 / 30 / 15; 2.4.4: s3 473 / 15 / 46, s4 349 / 14 / 11, s5 366 / 57 / 20.
- **Pages with no candidate.** mackenzie-vestibular, hospitalmoinhos and nls-contact (s4) have no candidate of either criterion, and correio24horas (s5) none of 1.1.1; the CLI's reports agree (`candidates` 0).

## 3. Against the earlier counts

Counted, in-sample (dev). The draft cites, on the same 48 pages, 472 1.1.1 judgments, of them 289 passes, 102 claims discarded by verification and 34 denied by the second pass, and 1,188 2.4.4 passes. Those were read from the `criteria[]` summaries of the P3/P4 replay's reports (`study/notes-precision-p3p4/data/p3p4/<study>.<slug>.judged.json`, dev pages; its `main` label gives the same), made by the same code from the same caches. Every number matches: 1.1.1 has 472 candidates, all judged (39 + 8 + 34 + 102 + 289), and 2.4.4 1,188 passes; 2.4.4's candidates, cap and suggestions match too (3,828, 2,434, 77). What differs is the reading, not the counts:

- **2.4.4's "discarded" in a summary is 109; the draft's discarded stratum is 86.** The summary adds the 23 passes verification discarded (on 8 pages) to the 86 discarded fails. 1.1.1 has no discarded pass, so its 102 are all fails and its stratum is 102.
- **"34 denied by the second pass" and the held-back stratum are the same 34 for 1.1.1** only because no P3 claim and no unstyled page occur on the dev half. On the test half of round 6 the stratum may hold more than the second pass's denials.
- **2.4.4's held-back stratum (77) is not a second-pass count**: 2.4.4 has no second pass, and its suggestions are claims no checked fact supports.

## 4. 2.4.4 past the cap

Counted, in-sample (dev). 2,434 of 3,828 2.4.4 candidates (0.64) were never judged because the page had more than 50 links that needed the model: on 24 of the 36 pages, s3 624 of 1,167 (0.53), s4 653 of 1,034 (0.63), s5 1,157 of 1,627 (0.71); one page alone (lakeland) has 793 of its 843 past the cap. No 1.1.1 candidate is past the cap. The pass sample is drawn from the judged candidates only, so whatever it estimates for 2.4.4 says nothing of the links past the cap: those further down the page that no checked fact could make a finding of (the judge-first order of `capCandidates`).

## 5. The dry-run draw

`study/notes-pass-sample/draw.py`, the draft's rule on these rows: per criterion, strata passed, discarded and held back; sizes 60, 20 and 20, a smaller stratum taking all; within a stratum, over the pages pooled with no cap per page, ascending SHA-256 of `rampa-round-6-passes|<slug>|<criterion>|<ref>` (UTF-8, hexadecimal), the first *n*. It also marks the specialist's subset of the draft (the first 15 passed items of each criterion in the draw's order). Counted, in-sample (dev); a dry run.

| Criterion | Stratum | Population | Drawn | Pages in population | Pages drawn | Largest page in the draw | Items from the three largest pages |
| --- | --- | ---: | ---: | ---: | ---: | --- | ---: |
| 1.1.1 | passed | 289 | 60 | 37 | 27 | medlineplus-gov-diabetes, 7 | 15 |
| 1.1.1 | discarded | 102 | 20 | 28 | 14 | hering, 3 | 8 |
| 1.1.1 | held back | 34 | 20 | 16 | 11 | pucrs-graduacao, 5 | 10 |
| 2.4.4 | passed | 1,188 | 60 | 33 | 25 | hering, 6 | 15 |
| 2.4.4 | discarded | 86 | 20 | 18 | 9 | ms-gov-br, 10 | 14 |
| 2.4.4 | held back | 77 | 20 | 23 | 10 | travessa-com-br, 7 | 12 |

Every stratum is larger than its size, so the draw takes 200 items, on 42 of the 48 pages; the specialist's subset is 30 items, on 12 pages for 1.1.1 and 15 for 2.4.4.

**How concentrated it is.** The passed strata spread: 60 items over 27 and 25 pages, at most 7 from one page. The small strata follow their populations' bursts, since the draw has no cap per page: ms-gov-br holds 41 of the 86 discarded 2.4.4 fails (0.48) and gets 10 of the 20 drawn; travessa-com-br holds 22 of the 77 held-back 2.4.4 claims (0.29) and gets 7; pucrs-graduacao holds 7 of the 34 held-back 1.1.1 claims and gets 5. A stratum whose population sits on a few pages gives labels that speak mostly for those pages. The draft leaves open how the page bootstrap weights a resample's drawn items (section 5, item 7, **TO FIX**); this dry run shows the case it will have to handle.

## 6. Limits

- **Dev pages, in-sample.** These pages were read and tuned on; their counts say how the listing and the draw behave, not what round 6 will find. Round 6's population is its test half's main run (36 pages), a fresh collection and fresh judgments; the rule here applies to it unchanged, the numbers will not.
- **A dry run.** No item was labelled, and nothing here estimates a false-negative rate or a recall. The sizes and the draw were the draft's before this ran and were not changed after it.
- **Replayed, not run.** The judgments are cached answers, replayed offline with `main`'s code; the second study's 2.4.4 is missing (section 1).
- **Right by the tool's own account.** The listing reads the fail outcomes from Rampa's own report and is checked against the built CLI, page by page; that shows the listing and the report agree, not that any outcome is right about the page.
- **What the strata leave out**, as the draft says beside its estimate: candidates past the cap (section 4), discarded passes, `cannot_tell`, and elements that were never candidates (an image with no alternative is the engine's, a CSS background, the other criteria).
- **The draw's key uses the element's `ref`**, a selector of the recorded document; a re-collected page gives other refs, and so another draw. In round 6 the key is fixed by the main run's recordings.

## 7. For round 6's script

The listing imports, from `src/`: `loadRecorded` (`surfaces/targets.ts`), `resolveProvider` (`cli/commands/check.ts`), `fileCache` (`core/cache.ts`), `checkSnapshot`, `capCandidates` and `DEFAULT_MAX_CANDIDATES` (`core/check.ts`), `judgeCandidates` (`core/judge.ts`), `meetsThreshold` (`core/gate.ts`), `resolveCriteria` (`criteria/index.ts`), `runRuleChecks` and `RULE_CHECKS` (`rules/index.ts`), `browserNamed` (`snapshot/ax.ts`), `captureStyle` (`snapshot/reach.ts`) and `t` (`i18n.ts`, to tell the second pass's own offline misses). It repeats about fifteen lines of `checkSnapshot`'s loop (the view, the rule-decided elements, the cap, the judgment call, the order of `heldBack`) and judges each candidate twice, once inside the check and once outside it.

A small export from `src/` would remove that copy: an optional callback in `CheckOptions` (for example `onOutcome(criterion, candidate ref, outcome)`) called once per candidate from the loop of `checkSnapshot` that already decides each one, or a `Report` field behind a flag listing each candidate's status. Either would let round 6's script read the outcomes of its main run from the run itself, with no second judgment, and keep them in step with any later change to the loop (the P2 floor or the 1.1.1 placeholders of this batch, for instance). It is not needed for correctness: the CLI check of section 1 catches a drift.

## 8. Data and reproduction

All paths under `study/notes-pass-sample/`. Run from the repository root after `pnpm install --frozen-lockfile` and `pnpm build`, with the recordings in `C:/Users/guilh/dev/rampa-study-recordings` (`RECORDINGS`) and Node 24.

- `node study/notes-pass-sample/list.ts`: copies each dev page's cache from `notes-precision-p3p4-2026-10-29/caches-after/<study>/<slug>/cache` to `.rampa/pass-sample/pages/<study>/<slug>/cache` (ignored by git), lists the candidates, runs the CLI check on each page (its report and console stay in the same folder), and writes `data/outcomes.json`: the totals per criterion (`counts`), the held-back reasons (`heldBack`), per study (`byStudy`), one line per page (`byPage`) and one line per candidate (`rows`, dev pages only). A few minutes on this PC (5 min 25 s for the first run); no model, no network.
- `python -I study/notes-pass-sample/draw.py`: reads `data/outcomes.json` and writes `data/draw.json`: the rule, each stratum's population, size, number drawn, pages and largest page (`strata`), the outcomes counted and never drawn (`notDrawn`), and the 200 drawn items with `slug`, `criterion`, `ref`, `stratum`, `rank` and, for the specialist's subset, `specialist`.

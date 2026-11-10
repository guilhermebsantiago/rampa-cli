# Technique citations on the 48 dev pages (2026-11-09)

A judgment finding now carries `techniques`: the ids that [src/core/techniques.ts](../../src/core/techniques.ts) lists for its criterion and kind of claim, and every report format shows them with their titles ([output formats](../output-formats.md#json)). The kind comes from `Criterion.claimKind`, which each of the eight default criteria implements. In 1.1.1 the kind and the message's sentence come from one function, `altClaim`, so they cannot disagree.

**What each number is.** Every number here is **counted** and **in-sample (dev)**: the 12 dev pages of each of the second to fifth real-page studies (48 pages), chosen by each study's `data/pages.json`. No cache, snapshot, report or finding of a test page was opened.

## The replay

[`replay.sh`](../../study/notes-technique-citation/replay.sh), a copy of the capture record's, ran `rampa check` offline on each dev page's recorded snapshot with the studies' flags and a fresh copy of each page's cache from the P3/P4 replay, once with a build of `main` at `74b0746` and once with this branch. [`compare.ts`](../../study/notes-technique-citation/compare.ts) compared the two reports of each page once `techniques` was removed from every finding (and `createdAt` from the report):

- 48 of 48 pages, 0 differences: every message, fingerprint, list, group, count and coverage is the same. No report of the base build cites anything.
- Cache misses: 0 on both builds.

## Findings per id

The after reports have 99 judgment findings, all in the list (the replay runs at `--min-confidence low`); 91 cite at least one id. Counted, in-sample (dev); data in [`citations.json`](../../study/notes-technique-citation/data/citations.json).

| Id | Kind of claim | Findings |
| --- | --- | ---: |
| H98 | 1.3.5 autocomplete | 23 |
| H81 and H80 | 2.4.4 shared_text | 19 |
| G94 | 1.1.1 wrong_content, missing_information, short_alternative | 15 |
| F30 | 1.1.1 placeholder, generic | 13 |
| H58 | 3.1.2 passage_language | 10 |
| H30 | 1.1.1 functional_link | 6 |
| F39 and H67 | 1.1.1 decorative | 3 |
| F25 and G88 | 2.4.2 title | 1 |
| H57 | 3.1.1 page_language | 1 |

No dev finding cites G91 (2.4.4 generic, address, mismatch), H36, G130, G131 or H44. The 8 judgment findings that cite nothing are all 1.1.1 images hidden from screen readers (`hidden_image`), for which the table has no citation that fits. Engine, rule and probe findings never cite.

Kinds that a criterion returns no citation for: 1.1.1 `hidden_image` (an empty row); a 1.1.1 fail whose problem is `none` (no kind); and 3.3.2 claims other than a label that does not show (a group with no question, a date with no format shown, a pattern nothing explains), which have no key.

## ACT cases

`rampa eval --criteria 1.1.1,2.4.4 --model ollama:gemma4:12b --concurrency 2 --offline` ran with both builds, each on a fresh copy of the P3/P4 evaluation cache (`notes-precision-p3p4-2026-10-29/eval-cache`), with no model running: 147 records each, 0 new calls and 146 from the cache on both, and every record equal once its token usage is removed, so every outcome is the same. Eval records keep no `techniques`.

## Limits

- A citation is the tool's reading of which documented technique or failure a claim applies. No specialist has checked the table or any citation; it says nothing about whether a finding is true.
- The line names a reading, never a verdict on the page or the element, and a test keeps verdict words out of it. The W3C's own titles of failures begin "Failure of Success Criterion …", and are quoted as titles.
- How often each kind of claim was right is not shown next to the citation. That history waits for held-out labels (round 6).
- The counts above are of one replay of 48 dev pages, in-sample; they describe which rows are used, not how often they apply on other pages.

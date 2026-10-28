# Fifth real-page study: pre-registration (2026-10-28)

Committed before Rampa ran on any of these pages. Only the pre-screen in headless Edge (`scripts/screen.mjs`,
`data/screen-*.json`), the link listing used to pick inner pages (`scripts/links.mjs`) and a look at three inner pages'
text to tell a wall from an article (below) have loaded them.

**Question.** On 24 pages none of it has seen, how often is what `rampa check` reports a real failure, now that the
precision fixes written after the fourth study are merged? Those fixes ([notes](../../docs/studies/notes-precision-fixes.md))
gave 0.86 per element (95 of 111 decided, 0.78–0.91) when replayed on the 72 pages of the second to fourth studies,
which they were chosen from: an in-sample number. This study is the held-out measure.

**Code, frozen.** `main` at **`b759128`** (2026-10-27 20:29, "Merge branch 'feat/burst-groups'"), built with `pnpm install
--frozen-lockfile` and `pnpm build`. `src/` stays at that commit for the whole study, and nothing in it changes after this
commit. Over `6e0947a`, the fourth study's code, it adds the four fixes of the notes and the groups of near-identical
findings in reports (`src/core/groups.ts`, docs/output-formats.md "Groups of near-identical findings"). The rules and
thresholds that decide what a finding is are those of section 2 of the notes, frozen there before the in-sample replay:

| Rule | Value | Where |
| --- | --- | --- |
| H81 nesting context | enclosing list items' own text (before the nested list, else after it, lists left out), truncated at 120 characters; names of `list`, `menu`, `menubar`, `group`, `tree` from `aria-label` / `aria-labelledby` | `link-purpose.ts`, `nestingOf` |
| Landmark context (F4) | not used | |
| Default body look | 16 px, weight 400, `rgb(0, 0, 0)`, not italic, family `times new roman`, `times`, `serif`, `tinos`, `liberation serif` or `dejavu serif` | `look.ts`, `isDefaultLook`, `DEFAULT_FAMILIES` |
| No author style | 0 sheets with a rule (or unreadable from another origin) among `document.styleSheets` and `adoptedStyleSheets`, a link to the page itself left out | `page-look.ts` |
| Element floor | 150 elements in the page's own document | `look.ts`, `PLAIN_PAGE_ELEMENTS` |
| Old-recording fallback | default body look, no `reach.stylesheets`, no `authorStyles`, at least 150 nodes | `reach.ts`, `captureStyle` |
| Self-link correction | a recorded `unstyled` whose every failed sheet is the page's own address, with at least one sheet applied, reads as styled | `reach.ts`, `captureStyle` |
| Second-pass threshold | 0.99 (lowest probability of a confirming word over the three framings) | `confirm.ts`, `CONFIRM_MIN_PROBABILITY` |
| 2.4.2 grounded | `generic` or `filename_or_url` on a generic title, address or file name; `generic` on a title identical to a sibling page's | `page-titled.ts`, `groundedTitle` |
| 3.3.2 grounded | not collapsed, not a search field, and: `no_visible_label` with `unseen` or nothing beside the field; `rule_not_explained` with a pattern and nothing beside the field | `labels-or-instructions.ts`, `groundedLabel` |
| Burst group | same page, criterion, check id and claim kind; more than 5 (6 or more) | `groups.ts`, `GROUP_THRESHOLD` |
| Group label (analysis) | the label most of its labelled members have (true, false or uncertain); a tie is uncertain; unlabelled members do not vote | `study/notes-precision-fixes/analyze.py` |

**Pages.** `scripts/pages.tsv`: the fourth study's design, twelve strata (Brazil or international, times government,
education, news, e-commerce, health, culture or public services), a home page and an inner page each, from two different
sites; Brazilian pages in Portuguese, the others in English (United Kingdom, United States, Ireland). No registrable
domain (Public Suffix List) of any earlier study (the first, its re-measure, the second, third and fourth studies, and the
robustness study's 53 sites: 136 domains), and none that any file of any of the repository's 12 branches or any commit
message names (2,283 domains, the benchmark's among them): `scripts/exclusions.py`, `data/excluded-domains.json`, built
again on 2026-10-28 at `b759128`. Primaries and backups were written before the screen (`scripts/candidates.tsv`,
2026-10-27); six of them were named by the repository and were replaced in that file before the screen. The selection,
slot by slot, is in `scripts/pages.tsv`; what differed from the fourth study's selection:

- The first screen, on 2026-10-27, was cut off when the session stopped and wrote no result (its console is
  `data/screen-0-interrupted.txt`). The screen was run again in full on 2026-10-28 (`data/screen-1.json`).
- Loads that failed with a network error on a slot that depended on them were screened again once (`screen-2`); three
  failed again (bienal.org.br, dunelm.com, macmillan.org.uk, each for the third time counting the cut-off run) and were
  counted as not loading.
- Two Brazilian sites served headless Edge their English site (pequenoprincipe.org.br, theatromunicipal.org.br): not a
  Portuguese page, so the slot went to its next backup, as ufrj.br did in the fourth study.
- **One slot ran out of backups**: every candidate of in-health-i failed (the last one, alzheimers.org.uk, passed at its
  home page and showed a Cloudflare challenge at its first article). Three more backups were written down before they
  were checked or loaded (`scripts/candidates-extra.tsv`), and the first, patient.info, passed.
- **A subscription wall counts as a sign-in wall**: the New Statesman's first article shows two paragraphs and then
  "Exclusive Subscriber Only Content", so the slot went to its next backup that passed the screen (irishcentral.com). To
  tell a wall from an article, the text of three inner pages was read once in headless Edge (newstatesman.com,
  agazeta.com.br, oncoguia.org.br); the last two are open articles and were kept.
- The one bot-challenge address in the screen's files (camicado.com.br's redirect to validate.perfdrive.com) is redacted:
  its query string carried tokens and the client's IP address.

**Split.** `scripts/split.py`, `random.Random(20261027)`: in each stratum a seeded coin sends the home or the inner page
to dev and the other to test (`data/pages-input.json`). The seed was fixed on 2026-10-27, before any page loaded, and was
kept when the study was resumed on 2026-10-28. No probe subset is drawn.

## Method

The fourth study's, with its scripts, rubric, judge prompt (including its one-line reply) and packet format, except as
listed here.

- **Collection, no model call.** `bash scripts/collect.sh main`: `rampa check <url> --model ollama:gemma4:12b --offline
  --locale en --min-confidence low --save <dir> --screenshots`, Edge through playwright-core, one page at a time.
- **Judgment.** `bash scripts/run-judged.sh default`: `rampa check <snapshot> --model ollama:gemma4:12b --locale en
  --min-confidence low --time-limit 900 --concurrency 2`, the second pass on (the default), one page at a time. Gemma 4
  12B (`gemma4:12b`, digest `6114515d63c1`) on Ollama 0.40.3 at http://127.0.0.1:11434. No other model or provider.
- **Ablations, each a replay of the same snapshot and cache, so its effect is exact** (offline: no model is asked; a
  cache miss is counted in each report):
  - `--no-confirm` (`scripts/run-noconfirm.sh`, as in the fourth study): the second pass off;
  - the 1.1.1 cut at **0.9 instead of 0.99** (`scripts/run-cut090.sh`): a copy of the build with that one constant changed
    (the script checks that the copy differs from `dist/` in that one line), `--offline`, a fresh copy of the main cache;
  - the 2.4.4 shared-text fact **without the H81 nesting** (`scripts/shared-text.sh`, `scripts/shared-text.ts`): the fact
    replayed on each snapshot with and without the nesting, no model (the copy of `link-purpose.ts` at `6a8de75`, whose
    only difference from `b759128`'s is the nesting); it says which links the nesting tells apart. A claim the model
    made under the prompt with the nesting is a finding without it only if its fact changes, so the counterfactual
    precision without the nesting adds the main run's 2.4.4 "shared by" suggestions on links the nesting tells apart;
    links the model might have failed under the prompt without the nesting, and passed with it, are not asked, and the
    count of grounded candidates with and without is reported beside it;
  - the capture guard's trigger and the body-look signal, logged for every page (`scripts/capture.ts`): `reach.stylesheets`
    (linked, applied, failed, retried, unstyled), the author style sheets counted, the body look and whether it is the
    default one, the number of elements, and the verdict the checks read (`captureStyle`).
- **No probe run**, as in the fourth study.
- **Labels.** One packet per page (`scripts/packets.py`) holding, in an order shuffled with `random.Random("20261027:<slug>")`
  and in one form, so that a judge cannot tell them apart: every judgment and rule finding of the main run at any
  confidence, every finding of the `--no-confirm` run that the main run does not have, and the page's chosen
  suggestions (below). Packets hold no `confidence` or `patch`, and a suggestion holds no quote. Two Claude judge agents
  per packet, an auditor and a skeptic, each told not to read the other's work, with the fourth study's rubric and prompt
  (`judge-rubric.md`, `scripts/judge_prompt.py`). **Pacing differs from the fourth study's**: up to 8 judge agents run at
  once (the auditor and skeptic of up to 4 packets), where the fourth study ran one packet's pair at a time; the agents
  are given no model or effort setting of their own. A judge that stops before writing a complete label file is launched
  again from scratch with the same prompt, and a partial file is not kept. Every label file is checked with
  `scripts/check_labels.py`. Final label: the label both gave, else `uncertain`; a false positive's cause is the one both
  named, else `disputed`.
- **Kept in git**: the part of each report the analysis reads (`scripts/compact.py`, `pages/<slug>/*.judged.json`);
  the full reports, consoles, recordings, screenshots and caches stay out, hashed in `data/recordings.json` and copied to
  `C:/Users/guilh/dev/rampa-study-recordings/round-5`.

**A known gap.** Section 6 of the notes asked for a blind human sample of the third and fourth studies' labels before
this round. It has not been done (the person running the study will do it later), so every label here, as before, is a
pre-annotation by two Claude agents of one model family.

## Primary measure

**Test-half precision per element at the default threshold over the judged criteria**: judgment findings of the eight
default criteria that are not experimental and have medium confidence or above (what `rampa check` shows and fails on),
from the main run; precision = TP / (TP + FP), uncertain left out. Two co-primary intervals:

- the **Wilson** 95% interval;
- a **page bootstrap**: 10,000 resamples, with replacement, of the 12 test pages (every one, also those with no decided
  finding), `random.Random(20261027)`, precision of each resample (a resample with no decided finding is skipped and
  counted), 2.5th and 97.5th percentiles.

**Comparison** with the fourth study's test half (14 of 26, 0.54) and with its two halves pooled (27 of 93, 0.29), each
by the difference and two 95% intervals: Newcombe's hybrid score interval (method 10, from the two Wilson intervals), and
a page-bootstrap interval of the difference (10,000 resamples of each study's pages, independently and with
replacement: the 12 test pages here against the fourth study's 12 test pages, or its 24 pages; `random.Random(20261027)`;
a resample with no decided finding on either side skipped). **The reading is fixed now:** precision **went up** against
a reference only when both intervals lie above 0, **went down** only when both lie below 0, and otherwise shows **no
measurable change**.

**How much held** (descriptive, no test): the per-element precision of each half and of both, set beside the in-sample
0.86 of the notes (95 of 111), and the share of it that held (this study's precision divided by 0.86).

## Secondary measures

1. **Per group, always next to per element.** A group is the report's: on one page, judgment findings at the default
   threshold with the same criterion, check id and claim kind, when there are 6 or more; it counts as one finding,
   labelled with the label most of its labelled members have (true, false or uncertain), a tie uncertain, unlabelled
   members not voting (`study/notes-precision-fixes/analyze.py`'s rule). Per half and pooled, with Wilson intervals; the
   groups listed with their sizes and members' labels.
2. **Per page.** Of the pages with a decided default-threshold finding, the share on which every decided finding is true,
   and the mean of the pages' precisions; per half and pooled.
3. **The dev half, both halves and every finding**: the same per-element measure on dev and pooled (with Wilson and page
   bootstrap intervals), and each half with every finding counted (`--min-confidence low`).
4. **Per criterion**, per half, at the default threshold and with every finding.
5. **The ablations** (all on the same snapshots and answers): precision with the second pass off, and the claims it moved
   (their labels: true positives sent to review, false positives removed); precision with the cut at 0.9, and the labels
   of the 1.1.1 claims between 0.9 and 0.99; precision without the H81 nesting (the main findings plus the 2.4.4 "shared
   by" suggestions on links it tells apart), with the grounded-candidate counts; and the capture log of every page, with
   the judgments of any page read as unstyled. The second pass's shares (confirmed, denied, not asked), as the fourth
   study gave them.
6. **The suggestion sample** (`scripts/sample_suggestions.py`). Of the main run's suggestions (review items that name a
   model), other than the second pass's (labelled through the `--no-confirm` run), labelled in full: every suggestion on a
   page read as unstyled; every 2.4.4 "shared by" claim on a link the nesting tells apart; every 2.4.2 and every 3.3.2
   suggestion. Of the rest, 20 per split drawn as the fourth study drew them (a fixed order, `random.Random(20261027)`,
   dev then test, at most 3 from a page). Reported per reason and split: the share of true failures with its Wilson
   interval; for the reasons labelled in full, the count of true failures moved to review (the recall those rules cost on
   these pages); for the drawn ones, that share times the pool.
7. **Bursts.** Every page with 6 or more default-threshold findings of one claim (the group of item 1), and every page
   with 6 or more suggestions or `--no-confirm` findings of one claim, listed with its size and labels; its mechanism
   described from the dev half only, the test half's counted.
8. **Sensitivity**: each half without its page with the most default-threshold judged findings; uncertain counted as true
   and as false.
9. Experimental rules (all below the threshold) per check, and the judges' agreement (observed, Cohen's kappa over the
   three labels, and over the causes of the false positives both named), as in the fourth study.

## Rules fixed now

- **Network drops.** An attempt that fails with a network error (`net::ERR_*`, a DNS failure), or whose log shows one,
  does not count. It is tried again once the connection answers, up to three more times.
- **Refusals.** A bot challenge, an HTTP 403, 429 or 503 page, a rate-limit or sign-in page, or a crash that saves no
  snapshot: wait at least 10 minutes and try once more. Refused again, the page is replaced by its slot's next backup
  that passes the screen, keeping the slot's split; for an inner slot, the backup site's inner page is picked by the
  slot's rule before Rampa runs on it. Every attempt is logged and set aside in `pages/<slug>/discarded-*`.
- **An unstyled capture is not a refusal**: a page the snapshot says is unstyled stays, and is reported.
- **Once.** Each page is collected and judged once; nothing is collected or judged again because of what Rampa found.
  `src/` does not change. A script is changed after this commit only to fix a bug that stops it, and the change is
  logged. The analysis scripts (analyze, extras, tables, exploratory) are adapted after this commit from the fourth
  study's and `study/notes-precision-fixes/analyze.py` to compute the measures written here, and are committed before the
  first label file is written.
- **Reading.** The test half's false positives are counted by check and cause, never read for patterns; the dev half's
  are described as candidates for future fixes. The test numbers are reported once. Every number is named for what it
  is: held-out (this study's, both halves: the code saw neither) or exploratory (any comparison not written here).

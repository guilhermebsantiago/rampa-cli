# Precision fixes after round 4: frozen rules and the in-sample replay (2026-10-27)

The fourth real-page study ([round 4](real-pages-2026-10-round4.md)) measured 0.54 on its test half, 0.19 on its dev half and 0.29 pooled. Two analyses of its labels and of the second and third studies' ([precision next](notes-precision-next.md), [precision check](notes-precision-check.md)) agree that almost all of the false positives left are bursts on a few pages: over the three studies, 95 true and 129 false findings, 100 of the false ones on www.ufpe.br and www.toolstation.com and 8 more on museudoamanha.org.br. These notes record the fixes built from them, the rules and thresholds frozen before the final replay, and that replay.

**Every number here is in-sample.** All six halves of the three studies have been read, and the fixes were chosen from them. The labels are the studies' two Claude judges, not people. A held-out number needs a fifth round on fresh pages.

## 1. What was built

- **F1, the list item a link is nested in (H81).** The 2.4.4 shared-text fact ("shared by N links that lead to different places, and nothing around this one tells it apart") now compares, besides the link's own sentence, list item, cell, header cells, description and sections, the list items it is nested in: the text of each enclosing item outside the nested list, its link or button included ("Deals" over a department list nested under "Deals"), and the name a list, menu, menubar, group or tree around the link has of its own (`aria-label`, `aria-labelledby`: a submenu named by the button that opens it). A screen reader reads the nesting whether the menu shows or not, so this holds for a menu kept for screen readers only, as toolstation.com's footer was (`src/criteria/link-purpose.ts`, `nestingOf`). The prompt is unchanged except for the shared-text line of the links whose fact changes.
- **F2, a page with no style at all.** A page whose body text has the browser's default look (16 px, weight 400, `rgb(0, 0, 0)`, a default serif family: `times new roman`, `times`, `serif`, `tinos`, `liberation serif`, `dejavu serif`; the look most of its body text has, as `bodyLook` reads it), with no author style sheet applied (none linked, none in a `style` element with a rule, none adopted) and at least 150 elements, is loaded once more and, if unchanged, recorded as unstyled (`reach.stylesheets` with `linked: 0`, `unstyled: true`, `retried: true`): its judgment fails become suggestions and nothing is measured from pixels, as for a page whose linked stylesheets failed (`src/surfaces/web.ts`, `src/surfaces/page-look.ts`, `src/snapshot/look.ts`). A recording made before the collector looked (no `authorStyles` on the root) is read at check time from its body look and its number of elements alone (`src/snapshot/reach.ts`, `captureStyle`). A `link rel="stylesheet"` whose address is the page itself is no longer counted as a stylesheet, and a recording that counted one as its only failed sheet while another sheet applied is read as styled (www.thejournal.ie in round 4). The 150-element floor keeps a small page written without CSS, such as a W3C ACT test case, out of it.
- **F3, the 0.99 cut on the 1.1.1 second pass.** `CONFIRM_MIN_PROBABILITY` goes from 0.9 to 0.99 (`src/core/confirm.ts`), adopted on the replay of section 3 below, which recorded every second-pass probability.
- **2.4.2 and 3.3.2 claims with no fact behind them are suggestions.** Neither criterion had a true finding in four studies. A 2.4.2 fail is a finding only for a title on the generic lists, an address or a file name (`genericTitle`), or a title identical to another page of the same site (a crawled page or a linked page read); a mismatch with the page's subject is the model's suggestion (`groundedTitle`). A 3.3.2 fail on a field is a finding only when the field's only label was measured as unseen by its pixels, or when nothing visible sits beside the field (no visible label, no placeholder, no text just before or after it, no button next to it); a field off screen or a search field stays a suggestion as before (`groundedLabel`). The experimental 3.3.2 option-group and date-format judgments, below the default threshold, are unchanged.
- **F4, the landmark a link sits in: not adopted.** Two variants were replayed on the recorded snapshots (`shared-text.ts`): adding the nearest landmark's role and name to the shared-text comparison removes osesp.art.br's two "Ouvidoria" findings but also one of the 21 true shared-text findings (a correio "Capa"), and adding only named landmarks changes nothing, since osesp's two landmarks have no name. Neither is clean.
- **Burst collapse in the report** is built by a second agent in its own worktree (report formats, MCP format, output schemas). The group definition is shared and fixed: on one page, findings with the same criterion, the same check id and the same claim kind form a group when there are more than 5 of them, that is 6 or more. The study tooling here counts precision per group by that definition, and always next to precision per element.

## 2. Frozen rules and thresholds

Written down before the final replay of section 4; nothing below was changed after it.

| Rule | Value | Where |
| --- | --- | --- |
| H81 nesting context | enclosing list items' own text (before the nested list, else after it, lists left out), truncated at 120 characters; names of `list`, `menu`, `menubar`, `group`, `tree` from `aria-label` / `aria-labelledby` | `link-purpose.ts`, `nestingOf` |
| Landmark context (F4) | not used | |
| Default body look | 16 px, weight 400, `rgb(0, 0, 0)`, not italic, family in the list above | `look.ts`, `isDefaultLook`, `DEFAULT_FAMILIES` |
| No author style | 0 sheets with a rule (or unreadable from another origin) among `document.styleSheets` and `adoptedStyleSheets`, a link to the page itself left out | `page-look.ts` |
| Element floor | 150 elements in the page's own document (in the page: `getElementsByTagName('*')`; in a recording: snapshot nodes outside shadow roots and frames) | `look.ts`, `PLAIN_PAGE_ELEMENTS` |
| Old-recording fallback | default body look, no `reach.stylesheets`, no `authorStyles`, at least 150 nodes | `reach.ts`, `captureStyle` |
| Self-link correction | a recorded `unstyled` whose every failed sheet is the page's own address, with at least one sheet applied, reads as styled | `reach.ts`, `captureStyle` |
| Second-pass threshold | 0.99 (lowest probability of a confirming word over the three framings) | `confirm.ts` |
| 2.4.2 grounded | `generic` or `filename_or_url` on a generic title, address or file name; `generic` on a title identical to a sibling page's | `page-titled.ts`, `groundedTitle` |
| 3.3.2 grounded | not collapsed, not a search field, and: `no_visible_label` with `unseen` or nothing beside the field; `rule_not_explained` with a pattern and nothing beside the field | `labels-or-instructions.ts`, `groundedLabel` |
| Burst group | same page, criterion, check id and claim kind; more than 5 (6 or more) | shared with the report's collapse |
| Group label | the label most of its labelled members have (true, false or uncertain); a tie is uncertain; unlabelled members do not vote | `study/notes-precision-fixes/analyze.py` |

**Counting**, as `analyze.py` does it: judgment findings at the default threshold (confidence medium or high, not experimental), matched to the labels by page, criterion and element; precision = TP / (TP + FP) with uncertain findings left out, Wilson 95% intervals; per group, each group of 6 or more one unit; per page, the share of pages with a decided finding on which every decided finding is true, and the mean of the pages' precisions; findings with no label are counted apart as new and unlabelled, never in a precision.

**The replay** (`replay.sh`): each page's recorded snapshot, the studies' flags (`--min-confidence low --time-limit 900 --concurrency 2`), Gemma 4 12B through Ollama, and a fresh copy of a judgment cache: for the third study and the second, the precision probe's `cache-impl` (which holds the merged code's answers, the second pass's included); for the fourth, the main run's cache. On the second study, 2.4.4 and 2.4.6 changed version since its run and their answers were not kept, so their findings are carried from its re-judged run with the rules since applied (as the precision probe did), F1 applied from the shared-text replay. What the cache lacks (the candidates the 2.4.4 cap now reaches on toolstation.com, the second pass over a claim the guard no longer moves) is asked of the model and kept in the copy. The baseline is the same replay of `6a8de75` (main `62bbf37`), offline, with no cache miss.

**Expected, written before the final replay** (from the baseline replay of section 3 and the deterministic replays): F1 removes toolstation.com's 50 false findings; F2 removes www.ufpe.br's 50 and museudoamanha.org.br's 8; F3 removes 5 false and 2 uncertain 1.1.1 findings; item 4 at most gla.ac.uk's one 3.3.2 finding; no true finding lost. That would move the pooled per-element precision from 95 / 129 (0.42) to about 95 / 16 (0.86). The toolstation.com cap now reaches 50 other links, and thejournal.ie's four claims leave the guard: both may add new, unlabelled findings, reported apart.

## 3. The baseline replay, and the second-pass probabilities

The merged code before these fixes (`6a8de75`), replayed offline on the 72 recorded pages with the caches above: 72 reports, 0 cache misses, and every half's numbers equal the studies' and the probe's (`data/base/`, `analyze.py base`): s2 dev 19 / 0, s2 test 10 / 3, s3 dev 15 / 3, s3 test 24 / 57, s4 dev 13 / 54, s4 test 14 / 12; pooled **95 / 129 / 7 uncertain, 0.42 (0.36–0.49)**.

Its reports carry the lowest second-pass probability of every confirmed 1.1.1 finding, which the probe's replay reports had not kept. Under 0.99 (F3):

| Study | False findings under 0.99 | Uncertain under 0.99 | True findings under 0.99 | Lowest true finding |
| --- | --- | --- | ---: | --- |
| s2 | – | 0.914 ("Ceará em Destaque"), 0.924 ("Capa AFN") | 0 | 0.99909 |
| s3 | 0.905 ("App Store Badge"), 0.959 ("get care icon"), 0.986 ("boletim") | – | 0 | 0.99659 ("Botão Rybená LIBRAS") |
| s4 | 0.98664 ("Autor avatar"), 0.98700 ("CC BY ND") | – | 0 | 0.99991 |

The cut costs no true finding on any study (the closest true one is 0.0066 above it) and removes 5 false and 2 uncertain ones, so it was adopted. Above it, 7 false 1.1.1 findings remain, between 0.998 and 0.99998 ("Connect with us", "fullepisode", "Imagem de alunos no Campus da PUC-Rio", "istagram", "Flexible-Fuel", "Logo Boletim UFPR", "shield"): no threshold on this signal reaches them without true findings.

## 4. The final replay, in-sample

The frozen code (`dist` built at the commit in `data/after-commit.txt`), replayed with the protocol of section 2 (`replay.sh after … online`, `analyze.py base after`): 72 reports, no error, no cache miss. New model calls were needed on one page only: on www.toolstation.com the 2.4.4 cap now reaches 50 other links (50 new calls: 43 passed, 7 dropped by verification, no finding and no suggestion). **Every number below is in-sample**; the labels are the studies' two Claude judges.

| Study | Half | Per element before | Per element after | Page bootstrap after | Per group before | Per group after |
| --- | --- | --- | --- | --- | --- | --- |
| s2 (fresh) | dev | 19 / 0 (2 unc.): 1.00 (0.83–1.00) | 19 / 0: 1.00 (0.83–1.00) | 1.00–1.00 | 19 / 0: 1.00 | 19 / 0: 1.00 |
| s2 | test | 10 / 3: 0.77 (0.50–0.92) | 10 / 3: 0.77 (0.50–0.92) | 0.14–1.00 | 10 / 3: 0.77 | 10 / 3: 0.77 |
| s3 (round 3) | dev | 15 / 3 (1): 0.83 (0.61–0.94) | 15 / 2 (1): 0.88 (0.66–0.97) | 0.70–1.00 | 15 / 3: 0.83 | 15 / 2: 0.88 |
| s3 | test | 24 / 57 (2): 0.30 (0.21–0.40) | 24 / 5 (2): **0.83** (0.65–0.92) | 0.78–0.94 | 12 / 6: 0.67 | 12 / 3: 0.80 |
| s4 (round 4) | dev | 13 / 54 (2): 0.19 (0.12–0.30) | 13 / 2 (2): **0.87** (0.62–0.96) | 0.62–1.00 | 6 / 5: 0.55 | 6 / 2: 0.75 |
| s4 | test | 14 / 12: 0.54 (0.35–0.71) | 14 / 4: **0.78** (0.55–0.91) | 0.36–0.95 | 7 / 5: 0.58 | 7 / 4: 0.64 |
| all | dev | 47 / 57 (5): 0.45 (0.36–0.55) | 47 / 4 (3): 0.92 (0.81–0.97) | 0.83–1.00 | 40 / 8: 0.83 | 40 / 4: 0.91 |
| all | test | 48 / 72 (2): 0.40 (0.32–0.49) | 48 / 12 (2): 0.80 (0.68–0.88) | 0.67–0.90 | 29 / 14: 0.67 | 29 / 10: 0.74 |
| **all** | both | 95 / 129 (7): **0.42** (0.36–0.49) | 95 / 16 (5): **0.86** (0.78–0.91) | 0.78–0.92 | 69 / 22: 0.76 | 69 / 14: **0.83** (0.74–0.90) |

Cells are true / false (uncertain) findings and precision with its Wilson 95% interval; "per group" counts each group of 6 or more findings of one claim on one page as one finding (section 2). Per study over both halves, per element: s2 29 / 3 (0.91) before and after; s3 39 / 60 (0.39) to 39 / 7 (0.85); s4 27 / 66 (0.29) to 27 / 6 (0.82).

- **No true finding was lost, and no finding appeared.** 113 false findings and 2 uncertain ones left the default threshold, all as suggestions: toolstation.com's 50 (F1), www.ufpe.br's 50 and museudoamanha.org.br's 8 (F2, both read from their recordings' body look), and five 1.1.1 findings under 0.99 with the two uncertain ones (F3: fleury "App Store Badge", mg.gov.br "boletim", clevelandclinic "get care icon", infomoney "Autor avatar", theconversation "CC BY ND"). Item 4 removed no default-threshold finding: gla.ac.uk's "course keyword" field, whose name is in its `title`, has nothing visible beside it by Rampa's facts, so its 3.3.2 claim stays a finding (false by the labels); six below-threshold 2.4.2 claims, all false where labelled, became suggestions.
- **Suggestions** (the model's fails no fact supports, listed for review) went from 235 to 306 on the 72 pages: +50 2.4.4 on ufpe, +8 3.1.2 on museudoamanha, +6 1.1.1 from the cut (and thejournal.ie's one 1.1.1 suggestion left, now an experimental hidden-image finding below the threshold), +6 2.4.2, +1 3.1.2 on ufpe.
- **Per group and per page.** With bursts collapsed, the pooled precision is 0.83 after (0.76 before). The remaining groups are all true but one mixed (correio's 6 shared-text links, 3 true, 2 false, 1 uncertain, counted true): tst.jus.br's 8 shared-text links, theconversation's 8 language parts, correio's and ed.ac.uk's 6 functional images. Of the 39 pages with a decided finding after, 27 have only true ones (24 of 44 before), and the mean of the pages' precisions is 0.81 (0.70 before).
- **What is left**, 16 false findings on 12 pages, one or two a page: seven 1.1.1 claims every second-pass framing confirmed at 0.998 or more (section 3), seven 2.4.4 shared-text links (osesp.art.br's two "Ouvidoria", one of which redirects by script to the other; thomann 2, correio 2, pimoroni 1) and correio's generic "SAIBA MAIS", and gla.ac.uk's 3.3.2. None of them is a burst.
- **Against the projections.** The precision check projected 0.82 (0.74–0.88) in-sample for F1 + F2 and 0.83 with F3; the next-iteration notes projected 0.86 for items 1–4. The replay gives 0.86, as the frozen expectation of section 2 said (95 / 16), because each fix removed exactly the findings it was built for and nothing else. That agreement says the code does what the simulation assumed; it says nothing about fresh pages.

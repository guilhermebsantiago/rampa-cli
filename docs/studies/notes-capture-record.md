# The capture record on the 48 dev pages: an offline replay (2026-11-09)

Every report `rampa check` makes now carries `capture`, one object that gathers how faithfully the page was read: whether it was read with its styles, the stylesheets that did not apply, a layer over the viewport, a bot check or an error status, a cut at the budget of elements, a page still changing when it was read, the images with and without a capture, and the candidates the model did not judge ([output formats](../output-formats.md#json)). These notes record what was built, an offline replay showing that nothing else in the reports moved, and the records of the 48 dev pages of the second to fifth real-page studies.

**What each number is.** Every number here is **counted** and **in-sample (dev)**: the 12 dev pages of each of the four studies (48 pages), chosen by each study's `data/pages.json`. No cache, snapshot, report or finding of a test page was opened, in any study. Nothing here measures precision or recall.

## 1. What was built

- **`src/core/capture.ts`** exports the type `CaptureRecord` and one pure function, `captureRecord(snapshot, summaries)`, with no model, file or network access. `checkSnapshot` (`src/core/check.ts`) sets `capture` on every report it builds, from the snapshot and the criteria's summaries, after everything else is decided; `Report.capture` is optional in `src/core/types.ts`.
- **The fields**, each absent when there is nothing to say: `version` (1) and `styled`, always; `styledBy` (`captureStyle`); `stylesheets` (counts from `reach.stylesheets`); `overlay` (`reach.overlay`, without its ref); `blocked`; `httpStatus`; `cut` (`pageCut`); `unsettledAfterMs` and `loadTimedOutMs` (`reach`); `images` (image nodes with a crop, and those with a `native.imageSkipped` reason, by reason); `notJudged` (per criterion, `capped`, `timedOut`, `offlineMisses` and `errors` from its summary). A page read in full gives `{ "version": 1, "styled": true }` and `images`.
- **What an image node is.** Role `img`; an `img`, `svg` or `canvas` element; an `input` of type `image`; or an Android image control. On the web, `captureImageNodes` (`src/surfaces/image-capture.ts`) gives each image it tries either a crop or a reason; `notCaptured` counts every node with a reason, the same walk as the report's note on images left without a capture. The crops of CSS backgrounds, which other elements carry for 1.4.5, are not counted as captured images.
- **No covered share.** The record holds no share of an image's crop covered by other page content, nor anything else read from boxes about paint order. On the same 48 dev pages, boxes alone flagged 129 of 703 crops (0.18) at a share of 0.05 or more, while by eye 9 of 25 crops looked at had content painted over them, and 1 of the 15 looked at with a share of 1 (counted, in-sample, dev; [crop-overlay notes](notes-crop-overlay.md), sections 4 and 6). The carousel count that followed found 1 crop of 298 in slide groups showing another slide, which no field of the snapshot reveals ([carousel notes](notes-carousel-crops.md)); the record does not try either.
- **Unchanged:** the snapshot's schema (every input is a snapshot field already, so a recording of any age gives the record on replay), `findings`, `belowThreshold`, `needsReview`, `discarded`, `criteria`, `coverage`, `notes`, `blocked`, `httpStatus`, the exit code and every cache key. `Report.schemaVersion` stays 1; the record has its own `version`. [schema/report.schema.json](../../schema/report.schema.json) describes it. The report of a target that could not be loaded (`notLoaded`) has none. The terminal, Markdown, HTML and SARIF reports do not show it yet.
- **Two facts are new to the report:** how many images have a capture (the report gave only those without one, in a note, and only when a criterion that looks at pixels ran), and `unsettledAfterMs`, which `coverage.reach` left out.

## 2. The replay

[`study/notes-capture-record/replay.sh`](../../study/notes-capture-record/replay.sh) runs `rampa check` on each dev page's recorded snapshot, offline, with the studies' flags (`--min-confidence low --time-limit 900 --concurrency 2`, English), every default criterion on the third to fifth studies and `1.1.1, 1.3.5, 2.4.2, 3.1.1, 3.1.2, 3.3.2` on the second, and a fresh copy of each page's judgment cache from the P3/P4 replay (`rampa-study-recordings/notes-precision-p3p4-2026-10-29/caches-after`). It ran twice: with a build of `fix/target-failure` at `9cf6302`, the base of this branch, and with a build of this branch. API key variables were unset and no model was asked.

[`compare.ts`](../../study/notes-capture-record/compare.ts) compares the two reports of each page field by field once `capture`, `createdAt` and `rampaVersion` are removed, and checks the record against the rest of its own report.

- **48 of 48 pages, 0 differences.** The exit code of every page is the same on both builds (7 exit 0, 41 exit 1). Neither build had an offline miss.
- **The record agrees with its report on every page:** on the 26 pages with a note on images left without a capture, `images.notCaptured` is the note's count, no other page has an image without a capture, and every `notJudged` count is its criterion's summary's (0 mismatches).
- **Captured images: 708.** The crop-overlay notes counted 709 crops of image elements on the same snapshots; the one apart is a CSS background's crop on an `input type="submit"` on `rijksmuseum-nl-newsletter`, which those notes counted by its tag and the record, by design, does not.

## 3. The records of the 48 dev pages

Counted, in-sample (dev). "Not judged" are candidates the model did not judge; on this replay all of them were past the cap of 50 candidates per criterion and page (`--max-candidates`), since the caches answered every question and no page came near the time limit. The second study's replay does not run 2.4.4 or 2.4.6, so it has none.

| Study | Pages | Not styled | Stylesheets recorded | Overlay | Blocked | HTTP error | Cut | Unsettled | Load timed out | With `images` | Images captured | Pages with images not captured | Images not captured | By reason | Pages with candidates not judged |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | ---: |
| Second (fresh, 2026-10-11) | 12 | 0 | 0 | 0 | 0 | 0 | 1 | 5 | 0 | 12 | 215 | 8 | 420 | outside-page 7, clipped 1, not-shown 13, not-loaded 1, limit 398 | 0 |
| Third (2026-10-23) | 12 | 0 | 0 | 0 | 0 | 0 | 1 | 4 | 0 | 12 | 196 | 8 | 336 | outside-page 13, clipped 1, not-shown 1, not-loaded 1, blank 1, capture-failed 9, limit 310 | 9 |
| Fourth (2026-10-24) | 12 | 0 | 1 | 2 | 0 | 0 | 1 | 1 | 0 | 11 | 131 | 5 | 121 | outside-page 19, not-shown 4, limit 98 | 7 |
| Fifth (2026-10-28) | 12 | 0 | 1 | 0 | 0 | 0 | 2 | 5 | 0 | 12 | 166 | 5 | 140 | outside-page 3, clipped 1, not-loaded 12, blank 1, limit 123 | 8 |
| **All four** | **48** | **0** | **2** | **2** | **0** | **0** | **5** | **15** | **0** | **47** | **708** | **26** | **1,017** | outside-page 42, clipped 3, not-shown 18, not-loaded 14, blank 2, capture-failed 9, limit 929 | **24** |

Candidates not judged, all four studies:

| Criterion | Pages | Candidates on those pages | Capped | Timed out | Offline misses | Errors |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 2.4.4 | 24 | 3,634 | 2,434 | 0 | 0 | 0 |
| 2.4.6 | 3 | 376 | 226 | 0 | 0 | 0 |

What the table shows:

- **No dev page was read unstyled, blocked or as an error page**, and none timed out on load. The studies chose pages that could be read; the two recorded pages Rampa reads as unstyled (www.ufpe.br and museudoamanha.org.br) are not among these 48.
- **Two pages had one stylesheet that did not apply** (`es-gov-br`, 1 of 18; `santacasasp`, 1 of 34), both read with their styles. **Two had a layer over 89% of the viewport**, hidden for the captures (`toolstation-plumbing`, `bhf-article`).
- **Five pages were cut at 5,000 elements.** Four of them have one image captured or none (`mackenzie-vestibular` has no image node with a crop or a reason, so no `images`); what comes after a cut is not in the snapshot, so its images are in neither count.
- **15 pages were still changing when the wait after load reached its cap of 3,000 ms.** The report did not say this before.
- **Most images without a capture are past the per-page limit of 25** (929 of 1,017), on 21 pages. The rest are images mostly outside the page (42), transparent where they sit (18), still loading (14), whose screenshot failed (9, all on `museudoipiranga`), cut off by their box (3) or blank (2).
- **24 pages had candidates past the cap**, on 2.4.4 (24 pages) and 2.4.6 (3); `lakeland` alone left 793 of 843 links unjudged.

Per page (`—`: the field is absent):

| Study | Page | Styled | Overlay | Cut | Images captured | Not captured (by reason) | Not judged | Other fields |
| --- | --- | --- | --- | --- | ---: | --- | --- | --- |
| s2 | ce-gov-br | yes | — | — | 24 | 7 (clipped 1, limit 6) | — | — |
| s2 | unicamp-br | yes | — | — | 25 | 29 (limit 29) | — | — |
| s2 | poder360-com-br | yes | — | — | 14 | 97 (outside-page 5, not-shown 8, limit 84) | — | unsettled after 3000 ms |
| s2 | martinsfontes-literatura | yes | — | 5000 | 1 | 0 | — | unsettled after 3000 ms |
| s2 | fiocruz-br | yes | — | — | 25 | 8 (limit 8) | — | — |
| s2 | pinacoteca-org-br | yes | — | — | 24 | 152 (not-loaded 1, limit 151) | — | unsettled after 3000 ms |
| s2 | ons-gov-uk | yes | — | — | 13 | 0 | — | — |
| s2 | berkeley-edu-admissions | yes | — | — | 10 | 0 | — | — |
| s2 | propublica-org-article | yes | — | — | 18 | 37 (outside-page 2, not-shown 5, limit 30) | — | unsettled after 3000 ms |
| s2 | ikea-com-tables-chairs | yes | — | — | 25 | 69 (limit 69) | — | unsettled after 3000 ms |
| s2 | medlineplus-gov-diabetes | yes | — | — | 25 | 21 (limit 21) | — | — |
| s2 | rijksmuseum-nl-newsletter | yes | — | — | 11 | 0 | — | — |
| s3 | cnj-ouvidoria | yes | — | — | 12 | 0 | 2.4.4 (capped 15 of 65) | — |
| s3 | puc-rio-vestibular | yes | — | — | 19 | 1 (clipped 1) | — | — |
| s3 | metropoles-com | yes | — | — | 25 | 127 (outside-page 1, not-loaded 1, limit 125) | 2.4.4 (capped 364 of 414); 2.4.6 (capped 111 of 161) | unsettled after 3000 ms |
| s3 | travessa-com-br | yes | — | — | 19 | 132 (outside-page 6, limit 126) | 2.4.4 (capped 51 of 101) | — |
| s3 | hcor-com-br | yes | — | — | 22 | 16 (outside-page 3, limit 13) | 2.4.4 (capped 28 of 78) | unsettled after 3000 ms |
| s3 | museudoipiranga | yes | — | — | 16 | 29 (outside-page 1, capture-failed 9, limit 19) | — | — |
| s3 | canada-ca | yes | — | — | 6 | 0 | 2.4.4 (capped 12 of 62) | unsettled after 3000 ms |
| s3 | kcl-undergraduate | yes | — | — | 9 | 0 | 2.4.4 (capped 8 of 58) | — |
| s3 | pbs-article | yes | — | — | 13 | 2 (outside-page 2) | 2.4.4 (capped 46 of 96) | — |
| s3 | halfords-motoring | yes | — | 5000 | 25 | 20 (limit 20) | 2.4.4 (capped 67 of 117) | — |
| s3 | clevelandclinic | yes | — | — | 23 | 9 (not-shown 1, blank 1, limit 7) | 2.4.4 (capped 33 of 83) | unsettled after 3000 ms |
| s3 | tate-contact | yes | — | — | 7 | 0 | — | — |
| s4 | es-gov-br | yes | — | — | 5 | 0 | — | stylesheets: 1 of 18 failed |
| s4 | mackenzie-vestibular | yes | — | 5000 | — | — | — | — |
| s4 | infomoney-article | yes | — | — | 8 | 4 (outside-page 4) | 2.4.4 (capped 68 of 118) | — |
| s4 | cobasi-cachorro | yes | — | — | 25 | 20 (limit 20) | 2.4.4 (capped 104 of 154) | — |
| s4 | hospitalmoinhos | yes | — | — | 10 | 32 (outside-page 15, not-shown 1, limit 16) | — | unsettled after 3000 ms |
| s4 | osesp-contato | yes | — | — | 4 | 0 | — | — |
| s4 | gov-scot | yes | — | — | 18 | 0 | 2.4.4 (capped 13 of 63); 2.4.6 (capped 10 of 60) | — |
| s4 | leeds-undergraduate | yes | — | — | 13 | 0 | 2.4.4 (capped 26 of 76) | — |
| s4 | conversation | yes | — | — | 6 | 0 | 2.4.4 (capped 5 of 55) | — |
| s4 | toolstation-plumbing | yes | div (89%, hidden) | — | 25 | 62 (limit 62) | 2.4.4 (capped 427 of 477) | — |
| s4 | bhf-article | yes | div (89%, hidden) | — | 15 | 3 (not-shown 3) | 2.4.4 (capped 10 of 60) | — |
| s4 | nls-contact | yes | — | — | 2 | 0 | — | — |
| s5 | ms-gov-br | yes | — | — | 8 | 1 (blank 1) | 2.4.4 (capped 3 of 53) | — |
| s5 | pucrs-graduacao | yes | — | — | 25 | 56 (limit 56) | 2.4.4 (capped 261 of 311); 2.4.6 (capped 105 of 155) | — |
| s5 | correio24horas | yes | — | — | 25 | 27 (limit 27) | 2.4.4 (capped 15 of 65) | unsettled after 3000 ms |
| s5 | hering | yes | — | — | 24 | 0 | 2.4.4 (capped 28 of 78) | — |
| s5 | santacasasp | yes | — | — | 10 | 52 (outside-page 3, clipped 1, not-loaded 12, limit 36) | — | stylesheets: 1 of 34 failed; unsettled after 3000 ms |
| s5 | museu-lingua | yes | — | — | 8 | 0 | 2.4.4 (capped 16 of 66) | — |
| s5 | food-ratings | yes | — | — | 1 | 0 | — | — |
| s5 | ncl-ac-uk | yes | — | 5000 | 1 | 0 | — | — |
| s5 | irishcentral-article | yes | — | 5000 | 1 | 0 | — | unsettled after 3000 ms |
| s5 | lakeland | yes | — | — | 19 | 0 | 2.4.4 (capped 793 of 843) | unsettled after 3000 ms |
| s5 | patient-article | yes | — | — | 25 | 4 (limit 4) | 2.4.4 (capped 34 of 84) | unsettled after 3000 ms |
| s5 | horniman | yes | — | — | 19 | 0 | 2.4.4 (capped 7 of 57) | — |

## 4. hcor-com-br (third study)

```json
{
  "version": 1,
  "styled": true,
  "unsettledAfterMs": 3000,
  "images": { "captured": 22, "notCaptured": 16, "reasons": { "outside-page": 3, "limit": 13 } },
  "notJudged": [{ "criterion": "2.4.4", "candidates": 78, "capped": 28 }]
}
```

- **Images:** 22 with a capture and 16 without, 13 past the limit of 25 and 3 mostly outside the page: the banner carousel's three loop clones left of its track (`owl-item cloned`, recorded at a negative `x`), which no box can be scrolled to, as the carousel notes describe. The report said the 16 in a note before; the 22 are new.
- **2.4.4:** 28 of the page's 78 link candidates were past the cap of 50 and not judged, which the report said in a note and in the criterion's summary.
- **What it does not say.** The crop of the "Alerta de Golpe" banner shows the site's navigation and four service cards drawn over the picture, and the crop of the slide whose alternative is "Votação Reclame aqui 2026" shows the next slide ([crop-overlay notes](notes-crop-overlay.md), [carousel notes](notes-carousel-crops.md)). Neither is in the record: the snapshot does not hold what was painted over a crop or where a slide was when it was cropped, and the record derives nothing from boxes about it.

## 5. Limits

- **Dev pages only**, 48 pages, read from the recordings of four studies; the per-study counts are small and uneven across pages.
- **A record of what the collector noticed, not proof that the capture equals what people see.** A styled page, no overlay and every image captured does not show that the crops, the text or the layout match the page in a person's browser: content painted over a crop, a carousel slide that moved before its crop and a layer the overlay test missed all leave the record as it is.
- **A headless-browser variant of a page is not detected.** A site may serve an automated browser a page of its own, with its styles; the record then describes that page faithfully. `blocked` covers only the bot checks and refusals the collector recognizes, and `styled` catches a stripped page only when it has no style at all and the browser's default look.
- **Image nodes the collector does not try are in neither count**: hidden, broken, smaller than 8 px, an unnamed `svg` the hidden-image signals leave out, and anything past a cut. `images` is absent when the collector tried no image, which also happens on a run without image capture (`--no-llm`, or no criterion that looks at pixels).
- **`notJudged` here holds only the cap.** The caches answered every question, so this replay says nothing about how often a time limit, a missing cached answer or a model error leaves candidates unjudged on a live run. `offlineMisses` counts as the criterion's summary does, a second pass with no cached answer included.
- **Nothing here measures an effect on precision**: the record changes no verdict, and the replay shows only that the reports are otherwise the same.

## Data and reproduction

- `bash study/notes-capture-record/replay.sh <label> <dist dir>` from the repository root, once with a build of the base and once with a build of this branch (`before` and `after` here). It reads the recordings at `C:/Users/guilh/dev/rampa-study-recordings` (read only) and copies each dev page's cache; the full reports, consoles and cache copies go to `.rampa/capture-record/` (ignored by git).
- `node study/notes-capture-record/compare.ts before after > study/notes-capture-record/data/table.md` writes the tables above and [`data/records.json`](../../study/notes-capture-record/data/records.json): the comparison, the cross-checks, the tallies and every page's record.

# Image crops with other page content over them: a dev-only count (2026-11-09)

In round 3's dev page `hcor-com-br`, the crop of the "Alerta de Golpe" banner shows the site's navigation and four service cards on top of the banner, and a specialist reviewing it said the crop confused her. These notes measure how often the image crops the model saw have other page content inside their box, and how much of the box, on the recorded dev pages of the four real-page studies. It is a measurement and a note: nothing under `src/` changed.

**What each number is.** Every number here is **counted** and **in-sample (dev)**: the 12 dev pages of each of the four studies (48 pages), chosen by each study's `data/pages.json` before any snapshot was opened. No snapshot, report or finding of a test page was opened, in any study. The labels quoted in section 5 are the studies' two Claude judges (an auditor and a skeptic), a pre-annotation and not ground truth. Nothing here measures an effect on precision.

## 1. What the code hides before a crop, and what it does not

- **`rampa check`** (the path every study used) captures images in `captureImages` (`src/surfaces/web.ts`) through `captureImageNodes` (`src/surfaces/image-capture.ts`). Before each crop it hides every `position: fixed` or `sticky` layer that does not hold the image, and a layer detected over the viewport whatever its position (`markLayers`, `showLayersAround`). `prepareImageInPage` scrolls the image into view in every box that scrolls (so a carousel shows the slide) and hides the branches of other pictures stacked in the same box (intersection over union of 0.8 or more, not the same picture). The crop is a Playwright element screenshot: whatever is painted in the element's box at that moment is in it.
- **It does not hide** ordinary or absolutely positioned content that overlaps the image: a caption over a banner, a navigation bar drawn over a hero, cards pulled up over a picture, an empty link stretched over a card.
- **The library path** (`collectPage` in `src/surfaces/page.ts`, with `screenshotElement` in `src/playwright.ts` and `src/puppeteer.ts`) shares `prepareImageInPage`, so it hides stacked pictures, but it hides no fixed or sticky layer.

## 2. What was counted, and how

[`study/notes-crop-overlay/overlay.py`](../../study/notes-crop-overlay/overlay.py) reads each dev page's `pages/<slug>/recording/<recording>.snapshot.json` from the study recordings and writes [`data/overlay.json`](../../study/notes-crop-overlay/data/overlay.json).

1. **Crops.** Every node with an `image` crop that is an image: role `img`, or tag `img`, `svg`, `canvas` or `input`. That is 709 crops; 6 have no recorded box and are left out, so the count runs on **703 crops** (fresh study 212, round 3 196, round 4 129, round 5 166), on 47 of the 48 pages. **473** of them have a non-empty alternative (`name`), the ones 1.1.1 judges.
2. **Candidates over a crop.** Nodes whose `bounds` intersect the image's box with a positive area, that are not the image, not an ancestor and not a descendant of it, not `hidden`, and carry something visible: own `text`, a `name`, or a role among link, button, heading, img, textbox. Left out and counted apart, because the capture hides them: a node in a fixed layer that does not hold the image (the node or an ancestor with `native.position` fixed), **181 candidates on 40 crops**; and a node in the branch of another picture stacked in the same box, as `prepareImageInPage` finds them, **14 candidates on 14 crops**.
3. **Covered share.** The share of the image's box inside the union of the candidates' boxes, on a 64 × 64 grid of cell centres over the box, so a parent and its children never count twice.
4. **Splits.** The same share from the candidates after the image in document order (more likely painted over it) and before it (more likely under it), and from the candidates whose recorded `native.position` is `absolute` and those with none recorded. **Geometry cannot tell paint order**: a box that overlaps the image may be under it, over it, or transparent; z-index, stacking contexts, floats and opacity are not in the snapshot.
5. **Flagged.** A crop is flagged when its covered share is at least **0.05**. The Hcor banner (`hcor-com-br`, ref ending `div:nth-of-type(4) > div > picture > img`) has a share of **0.22** (0.09 from the four cards after it, 0.13 from the navigation's items before it) and is flagged; the script stops if it is not.
6. **Calibration by eye.** The 15 crops with the highest share and 10 drawn with `random.Random(20261109)` among those with a share of at least 0.05 and under 0.25, written as PNG files under `.rampa/crop-overlay/` (git-ignored): the crop as recorded and the same crop with the candidates' boxes drawn. 57 crops tie at a share of 1, so the order among equal shares is a seeded shuffle with the same seed, not the page's name: the top 15 are a random draw among the 57. Each was opened and marked `painted over: yes, no, unclear`, with a line on what it shows (`calibration` in the JSON).

## 3. The count

Crops with a covered share above 0 and of at least 0.05, 0.25 and 0.5, over the crops with a box; each cell is the count (share, 95% Wilson interval). **Counted, in-sample (dev); geometry only.**

| Study | Crops | Share above 0 | At least 0.05 | At least 0.25 | At least 0.5 |
| --- | ---: | --- | --- | --- | --- |
| Fresh study (2026-10-11) | 212 | 36 (0.17, 0.13–0.23) | 24 (0.11, 0.08–0.16) | 10 (0.05, 0.03–0.08) | 5 (0.02, 0.01–0.05) |
| with an alternative | 149 | 22 (0.15, 0.10–0.21) | 10 (0.07, 0.04–0.12) | 2 (0.01, 0.00–0.05) | 1 (0.01, 0.00–0.04) |
| Round 3 (2026-10-23) | 196 | 44 (0.22, 0.17–0.29) | 39 (0.20, 0.15–0.26) | 35 (0.18, 0.13–0.24) | 33 (0.17, 0.12–0.23) |
| with an alternative | 129 | 37 (0.29, 0.22–0.37) | 34 (0.26, 0.20–0.35) | 30 (0.23, 0.17–0.31) | 30 (0.23, 0.17–0.31) |
| Round 4 (2026-10-24) | 129 | 27 (0.21, 0.15–0.29) | 27 (0.21, 0.15–0.29) | 10 (0.08, 0.04–0.14) | 8 (0.06, 0.03–0.12) |
| with an alternative | 93 | 24 (0.26, 0.18–0.36) | 24 (0.26, 0.18–0.36) | 7 (0.08, 0.04–0.15) | 5 (0.05, 0.02–0.12) |
| Round 5 (2026-10-28) | 166 | 54 (0.33, 0.26–0.40) | 39 (0.23, 0.18–0.30) | 29 (0.17, 0.12–0.24) | 22 (0.13, 0.09–0.19) |
| with an alternative | 102 | 24 (0.24, 0.16–0.33) | 22 (0.22, 0.15–0.30) | 16 (0.16, 0.10–0.24) | 13 (0.13, 0.08–0.21) |
| **All four** | **703** | **161 (0.23, 0.20–0.26)** | **129 (0.18, 0.16–0.21)** | **84 (0.12, 0.10–0.15)** | **68 (0.10, 0.08–0.12)** |
| with an alternative | 473 | 107 (0.23, 0.19–0.27) | 90 (0.19, 0.16–0.23) | 55 (0.12, 0.09–0.15) | 49 (0.10, 0.08–0.13) |

The flagged crops sit on 29 of the 47 pages, unevenly: `metropoles-com` alone has 22 of the 129, `cobasi-cachorro` 14, `unicamp-br` 9, `lakeland` and `patient-article` 8 each.

The same thresholds with only part of the candidates, all four studies, 703 crops:

| Candidates counted | Share above 0 | At least 0.05 | At least 0.25 | At least 0.5 |
| --- | --- | --- | --- | --- |
| All | 161 (0.23, 0.20–0.26) | 129 (0.18, 0.16–0.21) | 84 (0.12, 0.10–0.15) | 68 (0.10, 0.08–0.12) |
| After the image in document order | 130 (0.18, 0.16–0.22) | 98 (0.14, 0.12–0.17) | 56 (0.08, 0.06–0.10) | 43 (0.06, 0.05–0.08) |
| Before the image | 55 (0.08, 0.06–0.10) | 48 (0.07, 0.05–0.09) | 28 (0.04, 0.03–0.06) | 27 (0.04, 0.03–0.06) |
| Recorded `absolute` | 32 (0.05, 0.03–0.06) | 26 (0.04, 0.03–0.05) | 21 (0.03, 0.02–0.05) | 20 (0.03, 0.02–0.04) |
| No position recorded | 137 (0.19, 0.17–0.23) | 106 (0.15, 0.13–0.18) | 63 (0.09, 0.07–0.11) | 47 (0.07, 0.05–0.09) |

31 of the 129 flagged crops are flagged only by candidates before the image (their share from candidates after it is under 0.05).

## 4. Calibration by eye: how many really show content over the image

**Of the 25 crops looked at, 9 show other page content over the image, 14 do not, and 2 are unclear.** The Hcor banner, looked at as well, shows the navigation bar and the four cards over it (yes).

| Stratum (share) | Crops in it | Looked at | Yes | No | Unclear | Yes share (95% Wilson) |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| 1 (top 15, a random draw among the ties) | 57 | 15 | 1 | 12 | 2 | 0.07 (0.01–0.30) |
| 0.05 to under 0.25 (seeded draw) | 45 | 10 | 8 | 2 | 0 | 0.80 (0.49–0.94) |
| 0.25 to under 1 | 27 | 0 | | | | not looked at |
| above 0, under 0.05 | 32 | 0 | | | | not looked at |
| 0 | 542 | 0 | | | | not looked at |

- **The yes crops** show what the Hcor crop shows: a caption box over a news photo (`correio24horas`), a headline card and a tag over a photo (`museu-lingua`), a category name and price over a product photo (`hering`), a tag and a cart button over two product photos (`cobasi-cachorro`), a slide's caption and carousel dots (`puc-rio-vestibular`), a tooltip and a caption box over a chart (`propublica-org-article`), the site's navigation bar over the top of a picture (`food-ratings`), and part of a phone number over a gradient image (`clevelandclinic`).
- **The share-1 crops are mostly not painted over.** Of the 57, 30 have as main candidate an empty link (no name, no text) whose box covers the image: a card's link stretched over it, transparent (`metropoles-com` 20, `lakeland` 8). 15 have a larger picture whose box contains the image: an icon or a logo that sits on a banner or a hero, which is under it. 5 are icons that sit inside a search or text field's box. The 12 "no" crops looked at show the picture alone.
- **The two unclear ones**: Hcor's "Coleta Domiciliar" icon, whose crop shows the card's label text and not the house icon (the box seems to have moved before the crop, rather than text being drawn over the icon); and an almost blank ad icon on `poder360-com-br` whose faint text may be its own.
- **Document order did not settle paint order either way.** Of the 9 yes, 2 were flagged only by content before the image (`food-ratings`' navigation, `clevelandclinic`'s phone number); of the 14 no, 13 had a share of at least 0.05 from content after the image: the stretched links, a banner or hero picture that comes after the header in the markup and is under it, paragraphs, a cookie banner, a carousel slide.

Read together, the geometric flag of section 3 over-counts at the top and is mostly right in the band from 0.05 to 0.25; the two draws speak for their own stratum only, and the 27 crops from 0.25 to under 1 were not looked at, so these notes give no single estimate of how many crops really have content over them.

## 5. The flagged crops and the dev 1.1.1 findings

The dev rows of each study's `data/findings.json` with criterion 1.1.1, joined by slug and `ref`; Claude final labels as counted, with no claim about cause. 109 of the 130 dev 1.1.1 findings of the four studies are on a crop counted here (one finding per crop).

| Crops | Crops with a dev 1.1.1 finding | True positive | False positive | Uncertain |
| --- | ---: | ---: | ---: | ---: |
| All 703 | 109 | 40 | 52 | 17 |
| Share above 0 (161) | 25 | 10 | 12 | 3 |
| **Flagged, at least 0.05 (129)** | **22** | **7** | **12** | **3** |
| At least 0.25 (84) | 11 | 3 | 5 | 3 |
| At least 0.5 (68) | 10 | 3 | 4 | 3 |
| Painted over by eye (9) | 3 | 1 | 2 | 0 |

The Hcor banner's finding is one of the flagged false positives. The 22 flagged findings are listed in `flaggedWithFinding` in the JSON.

## 6. Limits, and the method's weak points met

- **Geometry only.** The snapshot holds boxes, not paint order, z-index, transparency or `pointer-events`. Section 4 shows what that costs: transparent stretched links and pictures under icons count as cover; a navigation drawn over a picture from earlier in the markup counts as "before".
- **Fixed and sticky layers are mostly not recorded.** The collector writes `native.position` only on the children of a box it records for reading order (`boxFacts` in `src/surfaces/in-page.ts`), and never `sticky`. So the fixed-layer rule reaches only some of the layers the capture hides: `ikea-com-tables-chairs`' cookie banner, which the capture hid, was counted over a photo (by eye: no).
- **Bounds recorded at collection, crops taken moments later, after a scroll.** `prepareImageInPage` scrolls each image into view inside every scrolling box, so a carousel slide is cropped where it shows, not where its box was recorded. 64 crops have a recorded box that runs past the 1280-pixel viewport (carousel slides, side-scrolling lists); 49 of them have a share of 0. Hcor's seven slides after the first are among them: two of them were looked at outside the 25, and both show the navigation and the four cards over the slide, with a share of 0. So the count also misses some crops. In passing, outside this count: the crop of Hcor's slide whose alternative is "Votação Reclame aqui 2026" shows the "Estudo SIX" banner, another slide.
- **Containers' own backgrounds are not candidates.** Only nodes with text, a name or a visible role count, so Hcor's white navigation bar and the cards' blue boxes count only through their items: the share of 0.22 is less than what the crop shows.
- **Boxes that hold the image without painting over it**: paragraphs whose box the picture sits in (`patient-article`, where paragraphs cover 7 of the 8 flagged crops; the one looked at shows the picture alone), and a carousel slide whose recorded box overlaps a crest (`puc-rio-vestibular`).
- **Dev pages only** (48 pages, 703 crops), unevenly spread over pages; one person's look at 25 crops (and the Hcor banner), no second look.
- **Nothing here measures an effect on precision.** Section 5 is a join, as counted.

## 7. Two options, and what each would cost

Neither is chosen here.

**Record the covered share on the node.** In `prepareImageInPage`, after the scroll and with the layers already hidden, hit-test a grid of points inside the image's box (`elementsFromPoint`) and record the share of points where something other than the image, its ancestors and its descendants is above it.
- Cost: one more in-page pass per image (a few dozen hit tests); an optional field on `native`; fixtures and tests for a caption over a banner, a stretched empty link and a sticky header; both `rampa check` and `collectPage` get it, since they share `prepareImageInPage`.
- It reads paint order and the moment of the crop, which this note cannot. It still counts a transparent element that takes pointer events (a stretched empty link is the top hit) and misses one with `pointer-events: none`.
- The crop is unchanged, so judgments and caches stay as they are. The number has no effect until something reads it (the prompt, the review package, the Lab), which is a separate change. Recordings made before it lack it.

**Capture the image with overlapping content hidden.** Before the screenshot, set `visibility: hidden` on what paints over the box (found by hit testing, or by the boxes) and restore it after, as `prepareImageInPage` already does for stacked pictures.
- Cost: the crop changes for every image with something over it. The model would see the picture alone rather than as people see it on the page, which the capture module now promises. Judgment caches keyed on the crop would miss for those images, so a rerun asks the model again, and those crops are no longer comparable with the recordings of rounds 1 to 5.
- Risks: hiding something that is part of what the picture means (a banner whose words are HTML laid over it, which an alternative may name). The same hit-testing limits apply.
- It needs tests in both paths and a rerun of the 1.1.1 ACT cases to show that no ACT outcome moves.

## Data and reproduction

- `python -I study/notes-crop-overlay/overlay.py` (standard library and Pillow) reads the recordings at `C:/Users/guilh/dev/rampa-study-recordings` (`fresh-2026-10-11`, `round-3-2026-10-23`, `round-4-2026-10-24`, `round-5`; read only). It rewrites `data/overlay.json` byte for byte apart from the by-eye fields (`paintedOver`, `eyeNote`), which it keeps, and it writes the 25 calibration PNG files and the Hcor one to `.rampa/crop-overlay/`.
- `data/overlay.json` holds the 48 pages, each with its split (all `dev`) and the SHA-256 of its snapshot. It also holds every crop with its shares, candidates and the two left-out counts, the tables, the calibration and the join.

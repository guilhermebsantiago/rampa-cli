# Carousel crops that show another slide: a dev-only count (2026-11-09)

The crop-overlay count found, in passing, that on round 3's dev page `hcor-com-br` the crop of the slide whose alternative is "Votação Reclame aqui 2026" shows the "Estudo SIX" banner, a different slide. A 1.1.1 claim that an alternative "describes something the image does not show" is judged on the crop, so a crop of another slide can make a finding false while the model is right about what it saw. These notes measure how often the crop of an image in a carousel shows another slide's picture on the recorded dev pages, and ask whether a change to the capture is warranted. It is a measurement and a note: nothing under `src/` changed.

**What each number is.** Every number here is **counted** and **in-sample (dev)**: the 12 dev pages of each of the four real-page studies (48 pages), chosen by each study's `data/pages.json` before any snapshot was opened. No snapshot, report or finding of a test page was opened, in any study. The labels in section 7 are the studies' Claude final labels (an auditor and a skeptic), a pre-annotation and not ground truth. Nothing here measures an effect on precision.

## 1. What the capture does with a carousel (from the code)

- **Into view.** `captureImageNodes` (`src/surfaces/image-capture.ts`, called by `captureImages` in `src/surfaces/web.ts`) prepares each image with `prepareImageInPage`, then takes a Playwright element screenshot in a separate call (`animations: 'disabled'`, CSS scale). `prepareImageInPage` notes the scroll position of every ancestor box whose content overflows, `overflow: hidden` included, and calls `scrollIntoView({ block: 'center', inline: 'center' })`. Carousel libraries put the track in a box that hides what overflows and move the track with a CSS transform; for `scrollIntoView` that box is a scrolling box, so the slide is brought into view by scrolling it, with the library's transform left as it is. The positions are put back after each capture (`restoreImageInPage`).
- **Left of the track.** A box cannot be scrolled to a negative offset, so a slide placed left of the first one (a loop's leading clones) stays where it is and is skipped as `outside-page`.
- **Settling.** It waits up to ten frames for the box to stay put, scrolling it into view again each time it moved, and it finishes the finite animations on the image's ancestor chain before the capture.
- **Stacked pictures.** Other pictures count as stacked only when their box overlaps the image's by an intersection over union of 0.8 or more at that moment; they are hidden for the capture, and after all captures two stacked images whose captures are byte-identical though their sources differ are both skipped as `stacked` (`src/snapshot/image-skips.ts`). A fade stack is covered. The slides of a track sit side by side and never overlap, so they are never stacked with each other and the identical-capture check never compares them.
- **What runs in between.** Between the preparation and the screenshot, and between the box the screenshot reads and its pixels, the page's own scripts keep running: nothing in the capture path stops a timer, such as a carousel's autoplay.
- **What the snapshot keeps.** The recorded `bounds` are from collection, before any of this. Where the box was when the crop was taken is not recorded. A page captures at most 25 images (`IMAGE_LIMIT`); the rest are skipped as `limit`.

## 2. What was counted, and how

[`study/notes-carousel-crops/carousel.py`](../../study/notes-carousel-crops/carousel.py) reads each dev page's snapshot from the study recordings, reusing the loading code of [`study/notes-crop-overlay/overlay.py`](../../study/notes-crop-overlay/overlay.py) by import, and writes [`data/carousel.json`](../../study/notes-carousel-crops/data/carousel.json). The thresholds are the ones fixed in the brief; none was tuned.

1. **Slide groups.** Image nodes are role `img` or tag `img` with a recorded box (1,822 on the 48 pages). A group is three or more of them under one common ancestor at most 6 levels above each, with the same width and height within 2 px and the same `y` within 2 px, and whose `x` are either all equal within 2 px (stacked) or all more than 2 px apart (a track). For every node, the image nodes at most 6 levels below it are clustered by size and `y`; a cluster of three or more that is stacked or a track is a candidate, and candidates are taken largest first, a candidate that shares a member with a group already taken being left out (2 left out). Clusters whose `x` are neither are left out as mixed (3, all on `ikea-com-tables-chairs`).
2. **Same picture under different sources.** Every pair of members of a group that both have a crop and whose `src` file names differ: each crop composited on white, turned grey and resized to 32 × 32 (Pillow, box filter), and the mean absolute difference per pixel on a 0 to 255 scale; a pair under **8** is "the same picture". An image proxy that names the picture in a `url` parameter (`/_next/image?url=…` on `cobasi-cachorro` and `hering`) is named by that address's file, since every such `src` otherwise ends in `image`. As a check, the pairs with the same file name were measured too, and whether a pair's PNG bytes are identical is recorded.
3. **Members outside the viewport.** A member whose recorded box lies wholly outside `0 ≤ x < 1280` (every page was recorded 1,280 px wide) and that has a crop: its crop was taken after a movement.
4. **By eye.** Every group's crops are written to `.rampa/carousel-crops/<slug>/<group>/` (git-ignored), named by position in document order, with `members.txt` giving each member's alternative, `src` file name, box and skip reason. There are 298 crops, so the groups that hold a crop were shuffled with `random.Random(20261109)` and taken until 60 crops were reached (11 groups, 62 crops), and Hcor's other three groups were added (14 crops): the **sample**, 76 crops. As a **supplement**, reported apart, the 20 crops of members outside the viewport in groups the sample did not take were looked at too, so all 46 of step 3's crops were seen. Each crop was opened and marked `own slide`, `another slide`, `two slides`, `page content over it` or `unclear`, judged from its alternative, its file name and the other members' crops, with a line on what it shows (`shows` and `eyeNote` on each member in the JSON). `page content over it` means the member's own picture with a page element drawn over part of it (a navigation bar, cards, a carousel's arrows, a tag, a caption).
5. **Join.** The dev rows of each study's `data/findings.json` with criterion 1.1.1, the same slug and `ref`.

## 3. The slide groups

Counted, in-sample (dev):

| Study | Pages with a group | Groups | Tracks | Stacked | Members | With a crop | Skipped | Groups with a member outside the viewport |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Fresh study (2026-10-11) | 10 | 45 | 45 | 0 | 340 | 85 | 255 | 10 |
| Round 3 (2026-10-23) | 11 | 56 | 56 | 0 | 367 | 106 | 261 | 17 |
| Round 4 (2026-10-24) | 5 | 27 | 27 | 0 | 142 | 43 | 99 | 2 |
| Round 5 (2026-10-28) | 6 | 26 | 22 | 4 | 185 | 64 | 121 | 4 |
| **All four** | **32** | **154** | **150** | **4** | **1,034** | **298** | **736** | **33** |

- **Sizes.** 55 groups of 3, 40 of 4, 17 of 5, 8 each of 6, 7 and 8, and 18 of 10 or more (the largest 45, Pinacoteca's collection grid). 68 groups hold at least one crop.
- **Why members have no crop.** `limit` 596, not attempted because the node is `broken` 43 or `hidden` 43, `outside-page` 21, `not-shown` 13, `not-loaded` 10, `capture-failed` 9, `clipped` 1. No member was skipped as `stacked`. The per-page limit of 25 images leaves most slides further down a page without a crop.
- **Most groups are not carousels.** The definition also catches rows of equal cards and lists of icons: product category tiles, footer social icons, avatar rows. 33 groups have a member recorded outside the viewport, which a row of cards does not; those are the carousels proper. The 4 stacked groups are on one page (`santacasasp`) and hold only hidden members, never captured.

## 4. The same picture under different sources

**The measure, checked first.** Two crops known to differ, chosen as the hard case, Hcor's "Alerta de Golpe" and "Estudo SIX" banners, which share the navigation bar and the four cards drawn over both: **21.64**. Two crops known to be the same picture, a Travessa banner and its loop clone (same file): **0.00**. Over the 18 pairs with the same file name, 17 are under 8 (10 of them byte-identical); the one above, at 42.67, is Hcor's "Votação Reclame aqui 2026" slide against its own loop clone: the measure flags the wrong crop from the other side too.

Pairs of crops under different file names, counted, in-sample (dev):

| Study | Pairs compared | Under 8 | Crops in such a pair | Groups |
| --- | ---: | ---: | ---: | ---: |
| Fresh study | 204 | 0 | 0 | 0 |
| Round 3 | 246 | 3 | 5 | 2 |
| Round 4 | 54 | 0 | 0 | 0 |
| Round 5 | 125 | 0 | 0 | 0 |
| **All four** | **629** | **3** | **5** | **2** |

45 pairs were not compared: 18 with the same file name, 27 where a member has no `src` (seven inline `svg` icons on `gov-scot`, four `span` icons with role `img` on `tate-contact`). The three pairs under 8:

- Hcor's banner track, member 5 ("Votação Reclame aqui 2026") with member 6 ("Estudo SIX") and member 11 (its clone): **0.00, byte-identical**. Member 5's crop shows another slide.
- Metrópoles' columnist row, "Blog do Noblat" and "Ricardo Noblat": 0.32. One avatar served as a `.webp` and as a `.png`: both crops show their own picture.

So by the measure, **1 of the 298 crops in groups** shows another member's picture. The measure has a thin margin above the threshold: the closest pair over it, at 8.17, is two different Pedigree pouches with the same tag and cart button over them, and the next, at 9.88, two packs of one dog-food brand (by their file names). It also cannot see a crop of a slide that was itself never captured.

## 5. Members outside the viewport

Counted, in-sample (dev): 399 group members have a recorded box wholly outside the viewport; **46 have a crop**, on 7 pages (fresh study 20, round 3 25, round 4 0, round 5 1). The other 353 have none: `limit` 288, `broken` 36, `outside-page` 9, `not-loaded` 8, `capture-failed` 7, `hidden` 5. All 46 were looked at (26 in the sample, 20 in the supplement): **45 show their own picture** (28 alone, 17 with page content over them) and **1 shows another slide**, Hcor's.

## 6. By eye

Crops by what they show, counted, in-sample (dev):

| Shows | Drawn (62) | Hcor's groups added (14) | Sample (76) | Supplement (20) | All looked at (96) |
| --- | ---: | ---: | ---: | ---: | ---: |
| own slide | 54 | 3 | 57 | 17 | 74 |
| another slide | 0 | 1 | 1 | 0 | 1 |
| two slides | 0 | 0 | 0 | 0 | 0 |
| page content over it | 8 | 9 | 17 | 3 | 20 |
| unclear | 0 | 1 | 1 | 0 | 1 |

Crops that show another slide or two slides, with a 95% Wilson interval: sample 1 of 76 (0.01, 0.00–0.07); seeded draw alone 0 of 62 (0.00, 0.00–0.06); outside the viewport 1 of 46 (0.02, 0.00–0.11); inside the viewport 0 of 50 (0.00, 0.00–0.07); all looked at 1 of 96 (0.01, 0.00–0.06).

- **Hcor's slide "Votação Reclame aqui 2026" is recorded as another slide**: its crop is the "Estudo SIX" banner, the next slide. The script stops if it is not.
- **Page content over the picture**: Hcor's navigation bar and four quick-access cards over all eight banner crops (seven counted here, the eighth being the wrong slide), Travessa's two carousel arrows over 8 of its 10 banners, an "Oncologia" tag over two Hcor cards, and the slide's caption with a sign-language widget's button over three Unicamp slides. That is the crop-overlay note's subject; nothing in it is another slide.
- **The unclear crop** is Hcor's "Coleta Domiciliar" icon, which shows the card's own label rather than the house icon, as if the box had moved before the crop; it shows no other member's picture. The crop-overlay note marked it unclear too.
- **How "own" was judged**: by the alternative or the file name where they say what the picture is (artworks, book covers, products, banners); for portraits and icons by the fact that no other member shows the same picture, and for icons by the link they sit in (Facebook, X and so on). Members that share a file show the same picture, as expected.

## 7. The join with the dev 1.1.1 findings

**The one crop that shows another slide carries no dev 1.1.1 finding** (0 findings, so no label to count). Of the 96 crops looked at, 5 carry one, counted, in-sample (dev), with no claim about cause:

| Crop | Shows | Claim | Claude final label |
| --- | --- | --- | --- |
| Metrópoles, "Blog do Noblat" avatar | own slide | describes something the image does not show | false positive |
| Hcor banner, "Alerta de Golpe" | page content over it | describes something the image does not show | false positive |
| Hcor banner, "Alerta de Golpe" (loop clone) | page content over it | describes something the image does not show | false positive |
| Hcor banner, "Banner FAQ - Portal do Paciente" | page content over it | is all its link holds | false positive |
| PUCRS, "thumb-carrossel-imagens-graduacoes-combinadas" | own slide | a file name or a placeholder | true positive |

Over all 298 crops in groups, 40 carry a dev 1.1.1 finding (14 true positive, 19 false positive, 7 uncertain); over the 46 crops outside the viewport, 3 (1, 2, 0).

## 8. The mechanism, as far as the recordings show it

- **The carousels.** Among the 11 groups with a cropped member outside the viewport, 10 are tracks in a box that hides what overflows: Owl Carousel (Hcor's banner, PUCRS), Slick (two Travessa carousels), Splide (two Pinacoteca carousels) and Swiper (Unicamp's banner), libraries that move the track with a CSS transform, and a flex row in an `overflow-hidden` box whose script the snapshot does not show (three Metrópoles rows). The 11th is a scroll-snap box (IKEA's category bar, class `…--snap-slide`). No fade stack had a crop.
- **A transform track by itself does not give a wrong crop here.** 45 of the 46 crops taken after a scroll show their own picture, across the five kinds of track and the snap box, loop clones included: scrolling the hiding box brings the slide into view. The leading clones left of a track are skipped as `outside-page` (9 of the 21 such skips in groups), as the code intends.
- **The one wrong crop.** Hcor's banner is an Owl Carousel track with five slides and three loop clones (`owl-item cloned`) on each side; the track is recorded translated by 3,825 px, three slides. Of its eight crops, seven show their own banner, including the clone of the "Votação Reclame aqui 2026" slide. That slide's own crop is byte for byte the crop of the next slide and of that slide's clone: a whole slide, settled, exactly one step ahead. That fits a track that moved one step on its own between the reading of the box and the pixels, which is what an autoplay timer does, and nothing in the capture path stops one. The screenshot is taken with `animations: 'disabled'`, which Playwright documents as fast-forwarding finite animations and transitions to their end, so a slide change caught by it would give a whole slide rather than two halves. The recordings cannot confirm it: the carousel's options are not in the snapshot, and the box at the moment of the crop is not recorded. Of the brief's four candidates, then: autoplay between the box reading and the crop fits the one case seen; a transform track and a scroll-snap box gave no wrong crop on their own (45 crops); a fade stack gave no crop to judge.
- **Why no guard caught it.** The identical-capture check compares only stacked images, and a track's slides are never stacked, so three byte-identical crops under two sources on one track passed unseen.

## 9. Limits

- **Dev pages only**, 48 pages, and the groups are uneven over them: 7 pages hold every crop taken outside the viewport.
- **Crops recorded once.** A timer-driven failure depends on timing; nothing here shows what another run of the same page would capture, and the box at the moment of each crop is not in the snapshot.
- **Groups from boxes.** The definition finds rows of cards and icon lists as well as carousels, and misses a carousel whose slides differ in size or that has fewer than three image nodes; slides whose picture is a CSS background are not image nodes.
- **Most slides have no crop**: 596 of the 1,034 members were over the per-page limit, so the carousels further down a page were not tested at all.
- **Similarity on small grey images**: one threshold, fixed, with a thin margin above it (8.17 for two different pouches), and it needs both crops to exist.
- **One person's look**, at 96 crops, with no second look; "own" for portraits rests on no other member showing the same face, not on knowing the person.
- **Nothing here measures an effect on precision.** Section 7 is a join, as counted.

## 10. Is a capture change warranted?

**The number it rests on: 1 of the 298 crops in slide groups shows another slide's picture (counted, in-sample, dev), found both by the pixel measure and by eye; it is 1 of the 46 crops of members outside the viewport (all looked at) and 0 of the 62 crops of the seeded draw, and it carries no dev 1.1.1 finding.**

The options, none implemented:

- **Skip a slide that is not the one shown** (a new skip reason, so 1.1.1 never judges it). Two ways to find it:
  - *Identical captures beyond stacked boxes.* Widen the existing check to any two crops on a page whose bytes are identical though their sources differ. On these recordings it would skip 11 crops on 2 pages: Hcor's wrong crop, the two correct "Estudo SIX" crops it equals (the check cannot tell which side is right, so it drops both), and 8 service icons on `ce-gov-br` that are the same icon under different file names. Kept to the members of one track, it would skip 3 crops, 1 of them wrong. It changes no crop, only removes some, and it finds a wrong crop only when the slide it shows was captured too.
  - *Movement.* Read the box again right after the screenshot and skip the image when the box moved. It finds the case seen whatever the crop shows, at the cost of one more in-page call per image; a window between that reading and the pixels remains, smaller. The recordings cannot say how many crops it would skip, since they do not record the box at the crop.
  - Either way: a new value in `IMAGE_SKIPS` with its message in both locales, tests in both capture paths (`rampa check` and `collectPage`), and a skipped image loses its 1.1.1 and 1.4.5 judgments. Other crops do not change, so their judgment caches still hit.
- **Bring each slide into view before its crop.** The code does this already, by scrolling every box, and it worked for 45 of the 46 crops recorded outside the viewport. What is left is a track that moves itself; stopping it means stopping the page's timers during the capture or driving each carousel library to the slide. Cost: either changes what the page does while every image is captured, not only carousels, so crops can change on any page, judgment caches miss for every changed crop, and the recordings of rounds 1 to 5 are no longer comparable crop for crop; driving libraries is code per library, with fixtures for each.
- **Leave it as is.** Cost: about 1 crop in 300 in slide groups may be another slide's picture, and a 1.1.1 claim judged on it can be false for a reason a reviewer sees only by opening the crop (the review package shows it).

**What the counts support: leaving the capture as is for round 6, with moderate strength.** One occurrence in 298 crops, on one page, touching no finding, does not pay for a change that alters crops, caches and comparability; the support is only moderate because the interval for crops taken after a scroll reaches 0.11, the event is timing-dependent and was seen once, and only dev pages were counted. If a guard is wanted later, the movement check is the one that keeps every correct crop on these recordings; widening the identical-capture check page-wide would here drop 10 correct crops to remove 1 wrong one.

**What would have to be measured after a change.** Record the dev pages again with the change, count the new skip reason per page and look at every skipped crop (was it another slide?), and look again at the crops of members outside the viewport. Crops that change make the judgment caches miss for those images, so the rerun asks the model again for them, and the new recordings are no longer comparable crop for crop with rounds 1 to 5: compare at the level of findings on the same dev pages, before and after, and check that the 1.1.1 ACT cases keep their outcomes.

## Data and reproduction

- `python -I study/notes-carousel-crops/carousel.py` (standard library and Pillow) reads the recordings at `C:/Users/guilh/dev/rampa-study-recordings` (`fresh-2026-10-11`, `round-3-2026-10-23`, `round-4-2026-10-24`, `round-5`; read only). It rewrites `data/carousel.json` byte for byte apart from the by-eye fields (`shows`, `eyeNote`), which it keeps, and it writes every group's crops and `members.txt` to `.rampa/carousel-crops/`.
- `data/carousel.json` holds the 48 pages, each with its split (all `dev`) and the SHA-256 of its snapshot; the groups with every member (box, file name, crop or skip reason, the look and the join); the measure check, the pairs under 8 and the same-file check; the members outside the viewport; the by-eye tallies with their intervals; and the join.

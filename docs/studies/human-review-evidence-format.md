# Review evidence in a package: format version 1, and the 5-item pilot (2026-11-09)

In the blind human review of rounds 3 to 5 ([human-review-plan.md](human-review-plan.md)), reviewers saw less of each page than the Claude judges had: for links, the other links with the same text, the heading before and the list items around; for images, the image's file; for every item, the page's capture and its declared language. A v2 package carries that evidence inside each snapshot file, as a top-level object `reviewEvidence`. Rampa Lab's review mode shows it when it is there (rampa-lab branch `feat/review-evidence`, not merged or deployed); the deployed Lab ignores the key.

Every value in the block is a fact of the page as it was captured: its structure, its text, its declared languages, its screenshot, the addresses of its links and images, and what Rampa read at those addresses. Rampa's own readings (its verdict, confidence, suggested text, whether it held a claim back) are left out: they would tell a reviewer what Rampa concluded.

Code: [`scripts/evidence.py`](../../study/human-review-2026-10/scripts/evidence.py) (pure functions from a full snapshot and a list of refs to the block, importable by later rounds' scripts) and [`scripts/evidence_package.py`](../../study/human-review-2026-10/scripts/evidence_package.py) (builds a package). The sent packages (`pacote-100`, `pacote-30`) and `sample.py` are not changed.

## 1. The format (version 1)

```json
"reviewEvidence": {
  "version": 1,
  "rubric": "three-answers-1",
  "page": {
    "lang": "pt-BR",
    "capture": "data:image/jpeg;base64,…",
    "captureSize": { "width": 640, "height": 3120, "pageWidth": 1280, "pageHeight": 6240, "cut": false },
    "captureAligned": true
  },
  "items": {
    "<ref>": {
      "lang": "en",
      "context": "data:image/jpeg;base64,…",
      "enclosing": { "role": "listitem", "tag": "li", "text": "…" },
      "headingBefore": { "rank": 2, "text": "…", "up": 3 },
      "listItems": [ { "text": "…" } ],
      "before": [ { "up": 1, "role": "paragraph", "tag": "p", "text": "…", "holdsHeading": false, "holdsLink": true } ],
      "sameText": { "total": 7, "links": [ { "href": "https://…", "title": "…", "heading": "…", "finalUrl": "https://…" } ] },
      "imageFile": "https://…/banner.png"
    }
  }
}
```

It sits in each `snapshots/<slug>.snapshot.json`, beside `root` and `destinations`. `items` is keyed by the element's ref, as in the finding. Every field is optional except `version`; a field is left out when the page gives nothing for it. The field names avoid every name in `sample.FORBIDDEN_KEYS` (no `kind`, `level`, `label`, `group`, `key`), and must keep doing so. The evidence is carried inside the snapshot file rather than in a file of its own so that the deployed Lab loads a v2 package without a "skipped file" message.

## 2. How each field is computed

From the page's full recorded snapshot (the recordings backup, before `sample.prune` cuts it down). A node has `ref`, `role`, `name`, `text`, `lang`, `states`, `bounds`, `native.tag`, `native.attributes` and `children`.

**Text.** Wherever a field quotes text, it is what a person reads in that subtree, in document order: the block's reading text when the collector recorded one (`native.readingText`, which keeps inline text in order and reads an image by its accessible name), else each node's own `text` and the names of images; hidden nodes (state `hidden` or `aria-hidden`) are left out. Spaces are collapsed and a text over its bound is cut, ending in "…".

**Page.**
- `lang`: the root node's `lang`, trimmed; an empty string when the page declares none. The collector sets a node's `lang` from `getAttribute('lang')` on the element itself (`src/surfaces/in-page.ts`), so for the root it is what `<html lang>` declares. `native.attributes.lang` holds the same attribute: on the 17 dev pages of the 100's draw the two agree on every page (counted).
- `capture`: the page's `main-screenshot.png`, scaled to 640 px wide (never enlarged) with Lanczos, cut at 6,000 px of scaled height (then `cut: true`), JPEG quality 60. `captureSize` gives the capture's `width` and `height` and the screenshot's own `pageWidth` and `pageHeight`. A page with no screenshot has no `capture`.
  - **A choice the brief left open:** a screenshot wider than the snapshot's viewport (1,280 px on every study page) keeps only the viewport's width from its left edge before scaling, what the page shows unscrolled. Content that overflows to the right, such as a carousel's track, makes a full-page screenshot that wide; scaled whole, `pucrs-graduacao`'s 30,749 × 7,269 px screenshot gave a capture 151 px high (counted). `pageWidth` stays the screenshot's width, so `pageWidth` larger than the capture's width times `pageHeight / height` tells that the right side was left out. `cut` keeps its one meaning, cut at the bottom.
- `captureAligned`: `sample.alignment(screenshot, nodes)["aligned"]` over every element crop of the full snapshot, the rule `sample.py` applies (median difference at most 20, at least 60% of crops under 20). `false` says the layout moved between the snapshot and the screenshot, so a position in the capture can point at something else.

**Item.**
- `lang`: the nearest non-empty `lang` on the element or an ancestor (the root included). An empty `lang` declares nothing, as the collector and ACT read it, so the walk goes past it. Left out when none is found.
- `context`: what `sample.context_image` draws (the element outlined in the screenshot, with a margin), under the rule `sample.main` applies: the page aligned, and the element's own crop within `ALIGN_ITEM` (25) of the screenshot at its bounds. It is drawn by `sample.context_image` itself, so it is byte for byte the image the sent packages' `contexto/` holds for the same item (checked on the pilot's one). JPEG quality 82, as there.
- `enclosing`: the nearest of the element itself and its ancestors that is a paragraph, a list item or a table cell, by role (`paragraph`, `listitem`, `cell`, `gridcell`, `columnheader`, `rowheader`) or by tag (`p`, `li`, `td`, `th`): its role, tag and text, at most 300 characters. Left out when that node has no text.
- `headingBefore`: the nearest node with role `heading` before the element in document order (a heading the element sits in counts), not hidden, with text (its name, else its text; at most 300 characters). `rank` is `aria-level` when that is a positive whole number (it overrides the tag, as in ARIA and in Rampa's `headingLevel`), else the digit of an `h1`–`h6` tag; left out when there is neither (ARIA's default of 2 is not written in, since the page does not state it). `up` is the number of levels from the element to the closest ancestor it shares with the heading (0 when the element is inside the heading).
- `listItems`: the list-item ancestors (role `listitem` or tag `li`), nearest first, at most 6; each one's own text without the lists nested in it (role `list` or tag `ul`, `ol`, `menu`), at most 160 characters. A list item with no text of its own is skipped.
- `before`: for each of the 4 nearest ancestors (`up` 1 is the parent), the closest earlier sibling of the branch that holds the element, among siblings that are not hidden and have text: its role, tag, text (160), whether its subtree holds a heading and whether it holds a link (not hidden). An ancestor with no such sibling gives no entry.
- `sameText`: for a link, or an element inside one (the nearest ancestor with role `link` is used): the other nodes with role `link`, not hidden, whose accessible name (the name, else the own text; NFKC, lower case, spaces collapsed) equals this one's. `total` counts this link too. `links` holds at most 12 of the others, in document order, each with `href` resolved against the snapshot's `target` (leading and trailing control characters and spaces stripped and tabs and newlines removed first, as a browser does; on the Lakeland page all 26 "View More" links' `href` start with a newline, counted) and, from the snapshot's `destinations` entry for that `href` when there is one, `title`, `heading` (300 characters each) and `finalUrl`. Left out when no other link shares the text.
- `imageFile`: for an element with role `img` or tag `img`, its `src` resolved against `target`, when that is an `http` or `https` address; never a `data:` address. The file is the image alone, as it is served now: it may have changed since the capture, and it does not show page content painted over the image, which the crop does.

**`rubric`** is written only when the package is built with `--rubric three-answers-1` (the rubric's text is a later task's).

## 3. Blindness

A v2 package keeps the sent packages' rules ([human-review-plan.md, section 3](human-review-plan.md#3-blindness)): `data/findings.json` holds `sample.blind_row` rows (the nine keys `slug`, `fingerprint`, `criterion`, `source`, `ruleId`, `message`, `evidence`, `ref`, `html`), snapshots are cut with `sample.prune`, and no Claude label or stratum is in the package or its manifest. `evidence_package.py` stops on any of:

- a problem `sample.check_blind` finds in the written package (a left-out key in `data/`, a label value anywhere, the opening of any judge's rationale anywhere); the written files are then removed;
- before anything is written, a key inside a block that is in `sample.FORBIDDEN_KEYS`;
- before anything is written, a text in a block equal (NFKC, case and spaces folded) to Rampa's suggested text (`patch.to`, 12 characters or more) for any finding on that page.

What it does not cover:

- **Labels already in the browser.** The fingerprint is `common.package_fingerprint`, as `sample.blind_row` gives it, so the pilot's 5 items carry the fingerprints they have in `pacote-100` (all 5) and `pacote-30` (3 of them) (counted). The Lab stores labels in the browser by page address and fingerprint, so in a browser where those packages were labelled the pilot opens with the earlier labels on it. A pilot reviewer who labelled a sent package should use a browser profile that has not; a later package that must stay apart can salt its fingerprints differently.
- **What the evidence shows is not checked for meaning.** Text near an element can name what Rampa's suggested text names (a heading before a "Read more" link usually does): only an exact copy is stopped. That is the evidence a reviewer needs, and it is on the live page too.
- The order and the claim, as in the sent packages.

## 4. The pilot

**Rule, fixed in `evidence_package.py` before the package was built.** From the 100 of `common.draw` (the draw behind `data/sample.json`), the items whose `split` is `dev`. First `r3/hcor-com-br/38c348a1cde8`, the dev item behind the image-file evidence. Then, walking the dev items in the order of `common.digest("pilot", study, slug, key)`, the first item of each claim kind (`common.claim_kind`): `2.4.4 shared_text`, `2.4.4 generic`, `3.1.2 passage_language`, `1.1.1 functional`. The script stops if a kind has none. Package order: `common.package_order`. Only dev pages' snapshots and screenshots are opened; round 5's test half is not read.

Written: `study/human-review-2026-10/pacote-v2-piloto/` (`data/findings.json`, `data/pages.json`, 4 snapshot files) and its manifest `study/human-review-2026-10/data/pilot-v2.json` (seed, rule, and per item the id, fingerprint, page, criterion, claim kind and the evidence fields it got). No `contexto/` folder: the context images are in the block. No `LEIA-ME.md` yet.

What it gave (counted):

| Order | Item | Claim kind | Item fields |
| ---: | --- | --- | --- |
| 1 | `r5/pucrs-graduacao/7be16bce4718` | 2.4.4 generic | lang, headingBefore, before, sameText (41 links share the text) |
| 2 | `r3/hcor-com-br/38c348a1cde8` | 1.1.1 wrong_content | lang, before, imageFile |
| 3 | `r5/pucrs-graduacao/77882242c6fa` | 1.1.1 functional | lang, enclosing, headingBefore, listItems, imageFile |
| 4 | `r4/conversation/3ea3f918e78e` | 3.1.2 passage_language | lang, enclosing, headingBefore, before |
| 5 | `r5/lakeland/d7ad40b26768` | 2.4.4 shared_text | lang, context, enclosing, listItems, before, sameText (26 links share the text) |

- 5 items on 4 pages. Every page has `lang` (`pt-BR` on 3, `en` on 1), a `capture` (none cut) and `captureAligned`; 1 of the 4 lines up (`lakeland`), as in `data/sample.json`, so 1 item of 5 has a `context`.
- The package is 1,207,275 bytes on disk (about 1.2 MB), the manifest 4.4 kB. A second run writes byte-identical files.
- What a reviewer will meet on these pages: the Hcor capture does not line up (the banner carousel shows another slide, and the site's fixed warning bar and header are painted in the middle of the page); the `pucrs-graduacao` capture is the screenshot's left 1,280 px, and the page in it is shifted to the left; the Lakeland context image outlines an area where the link is not painted (it sits in a navigation submenu that is not open in the screenshot), the same image `pacote-30` already holds for that item.

Checked with the deployed Lab's own code (rampa-lab `main` at `86d1dc5`, its `readReviewFiles`, `mergeEntries`, `elementContext`, as `check-lab.mjs` does, from a scratch script outside the repository): the pilot loads with no problem message, one study source, 4 snapshots, 5 entries on the one list, each blind (no confidence, fix, maturity, judge, final label or half) and with its element found. The unchanged `check-lab.mjs` passes on `pacote-100` and `pacote-30`.

## 5. Reproduce

From the repository root:

```sh
python -I study/human-review-2026-10/scripts/evidence_package.py --self-test
python -I study/human-review-2026-10/scripts/evidence_package.py --select pilot --name pacote-v2-piloto --rubric three-answers-1 [--recordings DIR]
```

The self-test builds the block from a small snapshot written in the script (two links with the same text under a heading in a list, a hidden third one, an image, a `data:` image, a nested list, a paragraph in English) and checks each field; it needs no recordings, and checks the capture's scaling only when Pillow is there. The package needs the recordings backup (`C:/Users/guilh/dev/rampa-study-recordings`, `$RECORDINGS` or `--recordings`, read only) and Pillow. `--name` must start with `pacote-v2-`; the script writes only inside that folder and `data/<select>-v2.json`. Never run `sample.py` to rebuild anything here: its `main()` rewrites `pacote-100` and `pacote-30`.

## 6. Checks

Two scripts, run on 2026-11-09: one checks that the pilot loads in the Lab that shows the evidence, blind and with its evidence; the other checks that the sent packages load and render the same in the deployed Lab and in the branch that would replace it.

- [`scripts/check-lab-v2.mjs`](../../study/human-review-2026-10/scripts/check-lab-v2.mjs) loads a v2 package with a Lab's own `readReviewFiles`, `mergeEntries`, `elementContext` and `evidenceFor`, from the files its folder picker would hand over (as `check-lab.mjs` does). It makes every blindness check `check-lab.mjs` makes (the logic is copied), and checks the evidence: every item has an evidence entry for its ref; every image of the block is a data URL the Lab kept as it is, and no other field holds a `data:` address; a 2.4.4 item has `enclosing` or `headingBefore`; an item whose element is an image (role or tag `img`, the rule `evidence.py` applies) has `imageFile`; the block's `rubric` is read; no key of the block is in `sample.FORBIDDEN_KEYS` (copied into the script, with a comment naming the source); no text of the block equals a label value (NFKC, case, spaces, hyphens and underscores folded). It prints, per item, which fields it has, never their text.
- [`scripts/compare-lab.mjs`](../../study/human-review-2026-10/scripts/compare-lab.mjs) loads each package with each Lab's own code and requires the load outcome (problems, sources, snapshots, files skipped), the entries and `elementContext` for every entry to be deep-equal as JSON (*data level*). With both URLs it also drives each built Lab in Microsoft Edge: a fresh browser context per Lab and package, `pt/?view=review`, the package's folder picked in `#review-folder-input`, then every item in turn with the Lab's own "next" button, taking the item section's `outerHTML` (*rendered level*). Before comparing, two things are normalised on both sides alike: **empty HTML comments (`<!---->`) are removed**, the anchors Svelte leaves where a conditional block renders nothing; and Svelte's per-render id (`$props.id()`, `c` and a page-wide counter) is replaced by `uid1`, `uid2`… in order of appearance wherever it starts the value, or a token of the value, of an `id`, `for`, `name`, `headers`, `list`, `form` or ARIA id-reference attribute, or follows the `#` of an in-page `href`. Same item count and the same string for every item, or it prints the item's fingerprint and a short diff of the markup and exits 1. Otherwise it prints counts and digests only: round 5's test half is handled as opaque strings, and nothing of an item's message, evidence or HTML is printed.

**The two Labs.** Lab A is rampa-lab `main` at `86d1dc5`, what reviewers use now, in a detached worktree with `pnpm install --frozen-lockfile`. Lab B is the branch `feat/review-three-answers` at `2ac7c25`, which holds `feat/review-evidence` (`841020d`). Neither was changed. Each was built with `npx vite build` and served with `npx vite preview --strictPort`, Lab A on port 4173 and Lab B on 4174. Node 24.21.0; Svelte 5.57.2 and Vite 8.3.3 in both; playwright-core 1.64.0 from Lab B's `node_modules`; Microsoft Edge 157, headless.

**Commands**, from the repository root. `A` is `C:/Users/guilh/dev/rampa-lab-wt/main-ref`, `B` is `C:/Users/guilh/dev/rampa-lab-wt/review-three-answers`, `P15` is `C:/Users/guilh/dev/rampa-cli/study/human-review-2026-10/pacote-15`. `pacote-15` is not committed; it was read where it is, and nothing was written there.

```sh
S=study/human-review-2026-10
node $S/scripts/check-lab-v2.mjs --lab $B --package $S/pacote-v2-piloto
node $S/scripts/check-lab.mjs --lab $B
node $S/scripts/check-lab.mjs --lab $A
node $S/scripts/compare-lab.mjs --lab-a $A --lab-b $B --package $S/pacote-100 --package $S/pacote-30 --package $P15 \
  --url-a http://localhost:4173/ --url-b http://localhost:4174/
node $S/scripts/compare-lab.mjs --lab-a $A --lab-b $B --package $S/pacote-v2-piloto \
  --url-a http://localhost:4173/ --url-b http://localhost:4174/
```

### 6.1 The pilot in Lab B: passes

`check-lab-v2.mjs` exits 0. The Lab reads 5 items on 4 pages from 4 snapshots, all on the findings list, with no problem message and no warning; each item is blind (no confidence, fix, maturity, judge, final label or half) and has its element found (counted). Every block is read with rubric `three-answers-1`, for which Lab B asks the three questions, on all 4 pages. The 5 images of the blocks (4 page captures, 1 context image) are data URLs the Lab kept as they are. No key of a block is a forbidden one, no text is a label value, and no block holds evidence for a ref that is not an item (counted).

| Package order | Item (fingerprint) | Page | Criterion | Element | Item fields the Lab read |
| ---: | --- | --- | --- | --- | --- |
| 1 | `d6caa9194146` | pucrs-graduacao | 2.4.4 | link, `<a>` | lang, headingBefore, before (2), sameText (41 links share the text, 12 listed) |
| 2 | `20d0f3c98b19` | hcor-com-br | 1.1.1 | img, `<img>`, with a crop | lang, before (1), imageFile |
| 3 | `43b566914e7d` | pucrs-graduacao | 1.1.1 | img, `<img>`, with a crop | lang, enclosing, headingBefore, listItems (1), imageFile |
| 4 | `89ebe02f37c7` | conversation | 3.1.2 | paragraph, `<p>` | lang, enclosing, headingBefore, before (2) |
| 5 | `37b6b9cb397f` | lakeland | 2.4.4 | link, `<a>` | lang, context, enclosing, listItems (1), before (2), sameText (26 links share the text, 12 listed) |

Every item's page gives `lang`, `capture`, `captureSize` and `captureAligned` (aligned on `lakeland` only). These are the fields of section 4's table, which was written from the package: the Lab reads every field the blocks hold.

The script can fail: against Lab A it stops at once (Lab A has no `evidenceFor`), and on a scratch copy of the pilot with 7 planted faults (a forbidden key, a label value as a text, a `data:` address in a field the Lab does not show, a context that is not a data URL, a rubric that is not text, a 2.4.4 item with neither `enclosing` nor `headingBefore`, an image item without `imageFile`) it reported all 7 and exited 1. The copy was deleted.

### 6.2 The unchanged `check-lab.mjs` on both Labs: passes, same summary

Both runs exit 0, and their JSON summaries are byte-identical (compared). `pacote-100`: 100 items on 43 pages, 43 snapshots, all on the findings list, 31 elements with a crop, 13 text items without HTML, 17 links with a destination, 53 context images. `pacote-30`: 30 items on 20 pages, 20 snapshots, all on the findings list, 10 with a crop, 4 without HTML, 8 links with a destination, 13 context images (counted). The groups come in the same order in both.

### 6.3 The sent packages in Lab A and Lab B: the same

`compare-lab.mjs` exits 0.

| Package | Items compared | Data level | Rendered level | Empty comments removed, Lab A / Lab B |
| --- | ---: | --- | --- | ---: |
| `pacote-100` | 100 | identical | identical, 100 of 100 items | 4,087 / 4,287 |
| `pacote-30` | 30 | identical | identical, 30 of 30 items | 1,250 / 1,310 |
| `pacote-15` | 15 | identical | identical, 15 of 15 items | 618 / 648 |

All counted. At the data level every entry's element is found in its snapshot in both Labs. At the rendered level each Lab steps through as many items as its first item says it has, and the two Labs show the same items in the same order. The folder pick handed the page 99, 36 and 25 files; their `.json` files are the 45, 22 and 16 that `check-lab.mjs`'s `asPicked` gives, the ones the Lab reads (checked by the script).

**What the normalisation had to cover** (counted):

- *Empty comments.* Every item in Lab B has exactly 2 more `<!---->` than in Lab A (200 more over 100 items, 60 over 30, 30 over 15): the anchors of the two conditional blocks Lab B adds to an item, the evidence and the three questions, which render nothing for these packages. With the comments left in, all 145 items differ; with only the comments removed, all 145 are identical.
- *Per-render ids.* Each item holds one Svelte id, in 8 `id`, 4 `for`, 4 `aria-describedby` and 3 `name` attributes (the three label choices, their help texts and the note). In these runs both Labs gave the same raw ids (each run starts a fresh browser context and draws one id per item), so the id step changed nothing in the result; it stays so that the comparison does not depend on that. In the pilot, Lab B's items draw a second id, for the three questions.

### 6.4 The control: the pilot renders differently, as expected

`compare-lab.mjs` on `pacote-v2-piloto` reports 5 differences in 5 items and exits 1, the expected result: it shows the comparison can fail. The data level is identical (the evidence sits on the snapshot, not on the entry or the element's context); at the rendered level each item first differs where Lab B draws the block "Mais da página capturada" (the evidence) before the label choices, and Lab B's items also ask the three questions.

### 6.5 What these checks leave out

- Markup only: style, layout and pixels are not compared. Both builds give the item the same scoped-style class (`svelte-b8uht5`); Lab B's stylesheet adds the rules for the evidence and the questions.
- The Portuguese page only (`pt/`), at 1,280 × 900 CSS pixels, in a browser with no labels stored, and the default lists (every item of the three packages is on the findings list, counted).
- Labelling and exporting are not exercised.

# The judgments' remaining weak spots: 1.1.1 in another language, 2.4.4 on ACT 5effbb, and the link-mismatch pairs

Three weak spots were left by the [1.1.1 dev fixes](notes-111-dev-fixes.md) and the [2.4.4/2.4.6 change](notes-244-246.md): two true short Portuguese alternatives that 1.1.1 still called wrong on the fresh-page study's dev pages, the recall of 0.50 on ACT rule 5effbb (Link in context is descriptive), and the corrupted pairs whose links were pointed somewhere else (`link-mismatch`), told apart 0 times out of 10. These notes find the cause of each, change the prompt or the facts a finding rests on, and measure the change on the W3C ACT test cases, the corrupted pairs and the dev pages of the [fresh-page study](real-pages-2026-10-fresh.md).

**In short.**

- **1.1.1.** The prompt asked for the model's description of the image "in one short English sentence", while it asked for the suggested alternative in the image's language. On a Portuguese page, Rampa's word checks, which drop a "describes something the image does not show" claim when the model's own answer keeps naming the alternative's words, could only meet the suggestion, and the model's suggestions for "Capa da edição 751" and "Boletim InfoGripe" dropped some of them. The description is now asked in the alternative's language too (1.1.1 version 5), and the check reads the description and the suggestion together; a name or a number, such as "InfoGripe" or "751", reads the same in any language, so it still meets an English description. On the dev pages, the two false positives were dropped in both runs of the new prompt, by the model's own suggestion, which now keeps every word of the alternative ("Capa do Jornal da Unicamp, edição 751, …", "… dados do Boletim InfoGripe"); three runs of the old prompt reported "Capa da edição 751" every time and "Boletim InfoGripe" twice. The 7 true positives were reported in every run, and precision at the default threshold was 0.88 and 0.78 with the new prompt against 0.70, 0.70 and 0.64 with the old one; the runs vary because the model's reading of a few images does (it took a photo of Lula for one of Jair Bolsonaro in one run of each prompt). On the ACT test cases and pairs of 1.1.1 nothing changed: every set stays at precision and recall 1.00, and verification drops no claim.
- **2.4.4, ACT 5effbb.** The three failed examples missed were not a candidate or a model problem: the model failed all six, with the right problem. The fact rule turned three of them into suggestions, because "HTML", "EPUB", "Plain text", "Download" and "Workshop" are not on the generic lists. A new fact grounds two of them: a link text that names only what kind of file it gets (a format, "Download", a size) with nothing in its programmatically determined context that could say which document: no sentence or list item of its own, no heading above it, no header cell, or in a table only header cells that do not name the row's subject, which sits in a data cell beside it; and not in the site's menus, header or footer. Recall on 5effbb went from 0.50 to 0.83 with precision 1.00; "Workshop", whose description sits in another paragraph, stays a suggestion, because only the model's reading of a specific word could make it a finding, and that reading is what was wrong on real pages. Nothing else changed on the ACT sets. On the 1,367 link candidates of the dev pages, the new fact holds for none, and a judgment of the dev pages before and after the change gives the same 2 findings and 15 suggestions, item by item.
- **`link-mismatch` pairs.** The fact the brief proposed, a destination page whose title or main heading shares no meaningful word with a specific link text, is not sound: on the dev pages it holds for 5 of the 376 links whose destination was read and tells it apart, and none of the 5 is a mismatch ("Report a problem with this page" leads to "Feedback", "Right of withdrawal" to "Terms and conditions"). A title is a summary of a page. What Rampa can check soundly is a link to a part of this page: it reads that part itself, and when the page names the part (a word of its id is a word of its text, as `#hours` and "Opening hours: Monday to Friday") while the link's text and context name none of it, the text promises something else. That fact now grounds a `mismatch`. The pairs went from 0 to 9 of 10 told apart, and on the dev pages it holds for none of the 32 links to a part of the page (31 skip links and an audio player's link). Since the pairs point every link to such a part, they now measure this fact as much as the model.

**Only the allowed data was used, and the numbers are optimistic.** The fixes were chosen from the W3C ACT test cases, the corrupted pairs and the fresh-page study's dev split, and they are measured on the same data. A held-out measurement has to come from round 3 or a later round of real pages; the round-3 study under way was not read, used or waited for.

## Data and scope

- **Used:** the W3C ACT test cases (`rampa eval`, ACT `a9a1483e`) of 1.1.1 and 2.4.4, with their corrupted pairs; the fresh-page study's **dev split only**: the twelve dev pages' recordings (24 files, all matching the SHA-256 in `study/fresh-2026-10-11/data/recordings.json`) and judgment caches, copied from the study's backup, and their labels, read only from rows of `data/findings.json` whose `split` is `dev` (`study/fresh-2026-10-11/scripts/dump_fp.py dev`, and this work's `study/notes-remaining/list111.py`, which filters the same way).
- **Not used:** the fresh-page study's test split (no page, recording, label or finding of it was read), the first real-page study's data (its dev findings are cited from [notes-244-246.md](notes-244-246.md), not read again), and the round-3 pages, labels and runs (`study/round-3-*`).
- **Labels:** the study's two Claude judges, a pre-annotation and not ground truth (see the study's caveats). Nothing was relabelled. The two 1.1.1 findings no study label covers, which runs that asked the model again newly reported (an accurate alternative read against a headline painted over its picture, and a hidden image below the default threshold), were labelled by one Claude agent, here, both false positives, and are said so where they appear.
- **Model:** Gemma 4 12B through a local Ollama, temperature 0, one judgment per candidate, on a GPU other jobs used at the same time. Under that load, the same prompt does not always give the same answer, so the runs that ask the model again were repeated.

## 1. 1.1.1: an alternative in Portuguese, a description in English

### What was wrong

The two false positives left by the 1.1.1 dev fixes, with the model's answer in the study's run (version 4):

| Page | Alternative | What the judges said | `imageShows` | `suggestedAlt` |
| --- | --- | --- | --- | --- |
| unicamp.br | "Capa da edição 751" | the cover of the newspaper's edition 751, "ED. 751" printed on it | "The front cover of Jornal da Unicamp featuring a portrait of Orides Fontela and headlines about various topics." | "Capa do Jornal da Unicamp com a foto de Orides Fontela e manchetes sobre diversos temas." |
| fiocruz.br | "Boletim InfoGripe" | the InfoGripe bulletin's cover graphic, a map of Brazil with the InfoGripe logo | "A map of Brazil divided into regions with different colors and the InfoGripe logo." | "Mapa do Brasil com regiões coloridas e o logotipo do InfoGripe" |

Both claims were "describes something the image does not show". Verification already drops that claim when the suggestion keeps every word the alternative names: "Lula" in "Lula com um selo de 16%". Here the suggestions dropped "edição 751" and "Boletim", and the description, which named "front cover" and "InfoGripe", was in English, so no word of a Portuguese alternative could ever meet it. The prompt asked for the two fields in two languages: the description "in one short English sentence", the suggestion "in the requested language", the language of the image's element or page.

### What was tried

- **The new rule alone, on the study's answers.** Reading the description and the suggestion together, with the study's English descriptions, removes nothing: replayed offline from the study's cache, the dev findings are the same 13 (7 true positives, 3 false positives, 3 uncertain). "Boletim" is no word of an English sentence.
- **Text drawn in the image, from OCR.** A language-independent check would compare the alternative with the words drawn in the picture. Rampa's OCR (tesseract.js, used by 1.4.5) read "Orides" and "Fon" on the 350 × 514 cover and nothing on the 173 × 116 bulletin graphic, the "Tour 360º" image or the "Ceará em Destaque" photo: not enough to rest a fact on. It was left out.
- **The description in the alternative's language.** Asked for both fields in Portuguese, in two quick trials on the two images, the model kept answering "fail", but its suggestion kept the alternative's words three times out of four: "Mapa do Brasil com estados coloridos indicando dados do Boletim InfoGripe" twice, and once "Capa do Jornal da Unicamp, edição 751, com a manchete…". With the old prompt, asked once the same way, it kept them for one of the two (InfoGripe): the model's answers vary from run to run, which is why the full runs below were repeated. This is the change made.

### The change

1. **The prompt (1.1.1 version 5).** `imageShows` is written in the requested language, the alternative's, as `suggestedAlt` already was: "Describe what the image shows in imageShows, in one short sentence in the requested language, the language of the text alternative", and the user prompt says "Write imageShows and suggestedAlt in: Brazilian Portuguese (pt-BR)". On an English page nothing is asked differently than before, but the wording changed, so every 1.1.1 judgment is asked again once. The question about images hidden from assistive technology (`hidden-images.ts`) was not changed.
2. **Verification.** A "describes something the image does not show" claim is dropped when every word the alternative names (left out: the kind of picture, such as "logo", "foto", "imagem", and short function words) is in the model's description and suggestion taken together, with the reason "the model's description of the image keeps every word of the current alternative". The check that reads the suggestion alone stays first. Words are compared as written, so a name or a number ("InfoGripe", "751") meets the description in any language, and a Portuguese word meets only Portuguese. As the earlier facts, it never speaks for an alternative the placeholder pattern or the generic-word list flags, and it applies only to the "describes something the image does not show" claim, never to "leaves out what the image conveys", since "Chart" can rightly become "Chart of sales by quarter".

### Before and after on the dev pages

Each dev snapshot was judged with the study's flags (`rampa check <snapshot> --criteria 1.1.1 --model ollama:gemma4:12b --locale en --min-confidence low --concurrency 2`), each run from an empty cache except the first, which replays the study's own answers. Every run judged the same 160 images. The labels are the study's dev labels.

| 1.1.1 on the dev pages, default threshold | Prompt | Findings | TP / FP / uncertain | Precision (95% Wilson) | "Capa da edição 751" | "Boletim InfoGripe" |
| --- | --- | ---: | --- | --- | --- | --- |
| The study's run, replayed | version 4 | 13 | 7 / 3 / 3 | 0.70 (0.40–0.89) | reported | reported |
| Asked again | version 4 | 13 | 7 / 3 / 3 | 0.70 (0.40–0.89) | reported | reported |
| Asked again | version 4 | 14 | 7 / 4 / 3 | 0.64 (0.35–0.85) | reported | dropped |
| New prompt, run 1 | version 5 | 11 | 7 / 1 / 3 | **0.88 (0.53–0.98)** | dropped | dropped |
| New prompt, run 2 | version 5 | 12 | 7 / 2 / 3 | 0.78 (0.45–0.94) | dropped | dropped |

- **What dropped the two.** In both runs of the new prompt, the suggestions kept every word of the alternative ("Capa do Jornal da Unicamp, edição 751, com a manchete 'Orides Fontela (quase) inédita'…", "Mapa do Brasil com regiões coloridas indicando dados do Boletim InfoGripe"), so the check on the suggestion dropped them. The description check itself fired on no dev claim: the Portuguese descriptions still left out "edição 751" and "Boletim".
- **What stayed.** The 7 true positives in every run, and the same 3 uncertain findings ("Ceará em Destaque", "Arte transmissões da Fiocruz", "Capa AFN"). "Tour 360º" stays a false positive in every run: the words drawn in the picture, on a link to a page that embeds the tour (not a language question).
- **Noise, with either prompt.** poder360.com.br's "Lula", which the [1.1.1 dev fixes](notes-111-dev-fixes.md) had removed, came back in one run of each prompt: the model described the photo as one of Jair Bolsonaro ("A portrait of the politician Jair Bolsonaro…", "Uma foto de perfil do político Jair Bolsonaro…") and suggested his name, so no word check could drop it; in the other runs it named Lula. The third run of the old prompt also reported propublica.org's "A large golden crown entraps a person wearing a baseball cap looking at a glowing smartphone.", an accurate alternative that every other run passed: that time the model read the article's headline, which the page paints over the picture and so is in its crop, as part of the image (a false positive by this agent's reading; a crop that other elements paint over is a known limit of the capture). And one old-prompt run dropped "Boletim InfoGripe" too, when its suggestion happened to keep "Boletim InfoGripe".
- **Below the threshold.** Run 2 also reported, at low confidence, ons.gov.uk's tile illustration of groceries and a phone with `alt=""`, "PASTA, DETERGENT, and shopping comparison tool illustration": a false positive by this agent's reading (the tile's text names the tool; the picture adds nothing). The hidden-image question did not change; it was asked again because the version changed, and the model answered otherwise.

### ACT test cases and pairs

`rampa eval --criteria 1.1.1 --model ollama:gemma4:12b` on ACT `a9a1483e`. The run before this change read 30 of its 32 answers from a cache of earlier runs; the run after asked all 32 again with version 5 (w3.org pages failed to load at times, so the evaluation was run again until one run loaded all 56 pages; the earlier tries' answers were cached and read back).

| Set | n | Before: P / R / F1 | After: P / R / F1 |
| --- | ---: | --- | --- |
| 23a2a8 (syntax) | 18 | 1.00 / 1.00 / 1.00 | 1.00 / 1.00 / 1.00 |
| qt1vmo (meaning) | 16 | 1.00 / 1.00 / 1.00 | 1.00 / 1.00 / 1.00 |
| e88epe (meaning) | 20 | 1.00 / 1.00 / 1.00 | 1.00 / 1.00 / 1.00 |
| Pairs (alt-placeholder, alt-swap) | 3 | 2 of 2 told apart | 2 of 2 told apart |

Every one of the 56 pages had the same outcome before and after, and verification dropped no claim in either run. These are English pages, so the prompt asks for English as before; only its wording changed. The sets are small (3 failed examples on qt1vmo, 5 on e88epe): they show that the change loses no ACT failure, not that it never would.

### What must still fail

`test/non-text-content.test.ts`, "the model's description of the image, in the alternative's language", pins the new check with the claims it must keep:

- "img-1", `image.png` and "logo" alone keep a placeholder claim and a "describes something the image does not show" claim even when the description repeats them.
- A description that names something else ("A capa da edição 750" for "Capa da edição 751"), or only part of what the alternative names ("Lula sorrindo em um palanque" for "Lula e Bolsonaro"), or someone else ("Jair Bolsonaro discursando"), keeps the claim.
- An English description meets a name ("InfoGripe") but no Portuguese word ("Boletim"), so the study's English answer for "Boletim InfoGripe" still keeps its claim.
- A "leaves out what the image conveys" claim stands whatever the description repeats.
- An informative chart with `alt=""` is still asked the hidden-image question, and its claim kept (the earlier test, unchanged).

## 2. 2.4.4: recall 0.50 on ACT 5effbb

### Which failed examples were missed, and why

ACT 5effbb has six failed examples. In the recorded evaluation (`demo/recorded/eval/ollama-gemma4-12b`) and again here, every one had a candidate, the model judged every one, and the model answered "fail" with the problem "generic" on all six. The three counted as passed were the fact rule's: their fail is reported as a suggestion, because the text is not on the generic lists.

| Failed example | Link | Its programmatically determined context | Before |
| --- | --- | --- | --- |
| 1 | "More" to `#desc` | none | finding (generic list) |
| 2 | "More", `div role="link"` | none | finding (generic list) |
| 3 | "Go", an SVG link | none | finding (generic list) |
| 4 | "Workshop", alone in its paragraph; the workshop is described in the paragraph before | none | suggestion |
| 5 | "HTML", "EPUB", "Plain text" in a list; the book's title "Ulysses" is a bold paragraph above it, not a heading or a list item the list is nested in | none | suggestions |
| 6 | "Download" in a table cell; "Ulysses" and "1.61MB" are data cells of its row, under the header "Books" | the header cell "Books" | suggestion |

So the misses were neither candidate selection nor the model: the fact rule turned three right answers into suggestions. The passed examples next to them are the same texts with a context that names the book: the formats in a list nested under the list item "Ulysses" (Passed Example 5), the formats under a header cell "Ulysses" (Passed Example 6), "Download Ulysses in HTML" (Passed Example 8).

### The facts added

A fail with the problem "generic" is also a finding when:

- **the text names only what kind of file it gets, never which document** (`kindOnlyLinkText`, generic-text.ts): it is made only of a format ("HTML", "EPUB", "Plain text", "PDF", "DOCX", "MP3"…), the act of getting a file ("Download", "Baixar", "Descargar"), a size and filler ("PDF (2 MB)", "Versão em PDF"). Like "Click here", such a text names no document; unlike it, it says what kind of thing happens, so it was not on the generic list;
- **and nothing in its programmatically determined context could say which** (`kindOnlyUncompleted`, link-purpose.ts): no sentence, paragraph, list item or cell text of its own, no description, no heading anywhere above it; it is not in the site's navigation, header or footer landmarks, nor an item of a menu, a list of links that do not all name a file's kind; and either it has no header cells, or the header cells it has do not name what the rest of its row does: a data cell beside it holds a name, the table gives that row no row header, and no header cell names it (`rowSubjectOf`). This is technique F63, context in content that is not the link's programmatically determined context.

Failed Examples 5 and 6 are this fact; Passed Examples 5, 6 and 8 are not (their list item, header cell or sentence names the book). The menu and landmark guards are for real pages: debian.org's "Download", in its menu next to "About Debian" and "News", was a false positive in the first real-page study, and a format can also be a site's section ("HTML" in MDN's menu).

**Not added: the model's reading of a link with nothing around it.** Failed Example 4's "Workshop" has no context at all, and only a reading of the word says it is not enough. A rule "any 'generic' claim on a link with no context, no heading above, no landmark and no menu" would catch it. On the dev pages such links are rare (24 links with no context outside a landmark, 5 of them outside a menu too, all skip links), and the model, asked about each of them with the unchanged prompt, passed every one. It was still left out: the rule would rest a finding on the model's reading of a specific word alone, which is the reading the fact rule stopped trusting after it was wrong on real pages ("ISTs", "TOC", "Download"). A word that names a thing ("Workshop", "Tables") cannot be told from one that names a destination without that reading.

### Real pages: the dev split

The facts were computed, without a model, on all 1,367 link candidates of the twelve dev pages, with the names the browser gives links, as `rampa check` reads them (`study/notes-remaining/facts244.ts`). One text names only a file's kind, unicamp.br's "Baixar PDF" (after an icon font's glyph), and it sits in a navigation landmark with a sentence of its own, so the fact holds for no dev link; no dev finding can change, and the cap, which judges first the candidates a fact could ground, picks the same ones. A judgment of the dev pages with the study's cap (50 candidates per page) confirms it: the build before the change, asking the model, and the build after it, reading the same answers, both judged 535 links (832 were over the cap), and both reported the same 2 findings (poder360.com.br's two "INSCREVA-SE" links, which lead to two places with nothing to tell them apart, the existing link-set fact) and the same 15 suggestions, item by item.

### ACT test cases and pairs

`rampa eval --criteria 2.4.4 --model ollama:gemma4:12b`, links followed on the W3C host: one run of the model before the change (98 new calls, 4 from the cache), and the same 102 answers scored after it, offline, so the two differ only in what verification makes a finding.

| Set | n | Before: P / R / F1 | After: P / R / F1 |
| --- | ---: | --- | --- |
| c487ae (syntax) | 28 | 1.00 / 1.00 / 1.00 | 1.00 / 1.00 / 1.00 |
| 5effbb (meaning) | 18 | 1.00 / 0.50 / 0.67 | **1.00 / 0.83 / 0.91** |
| fd3a94 (meaning) | 24 | 0.78 / 0.88 / 0.82 | 0.78 / 0.88 / 0.82 |
| Pairs (intact + corrupted) | 34 | 1.00 / 0.52 / 0.69 | **1.00 / 0.95 / 0.98** |
| `link-generic` pairs told apart | 11 | 11 | 11 |
| `link-mismatch` pairs told apart | 10 | 0 | **9** |
| Model suggestions, for review | | 26 | 8 |

No passed or inapplicable example and no intact pair became a failure. The 8 suggestions left: "Workshop", fd3a94's "My university" (Passed Example 7, twice) and "Contact us" leading to a page titled "My University" (Inapplicable Examples 3 and 5, twice each: a mismatch with another page, which stays a suggestion), and "Expectation" in a pair, which the model called generic rather than mismatched. fd3a94's two false positives, Passed Examples 5 and 9, are unchanged.

## 3. The link-mismatch pairs: a fact that grounds a mismatch

The `link-mismatch` corruption points every named link of a passed example to `#hours` and adds a paragraph `<p id="hours">Opening hours: Monday to Friday, nine to five.</p>`. The model said "mismatch" on 9 of the 10 corrupted pages (the tenth, an SVG link labelled "Go to the main content.", it passed); since the 2.4.4/2.4.6 change every mismatch was a suggestion, because no checked fact supported it.

### The fact the brief proposed, measured: another page's title

"The destination page's title or main heading shares no meaningful word with the link text, when the text is specific." Measured on the dev pages, with the link's sentence, heading and description counted as what it promises, words of three letters or more without accents, a word and its longer forms counted as one ("language", "languages"), and the destination's title, heading, description and address path as what it is: of the 372 links whose destination was read and has a title that tells it apart (not the site's name, not shared by other addresses, not a not-found page), 5 have a specific text that shares no word with it, and none of the 5 is a mismatch:

| Link text | Destination's title |
| --- | --- |
| "Data for GDP" | "Gross Domestic Product: Quarter on Quarter growth: CVM SA %" |
| "Yes I found this page useful" | "Thank you" |
| "No I didn't find this page useful" | "Feedback" |
| "Report a problem with this page" | "Feedback" |
| "Right of withdrawal" | "Terms and conditions" (the page holds it) |

The first real-page study found the same on its own dev pages ([notes-244-246.md](notes-244-246.md): 28 of 410 shared no word, home pages, skip links, language switchers, and a privacy notice that holds the "Declaração de Cookies" its link names). A title summarizes a page; an abbreviation, a reply, or a broader page that holds what the text names share no word with it and are no mismatch. So a mismatch with another page stays the model's suggestion.

### A fact that is sound: a part of this page

When a link points to a part of this page, Rampa reads the part itself, not a summary of it. The fact (`namesNoPartOf`, link-purpose.ts) holds when:

- the page names the part: a word of its id is a word of its text (`#hours` and "Opening hours…"; `#configuration` and the heading "Configuration"), the site's own name aside (its host's labels and its title's words: fiocruz.br's `#block-portal-fiocruz-views-…` and "A Fiocruz tem 16 unidades" share only the site's name), and words that name how a page is built aside ("block", "view", "wrapper", "main", "content", "skip");
- the part is no landmark (main, navigation, banner, contentinfo, search, a form, a region): a skip link names the region it jumps to, not its subject;
- the link's text is neither generic, an address, nor a number (a footnote's "1");
- and no word of the link's text, its context, its heading, its header cells or its description is one of the part's words or the id's, read loosely: two words that begin with the same four letters count as one, so "Specifications" names `#specs`.

A table of contents entry that points to another section fails this way, and so do the corrupted pairs. On the dev pages it holds for none of the 32 links to a part of the page. 31 are skip links, to the content, a menu, the search field, the footer or past a carousel, and one opens an audio player ("Listen 42:22"); 7 lead to a landmark, 17 to a part with no text of its own (an empty anchor, a search field, a carousel's skip button), and 8 to a part whose id and text share no word (an id made only of words for how the page is built, such as `#main-content`, a plugin's name, or a name for the region rather than for what it holds, as `#navegacaoPrincipal` over the menu's items). No dev page had a link the fact would ground, so nothing on real pages tuned it, and nothing there measured its precision.

### What the pairs measure now

0 of 10 told apart before, 9 of 10 after, with the same answers. The corruption makes every link point to a part whose id and text name it, so the pairs now measure this fact as much as the model, as the `link-generic` pairs measure the "follow me" word rule since the 2.4.4/2.4.6 change. Its precision on real pages is not measured: it never fired on the dev pages.

## Versions, the demo and the tests

- **1.1.1 is version 5** (the prompt changed). **2.4.4 stays version 3**: its prompt did not change, only what verification makes a finding, so its cached answers still apply. The other criteria are unchanged.
- **Demo.** The version bump left 13 recorded 1.1.1 answers unanswered on four recorded pages (`examples-language-of-parts-match`, `examples-non-text-content-alt-quality`, `examples-store-after`, `examples-store-before`). They were recorded again with the local model into `demo/recorded/cache`; `node .rampa/misses.ts <name>` gives zero misses for all six recorded pages, and the findings are the same, image by image, with the same messages. Three suggested alternatives read differently ("Ilustração de um cachorro marrom sorridente com coleira vermelha" for "Ilustração de um cachorro marrom com coleira vermelha", "Desenho de um cachorro marrom com coleira vermelha" on the bicycle's claim, "Succulent plant in a pot" for "Potted plant"). The recorded evaluation the demo shows (`demo/recorded/eval/ollama-gemma4-12b`) was not recorded again: it is a past run, and it still shows 5effbb at 0.50 and the link-mismatch pairs at 0 of 10.
- **Tests.** `test/link-purpose-facts.test.ts` (new) pins the 2.4.4 facts with what they must leave to the model: Failed Examples 5 and 6 grounded; Passed Examples 5 and 6, a heading above, a sentence, the site's navigation, header and footer, a menu with "Download", a row header, a header that names the row's subject and a size beside the link not grounded; "Workshop" and "TOC" still suggestions; the pairs and a table of contents entry grounded as mismatches; a part named by the link ("Opening hours", "Our hours", "Specifications", "Reviews"), a skip link to `main`, an id that agrees with its text only through the site's name, a generic text and a number not grounded; "Declaração de Cookies" against a privacy notice read at its address not grounded; and a check with a model that fails everything. `test/non-text-content.test.ts` pins the 1.1.1 change (above).

## Limits

- **Tuned on what it is measured on.** The facts and the prompt were chosen by reading the dev pages' false positives and the ACT failed examples, and they are measured on the same pages, so these numbers are the best case. A held-out measurement has to come from round 3 or a later round.
- **Small numbers, and noise.** 10 decided 1.1.1 dev findings before this change (7 true and 3 false positives); the change removes 2 false positives, while a repeated run of either prompt adds or removes another one or two. Two or three runs of each prompt cannot give a stable precision, and the intervals overlap. 5effbb has 6 failed examples, and the link-mismatch pairs are 10 pages of one corruption.
- **The model reads faces and words, sometimes wrong.** The new prompt did not change the model's verdict on the two images: it still says "fail", and the fix rests on its suggestion keeping the alternative's words. A model that drops them again, or names another person, is reported as before.
- **The 2.4.4 facts are narrow on purpose.** They fire where the page leaves a link without a context that names its document, which is the shape of the ACT examples and rare on real pages: on the dev pages, never. A format link under a heading that does not name its document, or a "Download" in a menu, stays the model's suggestion. "Workshop" (Failed Example 4) is missed.
- **Hand-written lists.** The formats and download words cover English, Portuguese and Spanish; the words that name how a page is built, in ids, are a short list.
- **Labels from Claude agents,** the study's two judges and, for two findings, this one: a pre-annotation that needs human review.

## Reproduction

From the repository root, after `pnpm build`, with the dev pages' recordings and caches copied from the study's backup into `study/fresh-2026-10-11/pages/<slug>/` (kept out of git; check them against `data/recordings.json`). The "before" CLI is a build of `d23cfb5` (`git worktree add`, `pnpm build`, and its `dist/cli.mjs`).

- **1.1.1, the study's answers:** `bash study/notes-remaining/run.sh dev <label> 1.1.1 <cli> --offline` replays each page's study cache, which only the version-4 prompt reads.
- **1.1.1, asking again:** `bash study/notes-remaining/run.sh dev <label> 1.1.1 <cli> --fresh-cache`, once per run, with the "before" CLI for version 4 and this branch's for version 5; then `bash study/notes-remaining/run.sh list111 <label>` lists a run's findings with the study's dev labels and its precision at the default threshold.
- **2.4.4 on the dev pages:** `bash study/notes-remaining/run.sh facts244` computes the facts of every candidate with no model; `bash study/notes-remaining/run.sh dev before 2.4.4 <before cli> --fresh-cache` asks the model; `bash study/notes-remaining/run.sh copy-cache before after` and `bash study/notes-remaining/run.sh dev after 2.4.4 dist/cli.mjs --offline` score the same answers with this branch; `bash study/notes-remaining/run.sh list244 before after` compares them item by item.
- **ACT and pairs:** `bash study/notes-remaining/run.sh act <criteria> <cache> [cli] [--offline]` runs `rampa eval` on those criteria and their pairs. For 2.4.4, `act 2.4.4 <cache> <before cli>` asked the model and `act 2.4.4 <cache> dist/cli.mjs --offline` scored the same answers; for 1.1.1 each version asked its own (`act 1.1.1 <cache> <before cli>`, then `act 1.1.1 <cache>`). A run in which w3.org pages fail to load says so at its end ("page(s) with errors") and was run again.
- Run outputs and caches go to `.rampa/`, which is kept out of git. The model runs here: Gemma 4 12B through Ollama, on 2026-10-23.

# Judged criteria

Rampa runs axe-core first and reports its violations as they are. A judgment module then sends a model only the residue for one WCAG success criterion: what the engine passed on syntax, could not decide, or does not check. Each module lives in `src/criteria/` and does the same six things:

1. **Candidates.** Picks the nodes to judge from the normalized snapshot, never the DOM, and leaves out nodes the engine already failed.
2. **Prompt.** One criterion per prompt, with the normative WCAG text and only the context that criterion needs. Page data sits inside tags the model is told never to obey.
3. **Schema.** The model answers in JSON with a verdict (`pass`, `fail`, `cannot_tell`), evidence and the fields the criterion needs.
4. **Verification.** Every claim is checked against the snapshot. A claim that does not hold is dropped and counted, never reported.
5. **Message**, in English and Portuguese.
6. **Patch**, when a fix can be written: a changed attribute, a changed text, or a replaced element. A patch is a proposal for a person to review.

Nine criteria have a module. Eight run by default; 1.4.5 runs when asked for (`--criteria 1.4.5`).

| Criterion | Level | Default | Vision | axe-core rules it builds on | ACT rules in `rampa eval` |
| --- | --- | :---: | :---: | --- | --- |
| [1.1.1 Non-text Content](#111-non-text-content) | A | yes | yes | image-alt, input-image-alt, role-img-alt, svg-img-alt | 23a2a8 (syntax), qt1vmo |
| [1.3.5 Identify Input Purpose](#135-identify-input-purpose) | AA | yes | | autocomplete-valid | 73f2c2 (syntax, and pairs) |
| [1.4.5 Images of Text](#145-images-of-text) | AA | no | yes | none | 0va7u6 |
| [2.4.2 Page Titled](#242-page-titled) | A | yes | | document-title | 2779a5 (syntax), c4a8a4 |
| [2.4.4 Link Purpose (In Context)](#244-link-purpose-in-context) | A | yes | | link-name | c487ae (syntax), 5effbb |
| [2.4.6 Headings and Labels](#246-headings-and-labels) | AA | yes | | empty-heading, label | b49b2e, cc0f0a |
| [3.1.1 Language of Page](#311-language-of-page) | A | yes | | html-has-lang, html-lang-valid, html-xml-lang-mismatch | b5c3f8, bf051a (syntax), ucwvc8 |
| [3.1.2 Language of Parts](#312-language-of-parts) | AA | yes | | valid-lang | de46e4 (syntax), off6ek |
| [3.3.2 Labels or Instructions](#332-labels-or-instructions) | A | yes | | label, select-name, form-field-multiple-labels | none; pairs from cc0f0a |

**Why 1.4.5 is not on by default.** It adds a vision call for every picture larger than an icon, which doubles the image work 1.1.1 already does, and whether a banner that pairs a product photo with a headline is an image of text is a call people still disagree on.

The evaluation numbers below are from one run of Gemma 4 12B on a local GPU (Ollama, reasoning off) on 2026-10-09, ACT test cases `a9a1483e`. The prompts of 1.3.5, 1.4.5 and 3.3.2 were revised after reading the errors of earlier runs on these same cases, without copying test pages into the prompts, so read the numbers as a working pipeline, not a result.

## 1.1.1 Non-text Content

- **axe-core checks** that an image has a text alternative. It passes `alt="img-1"` on a photo of a dog.
- **Rampa judges** every image with a non-empty alternative (`img`, `input type="image"`, `role="img"`, a named `canvas`): whether the alternative serves the same purpose as the image here.
- **Context:** the image as it renders (an element screenshot, with fixed and sticky layers such as cookie banners hidden while it is taken), the current alternative, the file name, the name of the link or button it sits in, nearby text, and the page language for the suggestion.
- **Verification:** the evidence must be the current alternative; the model must say what the image shows; a fail needs a problem and, unless the image is decorative, a suggested alternative under 250 characters that differs from the current one. File names and placeholders such as `IMG_2034.jpg` are recognized by a pattern, which wins over the model's label in the message.
- **Patch:** sets `alt` (or `aria-label` on elements that take no `alt`) to the suggestion, or to empty for a decorative image.
- **Limits:** a suggested alternative cannot be checked against the page, since only the model sees the pixels. Images with `alt=""` are taken as decorative and not judged.

## 1.3.5 Identify Input Purpose

- **axe-core checks** that an `autocomplete` value is a valid token for the input type (ACT 73f2c2). It says nothing when the attribute is missing, or when the token is valid but names other data, such as a phone field with `autocomplete="email"` (failure F107).
- **Rampa judges** every text-like field that takes input (text, email, tel, url, password, number, date, month, `select`, `textarea`; not search boxes, buttons, checkboxes, hidden, disabled or read-only fields): whose information it collects (the user's, someone else's, nobody's), which of the 53 WCAG input purposes it asks for, and whether its `autocomplete` names that purpose.
- **Context:** the label (or the placeholder when there is none), the input type, `name` and `id`, a select's first options, what the current `autocomplete` value means, the heading above, the fieldset legend, the other fields in the form (a "Name" next to "Card number" is the name on the card) and the form's buttons. The prompt lists every token with its meaning, because local models never read the JSON schema.
- **Verification:** the evidence must be the label or placeholder. A fail must be about the user's own data and name a purpose that is in the WCAG list (not `one-time-code`), that is not a transaction amount or currency (the Understanding document notes those are rarely about the user), and that axe-core's own type table allows on that input, so the patch can never break the engine rule. A mismatch claim is dropped when the current token already names that purpose or a close one (`tel` and `tel-national`, `email` and `username`, `new-password` and `current-password`). A language or country selector with no other field around it is a page switcher, not data entry, and is dropped.
- **Patch:** adds or replaces `autocomplete`, keeping a `section-*` prefix and `billing` or `shipping`.
- **Evaluation:** ACT 73f2c2 measures the engine; with judgment, precision drops to 0.83 because two of its inapplicable cases, a "Username" field with `autocomplete=""`, are 1.3.5 failures that Rampa reports. No ACT rule judges missing or mismatched tokens, so pairs come from 73f2c2's passing pages, with the token removed (`autocomplete-drop`) or swapped for a valid token for unrelated data (`autocomplete-swap`): 8 of 9 and 6 of 7. The miss in each is "Partner's email address", someone else's data, where passing is right.
- **Limits:** whether data is about the user is the model's call (a gift recipient, a friend). A field that combines two purposes, such as "email or username", passes without a token, as the Understanding document allows. On real pages it found newsletter and sign-in fields without tokens on mozilla.org, kabum.com.br, saucedemo.com and wordpress.org, and passed GitHub's sign-in.

## 1.4.5 Images of Text

- **axe-core checks** nothing for 1.4.5: whether a picture is mostly text is a question about pixels.
- **Rampa judges** every rendered picture larger than an icon (more than 40 px on a side): `img`, image buttons, named `canvas`, elements with `role="img"` and no text of their own, and CSS background images (captured with the element's own content hidden, so only the picture is judged). Inline SVG is left out, since its text is real text, and so is anything whose alternative, file name, id or class says it is a logo.
- **Context:** the picture as it renders, how it is drawn, its size, its alternative, its file name, the link or button it belongs to, and the visible text of the closest container around it.
- **Verification:** the model must transcribe the text it reads. A claim needs at least three letters, since a lone character or a pair of initials is a symbol or a monogram, like the Understanding document's "B" for bold. It is dropped when a descriptive alternative (three content words or more, generic words such as "banner" left out) shares no word with the transcription, when the page itself calls the picture a screenshot, chart, diagram, graph or map, and when the same words are shown as real text next to the picture, which the Understanding document says meets the criterion.
- **Patch:** replaces an `img` with a `<span>` holding its text, or an image button with a `<button>`; the look comes back with CSS. Backgrounds and canvas get no patch.
- **Evaluation:** ACT 0va7u6, precision 1.00 and recall 0.60 (3 of 5). One miss is a deliberate disagreement: the test case shows "Welcome" as an image above the paragraph "Welcome to our website", which ACT counts as a failure and the Understanding document as met. The other is a model error: plain text "WCAG Rocks" called a logotype. Pairs that swap pictures for a rendered sentence (`text-as-image`): 4 of 4.
- **Limits:** the transcription is the model's reading and can slip on fine print. Promotional banners that pair a product photo with an offer or a headline are reported when the text dominates; teams that read them as pictures with significant other content can waive them. On real pages it reported slogan and title graphics on mozilla.org and carousel banners on kabum.com.br, and nothing on 17 photos on BBC News or the screenshots on a GitHub Docs page.

## 2.4.2 Page Titled

- **axe-core checks** that the page has a non-empty title. It passes "Untitled document".
- **Rampa judges** a non-empty title against the page's address, first headings and opening text.
- **Verification:** the evidence must be the title; a fail needs a problem and a different suggested title under 140 characters.
- **Patch:** replaces the text of `<title>`.
- **Limits:** the syntax set 2779a5 titles its passing pages "Title of the page.", which Rampa rightly says describes nothing, so its precision there is a scoring artifact.

## 2.4.4 Link Purpose (In Context)

- **axe-core checks** that a link has a name. It passes "Click here".
- **Rampa judges** links with text (links whose only content is an image are left to 1.1.1) with their programmatically determined context: the paragraph, list items or cell around them, the heading above, the landmark, `aria-describedby` and the target of a same-page link.
- **Verification:** the evidence must be the link text; a fail needs a problem and a different suggested text.
- **Patch:** replaces the link text, or `aria-label` when the name comes from it.
- **Limits:** the destination page is not fetched yet. Short texts whose purpose comes from a description or a nested list are its weakest cases.

## 2.4.6 Headings and Labels

- **axe-core checks** that headings are not empty and fields have a label. It passes "Section 2" over reviews and "Field 1" on an email field.
- **Rampa judges** every heading against the content it introduces (up to the next heading of its level or the end of its section, with the sections it sits in and its sibling headings), and every field label against the field.
- **Verification:** the evidence must be the heading or label text; a fail needs a problem and a different suggestion under 160 characters.
- **Patch:** replaces the heading or label text, or `aria-label`.
- **Limits:** short headings that a person would pass, such as a step name, are sometimes flagged on real pages.

## 3.1.1 Language of Page

- **axe-core checks** that the page declares a valid language. It passes `lang="en"` on a page in Portuguese.
- **Rampa judges** the text that inherits the root language against the declared language.
- **Verification:** the evidence must be an excerpt of that text; the detected language must be a valid BCP 47 tag, different from the declared one on a fail and the same on a pass.
- **Patch:** sets the root `lang` to the detected primary subtag.

## 3.1.2 Language of Parts

- **axe-core checks** that `lang` values are valid. It passes a Dutch review marked `lang="es"`.
- **Rampa judges** each element with a valid `lang` whose text may be in another language, allowing the criterion's exceptions (proper names, technical terms, words of indeterminate language, vernacular).
- **Verification:** the evidence must be an excerpt of the element's text; a fail needs a different, valid detected language and no exception.
- **Patch:** sets the element's `lang`.
- **Limits:** a sentence that is two languages at once ("Paul put dire comment on tape") is the known model error.

## 3.3.2 Labels or Instructions

- **axe-core checks** that a field has an accessible name (rules `label` and `select-name`, under 4.1.2) and no more than one label (`form-field-multiple-labels`). A name in `aria-label` passes and shows nothing on screen, which the Understanding document calls a 3.3.2 failure: labels must be presented to everyone, not only to screen reader users.
- **Rampa judges** two kinds of field. A field whose name nobody sees: it comes from `aria-label`, `title` or a label hidden from view, and the field has no placeholder and, for a select, no option on show. And a field with a `pattern`: whether something visible states the format or shows an example of it.
- **Context:** where the name comes from, the placeholder or the option a select shows, the pattern, the visible text just before and after the field (labels of other fields left out), the heading above, the fieldset legend, and the buttons beside it, with whether they show text or only an icon.
- **Verification:** the evidence must be the field's name. A missing-label claim is dropped when the snapshot shows a visible label for the field, when the field's name is shown on screen right beside it (a visible label not tied to the field still labels it; the tie is 1.3.1), and when the model quotes visible text that names the field. A pattern claim needs a pattern, a statement of what it requires, and no visible word that the pattern accepts, since an example in the required format explains it.
- **Patch:** adds a visible `<label>` before an input, or a hint tied with `aria-describedby`. A `select` or `textarea` gets no patch, since its start tag is not the whole element.
- **Evaluation:** no ACT rule covers 3.3.2. Pairs take cc0f0a's passing pages, where every field has a visible label, and move each label into `aria-label` (`label-hidden`): 7 of 7, against 0 for axe-core. The intact pages give the module no candidates, so they test the corruption, not false positives; the example pages in `examples/labels-or-instructions/` cover the pattern rule and an icon search button.
- **Limits:** a field labeled only by its placeholder is not reported: the WAI forms tutorial advises against it, but the Understanding document does not call it a failure. Icons drawn in CSS pseudo-elements are not in the snapshot, so the model cannot see them. On 13 public pages it found no false positives after a select showing "English" beside a globe icon was taken out of scope, and few candidates at all, since most fields there have visible labels or placeholders.

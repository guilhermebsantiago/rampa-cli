# Cognitive accessibility profile (`--profile cognitive`)

`--profile cognitive` adds checks based on the W3C guidance for people with cognitive and learning disabilities: the Working Group Note *Making Content Usable for People with Cognitive and Learning Disabilities* (COGA, 29 April 2021, https://www.w3.org/TR/coga-usable/), whose design patterns the WAI lists as supplemental guidance (https://www.w3.org/WAI/WCAG2/supplemental/).

The Note says it plainly: "Following this guidance is not required for conformance to WCAG". So the profile's results are a class of their own, called **advisories**. An advisory:

- is never a WCAG failure, and never counts toward WCAG coverage;
- never changes the exit code, unless you pass `--fail-on advisory`;
- always carries a fixed label that says so: "Advisory · COGA o4p06 Use Clear Visible Labels (not a WCAG requirement)", or in Portuguese "Recomendação · COGA o4p06 Use rótulos claros e visíveis (não é requisito da WCAG)".

**Every check is experimental so far, and every report says so.** A check stays experimental until it passes the evaluation the [plan](plans/cognitive-profile.md) sets (§4.2): it has fixtures, but it has not yet been measured on real pages or reviewed by people. Experimental checks run whenever the profile is on. In the terminal, Markdown and HTML reports, the advisory section opens with one notice, and each advisory from an experimental check carries the tag `experimental`; JSON and SARIF give each result its `maturity`. The notice reads:

> These advisories come from W3C COGA guidance (and GAIA where cited) and are not WCAG requirements. The ones marked experimental come from checks that have not yet been measured on real pages or reviewed by people, so each one needs a person's judgment.

In Portuguese: "Estas recomendações vêm da orientação COGA do W3C (e do GAIA, quando citado) e não são requisitos da WCAG. As marcadas como experimentais vêm de verificações que ainda não foram medidas em páginas reais nem revisadas por pessoas, então cada uma precisa do julgamento de uma pessoa." The tag comes from each check's maturity, so a check that passes its evaluation stops being marked. `--fail-on advisory` counts experimental advisories like any other.

The WCAG A/AA check runs exactly as without the profile: same findings, same coverage, same exit code.

```sh
rampa check examples/cognitive/cadastro.html --profile cognitive
rampa check https://example.gov.br/form --profile cognitive --locale pt-BR
rampa check site/ --profile cognitive --fail-on advisory   # advisories also fail the run
```

In `rampa.config.ts`:

```ts
export default defineConfig({
  profiles: ['cognitive'],
  coga: {
    abbreviations: { known: ['SUS', 'SEI'], glossaryUrl: '/glossario' }, // never reported; links to the glossary explain
    publicSector: true, // adds Lei 15.263/2025 to the abbreviation advisories; default: guessed from .gov.br, .leg.br, .jus.br, .mp.br
  },
})
```

From code, `check(targets, { profiles: ['cognitive'] })` and `checkSnapshot(snapshot, engine, { …, profiles: ['cognitive'] })` add `report.advisory`.

`examples/cognitive/cadastro.html` is a sign-up page in Portuguese with one case of each check, and a checked newsletter box that must stay silent.

## What is checked

Four checks of forms and words, each tied to a sentence of a COGA pattern, and each screening only part of that pattern. Rules decide every fact; a model never decides whether something is a problem. Seven more, of how text and controls are presented, are in [Legibility, icons and new windows](#legibility-icons-and-new-windows).

| Check | COGA pattern | What it looks for | Impact | Patch |
| --- | --- | --- | --- | --- |
| `coga/input-formats` | o4p08 Accept different input formats (o4p07 for an example the field refuses) | (a) `type="number"` on an identifier: postal code (CEP, ZIP, postcode), phone, card, CPF, CNPJ or account number; (b) a `pattern` that refuses a common way to write the value; (c) a `maxlength` shorter than a common way to write it; (d) an example shown with the field ("Ex.: 123.456.789-09", or a placeholder that looks like a value) that the field's own pattern or length refuses | barrier | (a) `type="text" inputmode="numeric"` (`type="tel"` for a phone) |
| `coga/preselected-cost` | o4p03 Notify Users of Fees and Charges; o7p03 Clearly State the Results and Disadvantages | A checkbox or switch checked when the page loads whose own text names a price above zero (R$, US$, $, €, £) or a commitment that costs later (a free trial, automatic renewal, a paid plan) | barrier | the start tag without `checked` |
| `coga/visible-labels` | o4p06 Use Clear Visible Labels | A text field whose only text on screen is its placeholder, which disappears once the person types | hurdle | a `<label>` with the placeholder's words, when they read as a label |
| `coga/abbreviations` | o3p01 Use Clear Words | An abbreviation (CPF, NIS, CNPJs, CadÚnico) with no explanation on the page: no `<abbr title>`, no `<dfn>`, no glossary link, and no full term next to it in brackets or after a dash, or explained only after its first use | hurdle in labels, buttons, headings, legends, navigation and forms; suggestion elsewhere | the first use written out, "Número de Identificação Social (NIS)", in a short element, only with an expansion the page or Rampa's list attests |

What stays silent, on purpose:

- **Input formats**: patterns that accept the common forms (`[0-9]{5}-?[0-9]{3}`); forms with `novalidate` or a submit with `formnovalidate`, which are checked by script, often with a mask; text fields with `inputmode="numeric"`; quantities in number fields; a PO box ("caixa postal"), a health card ("Cartão SUS"); a field that may hold two kinds of value ("CPF ou CNPJ"); a `pattern` that is not valid in the `v` mode browsers compile it with (browsers ignore it, so the report only notes it).
- **Pre-selected cost**: unchecked options, zero amounts, radio groups (a required choice always has one option selected), consent with no price ("Quero receber novidades por e-mail"), and the price of a product in the same table row as a gift-wrap box.
- **Visible labels**: a label on screen, tied to the field or right before it; a legend or group name; short text right before the field; a button with a name on the same line (WCAG technique G167, a search box and its "Buscar" button or magnifying glass).
- **Abbreviations**: words written in capitals (ENTRAR, SERVIÇOS: a dictionary knows them), Roman numerals (inciso VIII), Brazilian state codes (SP), currencies and units next to a number, file formats and names (PDF, IMG_2034.jpg), text in `code`, `pre` or `kbd`, addresses, and the abbreviations of your project (`coga.abbreviations.known`). An expansion Rampa's list attests counts next to the token even when it is a translation: "Perguntas Frequentes (FAQ)".

The profile works on web pages, in Portuguese and English. Android, iOS and images are not screened yet.

## Legibility, icons and new windows

Seven more checks look at how the page sets its reading text and its controls: line length, alignment, line spacing, long passages in capitals or italics, decorative fonts, controls that show only an icon, and links that open a new window. They rest on COGA where a pattern covers the case, and on GAIA (G03, G09, G14, G22) and WebAIM where none does. Like the four checks above, they are rules, experimental, web only, and never a WCAG failure. Where WCAG 1.4.8 Visual Presentation (AAA) asks for the same thing, they also report it beyond the target, the way `coga/abbreviations` reports 3.1.4.

| Check | Rests on | What it looks for | Impact |
| --- | --- | --- | --- |
| `coga/line-length` | COGA o3p10 Use White Spacing; GAIA G03; WebAIM; WCAG 1.4.8 (AAA) beyond the target | Reading text drawn with lines of more than 80 characters (median per line), or 40 in Chinese, Japanese or Korean | hurdle |
| `coga/text-alignment` | COGA o3p10 for justified text, with WebAIM and WCAG 1.4.8 (AAA); GAIA G03 for right-aligned text | Long reading text that is justified, or aligned to the right in a left-to-right language | hurdle |
| `coga/line-height` | COGA o3p10; GAIA G03; WebAIM; WCAG 1.4.8 (AAA) beyond the target | Long reading text whose lines are less than 1.2 times the font size apart; under 1.5, WCAG 1.4.8 alone | hurdle |
| `coga/text-emphasis` | GAIA G03 for capitals; WebAIM for italics | A passage of more than 15 words in capitals, or of more than 50 words in italics | hurdle |
| `coga/decorative-font` | COGA o8p04 (Avoid "a cartoon font or gothic"); GAIA G09 and G03; WebAIM | Reading text set in the generic `cursive` or `fantasy` family, or in a decorative family on Rampa's list | hurdle |
| `coga/icon-only-control` | COGA o4p06 Use Clear Visible Labels, with o1p07; GAIA G14; WebAIM | A link, button, menu item or tab with a name but no words on screen: only an svg, an image, an icon font, a CSS icon, a symbol or a CSS background | hurdle |
| `coga/new-window` | GAIA G22; WCAG technique G201 (advisory) | A link that opens a new window or tab, when nothing it shows, nothing assistive technology reads and nothing in its description says so | hurdle |

The impact is the same for all seven: each makes reading or using the page harder, and none stops the task on its own. COGA's persona Sam, who has dyslexia, finds his way "if the page has left justified text with uneven right edges" and learns "to increase the line spacing and change the font style" (Note §6.8.1); WCAG technique G201 says a new window "can be disorienting ... for some people with cognitive disabilities".

### What the collector measures

These checks need facts the page tree does not hold, such as where lines break or which font the browser drew. With `--profile cognitive`, and only then, the collector measures them in the browser after reading the page, at the snapshot's viewport (1280×800 by default, or what `--viewport` sets), and keeps them in the snapshot as `snapshot.presentation` (`src/surfaces/presentation.ts`):

- **Blocks of reading text.** These are paragraphs, list items, cells and `div`, `section` or `article` blocks whose text is not split among other blocks. Inside `main` or `article` only, when the page has them; else the whole page.
  - Left out: navigation, the page header and footer, asides, menus and toolbars; text inside links, buttons, labels, legends, headings, `pre` and `code`.
  - For each block, the collector records:
    - the lines it is drawn on, from `Range.getClientRects()` on each text node;
    - the characters on each line, shared out by the width each piece of a line takes;
    - the distance between consecutive lines, which is the line height as drawn, `normal` included;
    - the computed `text-align`, `direction` and `line-height`;
    - the letters shown in capitals (after `text-transform` and small caps) and in italics;
    - the font, as the first family of the CSS list the browser has (tested with a canvas), and the font the browser drew most glyphs with, read once per family over CDP (`CSS.getPlatformFontsForNode`).
- **Controls that show no words.** A word here is two letters or a digit. Visually hidden text, icon-font glyphs (private use characters, or a family named like an icon font) and symbols such as × or ☰ are not words. For each control, the collector records the kind of icon and a name computed in the page; the check prefers the browser's own name when the accessibility tree was read. An icon must be at most 64 px on each side. A control whose classes, alt or address say logo or brand is left out, since a logo is not an icon.
- **Links that open a new window.** A link counts when its `target` opens a new browsing context (`_blank`, or a name no frame on the page has), or when its `onclick` calls `window.open`. Links to `mailto:`, `tel:` or `sms:`, and links with `download`, are left out. For each link, the collector records:
  - the words it shows;
  - what is read but not shown: `aria-label`, visually hidden text, and the alternatives of its images and svg titles;
  - its description: `aria-describedby`, `aria-description` and `title`;
  - any icon with no text alternative in or right after it.

The facts stay within the collector's 5,000-element cap: they are read only for elements of the tree. They are also capped on their own, at 200 blocks, 300 controls and 300 links per page. A block under 25 words that fits on fewer than 3 lines is kept only when it is set in capitals. A snapshot without the facts, recorded before this or without the profile, still loads. The seven checks then say they did not run, and why. A snapshot with the facts gives the same advisories offline (`rampa check page.snapshot.json --profile cognitive`), which a test holds.

**Time and size.** The run without the profile measures nothing, so it pays nothing. Measured in Edge on Windows, three runs each:

| Page | Elements | Measuring time (`--timings`, collection · presentation) | Of the collection stage | Added to the snapshot |
| --- | --- | --- | --- | --- |
| pt.wikipedia.org/wiki/Brasil | 5,000 (the cap) | 81 to 85 ms | 1.31 to 1.41 s | 41 KB on 2.37 MB (88 blocks, 8 controls) |
| `test/fixtures/coga/presentation.html` | 37 | 14 to 19 ms | 0.3 s | 4 KB |

On four other real pages (gov.br, GOV.UK, BBC, UFC), it took 11 to 71 ms.

### `coga/line-length`

**What it detects.** A long block of reading text, at least 3 lines and 25 words (60 characters in CJK), whose lines have a median of more than 80 characters. The median leaves out the last line, which is usually short. The limit is 40 for Chinese, Japanese and Korean, by the block's script or its language.

- **The advisory** cites the first block, the median and the longest line in characters, the viewport they were measured at, and a sample of the text.
- **Grouping.** Blocks of one column, with the same left edge and width to 8 px, make one result. Wikipedia's paragraphs, each in its own section, are one column. At most 5 results per page; a note counts the rest.
- **Beyond the target.** One line, WCAG 2.2 1.4.8, counts every block over the limit.
- **Confidence.** Within 3 characters of the limit, the count could fall on either side, so confidence is medium.

**Why 80.** It is the figure of GAIA G03 ("evite linhas com mais de 80 caracteres"), of WebAIM's WAVE checklist ("more than around 80 characters per line"), and of WCAG 1.4.8 ("no more than 80 characters or glyphs (40 if CJK)"). The British Dyslexia Association's 60 to 70 characters, cited in COGA's user research, is stricter and not used. **Honest mapping:** COGA o3p10 names no line length. The advisory cites it for its How it Helps sentence: "For those with cognitive and learning disabilities, white space has been shown to ease reading difficulties and improve understanding of content." The 80 characters come from GAIA, WebAIM and WCAG.

**Stays silent.** Lines of 80 characters or fewer; blocks of 2 lines or fewer, or under 25 words; navigation, header, footer, asides, `pre` and `code`; text inside links, buttons and headings.

### `coga/text-alignment`

**What it detects.** A long block of reading text (3 lines and 25 words) that is either:

- justified (`text-align: justify`). It rests on COGA o3p10, More Details: "Use clear spacing between letters, words, sentences lines, paragraphs, and blocks of text". With WebAIM: "Avoid full justified text as it results in variable spacing between words and can result in distracting "rivers of white"". Beyond the target, it is also counted under WCAG 1.4.8, "Text is not justified".
- aligned to the right (`right`, or `end` in a left-to-right direction). It rests on GAIA G03: "Evite alinhar os textos à direita." This is not a 1.4.8 matter: right alignment meets 1.4.8 (technique C19).

Blocks of one column make one result, at most 5 per page.

**Stays silent.** Right-to-left text, by direction, script (Arabic, Hebrew) or language: it is aligned to the right by nature. Centered text, which no source sets a limit for, and centered headings. Short blocks: a justified line or two, a right-aligned price in a table cell.

### `coga/line-height`

**What it detects.** Two levels:

- **An advisory** when the lines of a long block (3 lines and 25 words) are less than **1.2 times the font size** apart. The distance is measured between the drawn lines, so `line-height: normal` counts at what the font makes of it: about 1.15 for Arial, 1.3 for Segoe UI.
- **WCAG 1.4.8 beyond the target alone** from 1.2 up to 1.5: one line per page counts the blocks under 1.5 and gives the tightest ratio.

**Why two levels.** 1.5 is the figure of WCAG 1.4.8 ("space-and-a-half"), of the British Dyslexia Association, and, for most fonts, of WebAIM ("no less than half the character height"). But many well-set pages read at 1.3 to 1.45: GOV.UK's body text is 1.32. An advisory at 1.5 would fire on most of the web, and 1.4.8 asks for a *mechanism* (the browser's or the reader's own styles may give the spacing), so the profile reports that band only as a measured fact beyond the target. Below 1.2, the text is set at the browser's `normal` for most fonts or tighter, closer than any of the sources accepts: that is the advisory.

**Stays silent.** 1.2 and above, which counts only toward the 1.4.8 line; single lines and short blocks; headings and lists of short items.

### `coga/text-emphasis`

**What it detects.**

- **Capitals.** A passage of more than **15 words** with at least 95% of its cased letters shown in capitals: typed so, by `text-transform: uppercase`, or by small caps. The advisory says which. It rests on GAIA G03: "Use textos em caixa baixa, evite o uso de caixa alta para todos os caracteres." With WebAIM: "Be careful with ALL CAPS."
- **Italics.** A passage of more than **50 words** with at least 95% of its letters in italic or oblique. It rests on WebAIM: "Do not use italics or bold on long sections of text." No COGA pattern names either, so the label cites GAIA G03 or WebAIM.

**Why 15 and 50.** WebAIM accepts styles that "highlight important content" if used "conservatively", and objects to *long sections*. 15 words is the longest text Rampa's own 1.3.1 rule reads as a possible heading. Past it, a block in capitals is a passage, not a heading, a label or a call-out. 50 words is COGA's own figure for a long paragraph (Note §4.4.5: "if you have a paragraph of more than 50 words, try breaking it up"). A quoted testimonial or a caption of a sentence or two stays under it.

**Stays silent.** Acronyms (CPF, INSS) and words in capitals inside normal text; one sentence in capitals inside a paragraph; buttons, labels, links, navigation and headings, whatever their length; a call-out of up to 15 words; scripts without case (CJK, Arabic, Hebrew); italics up to 50 words. Bold is not checked.

### `coga/decorative-font`

**What it detects.** Reading text of at least 25 words set in either:

- the generic `cursive` or `fantasy` family. This is the author's choice of a decorative face, whatever this machine draws it with (Edge on Windows draws `cursive` as Comic Sans MS and `fantasy` as Impact). When the font drawn here is not on the list, confidence is medium;
- a family on Rampa's list of decorative fonts (`DECORATIVE_FONTS` in `src/advisory/checks/legibility.ts`), when the browser has it. The font it drew wins: a decorative family named in the CSS but not installed, or not used for the glyphs, is not reported. The list:
  - cartoon: Comic Sans MS, Chalkboard, Chalkduster, Marker Felt, Kristen ITC, Jokerman, Bangers, Luckiest Guy;
  - script and handwriting: Brush Script MT and Std, Lobster, Pacifico, Dancing Script, Great Vibes, Sacramento, Satisfy, Kaushan Script, Lucida Handwriting, Segoe Script, Segoe Print, Mistral, Vivaldi, Edwardian Script ITC, Freestyle Script, French Script MT, Monotype Corsiva, Zapfino, Apple Chancery, Snell Roundhand, Bradley Hand, Permanent Marker, Indie Flower, Shadows Into Light;
  - blackletter ("gothic" in COGA's sense): Old English Text MT, UnifrakturMaguntia, UnifrakturCook, Pirata One, Grenze Gotisch;
  - display: Papyrus, Curlz MT.

The advisory rests on COGA o8p04, Avoid: "Default fonts that are not clear or readable such as a cartoon font or gothic". With it go GAIA G09 ("evite inserir elementos que distraiam como animações, fontes não convencionais (como as “fontes fantasia”)"), GAIA G03, and WebAIM ("varying or unusual font faces"). Blocks in one family make one result.

**Stays silent.** Serif fonts, always. GAIA G03 recommends sans-serif ("Use fontes sem serifa como Arial, Verdana, Helvetica e Tahoma"), but neither COGA nor WebAIM does, and the evidence on serifs for reading is mixed: Rampa does not report a serif. "Gothic" sans-serif faces (Century Gothic, MS Gothic, Franklin Gothic) are not blackletter. A decorative font on a heading or a short tagline is left alone, since COGA's concern is the default font people read.

### `coga/icon-only-control`

**What it detects.** A link, button, menu item or tab that shows no words, only an icon, while its accessible name has words: the name is read by assistive technology but not shown. It rests on COGA o4p06, How it Helps: "Some controls do not have visual labels. A caregiver shows them what the control is for and they can use the application. The next day they try to use it again, but cannot remember what the control is for." With it go:

- COGA o1p07, Getting Started: "Provide common icons next to key texts";
- GAIA G14: "Símbolos, pictogramas e ícones devem apresentar um equivalente textual próximo";
- WebAIM: "Pair icons or graphics with text".

The advisory cites the control, its name, and the kind of icon: svg, image, icon-font glyph, CSS icon, symbol, or CSS background. Controls of one region make one result, listing each name: a row of social icons, a toolbar, the links of a footer or a list. At most 10 results per page.

**Confidence.** High, or medium when the icon is an image or a CSS background, which may have words drawn in it.

**Exemptions, by name.** The name must hold, as a whole word, a word in English, Portuguese or Spanish for:

- **search or home.** The Nielsen Norman Group found these icons recognized almost universally: "The icons for home, print, and the magnifying glass for search are such instances" (Harley, *Icon Usability*, 2014).
- **close** (close, dismiss, fechar, cerrar). No study is behind this one: it is exempt because it acts on the dialog or banner it sits on, which stays in view, so nothing is lost when the × is misread.

The hamburger menu is **not** exempt. The same study calls it an icon "striving to become universally known", and COGA's concern is the person who does not know it.

**Stays silent.**

- **A control with no name.** That is a WCAG failure already: axe-core's `button-name` and `link-name` report it. A name that is only an icon-font glyph is left to Rampa's 4.1.2 rule.
- **A control with words on screen.** Words may come from text, a CSS pseudo-element or a digit, as in pagination.
- **A control with its name shown right beside it.** The previous or next element holds the name.
- **Pictures larger than 64 px, and logos.**

### `coga/new-window`

**What it detects.** A link that opens a new window or tab, by `target` or by an `onclick` that calls `window.open`, when none of these says so in English, Portuguese or Spanish:

- the words it shows;
- what assistive technology reads: the accessible name, visually hidden text, and the alternatives of its icons and images;
- its description: `aria-describedby`, `aria-description` or `title`.

The words accepted include "new tab", "new window", "opens in", "opens a", "nova aba", "nova janela", "nova guia", "abre em", "abre numa", "outra aba", "nueva pestaña", "nueva ventana" and "se abre en" (`NEW_WINDOW_WORDS` in `src/advisory/checks/new-window.ts`). "External link" is not accepted: it says where the link goes, not that it opens a window.

It rests on GAIA G22: "links que abrem em uma nova janela ou aba do navegador devem ser claramente indicados através de ícones ou indicativo textual." With it goes WCAG technique G201, which is advisory for 2.4.4, 2.4.6, 2.4.9 and 3.2.5. G201 warns that otherwise "their browser's "back" button will not work". No COGA pattern names a link the person follows. COGA o8p01 names "the automatic launching of new windows", which this is not, so the check cites no COGA pattern.

- **Grouping.** Links of one navigation, header, footer, aside or form make one result; the rest group by the main content or article. At most 10 results per page.
- **An icon with no text alternative.** GAIA accepts an icon as the indication, but nothing tells someone who does not see it. When the icon's classes or address name an external-link or new-window glyph, the link is reported at **low** confidence, below the default threshold, so `--verbose` shows it.

**Stays silent.** A link with the warning in its text, its visually hidden text, an icon's alternative, `aria-describedby` or `title`. A link with `target="_self"`, `_parent`, `_top`, or the name of a frame on the page. `mailto:`, `tel:` and `download` links. A link with no name, which is WCAG's (`link-name`).

### Beyond the target: WCAG 1.4.8 Visual Presentation (AAA)

1.4.8 asks that "a mechanism is available" for blocks of text to get lines of at most 80 characters, unjustified text and line spacing of at least 1.5, among other things. Its own note says "The mechanism can be provided by the browser or other user agent". So the profile never claims a page does not meet 1.4.8. It reports what the page's own styles give at the viewport measured, in one line, and says a mechanism may still provide the rest:

```
Beyond the target (WCAG 2.2 AAA; not part of the A/AA check)
  ◇ 1.4.8 Visual Presentation, at 1280×800 in the page's own styles: 2 blocks with lines over 80 characters,
    1 justified block, 17 blocks with line spacing under 1.5; a mechanism of the browser or the reader may still
    provide what 1.4.8 asks · experimental
```

The coverage says 1.4.8 was measured in the page's own styles. Paragraph spacing, colors chosen by the user and text resized to 200% without horizontal scrolling are the other parts of 1.4.8, and they are not measured.

### What is not checked here

- **Centered text, bold and letter or word spacing.** No source sets a limit Rampa could use.
- **Paragraph spacing.** WCAG 1.4.8 asks for 1.5 times the line spacing, but the collector does not measure the space between blocks.
- **Whether an icon is familiar, or the right one.** That depends on the audience (plan §1.5).
- **Sans-serif over serif.** GAIA prefers sans-serif, but COGA and WebAIM do not, and the evidence is contested.
- **Scripts that open windows without an inline `onclick`.** A listener added by script is not seen without running it.
- **The example page.** `examples/cognitive/cadastro.html` sets its text 40rem wide in `system-ui`. At 1280 px that is about 87 characters per line, so the page also gives a `coga/line-length` advisory.

## Reading an advisory

```
◇ Advisory · COGA o4p08 Accept different input formats (not a WCAG requirement) · barrier
  #cep
  The postal code field is type="number", made for quantities: it refuses "01310-100" as people usually
  write it (the hyphen), and the arrow keys or the mouse wheel can change the value. COGA recommends
  accepting the ways people write a value: a text field with inputmode="numeric" shows the same keypad.
  Evidence: <input id="cep" name="cep" type="number" autocomplete="postal-code">
  Patch:
    - <input id="cep" name="cep" type="number" autocomplete="postal-code">
    + <input id="cep" name="cep" type="text" autocomplete="postal-code" inputmode="numeric">
  confidence high · experimental · rule · id e3ae41a608ea
```

- **The label** comes from code, never from the check's text, and says what the advisory rests on.
- **experimental** in the last line says the check that wrote the advisory has not passed its evaluation yet (see the notice at the top of this page). It comes from the check's maturity, `maturity` in the JSON and SARIF reports.
- **Impact** says what the barrier does to the person, fixed per check and never chosen by a model. It is not a WCAG severity.

  | Impact | Means | Example |
  | --- | --- | --- |
  | barrier | may stop the task, or cost money or data | a CEP field that refuses "01310-100"; a pre-checked paid add-on |
  | hurdle | makes the task harder or more error-prone | a label that disappears while typing |
  | suggestion | improves understanding | an unexplained abbreviation in a paragraph |

- **Confidence** says how sure Rampa is of the fact: high for what the attributes say alone; medium for a `pattern` or a `maxlength` (a script may reformat what is typed, and Rampa does not type), for a field with a name nobody sees, or when the collector cut a long block of text. Advisories below `--min-confidence` are left out like findings, and `--verbose` shows them.
- **Evidence and facts** let anyone recompute the claim: the start tag, the compiled pattern and each value it refuses, the label or row text with the amount in « », the sentence of the first use and what was searched. The JSON report has all the facts.
- **Patches are suggestions.** The words on a page belong to whoever writes them; an expansion of an abbreviation is proposed only when the page itself or Rampa's list attests it.
- **Related**: a WCAG finding on the same element is linked by its id, never repeated.

### The model's one step

With a model (the default when one is available, or `--model`), and only for an abbreviation that neither the page nor the list expands, a model proposes what it stands for. The proposal is kept only when the initials of its words spell the abbreviation, and it is shown as "Suggestion to confirm", with the model's name and no patch. The model never decides whether an abbreviation is explained or whether people know it. Syllable acronyms (DETRAN, PRONATEC, REDESIM) never pass the initials check, so they never get a proposal. With `--no-llm` the step is skipped and the rest runs as usual.

### Beyond the target

Abbreviations more common than their full term (CPF, CEP, RG, ZIP, PIN; the list is in `src/advisory/abbreviations/lists.ts`) are not COGA advisories: the Note asks to explain an abbreviation "unless the abbreviation is more common than the full term". WCAG 3.1.4 Abbreviations (Level AAA) still asks for a way to find their expanded form, so they are reported in one line, beyond the target:

```
Beyond the target (WCAG 2.2 AAA; not part of the A/AA check)
  ◇ 3.1.4 Abbreviations: 2 abbreviations have no expanded form on this page: CPF ×2, CEP · experimental
```

AAA is beyond the A/AA target of a run, and W3C does not recommend requiring it for whole sites.

## Text measurements

The profile also measures the paragraph prose of the page, inside `main` or `article` when the page has them. The numbers are **context, never a verdict**: no advisory, no level, no pass or fail rests on them.

- Exact counts: words, sentences and paragraphs, the median and longest sentence (quoted), and lists written as prose (three or more items joined by commas, which COGA o3p05 asks to make a list). Sentences are split with `Intl.Segmenter`, without breaking after abbreviations such as "Sr.", "Av.", "e.g." or "U.S."; the ICU version is recorded with every result.
- English: paragraphs over 50 words (COGA §4.4.5) and sentences over 25 words (WCAG technique G153), then Flesch Reading Ease and the Flesch–Kincaid grade, on 100 words of prose or more. English syllables are counted by a heuristic, not by a pronouncing dictionary, and the report says so (`syllables: "heuristic"` in the JSON). The heuristic counts vowel groups, less a silent final e and the -es and -ed endings it takes to be silent.
  - **How close it is.** It was compared with the CMU Pronouncing Dictionary on 943 words of 4 to 15 letters, sampled from Rampa's English word list (`test/fixtures/coga/syllables-en.json`, built by `scripts/syllables-en-sample.py`; a test checks these numbers):
    - it gives the dictionary's count for 806 of them (85.5%);
    - it is within one syllable for 942;
    - it counts 2.4% fewer syllables in all. It counts too few in 94 words, more than half of them by dropping a spoken -ed or -es (crowded, blushes), most of the rest by reading two vowels as one (being, video). It counts too many in 43, mostly compounds with a silent e inside (timeline, lifelong).
  - **What that does to the formulas.** Fewer syllables make Flesch Reading Ease read a little easier and the grade a little lower. At this sample's rate, 0.055 syllables fewer per word, that is about 4.7 points of reading ease and 0.65 of a grade. Running prose moves less: the sample has no words under four letters, which the heuristic counts as one syllable, and most are.
  - **Context, not a verdict.** This is one more reason Flesch–Kincaid is shown as context: no advisory and no level rests on it.
- Portuguese: the Flesch adaptation of Martins, Ghiraldelo, Nunes and Oliveira Jr. (1996), with its four bands (100–75 very easy, 75–50 easy, 50–25 fairly difficult, 25–0 very difficult), on 100 words of prose or more. It was validated only as an ordering of textbook passages by school grade, and its authors say it measures "readability and not the comprehensibility": the report prints that caveat every time. No Portuguese grade level is computed. Syllables are counted by rule, with the hiatus convention schools teach (his-tó-ri-a). The rules match a hand-counted list of 200 words (`test/fixtures/coga/syllables-pt.json`), which leaves out on purpose the words whose split depends on stress or a prefix.
- Other languages: counts only.

WCAG 3.1.5 Reading Level is listed in the coverage as needing a qualified reviewer, with these measurements attached for that reviewer.

## Coverage

Every report with the profile on says what was screened and what was not:

```
Cognitive profile (W3C COGA guidance; advisory, not WCAG conformance):
  Screened in part: 4 of 58 design patterns: o3p01 Use Clear Words (abbreviations), o4p03 Notify Users of Fees and
  Charges at the Start of a Task (pre-checked paid options), o4p06 Use Clear Visible Labels (placeholder-only labels),
  o4p08 Accept different input formats (static field attributes).
  Not checked: 54 patterns, and the rest of the ones screened in part (--verbose lists them).
  Beyond the A/AA target: WCAG 2.2 3.1.4 Abbreviations (AAA) checked; 3.1.5 Reading Level needs a qualified reviewer.
Testing with people should include people with cognitive and learning disabilities (COGA §5).
```

A pattern is never marked "passed" or "met": the Note defines no conformance, and "screened" means only that some sub-checks ran. With the profile off, a web report says in one line that COGA guidance was not screened.

These lines come after the WCAG coverage of the run (the coverage rows and each criterion's status, described in [WCAG 2.2](wcag-2-2.md)), in every format. The profile adds no method to a WCAG criterion and changes no criterion's status: its 3.1.4 and 3.1.5 are AAA, outside the A/AA target of a run whether it targets WCAG 2.2 or 2.1. Its `needsReview` (3.1.5) is a list of criteria, apart from the report's `needsReview`, which lists elements axe-core or Rampa's rules could not decide.

## In each output

| Output | Advisories |
| --- | --- |
| Terminal | Their own section after the WCAG findings, grouped by check and ordered by impact, at most 3 elements per check and 20 per page without `--verbose`; then the text measurements; then the profile's lines in the coverage. Marked ◇, never ✗. The section opens with the experimental notice, and each advisory of an experimental check is tagged `experimental`, as is the beyond-target line. |
| JSON | `report.advisory`: `results`, `belowThreshold`, `waived`, `checks` (what ran and why not, with each check's `maturity`), `coverage.patterns` (all 58, by slug), `coverage.gaia` (the GAIA recommendations the checks cite), `notes`, `textMetrics`. Each result has the `maturity` of its check. `schemaVersion` stays 1: a reader that does not know `advisory` ignores it. |
| Markdown | A collapsed section, "Advisories (not WCAG requirements)", counted apart from the findings, with the same notice and tags as the terminal. When a pull request comment must fit its size limit, advisories are dropped first. |
| HTML | A section with its own heading after the findings, with the same notice and tags as the terminal; each group links to the COGA pattern page and its section of the W3C Note. |
| SARIF | Rules `coga/<check>` (and `wcag-aaa/3.1.4` and `wcag-aaa/1.4.8` beyond the target) at level `note`, tagged `not-wcag`, and `coga`, `gaia` or `webaim` after what the advisory rests on; every result is a `note`, whatever its confidence. Results and rules carry `maturity` and `experimental` in their properties, and an experimental check's rule is also tagged `experimental`. |
| Exit code | Only `--fail-on advisory` counts them, together with the confirmed findings. |
| Waivers | Same file and command as findings: `rampa waive <id>`. The `coga/` prefix keeps the ids apart. |
| Baseline, `toPassRampa`, MCP | Unaffected: they read findings only. The MCP tools do not run the profile yet. |
| `--crawl` | Each page's JSON report has its advisories; the site view counts them per page. |

## Dictionaries

To tell a word in capitals (ENTRAR) from an acronym (CPF), the abbreviation check reads the Hunspell dictionaries for pt-BR (VERO) and en-US (SCOWL). Like the ACT test cases of `rampa eval`, they are downloaded at run time from LibreOffice's dictionary repository at a pinned commit, checked against pinned SHA-256 hashes, kept in `.rampa/dictionaries`, and never redistributed with Rampa. Without a dictionary (no network on the first run, say), the check says it did not run for that language and why, instead of guessing; the other checks run as usual. An entry written in capitals in the dictionary (NASA) stays an acronym. Some acronyms are also words or names (SUS, NIS, DETRAN): the curated list wins over the dictionary for them, and the rest are missed rather than flagged.

## What the profile is not

- **Not COGA conformance.** There is none. A few of the 58 patterns are screened, each only in part (the coverage lines name them); the rest needs review and testing with people.
- **Not a reading-level verdict.** Formulas count word and sentence length; they do not measure whether people understand a text.
- **Not a judgment of clarity or familiarity.** No check says a word is hard, a layout unfamiliar or a text "simple enough": those depend on the audience, and a model's opinion is not evidence.
- **Not an overlay.** It reads the page and never clicks, types or submits.
- **Not yet validated.** The checks are marked `experimental`, in `report.advisory.checks`, on each result and in every output. Each has pass and fail fixtures (`test/fixtures/coga/<check>/`) with the results they must give. The rest of the gate the plan requires before a check is called stable (docs/plans/cognitive-profile.md §4.2) is not built yet: the corrupted pairs, and the evaluation on real pages labelled by annotators (work item WI-10). Please report what looks wrong.

## Known limits

- Web pages only, in Portuguese and English. Text in other languages is counted but not screened for abbreviations.
- Rampa does not type into fields: a mask that reformats "01310-100" before validation makes a pattern advisory moot, which is why those are medium confidence. Wave 2 adds a typing probe.
- Abbreviations: dotted abbreviations (nº, p. ex., e.g.) and camel-case names outside the list are not screened. The curated lists are a seed, pending review by a plain-language editor. An abbreviation is reported once per page, at its first use.
- A long block the collector cut (over 20,000 characters) lowers confidence to medium: an explanation could sit past the cut. A page with more than 5,000 elements is not screened for abbreviations at all.
- The Portuguese pattern titles are Rampa's own, unofficial translation; the English title and the link go with them.

## Sources

### The guidance the profile draws on

None of these sources is a WCAG requirement, and none defines a conformance that a page could meet.

- **W3C, *Making Content Usable for People with Cognitive and Learning Disabilities* (COGA Content Usable).** Working Group Note, 29 April 2021: https://www.w3.org/TR/coga-usable/.
  - Its 58 design patterns are also published as WAI supplemental guidance (https://www.w3.org/WAI/WCAG2/supplemental/), with one page per pattern under https://www.w3.org/WAI/WCAG2/supplemental/patterns/.
  - It is not normative. Its abstract says: "Following this guidance is not required for conformance to WCAG".
  - Its status section says: "It is inappropriate to cite this document as other than work in progress." The task force is rewriting the patterns, so every advisory records the version it was written against (`coga-usable 2021-04-29`).
- **W3C, *Cognitive Accessibility User Research*.** First Public Working Draft, 15 January 2015: https://www.w3.org/TR/coga-user-research/.
  - It was never finished, and it too must not be cited "as other than work in progress".
  - It is background for this profile: no check rests on it.
- **GAIA, *Guia de Acessibilidade de Interfaces para Autismo*.** https://gaia.wiki.br/: 28 recommendations, G01 to G28. It is a guide, not a checker.
  - It comes from Talita Cristina Pagani Britto's master's dissertation: *GAIA: uma proposta de guia de recomendações de acessibilidade web com foco em aspectos do autismo*, Universidade Federal de São Carlos (UFSCar), 2016, advised by Ednaldo Brigante Pizzolato, https://repositorio.ufscar.br/handle/20.500.14289/8683.
  - It was published as Britto, T. C. P. and Pizzolato, E. B. (2018), "GAIA: uma proposta de um guia de recomendações de acessibilidade de interfaces Web com foco em aspectos do Autismo", *Revista Brasileira de Informática na Educação* 26(2), 102–123, doi:[10.5753/RBIE.2018.26.02.102](https://doi.org/10.5753/RBIE.2018.26.02.102).
  - Read it with its limits:
    - it is written for autistic children, and for multitouch devices;
    - it was piloted with 6 IT professionals, not with autistic users;
    - 16 of its 28 recommendations cite WebAIM's WAVE cognitive checklist, so GAIA and WebAIM are related sources, not independent ones;
    - it gives no mapping to WCAG. Where the plan maps a GAIA recommendation to a WCAG criterion or a COGA pattern (its Appendix A), the mapping is Rampa's, not GAIA's.
- **WebAIM's cognitive series.** *Cognitive Disabilities* (https://webaim.org/articles/cognitive/) and *Evaluating Cognitive Web Accessibility* (https://webaim.org/articles/evaluatingcognitive/).
  - It has no guidance specific to autism. It sorts barriers by function rather than by diagnosis: memory, problem-solving, attention, reading and verbal comprehension, math, and visual comprehension.
  - On evaluation it says: "For the most part, cognitive web accessibility is one of those "you know it when you see it" things. Common sense, holistic evaluation, and user testing should predominantly guide cognitive web accessibility evaluation."

### Why advisories, not failures

The sources themselves rule out a pass or fail. COGA Content Usable is outside WCAG conformance, and it warns against leaning on tools (§5.1): "automated testing often cannot assess if people with a cognitive or learning disability can use the content. It is vital for people with cognitive and learning disabilities that development teams do not rely solely on automated accessibility testing." WebAIM says that evaluation is mostly "you know it when you see it". So each check reports a fact anyone can recompute, such as a field's type, a pre-checked price or a label that is only a placeholder. It names the sentence of the pattern that fact touches, and leaves the judgment to a person. The coverage lists what was not screened, and the profile points to testing with people, including people with cognitive and learning disabilities (COGA §5).

### Other references

- WCAG 2.2 Understanding 3.1.4 Abbreviations: https://www.w3.org/WAI/WCAG22/Understanding/abbreviations.html; 3.1.5 Reading Level: https://www.w3.org/WAI/WCAG22/Understanding/reading-level.html; technique G153: https://www.w3.org/WAI/WCAG22/Techniques/general/G153.
- HTML, the pattern attribute (compiled with the `v` flag): https://html.spec.whatwg.org/multipage/input.html#the-pattern-attribute.
- GOV.UK Design System on number inputs: https://technology.blog.gov.uk/2020/02/24/why-the-gov-uk-design-system-team-changed-the-input-type-for-numbers/.
- Schwartz, A. S. and Hearst, M. A. (2003), A simple algorithm for identifying abbreviation definitions in biomedical text: https://psb.stanford.edu/psb-online/proceedings/psb03/schwartz.pdf.
- Martins, Ghiraldelo, Nunes and Oliveira Jr. (1996), Readability Formulas Applied to Textbooks in Brazilian Portuguese, Notas do ICMSC-USP nº 28: https://repositorio.usp.br/item/000906089.
- Kincaid et al. (1975): https://apps.dtic.mil/sti/pdfs/ADA006655.pdf.
- Lei nº 15.263/2025, art. 5º, VIII: https://www.planalto.gov.br/ccivil_03/_Ato2023-2026/2025/Lei/L15263.htm.
- WCAG 2.2 Understanding 1.4.8 Visual Presentation: https://www.w3.org/WAI/WCAG22/Understanding/visual-presentation.html; technique G201, Giving users advanced warning when opening a new window: https://www.w3.org/WAI/WCAG22/Techniques/general/G201.
- GAIA G03 Legibilidade: https://gaia.wiki.br/vocabulario-visual-e-textual/legibilidade; G09 Eliminar distrações: https://gaia.wiki.br/engajamento/eliminar-distracoes; G14 Equivalentes textuais: https://gaia.wiki.br/representacoes-redundantes/equivalentes-textuais; G22 Consistência: https://gaia.wiki.br/reconhecimento-e-previsibilidade/.
- Harley, A. (2014), Icon Usability, Nielsen Norman Group: https://www.nngroup.com/articles/icon-usability/.
- The design plan: [docs/plans/cognitive-profile.md](plans/cognitive-profile.md).

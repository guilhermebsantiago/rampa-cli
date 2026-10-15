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

Four checks, each tied to a sentence of a COGA pattern, and each screening only part of that pattern. Rules decide every fact; a model never decides whether something is a problem.

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

## Checks that watch the live page: motion, interruptions, layout shifts and paste

Four more checks need the page running, not only its snapshot. They come from observing the live page with no input, and they matter most for sensory load, which COGA's autistic persona describes (§6.2.2: "animations and videos that play automatically cause problems for Amy. Sometimes, the movement can be very distracting and the sounds alarming"), and for things that move or appear while a person works. Like every check of the profile they are advisories, from W3C COGA guidance and, where cited, GAIA, never WCAG failures, and all four are experimental.

### When the page is watched

- **The trigger.** With `--profile cognitive`, every URL and HTML file that `rampa check` loads gets the observation: the probe kind `cognitive` ([probes](probes.md#the-cognitive-observation---probe-cognitive-read-by---profile-cognitive)), added on top of any `--probe`. `check()` from code does the same. `--probe cognitive` records it without the profile, to save and replay later. It is never part of `--probe all`.
- **What happens.** The page is loaded twice at the same time, in two fresh browser contexts: once with `prefers-reduced-motion: no-preference` (the run's other settings kept), and once with `reduce`. For a window after each load event, 8 s by default, nothing is clicked, typed, scrolled or focused. An init script, which runs before the page's own scripts, records what the page does by itself. At the end the paste test dispatches events on the page, with no request (below).
- **No user activation.** Rampa reads the page over the DevTools protocol without a user gesture. Playwright's own `evaluate` would give the page user activation, and with it the right to start sound or ask for permissions. So a permission request or a sound recorded while `navigator.userActivation.hasBeenActive` is false came with no input at all. A `--wait-for` selector is the exception: waiting for it gives activation, and requests after that are not counted.
- **The network guard** is armed once each load has fired, as for every probe. From then on nothing the page does in the window writes to a server: writes, beacons and sockets are blocked, navigations and new windows are answered locally, and `alert`, `confirm` and `prompt` are dismissed. Permission requests are recorded and answered as when a person closes the prompt, never granted. The images whose frames are read come from the bytes the browser already received; nothing is fetched again.
- **Time.** `coga.observe` in the config sets the window in seconds, and `0` (or `false`) turns the observation off. `--fast` shortens the window to 3 s unless `coga.observe` sets it. A `--crawl` does not watch its pages yet, and neither does `checkPage` from the Playwright integration, which checks a page the test already drives. Their four checks say they did not run, and why.
- **Replay.** The facts go into the snapshot (`observations.probes`, kind `cognitive`, variants `observe` and `reduce`), so `rampa check page.snapshot.json --profile cognitive` gives the same advisories offline, with no browser. A snapshot saved without the observation says in the coverage that these checks did not run: "the live page was not observed".

```ts
export default defineConfig({
  profiles: ['cognitive'],
  coga: { observe: 8 }, // seconds the live page is watched after it loads; 0 turns the observation off
})
```

### The four checks

| Check | Basis | What it reports | Impact |
| --- | --- | --- | --- |
| `coga/reduced-motion` | COGA o8p01 Let Users Control When the Content Moves or Changes; GAIA G09; WCAG 2.3.3 (AAA) beyond the target, as a note | Motion that keeps running with `prefers-reduced-motion: reduce`, the setting people make once in their operating system: CSS, script and SVG animations that repeat with no end or last more than 5 s; videos that play on their own and loop, stream live or last more than 5 s; animated GIF, APNG and WebP images; carousels that move to another slide on their own. Each says whether it ran the same way without the setting ("the page does not respond to the setting here") or only with it, with the animation's name, cycle and length, the video's loop and length, the image's format and loop count, or when the carousel moved | hurdle when it never stops and runs without the setting too; suggestion when it ends, or shows only with the setting |
| `coga/interruptions` | COGA o5p01 Limit Interruptions (and o8p01 for pop-ups and new windows); GAIA G09, G18 for sound | With no input: a dialog that appears (`role=dialog` or `alertdialog`, an open `<dialog>`, `aria-modal`) when it is modal, covers a quarter of the window or floats over the page; a fixed or sticky layer over a quarter of the window or more with page content under it; a message that floats in after the load (a toast, a chat greeting, a slide-in offer); an `alert`, `confirm` or `prompt` box; a new window; a permission request (notifications, location, camera, microphone, clipboard); audio or video that starts with sound, or tries to and is stopped by the browser; a carousel that moves on its own. Each with when it appeared and a sample of its text | hurdle; suggestion for a floating message, a consent banner and a carousel |
| `coga/layout-shift` | COGA o4p01 Ensure Controls and Content Do Not Move Unexpectedly | A layout shift with no input, during the load or the window, that scores 0.05 or more, or that moves a link or a control (or what holds one) by 24 px or more. Each with the element that moved most, its box before and after, how far and which way, the shift's score and its session's | hurdle when it moves links or controls; suggestion when it moves only text or images |
| `coga/paste-blocked` | COGA o8p02 Enable APIs and Extensions; o6p01 for password and code fields | A text field (passwords and one-time codes included) that cancels a paste: a paste event, or the `beforeinput` of a paste, carrying a dummy value, cancelled with no field changed after it; a field that cancels copy; the page cancelling copy or the context menu on its text; `user-select: none` on half its text or more. With what the page said, when it answered with an alert box | barrier for a password or code field; hurdle otherwise; suggestion for the context menu |

### Thresholds, and why

- **5 s for motion.** An animation or a video that ends within 5 s is over before a person could stop it: the line WCAG 2.2.2 draws for moving content. One with no end, or longer, keeps running in front of the person. Color-only animations are left out: no movement and no blinking, and the setting is about motion. So are elements under 8×8 px (a dot) and hidden ones. An animated element inside another one that also moves is one motion (a spinner of three rings). One animation on several elements is one advisory that names the others (a row of cards that pulse alike).
- **Carousels.** A carousel is found by its role or the class names sliders use (`carousel`, `swiper`, `slick`, `splide`, `glide`…), and it moves when the slides that show change. A change within the first second after the load event is the slider setting itself up, and is not counted. A carousel that keeps moving under reduced motion is reported once, by `coga/reduced-motion`. One that stops there is reported by `coga/interruptions`.
- **A quarter of the window.** A layer that covers 25% of the window or more, with page content under it, covers the page: the same line the activate-class harness uses for a layer (docs/probes.md). A full-screen app shell has no content under it, and a sticky header or a sidebar is not over anything, so neither is reported. A dialog or layer must show in two samples, 300 ms apart, so a flash while the page builds itself does not count.
- **Consent banners.** They are common, and often required by law (LGPD, GDPR). One that is modal or covers a quarter of the window is noted apart, at a lower impact. A small cookie bar is left out on purpose: it does not stop the task, and reporting every one would bury the rest.
- **0.05 for a layout shift.** Google rates a page's Cumulative Layout Shift good up to 0.1, for its worst burst of shifts. One shift at 0.05 spends half of that alone: content that fills the window moved by 5% of its height, 40 px on an 800 px window. Smaller scores are mostly images and fonts settling by a few pixels, and would flood. Shifts are grouped in session windows, as CLS groups them (less than 1 s apart, at most 5 s), and one advisory goes to each.
- **24 px for a control.** A score weighs the area that moved, so one button pushed aside scores next to nothing. Yet COGA's example is exactly that: "As the user is about to touch the phone number, it shifts down". 24 CSS px is the minimum target size of WCAG 2.5.8, so a control moved that far may leave a click aimed at it on something else. Shifts reported only this way are medium confidence.
- **Paste.** A handler that cancels the paste in order to insert the value itself (trimmed, reformatted, spread across the boxes of a code) changes a field, so it is not reported. Neither is one that reads the clipboard instead of the event. Three fields or more that all cancel are one advisory: a script cancels every paste on the page. Rampa dispatched the events itself, as a real Ctrl+V would mean typing into the page, so paste and copy are medium confidence.
- **Unselectable text.** At least half of the page's text blocks (paragraphs, list items, cells, headings), and 200 characters at least. `user-select: none` on buttons and menus alone is normal, and stays silent.
- **At most 8 advisories per check and page**, those that matter most first. Layout shifts stop at 5 sessions, one per element.

### What stays silent, on purpose

The pass fixtures in `test/fixtures/coga/` hold one page for each of these:

- **Reduced motion:** a short hover transition; a spinner, and a carousel, that stop under `reduce`; an entrance animation that ends; a color that pulses; a `<picture>` that swaps its GIF for a still image under `reduce`.
- **Interruptions:** a page where nothing happens; a small cookie bar; a full-screen app shell; a `<dialog open>` in the flow of the page; a muted video; a permission asked only when a button is pressed.
- **Layout shift:** content loaded into space kept for it; a shift of a few pixels; an element moved with `transform`, which moves nothing else; content added below everything else.
- **Paste:** a plain form; a field that tidies what is pasted; a code in six boxes that a paste fills; a copy that adds a source line; text where only buttons and menus are unselectable.

Sign-in fields overlap WCAG 3.3.8, which the authentication probe (`--probe auth`) checks with a real Ctrl+V. A field with a 3.3.8 finding in the same run is left to it, and a field where that real paste arrived is not reported. Either way, a note in the advisory section says so. A WCAG finding on the same element as an advisory is linked by its id, as for every advisory.

### What it costs

Measured on 2026-10-15 with Edge 155, headless, on the author's machine. Each figure is the wall time of `rampa check <target> --no-llm --timings`, without the profile, with it, and with it and `--fast`:

| Target | Without the profile | With it | Added | With `--fast` | Added |
| --- | --- | --- | --- | --- | --- |
| `test/fixtures/coga/interruptions/fail/newsletter.html` | 2.1 s | 10.4 s | 8.3 s | 5.4 s | 3.3 s |
| `test/fixtures/coga/reduced-motion/pass/respects.html` | 2.1 s | 10.4 s | 8.3 s | 5.5 s | 3.4 s |
| `examples/cognitive/cadastro.html` | 2.5 s | 11.6 s | 9.1 s | 6.4 s | 3.9 s |
| www.bbc.com/news | 6.2 s | 16.0 s | 9.8 s | 10.1 s | 3.9 s |
| g1.globo.com | 11.8 s | 29.0 s | 17.2 s | 19.7 s | 7.9 s |

The observation itself takes the page's own load time plus the window: about 8.2 s on a local file (3.2 s with `--fast`), and 9.3 s and 11.8 s on the two news pages, whose load events came late. The rest of the difference on real pages is the network: the same page loaded twice in a row is rarely as fast twice. Both loads run at the same time, so a page's load time counts once.

### Limits

- **One window, one load each.** A pop-up that comes after 8 s, or after a scroll, an exit intent or a second page view, is not seen. A carousel that moves every 8 s or more may not move in the window, nor one every 3 s or more with `--fast`. Timings vary from run to run, and so do layout shifts.
- **Nothing is scrolled.** Lazy content below the fold stays a placeholder: a loading shimmer there keeps running and is reported, though a person who scrolls would see it replaced.
- **Carousels are found by name.** A slider with no carousel role and no usual class name is not followed. The motion probe (`--probe motion`, WCAG 2.2.2) watches the pixels instead.
- **Sound.** Audio is the `audio` and `video` elements, and `Audio()` objects a script plays. The Web Audio API is not watched, as pages use it to fingerprint browsers too. When the browser's autoplay policy stops a video before any sound is decoded, Rampa cannot tell whether it has a sound track: that advisory is low confidence, below the default threshold.
- **Images.** At most 10 images on show, and only GIF, PNG and WebP responses are read. CSS background images are not read.
- **The top document only.** Dialogs and layers inside frames are not seen.
- **The paste test** dispatches events, not a real Ctrl+V: a page that checks `isTrusted`, or changes a field later on a timer, is not seen as cancelling. The authentication probe's real paste is the stronger evidence on sign-in pages.
- **Not checked by these checks:** whether an interruption is an emergency, which COGA allows; whether a page offers its own way to pause, which COGA also accepts; and whether the content that moves is essential.

### Sources for these checks

- COGA, *Making Content Usable*, 29 April 2021: o8p01 (§4.9.1), Avoid "Content that changes without the user having control", and its "easily available" mechanism that "can be set one time with as a wide a scope as possible (such as using the standards of the Operating System (OS)…)"; o5p01 (§4.6.1), Avoid "Content that interrupts the user from completing their task" and "A pop up suggesting the user subscribers to the site. The pop up must be closed for the user to continue." (the Note's own wording); o4p01 (§4.5.1), Avoid "Controls and content that move without the user’s request"; o8p02 (§4.9.2), "sometimes a web site stops extensions and APIs from working. The result is that these users cannot use this web site."; o6p01 (§4.7.1), Avoid "Using a password and not allowing pasting into the field."; persona Amy, §6.2.2.
- GAIA, Guia de Acessibilidade de Interfaces para Autismo (Britto, UFSCar, 2016; https://gaia.wiki.br/): G09 Eliminar distrações, "Caso você inclua elementos com animações, que brilham, piscam ou sons de fundo, ofereça formas de desabilitar ou esconder tais conteúdos" (https://gaia.wiki.br/engajamento/eliminar-distracoes); G18 Evite sons perturbadores (https://gaia.wiki.br/multimidia/evite-sons-perturbadores). GAIA targets autistic children on touch devices, was piloted with IT professionals rather than autistic users, and states no WCAG mapping.
- Media Queries Level 5, `prefers-reduced-motion`: https://www.w3.org/TR/mediaqueries-5/#prefers-reduced-motion.
- Layout Instability API: https://wicg.github.io/layout-instability/; Cumulative Layout Shift and its thresholds: https://web.dev/articles/cls.
- WCAG 2.2 Understanding 2.2.2 Pause, Stop, Hide (the five seconds): https://www.w3.org/WAI/WCAG22/Understanding/pause-stop-hide.html; 2.3.3 Animation from Interactions: https://www.w3.org/WAI/WCAG22/Understanding/animation-from-interactions.html; 2.5.8 Target Size (Minimum): https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html.
- HTML, user activation: https://html.spec.whatwg.org/multipage/interaction.html#tracking-user-activation.

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
| JSON | `report.advisory`: `results`, `belowThreshold`, `waived`, `checks` (what ran and why not, with each check's `maturity`), `coverage.patterns` (all 58, by slug), `notes`, `textMetrics`. Each result has the `maturity` of its check. `schemaVersion` stays 1: a reader that does not know `advisory` ignores it. |
| Markdown | A collapsed section, "Advisories (not WCAG requirements)", counted apart from the findings, with the same notice and tags as the terminal. When a pull request comment must fit its size limit, advisories are dropped first. |
| HTML | A section with its own heading after the findings, with the same notice and tags as the terminal; each group links to the COGA pattern page and its section of the W3C Note. |
| SARIF | Rules `coga/<check>` (and `wcag-aaa/3.1.4` beyond the target) at level `note`, tagged `not-wcag`; every result is a `note`, whatever its confidence. Results and rules carry `maturity` and `experimental` in their properties, and an experimental check's rule is also tagged `experimental`. |
| Exit code | Only `--fail-on advisory` counts them, together with the confirmed findings. |
| Waivers | Same file and command as findings: `rampa waive <id>`. The `coga/` prefix keeps the ids apart. |
| Baseline, `toPassRampa`, MCP | Unaffected: they read findings only. The MCP tools do not run the profile yet. |
| `--crawl` | Each page's JSON report has its advisories; the site view counts them per page. |

## Dictionaries

To tell a word in capitals (ENTRAR) from an acronym (CPF), the abbreviation check reads the Hunspell dictionaries for pt-BR (VERO) and en-US (SCOWL). Like the ACT test cases of `rampa eval`, they are downloaded at run time from LibreOffice's dictionary repository at a pinned commit, checked against pinned SHA-256 hashes, kept in `.rampa/dictionaries`, and never redistributed with Rampa. Without a dictionary (no network on the first run, say), the check says it did not run for that language and why, instead of guessing; the other checks run as usual. An entry written in capitals in the dictionary (NASA) stays an acronym. Some acronyms are also words or names (SUS, NIS, DETRAN): the curated list wins over the dictionary for them, and the rest are missed rather than flagged.

## What the profile is not

- **Not COGA conformance.** There is none. Four of 58 patterns are screened, each only in part; the rest needs review and testing with people.
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
- The design plan: [docs/plans/cognitive-profile.md](plans/cognitive-profile.md).

# Probes

A probe drives a web page after Rampa has collected it, behind a network guard, and records what it saw. Rules then turn those facts into findings. This is how Rampa checks criteria that no static scan can: what happens when the page is narrowed to 320 CSS px, when text spacing is raised, when someone moves through it with the keyboard.

```
target ─► collect (snapshot + axe) ─► probes (--probe) ─► rules and criteria ─► report
                                         │                      ▲
                                         └─ snapshot.observations ─┘   (rules read only the snapshot)
```

Probes are **off by default**. Turn them on per run:

```sh
rampa check https://example.com --probe all          # layout, keyboard, hover, orientation, shortcuts, media, color and states
rampa check page.html --probe layout                 # reflow (1.4.10), text spacing (1.4.12), 200% zoom (1.4.4)
rampa check page.html --probe keyboard               # 2.1.1, 2.1.2, 3.2.1, 2.4.7, 2.4.11, and skip links (2.4.1)
rampa check page.html --probe hover                  # content on hover or focus (1.4.13)
rampa check page.html --probe orientation            # portrait and landscape (1.3.4)
rampa check page.html --probe shortcuts              # single character key shortcuts (2.1.4)
rampa check page.html --probe media                  # audio and video: captions, alternatives, sound on load (1.2.1–1.2.5, 1.4.2)
rampa check page.html --probe color                  # use of color: current items, required fields, links in text, color words (1.4.1)
rampa check page.html --probe states                 # contrast in hover, focus and selected states (1.4.3, 1.4.11); with keyboard, focus indicators too
rampa check https://example.com --probe variants     # state variants: carousels on a fake clock (1.1.1, F20), other language versions (3.1.1); never part of all
rampa check https://example.com/login --probe auth   # sign-in and recovery: trusted paste, keypads, F109, CAPTCHAs (3.3.8); never part of all
rampa check page.html --probe flash                  # general and red flashes in the window, animated images and video (2.3.1); never part of all
rampa check page.html --probe links                  # clicks scripted links and records where they lead, for 2.4.4; never part of all
rampa check page.html --probe input                  # changes each form control on a fresh load (3.2.2); never part of all
rampa check page.html --probe interact               # the activate class: shortcuts, links and input
rampa check page.html --probe all --save .rampa/rec  # keep the observations to replay offline
rampa check android: --probe keyboard,layout,orientation   # an Android screen over adb: Tab walk, text at 200%, rotation (app screens, below)
rampa check sign-in-orientation.json                        # an XCUITest export with probe steps: orientation, text size (app screens, below)
```

Why off: each probe loads the page again, and the keyboard walk takes screenshots at every Tab stop, so a probed page costs seconds to tens of seconds more than an unprobed one. The plan ([wcag-coverage.md](plans/wcag-coverage.md), 4.6) makes each kind a default only after it passes the evaluation gate and its cost is measured on real pages. `--probe` works with `rampa check` on URLs and HTML files, on Android screens (`android:`) and on XCUITest exports ([app screens](#app-screens-android-and-ios)); it does not run with `--crawl` yet.

## What a probe may do

Every probe but those of the activate class (shortcuts, links and input, below) is in the **observe** class:

- it presses Tab, Shift+Tab and Esc, and the arrow keys only to try to leave a suspected keyboard trap;
- it resizes the viewport, changes the device scale factor (200% zoom) and injects CSS;
- it moves focus away with `blur()` to compare a focused element with its unfocused self, and gives it back with `focus()`;
- it moves the pointer, gives an element focus with `focus()` to see what shows, and scrolls an element into view;
- it jumps Playwright's fake clock forward (the hover probe installs it before the page loads; time otherwise flows as usual);
- it turns the window between portrait and landscape and sets the screen orientation over the DevTools protocol, with a `window.orientation` shim where the browser has none (the orientation probe); it reads the web app manifest with a GET and runs axe-core's experimental css-orientation-lock in the probe page;
- it focuses the page's `body` for a moment before the walk, so the first Tab starts at the top of the page;
- it presses Enter on a link whose address is the page itself plus a fragment that names an element of the page (a skip link, `#main`), at most three such links among the first eight Tab stops, each from a fresh start at the top (the skip-link probe, 2.4.1); never on a link to another page, a route of a single-page app (`#/about`), a button, or anything in a form;
- it pauses Playwright's fake clock and moves it in steps of 16 ms, pausing CSS and SVG animations and setting them to each instant, while it captures the window (the flash probe); it fetches the page's animated images once more with GET to decode their frames, and plays its videos muted for 3 s to read their frames, then pauses them;
- it plays audio and video muted for a few seconds, makes their text tracks load, and reads their sound from a copy of their stream; it pauses them and puts their time, muted state and track modes back afterwards (the media probe). It never unmutes anything. For that probe the browser starts with `--autoplay-policy=no-user-gesture-required`, as a browser that lets pages play sound on load does; Playwright starts headless browsers with `--mute-audio`, so no sound reaches the speakers;
- it changes the colors of one element for a single capture, the peer's colors put on it, and puts them back (the color probe);
- it takes the marks of a selected or current item off for two captures (an `aria-current`, `aria-selected`, `aria-pressed` or `aria-checked` attribute set to false or removed, a state class such as `active` removed) and puts them back right after (the states probe);
- it jumps the fake clock forward in steps so carousels and scripts that swap pictures move on by themselves, makes a carousel's slides that never showed visible one at a time for a capture (as the image captures of 1.1.1 do) and puts them back, and loads up to four other language versions of the page, each with a GET in its own context behind its own guard (the state-variants probe, which runs only with `--probe variants`, never with `all`);
- it pastes a dummy value into the password and code fields of sign-in and recovery forms with the real Ctrl+V, types one key when the paste did not arrive, and puts the field's value back (the authentication probe, which runs only with `--probe auth`, never with `all`);
- it never clicks, never presses Enter or Space on a control (Enter on an in-page link, above, is the one exception the plan's observe class allows), never types (but for the one key of the authentication probe, above), and never submits a form.

The shortcuts probe (`--probe shortcuts`, 2.1.4) is the first of the plan's **activate** class; the links probe (`--probe links`, 2.4.4) and the on-input probe (`--probe input`, 3.2.2), below, are built on the activate-class harness. With focus on the page's `body`, it presses each printable key on its own (letters, digits, punctuation and symbols, then capitals; never Space, which scrolls), and a key may do whatever the page bound it to. Then it presses Space on the checkboxes, switches and radios it found named for shortcuts or keys, to toggle them, presses the keys again, and toggles them back. It never clicks, never presses Enter, never types into a field (focus goes back to the body before every key, and if a script keeps a field focused the probe stops pressing), never changes a select, and the network guard is on the whole time, so a key that posts something (archive, delete, send) is blocked and a key that navigates is answered locally. A GET a key sets off still reaches the server; run it on pages where that is harmless, as with every probe.

### The activate-class harness

`src/probes/activate.ts` is what every probe that clicks, changes a setting or types goes through (the plan's C1, section 4.4). It generalizes what the shortcuts probe does (a change watch whose noise is learned in a wait with no input, the guard on all along) and adds:

- **A skip list.** A control is never touched when its name, label, title or value holds a destructive, transactional, account-changing or consent word, in English, Portuguese or Spanish (`delete`, `remove`, `buy`, `pay`, `checkout`, `sign out`, `logout`, `unsubscribe`, `submit`, `send`, `confirm`, `accept`, `save`…; `excluir`, `remover`, `comprar`, `pagar`, `sair`, `cancelar assinatura`, `enviar`, `aceitar`…; `eliminar`, `borrar`, `comprar`, `pagar`, `cerrar sesión`, `darse de baja`, `enviar`, `aceptar`…), or when its code does (`deleteItem(3)`, `btn-logout`, `javascript:removeItem(3)`; only unambiguous verbs, so an analytics call such as `ga('send', …)` is no reason to skip). Also left alone: submit buttons (and a button with no type inside a form), anything inside a form that holds a password, file or payment (`autocomplete="cc-…"`) field, a `data-method` other than GET, downloads (`download`, or an address that ends in a file extension), new windows (`target`), addresses on another origin, disabled controls, password and file fields. Each skip is logged with its reason and the word.
- **A budget** of controls and of time per page: 30 controls and 90 s for the links probe, 40 controls and 180 s for the on-input probe.
- **A fresh page after each change** (or before every control, as the on-input probe asks). Once an activation changed anything (the DOM outside the noise, the address beyond its fragment, storage or cookies, focus lost, a dialog or layer shown), the next control gets a fresh page in a new browser context, so neither the page nor its storage carries the effect over. An activation whose navigation was intercepted leaves the page as it was, and the next control uses it.
- **Overlays.** Before a click, the control is scrolled to the middle of the window and hit-tested at its middle: under another layer (a cookie wall, a sticky header), it is not exercised, and the layer is named. A dialog or a fixed layer over a quarter of the window that an activation shows is recorded, and its own controls are not exercised.
- **Interception.** Once the page has loaded, every navigation the page starts is recorded from the Navigation API's `navigate` event, and one to another document (or a download) is cancelled there, before any request leaves; the network guard stays the backstop, answering any top-level navigation that slips through with 204. `window.open` is hooked as always (it returns `null`), form submission is cancelled, `window.close()` and `print()` are ignored, and writes to storage and cookies are counted.
- **A log**, written to the record: every load, wait, click, skip, intercepted navigation, window, submission, download, dialog and blocked request, on one clock, and the guard's own log (`guard`), merged across the fresh pages, with intercepted navigations in it (`cause: "intercepted"`).

Each probe kind opens its own browser context with the same storage state, headers, cookies, color scheme and device settings as the collection (the layout probes force a 1280×1024 desktop window, as browser zoom would; the hover probe keeps the run's window size in desktop mode, so a pointer can hover even with `--device`), and loads the page fresh, so one probe's state never leaks into another's. The orientation probe opens four: a 1280×800 window and a 390×844 phone, each loaded upright and sideways; the phone has touch, device scale 3 and an Android Chrome user agent with the browser's own version (unless `--user-agent` sets one), since some pages show their "rotate your device" overlay only to phones.

### The network guard

The guard is on for the whole life of a probe page, including its load. The authentication probe lets the page finish its own redirects first (see 3.3.8 below): until it lands, navigations and the forms the page submits by itself with GET go through, and POST is blocked as always.

- only GET, HEAD and OPTIONS reach the network; every other request, `sendBeacon` included, is aborted and logged;
- once the page has loaded, a top-level navigation is answered locally with 204 and logged: the page stays, and the attempt is evidence (3.2.1);
- WebSockets and EventSource are blocked;
- `window.open` is hooked: it is logged and returns `null`; any popup that opens anyway is closed;
- form submission is hooked and cancelled, and logged;
- `alert`, `confirm` and `prompt` are dismissed (`confirm` answers cancel) and logged;
- downloads are refused and service workers are blocked, so nothing answers a request behind the guard's back;
- permission prompts are denied (Playwright grants none).

A GET can still have side effects on a badly built server. That cannot be ruled out, which is why the observe class never clicks, and why the activate class runs only when named and never touches what its skip list names (below). Every probe record lists what the guard blocked and which navigations it answered.

### Determinism

- When probes run, the browser starts with `--force-color-profile=srgb --disable-lcd-text --font-render-hinting=none`.
- A probe waits for the page to settle: 300 ms with no DOM mutation and no layout shift, at most 3 s, after `document.fonts.ready`.
- Screenshots are taken with animations finished and the caret hidden.
- A verdict that rests on an absence (no pixel changed on focus, focus never left a set of elements) is measured twice before it becomes a finding.
- Each record carries its conditions: viewport, device scale factor, browser and version, variant, color scheme.

## Observations in the snapshot

Probe facts go in `snapshot.observations.probes`, an optional field, so `schemaVersion` stays 1 and the published [JSON schema](../schema/snapshot.schema.json) describes it:

```ts
interface ProbeRecord {
  kind: 'layout' | 'keyboard' | …
  version: string                 // the probe's version; a rule states which versions it reads
  conditions: { viewport, deviceScaleFactor, browser, variant?, colorScheme?, reducedMotion? }
  status: 'complete' | 'partial' | 'skipped'
  reason?: string                 // 'stop budget reached (150)', 'probe failed: …'
  guard: { blocked: [{ method, url, at }], navigations: [{ url, at, cause? }], dialogs: [{ type, message, at }] }
  durationMs: number
  data: unknown                   // per kind: refs, identities, boxes and measured numbers; never verdicts
}
```

**Node identity.** Probes run on a fresh load, and pages change between loads. Every element a probe reports carries the snapshot ref (the same CSS path the collector writes) and an identity: its tag plus its `id`, `role`, `type`, `name` and `href` attributes. A rule reports an element only when the ref resolves in the snapshot and the identity matches; otherwise the fact is *unmatched*, counted in the coverage line, and never becomes a finding.

**Offline replay.** Rules are pure functions of the snapshot. `rampa check --save dir` writes the observations with the snapshot, and `rampa check dir/page.snapshot.json` judges them again with no browser, giving the same findings. A threshold can change and a saved run be judged again.

## How results are reported

- **Findings** from probe rules have `source: "probe"`, name the element, and carry the measured evidence (sizes, offsets, the key sequence) in `evidence`.
- **Experimental.** Every probe rule is experimental until it passes the evaluation gate in the plan (4.9). Its findings are reported **below the confidence threshold**: they show with `--verbose`, or as confirmed findings with `--min-confidence low`, and `--fail-on any` counts them.
- **Needs review** (`report.needsReview`): what a person must look at, such as text that overlaps after spacing is raised or a faint focus change. Probe items sit there with the engine's and the rules' (criterion, rule, element, message and evidence) and are listed with them. Never a failure, never part of the exit code.
- **Beyond the target.** Rampa targets WCAG 2.2 by default, where 2.4.11 counts like any other criterion. Under `--wcag 2.1`, a 2.4.11 result (new in WCAG 2.2) is shown apart and marked "beyond the 2.1 target", and never counts toward the exit code.
- **Coverage, per criterion and method.** `report.coverage.probes` lists, for each criterion a probe rule checked, the method and probe version, the conditions, how many elements it applied to, failures, items to review and unmatched facts. In the per-criterion coverage (`report.coverage.criteria`, see [WCAG 2.2](wcag-2-2.md)), each of these rows is a method of kind `probe`, named after its rule (`rampa/reflow`) with the probe and conditions in `probe`; it gives the criterion its status like any other method (an experimental failure, below the threshold, makes it "needs review"), and a probe that was skipped is a method that did not run. A criterion a probe rule decided something for leaves the "not checked" list. "No failure found" applies to the conditions shown; it is never a pass.

```
Coverage of this run
  Checked by axe-core (partial):  …
  Judged with verified evidence:  …
  Probed (experimental):          1.4.10
    1.4.10  probe/layout@1 (rampa/reflow) · 320×256 CSS px from 1280×1024 · chromium 154.0.4258.62 (headless): 2 failure(s) · experimental, below the threshold (--verbose shows them) · 4 element(s)
  Not checked automatically:      40 of 55 WCAG 2.2 A/AA criteria (--verbose lists them)
```

## Coverage by criterion and method

What the probes add (`--probe all`, plus `variants`, `auth`, `links` and `input`, which run only when named), and what each criterion still needs from a person. Every rule is experimental.

| SC | Method (probe, rule) | Failure | Needs review | Stays manual |
|---|---|---|---|---|
| 1.1.1 Non-text Content | `probe/variants@1`, `rampa/carousel-name` (only with `--probe variants`): carousels and images a script swaps, followed for 16 s of fake clock; slides that never showed made visible one at a time; each picture captured once as a 16×16 grey thumbnail | pictures the thumbnails tell apart (a mean difference of 16 grey levels or more) that all carry one non-empty name, in one carousel or one swapped image (F20), medium | the same name on pictures with different addresses where not every picture could be captured | whether a name that differs per slide is right (1.1.1's judgment); carousels that move only when clicked and whose slides cannot be made visible; CSS-only animations; pictures in CSS backgrounds |
| 1.2.1 Audio-only and Video-only (Prerecorded) | `probe/media@1`, `rampa/audio-video-only`: media listed, played muted | — | each audio player that shows or played, and each video with no audio track, with the transcript signals found near it and on the page | whether a transcript or alternative is equivalent; decorative video; media labeled as an alternative for text |
| 1.2.2 Captions (Prerecorded) | `probe/media@1`, `rampa/captions`: text tracks made to load | every captions or subtitles track of a video with sound fails to load or holds no cues | a video with sound and no captions track; a track still loading; a known player (YouTube, Vimeo…) in a frame of another origin | accuracy, completeness and timing; open captions; captions a player draws itself |
| 1.2.3 Audio Description or Media Alternative (Prerecorded) | `probe/media@1`, `rampa/media-alternative` | — (never, by design) | each video with sound, listing descriptions tracks, audio description controls and transcripts found | whether the visual information matters, and whether the description or alternative is adequate |
| 1.2.4 Captions (Live) | `probe/media@1`, `rampa/live-captions`: media whose duration is infinite | — | each live video with sound: applies here, not checked | everything about live captions |
| 1.2.5 Audio Description (Prerecorded) | `probe/media@1`, `rampa/audio-description` | — (never, by design) | each video with sound, listing descriptions tracks and audio description controls (a transcript does not count) | quality of the description; whether the soundtrack already says it |
| 1.3.4 Orientation | `probe/orientation@1`, `rampa/orientation`: portrait and landscape at 1280×800 and at 390×844 (phone), each loaded and then turned | content turned a quarter between orientations: `html`, `body` or most of the text (ACT b33eff); content gone in one orientation behind a "turn your device" message | a smaller element with text or images turned a quarter; content gone with no message (two comparisons); a turn message while the content still shows | essential orientation; real devices and their rotation lock; native apps |
| 1.4.1 Use of Color | `probe/color@1`: `rampa/color-only-state`, `rampa/color-only-required`, `rampa/link-color-only`, `rampa/color-words`; styles compared with peers, an achromatopsia capture with an 8 px halo, links hovered and focused | a current, selected or pressed item, or required fields, that only color sets apart, under 3:1 in lightness and gone in gray (G182, F81); a link in text that only color sets apart, under 3:1 against the text (F73); a sentence that names a color for required fields marked by that color alone | an item that could not be captured; links at 3:1 or more with no cue on hover or focus (once per page); a sentence that names a color for anything else, or a color nothing has | charts, maps, images and color-coded tables; whether a difference carries meaning; forced colors and themes |
| 1.4.2 Audio Control | `probe/media@1`, `rampa/audio-control`: what plays on load, with sound, watched for at least 4.5 s; its level read from its stream | sound that plays on its own for more than 3 s (a media element, an `Audio` object or Web Audio) with no native controls and no named pause, stop, mute or volume control near it or for the sound on the page (ACT 80f0bf): high when the level was read, medium when not | the only control is a pause or stop button away from it; autoplay the browser did not start; sound that could not be measured; sound under 3 s that was still playing | whether a control works (it is never pressed); sound started by an interaction; players in frames of another origin |
| 1.4.3 Contrast (Minimum), in states | `probe/states@1`, `rampa/state-text-contrast`: links and buttons with text hovered, then focused; text measured from pixels where its colors change | text under 4.5:1 (3:1 when large) at its best against what is behind it, in the hover or the focus state | text part above and part below; a reading that is not sure (thin strokes, a translucent element); a state whose colors changed but could not be measured | text over images in those states; states the probe does not reach (pressed, expanded, dark scheme); controls that look alike share one measurement |
| 1.4.4 Resize Text | `probe/layout@1`, `rampa/resize-text`: 640×512 CSS px at device scale 2 (1280×1024 at 200%) | text cut by an ancestor's overflow `hidden` or `clip` (ACT 59br37, with its no-wrap ellipsis and line-clamp exceptions): high when zoom cut it, medium when it was already cut | line clamps; cut text whose full text is in a name; carousels; text past the edges of a window that does not scroll; new overlaps; text the narrow layout hides with no control seen to show it | text behind menus; lost functionality; other browsers and text-only zoom |
| 1.4.10 Reflow | `probe/layout@1`, `rampa/reflow`: 320×256 CSS px from 1280×1024 | content past the right edge of a page that scrolls sideways; text cut at 320 px that was whole at 1280 px | doubtful cuts; new overlaps; text cut by a window that cannot scroll sideways | lost functionality; content gone behind collapsed menus (F102); the two-dimensional exception beyond element types |
| 1.4.11 Non-text Contrast, focus indicators | `probe/keyboard@2`, `rampa/focus-indicator-contrast`: the pixels that change on focus, their main colors against the colors next to them | an indicator whose main colors are all under 3:1 against every color next to them (the Understanding's Figures 9 and 12) | no single color around the indicator; a style sheet color that reaches 3:1 where the pixels do not (a thin, anti-aliased ring) | the browser's own ring (exempt); a change of background inside the component (out of scope, Figure 15); forced colors; whether a ring is thick enough to see (2.4.13, AAA) |
| 1.4.11 Non-text Contrast, selected and current items | `probe/states@1`, `rampa/state-indicator-contrast`: the item captured with its marks on and off, its text left out | an indicator (a bar, a pill, a check) under 3:1 against the colors next to it, when nothing in the text (bold, an underline) shows the state | the same next to a change of text color alone; no single color around it; an item that could not be captured | items marked by script state the probe cannot take off; native checkboxes and radio buttons (the browser's); graphs and charts; text-input boundaries |
| 1.4.12 Text Spacing | `probe/layout@1`, `rampa/text-spacing`: the four values as user overrides | text cut that was whole (F104); an ellipsis with no full text (medium) | doubtful cuts; new overlaps | scripts where a metric does not apply; text in canvas and images |
| 1.4.13 Content on Hover or Focus | `probe/hover@1`, `rampa/hover-content`: up to 30 triggers, hovered and then focused | content over other content that Esc does not close (SCR39); content the pointer cannot move onto (F95); content that goes within 10 s on its own; each loss measured twice | a loss seen once of two tries; content that may be an input error; Esc that only moved focus; content that stays after the pointer and focus leave | triggers the probe does not find; input-error wording; touch; content that moves |
| 2.1.1 Keyboard | `probe/keyboard@2`, `rampa/keyboard-reach`: Tab and Shift+Tab walk | a control neither walk reached (medium for a negative tabindex) | — | operating what was reached; drag and drop; states after interaction; handler-only controls |
| 2.1.2 No Keyboard Trap | `probe/keyboard@2`, `rampa/keyboard-trap` | a cycle Tab, Shift+Tab, Esc and the arrows never leave, twice | traps inside dialogs; traps with exit text | traps after interaction; plug-ins |
| 2.1.4 Character Key Shortcuts | `probe/shortcuts@1`, `rampa/character-key-shortcuts`: every printable key with focus on the body, twice, against a wait with no key; settings named for shortcuts toggled with Space; `judgment/2.1.4@1` only clears | printable keys that change the page while no control has focus and that no setting on the page stopped (F99), one finding per page, medium | — | settings on other pages or behind login (the message says to waive); shortcuts active only on focus; keyboard layouts and IMEs; speech input |
| 2.3.1 Three Flashes or Below Threshold | `probe/flash@1`, `rampa/three-flashes` (only with `--probe flash`): the window captured every 16 ms of the page's time for 3 s, animated images decoded, videos played muted for 3 s, on grids of 4 × 4 CSS px | seven transitions or more in one second (more than three general or red flashes) over more than 25% of a 341 × 256 field | — (measured failures only; what could not be read is named in the coverage note) | flashing after an interaction or further down the page; video from another origin, DRM and embedded players; live and user-generated content; certification-grade sign-off |
| 2.4.1 Bypass Blocks | `probe/keyboard@1` (variant `skip-link`), `rampa/bypass-blocks`: the first 8 Tab stops, and Enter on up to 3 skip links among them | — (never on one page, by design; failures come from `--crawl`, [site criteria](site-criteria.md)) | a skip link that points nowhere, does not move focus, or never shows; links and controls before the content with no skip link, main landmark or heading after them; a skip button or menu toggle, which is never pressed | which blocks repeat on other pages (a crawl compares them); interleaved blocks; single-page-app views; whether a block is substantial |
| 2.4.4 Link Purpose (In Context) | `probe/links@1`, `rampa/scripted-links`: scripted links clicked once, navigations intercepted; an inventory that decides nothing | — (the 2.4.4 judgment decides, with where each link went) | — | links behind a click that is never made (a menu that must open first); destinations behind login; the judgment's own limits |
| 2.4.7 Focus Visible | `probe/keyboard@2`, `rampa/focus-visible`: focused and blurred captures | no pixel changes in the region or the viewport; focus removed on arrival (F55) | a change only elsewhere; a faint change | whether a change is perceivable; forced colors; other browsers |
| 2.4.11 Focus Not Obscured (Minimum) | `probe/keyboard@2`, `rampa/focus-obscured`: 5×5 hit grid at the run's window and at 390×844, confirmed by pixels | the element entirely under author content (beyond the target under `--wcag 2.1`) | — | content the user opened or moved; other window sizes and zoom levels |
| 3.1.1 Language of Page | `probe/variants@1`, `rampa/language-versions` (only with `--probe variants`): up to four other language versions the page links to (`hreflang` alternates, a language switcher), loaded; their root's `lang`, title and text read with the language identifier | a version whose `lang` its text is not in, read clearly (150 letters and 20 words at least, one language well ahead), with no model | — | short or mixed text, never judged; versions past the fourth; a switcher that changes the language in place (a single-page app), which needs a click |
| 3.2.1 On Focus | `probe/keyboard@2`, `rampa/on-focus` | navigation, new window, submission or modal on focus, repeated when focus comes back (high); a browser dialog or a script focus move, repeated (medium) | a change that did not repeat; an address change with no load | focus by mouse; changes after interaction; content changes that change meaning |
| 3.2.2 On Input | `probe/input@1`, `rampa/on-input`: each form control changed once on a fresh load, confirmed on a second; `judgment/3.2.2@1` only clears | a navigation, new window, submission or modal dialog as the value changes (high); the same once the field is left, a browser dialog, focus moved by the page (medium); each again on a second load and with no warning the model could quote | a change once of two loads; an address set in place; most of the text changed; a layer that is not modal; focus lost | whether a warning is adequate; custom widgets; values that matter (one option, a full field); forms with password, file or payment fields |
| 3.3.8 Accessible Authentication (Minimum) | `probe/auth@1`, `rampa/accessible-authentication`: sign-in and recovery steps; a trusted paste into each password and code field; keypads, quoted cognitive tests, CAPTCHAs classified; `judgment/3.3.8@1` only clears | a field a paste does not reach while a key does; a split code a paste fills in part; a read-only password filled by a keypad; text asking for some characters of a secret, a calculation or an image transcription (medium) | any of those next to another way to sign in; a field that takes no input; attributes that keep password managers away; a puzzle CAPTCHA | steps behind a submit; security questions; whether an alternative is accessible; real password managers |

"No failure found" in a coverage line applies to the conditions it names: one browser engine, one viewport, the states the observe class reached. It is never a pass.

## Cost

Measured on 2026-10-09 with Microsoft Edge 154 headless on a Windows 11 desktop that other jobs were loading at the same time (one run each; live pages change between runs):

| Page | Reflow | Text spacing | 200% zoom | Keyboard walk at 1280×800, with pixels | Walk at 390×844, 2.4.11 only |
|---|---|---|---|---|---|
| rampa.guilhermebs.com.br | 1.2 s | 1.2 s | 3.0 s | 24.5 s, 50 + 50 stops, 0.24 s per stop | 4.0 s, 49 + 49 stops |
| www.gov.uk | 0.9 s | 0.9 s | 1.4 s | 40.3 s, 89 + 89 stops, 0.23 s per stop | 6.5 s, 89 + 89 stops |
| agenciabrasil.ebc.com.br | 3.3 s | 2.6 s | 4.9 s | 45.3 s, 150 stops (budget reached), 0.30 s per stop | 10.5 s, 150 stops (budget reached) |

The 200% zoom column was measured in a later run the same day, when reflow and text spacing took 1.5 to 5.4 s on the same pages; zoom costs a little more than reflow because it measures the page a third time when text went missing. The layout probes are within the plan's 2–5 s per page. The main keyboard walk is above the plan's 0.2 s per stop: each forward stop waits 150 ms to read focus again and takes three region captures, a backward stop only the hit grid, and a page whose pixels move on their own adds the viewport confirmation. The 390×844 walk only places focus and runs the grid (no idle recording, no second read), about 0.05 s per stop. Budgets: 150 stops per direction, 120 s per walk, 4,000 measured boxes per layout, 30 triggers and 120 s for hover. Each record keeps `durationMs`, and a record cut short says why in `reason`. A saved snapshot with all probes is about 0.5 MB; screenshots are kept as hashes, not images.

The hover probe, measured the same day (one run each):

| Page | Triggers found, tried | Showed content | Time |
|---|---|---|---|
| rampa.guilhermebs.com.br | 0 | 0 | 1.0 s |
| www.gov.uk | 3 (a search field, two menu buttons that open on click), 3 | 0 | 5.2 s |
| agenciabrasil.ebc.com.br | 10 (an underline drawn by `::after`, icon colors, an ad frame), 10 | 0 | 18.6 s |
| getbootstrap.com/docs/5.3/components/tooltips | 33, 26 (6 left out as alike; time budget reached) | 23 | 121 s |

An attempt where nothing shows costs about 0.65 s. One where content shows costs about 1.4 s on focus and 2 to 4 s on hover, more when a check fails and is measured a second time, so a page full of tooltips reaches the 120 s budget.

The orientation probe, measured the same day (one run each; most of the time is four page loads and their settling):

| Page | Loads compared | Findings | Time |
|---|---|---|---|
| rampa.guilhermebs.com.br | 4 | none | 11.0 s |
| www.gov.uk | 4 | none | 10.5 s |
| github.com/guilhermebsantiago/rampa-cli | 4 | none | 45.9 s |
| developer.mozilla.org, the `<kbd>` page | 4 | none | 19.1 s |

The shortcuts probe, measured the same day (most of the time is 94 keys at about 0.25 s each, then the confirmations):

| Page | Keys pressed | Shortcuts found | Model calls | Time |
|---|---|---|---|---|
| rampa.guilhermebs.com.br | 0 (no key listener) | none | 0 | 4.3 s |
| github.com/guilhermebsantiago/rampa-cli | 94 | `/`, `s`, `w`, `t`, `k`, `,` | 1 | 44.3 s |
| developer.mozilla.org, the `<kbd>` page | 94 | `/` | 1 | 28.0 s |

The media probe, measured the same day (one run each; the watch lasts at least 4.5 s after the page starts loading, which a slow page has spent loading, then 2.5 s of muted playback when something shows):

| Page | Media found | Findings | Time |
|---|---|---|---|
| www.w3.org/WAI/perspective-videos/captions | two YouTube players in frames of another origin (Able Player) | 1.2.2: one player to review (the other does not show); 1.2.1, 1.2.3, 1.2.4, 1.2.5 not checked | 12.3 s |
| ableplayer.github.io, demo video1 | one `video`, 52 s, with an audio track and a captions track of cues | 1.2.3 and 1.2.5 to review (a "Show transcript" button found); 1.2.2 no failure found | 7.4 s |
| agenciabrasil.ebc.com.br, a Radioagência story | one hidden `audio` with no source (its "Tocar" buttons load it) | 1.2.1 not checked; nothing played on its own | 5.0 s |
| `test/fixtures/probes/media-*.html` | 1 to 6 elements each | as in the tests | 4.9 to 8 s |

The color probe, measured on 2026-10-10 (one run each; most of the time goes to the page's load and settling, and to one hover and one focus per style of link):

| Page | Read | Time |
|---|---|---|
| rampa.guilhermebs.com.br | 11 links in text | 1.4 to 2.1 s |
| developer.mozilla.org, the `<kbd>` page | 3 current or selected items (2 captured in gray), 13 links | 1.6 to 5.4 s |
| pt.wikipedia.org/wiki/Brasil | 3 current items, 2,960 links in text (the first 150 read, 3 styles hovered and focused) | 5.8 to 8.3 s |
| getbootstrap.com/docs/5.3, navs and tabs | 23 current or selected items (8 captured in gray), 11 links | 3.7 to 5.3 s |
| `test/fixtures/probes/color-*.html` | 3 to 5 items each | 0.7 to 2 s |

The states probe, measured on 2026-10-11 (one run each; most of the time is one hover and one focus per style of control, and four captures per selected item):

| Page | Read | Time |
|---|---|---|
| rampa.guilhermebs.com.br | 48 controls with text in 16 styles (10 hovered, 10 focused), no selected item | 4.7 s |
| www.gov.uk | 80 controls in 11 styles (10 and 10), no selected item | 5.7 s |
| getbootstrap.com/docs/5.3, navs and tabs | 80 controls in 8 styles (8 and 8), 23 selected or current items (12 captured) | 5.9 s |
| `test/fixtures/probes/states-*.html` | 11 to 15 controls, 3 items each | 2 to 4 s |

Reading the focus indicator's colors and its style in the keyboard walk adds two short page evaluations per forward stop: the walks of the same day took 28.1 s for 55 stops on Rampa's site and 43.2 s for 89 on gov.uk, against 24.5 s and 40.3 s on 2026-10-09.

The authentication probe, measured the same day (it waits 1.5 s after load for the page's own redirects; then about 0.3 s per paste):

| Page | Read | Time |
|---|---|---|
| github.com/login | 1 sign-in step, 1 paste | 2.4 to 3.8 s |
| sso.acesso.gov.br/login | redirects followed to the CPF form, 1 identifier-first step | 15.6 to 21.7 s |
| `test/fixtures/probes/auth-*.html` | 3 to 4 steps, up to 5 pastes | 1.7 to 3.3 s |

The state-variants probe, measured on 2026-10-11 (two runs each; the carousels take eight steps of 2 s on the fake clock, about 0.2 s each in real time, then the captures; each language version is a page load of its own):

| Page | Read | Time |
|---|---|---|
| rampa.guilhermebs.com.br | no carousel; 1 language version (`/pt/`) | 13.0 to 13.3 s |
| www.ufc.br | 1 carousel, 4 pictures captured on the clock; no language version linked | 3.4 to 3.7 s |
| www.w3.org/WAI/fundamentals/accessibility-intro | no carousel; 4 of 9 translations | 4.4 to 6.5 s |
| `test/fixtures/probes/variants-carousel-*.html` | 3 to 4 carousels or images that may be swapped | 2.0 s |

The links probe, measured on 2026-10-11 with Edge 155 headless, other jobs loading the machine (one run each; a click takes about 0.8 s, a fresh page 2 to 4 s, so a page of menu toggles costs a load per link):

| Page | Scripted links found, clicked | Fresh pages | Time |
|---|---|---|---|
| www.w3.org, the APG link example | 3, 3 (all navigate, intercepted) | 1 | 13.2 s |
| www.ufc.br | 2, 1 (one under the cookie banner) | 1 | 19.2 s |
| www.camara.leg.br | 6, 6 (menu toggles written as `href="#"`) | 6 | 28.6 s |
| www.ibge.gov.br | 2, 1 (a skip link under the government bar) | 1 | 9.0 s |
| agenciabrasil.ebc.com.br, www.uol.com.br, portal.stf.jus.br | 0 | 1 | 7.2 to 11.3 s |
| `test/fixtures/probes/links-*.html` | 3 to 12 | 1 to 5 | 2.5 to 30 s |

The on-input probe, measured the same day (each control costs a fresh page, about 2.5 to 6 s with its waits, and a second one when it changed the context):

| Page | Controls changed | Second loads | Time |
|---|---|---|---|
| www.w3.org, the BAD demo's inaccessible tickets page | 1 | 1 | 7.3 s |
| www.camara.leg.br/deputados/quem-sao | 6 | 0 | 37.4 s |
| www.gov.uk/search/all | 1 | 0 | 7.5 s |
| `test/fixtures/probes/input-*.html` | 1 to 9 | 0 to 6 | 3.8 to 43 s |

## Not yet

- With `--crawl`, 2.4.1 is compared across the pages from their markup alone: a link into the page counts without being pressed, since the skip-link probe does not run there yet.
- `--probe` runs from `rampa check` on URLs and HTML files, and the programmatic `check()` takes `probes: ['layout', 'keyboard', 'hover', 'orientation', 'shortcuts', 'media', 'color', 'states', 'variants', 'auth', 'flash', 'links', 'input']` (a browser passed in to `check()` is used as it is: without `--autoplay-policy=no-user-gesture-required`, sound set to play on load is held by the browser and only goes to review). Probes do not run with `--crawl`, from `rampa mcp`, or from the Playwright and Puppeteer helpers. On app screens, `rampa check android:` runs the keyboard, layout and orientation probes, and an XCUITest export brings layout and orientation steps ([app screens](#app-screens-android-and-ios)); neither has run on a real device.
- The `rampa.config` file has no `probe` key yet.
- Items to review appear with the engine's and the rules' in every format: grouped by criterion and rule in the terminal (each element with `--verbose`), the Markdown and the HTML reports, counted in SARIF's coverage, and listed in the JSON (`needsReview`).
- Captures are not written next to a saved snapshot; only their hashes are recorded.
- The state-variants probe does not click: a carousel that moves only when its buttons are pressed is read from the slides it can make visible, and a language switcher that changes the language in place (a single-page app, no address to load) is not exercised. Caption tracks' `srclang` against the spoken language, the third part of the plan's D6, is not built.
- Of the activate class, the shortcuts probe (printable keys on the body, Space on the settings it found), the links probe (one click on each scripted link) and the on-input probe (one change of each form control; both only with `--probe links`, `--probe input` or `--probe interact`) exist; the rest of it (Enter and Space on other controls, drags) and `--allow-submit` do not. Nothing here submits a form. The authentication probe (only with `--probe auth`) pastes a dummy value into password and code fields, types one key when the paste did not land, and puts the value back.
- `--crawl` does not run probes, so it does not find sign-in pages and probe them yet (the plan's B7 asks for that); the authentication probe lists the sign-in and recovery links it saw.
- The plan's flake gate (each fixture 10 times in CI) is not wired into CI; the four probe test files were run five times in a row by hand, with no verdict changing, the 1.4.4 and 1.4.13 tests three times in a row on Edge, with none changing either, and the 1.3.4 and 2.1.4 tests three times (twice in a row and once in the full suite), with none changing. The media tests ran four times in a row on Edge, and once in the full suite, with no verdict changing. The color tests ran three times in a row on Edge and once in the full suite, with no verdict changing; their lightness verdicts also read the style sheet's colors, so a platform whose fonts antialias differently cannot turn a 5:1 difference into a failure. The authentication tests ran three times in a row on Edge and once in the full suite, with no verdict changing. The state contrast tests (`test/probes-states.test.ts`, keyboard and states probes on three fixtures) ran three times in a row on Edge and once in the full suite, with no verdict changing, and so did the flash tests (`test/probes-flash.test.ts`, six pages); the flash probe moves the page's own clock rather than waiting on it, and only its video sampling runs in real time, with a cap. The links tests (2.4.4) ran three times in a row on Edge and once in the full suite, with no outcome changing; the on-input tests (3.2.2) too, with no verdict changing. The state-variants tests ran four times in a row on Edge and once in the full suite, with no verdict changing; their carousels move on the fake clock, not on real time, and each swapped picture is captured once it has loaded and decoded. They have not run yet on the Linux CI runner's Chrome. They have not run yet on the Linux CI runner's Chrome.
- Saved recordings of three real pages replay offline to the same findings, by id; the plan's measurement on 20 pages of the real-page sample (EVAL-1) is not done.

## The checks

### Audio and video: 1.2.1–1.2.5 and 1.4.2 (`--probe media`)

**The probe.** A fresh page at the run's window size, in a browser started with `--autoplay-policy=no-user-gesture-required` (a browser that lets pages play sound on load; headless Playwright browsers run with `--mute-audio`, so nothing reaches the speakers). Init scripts, installed before the page's own scripts in every frame, watch what plays:

- every `video` and `audio` element that starts playing, and every `play()` a script calls, which also catches `new Audio()` objects that never join the page;
- Web Audio: a node connected to the speakers (`AudioDestinationNode`) is also connected to an analyser on the same context, and sources started are counted. Nothing the page plays is changed.

While something plays with its sound on (not muted, volume above 0), its level is read every 100 ms from a copy of its stream (`captureStream()` into an analyser of the probe's own), never from the speakers. Its sound is timed as a span, from the first to the last moment above −50 dBFS in the media time it played, so the pauses between words count as sound; a single loud reading is a glitch and does not count. The watch lasts at least 4.5 s after the page starts loading, longer while something sounds and has not played 3.6 s, and at most 12 s.

Then every `video` and `audio` element of the page, its open shadow roots and its same-origin frames is listed (at most 60). Those that show (or have `controls`, or were set to autoplay and did not start) and are not playing are played **muted** for 2.5 s, at most 12 at once; those already playing are read where they are. For each the probe records its duration (infinite: live), whether its stream has an audio track and a video track, its level, and its text tracks: each `track` is made to load (mode `hidden`), and its state (loaded, error) and number of cues are read. Then each element played is paused, put back at its time and given back its muted state, and each track its mode. Around each element (its own container, up to five levels up, short of an ancestor that holds other media, and what its `aria-describedby` names) the probe records links, buttons and short texts that name a transcript (`transcript`, `transcrição`, `text version`…) or an audio description (`audio description`, `audiodescrição`, `described version`…), and showing, named controls that may pause, stop or mute it (`Pause`, `Mute`, `Som`, a volume slider). It also lists such controls and signals anywhere on the page, and frames of other origins, naming the player when the host is a known one (YouTube, Vimeo, Dailymotion, Wistia, Brightcove, JW Player, SoundCloud, Spotify and others).

**The rules.** Only two things fail without a person; the rest of 1.2.x is needs review by design (the plan's section 6: whether captions, a description or a transcript is equivalent needs the whole meaning of the media).

| Criterion, rule | Observation | Result |
|---|---|---|
| 1.2.2, `rampa/captions` | A prerecorded video that shows, with an audio track (or one that could not be read), whose every captions or subtitles track fails to load | failure, high (medium when the audio track was not read) |
| | … whose every captions or subtitles track loads with no cues (or some fail and the rest are empty) | failure, high |
| | … with no captions or subtitles track: captions may be burned into the picture, drawn by the player, or the video may be an alternative for text | needs review |
| | … whose captions track was still loading after the sample | needs review |
| | … with a captions track that loaded cues | no failure found (accuracy is not checked) |
| | A video with no audio track | not applicable; counted |
| | A known player in a frame of another origin that shows | needs review, one item per frame: Rampa reads none of its media |
| 1.2.1, `rampa/audio-video-only` | An audio player that shows or that played, or a video with no audio track | needs review, with the transcript signals found near it and elsewhere on the page; a muted, looping, autoplaying video with no controls is said to need nothing if it only decorates |
| 1.2.3, `rampa/media-alternative` | A prerecorded video with sound | needs review, listing descriptions tracks, audio description controls and transcripts found |
| 1.2.5, `rampa/audio-description` | The same | needs review, listing descriptions tracks and audio description controls; a transcript does not count at AA |
| 1.2.4, `rampa/live-captions` | A live video with sound (infinite duration) | needs review: applies here, not checked |
| 1.4.2, `rampa/audio-control` | Sound that plays on its own for more than 3 s (a media element, an `Audio` object, or Web Audio), with no native controls showing, no showing control named for pausing, stopping, muting or the volume next to it (or naming it in `aria-controls`), and no mute or volume control anywhere on the page | failure (ACT 80f0bf): high when the level was read, medium when only the audio decoder showed that it sounds (media from another origin) and for Web Audio |
| | The same, when the only control is a pause or stop button away from it | needs review |
| | The same, with native controls or a named control next to it, or a sound control on the page | no failure found; the coverage note names the control, which the probe never presses |
| | Sound that stopped, ended, was muted or turned down within 3 s; an element that played with silence or with no audio track | no failure found; counted |
| | Sound under 3 s that was still playing when the watch ended | needs review, low |
| | An element set to autoplay with its sound on that the browser did not start; Web Audio held suspended | needs review |
| | A known player in a frame of another origin whose address asks it to autoplay (`autoplay=1`), not muted | needs review, low |
| | Sound whose level could not be read and whose audio decoder did not run | needs review |

Each finding names the element (sound from a script or from Web Audio, and an element the snapshot does not hold, sit on the page's `body`); the evidence gives the tracks and their state, the duration, whether there is an audio track, the level read and how, when the sound started and how long it sounded, and the controls found. At most 10 findings per rule are listed.

**Settling axe-core.** axe-core's `video-caption` and `no-autoplay-audio` can only pass or leave a video undecided. On a video or audio element the probe read, their undecided result is the probe rule's to report: a failure, an item to review, or nothing (a video with no audio track needs no captions). axe-core's results on elements the probe did not read stay in the review list.

**No media.** When nothing is found, each criterion is "no applicable content", and the coverage note says what may have been missed: players in frames of another origin (YouTube, Vimeo and other embeds), media in closed shadow roots, and media added after the watch. When the only media is a player in a frame of another origin, or an element the probe could not read (no source yet, as with players that load their media when their own play button is pressed, or a load error), the criteria it would apply to are "not checked" instead, with the reason in the note.

**ACT rules.** On 2026-10-09, with Edge 154 headless, online, on the test cases of the three rules the plan names (22 pages, deduplicated by address):

| ACT rule | Failed examples | Passed examples | Inapplicable examples |
|---|---|---|---|
| 80f0bf, audio or video avoids automatically playing audio (1.4.2) | 2 of 2 failed, high | 0 of 3 flagged | 0 of 3 flagged |
| f51b46, video auditory content has captions | 0 of 4 failed; 3 sent to review under 1.2.2 (no captions track); Failed Example 2's track holds wrong captions, which is not checked | 0 of 2 failed; Passed Example 1 (captions burned into the picture) sent to review | 0 of 2 flagged |
| eac66b, video auditory content has accessible alternative (1.2.2) | 0 of 2 failed; both sent to review | 0 of 2 failed; Passed Example 2 (a video that is an alternative for the text above it) sent to review | 0 of 2 flagged under 1.2.2 |

80f0bf is measured as the rule is written: its Passed Example 2 plays two seconds (`#t=8,10`), its Passed Example 3 has named Play and Mute buttons next to the video, and its Inapplicable Example 2 plays a silent soundtrack; none is flagged. ACT's 1.2.2 rules have no example of a captions track that fails to load or holds no cues, which is the only 1.2.2 failure Rampa reports, so they measure what goes to review and that nothing is failed wrongly; the fixtures `test/fixtures/probes/media-*.html` cover the failures. The test cases are not part of `pnpm test`, which runs offline.

**Real pages.** On the three pages of the cost table the results look right. The WAI page plays its videos through YouTube players in frames of another origin, which Rampa cannot read: the player that shows goes to review under 1.2.2, and the other 1.2.x criteria are not checked, rather than "no applicable content"; the page's own captions files belong to those players. Able Player's demo video has a captions track that loads cues (no failure found), a "Show transcript" button that 1.2.3 lists, and nothing that names an audio description (1.2.5 to review). The Radioagência story's player has no source until its "Tocar" (play) button is pressed, which the probe never does, so 1.2.1 is not checked. Nothing on the three pages plays sound on its own. The plan's gate asks for a targeted corpus of pages that autoplay sound or have broken captions tracks, which has not been gathered.

**The fixtures.** The tests serve `test/fixtures/probes/` over HTTP on 127.0.0.1 (a `file:` page may not load its own text tracks or read its media's stream) with a second origin for a frame. The media are small WebM files (VP8 video, Opus audio, which Chrome on Linux and Edge both play), written by `scripts/media-fixtures.ts` with the browser's WebCodecs: a video with a voice-like tone, the same without an audio track, one with a silent audio track, six seconds of audio, and two seconds of audio.

**Limits.**

- Players in frames of another origin (YouTube, Vimeo, most news sites' players) are listed, never read: their captions, their sound on load and their duration are not seen. A known player gets one 1.2.2 item to review; other criteria stay not checked when nothing else applies.
- Captions are counted, not read: wrong, partial or unsynchronized captions pass as captions. Captions burned into the picture or drawn by a player's own script are not seen, so such a video goes to review.
- The level is read from the media's stream, which media from another origin without CORS does not allow: then only the audio decoder says that it sounds (medium confidence). 2.5 s of a long video say little about the rest: a video whose first seconds are silent still counts as having sound when its stream has an audio track.
- Sound on load is watched for a few seconds: sound that starts later, or after an interaction, is not seen. Whether a control works is never tried (it would take a click); a "Pause" button next to the media is trusted.
- Players that load their media only when their own button is pressed are not read (no source on load); the criteria say "not checked".
- One engine (Chromium). Media in closed shadow roots is not seen.

### 1.3.4 Orientation (`--probe orientation`, rule `rampa/orientation`)

**The probe.** Two window pairs: a 1280×800 window turned to 800×1280, and a phone, 390×844 upright and 844×390 sideways (mobile layout, touch, device scale 3). For each pair the page is loaded twice, once upright and once sideways. Before it loads, the window, the screen and the screen orientation are set over the DevTools protocol (`Emulation.setDeviceMetricsOverride` with `screenOrientation`), because resizing alone leaves `screen.orientation` in landscape; an init script gives a browser that has no `window.orientation` (desktop Chromium) one that follows `screen.orientation`, with `orientationchange`, as a phone's has. Both pairs turn as a phone does: upright is `portrait-primary` at 0°, sideways `landscape-primary` at 90°. Once loaded and settled, the page is measured; then the device turns (the window swaps its sides, the screen orientation changes, `orientationchange` and `resize` fire), the page settles and is measured again. In each state the probe records, as facts:

- what the page saw: the window, `screen.orientation`, the `orientation` media feature and `window.orientation`; a state where they do not agree with what the probe set is not compared;
- every element's own rotation about Z, from its computed `transform` (a 2D or 3D matrix) and `rotate`, kept as the matrix text; and, between the two states of a load, the elements whose rotation changed by 1° or more, with the text and images inside them;
- the visible text: characters and elements in the whole document (visually hidden 1 px text left out), the characters a reader sees on top in the window (hit-tested), and the text one state shows that the other does not;
- a layer over most of the window: the outermost fixed element (or an absolute one as big as the window) under at least 80% of a 5×5 grid of points, its text with the names of images inside, and whether it is opaque; text drawn by `::before` or `::after` of `html`, `body` or a fixed layer;
- the window captured at a quarter of its size: a hash, and how much of it is not its main color (for pages with little text, such as a canvas game).

It also records `screen.orientation.lock()` calls (and the legacy `lockOrientation`), the web app manifest's `orientation` and `display`, and axe-core's experimental `css-orientation-lock` with the related nodes it names. Observe class: it only resizes and turns the window.

**The rule.** Rotations are compared within each load. Content is compared within each load, and between the two loads of a pair as they loaded, which catches a page that checks its orientation once, on load.

| Observation | Result |
|---|---|
| An element's own rotation changes by a quarter turn (90° or 270°, within 5°) between portrait and landscape, and it is `html`, `body`, holds half the page's text or covers half the window (ACT b33eff) | failure, high |
| The same for a smaller element with text or images | needs review |
| The same for an element with no text and no image (an arrow, a chevron) | not reported; counted |
| In one orientation a reader sees at most a quarter of the text the other shows (under an opaque layer that the other orientation lacks, only the layer's text counts), and a layer, new text or a pseudo-element asks to turn the device ("rotate your device", "gire o celular", "best viewed in landscape") | failure, high |
| The same with no message, in two comparisons or more | needs review |
| The same in one comparison only (a page still loading looks the same) | not reported; counted |
| A turn message in one orientation while the content still shows | needs review |
| A layer over the window in both orientations (a cookie wall, an app shell) | not a difference |
| `screen.orientation.lock()`, the manifest's `orientation` | a note in the coverage line: browsers honor them only in full screen or in an installed app |
| axe-core's `css-orientation-lock` | corroboration only: the evidence says when it flags the same element, and the note when it flags one the probe did not see turn |

A finding names the element that turns, or the layer or element that holds the message; when the message exists only on the probe's load (a script added it), the finding sits on the page's `body`. The evidence gives the window sizes, the rotation matrices and the turn between them, or the characters a reader can see in each orientation, what covers the window and the message, quoted, with how many comparisons and which window pairs showed it.

**ACT b33eff.** On its 13 test cases (deduplicated by address; 2026-10-09, Edge 154, online), the 4 failed examples fail (high: `html` or `body` turned a quarter, including Failed Example 3's 2.5° to 92.5°), and none of the 3 passed and 6 inapplicable examples has a failure or a review item. Passed Example 2's matrix with a rotation of about 10⁻¹³° reads as 0°. axe-core's `css-orientation-lock` flags the same element in all four failed examples. The test cases are not part of `pnpm test`, which runs offline; the fixtures in `test/fixtures/probes/orientation-*.html` reproduce their shapes and the overlay cases ACT does not cover.

**Real pages.** On the four pages of the cost table nothing turned and no content was lost in either orientation, which looks right: all four are responsive pages with no orientation lock. The plan's gate asks for a targeted corpus of pages that do restrict their orientation (searched for "rotate your device", "gire o celular"), which has not been gathered yet.

**Limits.**

- One engine (Chromium), emulated: no real device, no rotation lock, no hardware sensor. Pages that sniff a specific device or check `navigator.userAgentData` may behave otherwise.
- The essential exception (a piano app, a bank check, a VR scene) is not judged: the plan's model step that may only clear findings is not built, so a person decides and waives.
- A message drawn in an image or a canvas with no text alternative is not read; the capture's ink only stands in for content when the page has under 20 characters of text.
- Rotation is about Z only, summed from `rotate` and `transform` of each element; skew and negative scales are read as part of the matrix angle, and elements in closed shadow roots or cross-origin frames are not seen.
- Content that takes more than 3 s to settle after a turn may be compared too early; content gone in a single comparison is only counted for that reason.

### 1.4.1 Use of Color (`--probe color`)

**The probe.** A fresh page at the run's window size. It reads styles, moves the pointer onto links and gives them focus, scrolls, takes screenshots, and puts another item's colors on one element for a single capture, then puts them back. It reads four kinds of things that color alone often tells apart.

- **Current state.** An element marked current (`aria-current`, unless `false`), a tab or option marked selected (`aria-selected="true"`), a pressed toggle (`aria-pressed="true"`), or an element with a state class (`active`, `is-current`, `nav-link--selected`, `current-menu-item`…) inside navigation, tabs, menus, toolbars, pagination or breadcrumbs. A state class on a list item stands for the link or button inside it.
  - **Peers.** Going up at most four levels from the element, the probe takes the first repeating unit whose siblings hold an element of the same tag and role that is not current itself: the `li` of a menu, the tabs of a tab list. Up to two peers are compared. When they differ from each other, the group says nothing about the current one and is skipped, as in a menu with one color per category.
  - **What is compared.** Every node from the unit down to the element, with `::before` and `::after`. Cues: font weight, style, size, family and variant; text transform and letter spacing; text decoration; each border's width and style; outline; the geometry of box and text shadows; background image; transform; filter; list style; the unit's height (3 px or more); a pseudo-element that paints on one side only, or with other content or size; and a wrapper only one side has that paints a border, an outline, a shadow or an image (MDN wraps the current page's link in an `em` with a bar). Marks: visible icons (`svg`, `img`, an icon `i`) and painted empty boxes one side has more of, and symbols (`✓`, `•`, `→`, `*`) or words ("(current)", "você está aqui") in the visible text of one side only. Text hidden the sr-only way is no mark. Colors: text, background, border, outline and decoration colors where both sides have them, shadow colors, opacity, fill and stroke, each with the luminance contrast of the two sides' colors as the style sheet gives them, composited on what is behind them.
  - **The gray capture.** When only colors differ, the unit is captured with a halo of 8 px around it, twice (a change between the two is movement: the item goes to review), then once more with the peer's colors put on its nodes, and put back. The peer's colors go on as inline `!important` declarations, and for pseudo-elements as a rule in an adopted style sheet, through a marker attribute. Both captures are reduced to the relative luminance of each pixel: the achromatopsia render. The record keeps how many pixels changed color, and the luminance contrast of the change at its strongest, with the top 0.5% of changed pixels left out as noise. Each peer is captured with the same halo. In four bands around each box, from 2 px inside its edge to 8 px outside, the probe measures ink in the gray render: an indicator another element draws, such as a bar under the selected tab that slides with the selection, shows as ink around the current item that its peers lack.
- **Required fields.** In a form, or the page, with visible required fields (`required`, `aria-required="true"`) and optional ones, each with a visible label, the first required label is compared with the first optional one, and the fields with each other, as above. Text marks come first: an asterisk or "required", "obrigatório", "obligatorio" on every required label (or the field's placeholder or hint), or "optional", "opcional", "facultativo" on every optional one. With no mark and only colors different, the label, or the field when only the fields differ, gets the gray capture.
- **Links in text.** Every link shown inline in a block that holds at least 20 characters of text outside its links, at most 150 per page. The probe records what sets the link apart from the block at rest, other than color: an underline or other decoration the block does not have, a border, an outline, a shadow, a weight on the other side of 600, a style, family or size, a text transform, a background image, a pseudo-element that paints, or an icon. It also records the link's own background, and the luminance contrast of its text color with the block's. Links that only color sets apart, at 3:1 or more, are hovered (the pointer moved onto them) and focused (`focus()`, which matches `:focus-visible` in Chromium), once per style: links that look alike at rest and match the same `:hover` and `:focus` rules of the page's style sheets share a measurement, for at most 8 styles. What changes other than color is recorded, the browser's focus ring included.
- **Color words.** Sentences of at most 300 characters, in English, Portuguese or Spanish, that refer to a color ("in red", "shown in green", "red fields", "campos em vermelho", "marcados en rojo") and carry a word for information ("required", "error", "available", "obrigatório", "indica", "selecione"…). "Our red team" is not one. Each is quoted with the color's hue and what it seems to name: required fields, errors, links, or anything. The elements of that kind whose text (or, for a field, whose border) has the hue are listed, with whether they carry a text mark, and so is any cue other than color the sentence itself names ("asterisk", "*", "bold", "icon", "marked with").

**The rules.** WCAG's Understanding for 1.4.1 (updated 16 September 2025) counts a difference in lightness of 3:1 or more between two colors as a visual distinction of its own. When content relies on perceiving a particular color, it asks for another indicator whatever the contrast.

| Rule | Observation | Result |
|---|---|---|
| `rampa/color-only-state` | A current, selected or pressed item that differs from its peers only by color: under 3:1 in lightness by the style sheet's colors, a change under 3:1 in the gray capture, and no mark in its halo that its peers lack | failure, high (G182) |
| | The same, when the item could not be captured (moving, not shown, past the budget) | needs review |
| | A cue, a mark, a lightness difference of 3:1 or more, a mark in the halo, peers that differ among themselves, an item that looks just like its peers | not reported; counted in the coverage note |
| `rampa/color-only-required` | Required fields that differ from optional ones only by color, under 3:1 and gone in gray, with no text mark on either kind | failure, high (F81; G14, G205) |
| `rampa/link-color-only` | A link in text that only color sets apart, under 3:1 against the text around it | failure, high (F73). An element axe-core's `link-in-text-block` already failed is left to it; what that rule left undecided on a link the probe read (a background image, a pseudo-element) is settled here |
| | Links at 3:1 or more that gain no cue on hover, or none on focus | needs review, low, one item per page. G183's current text asks only for 3:1. Its earlier version, and many audit checklists, also asked for a cue on hover and on focus, so the probe measures that and says so, never as a failure |
| | A link styled exactly like the text around it | not reported: nothing tells it apart, color included, and the Understanding says such a link does not fail 1.4.1 |
| `rampa/color-words` | A sentence that names a color for required fields, whose fields or labels in that hue carry no text mark | failure, medium (F81; G14) |
| | A sentence that names a color for errors, links or anything else, with elements in that hue | needs review, low, quoting the sentence and listing them |
| | A sentence that names a color that nothing it may refer to has | needs review, low |
| | A sentence that also names another cue | not reported; counted |

Each rule speaks only for its own kind of content. On a page with none of it, the rule's coverage line says "not checked", never "no applicable content": 1.4.1 also covers charts, maps and images, which nothing here reads.

**Fixtures.** No ACT rule exists for 1.4.1. The fixtures in `test/fixtures/probes/` come in three pages:

- `color-fail.html`: a current navigation link in red where the others are dark gray (2.15:1; its "(current)" is for screen readers only); a selected tab marked only by a pale blue background (1.24:1 on white); red required labels against gray optional ones, with "Fields in red are required."; and a link at 2.23:1 against its paragraph. Each is found once.
- `color-pass.html`: the same page fixed, with a bold, underlined current link, a bar of the tab's own, asterisks the hint explains, and underlined links. Nothing is reported.
- `color-near.html`, near misses, with no failure: a current item darker than its peers by 5.5:1; a selected tab whose bar is drawn by another element of the tab list; toggles whose colors swap (6.3:1); a menu with one color per category; a state class on a bold item; optional fields marked "(optional)"; "Our red team answers within a day."; "Seats in green are available", which goes to review because nothing on the page is green; and two links at 4.6:1, one underlined on hover with the browser's focus ring, the other with neither, which goes to review.

**Real pages.** On 2026-10-10, with `--probe color --no-llm --min-confidence low` (Edge 154):

| Page | Findings | Read by hand |
|---|---|---|
| rampa.guilhermebs.com.br | none | Right: its 11 links in text are underlined, in the color of the text around them |
| developer.mozilla.org, the `<kbd>` page | none of the probe's; axe-core fails 3 links in a list | Right: the sidebar's current page has a 2 px bar (a border on the `em` that wraps it); the "Try it" tab's bar and the example's selected "HTML" tab (in a shadow root) change by 3.73:1 and 5.46:1 in gray |
| pt.wikipedia.org/wiki/Brasil | none | Right: the selected "Artigo" and "Ler" tabs have an underline drawn by `::after`; links in text are `#3366cc` on `#202122`, 3.01:1, and gain an underline on hover and an outline on focus |
| getbootstrap.com/docs/5.3, navs and tabs | none | Right: pills swap their colors (4.5:1 in gray) and tabs gain borders; the base `.nav` example styles its "Active" link like the others, which says nothing by color |
| www.ibge.gov.br | 2 (`rampa/color-only-state`) | Right: the carousels' pagination bullets mark the current slide (`aria-current="true"`) only by an orange `#d4721e` against gray `#b5b5b5`, 1.65:1, same size and shape |
| www.camara.leg.br | none | Right: two telephone links in the footer are styled exactly like the text around them, which 1.4.1 does not fail; "PL 1893/2026" and its kind are bold |

These pages produced 2 failures, both true, and no false positive; far from the plan's gate of 35 reviewed findings, so the rules stay experimental.

**Limits.**

- Peers are found by structure. An item with no sibling of its kind (a single "current" link, a lone tab) is not compared, and a group whose items differ among themselves is skipped.
- Only the first required and the first optional field of a form are compared. A form where some required labels are marked and others are not is read as unmarked.
- Only the style sheet's colors are swapped: an indicator drawn in a background image or a canvas shows as a cue (its presence differs) or not at all.
- The halo is 8 px. An indicator farther away is missed, and a neighbour within 8 px shows in both halos.
- Hover and focus are measured once per style of link, for at most 8 styles; links past the 150th are not read.
- Color words are read in English, Portuguese and Spanish, and what a sentence names is read from a few words ("fields", "error", "link"), not understood. A sentence about a chart or an image ends in review.
- Charts, maps, color-coded tables and images that convey information by color are not checked.
- One engine (Chromium). Forced colors, dark mode and high-contrast themes are not tried.

### Contrast in states: 1.4.3 and 1.4.11 (`--probe states`, and the keyboard walk)

axe-core and Rampa's pixel rules read a page as it loads. The criteria also hold in the states a person puts it in: text must keep its contrast while hovered or focused (1.4.3), and the visual information that identifies a state, such as a focus indicator or the mark of the selected tab, needs 3:1 against the colors next to it (1.4.11). This is item C15 of the plan. Three rules read two probes; every result is measured from pixels, and a reading that is not sure goes to review.

**What the Understanding for 1.4.11 says, and how Rampa reads it.** A focus indicator "must have sufficient contrast against the adjacent background" in the focused state; the Understanding does not compare the focused and unfocused states. Its Figure 8 passes a yellow ring inside a blue button (it contrasts with the button), Figure 9 fails a yellow ring outside it on white, Figure 11 passes a ring partly inside and partly outside, and Figure 15 leaves a change of background inside the component out of scope. The browser's own focus style is exempt ("but must still be visible", which 2.4.7 checks), and so are inactive components. Hover effects are supplemental: the pointer shows hover, so a hover color needs no 3:1 against the default state, but the component must not lose contrast, and its text keeps 1.4.3's. Rampa therefore passes an indicator when one of its main colors reaches 3:1 against one color next to it (Figure 11), which can miss a ring the Understanding fails in its Figure 13 (a ring that contrasts only with the component's own border); it never fails one that a figure passes.

**The indicator, from two captures** (`src/pixels/indicator.ts`). The same region is captured with the state on and off; a third capture of the off state marks pixels that move on their own. The pixels whose color changed (a channel by 8 or more) are the indicator. Its main colors are the clusters of their colors in the "on" capture (colors within 24 of each other in every channel count as one), each with at least 15% of the changed pixels, at most three. For each, the colors next to it are read within 2 px: unchanged pixels always count (a near-white pill on white has white next to it), the indicator's own anti-aliased edge does not, and nothing inside the component's text does (what sits on a pill is not what it must stand out from). A color next to it counts from 15% of those pixels. The indicator's contrast is the best its main colors reach against those.

**Focus indicators** (`rampa/focus-indicator-contrast`, from the keyboard walk). At each forward stop the walk already captures the element's box plus 32 px focused, blurred, and blurred again (2.4.7). It now also reads the element's outline, borders, box shadow, background and text decoration in both states, and keeps the indicator measure in the record (`indicator` on each stop's `focus`, an optional field of `probe/keyboard@2`).

| Observation | Result |
|---|---|
| Every main color of the indicator under 3:1 against every color next to it | failure: high when the indicator has at least as many pixels as the box's perimeter, medium for a thinner one |
| The same, when a color the style sheet draws (an outline, a border or an underline that is there, a box shadow composited over the color next to it) reaches 3:1: a thin ring whose pixels are a blend | needs review, low |
| The same, with no single color next to the indicator (an image, a gradient) | needs review, low |
| The browser's own ring: only the outline changed, to style `auto` in the browser's ring color | not judged (exempt); counted in the coverage note |
| Half of the component's box or more changes color (its background), and outside the box nothing but that same color changes (an outline in the background's color, GOV.UK's yellow skip link) | not judged (out of scope, Figure 15); counted. A ring of another color outside the box is judged on its own |
| Nothing changed | 2.4.7's to report; not judged here |
| Any other indicator | no failure found |

**The states probe** (`--probe states`, `src/probes/states.ts`, variant `state-contrast`). A fresh page at the run's window size, in desktop mode so a pointer can hover.

- **Hover and focus** (`rampa/state-text-contrast`, 1.4.3). Links, buttons, tabs, menu items, `summary` and button inputs with visible text (text pushed out of the box, the image-replacement pattern, does not count), at most 80, are grouped by how they look: tag, role, first classes, text and background colors, font, and the page's `:hover` and `:focus` rules that match them (style sheets of other origins cannot be read). One control of each group, at most 10 groups, is scrolled into view and hovered (the pointer moved to it), then, apart, given focus with `focus()`. When the color of its text, or a background or an opacity behind it (its own, the control's, up to two ancestors'), changed, the text is measured as B3's pixel rules measure it: captured twice as rendered, then with its glyphs made transparent, with transitions finished (`measureTarget` in `src/surfaces/contrast-capture.ts`). Disabled controls are inactive components: counted, never hovered or focused.

| Observation | Result |
|---|---|
| In the hover or focus state, even the highest contrast between the text and what is behind it is under 4.5:1 (3:1 for large text) | failure: high when the text's color came from the style sheet, medium when read from the pixels |
| Part of the text reaches the threshold and part does not; a color read from thin strokes; a translucent element | needs review, low |
| Its colors changed but the pixels could not tell (it moved, nothing showed) | needs review, low |
| A control axe-core's `color-contrast` already failed at rest | left to axe-core; counted |
| The colors did not change | not reported; counted |

- **Selected and current items** (`rampa/state-indicator-contrast`, 1.4.11). Items marked current (`aria-current`, unless false), selected (`aria-selected="true"` on a tab, option, cell, row or tree item), pressed (`aria-pressed="true"`), checked (`aria-checked="true"` on a custom checkbox, switch or radio), or carrying a state class (`active`, `is-current`, `selected`, `current-menu-item`…) inside navigation, tab lists, menus, toolbars, list boxes, radio groups or pagination; at most 12. Native checkboxes and radio buttons are the browser's and left out; disabled items are exempt. Each is captured with a halo of 8 px (with the list item or tab that holds it), twice; then its marks are taken off, the attribute set to `false` (or `aria-current` removed) and the state classes removed from it and from its list item, and it is captured twice more; then the marks are put back. The text's style is read in both states.

| Observation | Result |
|---|---|
| Outside the item's text, an indicator changed (a bar, a pill, a check mark) whose main colors are all under 3:1 against the colors next to it, and the text does not change | failure, medium |
| The same, when the only change in the text is its color | needs review, medium: the state shows by a color and by a faint indicator (1.4.1 judges the color alone) |
| The same, when the text also turns bold, underlined, italic, larger or transformed | not reported: the text shows the state on its own and the indicator is supplemental; counted |
| No single color next to the indicator; an item that moved, shifted or could not be captured | needs review, low |
| Only the text changed (fewer changed pixels outside it than a quarter of the item's perimeter) | not reported: 1.4.1 and 1.4.3 judge text; counted |
| Nothing changed with the marks off | not reported: the page shows the state another way, or not at all; counted |

Each rule speaks only for its own kind of content: on a page with no selected item, `rampa/state-indicator-contrast` says "not checked", never "no applicable content".

**Fixtures** (no ACT rule exists for either criterion in these states):

- `states-fail.html`: a link with a pale gray ring (#c8c8c8 on white, 1.67:1); a blue button with a yellow ring outside it on white (Figure 9, 1.07:1); a link that turns pale blue on hover; a button whose background turns pale blue on hover under white text; a button that turns yellow on focus under white text; a selected tab marked only by a pale bar (1.45:1); the current page marked only by a pale pill (1.14:1); a custom checkbox whose check is pale gray (1.42:1). Each fails once; axe-core fails none of them at rest.
- `states-pass.html`: the same page fixed (dark rings, darker hover colors, a dark bar, a dark pill, a dark check). Nothing is reported.
- `states-near.html`, near misses with no failure: a yellow ring inside a blue button (Figure 8) and one straddling its edge (Figure 11); a background that darkens on focus (Figure 15); the browser's ring; a white ring wrapped in a dark shadow; a ring at 3.03:1; a link whose hover gray keeps 4.5:1; a disabled button with pale hover colors; a selected tab with a pale bar and bold text; the current page in a pale pill, underlined; a pressed toggle in black with white text; a disabled selected tab.

**Real pages.** On 2026-10-11, with `--probe keyboard,states --no-llm --min-confidence low` (Edge 155):

| Page | Findings | Read by hand |
|---|---|---|
| rampa.guilhermebs.com.br | none; 54 focus stops, 2 hover changes measured, no selected item | Right: the site's focus rings pass; on hover, "View on GitHub" turns from #102a2f to #0b7285 with its text at 4.78:1, just above 4.5:1, and "How it works" gains a #e1e5e0 background (11.82:1) |
| www.gov.uk | none; 5 focus indicators out of scope; 19 hover and focus states measured (8.0:1 to 14.5:1) | Right: GOV.UK's focus style fills the link with yellow under black text, which Figure 15 leaves out of scope, and its black underline contrasts with both. The skip link's yellow outline is the color of its own yellow background |
| getbootstrap.com/docs/5.3, navs and tabs | 12 focus indicators (`rampa/focus-indicator-contrast`); 1 focus indicator and 1 current tab to review | Right: the focus ring of those links and buttons is a translucent blue glow (`box-shadow` in `#0c70fb40`, a quarter opaque) with the outline removed: 1.02:1 on the purple navigation bar, 1.41:1 on white. The search button to review shows its white outline and yellow border as a blend in the pixels (#ae7bcb, 2.77:1 against the bar) while the style sheet's white reaches 3:1; the current tab of the tabs example is marked by a #dee2e6 border (1.30:1) and a change of text color |

These pages produced 12 failures, all true, and no false positive; the plan's gate asks for 35 reviewed findings, so the rules stay experimental.

**Limits.**

- Hover and focus are measured once per look of control, for at most 10 looks per state; a control whose `:hover` rule lives in a style sheet of another origin is grouped with others that look alike.
- Pressed (`:active`), expanded and dark-scheme states are not tried, nor is axe-core run again in each state, which the plan also lists. Text-input boundaries (a field whose border and background both stay under 3:1) are not checked yet.
- The focus indicator is read in the 32 px around the element: a ring drawn farther away is missed, as 2.4.7's region is.
- A selected item whose look a script sets (inline styles, a framework's own state) does not change when its marks are taken off, and is counted, not judged. Native checkboxes and radio buttons, which the browser draws, are left out.
- An indicator passes when any main color reaches 3:1 against any color next to it, so a ring that contrasts only with the component's own border (the Understanding's Figure 13) is missed.
- One engine (Chromium); forced colors and high-contrast themes are not tried.

### 1.4.10 Reflow (`--probe layout`, rule `rampa/reflow`)

**The probe.** The page loads in a 1280×1024 desktop window and settles; every element that owns text, and every control, is measured: its text box (the union of its own text fragments), the part of it that ancestors with `overflow: hidden` or `clip` leave visible, whether it sits inside content that needs two dimensions, and which pieces of text of different elements overlap. The window is then resized to 320×256 CSS px, which is 1280×1024 at 400% zoom (Understanding 1.4.10), and everything is measured again. Resizing instead of reloading is what zoom does; the window is in desktop mode, so the viewport meta is ignored as it is under browser zoom. Whether a person can scroll the window sideways is tested by scrolling, not read from `scrollWidth`, and a window whose `html` or `body` has `overflow-x: hidden` or `clip` counts as not scrolling: a script can still scroll it, a person cannot.

Each element gets a key in the page that holds across the two measurements, so a box is compared with itself even when responsive scripts add or remove siblings and its ref shifts. Content that needs two dimensions is exempt by element type: `img`, `video`, `canvas`, `svg`, `math`, `pre`, `code`, `iframe`, `object`, `embed`, `role=application`, and data tables with header cells (the table as a whole). Text inside an element that scrolls sideways on its own is not "past the edge".

**The rule.**

| Observation | Result |
|---|---|
| The window scrolls sideways at 320 px and visible text or a control, outside exempt content and fixed layers (an off-canvas menu parked to the right never scrolls into view), extends past the right edge (1 px tolerance) | failure, high |
| Text partly cut at 320 px (2 px across, or a quarter of a line down) that was whole at 1280 px | failure, high |
| The same, when a `title` or `aria-label` holds the full text, the cutting container hides other text completely (a carousel), or it shows an ellipsis | needs review |
| The window cannot scroll sideways, and text or a control that sat inside it at 1280 px is partly past its right edge at 320 px (wholly outside is an off-canvas menu and is not counted) | needs review |
| Text of two elements that overlaps at 320 px and did not at 1280 px | needs review |
| Text that disappears at 320 px (collapsed navigation, F102) | not reported: finding it needs the menu opened, which the observe class never does |

At most 10 findings per kind are listed; the coverage line counts the rest. Evidence gives the scroll width, the element's horizontal extent and how far it passes the edge, or how many pixels are cut and by which element.

**Limits.** One browser engine (Chromium). 320×256 is an emulation: a real 1280×1024 screen at 400% leaves about 318×236, hence the tolerances. Horizontal scrolling inside a container that is not exempt is not reported yet. Text in open shadow roots is measured and matched to the snapshot, which holds open shadow roots; text in frames is not measured.

### 1.4.12 Text Spacing (`--probe layout`, rule `rampa/text-spacing`)

**The probe.** A fresh page at 1280×1024 is measured with the same core as reflow. Then the four values the criterion names go on every element, open shadow roots included, as a user style sheet would set them: `line-height: 1.5`, `letter-spacing: 0.12em`, `word-spacing: 0.16em`, and `margin-bottom: 2em` on `p` (the W3C bookmarklet's choice). They are inline `!important` declarations, which win over the author's `!important` the way a user style sheet does. The page settles and is measured again; the comparison is the page against itself before the change.

The criterion is about the user's override, not the author's values; axe-core's `avoid-inline-spacing` keeps covering the inline `!important` case (ACT 24afc2, 78fd32, 9e45ec).

**Scripts.** Word spacing is not applied when the page's language is written without spaces between words (`ja`, `zh`, `th`, `lo`, `km`, `my`, `bo`), and the coverage line says "not applied: word-spacing (lang ja)". The other metrics are applied to every language; that is a simplification of the Understanding's note.

| Observation | Result |
|---|---|
| Text partly cut with the spacing that was whole before (F104; C35 and C36 fail) | failure, high |
| Cut to an ellipsis, and no `title` or `aria-label` holds the full text | failure, medium |
| Cut to an ellipsis, with the full text in a `title` or `aria-label` | not reported |
| Cut, when the full text is in a name or title, or the container hides other text completely (a carousel) | needs review |
| Text of two elements that overlaps with the spacing and did not before | needs review |
| Text in a container that scrolls, or text already cut before the spacing | not reported |

**Limits.** A metric a script does not use is only left out for word spacing. Text drawn in canvas or in images is not measured. Content that a page re-renders with JavaScript after a style change may settle late; the probe waits up to 3 s.

### 1.4.4 Resize Text at 200% (`--probe layout`, rule `rampa/resize-text`)

**The probe.** A fresh page at 1280×1024 and device scale 1 is measured with the reflow core. Then, over the DevTools protocol, the window becomes 640×512 CSS px drawn at device scale 2. That is what Chromium's 200% zoom does to a 1280×1024 window (the CSS viewport halves, `devicePixelRatio` doubles), and it is the viewport ACT rule 59br37 names. The page keeps its state, settles and is measured again, this time with the facts ACT 59br37 needs for each piece of text:

- the nearest ancestor whose `overflow-x`, and the nearest whose `overflow-y`, is `hidden` or `clip` and cuts the text;
- that ancestor's `white-space`, `text-wrap-mode` and `text-overflow` (across), or its used line height (`normal` counts as 1.2 × the font size, as ACT's background says), its height (the content box for `overflow-y: clip`), its font size and whether it clamps lines with `-webkit-line-clamp` (down);
- whether the text is under `aria-hidden="true"`, and whether its parent is an HTML element.

A container that scrolls (`overflow: auto` or `scroll`) between the text and the clipping ancestor keeps what is past its edge reachable, so only what reaches past the scrolling box counts as cut (ACT's Passed Example 4).

**Hidden text.** Text a reader saw at 1280×1024 that nothing shows at 640×512 (not its own box, not the same words elsewhere, not the same words in a `::before` or `::after`, as responsive tables repeat their headers in each cell) is looked at again in the page: what hides it (the outermost element that is not rendered, or the container that clips it away), and whether a visible control may show it (`aria-controls` naming it or something inside it, or an `aria-expanded="false"` control next to it). The window then goes back to 1280×1024. Text that is not shown again there was hidden by something else, such as a carousel that turned or a script, not by the width, and is not counted.

**The rule.**

| Observation at 640×512 | Result |
|---|---|
| Visible text cut by an ancestor's overflow `hidden` or `clip` (2 px across, or a quarter of a line down), whole at 1280×1024 | failure, high |
| The same, already cut at 1280×1024: ACT fails it too, though zoom did not cause it | failure, medium |
| Cut across by an ancestor with `white-space: nowrap` and a `text-overflow` other than `clip` (ACT's exception to expectation 1) | not reported; counted in the coverage note |
| Cut down by an ancestor one line high: its line height is at least its height, and its height at least its font size (ACT's exception to expectation 2) | not reported; counted |
| Cut by a `-webkit-line-clamp`, or a `title` or `aria-label` holds the full text, or the container hides other text completely (a carousel) | needs review |
| Text past the right edge of a window that does not scroll sideways (overflow hidden on `html` or `body`), inside it at 1280×1024 | needs review |
| Text below the bottom edge of a window that does not scroll down, inside it at 1280×1024 | needs review, one item with the count |
| Text of two elements that overlaps at 640×512 and did not at 1280×1024 | needs review |
| Text hidden at 640×512 and shown again at 1280×1024, with no control seen that may show it | needs review, one item per element that hides it |
| The same, with a control that may show it (a menu button) | not reported; counted, since opening it needs a click |
| Text under `aria-hidden="true"`, SVG or MathML text, text whose visible part is a 1 px window (visually hidden) | not applicable (ACT 59br37) |

Scrolling sideways at 640 px is not a 1.4.4 failure (reflow at 320 px is 1.4.10's), so content past the right edge of a window that scrolls is not reported. At most 10 findings per kind are listed; the coverage line counts the rest.

**ACT 59br37.** On its 14 test cases (2026-10-09, Edge 154), the 5 failed examples fail: three high, and Failed Examples 4 and 5 medium, since they are cut at 1280×1024 too. The 4 passed and 5 inapplicable examples have no failure. Inapplicable Example 5, a span visually hidden at 640 px, leaves one review item: text shown at 1280 px that the narrow layout hides, which is what a person should look at. ACT's wording of the exception to expectation 2 ("a used line-height equal to or greater than the height of its bounding box") would also excuse Failed Example 4, a 10 px box with 16 px text. Rampa adds that the box must be at least as tall as its font size, which keeps that example failed and Passed Example 3 (a 16 px box with a 16 px line height) passed. The test cases are not part of `pnpm test`, which runs offline; the fixtures in `test/fixtures/probes/zoom-*.html` reproduce their shapes. axe-core's `meta-viewport` and the rule for ACT b4f0c3 keep checking the viewport meta.

**Limits.** Chromium's zoom only: other browsers zoom differently, and text-only zoom (Firefox's "Zoom text only") is not emulated. Text drawn in canvas or in images is not measured. Content behind a menu button is counted, not checked, because opening it needs a click (C1). A control with no text of its own that the zoomed layout cuts, such as a text field, is not reported; lost functionality stays manual. The hidden-text check is skipped when the box budget is reached.

### 1.4.13 Content on Hover or Focus (`--probe hover`, rule `rampa/hover-content`)

**The probe.** A fresh page at the run's window size, in desktop mode, so a mouse can hover even when `--device` emulates a phone. Playwright's fake clock is installed before the page loads; time flows as usual until the probe jumps it.

**Triggers**, best candidates first, at most 30, and at most five from one style rule or of one family (the same sources, tag, first two classes and rule: twenty "Copy" buttons are one component):

- `aria-describedby` pointing to content that is not showing, or to a `role=tooltip`;
- attributes that common tooltip and popover libraries read: `data-tooltip`, `data-tip`, `data-tippy-content`, `data-bs-toggle` and `data-toggle` set to `tooltip` or `popover`, `data-balloon-pos`, `data-microtip-position`;
- `aria-haspopup` and `aria-expanded`;
- style rules on `:hover`, `:focus`, `:focus-visible` or `:focus-within` that change the display, visibility, opacity, size, position, transform, clip or content of another element (`.menu li:hover > ul`, `.field:focus + .hint`) or of the element's own `::before` or `::after`;
- elements with their own `mouseenter`, `mouseover`, `pointerenter`, `pointerover`, `focus` or `focusin` listeners, read over the DevTools protocol. An element that holds more than 50 others is a wrapper that delegates, not a trigger, and so is anything half the window's size.

`title` is the browser's own tooltip, outside the criterion, and never makes a trigger.

**Each trigger, hovered, then focused.** The trigger is scrolled to the middle of the window, the pointer rests at an edge of the window away from every trigger, focus is taken away, and what shows is recorded. Then the pointer moves onto the trigger's middle; separately, the trigger takes focus with `focus()` (for `:focus-within`, its first focusable descendant). 350 ms later the probe reads what is new:

- elements showing now that were not before, tied to the trigger: named by its `aria-describedby`, `aria-errormessage`, `aria-controls` or `aria-owns`, inside it, within three levels of its parent, or within 250 px of it on screen; at least 100 px², with text or media;
- text in the trigger's own `::before` or `::after` that was not there; its box is measured from the pixels that changed around the trigger.

When something showed, the probe measures:

1. **What it covers.** Elements that were showing before, with text of their own or media, outside the content and the trigger, whose box meets the content's by at least 4×4 px, where the browser hits the content at the middle of the overlap (with the content's `pointer-events` forced on for the test). For a pseudo-element, the box of the pixels that changed.
2. **Persistent.** The fake clock jumps 10 s, with the pointer or focus kept where it was. The content must still show.
3. **Hoverable** (hover only). The pointer goes from the trigger's middle to its edge nearest the content, then onto the content, in steps of about 8 px every 16 ms, as a hand would. The content must still show 250 ms after the pointer arrives. Content outside the window cannot be reached, and is counted.
4. **Dismissible.** Esc, with neither pointer nor focus moved. The content must be gone 250 ms later, or at the second look 600 ms later. When it stayed, the pointer and focus leave, and the probe records whether the content went away then.

A verdict that rests on content going away (persistent, hoverable) is measured twice: the content is shown again and the step repeated. The probe only moves the pointer, calls `focus()` and `blur()`, scrolls, and presses Esc; it never clicks.

**The rule.**

| Observation | Result |
|---|---|
| Content over other content still shows after Esc, and it went away when the pointer and focus left (SCR39 not met) | failure, high |
| Content went away when the pointer moved onto it, in both tries (F95) | failure, high |
| Content went away within 10 s with the pointer or focus kept, in both tries | failure, high |
| The same loss in one try of two | needs review |
| Content that does not close with Esc but covers nothing | not reported; counted, since the criterion asks for a way to dismiss only content that obscures or replaces other content |
| Content over other content that does not close, and that describes an `aria-invalid` field: maybe an input error, which the criterion exempts | needs review |
| Esc hid the content only by taking focus off the trigger | needs review |
| Content over other content that does not close and also stays when the pointer and focus leave: it may not be the trigger's (a banner, an image that loaded late) | needs review |

One finding per trigger and condition, on the trigger, saying "on hover and on focus" when both did it. The evidence names the content, where it showed and how it is positioned, what it covers, and the measured steps (gap in px, tries, seconds on the fake clock, milliseconds after Esc). At most 10 findings per condition are listed; the coverage line counts the rest, and says how many triggers were found and tried, how many showed content, how many did not close but cover nothing, and what limited the run (budgets, style sheets from other origins, listeners not read).

**Real pages.** On Bootstrap 5.3's tooltip documentation, every tooltip tried disappeared when the pointer moved onto it (6 px away, in both tries), and none closed with Esc; the ones that cover a neighbouring button or line of text were failed as not dismissible, and 10 that cover nothing were only counted. On the three pages of the cost table, no trigger showed content: gov.uk's menu buttons open on click, and Agência Brasil's hover rules only underline links and recolor icons.

**Limits.**

- Triggers the probe does not find: listeners delegated from a page-wide root (React attaches its handlers there, jQuery's `.on(event, selector)` on the document), rules in style sheets from other origins, rules written with CSS nesting (`&:hover`).
- Content that takes longer than 350 ms to show, or that shows in a pseudo-element of an element other than the trigger, is missed.
- Persistence is measured on the fake clock, so a CSS animation that hides content after a delay is not seen.
- The input-error exception is approximated by `aria-invalid`; no model reads the message. The plan's judgment that may only clear such findings is not built.
- Synthetic mouse events in Chromium only: no touch, no real screen magnifier, no other browser.
- A trigger that sits under other content (a sticky header) is hovered where it is drawn, so the pointer may land on the cover.

### The keyboard walk: 2.1.1, 2.1.2 and 3.2.1 (`--probe keyboard`)

**The probe.** A fresh page at the run's viewport (1280×800 by default) settles, then sits for 1.5 s with no key pressed: whatever it does on its own then (timers that change the address, open windows, navigate) is recorded and later subtracted from what a Tab seems to cause. The probe lists the controls Tab should reach and keeps them in the page, so a stop is tied to the element itself even if its ref shifts while the page changes. It moves the starting point to the top of the page (an autofocused field would otherwise start the walk mid-page), presses Tab until focus goes back to the document (once round the page) or the budget of 150 stops runs out, and then Shift+Tab backward the same way, with the same budget. At each stop it records the focused element (ref and identity), its box, the scroll position, the composite widget it belongs to, and, 150 ms later, where focus is then. In-page hooks record each element that receives focus (the `focus` event in the capture phase, read from the composed path so an element inside a shadow root is not mistaken for its host, and seen even when a script moves focus on in its own `focus` handler), `window.open`, form submission, `showModal`, `history.pushState` and `replaceState`; the guard records navigations and dialogs. When something that may be a change of context followed a key press, the probe takes focus away and gives it back to the element once more, and records which of those changes happened again. A walk takes about 0.25 to 0.3 s per stop on Edge.

**Suspected traps.** When focus comes back to a stop without having left the page's elements, the probe tries to leave the cycle: Tab, Shift+Tab, Esc then Tab, and each arrow key then Tab or Shift+Tab, as many presses as the cycle has elements plus two, in two rounds (a verdict that rests on an absence is measured twice).

**2.1.1 Keyboard (rule `rampa/keyboard-reach`).** A visible, enabled native control (`a[href]`, `button`, `input`, `select`, `textarea`, `summary`, `iframe`, `contenteditable`) or explicit widget role, not inert, `aria-hidden`, moved off the page or clipped out of view by its container, that neither walk reached, is a failure. Left out, as correct patterns: items of a composite widget that was reached (roving tabindex, `aria-activedescendant`), radios of a group that was reached, a link whose address a reached link also has (the duplicate image link of a card), and a control that holds a reached element. A widget none of whose items is reached is reported once. A control is judged only when it was a visible candidate with the same `tabindex` both before and after the walk, since carousels turn and panels close while a page is walked; content that changes back and forth during the walk can still mislead it. Confidence is high, and medium for an element with a negative `tabindex`, which is often a duplicate the walk cannot recognize. Handler-only candidates (a `div` with a click listener and no role) are not reported: listeners are too noisy, and they wait for the click-versus-key probe (C2). Nothing is reported when the walk did not go round the page, or, after an autofocused field, when the backward walk did not go round too.

**2.1.2 No Keyboard Trap (rule `rampa/keyboard-trap`, ACT 80af7b).** A cycle that every key failed to leave, in both rounds, is a failure, high. It goes to review instead when every element of the cycle is inside a dialog (a modal that holds focus is correct when a control inside closes it, which the observe class cannot press), or when nearby text names a way out ("press Ctrl+M"), which C2 will execute. A cycle that some key left is not reported; the coverage line says how focus left.

**3.2.1 On Focus (rule `rampa/on-focus`).** For each element the walk focused, what happened between that key press and the next, minus what the page did with no key pressed. A change counts as the element's doing only when it happened again as focus came back to the element; once, it may have been a timer that fired during the key press, and goes to review. A focus move is confirmed only when the element really took focus again (an element left inert by a modal cannot), when focusing another control does not send focus to the same place (that would be a focus trap, such as a popup that opened meanwhile), and when no window, modal or navigation of the same stop failed to repeat. A focus guard (a 0 or 1 px sentinel at the edge of a modal) that sends focus on is not reported.

| Observation | Result |
|---|---|
| a navigation (answered locally by the guard), a new window, a form submission, or a modal dialog, again when focus came back | failure, high |
| a browser dialog (`alert`, `confirm`, `prompt`), or focus moved by script outside the focused element, again when focus came back | failure, medium |
| any of those once, not again when focus came back | needs review |
| the address changed with no page load (`pushState`, `replaceState`) | needs review |
| content changed | not reported |

Evidence names the key sequence (`Tab ×4`), the element, what followed and how many milliseconds later.

**Limits.** Chromium's Tab order only, at one viewport. States reached by activating something (menus, dialogs opened by a button) are not walked. Inside a cross-origin frame the walk sees only the frame element, and stops after 60 stops inside one frame. Elements in open shadow roots are walked and matched to the snapshot, but the 2.1.1 inventory lists only the page's own document, so a control in a shadow root or a frame that Tab never reaches is not reported. An event that a page fires more than 150 ms after focus may be attributed to the next stop; the confirmation step catches most of those. The confirmation gives focus back with a script `focus()`, which runs the same handlers as a key but is not a key press. When the guard blocked requests (often analytics, sometimes data a page needs), the coverage note names their hosts: content that needed them may be missing. 2.1.1 does not test that a reached control can be operated with the keyboard; that needs the activate class (C2).

### 2.1.4 Character Key Shortcuts (`--probe shortcuts`, rule `rampa/character-key-shortcuts`)

**The probe.** A fresh page at the run's window size settles. The probe reads, over the DevTools protocol, how many `keydown`, `keyup` and `keypress` listeners the page has; with none, no key can do anything and none is pressed. It then takes focus back to the `body` and learns what the page changes on its own: three waits of 400 ms with no key, recording DOM mutations (the elements that change become noise) and the window's pixels (those that change become a mask, with a margin). Then, one at a time, with focus on the body and no modifier held, it presses each printable key: `a`–`z`, `?`, `/`, `0`–`9`, the ASCII punctuation and symbols, then `A`–`Z` (Space is left out: the browser scrolls on it). For 150 ms after each key it records:

- DOM mutations a reader would notice: nodes added or removed, text, and ARIA, `role` and state attributes (`hidden`, `open`, `checked`, `value`…); `class` and `style` changes are counted apart, since only pixels tell them from bookkeeping;
- where focus went, how far the window scrolled, whether the address changed;
- `window.open`, form submission, modal dialogs and history entries (the kit's hooks), and the navigations and browser dialogs the guard answered;
- the window's pixels, captured at half size, against the rest state, outside the noise mask.

After a key that changed something, Esc, focus back to the body and the scroll put back; a change that stays (an item added to a list) becomes the new rest state. Every twelve keys, a wait with no key keeps teaching the probe what changes on its own. Keys that changed something other than a few stray pixels are pressed a second time, the clearest first (at most 24), each right after a wait of the same length with no key.

**Settings.** The probe looks for checkboxes, switches, radios and selects whose label, legend or surrounding text speaks of shortcuts or keys (`shortcut`, `keyboard`, `hotkey`, `key`, `Ctrl`, `atalho`, `tecla`, `atajo`…), outside forms with password, card or file fields. With the shortcuts found, it gives each showing checkbox, switch or radio group focus, presses Space to toggle it, presses those keys again, and toggles it back (at most five settings and ten keys). Settings that are not showing (in a closed dialog or menu) are listed with the outermost element that hides them, and with the showing controls that may open it: those that name it in `aria-controls`, `href`, `popovertarget`, `commandfor` or `data-target`, a closed `details`' summary, and controls named for settings, shortcuts or accessibility. Selects are listed, not changed. It also records text about shortcuts ("press + to add"), `aria-keyshortcuts` values, and, on a page with at most 25 showing controls, their names.

**The rule.**

| Observation | Result |
|---|---|
| A printable key changed the page on both presses (DOM, focus, a scroll of 4 px or more, the address, a window, a submission, a dialog, a navigation, or 12 pixels or more of the half-size capture), and nothing changed in the wait with no key just before the second press | the key is a shortcut that works while no control has focus |
| Toggling a setting on the page made a shortcut stop | that key is cleared, and the coverage note names the setting |
| Shortcuts that no setting stopped | failure, medium: one finding per page, on `body`, listing the keys and what each did. The message says that a setting elsewhere (another page, the account settings) satisfies the criterion, and that the finding can then be waived |
| A key that changed the page once of two presses, or while the page also changed with no key | not counted; the coverage note says how many |
| A shortcut that works only while its control has focus (a list box's type-ahead) | not seen: focus is on the body, which is what the criterion allows |
| Ctrl, Alt or Meta with a key | not pressed: not a character key shortcut |

**"Clearly labeled" goes to a model, which may only clear.** When the probe found a setting it could not reach without a click, or a showing control that may lead to settings, the finding says so, and with judgment on, the `2.1.4` judgment (`src/criteria/character-key-shortcuts.ts`) asks the model one question: does a showing control clearly lead to a way to turn these shortcuts off or remap them, ACT ffbc54's "set of clearly labeled instruments"? The prompt lists the keys and their effects, the hidden settings, the candidate controls and the text about shortcuts. A pass must name one of the listed controls and quote page text, or it is discarded; a verified pass removes the probe's finding (the coverage note says which control cleared it), and a fail keeps it, with the model's answer in the evidence and the model named. The model never makes a finding of its own, and it is asked only when the probe left a question: on most pages it is never called. With `--no-llm`, the finding stays and the judgment is listed as not run.

**ACT ffbc54.** On its 10 test cases (2026-10-09, Edge 154, online), with `ollama:gemma4:12b` answering the one question, both failed examples fail and none of the 6 passed and 2 inapplicable examples is flagged. Passed Examples 1 to 4 pass because Space on their checkbox stopped the key (a remap to Ctrl, or a switch that turns it off); Passed Example 5's shortcut works only while its field has focus, so the probe never sees it; the inapplicable examples use Escape or Ctrl. Passed Example 6 and Failed Example 2 differ only in the button that opens the dialog holding the settings: the model cleared the first ("Control shortcuts", with the text "To control the shortcuts activate the Control shortcuts button") and kept the second ("Open modal"). Without a model (`--no-llm`), Passed Example 6 keeps its finding: 2 of 2 failed examples found, 1 of 8 others flagged. Each page took 25 to 33 s on a loaded machine. The test cases are not part of `pnpm test`, which runs offline; the fixtures in `test/fixtures/probes/shortcuts-*.html` reproduce their shapes, with a clock that ticks on its own, a switch, a list box that types ahead only on focus, a key that navigates and a setting that does nothing.

**Real pages.** rampa.guilhermebs.com.br registers no key listener, so no key was pressed: right, the site has no shortcuts. On github.com/guilhermebsantiago/rampa-cli, signed out, `/` and `s` (search), `w` (the branch filter), `t` (the file finder), `k` (the file list) and `,` (a new window) work with focus on the page; `y` changed the address on one press of two (the second finds it already changed) and is not counted. The model, asked about "Appearance settings" and the notification settings link, found no control that clearly leads to turning the shortcuts off. That is right for the page: GitHub's switch for character keys is in the account's accessibility settings, behind a sign-in, which is the case the message tells you to waive. On MDN's `<kbd>` page, `/` opens the search dialog and nothing on the page turns it off: the finding looks right. Of 8 runs on GitHub, 6 found the shortcuts and 2 found none (three keys changed the page on one press of two); both were before the probe waited for the network to go quiet, and the cause is not established.

**Limits.**

- One engine and one window size; keys go to the top document, so shortcuts inside a cross-origin frame (an embedded player) are not seen.
- Settings behind a click, on another page or behind a login are not exercised: only the model's "clearly labeled" reading can clear such a finding, and a person waives one the page satisfies elsewhere.
- A key's effect must show within 150 ms; slower effects (a fetch before anything renders) may be missed, or counted once of two presses.
- A page that changes on its own all the time (a ticker, a video) masks what keys do in those regions; keys that changed it while it also changed with no key are not counted.
- Sequences (`g` then `i`), keyboard layouts other than US English, dead keys and IMEs are not tried. A shortcut that focuses a field without calling `preventDefault` lets the browser put its character in the field; the probe takes focus back before the next key.
- Settings are found by their wording, in English, Portuguese and Spanish with a few French and German words; a setting named otherwise is not tried.

### 2.4.4 Link Purpose: where scripted links lead (`--probe links`, rule `rampa/scripted-links`)

**Only when named.** `--probe links` clicks things, so `--probe all` leaves it out; `--probe interact` runs it with the shortcuts probe. It is the coverage plan's C1, the first probe on the activate-class harness (above).

**The probe.** A scripted link is a link whose address says nothing of where it goes: `href="#"`, an empty `href`, a `javascript:` address, a `#fragment` that names nothing on the page (`#top` is the top, and a fragment that names an element is an in-page link, both left out; a single-page app's route such as `#/about` is tried), or an element with `role="link"` and no address. Each one that shows and has a name is listed (at most 100), those of the content first, then those in menus, header and footer. Each one the skip list allows, within the budget (30 clicks, 90 s), is scrolled to the middle of the window, hit-tested, and clicked once at its middle with a trusted mouse click. For at least 0.5 s, and until the page has been quiet for 300 ms outside what it changes on its own (at most 2.5 s more, and 1 s more when nothing happened yet, for a script that navigates late), the probe records what the click did, the strongest effect first:

| Outcome | What happened | What 2.4.4 gets |
|---|---|---|
| `submit` | a form was submitted (cancelled) | "it submits a form" |
| `new-window` | `window.open` or a popup, with its address | the address, read like a link's |
| `navigation` | a navigation to another document, intercepted before any request | the address, read like a link's |
| `download` | a download, intercepted | the address, read like a link's (its type and size) |
| `route` | the address changed in place (`pushState`, or a `#/route`) | the address, and the title and first heading the page showed then |
| `dialog` | a browser dialog (`alert`, `confirm`), dismissed | its text |
| `opened` | a dialog or a fixed layer over a quarter of the window showed; its controls are not exercised | its name |
| `fragment` | the address's fragment changed to one that names an element | the text where it points, as for a `#part` link |
| `content` | the page changed in place (a menu opened) | nothing |
| `nothing` | nothing seen (a placeholder `href="#"` scrolls to the top) | nothing |

A link under another layer is not exercised, and the layer is named; a link the page no longer has on a fresh load (its ref or identity changed) is unmatched. Then, at collection, with `--follow-links` (same origin by default) and the judgment on, the addresses of `navigation`, `new-window` and `download` outcomes are read like any link's into `snapshot.destinations`, keyed by the address.

**What 2.4.4 does with it.** The judgment (`src/criteria/link-purpose.ts`) reads the links probe's facts for each link whose ref and identity match: the prompt says what activating the link does ("it goes to https://…", "it opens a new window at …", "it changes the address to … and shows other content in place", "it opens a dialog or layer that reads …"), then what was read there, as for a real `href`. The address also counts as the link's place when links that share a text are compared (ACT fd3a94). Verification is unchanged: a `mismatch` needs a destination that was read (a title or main heading that is not the site's name and not a not-found page), and an `ambiguous` needs other links with the same text that lead elsewhere from the same context. Without the probe, a scripted link has no known destination, so such claims are discarded.

**The rule** decides nothing: `rampa/scripted-links` is an inventory. Its coverage line under 2.4.4 says how many scripted links were found and clicked, what they did, which the skip list kept out and why, and which were not exercised; it never makes 2.4.4 "probed" or "no failure found", and with `--no-llm` 2.4.4 stays not checked.

**ACT rules.** On 2026-10-11 (Edge 155, online, `--criteria 2.4.4 --model ollama:gemma4:12b`), on the seven test cases of the 2.4.4 rules that use scripted links, with and without the probe:

| Test case | Expected | Without the probe | With `--probe links` |
|---|---|---|---|
| fd3a94 Failed Example 6: two `role="link"` "Contact Us" spans to two pages | failed | no finding (no destination known) | both found: shared by 2 links that lead to 2 different places |
| fd3a94 Passed Example 7: two "My university" spans to the same page | passed | 2 findings (generic text) | none: both lead to the same place, read as the university's page |
| fd3a94 Inapplicable Example 4: spans with `onclick` and no role | inapplicable | none | none (not links, never clicked) |
| 5effbb Failed Example 2: `div role="link"` "More" to `#main` | failed | found (generic) | found (generic), with the part it moves to |
| 5effbb Passed Example 4: `span role="link"` to `#desc` | passed | none | none |
| c487ae Passed Example 2: `div role="link"` to the WAI home | passed | none | none |
| c487ae Passed Example 3: `button role="link"` "Click me for WAI!" | passed | none | one, low confidence (below the default threshold): the model read "Click me for WAI!" as generic once it saw the WAI home page |

c487ae only asks for a name, so its passed examples say nothing about purpose; the one new finding is the model's reading of the text, with the right destination in the prompt. The test cases are not part of `pnpm test`, which runs offline.

**Fixtures** (`test/fixtures/probes/links-*.html`, served over HTTP by the tests):

- `links-scripted.html`: a "Pricing" link whose handler goes to a blog post ("Launch week recap"), a `javascript:` link behind an analytics call, a `role="link"` span that opens a window, a link that sets an address in place, a span that moves to `#desc`, a "Sign in" link that opens a modal dialog (not exercised; the next link gets a fresh page), a placeholder `href="#"`, two "Contact" spans that go to two pages, and a clock that ticks on its own (learned as noise). With `ollama:gemma4:12b`, "Pricing" fails as a mismatch with the blog post read at its address, and both "Contact" spans as ambiguous; without the probe, the mismatch is discarded and the spans pass.
- `links-destructive.html`: ten scripted links that must never be touched, each of which reports to `/touched` if clicked: "Delete account", `javascript:removeItem(3)`, "Sair", a `btn-unsubscribe` class, "Comprar agora", "Eliminar", `data-method="post"`, a `download`, a `target="_blank"`, and a link inside a form with a password field. The test checks that none is clicked, that each skip is logged with its reason, that the server never received a request for `/touched`, and that the guard's log holds exactly the one POST a harmless link tried (blocked) and the one navigation another started (intercepted).
- `links-overlay.html`: a cookie wall over the page: the story link under it is not exercised (the wall is named), "Accept all" is never pressed, "Cookie settings" is clicked.

**Real pages** (2026-10-11, one run each, `--criteria 2.4.4 --model ollama:gemma4:12b`, with and without the probe):

| Page | What the probe did | 2.4.4 | Read by hand |
|---|---|---|---|
| www.w3.org, the APG link example | its three `role="link"` examples clicked: two go to www.w3.org, the third (named "W3C website" by `aria-label`) to the APG itself | no finding either way; with the probe, one `ambiguous` claim on the third discarded, as its table cell tells it apart | Right: the third example's address in the page's own script is the APG (`goToLink(event, 'https://www.w3.org/TR/wai-aria-practices/')`) |
| www.ufc.br | "Canal UFCInforma no Whatsapp" has `href=""`: its click goes back to the home page; its copy in the footer is under the cookie banner, not exercised | no finding either way; with the probe, the model's `mismatch` on the WhatsApp link discarded, as its destination is the page itself | Right: an empty `href` is a broken link, which is never a 2.4.4 finding |

On www.camara.leg.br the six scripted links are menu toggles written as `href="#"`: each opened its menu in place (`content`), and each next one got a fresh page; nothing went to 2.4.4. That is right for 2.4.4, and a sign that they are buttons in a link's role (4.1.2), which this probe does not report.

**Limits.**

- Only links that show on load: a link inside a menu that must be opened first is never reached, since the harness never clicks one control to get to another.
- One click, with the mouse; a link that reacts only to Enter does nothing here.
- A navigation started more than about 4 s after the click is missed.
- Destinations are read without cookies, as for any link: a destination behind a sign-in reads as unknown.
- Links in frames and in shadow roots are not listed.
- One engine (Chromium).

### 3.2.2 On Input (`--probe input`, rule `rampa/on-input`)

**Only when named.** `--probe input` changes the values of form controls, so `--probe all` leaves it out; `--probe interact` runs it with the shortcuts and links probes. It is the coverage plan's C11, on the activate-class harness (above).

**The probe.** It lists the form controls that show: selects, checkboxes, radio groups (once per group), text, search, e-mail, address, telephone and number fields, sliders, date, time, month and week fields, and text areas. A checkbox or radio hidden behind a styled label counts through its label; read-only fields, hidden inputs, buttons and color pickers are left out. At most 40 are changed, within 180 s, each on a fresh load of its own (a new browser context). The skip list applies: password and file fields, anything in a form with password, file or payment fields, and destructive or account-changing names ("Delete my account", "Unsubscribe from all e-mails", "Excluir meus dados"); so does a select or radio group whose other options all have such names. For each control:

1. It is found again by ref and identity, scrolled to the middle of the window and hit-tested: under another layer, it is not exercised and the layer is named.
2. It gets focus with `focus()` (what focus alone does is 3.2.1's), then 0.8 s pass with no input: what happens then is the page's own doing, never credited to the change.
3. Its value changes the least surprising way: a select gets the next enabled option that is not destructive (set as a browser does, with `input` and then `change`); a checkbox gets Space; a radio group, Space on another radio of the group; a styled checkbox or radio, a click on its label; a text field or text area, one letter typed (`a`), or one digit (`1`) when it takes digits (`type="tel"`, `type="number"`, `inputmode="numeric"`); a slider, one arrow key; a date or time, ArrowUp.
4. The harness's window records what followed, until the page is quiet (as for links: at least 0.5 s, 300 ms quiet outside the noise, at most about 4 s).
5. A text field, number or date is then left with `blur()`, which fires its `change` event, and a second window records what that did.
6. When a change of context followed, the same change is made on a second fresh load (at most 10 per page).

The probe also records the texts that may warn of what a change does: around each control, its label, description, legend, the text of its own block (up to the first ancestor that holds another control) and the blocks of text just before it; and, anywhere on the page, sentences that speak of such changes ("reload", "new window", "redirect", "automatically", "recarrega", "nova janela", "automaticamente", "nueva ventana"…). It never presses Enter and never submits: a navigation is intercepted, a window is not opened, a submission is cancelled, and each is logged.

**The rule.** A change of context is what WCAG's definition says: a change of user agent, viewport or focus, or of content that changes the meaning of the page. A change of content alone is not one, and the Understanding's own example (a calendar form that shows other fields for another entry type) passes.

| Observation | Result |
|---|---|
| A navigation, a new window, a submission or a modal dialog as the value changes, nothing like it in the wait with no input, and again on a second load (F36, F37) | failure, high |
| The same only once the field is left after the change (its `change` event) | failure, medium |
| A browser dialog (`alert`, `confirm`), or focus moved by the page to another element as the value changes (the Understanding's phone-number example, unless the form says so), again on a second load | failure, medium |
| Any of those once of two loads, or not tried again (budget) | needs review |
| The address changed in place (`pushState`), most of the page's text changed, a layer that is not modal showed, or focus went back to the document | needs review: whether that changes the context needs a person |
| A field that shows, a price that updates, suggestions under a field, a section that hides | not reported: a change of content |
| The same change of context in the wait with no input | not counted: the page's own doing |
| The value did not change (a widget that refused the key) | not counted |

It never reports a form for having no submit button: a button is one way to meet the criterion (G80), not a requirement. Each finding names the control, what the probe did and what followed, with the address or the dialog, and the texts around it; at most one per control.

**"Advised before using the component" goes to a model, which may only clear.** The criterion is met when the person was told before using the control (G13): "Selecting a country reloads the page", "(opens in a new window)". Rampa cannot tell an instruction from other text, so with judgment on, the 3.2.2 judgment (`src/criteria/on-input.ts`) reads, for each failure, the texts around the control and the page's sentences about such changes, and decides whether one tells the person, before they use this control, what the change will do. A pass must quote one of the listed texts (at least 10 characters, so a bare label such as "Country" never counts) or it is discarded; a verified pass clears the finding, and the coverage note quotes the warning. A fail keeps the finding, with the model named. The model never makes a finding of its own, and it is asked only for failures. With `--no-llm`, every failure stays, and the message says that a warning on the page meets the criterion and the finding can be waived.

**Fixtures** (`test/fixtures/probes/input-*.html`, served over HTTP by the tests; no ACT rule exists for 3.2.2):

- `input-fail.html`: a jump menu of countries that goes to the country's page, a checkbox that opens a window, a radio group that submits its form, an area code field that moves focus to the next field on the first digit, a language select that opens a modal dialog, a page number that goes to the page when it is left, a view select that swaps the catalog and the address in place (review), and a clock that ticks on its own. Six failures, one item to review; the server sees nothing but the page's own loads.
- `input-pass.html`: an "Other" option that shows a field, a checkbox that hides the shipping address, a city field with suggestions, a plan that updates its price, a section select with a Go button, a slider, a date and a text area. Nothing is reported.
- `input-notice.html`: a country select whose change reloads the page, under "Selecting a country reloads the page with prices in its currency."; a checkbox labeled "Show the terms (opens in a new window)"; and a currency select with no warning. Without a model, three failures; with `ollama:gemma4:12b`, the first two are cleared, each with its warning quoted, and the currency select stays.
- `input-destructive.html`: "Delete my account", "Unsubscribe from all e-mails" and "Excluir meus dados" checkboxes, a bulk-action select whose other options are "Delete" and "Archive", a sign-in form (e-mail, password, "Remember me"), and a file field, each of which reports to `/touched` if changed; and a theme select whose change tries a POST. The test checks that only the theme select is changed, that the server never received a request for `/touched`, and that the guard's log holds exactly the one POST, blocked.

**Real pages** (2026-10-11, one run each, Edge 155, `--probe input`, judgment by `ollama:gemma4:12b`):

| Page | Controls changed | Findings | Read by hand |
|---|---|---|---|
| www.w3.org/WAI/demos/bad/before/tickets.html (the W3C's inaccessible demo) | 1, the "QUICKMENU" select | 1 failure, high: choosing "Broadcasting" goes to another page at once, again on a second load; the model found no warning, and kept it | Right: the demo's quick menu navigates on change, which its accessible version fixes |
| www.w3.org/WAI/demos/bad/after/tickets.html (the fixed demo) | 1, "Explore Site by Topic" | none | Right: the menu goes nowhere until its Go button is pressed |
| www.camara.leg.br/deputados/quem-sao | 6: a name field, the party, state, legislature and sex selects, and a combobox field | none | Right: the search runs only from its "Buscar" button. The combobox field did not take the typed letter (counted as "did not take the change") |
| www.gov.uk/search/all | 1, the search field (its filters are collapsed, not showing) | none | Right: typing changes nothing until the search is submitted |

The plan's gate asks for a targeted corpus of pages that change the context on input (jump menus, auto-submitting filters), which has not been gathered.

**Limits.**

- One change per control: the next option, one character, one key. A change that only some values make (one country with its own page, a field that submits once it is full, F36's "last field given a value") is missed.
- Custom widgets (ARIA comboboxes, listboxes and switches built from other elements) are not changed; they stay manual, as the plan says.
- Forms with password, file or payment fields are never touched, which leaves sign-in and checkout forms to a person.
- A warning is read by the model from the text near the control and the page's sentences about such changes; a warning placed far from the control in other words, or given by an icon, may be missed, and the finding then needs a waiver.
- A change of context more than about 4 s after the input is missed.
- Each control costs a page load, two when it changed the context: 40 controls on a slow page reach the time budget.
- Controls in frames and in shadow roots are not listed. One engine (Chromium).

### 3.3.8 Accessible Authentication (Minimum) (`--probe auth`, rule `rampa/accessible-authentication`)

**Only when named.** `--probe auth` types into the password fields of real sign-in forms (a dummy value, cleared right after), so `--probe all` leaves it out: run it on pages you are allowed to test, as with every probe. It is the coverage plan's B7 and the cognitive profile plan's WI-12.

**The probe.** A fresh page at the run's window size. Sign-in pages often bounce through other addresses on load (an SSO, a bot check that sends itself on): the probe follows the page's own navigations, and the forms it submits by itself with GET, until it has gone 1.5 s without navigating and shows something (a page with next to no text and no control is still loading), at most 15 s. A page that keeps navigating or computing is not probed, and the record says so. Only then does the guard arm, as for every probe. POST requests are blocked all along. The address it landed on is recorded. The probe then reads:

- **Steps.** Each form (or the element that holds fields and a button) with a password field (`type=password`, `autocomplete="current-password"`, or a text field drawn as dots), a one-time code (`autocomplete="one-time-code"`, words such as "verification code", "código de verificação", "2FA", or four to twelve short boxes side by side), fields for some characters of a secret, or only an identifier under words of sign-in ("Sign in", "Entrar", "Acessar", "Identifique-se"). Its kind: a sign-in, a recovery ("Forgot your password?", "Esqueci minha senha", "Redefinir"), a sign-up (`autocomplete="new-password"` on every password, two password fields, "Create account", "Cadastre-se") or a change of password. Sign-up and change of password are recorded and left out: the Understanding leaves account creation out of 3.3.8. A newsletter's e-mail field is not a step. A step that is not showing (a closed menu or dialog) is listed and never opened.
- **A trusted paste into each password and code field** (`src/probes/clipboard.ts`). The probe writes a dummy value to the clipboard (`Rampa-probe-7319`, or digits for a code or a numeric field, cut to its `maxlength` or its number of boxes), gives the field focus, and presses the real Ctrl+V (Cmd+V on macOS). The browser runs its own paste: the page gets a trusted `paste` event and a `beforeinput` of type `insertFromPaste`. No synthetic `ClipboardEvent` is ever dispatched: it carries no data the browser inserts, so a field that trims what is pasted, or spreads a code across boxes, would look blocked. The value counts as arrived when the field (or its boxes, joined) holds it, spaces, dashes, dots and case aside. A paste that did not arrive is tried a second time, then one key is typed (`a`, or `7` for a code), to tell a field that refuses pastes from one that refuses all input. The field gets its value back afterwards. The record keeps the events the page received, whether a handler cancelled them, and the field's `paste`, `beforeinput`, `input` and key listeners, read over the DevTools protocol. A browser has one clipboard for all its pages (headless Chromium keeps its own, apart from the system's), so pastes take turns per browser, and the clipboard's earlier text is put back.
- **Read-only fields.** A field read-only when the page loads that stays read-only once it takes focus (pages that lift `readonly` on focus to keep autofill away are pasted into as usual), with the on-screen keypad next to it: at least five buttons of one digit, or of two ("1 ou 7"), within two levels of the step.
- **Text that asks a cognitive function test**, quoted: some characters of a secret ("Enter the 2nd, 6th and last characters of your password", "Digite o 3º e o 5º dígitos", or fields labeled for positions such as 2, 6 and last, F109); a calculation ("Quanto é 3 + 4?", "What is 5 plus 2?"); and an image CAPTCHA (a picture named for it next to a field to type it into, or "Type the characters you see in the image"). A code split in boxes labeled 1 to N asks for the whole code, not some of it.
- **CAPTCHA widgets**, classified and never clicked or solved: reCAPTCHA's checkbox and hCaptcha (a challenge of recognizing objects, which 3.3.8 excepts at AA), invisible reCAPTCHA, reCAPTCHA v3, invisible hCaptcha, Turnstile and Friendly Captcha (they ask nothing), Arkose and GeeTest (puzzles: unknown), and a bot check that covers the page instead of its content (DataDome, HUMAN, a "Just a moment" challenge).
- **Other ways to sign in** near a step (a passkey or security key, "Sign in with…", "Continue with…", "Entrar com gov.br", "Email me a link", "Login com QR code", "Certificado digital"), and links to sign-in and recovery pages, which the probe does not follow.
- **Attributes that may keep password managers away**: `autocomplete="off"` on a password field, `autocomplete="new-password"` on a sign-in password or identifier, `data-lpignore`, `data-1p-ignore`, `data-bwignore`, `data-form-type="other"`, and a text field drawn as dots.

It never presses Enter, never clicks, and never submits: a field that sends itself when it is full meets the guard, which blocks the POST and cancels the form's submission.

**The rule.**

| Observation | Result |
|---|---|
| A password or code field of a sign-in or recovery step that a trusted paste did not reach, twice, while a typed key did | failure, high (F109; H100) |
| A code asked one character per box, where pasting the whole code fills only some of the boxes | failure, high (the Understanding's own example; F109) |
| A read-only password field next to an on-screen keypad | failure, high |
| Text that asks for some characters of a secret, a calculation, or the transcription of an image CAPTCHA | failure, medium; the 3.3.8 judgment may clear it |
| Any of those when the page offers another way to sign in near the step | needs review: the Alternative exception may apply, and Rampa does not follow it |
| A field that took neither a paste nor a key, or that is read-only with no keypad found | needs review |
| Attributes that may keep password managers away | needs review, low |
| A CAPTCHA that may ask a puzzle (Arkose, GeeTest) | needs review, low |
| An object-recognition CAPTCHA, a CAPTCHA that asks nothing, a field that took the paste, a step that asks only for an identifier, sign-up and change-password forms | not reported; counted in the coverage note |
| No sign-in or recovery step on the page | "no applicable content", with the links to sign-in pages it found; "not checked" when a bot check covered the page, a step was not showing, the page went elsewhere right after it loaded, or what the probe read is not in the snapshot (the note says to use `--wait-for` with a selector of the form) |

3.3.8 is new in WCAG 2.2, Rampa's default target. Under `--wcag 2.1` its results are beyond the target and never count toward the exit code.

**The judgment** (`src/criteria/accessible-authentication.ts`), with a model, only when the probe quoted a cognitive test in a step with no other way to sign in. The model reads the step's visible texts and decides whether the step asks the person a cognitive function test (the definition and the exceptions are in the prompt): a fail keeps the finding, with the kind of test and the model's quote in its evidence; a pass (the text is help, an example, or a test of recognizing objects or the person's own pictures) clears it, and the coverage note says so. Either answer must quote text the step shows, or it is discarded. The model never makes a finding of its own. On `auth-cognitive.html`, `ollama:gemma4:12b` kept all three, quoting each.

**Fixtures** (the cognitive plan's critique asked for the first four):

- `auth-pass.html`: a plain sign-in marked up as H100 asks; a code field whose `paste` handler trims the pasted value (a synthetic paste event would carry nothing and look blocked); a six-box code whose `paste` handler spreads the code across the boxes; a password field read-only until it takes focus; and a reCAPTCHA checkbox. Nothing is reported.
- `auth-fail.html`: a `beforeinput` handler that cancels `insertFromPaste`; `onpaste="return false"` on a code field; a six-box code with no paste handler, whose paste fills one box; and a read-only password filled by a keypad of paired digits. Each fails once.
- `auth-cognitive.html`: "Enter the 2nd, 6th and last characters of your password" with three one-character fields, "Quanto é 3 + 4?", and an image CAPTCHA with "Type the characters you see in the image". Each fails once, quoted.
- `auth-near.html`: a sign-up form that blocks pastes (left out), a sign-in that blocks pastes next to "Sign in with a passkey" (review), `autocomplete="off"` on a password that takes pastes (review), a newsletter, a recovery form that asks only for an e-mail, help text that names a length ("needs 8 characters"), and a sign-in form in a closed dialog (listed, not opened). No failure.
- `auth-redirect.html`: a page that submits a form to the sign-in page right after it loads; the probe follows it and pastes there.

No ACT rule exists for 3.3.8.

**Real pages.** On 2026-10-10, with `--probe auth --no-llm --min-confidence low` (Edge 154), nothing submitted:

| Page | Read | Findings | Read by hand |
|---|---|---|---|
| github.com/login | one sign-in step; the password field took the paste; "Continue with Google", "Continue with Apple", "Sign in with a passkey"; a link to "Forgot password?" | none | Right: the password field is `type=password` with `autocomplete="current-password"`, takes a trusted paste, and has no handler that blocks it. The guard blocked two analytics beacons on load, not the probe's doing |
| sso.acesso.gov.br/login, with `--wait-for "#accountId"` | the page bounced through servicos.acesso.gov.br and landed on the sign-in form, which asks for the CPF first; invisible hCaptcha; "Login com seu banco", "Login com QR code", "Seu certificado digital" | 1 to review: `autocomplete="new-password"` on the CPF field | Right: the CPF field is `type=tel` with `autocomplete="new-password"`, a common way to keep autofill off, which also asks password managers not to fill the saved identifier. The password step comes after "Continuar", which Rampa never presses. Without `--wait-for`, the collector reads the page before the redirects end and the probe's facts match nothing in the snapshot: 3.3.8 is "not checked", and the note says to run again with `--wait-for`. Seven runs with `--wait-for` gave the same result, and one printed nothing for 3.3.8 |
| github.com/password_reset | a DataDome bot check in place of the page, in headless Edge | none; not checked | Right: the page was not shown; the note names the bot check |

**Limits.**

- Steps behind a submit are not reached: the password step of an identifier-first sign-in (gov.br, Google, Microsoft), a code sent after a password, security questions. Rampa never submits a form (the plan's D5 would, with `--allow-submit` on test origins).
- What a field does with a paste is read from its value: a field that takes the paste and then clears it on submit, or one whose paste works only with a real system clipboard, is not seen as blocking.
- The keypad is found by digit buttons near the field; a keypad drawn in a canvas or with images of digits is not, and the field goes to review.
- Cognitive tests are found by wording in English, Portuguese and Spanish; a test worded otherwise, or drawn in an image, is missed. CAPTCHAs are classified by vendor and markup, not by the challenge they may show.
- The Alternative exception is only noticed (a button or link worded as one), never followed: a failure next to an alternative goes to review.
- Password managers themselves are not run; the attributes that may keep them away go to review.
- With `--crawl`, probes do not run, so the crawl does not find and probe sign-in pages yet; the links the probe lists say where to run it.
- One engine (Chromium), headless; pages that refuse headless browsers show a bot check, reported as not checked.

### 2.3.1 Three Flashes or Below Threshold (`--probe flash`, rule `rampa/three-flashes`)

**Only when named.** `--probe flash` plays the page's videos (muted) and takes some 200 captures of the window, so `--probe all` leaves it out, like `auth`. It is item D1 of the plan: one analyzer, measured failures only, no vision model and no certification claim (a "PEAT pass" or "Harding pass" needs those tools and a person).

**WCAG's thresholds, as Rampa measures them** (`src/pixels/flash.ts`):

- A **general flash** is a pair of opposing changes in relative luminance of 10% or more of the maximum (0.1), where the darker state is below 0.80. A transition is the change between a peak and a valley of luminance over time (the Understanding for 2.3.1), so the analyzer follows each spot's luminance and counts a transition when it has moved 0.1 from its last peak or valley in the other direction: a slow fade counts once, however many frames it takes.
- A **red flash** is a pair of opposing transitions involving a saturated red: one state has R/(R + G + B) of 0.8 or more (on the 8-bit sRGB values), and the two states are more than 0.2 apart in CIE 1976 u′v′ chromaticity (WCAG 2.2's definition). Black, which has no chromaticity, counts as the white point. Red against a gray of the same luminance is a red flash and no general flash; red against orange is neither.
- **More than three flashes in one second** is seven transitions or more within one second (three flashes are six). Transitions taken from samples (window captures every 16 ms, video frames) are known only to a sample, so the window is shortened by the median step between frames: content at exactly three flashes a second is never counted as more for when its frames happened to be taken. The frames of an animated image are the moments it changes, timed exactly.
- **Area.** WCAG allows flashing over no more than 25% of a 10° visual field, which it estimates as a 341 × 256 rectangle on a 1024 × 768 screen; the Understanding counts "the contiguous area flashing at the same time within any 10-degree angle of view". Frames are reduced to grids of cells of 4 × 4 CSS px (larger for large images and videos, at most 96 cells across), each the average of its pixels; the cells that make seven transitions or more in the same one-second window form connected regions, and each region's largest share of one 341 × 256 field is its area. Two small regions apart are not added up. Averaging is also why a fine balanced pattern (a small checkerboard that inverts, squares under 0.1°) does not count, as the Understanding says it should not.

The probe runs in a 1024 × 768 window, the screen the 341 × 256 field is defined on, in desktop mode.

**What it reads.**

- **Animated images**: every `img` and every CSS background image that shows (at most 60 read, 12 analyzed). Their bytes are fetched once more with GET (the context's cookies, and `--header` only for the site being checked, as for the page; `data:` addresses read in place; `file:` images only next to a `file:` page). A GIF with two graphic control blocks or more, a PNG with an `acTL` chunk (APNG) or a WebP with an `ANIM` chunk is decoded by the browser's `ImageDecoder`, in a page of its own on an https address answered locally (WebCodecs needs a secure context), each frame drawn at the size the page shows it, transparent pixels over white. Each frame lasts its own duration, 10 ms or less counting as 100 ms, as Chromium plays it; a looping image is analyzed while looping (the Understanding asks for that), over twice its loop or 2 s, at most 6 s.
- **Video**: each `video` that shows (at most 3) is muted, then played, and each frame the browser presents (`requestVideoFrameCallback`) is drawn into a small canvas and read, for 3 s of media time, waiting at most 9 s of real time. Its sound is never turned on, and Playwright's headless browsers run with `--mute-audio` besides. A video from another origin served without CORS cannot be read: it is named in the coverage note, never failed. A video with native controls is also analyzed at the size full screen would give it in the 1024 × 768 screen ("video that plays full screen should be checked at full screen").
- **Everything else on screen**: the window is captured at a quarter scale through the DevTools protocol (a pixel per 4 × 4 CSS px), every 16 ms of the page's own time, for 3 s. Playwright's fake clock, installed before the page loads, is paused, and each step moves it 16 ms: timers and `requestAnimationFrame` run as they would, so canvases and scripts that restyle the page draw where they would be at that instant, however slow the machine. CSS animations and transitions (`document.getAnimations()`, including those a script starts meanwhile) are paused and set to each instant; SVG animations through `setCurrentTime`. Videos are paused and, with the animated images, left out of these captures (masked), since they play on their own clock and are read apart. The top of the page is captured; then up to two more windows, 2 s each, for canvases and animations further down that the first does not show.

**The rule.**

| Observation | Result |
|---|---|
| An area of the window, an animated image or a video makes seven general transitions or more within one second, over more than 21,824 CSS px² (25%) of one 341 × 256 field | failure: high for window captures and images; medium for a video whose sampling missed frames |
| The same for red transitions | failure, named as red flashes |
| A video that passes at its size but fails at full screen | failure, medium, saying "when shown full screen" |
| More than three flashes a second over a smaller area, or three or fewer over any area | no failure found (below the threshold); the record keeps the most transitions and the area |
| An animated image or a video that could not be read (another origin without CORS, not fetched again, no frames) | named in the coverage note, never failed |
| Nothing analyzed at all | "not checked" |

A finding names the image or the video, or, for a window capture, the element at the middle of the area that flashes (a canvas, an animated `div`), else the page's `body`. Its evidence gives the source, the frames, the second the flashes happened in (start, end, first and last frame), the transitions and the area, as a share of the field. The record keeps, for each source, the most transitions any spot made in one second and the largest area that made seven or more, for general and for red flashes, so a saved snapshot is judged again offline. The definitions the probe applied are recorded with it.

**Fixtures** (made in `test/probes-flash.test.ts` and served from memory; the video is `test/fixtures/probes/media/flash.webm`, written by `node scripts/media-fixtures.ts flash`):

- canvases drawn by `requestAnimationFrame`: 600 × 400 at 2 Hz and 40 × 40 at 5 Hz pass; 600 × 400 at 5 Hz fails; 600 × 400 alternating `#ff0000` and `#7f7f7f` (the same luminance) at 5 Hz fails as a red flash only;
- a CSS animation (`steps(1)`, 200 ms) on a 500 × 360 element fails: it is set to each instant, not played;
- two looping GIFs made with gifenc, black and white frames of 100 ms: shown at 400 × 300 it fails, at 32 × 32 it passes;
- a 3 s video, 30 frames a second, black and white every 100 ms, shown at 480 × 360, played muted: fails.

The analyzer's own tests add 3 Hz (six transitions, passes), 4 Hz (eight), a fade, two small regions apart, and changes between two bright colors. No ACT rule exists for 2.3.1; EA's IRIS, which the plan names for a cross-check, has not been run against these fixtures yet.

**Real pages.** On 2026-10-11, with `--probe flash --no-llm --min-confidence low` (Edge 155):

| Page | Read | Findings | Read by hand |
|---|---|---|---|
| rampa.guilhermebs.com.br | 2 CSS animations and a canvas; one window, 188 captures | none: one transition at most | Right: nothing on the page flashes |
| en.wikipedia.org/wiki/GIF | 24 images, 6 animated GIFs decoded (the rotating Earth, a Newton's cradle, an under-construction bulldozer, an interlaced GIF demo…); one window | none: up to 12 transitions a second, over 16 to 400 px² | Right: small moving parts (the cradle's balls, the edge of the globe) change fast over a few cells; nothing flashes over an area near the threshold |
| animate.style | 3 CSS animations; one window | none: 9 transitions over 32 px² | Right: the page's animations move small areas; nothing flashes |
| ableplayer.github.io, demo video1 | one video, 640 × 480, sampled 91 frames over 3 s with no frame missed | none: 6 transitions at most | Right: a person talking; no flashing |

None of these pages flashes, so they show no false positive, not that failures are found on real pages; the plan's gate asks for a targeted corpus of pages that do flash, which has not been gathered (they are rare, and most hosts remove them).

**Cost.** 6 to 11 s on the pages above (one window of 3 s at 16 ms steps takes about 4 s of real time: some 20 ms per capture; decoding the GIFs took most of the rest on Wikipedia; a video adds its 3 s). The probe stops at 60 s, analyzing what it has.

**Limits.**

- Frames are the page's, in Chromium: the browser's frame rate and the screen's are not modeled, and content that flashes faster than every 16 ms of page time is sampled, not seen frame by frame.
- Only the top of the page and up to two more windows are captured, for 3 s and 2 s; flashing that starts later, after an interaction, or further down past the canvases and animations found, is not seen. Content in frames of another origin is captured as rendered, but its animations are not seeked, so it plays in real time between captures.
- Cross-origin video without CORS, DRM-protected video, and players in frames of another origin are not read; YouTube embeds are among them. Videos are read for their first 3 s only.
- Images that a script swaps (a slideshow drawn by replacing `src`) are seen in the window captures; CSS background GIFs are read when their address can be fetched again.
- The red flash uses WCAG 2.2's working definition on 8-bit sRGB values; HDR content and its Michelson-contrast definition are not handled.
- Scrolling content and moving high-contrast patterns are counted as transitions where each spot changes; WCAG's thresholds speak of flashes, and such patterns over a large area would be reported. No pattern rule (stripes, spirals) is applied.

### 2.4.7 Focus Visible and 2.4.11 Focus Not Obscured (`--probe keyboard`)

These ride on the keyboard walk (probe version 2). The walk turns off animated scrolling (`scroll-behavior: auto`) and, before measuring a stop, waits for scrolling to stop (at most 1.5 s), so a page that scrolls with a library is measured where it lands.

**2.4.7, the probe.** At each forward stop, the element's box plus a 32 px margin is captured focused. Focus is then taken away with `blur()` and the same region is captured twice: the second capture marks pixels that change on their own (carousels, video, animation) as noise, never counted. Focus is then given back to the element with `focus({ preventScroll: true })`, so the next Tab reaches the element's own key handlers, as it would with no capture in between. When nothing changed in the region, the whole viewport is captured focused and blurred to confirm, because ACT oj04fd counts a change anywhere in the viewport. The record keeps, per stop, the region, the element's box, how many pixels changed, how many by at least 3:1 contrast, how many *noticeably* (3:1, or 48 in one color channel, which catches a change of hue), how many were noise, the bounding box of the change, its main colors, and hashes of the two captures. Captures are not saved as images.

The same captures also give the indicator's colors against the colors next to it, which 1.4.11 reads ([contrast in states](#contrast-in-states-143-and-1411---probe-states-and-the-keyboard-walk)).

**2.4.7, the rule.** A changed pixel does not prove that focus is visible (the plan's correction to the research), so a change is never a pass:

| Observation | Result |
|---|---|
| No pixel changes in the region or anywhere in the viewport (captured twice) | failure, high |
| The same, when the element is entirely under other content (see 2.4.11) | failure, medium, pointing to 2.4.11 |
| Focus is back on the document 150 ms after it arrived (F55) | failure, high |
| Nothing changes around the element, but something changes elsewhere in the viewport | needs review |
| Fewer pixels change noticeably than a 1 px outline around the element would paint (its perimeter) | needs review |
| Pixels that change on their own cover more than 10% of the region, and nothing else changed | not judged; counted in the coverage note |
| Any other change | no failure found |

**2.4.11, the probe.** At every stop, forward and backward, a 5×5 `elementFromPoint` grid over the part of the focused element inside the viewport. It runs in the main walk and again in a second, lighter walk at 390×844 (a phone held upright, where sticky headers and bottom bars cover the most), which records only where focus lands, the grid and its pixel checks (no idle recording, no second read of focus); each window size gets its own coverage line, and a finding names the window it was found in. A point counts as covered when it hits something that is neither the element, inside it, nor an ancestor of it (an ancestor on top means the element lets the pointer through, which is not evidence of a cover). When every point is covered, two pixel checks follow: the element is painted magenta, then hidden; neither may change a pixel of the region. Focus is given back to the element afterwards.

**2.4.11, the rule.** Every point covered and neither check changed a pixel: failure, high. A control that paints nothing of its own (opacity 0, clipped, 1 px: a toggle drawn by its label) is not judged, and a control's own label never counts as covering it. The finding names the cover, raised to its fixed or sticky layer, with its size and position, and suggests `scroll-padding-top` or `scroll-padding-bottom` of its height when it sits at the top or bottom of the window. A cookie or consent banner shown on arrival counts as author content: the Understanding says such a banner fails if it entirely obscures a component receiving focus, and passes when it is modal or the page reserves `scroll-padding` for it. A cover that lets pixels through (translucent) is not reported, and is counted in the coverage note; a partial cover is not reported (that is 2.4.12, AAA). 2.4.11 is new in WCAG 2.2, Rampa's default target; under `--wcag 2.1` the result is marked "beyond the 2.1 target" and never counts toward the exit code, even with `--fail-on any`.

**Limits.** Chromium scrolls an out-of-view focused element to the middle of the window, so a fixed banner mostly covers elements that were already in view; other browsers scroll differently. 2.1.1, 2.1.2, 3.2.1 and 2.4.7 use only the run's window size; the 390×844 walk serves 2.4.11 alone, in desktop mode (the viewport meta is not applied, unless `--device` emulates a phone). A faint change is a pixel count, not a judgment of perceptibility, and forced colors are not tested. With `--device` emulating a phone, a page with no viewport meta is laid out 980 px wide and shown zoomed out, so a 3 px ring paints about 1 px and tends to land in review. Focus indicators drawn with `:focus-visible` survive the probe's refocus (Chromium keeps the keyboard modality), but a page that changes its indicator on `focus` events may show the second focus differently.

### 2.4.1 Bypass Blocks: skip links (`--probe keyboard`, rule `rampa/bypass-blocks`)

The keyboard probe's third record (variant `skip-link`, version 1), on a fresh page of its own.

**The probe.** From the top of the page (the `body` focused for a moment, the window scrolled up, as for the walk), Tab up to 8 times. For each stop it records the element (ref and identity) and, for a link whose address is the page itself plus a fragment, the fragment, what it names (the element with that id, or an `<a name>`; `null` when nothing has it), whether that comes after the link, how many elements Tab would reach between the link and it (what the link skips), and how many inside it or after it. A stop that is such a link, or is named like a skip link ("Skip to content", "Pular para o conteúdo", "Saltar al contenido"), is read again 400 ms later, since skip links often slide in on focus: whether it shows on screen, meaning inside the window, at least 2×2 px after clipping by its ancestors, and on top at its middle (`elementFromPoint`, which `clip`, `clip-path` and a header over it all defeat). Then, for up to 3 such links whose fragment names an element after them, one at a time: back to the top, Tab to the link again (the same element, or nothing is pressed), Enter, 300 ms, and the probe records the address's fragment, how far the window scrolled, where focus is (on the target, inside it, still on the link, on the document), whether the target's top is in the window, and where the next Tab lands relative to the target. A link to another page, a route (`#/about`), a button and anything in a form are never pressed; the guard answers any navigation locally.

**The verdict** on each pressed link (thresholds in `src/site/bypass-blocks.ts`, not in the probe): it works when focus landed on or in the target, or the next Tab went inside or after it; or when Tab left the page or wrapped to its top and nothing focusable lies inside or after the target (from there, that is where Tab goes). It does not work when the next Tab went where it went before Enter. With nothing between the link and its target, a changed fragment, a scroll or the target in view are enough.

**The rule.** One page cannot show which blocks repeat on other pages, so the rule never fails 2.4.1; failures come from comparing the pages of a crawl ([criteria across pages](site-criteria.md#241-bypass-blocks)). It reads the page with the same code, guessing what repeats: the header and navigation landmarks, and, before the first heading or sentence of the page's own, asides and the links and controls outside `main`.

| Observation | Result |
|---|---|
| A skip link among the first stops that shows on focus and moves focus past what it skips | no failure found; the coverage note names it and how many elements it skips |
| A main landmark, or a heading, after the links and controls before the content (ARIA11, H69) | no failure found; the note names them |
| Nothing before the content to pass, or less than two links or 40 characters of it | no failure found, with the reason in the note |
| A link named like a skip link whose fragment names nothing on the page | needs review, on the link |
| A skip link that, pressed, leaves focus where it was | needs review, on the link |
| A skip link that works but never shows on screen, even focused (off screen, clipped, under a header) | needs review, low, on the link: it works for screen reader users only (G1 asks for a link visible at least on focus) |
| Links and controls before the content and no skip link, landmark or heading after them | needs review, on the page: if they repeat on other pages, 2.4.1 fails, which `--crawl` checks |
| The only way past them is a control the probe never presses (a skip button, a menu toggle) | needs review, on the control |

axe-core's `bypass` can only pass or leave the page undecided; when this rule ran, it settles that result (it is no longer listed for review apart).

**ACT cf77f2, one page at a time.** On the rule's 13 HTML test cases (2026-10-10, Edge 154, online), with `--probe keyboard`: the failed example goes to review (links and an aside before the content, no way past them), never to a failure, by design; 9 of the 12 passed examples have no failure found (their skip links work when pressed, or their main landmark or heading is found, or nothing precedes the content); Passed Examples 1, 8 and 11 go to review, since their way past the block is a link or a button that hides the menu or moves focus by script, which the observe class never presses. Across two pages, the same test cases fail exactly the failed example ([criteria across pages](site-criteria.md#241-bypass-blocks)).

**Real pages** (2026-10-10, one run each):

| Page | Skip links pressed | Result | Read by hand |
|---|---|---|---|
| rampa.guilhermebs.com.br | 3: "Skip to content" → `#main` (skips 8 elements), and two in-page menu links (`#how`, `#evaluation`) | no failure found; also a main landmark and an h1 | Right: the skip link shows on focus and moves focus to `main` |
| www.gov.uk | 1: "Skip to main content" → `#content` (skips 3: the cookie banner's buttons) | no failure found | Right |
| agenciabrasil.ebc.com.br | 1: "Pular para o conteúdo principal" → `#main-content` (skips 59) | needs review: the link works but never shows | Right: focused, the link moves into the page flow at the top left, under the site's fixed top bar, so nothing of it shows (a capture confirms it); it is a 2.4.11 problem too |

The probe took 3.7 s on gov.uk, 4.7 s on Rampa's site and 15.3 s on Agência Brasil, most of it loading the page; each Enter costs about 0.5 s with its return to the top.

**Limits.** Only the first 8 Tab stops are read, so a skip link after a long cookie banner is missed, and only links are pressed: a skip button, a menu that collapses (SCR28) and focus moved by a script on click stay with a person. Whether the target is the main content is the rule's guess on one page; across pages it is measured. Visibility is read once, 400 ms after focus, at the run's window size. Chromium only.

### State variants: 1.1.1 and 3.1.1 (`--probe variants`, rules `rampa/carousel-name` and `rampa/language-versions`)

D6 of the plan: the same content in another state than the one the page loaded in. Observe class: the probe never clicks. It runs only when named (`--probe variants`), never with `all`, since it loads other pages over the network.

**Carousels (1.1.1, F20).** F20 fails a text alternative that is not updated when the non-text content changes: a slideshow whose every slide carries the first slide's alt, a banner whose `src` a script swaps while its alt stays. The probe loads the page with Playwright's fake clock and finds carousels: an `aria-roledescription` that says carousel or slide, or the class names carousel libraries write (`carousel`, `slider`, `slideshow`, `swiper`, `slick`, `splide`, `glide`, `flickity`, `owl`, `embla`, `keen-slider`…), the outermost of them (slides that carry the class themselves, one image each, are read as one carousel, their container), at most four, with their slide-sized images (at least 40% of the largest one's area, so thumbnails and dots are left out; slides not rendered yet count). Then it jumps the clock forward eight times by 2 s, finishing CSS transitions after each jump, and records which image shows most inside each carousel's box, with its address and name. Large images outside the carousels (120×80 px or more) are followed too: one whose address changes twice or more on the clock is a carousel of one image (one change is an image loading late, as lazy loaders swap it). Each picture is captured once, the first time it shows, after it has loaded and decoded, and kept as a 16×16 grey thumbnail; a lazy loader's stand-in of a pixel or two is not a picture; a slide that never showed is made visible on its own for its capture, as the image captures of 1.1.1 make stacked slides visible, and the page is put back.

`rampa/carousel-name` reads the record: a carousel (or a swapped image) with two pictures or more whose thumbnails differ by a mean of 16 grey levels or more, and one non-empty name on all of them, fails at medium confidence: one name describes one picture at most, unless it says too little to describe any, which a person checks. The same name on pictures with different addresses goes to review when not every picture could be captured (a slide cut off by its track, an image in a frame). In a carousel of several slides, each slide's image counts once, as it last showed, so a slide whose image loaded late is not two pictures. Names that change with the picture are 1.1.1's judgment's, picture by picture; empty names are decorative; copies of one picture (a looping carousel's clone), and images with one address whatever their captures show, are one picture.

**Language versions (3.1.1).** The page's `<link rel="alternate" hreflang>` and the links of its language switcher (with `hreflang`, or whose whole text is a language's own name, as `rampa/language-switcher-lang` reads it) lead to the same content in other languages. The probe keeps one address per other language, the alternates first, and the switcher's link to it when there is one; it leaves out `x-default`, the page's own language and addresses that are the page itself, and loads up to four versions, each in its own context behind its own guard. For each it records the `lang` its root declares, its title, and its text in that language (what inherits it, and parts marked with the same language; parts marked with another are left out), at most 3,000 characters. `rampa/language-versions` reads that text with the language identifier ([judged criteria](criteria.md#311-language-of-page)) and fails a version whose `lang` the text is not in, only when the reading is clear: 150 letters and 20 words at least, one language well ahead and no large part in another. Short or mixed text is never judged, and a version that declares no valid `lang` is left to its own page's axe-core check. The finding sits on the switcher's link, or on the page's root when the version comes only from the head, and its message names the version and its address.

**Fixtures.** `variants-carousel-fail.html` holds a carousel that plays by itself, three different pictures each named "Summer sale: 30% off every coat"; a banner a script swaps every 5 s, its alt left as "The campus at sunrise" (F20's third example); a carousel that does not play, two different pictures named "Our rooms"; and slides that carry a slider class themselves under a plain container, two pictures named "Campus news": four failures. `variants-carousel-pass.html` names each slide for what it shows and changes the banner's alt with its picture. `variants-carousel-near.html` holds a looping carousel that shows two copies of one picture, decorative slides with `alt=""`, a main picture with thumbnails of other pictures beside it under the same name, and an image a script loads late, once: none reported. Over HTTP, `variants-lang-home.html` (English) links to a Portuguese version still marked `lang="en"` (a failure, on its "Português" link), a Spanish version marked `es` with its content in `lang="es-ES"` (no failure), and a French one marked `de` with two words of text (never judged).

**Real pages.** On 2026-10-11, `rampa check <url> --no-llm --min-confidence low --probe variants`:

| Page | Read | Findings | Read by hand |
|---|---|---|---|
| rampa.guilhermebs.com.br | no carousel; its Portuguese version (`/pt/`, `hreflang="pt-BR"`), marked `pt-BR` and read as Portuguese | none; 1.1.1 not checked by this probe | Right |
| www.ufc.br | the `#slideshow` carousel played by itself on the clock: 4 pictures, each with its own alt ("Slideshow Prêmio UFC de Jornalismo 2026", the Encontros Universitários logo…); no language version linked | none | Right: the names change with the pictures, so whether each fits is 1.1.1's judgment |
| www.w3.org/WAI/fundamentals/accessibility-intro | no carousel; 4 of its 9 translations (Arabic, Czech, German, Greek), each read as the language its root declares | none | Right. Before the probe read parts marked with the root's own language, the translations' content (in an element with the same `lang` as the root) was left out, and all four were "too little or mixed text to judge" |

| ifce.edu.br | a news slider whose slides carry the class themselves (read as one carousel since that case was handled; it was four carousels of one image before), 4 pictures with their own names; course cards that all show one background picture under one name | none | Right: the names change with the news pictures, and the cards show one picture, so one name |
| www.gov.br/pt-br | a carousel of 6 profiles ("Agricultor", "Turista", "Aposentado"…), 5 made visible for their capture | none | Right: each has its own name. Only 3 of the 6 captures differ: the track moves its slides by transform, so some captures of slides made visible show the same part of the page. That can hide a failure; it cannot make one out of slides with one address, which always count as one picture |

The two rules found no failure on these pages, and none was missed by hand. Failures of either kind are rare on any random page, so the gate's 35 reviewed findings will need a targeted corpus: carousels on news and shop home pages, and sites whose translations are machine-switched.

**Limits.** Only carousels that play on timers (the fake clock moves `setTimeout`, `setInterval` and `requestAnimationFrame`), or whose slides can be made visible in place, are seen in more than one state; a track that slides only on a click shows its other slides clipped, and they go to review at most. CSS animations that run without a script, pictures in CSS backgrounds and `<picture>` sources chosen by the window size are not followed. Whether one name fits several pictures is not decided: it fails at medium confidence, experimental, below the threshold. Language versions are read once each, as they load, with no probe of their own; a version behind a sign-in or a cookie wall reads the wall.

## App screens: Android and iOS

Item D7 of the [plan](plans/wcag-coverage.md): the keyboard walk, text at 200% and orientation on an app screen, written as the same observation records the web probes write, so the same rules judge them, offline from a saved snapshot like any other.

> [!WARNING]
> **None of this has run on a real device.** It was built on a machine with no Android device, no emulator and no Mac. The Android probes are tested against a fake adb that answers from hand-written UI Automator dumps, one per state of the screen (`test/android-device.ts`, `test/fixtures/android/probes/`), and the iOS side against a hand-written export (`test/fixtures/ios/probes.json`). The Swift helper that writes iOS probe steps has not been compiled. Every report with app-screen probe records says so in its notes. Whether real dumps, real timings and real apps behave as the fakes do is the first thing to find out on a device.

```sh
rampa check android: --probe keyboard,layout,orientation          # the screen on the connected device, then the three probes
rampa check android:emulator-5554 --probe all --save recordings   # the kinds that apply to an app screen run; a note names the others
rampa check recordings/android-com-example-shop-sign-in.snapshot.json   # the records judged again, with no device
rampa check sign-in-orientation.json sign-in-text.json             # XCUITest exports with probe steps (docs/ios.md)
```

| Kind | Android (over adb) | iOS (XCUITest export) | Record |
|---|---|---|---|
| keyboard | Tab and Shift+Tab as hardware key events, the screen dumped after each | not built: Full Keyboard Access cannot be turned on from a UI test | `keyboard`, variant `keyboard-walk`, version 2 |
| layout | the system font scale at 1.0 and at 2.0 | the app launched at the default Dynamic Type size and at AX2 | `layout`, variant `text-size-200`, version 1 |
| orientation | auto-rotate off, the rotation set upright, sideways, upright | the device turned with `XCUIDevice`: upright, landscapeLeft, upright | `orientation`, variant `orientation`, version 1 |

Each record has `platform` (`android` or `ios`) in its `data`, and its conditions name the device: `Android 14 (API 34), Pixel 7, over adb`, or `iOS 18.2, iPhone, from an XCUITest export`. Other kinds asked for with `--probe` (hover, media, color…) drive a browser: on an app screen they do not run, and a note says which. A saved dump (`rampa check login.xml --probe keyboard`) is a single state of the screen and is checked without probes, with a note.

### Android, over adb

Nothing is installed on the device. Rampa collects the screen as it does without probes (that is the snapshot every record names), then runs the kinds asked for: keyboard first, since it changes no setting, then layout and orientation, each of which makes Android recreate the app's screen. Every step reads the screen with `uiautomator dump`, as the collector does.

| Kind | What Rampa sends | What it reads |
|---|---|---|
| keyboard | `input keyevent 61` (Tab); `input keycombination 59 61` (Shift+Tab, Android 13 and later); `input keyevent 19` to `22` (the arrows), only to try to leave a suspected trap | a dump after every key; `screencap -p` after every forward Tab |
| layout | `settings put system font_scale 1.0`, then `2.0`; then the value it found, or `settings delete` when there was none | a dump at 1.0, at 2.0, and once more after the setting is back |
| orientation | `settings put system accelerometer_rotation 0`, then `user_rotation` 0, 1 and 0; then both values it found | a dump and a screenshot at each, with the display's rotation the dump reports |

**Observe class, as on the web.** The walk presses Tab, Shift+Tab and the arrows. It never presses Enter, Space, Back or Home, never taps or swipes, and never presses Esc: Android reads an Esc the app does not handle as Back, which can close the screen. A Tab can still set off what the app does on focus, which is what 3.2.1 looks for.

**Settings are put back.** The layout and orientation probes read each setting before changing it, and put it back when the probe ends, when it fails (a dump that never comes, a device unplugged), and on Ctrl+C or a kill signal while a setting is changed. If putting one back fails, the terminal and the report say so, with the adb command that does it. Changing the font scale or the rotation makes Android recreate the app's activity: an app that does not keep its state may come back on another screen. The text-size probe notices (fewer than a fifth of the screen's named nodes left) and compares nothing.

**The keyboard walk on an app screen** (2.1.1, 2.1.2, 3.2.1, 2.4.7, 2.4.11):

- Tab wraps round an app's window instead of leaving for the browser, so the walk has gone round once when focus comes back to its first stop. Focus coming back to another stop, or staying where it was while other nodes can take focus, is a suspected trap: Shift+Tab, and each arrow followed by Tab or Shift+Tab, are tried as many times as the cycle has elements plus one (at most four), in two rounds.
- The focused node is the one the dump marks `focused`, in the window a person is on. The controls 2.1.1 expects Tab to reach are the nodes that are clickable, long-clickable or checkable, or have a control's role and take focus, shown and enabled; a control inside another control (the row a switch sits in is what takes focus) and what a WebView shows are left out. Since Tab wraps, the forward walk covers the screen even when a field had focus first, and when the device cannot send Shift+Tab (before Android 13) the walk is forward only, which the record says.
- 2.4.7 needs the element with and without focus, and an app's focus cannot be taken away without moving it. Each forward stop's capture is compared with the capture after focus moved on; what differs between the capture before focus arrived and the one after it left (both show the element without focus: the neighbours' indicators, anything that moves) is noise. When nothing changed around the element, the whole screen is compared the same way. A stop where focus did not move, the screen scrolled, or the on-screen keyboard (when the dump shows it) covers the element is not judged.
- 2.4.11: a 5×5 grid over the focused node's bounds. A point is covered when a node drawn over it (later in drawing order, or another window) paints there: text, a name, an image, a control, a bar, a sheet or a card. Every point covered and no pixel around the element changed when it took focus is a failure.
- 3.2.1: a Tab after which another app is in front, a new window is open over the app, or most of the screen's named nodes are gone. The probe cannot give focus back to see whether the change repeats (that would need Back), so it goes to review, never to a failure; when the app left the screen, the walk stops there and the change is recorded on the screen itself.
- 1.4.11 focus indicators are not measured on app screens: the platform's own focus highlight, which 1.4.11 exempts, cannot be told apart from the app's, so that coverage line says "not checked".
- Budgets: 60 stops in each direction and 240 s. A dump takes about one to three seconds on a device (not measured here), so a walk of 20 stops each way may take a minute or two.

**Text at 200%** (1.4.4). WCAG2ICT reads 1.4.4 for software as text that can be resized to 200% without loss of content; the platform's text size setting is how a person resizes an app's text. A dump does not say how a text is drawn, only where its node is, and Android clips each node's bounds to what its ancestors show. What can be told from that, and so what is measured:

- Text whose box comes out shorter at 200% than at 100%, no wider than before, is cut by at least the difference: text never needs less height at a larger size when it is no wider. The cut is put at the edge of the ancestor the box is flush with; through a container that scrolls, the rest can be scrolled to and nothing is cut. Failure, high.
- Text the app shortens itself at 200% ("Continue to chec…", paired with its full text at 100% by type, id and role): failure, medium; review when a content description holds the full text. A TextView's own `ellipsize`, and Compose's `TextOverflow.Ellipsis`, keep the full text in the dump, so they are not seen.
- Text shown at 100% that no node shows at 200%, outside containers that scroll (a list shows fewer rows, which is not a loss): review, once per container it was pushed out of, when the screen read again after the setting is back shows it.
- Text of two nodes that overlaps at 200% and did not at 100%: review.
- Not seen: text cut inside a box that keeps its size (a button of fixed height whose label no longer fits), text drawn in images, and anything the dump leaves out.

**Orientation** (1.3.4). The screen is read with the device upright, sideways and upright again: two turns, each compared as the web probe compares a load and a turn.

- An app whose display stays upright (the dump's rotation 0) while the device is set sideways shows its screen a quarter turn from how the device is held, which is what ACT b33eff fails on the web. The whole screen is recorded as the element that turned, with the device's and the display's angles: failure, high.
- A landscape layout that only asks to turn the device back ("Please rotate your device to portrait"), with most of the screen's text gone: failure, high.
- Most of the text gone with no message: review. A dump holds only what is on the screen, so a list shows fewer rows sideways; the rule's threshold (a quarter of the text or less) leaves that out in most layouts, never all.
- Not seen: whether a layer is opaque (a "rotate" overlay over content the dump still lists goes to review, not to a failure), and a device that cannot rotate at all (a TV, a car), which looks like a lock. On screens 600 dp wide or more, Android 16 ignores the orientation lock of an app that targets it, so a lock shows only on a phone there.

### iOS, from an XCUITest export

XCUITest runs on a Mac, so iOS probes are steps a UI test exports and Rampa reads anywhere ([docs/ios.md](ios.md#probes-orientation-and-text-size)):

- `RampaExport.captureOrientation` sets `XCUIDevice.shared.orientation` to portrait, landscapeLeft and portrait, exports the screen each time, and puts back the orientation it found. The app's interface orientation is read from the application element's frame: wider than tall is landscape. An app that keeps an upright frame with the device sideways is a lock, as on Android.
- `RampaExport.captureTextSize` launches the app at the default Dynamic Type size and at AX2 (`-UIPreferredContentSizeCategoryName`), runs the test's own steps to reach the screen each time, and exports both. Dynamic Type has no 200% step: AX2 sets body text to 33 pt, 194% of the default 17 pt, and the findings say 194%. iOS frames are not clipped, so text whose frame reaches past the window, outside anything that scrolls, is cut by the part past the edge (failure, high); overlaps are measured as on Android. On iOS 17 and later the helper also runs Apple's accessibility audit for clipped text and Dynamic Type at AX2 and exports what it reports; each issue is an item to review, never a failure.
- No keyboard walk: Full Keyboard Access cannot be turned on from a UI test. `--probe keyboard` on an export records that.

The probe steps of an export become observations when Rampa reads it; with `--probe`, only the kinds named do, and a kind the export has no steps for is recorded as not run, with the helper to call.

### How the rules read app-screen records

The rules are the web's. Their logic is unchanged; on an app screen's record they word the message and the evidence for an app (no CSS, no scroll-padding hint, the device's angles), through a small branch on `data.platform`.

| SC | Rule | On an app screen |
|---|---|---|
| 1.3.4 | `rampa/orientation` | the display kept upright while the device is sideways; a landscape layout that asks to turn back; text gone (review) |
| 1.4.4 | `rampa/resize-text`, variant `text-size-200` | text cut at 200% (high), text the app shortens (medium), text past the screen's edge (iOS, high); pushed-off text, overlaps and Apple's audit issues (review) |
| 2.1.1 | `rampa/keyboard-reach` | a control the walk never reached; the evidence says whether the dump marks it focusable |
| 2.1.2 | `rampa/keyboard-trap` | a cycle Tab, Shift+Tab and the arrows never leave, twice; inside a dialog window, review |
| 2.4.7 | `rampa/focus-visible` | no pixel changed around the element or on the screen when it took focus |
| 2.4.11 | `rampa/focus-obscured` | every grid point under a node drawn over it, and no pixel changed |
| 3.2.1 | `rampa/on-focus` | another app, a window or another screen after a Tab: review only |
| 1.4.11 | `rampa/focus-indicator-contrast` | not checked (the platform's own highlight cannot be told apart) |

1.4.10 Reflow and 1.4.12 Text Spacing do not run on app screens. Android's display size (`wm density`) could narrow a screen as 400% zoom narrows a page, but it is not built. 1.4.12 is about spacing a person overrides, with a user style sheet or a bookmarklet on the web; native views offer no such override to set, so there is nothing for a probe to apply (WCAG2ICT's notes on 1.4.12 discuss how it applies to software).

**Node identity.** An app screen's nodes have no tag or attributes; their identity is their type (the Android class or the XCUIElement type), resource-id or accessibilityIdentifier, role and name. Refs are paths, and a list that scrolls or a dialog that opens shifts them, so the probes tie each node they saw to the snapshot node it stands for: one node of that identity on each side is a pair, as many on each side are paired in order, and otherwise a node keeps its pair only where its ref is the same. Records carry the snapshot's refs and identities; a node that could not be paired keeps its own, and the rules count its facts as unmatched.

### Running on a device, and what was tested

On a device: `adb devices` lists it as `device`, the screen to check is open, and animations are best turned off (Developer options, the three animation scales), since a screen that keeps moving never lets UI Automator go idle. Then `rampa check android: --probe keyboard,layout,orientation --save recordings`. If the run is cut short, check Settings > Display > Font size and the auto-rotate tile; the warning in the terminal gives the adb command to put each back.

Tested, with the fakes only (`test/native-probes.test.ts`): the walk going round a sign-in screen with both keys, a control that is clickable but not focusable, a button with no focus indicator, a button under a cookie banner, a field that keeps Tab, a Tab that opens a browser, a device before Android 13; text cut by a card, shortened by the app, pushed out of a container, overlapping, a list that scrolls, and an app that shows another screen; an app that turns, one locked upright, and one whose landscape layout asks to turn back; the font scale and the rotation put back after a run, after a failed dump, and on an interrupt; `rampa check android:` with `--save` replayed offline to the same findings; an export with both kinds of iOS steps, one that turns, and one with none. The screenshots are drawn from the dumps by the fake device, not taken from a screen.

## Known gap

On the Linux CI runner (Chrome), a page that autofocuses a field ends the keyboard walk with 2.1.1 not checked, while Edge on Windows completes the same walk. The report says the criterion was not checked, so nothing is claimed; the cause is still being investigated.

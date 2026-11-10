# Probes

A probe drives a web page after Rampa has collected it, behind a network guard, and records what it saw. Rules then turn those facts into findings. This is how Rampa checks criteria that no static scan can: what happens when the page is narrowed to 320 CSS px, when text spacing is raised, when someone moves through it with the keyboard.

```
target ─► collect (snapshot + axe) ─► probes (--probe) ─► rules and criteria ─► report
                                         │                      ▲
                                         └─ snapshot.observations ─┘   (rules read only the snapshot)
```

Probes are **off by default**. `--probe` takes a comma-separated list of kinds:

| Kind | What it does | Criteria | In `all` |
|---|---|---|---|
| `layout` | reflow at 320 px, text spacing, 200% zoom | 1.4.10, 1.4.12, 1.4.4 | yes |
| `keyboard` | Tab walk, focus captures, skip links | 2.1.1, 2.1.2, 3.2.1, 2.4.7, 2.4.11, 1.4.11, 2.4.1 | yes |
| `hover` | content on hover or focus | 1.4.13 | yes |
| `orientation` | portrait and landscape | 1.3.4 | yes |
| `shortcuts` | single printable keys | 2.1.4 | yes |
| `media` | captions, alternatives, sound on load | 1.2.1–1.2.5, 1.4.2 | yes |
| `color` | current items, required fields, links in text, color words | 1.4.1 | yes |
| `states` | contrast when hovered, focused, selected | 1.4.3, 1.4.11 | yes |
| `variants` | carousels on a fake clock, other language versions | 1.1.1 (F20), 3.1.1 | no |
| `auth` | sign-in and recovery: trusted paste, keypads, F109, CAPTCHAs | 3.3.8 | no |
| `flash` | general and red flashes | 2.3.1 | no |
| `links` | clicks scripted links, records where they lead | 2.4.4 | no |
| `input` | changes each form control | 3.2.2 | no |
| `toggles` | clicks toggles, reads their exposed state | 4.1.2 | no |
| `status` | is new text exposed after a trigger | 4.1.3 | no |
| `motion` | moving, blinking, updating content; time limits | 2.2.2, 2.2.1 | no |
| `form` | invalid entries, fields asked twice; with `--allow-submit`, submissions | 3.3.1, 3.3.3, 3.3.7 (3.3.4) | no |
| `pointer` | presses released away, drags, gestures listed | 2.5.2, 2.5.7, 2.5.1 | no |
| `parity` | keys against the pointer, hover menus, exit instructions | 2.1.1, 2.1.2 | no |
| `focus-order` | dialogs and menus opened from the keyboard; the Tab sequence | 2.4.3 | no |
| `gestures` | swipes and pinches; the device shaken and tilted | 2.5.1, 2.5.4 | no |
| `cognitive` | watches the page with no input, for `--profile cognitive` | advisories | no |

`interact` names the activate class: shortcuts, links, input, toggles, status, form, pointer, parity, focus-order and gestures.

```sh
rampa check https://example.com --probe all
rampa check page.html --probe layout,keyboard --save .rampa/rec   # keep the observations to replay offline
rampa check http://localhost:5173/checkout --probe form --allow-submit http://localhost:5173   # SUBMITS forms: test environments only
rampa check http://localhost:5173/checkout --probe form --submit-dry-run                       # lists what it would submit
rampa check android: --probe keyboard,layout,orientation   # an Android screen over adb (app screens, below)
rampa check sign-in-orientation.json                        # an XCUITest export with probe steps
```

Why off: each probe loads the page again, and the keyboard walk takes screenshots at every Tab stop. Each kind stops at its own budget ([Cost](#cost)), so `--probe all` ends, but on heavy pages it takes minutes: the median was 250 s on the 37 home pages of the [robustness study](studies/robustness-2026-10-23.md). A kind becomes a default only after it passes the [evaluation gate](rules.md#maturity-confidence-and-the-exit-code) and its cost is measured on real pages. `--probe` works with `rampa check` on URLs, HTML files, Android screens and XCUITest exports ([app screens](#app-screens-android-and-ios)); it does not run with `--crawl` yet.

## What a probe may do

Probes come in three classes. Every probe but those of the activate class and motion is in the **observe** class. Besides loading the page, an observe probe may:

- press Tab, Shift+Tab and Esc, and the arrow keys only to leave a suspected trap; focus `body` first so the walk starts at the top; press Enter on up to three skip links (a fragment of the page itself) among the first eight Tab stops, never on a link to another page, a route (`#/about`), a button or anything in a form;
- resize the viewport, change the device scale factor (200%), inject CSS, set the screen orientation over the DevTools protocol, move the pointer, scroll, and `blur()` and `focus()` an element to compare its two looks;
- move Playwright's fake clock (hover, flash, motion, variants), capturing the window and setting CSS and SVG animations to each instant; for time limits, jump the page's time up to 20 hours with at most 40 GET requests let through;
- play media muted, load text tracks and read sound from a copy of the stream, then put everything back (it never unmutes; the browser starts with `--autoplay-policy=no-user-gesture-required` and headless `--mute-audio`); read a transcript link's same-origin address with GET (six at most) or another origin's with one HEAD, never pressing the link;
- fetch the page's animated images once more with GET to decode their frames;
- put a peer's colors on one element, or take a selected item's marks off, for a capture, and put them back (color, states);
- load up to four other language versions, each with a GET behind its own guard (variants);
- paste a dummy value into password and code fields with a real Ctrl+V, type one key when the paste did not arrive, and put the value back (auth);
- load the page with `prefers-reduced-motion` off and on, watch it, and dispatch synthetic `paste`, `beforeinput`, `copy` and `contextmenu` events with a dummy value (cognitive).

It never clicks, never presses Enter or Space on a control (but the skip links above), never types (but auth's one key) and never submits a form.

The **activate** class clicks, changes settings or types, on the harness below: shortcuts, links, input, toggles, status, form, pointer, parity, focus-order, gestures, and motion's presses (only controls named to pause, stop or hide, and a time-out warning's control such as "Stay signed in"). Shortcuts is the one activate-class probe in `all`: with focus on `body` it presses each printable key (never Space) and Space on settings named for shortcuts, and never clicks, presses Enter, types into a field or changes a select. A key still does what the page bound it to, so on a server that changes data on a GET, leave `shortcuts` out.

The **submit** class writes to a server: only the form probe, only when `--allow-submit` names the page's exact origin ([Submitting forms](#submitting-forms---allow-submit)).

### The activate-class harness

`src/probes/activate.ts` learns the page's noise in a wait with no input, keeps the guard on all along, and adds:

- **A skip list.** A control is never touched when its name, label, title, `aria-label`, `alt`, value or what it holds (an icon's `alt`, an `<svg>`'s `<title>`) has a destructive, transactional, account-changing or consent word in English, Portuguese or Spanish (`delete`, `buy`, `pay`, `checkout`, `sign out`, `unsubscribe`, `submit`, `send`, `confirm`, `accept`, `save`…; `excluir`, `comprar`, `sair`, `enviar`…; `eliminar`, `borrar`, `cerrar sesión`…), matched as whole words. `order`, `book`, `register` and `share` skip only a plain button whose name begins with one. Also skipped: a control whose code holds such a verb (`deleteItem(3)`, `btn-logout`, `href="/account/delete?id=1"`), submit buttons, anything in a form with a password, file or payment field, a `data-method` other than GET, downloads, new windows, other origins, disabled controls. Each skip is logged with its reason.
- **The skip list again, before each use.** A control listed on one load is used on another, so right before use its facts are read again on that page and the skip list asked again ("Refresh" on one load, "Excluir tudo" on the next is not touched); so is a select option about to be chosen.
- **A budget** of controls and time per page ([Cost](#cost)).
- **A fresh page after each change**: once an activation changed the DOM outside the noise, the address, storage or cookies, focus or a layer, the next control gets a fresh page in a new browser context.
- **Overlays.** A control under another layer (a cookie wall, a sticky header) is not exercised, and the layer is named; the controls of a dialog or a layer over a quarter of the window that an activation shows are not exercised. The focus-order probe may press a button whose whole name says close or cancel ("Close", "×") when Esc leaves its dialog open, never "OK" or "Confirm".
- **Interception.** Navigations to another document and downloads are cancelled from the Navigation API's `navigate` event; the guard answers any that slips through with 204. `window.open` returns `null`, submissions are cancelled, `window.close()` and `print()` are ignored, writes to storage and cookies are counted.
- **A log** in the record of every load, click, skip, interception, dialog and blocked request, on one clock.

Each probe kind opens its own browser context with the collection's storage state, headers, cookies, color scheme and device settings, and loads the page fresh. The layout probes force a 1280×1024 desktop window; the orientation probe opens a 1280×800 window and a 390×844 phone (touch, scale 3, an Android user agent unless `--user-agent` sets one), each upright and sideways.

### The network guard

The guard is armed once the page has loaded (for auth, once its own redirects land); the load itself goes as for any visitor. Then:

- only GET, HEAD and OPTIONS reach the network; any other request, `sendBeacon` included, is aborted and logged;
- every navigation, in any frame or opened window, is answered locally with 204 and logged (`guard.navigations`, or `guard.blocked` with `cause: "frame"`);
- a request whose address names a destructive action is aborted, GET included (`cause: "destructive: logout"`): a path segment or query name or value that is or begins with `logout`, `log-out`, `logoff`, `signout`, `sign-out`, `delete`, `remove`, `destroy`, `unsubscribe`, `deactivate`, `sair`, `excluir`, `remover`, `apagar`, `descadastrar`, `eliminar`, `borrar` or `cerrar-sesion` (case, accents, camelCase, `_` and a `.php`-like extension aside); `/blog/how-to-delete-photos` and `/icons/delete.svg` go through. Probes that fetch a resource themselves skip such addresses too;
- WebSockets, EventSource and service workers are blocked, downloads refused, permission prompts denied;
- `window.open` returns `null`; submissions are cancelled; `alert`, `confirm` and `prompt` are dismissed (`confirm` answers cancel); all are logged;
- with `--allow-submit`, only while the form probe presses the control that submits a form it chose, a write to a named origin goes through, and every request to another origin is blocked.

**What it cannot stop.** A GET to an address that names no destructive action still reaches the server, and a server may act on one (`/items/3/archive`). That is why the observe class never clicks and the activate class runs only when named. Run probes where a stray GET is harmless. Every record lists what the guard blocked, why, and which navigations it answered.

### Determinism

- When probes run, the browser starts with `--force-color-profile=srgb --disable-lcd-text --font-render-hinting=none`.
- A probe waits for the page to settle: 300 ms with no DOM mutation and no layout shift, at most 3 s, after `document.fonts.ready`.
- Screenshots are taken with animations finished and the caret hidden; a text field's caret is read from its styles.
- A verdict that rests on an absence (no pixel changed on focus, focus never left a set of elements) is measured twice before it becomes a finding.
- Each record carries its conditions: viewport, device scale factor, browser and version, variant, color scheme.

## Submitting forms (`--allow-submit`)

**This writes to a server.** With `--allow-submit`, the form probe submits real forms: invalid entries to see the errors the server finds, then valid synthetic entries to reach the next step. Point it only at test environments you own (a local dev server, a staging copy, a CI preview), never at production: a guard cannot tell a harmless POST from one that places an order, sends an e-mail or changes an account.

```sh
rampa check https://staging.example.com/apply --probe form --allow-submit https://staging.example.com --allow-submit https://api.staging.example.com
```

- It needs `--probe form` (or `interact`); without it the flag does nothing, and Rampa says so.
- `--allow-submit <origin>`, once per origin, matched exactly (scheme, host and port: `http://localhost:5173` is not `http://127.0.0.1:5173`). A default port may be left out and a trailing `/` is ignored. Refused before any page loads, with exit code 2: a wildcard, a path, query or fragment, a scheme other than http and https, a user or password, an empty value.
- It is never inherited: the config file has no key for it, `rampa mcp` and the programmatic `check()` do not take it, and `--crawl` runs no probes.
- A page whose origin the flag does not name is not submitted, and the report says why; a page that redirects on load is submitted only when both origins are named.
- `--submit-dry-run` lists, on stderr and in the record, each form it would follow, where it would send it, the control it would press and every value it would enter; it submits nothing.

**What it does.** After the form probe's own run, for each form (three at most, each from a fresh load): it fills invalid values derived from each field's constraints (`rampa` in an e-mail field, one character short of `minlength`, one below `min`, a value the `pattern` refuses, an empty required field), turns the browser's validation off, and presses the submit control; it reads each broken field as the error state rules do (state, messages, how they are tied and announced, hints; only messages new after the submission count); it fills valid synthetic values (`Rampa Teste`, `rampa.teste@example.com`, `85999990000`, `Rua Rampa 100`) and submits with validation on; on a next step it repeats, up to 5 steps; it stops at the first step whose control commits (buys, pays, confirms an order, transfers, books, donates, signs, deletes or closes an account, hands in answers), which is never pressed.

**What it never does.** Fill in a form with a password, payment or file field or a CAPTCHA; type real credentials; press a control that commits or holds a skip-list word (only `Submit`, `Send`, `Save and continue` and their Portuguese and Spanish forms pass); tick a box that consents or agrees; fill a field that does not show; submit to an unnamed origin or into another window; let a beacon or a request to an unnamed origin out; let more than 12 requests through per page or run past 150 s.

**What you see.** A warning on stderr before anything loads (`the form probe will SUBMIT forms on http://localhost:5173 …`); after each page, the requests let through and where each form stopped; at the top of every report (terminal, JSON `submissions`, Markdown, HTML) a line such as `Forms submitted (--allow-submit http://localhost:5173): 1 request(s) let through to it, 0 blocked elsewhere.`; in the record (`kind: "form"`, variant `submit`), `guard.submitted`, `guard.blocked`, each press and each submission's entries, answer and status.

**Limits.** A redirect the server answers is followed by the browser before the guard sees it; if it leaves the named origins, the probe stops. During a press, a write the page's own scripts send to a named origin goes through too. Scripts a later step loads from another origin are blocked, so that step may not work.

## Observations in the snapshot

Probe facts go in `snapshot.observations.probes`, an optional field, so `schemaVersion` stays 1 and the published [JSON schema](../schema/snapshot.schema.json) describes it:

```ts
interface ProbeRecord {
  kind: 'layout' | 'keyboard' | …
  version: string                 // the probe's version; a rule states which versions it reads
  conditions: { viewport, deviceScaleFactor, browser, variant?, colorScheme?, reducedMotion? }
  status: 'complete' | 'partial' | 'skipped'
  reason?: string                 // 'stop budget reached (150)', 'probe failed: …'
  guard: { blocked: [{ method, url, at, type?, cause? }], navigations: [{ url, at, cause? }], dialogs: [{ type, message, at }] }
  durationMs: number
  data: unknown                   // per kind: refs, identities, boxes and measured numbers; never verdicts
}
```

**Node identity.** Every element a probe reports carries the snapshot ref and an identity (tag, `id`, `role`, `type`, `name`, `href`). A rule reports an element only when the ref resolves and the identity matches; otherwise the fact is *unmatched*, counted in the coverage line, and never a finding.

**Offline replay.** Rules are pure functions of the snapshot: `rampa check --save dir` writes the observations, and `rampa check dir/page.snapshot.json` judges them again with no browser, giving the same findings.

## How results are reported

- **Findings** from probe rules have `source: "probe"`, name the element, and carry the measured evidence in `evidence`.
- **Experimental.** Every probe rule is experimental until it passes the [evaluation gate](rules.md#maturity-confidence-and-the-exit-code), so its findings are **below the confidence threshold**: `--verbose` shows them, `--min-confidence low` reports them, `--fail-on any` counts them.
- **Needs review** (`report.needsReview`): what a person must look at; never a failure, never part of the exit code.
- **Not HTML.** On a standalone SVG or XML document no probe runs; each kind is recorded as skipped and its rules say "not checked".
- **Beyond the target.** Under `--wcag 2.1`, 2.4.11 (new in 2.2) is shown apart and never counts toward the exit code.
- **Coverage.** `report.coverage.probes` lists, per criterion, the method, probe version, conditions, elements, failures, items to review and unmatched facts. In `report.coverage.criteria` ([WCAG 2.2](wcag-2-2.md)) each is a method of kind `probe` named after its rule; a skipped probe is a method that did not run.

```
  Probed (experimental):          1.4.10
    1.4.10  probe/layout@1 (rampa/reflow) · 320×256 CSS px from 1280×1024 · chromium 154.0.4258.62 (headless): 2 failure(s) · experimental, below the threshold (--verbose shows them) · 4 element(s)
```

"No failure found" applies to the conditions shown: one browser engine, one viewport, the states the probe reached. It is never a pass.

## Coverage by criterion and method

What each probe rule can fail, in short; each check below gives the full conditions, what goes to review and what stays manual. *named*: the probe runs only when named; *submit*: it needs `--allow-submit`. `judgment/2.1.1@1`, `2.1.4@1`, `2.2.1@1`, `2.5.1@1`, `3.2.2@1` and `3.3.8@1` only clear a finding (an exception, a setting, a warning the model quotes); they never create one.

| SC | Probe, rule | Fails on |
|---|---|---|
| 1.1.1 | `probe/variants@1`, `rampa/carousel-name` (named) | pictures that differ, swapped under one name (F20) |
| 1.2.1 | `probe/media@2`, `rampa/audio-video-only` | audio or silent video whose every alternative found is a placeholder or broken |
| 1.2.2 | `probe/media@2`, `rampa/captions` | a video with sound whose every captions track fails, is empty or is a placeholder |
| 1.2.3, 1.2.5 | `probe/media@2`, `rampa/media-alternative`, `rampa/audio-description` | never, by design (review) |
| 1.2.4 | `probe/media@2`, `rampa/live-captions` | never (applies, not checked) |
| 1.3.4 | `probe/orientation@1`, `rampa/orientation` | content turned a quarter (ACT b33eff), or hidden behind a "turn your device" message |
| 1.4.1 | `probe/color@2`, `rampa/color-only-state`, `rampa/color-only-required`, `rampa/link-color-only`, `rampa/color-words` | state, required fields or links in text set apart by color alone (G182, F81, F73); a color word for required fields |
| 1.4.2 | `probe/media@2`, `rampa/audio-control` | sound on its own for more than 3 s with no control (ACT 80f0bf) |
| 1.4.3 | `probe/states@1`, `rampa/state-text-contrast` | text under 4.5:1 (3:1 large) when hovered or focused |
| 1.4.4 | `probe/layout@1`, `rampa/resize-text` | text cut by an ancestor's overflow at 200% (ACT 59br37) |
| 1.4.10 | `probe/layout@1`, `rampa/reflow` | sideways scrolling or cut text at 320 CSS px |
| 1.4.11 | `probe/keyboard@2`, `rampa/focus-indicator-contrast`; `probe/states@1`, `rampa/state-indicator-contrast` | a focus or selected-state indicator under 3:1 against its neighbors |
| 1.4.12 | `probe/layout@1`, `rampa/text-spacing` | text cut by the spacing overrides (F104) |
| 1.4.13 | `probe/hover@1`, `rampa/hover-content` | hover content Esc does not close, the pointer cannot reach, or that goes on its own (SCR39, F95) |
| 2.1.1 | `probe/keyboard@2`, `rampa/keyboard-reach`; `probe/parity@1`, `rampa/keyboard-parity`, `rampa/hover-menu` (named) | a control Tab never reaches; a click that works where no key does (F54, F42); hover-only menu links |
| 2.1.2 | `probe/keyboard@2`, `rampa/keyboard-trap`; `probe/parity@1`, `rampa/trap-exit` (named) | a Tab cycle no key leaves; exit keys the page names that do not work |
| 2.1.4 | `probe/shortcuts@1`, `rampa/character-key-shortcuts` | printable-key shortcuts no setting stops (F99) |
| 2.2.1 | `probe/motion@1` (variant `time-limits`), `rampa/timing-adjustable` (named) | a time limit with no warning, or no working control to extend it |
| 2.2.2 | `probe/motion@1`, `rampa/pause-stop-hide` (named) | motion or updates over 5 s with no pause, stop or hide control, or one that does not work |
| 2.3.1 | `probe/flash@1`, `rampa/three-flashes` (named) | more than three general or red flashes in a second over more than 25% of a 341 × 256 field |
| 2.4.1 | `probe/keyboard@1` (variant `skip-link`), `rampa/bypass-blocks` | never on one page; failures come from `--crawl` ([site criteria](site-criteria.md)) |
| 2.4.3 | `probe/focus-order@1`, `rampa/focus-management` (named) | focus that does not enter, stay in or come back from a dialog, menu or panel (F85) |
| 2.4.4 | `probe/links@1`, `rampa/scripted-links` (named) | never: an inventory for the 2.4.4 judgment |
| 2.4.7 | `probe/keyboard@2`, `rampa/focus-visible` | no visible change on focus; focus removed on arrival (F55) |
| 2.4.11 | `probe/keyboard@2`, `rampa/focus-obscured` | a focused element entirely under author content |
| 2.5.1 | `probe/pointer@1`, `rampa/pointer-gestures` (named, review only); `probe/gestures@1`, `rampa/gesture-alternatives` (named) | a swipe or pinch with no control around it that does the same |
| 2.5.2 | `probe/pointer@1`, `rampa/pointer-cancellation` (named) | an action on the down-event, or a state the release away does not undo (F101) |
| 2.5.4 | `probe/gestures@1` (variant `device-motion`), `rampa/motion-actuation` (named) | a motion no control replaces (ACT c249d5) or no switch turns off (7677a9) |
| 2.5.7 | `probe/pointer@1`, `rampa/dragging-movements` (named) | a drag with no single-pointer way to do the same |
| 3.1.1 | `probe/variants@1`, `rampa/language-versions` (named) | another language version whose `lang` its text is not in |
| 3.2.1 | `probe/keyboard@2`, `rampa/on-focus` | a change of context on focus, repeated |
| 3.2.2 | `probe/input@1`, `rampa/on-input` (named) | a change of context as a value changes, with no warning |
| 3.3.1 | `probe/form@1`, `rampa/error-on-leave` (named); `rampa/error-on-submit` (submit) | a field marked invalid with no message people see and assistive technology reads |
| 3.3.3 | `probe/form@1`, `rampa/suggestion-on-leave` (named); `rampa/suggestion-on-submit` (submit) | an error message that does not state the rule the markup states |
| 3.3.4 | `probe/form@1`, `rampa/error-prevention-steps` (submit) | a committing step with no review, confirmation, reversal or server check |
| 3.3.7 | `probe/form@1`, `rampa/redundant-entry` (named); `rampa/redundant-entry-steps` (submit) | information asked again with no way to reuse it |
| 3.3.8 | `probe/auth@1`, `rampa/accessible-authentication` (named) | paste blocked, keypads, partial secrets, calculations or transcriptions to sign in |
| 4.1.2 | `probe/toggles@1`, `rampa/state-exposure` (named) | a toggle whose exposed state does not follow what it shows |
| 4.1.3 | `probe/status@1`, `rampa/status-messages` (named) | never alone; with a model (`judgment/4.1.3@2`), a status message nothing exposes |

## Cost

Typical times of single runs on desktop Edge headless; live pages vary. A failure that rests on an absence costs a second trial.

| Probe | Budget per page | What drives the time |
|---|---|---|
| layout | — | 1 to 5 s per variant |
| keyboard | 120 s, 150 stops | about 0.25 to 0.3 s per forward Tab stop |
| hover | 120 s, 30 triggers | 0.65 s per trigger with nothing to show; 1.4 to 4 s with content |
| orientation | 90 s | four page loads: about 10 to 45 s |
| shortcuts | 90 s | 94 keys at about 0.25 s, then the confirmations |
| media | — | 4.5 to 12 s of watching, 2.5 s of muted playback, up to 5 s per alternative address |
| color, states | 8 styles | one hover and one focus per style; four captures per selected item |
| auth | — | 1.5 s for the page's redirects, about 0.3 s per paste |
| variants | — | eight 2 s clock steps, the captures, a load per language version |
| flash | 60 s | 3 s of page time captured every 16 ms; videos at most 9 s |
| links | 30 controls, 90 s | 0.8 s per click; 2 to 4 s per fresh page |
| input | 40 controls, 180 s | 2.5 to 6 s per control |
| toggles | 30 controls, 150 s | two or three clicks of 0.6 to 4 s |
| status | 20 triggers, 150 s | 1.5 s of waits per trigger |
| form | 20 fields and 6 pairs, 150 s | 1 to 1.5 s per trial |
| pointer | 30 controls (6 drags within 90 s, 20 presses), 150 s | 1.2 s per press; two or three fresh pages per drag |
| parity | 30 controls, 8 hover menus, 280 s | 4 to 8 s per control |
| focus-order | 12 controls, 150 s | 3 to 6 s per control |
| gestures | 6 elements, 150 s; device motion 90 s | about 2 s per gesture, a fresh page per control |
| motion | 8 presses, 110 s; time limits 60 s | a minute or more |
| submissions | 12 requests, 150 s | 0.5 to 1 s each on a local server |

## Not yet

- Probes do not run with `--crawl`, from `rampa mcp`, or from the Playwright and Puppeteer helpers. With `--crawl`, 2.4.1 is compared from markup alone, and sign-in pages are not found and probed.
- The programmatic `check()` takes `probes: [...]` with the web kinds; a browser passed in is used as it is, so without `--autoplay-policy=no-user-gesture-required` sound set to play on load only goes to review. `rampa.config` has no `probe` key yet.
- Android (`rampa check android:`) and XCUITest probes have not run on a real device ([app screens](#app-screens-android-and-ios)).
- Captures are not written next to a saved snapshot; only their hashes are recorded.
- The state-variants probe does not click: a carousel that moves only when pressed, and a language switcher that changes the page in place, are not exercised. Caption tracks' `srclang` against the spoken language is not built.
- A flake gate (each fixture 10 times in CI) is not wired in; each probe test file was run three to five times on Edge with no verdict changing, and none on the Linux CI runner's Chrome.
- The measurement of recorded probes on 20 pages of the real-page sample is not done.

## The checks

### Audio and video: 1.2.1–1.2.5 and 1.4.2 (`--probe media`)

**The probe.** A fresh page in a browser that lets pages play sound on load (`--autoplay-policy=no-user-gesture-required`; headless browsers are muted). Init scripts in every frame watch `video` and `audio` elements, scripted `play()` calls (`new Audio()` too) and Web Audio sources. The level of what plays with its sound on is read every 100 ms from a copy of its stream (`captureStream()`); sound is a span above −50 dBFS. The watch lasts 4.5 s to 12 s. Then every media element of the page, its open shadow roots and same-origin frames (at most 60) is listed; those that show and are not playing are played **muted** for 2.5 s and put back. Each gets its duration (infinite: live), audio and video tracks, level, and text tracks (loaded as `hidden`: state, cues, blank cues, first cue texts). An audio track silent for 2.5 s is sampled again at a quarter, half and three quarters, to tell a silent soundtrack from a quiet opening. Frames of other origins are named when the host is a known video player (YouTube, Vimeo…) or audio host (SoundCloud, Spotify, podcast hosts).

**Alternatives (probe version 2).** Around each media element (and known player frame) that shows, the probe finds and reads alternatives, in English, Portuguese and Spanish: links and buttons named for a transcript, text version, audio description or lyrics; `<details>`, regions and headings (or bold lines) named for a transcript, with their text; what `aria-describedby` or `aria-details` names; a sentence next to the media that refers to it ("The above audio contains…"). An in-page link is resolved there; a link to the page's origin is read with one GET (at most six addresses per page, 5 s each); another origin gets one HEAD. A link that leads nowhere (`#`, empty, `javascript:`, a missing fragment) is checked for listeners or framework handlers. Buttons are never pressed. Each alternative is recorded as shown, collapsed, or hidden with nothing to show it. It quotes them; it never says one is equivalent.

**The rules.** Three things fail without a person; the rest of 1.2.x is needs review by design, since equivalence needs the media's whole meaning.

| Criterion, rule | Observation | Result |
|---|---|---|
| 1.2.2, `rampa/captions` | A prerecorded video with an audio track whose every captions track fails to load, has no cues, or holds only blank or placeholder cues ("Lorem ipsum", "TODO"; "[Music]" is a caption) | failure, high (medium when the audio track was not read) |
| | No captions track, or one still loading; a known video player in a frame of another origin | needs review, quoting the text next to it |
| | A captions track with cues | no failure found (accuracy is not checked) |
| | No audio track, or a silent one | not applicable (1.2.1 applies) |
| 1.2.1, `rampa/audio-video-only` | An audio player, or a video with no sound, whose alternatives found are all broken: a link nothing handles, a 404 or 410, an empty or placeholder text ("Transcript coming soon", "Em breve"), text hidden with nothing to show it, a track with no cues | failure: high, or medium when one rests on a soft 404, a HEAD, hidden text or a listener on an ancestor |
| | An alternative with text, cues or an audio player next to it; alternatives not read; nothing found; a known audio player in a frame | needs review, quoting or listing what was found |
| 1.2.3, `rampa/media-alternative`; 1.2.5, `rampa/audio-description` | A prerecorded video with sound | needs review, listing descriptions tracks, audio description controls and (1.2.3 only) text alternatives |
| 1.2.4, `rampa/live-captions` | A live video with sound | needs review: applies, not checked |
| 1.4.2, `rampa/audio-control` | Sound that plays on its own for more than 3 s, with no native controls, no control to pause, stop, mute or set the volume next to it, and no sound control on the page | failure (ACT 80f0bf): high when the level was read, medium from the decoder alone and for Web Audio |
| | Only a pause or stop control away from it; sound under 3 s still playing; autoplay the browser did not start; a frame asked to autoplay | needs review |

At most 10 findings per rule. On an element the probe read, axe-core's undecided `video-caption` and `no-autoplay-audio` are the probe rule's to report. With no media, the criteria are "no applicable content"; when the only media is a player in another origin's frame, or one with no source until its own play button is pressed, they are "not checked".

**Tested on** the ACT test cases of 80f0bf, f51b46, eac66b, e7aa44, ee13b5 and c3232f (no passed or inapplicable example fails) and `test/fixtures/probes/media-*.html`; no corpus of real pages with autoplaying sound or broken captions.

**Limits.** Players in frames of another origin are listed, never read. Captions are counted, not read: wrong or burned-in captions are not seen, and speech is not recognized. Alternatives are found by name, place and wording, quoted, never compared with the media; a button or a scripted link is never followed. A 1.2.1 failure rests on what the probe saw (a handler it cannot see; a soft 404 read from the title). The level needs the media's stream (media of another origin without CORS: medium confidence), and a few seconds of sampling say little about a long video. Sound that starts later or after an interaction is missed, and a "Pause" control is trusted, never tried. One engine (Chromium); closed shadow roots are not seen.

### 1.3.4 Orientation (`--probe orientation`, rule `rampa/orientation`)

**The probe.** Two window pairs, 1280×800 and a phone (390×844, touch, scale 3), each loaded upright and sideways, with the screen orientation set over the DevTools protocol before load (`Emulation.setDeviceMetricsOverride` with `screenOrientation`). Once settled, the page is measured, the device turns (`orientationchange` and `resize` fire) and it is measured again. Each state records what the page saw, each element's rotation about Z (from `transform` and `rotate`), the text a reader sees on top (hit-tested), a layer over most of the window and its text, and a quarter-size capture for pages with little text. It also records `screen.orientation.lock()`, the manifest's `orientation` and axe-core's `css-orientation-lock`. Observe class: it only resizes and turns the window. Content is compared within each load and between the two loads of a pair (a page that checks its orientation once, on load).

| Observation | Result |
|---|---|
| A quarter turn (90° or 270°, within 5°) of `html`, `body`, or an element with half the text or half the window (ACT b33eff) | failure, high |
| The same for a smaller element with text or images | needs review (with neither: counted) |
| One orientation shows at most a quarter of the other's text, and a message asks to turn the device ("rotate your device", "gire o celular") | failure, high |
| The same with no message, in two comparisons or more; a turn message while the content still shows | needs review |
| A layer in both orientations (a cookie wall) | not a difference |
| `screen.orientation.lock()`, the manifest's `orientation` | a note (browsers honor them only in full screen or installed apps) |
| axe-core's `css-orientation-lock` | corroboration only |

**Tested on** ACT b33eff's test cases (failed examples fail, no other flagged) and `test/fixtures/probes/orientation-*.html`; not on pages that restrict their orientation.

**Limits.** Chromium, emulated: no device, lock or sensor. The essential exception is not judged (a person waives). A message in an image or a canvas is not read. Rotation is about Z only; closed shadow roots and cross-origin frames are not seen. Content that settles more than 3 s after a turn may be compared too early.

### 1.4.1 Use of Color (`--probe color`)

**The probe.** A fresh page. It reads styles, hovers and focuses links, takes screenshots, and puts another item's colors on one element for one capture, then puts them back. Four kinds of content:

- **Current state:** an item marked current, selected or pressed (`aria-current`, `aria-selected`, `aria-pressed`, or a state class such as `active` in navigation, tabs, menus or pagination) is compared with up to two peers of the same tag and role (a group whose peers differ among themselves is skipped): non-color cues (font, decoration, borders, shadows, pseudo-elements…), visible marks (icons, `✓`, "(current)"; sr-only text is no mark), and colors with their luminance contrast. When only colors differ, the **gray capture** takes the item with an 8 px halo, then with the peer's colors, both reduced to luminance; it keeps the strongest contrast of the change and any indicator another element draws in the halo.
- **Required fields:** the first required label against the first optional one; a text mark (an asterisk, "required", "obrigatório"; or "optional" on every optional field) comes first.
- **Links in text:** links inline in a block with 20 characters or more of its own text (at most 150), against that text's majority style (`aroundText`): cues at rest and the luminance contrast. Links set apart only by a color at 3:1 or more are hovered and focused once per style (at most 8).
- **Color words:** sentences that refer to a color and to information ("Fields in red are required", "campos em vermelho"), in English, Portuguese or Spanish, with the elements of that kind in that hue.

**The rules.** WCAG's Understanding for 1.4.1 (16 September 2025) counts a lightness difference of 3:1 or more as a distinction of its own; content that relies on a particular color needs another indicator whatever the contrast.

| Rule | Observation | Result |
|---|---|---|
| `rampa/color-only-state` | A current, selected or pressed item that differs from its peers only by color, under 3:1 by the style sheet and in the gray capture, with no mark in its halo | failure, high (G182); needs review when it could not be captured |
| `rampa/color-only-required` | Required fields that differ from optional ones only by color, under 3:1, with no text mark | failure, high (F81) |
| `rampa/link-color-only` | A link in text set apart only by color, under 3:1 against the text next to it | failure, high (F73). Elements axe-core's `link-in-text-block` failed are left to it ([rules](rules.md#how-rules-and-the-other-layers-interact)) |
| | Links at 3:1 or more that gain no cue on hover or on focus | needs review, low, one item per page |
| `rampa/color-words` | A sentence that names a color for required fields whose fields in that hue carry no text mark | failure, medium (F81) |
| | A sentence that names a color for anything else, or a color nothing has | needs review, low |

A cue, a mark or 3:1 or more is counted, not reported. Each rule speaks only for its own content: with none, its line says "not checked", since charts, maps and images are not read.

**Tested on** `test/fixtures/probes/color-fail.html`, `color-pass.html` and `color-near.html`; no ACT rule exists for 1.4.1.

**Limits.** Peers are found by structure: a lone current item is not compared. Only the first required and first optional field are compared. Only style sheet colors are swapped; indicators in images or canvas are missed, as is one farther than 8 px. Color words are matched from a few words, not understood. Charts, maps and color-coded tables are not checked. One engine (Chromium); forced colors and dark mode are not tried.

### Contrast in states: 1.4.3 and 1.4.11 (`--probe states`, and the keyboard walk)

The criteria also hold in the states a person puts a page in: text keeps its contrast while hovered or focused (1.4.3), and the mark of a state, such as a focus ring or the bar of the selected tab, needs 3:1 against the colors next to it (1.4.11). Every result is measured from pixels; a reading that is not sure goes to review.

**How Rampa reads the Understanding for 1.4.11.** An indicator needs contrast against what is next to it in the focused state; the two states are not compared. The browser's own focus ring and inactive components are exempt, and a change of background inside the component (Figure 15) is out of scope. Rampa passes an indicator when one of its main colors reaches 3:1 against one color next to it (Figure 11); it never fails one a figure passes, and can miss a ring that contrasts only with the component's border (Figure 13).

**The indicator** (`src/pixels/indicator.ts`) is the set of pixels that change between captures with the state on and off (a third capture masks movement). Its main colors (up to three clusters, each 15% of the changed pixels or more) are compared with the unchanged colors within 2 px, leaving out the component's text.

| Rule (probe) | Observation | Result |
|---|---|---|
| `rampa/focus-indicator-contrast` (keyboard walk; `indicator` on each stop of `probe/keyboard@2`) | Every main color of the focus indicator under 3:1 against every color next to it | failure: high when the indicator has at least the box's perimeter in pixels, medium when thinner |
| | A style sheet color reaches 3:1 (a thin, blended ring); no single color next to it | needs review, low |
| | The browser's ring; a background change inside the box; a text field whose caret has 3:1 (Figure 33) | not judged; counted |
| `rampa/state-text-contrast` (`--probe states`) | Hovered or focused, the text is under 4.5:1 (3:1 for large text). Controls are grouped by look; one per group, at most 10 groups | failure: high when the color came from the style sheet, medium from the pixels |
| | Part of the text passes; thin strokes; translucency; a change the pixels could not read | needs review, low |
| `rampa/state-indicator-contrast` (`--probe states`) | A current, selected, pressed or checked item (at most 12) whose mark outside the text (bar, pill, check) is under 3:1, and the text does not change, measured by taking the marks off | failure, medium |
| | The same when the text changes only its color; no single color next to the mark | needs review |

Controls axe-core's `color-contrast` failed at rest are left to it. Disabled items are exempt; native checkboxes and radios are left out. `rampa/state-indicator-contrast` says "not checked" on a page with no selected item.

**Tested on** `test/fixtures/probes/states-fail.html`, `states-pass.html` and `states-near.html`, which include the Understanding's figures; no ACT rule exists for these states.

**Limits.** Hover and focus are measured once per look, for at most 10 looks; `:hover` rules in style sheets of other origins are not read. Pressed, expanded and dark-scheme states are not tried, and text-input boundaries are not checked yet. A focus ring farther than 32 px is missed. A selected item whose look a script sets does not change when its marks come off, and is counted, not judged. One engine (Chromium).

### 1.4.10 Reflow (`--probe layout`, rule `rampa/reflow`)

**The probe.** The page loads at 1280×1024 in desktop mode; every element with text, and every control, is measured. The window is then resized to 320×256 CSS px (1280×1024 at 400%), as zoom does, and measured again; each element keeps a key across both. Sideways scrolling is tested by scrolling, and `overflow-x: hidden` or `clip` on `html` or `body` counts as not scrolling. Content that needs two dimensions is exempt: `img`, `video`, `canvas`, `svg`, `math`, `pre`, `code`, frames, `role=application`, data tables with headers, and boxes that scroll sideways on their own.

| Observation at 320 px | Result |
|---|---|
| The window scrolls sideways and text or a control outside exempt content and fixed layers passes the right edge (1 px tolerance) | failure, high |
| Text partly cut (2 px across, or a quarter of a line down) that was whole at 1280 px | failure, high; needs review when a `title` or `aria-label` holds the text, it shows an ellipsis, or the container is a carousel |
| A window that does not scroll sideways, with text partly past its edge; text of two elements that newly overlaps | needs review |
| Text that disappears (collapsed navigation) | not reported: it needs a menu opened |

At most 10 findings per kind; the coverage line counts the rest.

**Limits.** Chromium; 320×256 is an emulation (a real screen at 400% leaves about 318×236, hence the tolerances). Sideways scrolling inside a container that is not exempt is not reported yet. Text in frames is not measured.

### 1.4.12 Text Spacing (`--probe layout`, rule `rampa/text-spacing`)

**The probe.** A fresh page at 1280×1024 is measured, then the criterion's values go on every element as a user style sheet would set them (inline `!important`): `line-height: 1.5`, `letter-spacing: 0.12em`, `word-spacing: 0.16em`, and `margin-bottom: 2em` on `p`. The page is measured again against itself. Word spacing is not applied to languages written without spaces (`ja`, `zh`, `th`, `lo`, `km`, `my`, `bo`). axe-core's `avoid-inline-spacing` keeps the author's inline `!important` case.

| Observation | Result |
|---|---|
| Text cut with the spacing that was whole before (F104) | failure, high |
| Cut to an ellipsis with no `title` or `aria-label` holding the text | failure, medium (with one: not reported) |
| Cut, when a name holds the text or the container is a carousel; newly overlapping text | needs review |
| Text in a scrolling container, or already cut | not reported |

**Limits.** Text in canvas or images is not measured. Content a page re-renders late may be missed; the probe waits up to 3 s.

### 1.4.4 Resize Text at 200% (`--probe layout`, rule `rampa/resize-text`)

**The probe.** A fresh page at 1280×1024 is measured; then the window becomes 640×512 CSS px at device scale 2 (Chromium's 200% zoom, the viewport ACT 59br37 names) and is measured again, with the facts ACT 59br37 needs: the ancestor whose overflow `hidden` or `clip` cuts each text, its `white-space`, `text-overflow`, line height, height and `-webkit-line-clamp`, and `aria-hidden`. Text a reader saw at 1280 px that nothing shows at 640 px is checked again for what hides it and for a control that may show it; text not shown again at 1280 px was hidden by something else and is not counted.

| Observation at 640×512 | Result |
|---|---|
| Visible text cut by an ancestor's overflow (2 px across, a quarter of a line down), whole at 1280×1024 | failure, high (medium when already cut at 1280×1024) |
| Cut across under `white-space: nowrap` with a `text-overflow`; cut down by a box one line high and at least its font size tall (ACT's exceptions) | not reported; counted |
| Cut by `-webkit-line-clamp`, with the text in a `title` or `aria-label`, or by a carousel; text past the edge of a window that does not scroll; newly overlapping text | needs review |
| Text hidden at 640 px with no control that may show it | needs review (with a menu button: counted) |
| Text under `aria-hidden="true"`, SVG or MathML text, visually hidden text | not applicable |

Sideways scrolling at 640 px is 1.4.10's, not a 1.4.4 failure.

**Tested on** ACT 59br37's test cases (failed examples fail, no other fails) and `test/fixtures/probes/zoom-*.html`.

**Limits.** Chromium's zoom only; text-only zoom is not emulated. Text in canvas or images is not measured. Content behind a menu button is counted, not checked, and a control with no text that the layout cuts is not reported.

### 1.4.13 Content on Hover or Focus (`--probe hover`, rule `rampa/hover-content`)

**The probe.** A fresh page in desktop mode, with Playwright's fake clock. Triggers, at most 30 and five of one family: `aria-describedby` to hidden content or a `role=tooltip`; tooltip library attributes (`data-tooltip`, `data-tippy-content`, `data-bs-toggle="tooltip"`…); `aria-haspopup` and `aria-expanded`; `:hover` and `:focus` style rules that show another element or a pseudo-element; and elements with their own hover or focus listeners. `title` never makes a trigger. Each trigger is hovered, then, apart, focused; 350 ms later the probe reads the new content tied to it, and measures what it covers, whether it persists 10 s on the fake clock, whether it stays when the pointer moves onto it (hover only), and whether Esc closes it. A verdict that rests on content going away is measured twice. It never clicks.

| Observation | Result |
|---|---|
| Content over other content that Esc does not close, and that goes away when the pointer and focus leave (SCR39 not met) | failure, high |
| Content gone when the pointer moves onto it (F95), or within 10 s with the pointer or focus kept, in both tries | failure, high |
| The same in one try of two; content that describes an `aria-invalid` field (maybe an input error); Esc that only took focus away; content that stays when the pointer leaves | needs review |
| Content that Esc does not close but covers nothing | not reported; counted |

One finding per trigger and condition; at most 10 per condition.

**Limits.** Listeners delegated from the document (React, jQuery), rules from style sheets of other origins and nested CSS (`&:hover`) are not found. Content slower than 350 ms is missed, and the fake clock does not see a CSS animation that hides content later. The input-error exception is approximated by `aria-invalid`. Synthetic mouse in Chromium only; a trigger under a sticky header may be hovered on the cover.

### The keyboard walk: 2.1.1, 2.1.2 and 3.2.1 (`--probe keyboard`)

**The probe.** A fresh page at the run's viewport (1280×800 by default) settles, then sits 1.5 s with no key, to learn what it does on its own. From the top, the probe presses Tab until focus goes round the page or 150 stops run out, then Shift+Tab the same way, recording at each stop the focused element, its box, its composite widget and where focus is 150 ms later. In-page hooks record focus events (shadow roots included), `window.open`, submissions, `showModal` and history changes; the guard records navigations and dialogs. When a key seems to cause a change of context, focus is given back to the element once more to see whether it happens again. When focus cycles without leaving, the probe tries Tab, Shift+Tab, Esc and the arrow keys, in two rounds.

- **2.1.1 Keyboard (`rampa/keyboard-reach`).** A visible, enabled native control or widget role that neither walk reached is a failure (high; medium with a negative `tabindex`). Left out: items of a reached composite widget, radios of a reached group, a link whose address a reached link has, and controls that changed during the walk. Nothing is reported when the walk did not go round the page. Elements with only a click listener are the parity probe's.
- **2.1.2 No Keyboard Trap (`rampa/keyboard-trap`, ACT 80af7b).** A cycle no key left, in both rounds, is a failure, high; needs review inside a dialog or when nearby text names a way out, unless `--probe parity` pressed those keys and focus stayed in (failure) or left (no failure).
- **3.2.1 On Focus (`rampa/on-focus`).** What followed a stop, minus what the page did alone, counted only when it happened again as focus came back:

| Observation | Result |
|---|---|
| A navigation, a new window, a submission or a modal dialog, again on refocus | failure, high |
| A browser dialog, or focus moved by script elsewhere, again on refocus | failure, medium |
| Any of those once; the address changed with no load (`pushState`) | needs review |
| Content changed; a focus guard at a modal's edge | not reported |

**Limits.** Chromium's Tab order at one viewport. States opened by a click are not walked (the focus-order probe opens them). A cross-origin frame is one element (60 stops inside at most), and an unreached control in a shadow root or frame is not reported. An event later than 150 ms may land on the next stop. Refocus uses a script `focus()`, not a key. Blocked request hosts are named in the note. Whether a reached control works with keys is the parity probe's.

### 2.1.4 Character Key Shortcuts (`--probe shortcuts`, rule `rampa/character-key-shortcuts`)

**The probe.** With no key listeners on the page, nothing is pressed. Otherwise focus goes to the `body`, three 400 ms waits learn what changes on its own, and each printable key (`a`–`z`, digits, punctuation, then `A`–`Z`; not Space) is pressed with no modifier. For 150 ms the probe records DOM changes, focus, scroll, address, windows, dialogs and half-size pixels outside the noise; then Esc and a reset. Keys that changed something are pressed again (at most 24) after a wait. Checkboxes, switches and radios named for shortcuts or keys (`shortcut`, `atalho`, `atajo`…) are toggled with Space (at most five) and the shortcuts pressed again; hidden settings and the controls that may open them are listed.

| Observation | Result |
|---|---|
| A printable key changed the page on both presses (DOM, focus, a 4 px scroll, the address, a window, a dialog, or 12 pixels of the half-size capture), with no change in the wait before | a shortcut that works with no control focused |
| A setting on the page stops it | cleared; the note names the setting |
| Shortcuts no setting stopped | failure, medium: one per page, on `body`, listing the keys. A setting elsewhere meets the criterion, and the finding can then be waived |
| A change on one press of two | not counted |

**"Clearly labeled" goes to a model, which may only clear.** When a setting was out of reach or a control may lead to one, the `2.1.4` judgment (`src/criteria/character-key-shortcuts.ts`) asks whether a showing control clearly leads to turning the shortcuts off (ACT ffbc54). A pass must name a listed control and quote page text; a verified pass removes the finding. With `--no-llm`, the finding stays.

**Tested on** ACT ffbc54's test cases (with a model, failed examples fail and no other is flagged) and `test/fixtures/probes/shortcuts-*.html`.

**Limits.** One engine and window size; shortcuts in cross-origin frames are not seen. Settings behind a click, another page or a login are not exercised. Effects slower than 150 ms may be missed, and a page that changes all the time masks keys in those regions. Sequences, non-US layouts and IMEs are not tried. Settings are found by wording.

### 2.4.4 Link Purpose: where scripted links lead (`--probe links`, rule `rampa/scripted-links`)

**Only when named** (or with `interact`), on the [activate-class harness](#the-activate-class-harness).

**The probe.** Scripted links are links whose address says nothing: `href="#"`, an empty `href`, `javascript:`, a fragment that names nothing (a route such as `#/about` is tried), or `role="link"` with no address. Those that show and have a name (at most 100) are clicked once each with a trusted click, within 30 clicks and 90 s, and the probe records the strongest outcome: `submit`, `new-window`, `navigation` or `download` (intercepted; the address is read like a link's), `route` (address changed in place, with the title and heading then), `dialog`, `opened` (a dialog or layer), `fragment`, `content` or `nothing`. A link under another layer is not clicked. With `--follow-links` and judgment on, the addresses reached are read into `snapshot.destinations`.

**What 2.4.4 does with it.** The judgment (`src/criteria/link-purpose.ts`) tells the model what activating the link does ("it goes to …", "it opens a dialog that reads …") and what was read there; the address also counts when links that share a text are compared (ACT fd3a94). Without the probe, claims that need a destination are discarded.

**The rule** decides nothing: `rampa/scripted-links` is an inventory. Its line under 2.4.4 says what was found, clicked and skipped, and why; with `--no-llm`, 2.4.4 stays not checked.

**Tested on** the seven ACT test cases of fd3a94, 5effbb and c487ae that use scripted links, and `test/fixtures/probes/links-*.html` (`links-destructive.html` checks that no destructive link is clicked).

**Limits.** Only links that show on load; one mouse click (Enter-only links do nothing); navigations later than about 4 s are missed; destinations are read without cookies. Links in frames and shadow roots are not listed. One engine (Chromium).

### Pointer: 2.5.2, 2.5.7 and 2.5.1 (`--probe pointer`, rules `rampa/pointer-cancellation`, `rampa/dragging-movements`, `rampa/pointer-gestures`)

**Only when named** (or with `interact`), on the [activate-class harness](#the-activate-class-harness). Mouse only.

**What it finds.** From pointer listeners read over the DevTools protocol and the markup: drag widgets (custom sliders, sortable and draggable items, one per list; splitters; maps, never dragged), gesture elements (carousels of known libraries, maps, touch listeners), and controls to press (at most 20; never selects, text fields, range inputs, or anything in a carousel or map).

**Press, move away, release (2.5.2).** The mouse goes down on a control for 450 ms, moves to an empty spot, is released, and the page is watched 450 ms more, minus what it changes on its own. A press that seemed to commit is tried again on a second load (at most 5).

| Observation | Result |
|---|---|
| A navigation, window, submission or dialog on the press, before the release, again on a second load | failure, high (F101) |
| A pressed, checked or selected state, or the control's text, changed on the press and stayed after the release away, again | failure, medium |
| Either once of two loads; a menu that opened on the press and stayed; other lasting changes | needs review |
| Changes the release undid; feedback inside the control | not reported |

**Drag, then a single-pointer way (2.5.7).** Each drag widget (at most 6, within 90 s) is dragged (a slider 30% of its track, an item past its neighbour) and its value, order or size read. When it changed, the probe tries, each on a fresh page: a click on the slider's track; buttons around it named for moving ("Move up", "Increase volume", "+", "Subir"); inputs and selects named for a position ("Move to column"); a click on the item, then on a move control it showed. Arrow keys are never tried.

| Observation | Result |
|---|---|
| A slider or sortable item the drag changed, with nothing that does the same | failure, medium (beyond the target under `--wcag 2.1`) |
| Controls around it that did not do the same in one use; a splitter or other element with no way found; a map | needs review |
| A way found | no failure found; the note names it |

**Gestures (2.5.1).** Needs review only: each gesture element, naming the previous, next or zoom controls found. When `--probe gestures` runs, it decides 2.5.1 and this list steps aside.

**Tested on** `test/fixtures/probes/pointer-*.html`; no ACT rule exists for these criteria.

**Limits.** Mouse only, no touch hardware. A press that changes nothing visible is not seen; skipped controls are never pressed. Drag widgets need markup or a known library (canvas drags and Dragula are missed); handle-only items need a marked handle. An alternative must work in one use, so one that needs a selection or Enter reads as not doing the same. Essential exceptions (a signature, a game) are not recognized: the finding can be waived. Frames and shadow roots are not listed. One engine (Chromium).

### Gestures and device motion: 2.5.1 and 2.5.4 (`--probe gestures`, rules `rampa/gesture-alternatives`, `rampa/motion-actuation`, judgment `judgment/2.5.1@1`)

**Only when named** (or with `interact`), on the [activate-class harness](#the-activate-class-harness). It leaves two records of kind `gestures`: variants `gestures` (2.5.1) and `device-motion` (2.5.4).

**Gestures (2.5.1).** With touch on and Playwright's fake clock, up to 6 elements a page: carousels of known libraries, maps, image viewers, drawing areas ("Sign here") and other elements with touch or gesture listeners (never drag widgets). Each is let turn on its own first (up to 8 s on the clock), read (slide, content, zoom, layout, pixels), then given touch events over the DevTools protocol: a swipe left (then right) across the middle and a two-finger pinch. When a gesture changed it, the controls around it that may do the same (next, previous, the next dot, zoom in or out; at most 4) are clicked, each on a fresh load; when none is found, the gesture is made again on a second load.

| Observation | Result |
|---|---|
| A gesture changed the element, nothing around it does the same, again on a second load | failure, medium |
| A control does the same | no failure found; the note names it |
| A drawing area drawn on (essential input); a navigation, window or dialog; pixels only; controls that did something else; one load of two | needs review |
| Nothing changed (a strip the browser scrolled) | not reported |

**Essential gestures: the model only clears.** With judgment on, each failure goes to `judgment/2.5.1@1` (`src/criteria/pointer-gestures.ts`); the model may call the gesture essential (a signature, freehand drawing, a game) only by quoting a text of or around the element, which is verified, and a verified pass clears the finding. It never makes one.

**Device motion (2.5.4).** With motion listeners on `window`, the browser's virtual sensors are turned on before load (`Emulation.setSensorOverrideEnabled`; synthetic events when they reach nothing, recorded as `synthetic`), and three motions are made from rest: a shake (±20 m/s²), a tilt to the side and a tilt forward (35°). The first that does more than move styles is made again on a second load; then controls named for its effect or for common functions (undo, shuffle, next…; at most 5) and switches named for motion (at most 2) are tried, each on a fresh load.

| Observation | Result |
|---|---|
| A motion operates something on two loads, and no control does the same | failure, medium (ACT c249d5) |
| A control, or the browser's scrolling, does the same, and no switch turns motion off | failure, medium (ACT 7677a9); a setting elsewhere meets the criterion (waive then) |
| A control and a switch | no failure found |
| Other outcomes, styles only (parallax), or listeners the motion did not reach | needs review |
| No listener | nothing to move |

When this record holds listeners, the scope note `rampa/motion-actuation-scope` steps aside; when the 2.5.1 part ran, `rampa/pointer-gestures` does.

**Tested on** `test/fixtures/probes/gestures-*.html`; ACT's 2.5.4 rules need a device and are not run.

**Limits.** Synthetic touch on a desktop browser; one swipe each way and one pinch (no vertical swipes, rotation or long presses). An element animated on its own clock counts only by its markup. A single-pointer way must work in one click near the element. Effects outside the element are not seen. Virtual sensors only; listeners added after a tap or a permission are not reached; a switch on another page is not seen. Rate-limited pages may fail a fresh load. Frames and shadow roots are not listed. One engine (Chromium).

### 3.2.2 On Input (`--probe input`, rule `rampa/on-input`)

**Only when named** (or with `interact`), on the [activate-class harness](#the-activate-class-harness).

**The probe.** Up to 40 showing form controls (selects, checkboxes, radio groups, text-like fields, sliders, date and time fields, text areas), within 180 s, each on a fresh load. The skip list keeps out password and file fields, forms with password, file or payment fields, and destructive names. Each control is focused, left 0.8 s (what follows is the page's own), then changed the least surprising way: the next option, Space, one letter or digit, one arrow key, ArrowUp. The probe records what followed (at most about 4 s), then `blur()`s text fields and records again. A change of context is made again on a second load (at most 10). It also records the text that may warn of a change (labels, nearby text, sentences such as "reloads the page", "nova janela"). It never presses Enter or submits.

| Observation | Result |
|---|---|
| A navigation, a new window, a submission or a modal dialog as the value changes, again on a second load (F36, F37) | failure, high (medium when only on leaving the field) |
| A browser dialog, or focus moved elsewhere, again on a second load | failure, medium |
| Any of those once; the address changed in place; most of the text changed; a non-modal layer; focus lost to the document | needs review |
| A field that shows, a price that updates, suggestions | not reported: a change of content |

A form with no submit button is never reported (G80 is one way, not a requirement). At most one finding per control.

**"Advised before using the component" goes to a model, which may only clear.** With judgment on, the 3.2.2 judgment (`src/criteria/on-input.ts`) reads the texts around each failing control and decides whether one warns of the change (G13). A pass must quote a listed text of 10 characters or more; a verified pass clears the finding and the note quotes the warning. With `--no-llm`, failures stay, and the message says a warning meets the criterion and the finding can be waived.

**Tested on** `test/fixtures/probes/input-*.html` (`input-destructive.html` checks the skip list); no ACT rule exists for 3.2.2, and no corpus of pages that change context on input has been gathered.

**Limits.** One change per control, so changes only some values make are missed. Custom widgets (ARIA comboboxes, listboxes) are not changed. Sign-in and checkout forms are never touched. A warning far away, in other words or as an icon, may be missed. Changes later than about 4 s are missed. Frames and shadow roots are not listed. One engine (Chromium).

### 4.1.2 Name, Role, Value: the state of toggles (`--probe toggles`, rule `rampa/state-exposure`)

**Only when named** (or with `interact`), on the activate-class harness. Rampa does not decide what a screen reader announces: it reads what the browser exposes (`Accessibility.getPartialAXTree`).

**What it does.** It lists toggle-like controls that show (at most 120; 30 tried within 150 s): first *declared* ones (`aria-expanded`, `aria-pressed`, `aria-checked`, tabs with `aria-selected`, non-native switches, checkboxes and radios, buttons with `aria-controls`), then *hinted* ones (`data-toggle`, class or id words such as `toggle`, `accordion`, `dropdown`, button names such as Show, Hide, More, Menu, Filters), then other buttons. Native controls, links to other pages or to parts of this page, composite containers and dialog openers are left out; one tab or radio group counts once; the skip list applies. For each control on a fresh page it reads the exposed role, name, value and states (of it and its group), the visible text and its `aria-controls` region, captures the window, clicks it, and reads and captures again. A toggle is clicked a second time (a third when its own look differs) to see it flip back. A trial that reads as a failure is repeated on a second load (at most 10 per page).

**Results.** A change on screen is content (text, a layer, the controlled region, or 150 px or more outside the control), the page's look (over 60% of the window) or the control's own look (24 px or more). An exposed change is a change of role, name, value or state, including a name that says the state ("Show details", "Hide details").

- Failure, high: the screen changes and changes back while nothing exposed changes, on two loads, on a control that declares a state it never updates; or such a control opens content and can no longer be clicked, state unchanged; or a `role="tab"`/`"radio"` choice changes content with no selected or checked state moving.
- Failure, medium: the same with no state at all (a button with no `aria-expanded`, a `div` with no role); a state that changes and never changes back while the content does; tabs with no roles.
- Needs review: any of those on one load of two, or not tried again.
- Not reported: changes that do not go back (more items, a copied link, a dialog), focus styles, hover tooltips.

A finding says which attribute to set (`aria-expanded`, `aria-pressed`, `aria-checked` with `role="switch"` or `"checkbox"`, `aria-selected`); there is no patch. No ACT rule tests this. Fixtures: `test/fixtures/probes/toggles-*.html`.

**Limits.** Only controls that show on load, one click away (not inside a closed menu); mouse clicks only. Changes later than about 4 s, or below the pixel thresholds with no text, are missed. A name that changes counts as exposed even when it says little ("☰", "+ ☰"). Hover-only disclosures show no change. No frames or shadow roots; Chromium only. Not built yet: a role probe for generic elements with click listeners, and the judgment of frames that share a name (ACT 4b1c6c).

### 4.1.3 Status Messages (`--probe status`, rule `rampa/status-messages`, judgment `judgment/4.1.3@2`)

**Only when named** (or with `interact`), on the activate-class harness. Of F103's steps, the probe checks that the new content does not take focus and has no `status`, `alert` or `log` role, and reads what the browser exposes in place of what a screen reader announces; whether the text is a status message is the model's.

**What it does.** At most 20 triggers per page within 150 s, each on a fresh page: an invalid value typed into a field and `blur()` (up to 8 fields); a word typed into a one-field GET search form and Enter (up to 2; the submission is cancelled, so only a script that searches in place can answer); and a click on a client-only control named copy, filter, sort, apply, add to list, load more or calculate, or a change of a filter or sort select or checkbox (up to 10). The skip list applies: no form with password, payment or file fields, no destructive name, no submit button. Text snapshots before and after each trigger, with idle ones to mask clocks, give the new or changed texts (at most 6 per trigger), each with its focus, dialog, live region in the markup and in the browser's tree, and whether the field left names it.

**Results** (the rule never fails by itself):

- Not reported: focus is in it; it is in a dialog; it does not show; it is large (over 300 characters, three links or fields, three list items: content, not a message).
- No failure found: a live region or a `status`, `alert` or `log` role around it (`output` counts); the same words in a live region elsewhere; the text is in the left field's label or description and a live region received text after the same trigger.
- Needs review: anything else. The coverage line also reads the [live-regions inventory](rules.md#browser-tree-rules-412-253-131-and-413).

**The judgment** (`src/criteria/status-messages.ts`, with a model, only for texts left to review): a fail must quote the words that make it a status message and becomes a finding, with `role="status"` as the patch when the message's element was in the page on load; a pass removes the item only when it quotes the text that appeared. Confidence is capped at medium when the field names the message with `aria-describedby`. No ACT rule covers 4.1.3. Fixtures: `test/fixtures/probes/status-*.html`.

**Limits.** Only these safe triggers: messages after a submission, a sign-in or a purchase are not seen. One invalid value per field. Messages later than about 4 s are missed. A message inside the control used ("Copied") counts as delivered with focus. A live region created with its text counts as exposed, though some screen readers do not announce it. No frames or shadow roots; Chromium only.

### Forms: 3.3.1, 3.3.3 and 3.3.7 (`--probe form`, rules `rampa/error-on-leave`, `rampa/suggestion-on-leave`, `rampa/redundant-entry`)

**Only when named** (or with `interact`), on the activate-class harness. On its own it never submits (no Enter, submissions cancelled, the guard passes only GET, HEAD and OPTIONS). With `--allow-submit` naming the page's origin it goes on to submit forms ([Submitting forms](#submitting-forms---allow-submit); rules under **Submissions** below).

**Errors on leaving a field (3.3.1, 3.3.3).** Up to 20 text-like fields get at most two entries derived from their markup: `rampa` in an e-mail or URL field; the first of a few short strings a `pattern` refuses; one character under `minlength`; one step outside `min` or `max`; a character typed and erased in a required field. Fields with no such constraint, dates, selects, checkboxes and custom widgets are not tried. After `blur()`, the field is read as the error state rules read one (`src/criteria/error-messages.ts`); a message counts only if the snapshot did not already show it there.

- 3.3.1 failure, medium: the field is marked `aria-invalid` and no message shows that assistive technology reads.
- 3.3.1 review: only an error class; or a message neither tied (`aria-describedby`, `aria-errormessage`, an error summary) nor announced.
- 3.3.3 failure, medium: after breaking `minlength`, `min`, `max` or a type, the message, label and hints do not state the rule; review for a `pattern` with no example, `step` or a date range.
- Not reported: a message tied or announced (no failure); only the browser's `:user-invalid`, or nothing (counted); a field already in error on load.

With no field that showed an error of the page's own, 3.3.1 and 3.3.3 stay "not checked".

**Fields asked twice (3.3.7).** A field pairs with an earlier one in the same form by autocomplete purpose and `section-*` (secrets and codes never), or by the same label in another group ("Passenger 1"/"Passenger 2" groups are left out). The probe clicks a reuse control ("Same as billing address") once, or types a synthetic value into the first field and reads the second, its `datalist` and options.

- No failure found: a reuse control, the value filled in, or offered.
- Failure, medium: billing and shipping asked twice with none of those (beyond the target under `--wcag 2.1`).
- Review: other pairs; a "Confirm e-mail" field; a second field in a part not shown yet; a pair the probe could not type into.

**Submissions (3.3.1, 3.3.3, 3.3.4, 3.3.7; only with `--allow-submit`).** A second `form` record, variant `submit` (version 1); results on later steps point at the form the flow started from and name the step.

- `rampa/error-on-submit` (3.3.1): failure, medium, for a field the server marked `aria-invalid` with no message seen and read; review for a class only, an untied unannounced message, or an error text that names no field.
- `rampa/suggestion-on-submit` (3.3.3): failure, medium, for a message that states no rule after a broken `minlength`, `min`, `max` or type; review for a `pattern` with no example.
- `rampa/redundant-entry-steps` (3.3.7): failure, medium, when a later step asks again for an autocomplete purpose with no fill, offer or reuse control; review by label only, for a confirm field, or when correct entries came back empty.
- `rampa/error-prevention-steps` (3.3.4): failure, medium, for a committing step after an earlier one with no review step, no confirmation checkbox, no word of reversal and no server error for the invalid entries; review when any of those is present. A committing control on the first page is `rampa/error-prevention-scope`'s.

A dry run (`--submit-dry-run`), or an origin the flag does not name, leaves these "not checked". Submissions have run only against the local servers the tests start (`test/submit-server.ts`). Fixtures: `test/fixtures/probes/form-*.html`.

**Limits.** Only constraints the markup states, one entry each. Forms with password, file or payment fields are never typed into. A message neither tied, announced nor near the field is not read as the field's. 3.3.7 sees one page. Fields numbered in render order (`mat-input-5`) may not match the snapshot. No frames or shadow roots; Chromium only. Submissions follow only `form` elements with a submit control, one invalid and one valid submission per step (a server that refuses synthetic values stops the flow); sign-in, sign-up, payment and upload steps are never filled; user-supplied Playwright flows are not built (a test can call `checkPage` on each step); 3.3.4's mechanisms are read from words.

### 2.1.1 and 2.1.2: keys against the pointer, hover menus, exit instructions (`--probe parity`)

**Only when named** (or with `interact`), on the activate-class harness; budget 30 controls, 8 hover menus, 280 s.

**What it does.** It tries controls whose keyboard support is the page's own: non-native elements with an interactive role, composite-widget items Tab does not reach, elements that listen only to pointer events (F54), elements with no role that listen to `click` (F42), and up to 8 with only a pointer cursor. On a fresh load each gets focus, then one key path (the arrows to reach a widget item, Enter, Space, the arrows on sliders, ArrowDown on combo boxes), watched for 0.7 s; then a click, watched for 0.7 s. Each window's net effect (navigations, dialogs, layers, state attributes, elements shown or hidden, text changes) is compared; noise and foreign frames are left out. A control whose keys did nothing while the click did is tried again on a second load.

**Results** (`rampa/keyboard-parity`; at most 10 findings per page):

- Failure, high, on two loads: the click did something and no key path did anything; or the element takes no focus; or a widget item the click selects is reached neither by Tab nor by the arrows.
- Failure, medium: a key did something other than the click. The 2.1.1 judgment (`src/criteria/keyboard-parity.ts`) may only clear a finding, as *equivalent* (naming a key path and citing a click fact and a key fact) or *path-dependent* (2.1.1's exception, quoting the page).
- Needs review: a high failure on one load of two, or not tried again.
- No failure: the keys did what the click did, or the click goes where a link Tab reaches goes. A focusless control with a role is `rampa/keyboard-reach`'s when a keyboard walk ran.

**Hover menus (`rampa/hover-menu`).** Links hidden with `display: none` or `visibility: hidden` under a small visible trigger: the trigger is hovered, then focus, Tab, ArrowDown, Space and Enter are tried. Hover shows them, no key does, and some of their addresses are nowhere else Tab reaches, on two loads: failure, high (medium when the trigger links to another page); on one load: review.

**Exit instructions (`rampa/trap-exit`).** When the page names a key to press ("press Esc", "pressione Ctrl+M"), the probe walks with Tab (at most 150 presses); in a cycle that Tab, Shift+Tab, Esc and the arrows do not leave, it presses the named combinations in two rounds. Focus still inside: failure, high. When `--probe keyboard` found the same cycle, `rampa/keyboard-trap` reports it from these facts.

ACT has no rule for these. Fixtures: `test/fixtures/probes/parity-*.html`. Precision is not measured on pages with custom widgets.

**Limits.** Native controls are not tested (a handler at the document root is missed). Effects later than 0.7 s, or outside the DOM (canvas, audio), are missed on both sides. One key path, one press each: two-key patterns, drags, double clicks and touch are not tried; hover menus at the first level only. Exit instructions are read in English, Portuguese and Spanish. No frames or closed shadow roots; Chromium only.

### 2.4.3 Focus Order: dialogs, menus and the Tab sequence (`--probe focus-order`)

**Only when named** (or with `interact`), on the activate-class harness; budget 12 controls, 150 s.

**What it does.** It tries controls that say what they open (`aria-haspopup`, `aria-controls`, `data-bs-target`, `popovertarget`, `commandfor` or `href="#id"` naming a hidden dialog, menu or panel, or an inline handler naming a dialog's id), plus up to 4 buttons named to open something when dialogs are left untied. Each on a fresh load: focus, Enter (Space, ArrowDown, then a click if no key opened it); where focus goes, and how many Tab presses get it in (at most 40); in a modal, whether Tab reaches the page behind; Esc, or a button named only to close ("Close", "×"; never "OK" or "Confirm"); where focus lands once closed. Lost focus is tried again on a second load.

**Results** (`rampa/focus-management`; at most 10 per page):

- Failure, high: 40 Tab presses never get focus into what opened, on two loads; a modal lets Tab reach the page behind; focus on the document once it closed, on two loads.
- Failure, medium (F85): more than 3 Tab presses to get in; focus more than 3 Tab stops from the control once it closed. 3 or fewer is no failure (SCR37).
- Needs review: focus elsewhere once closing removed the control; a failure on one load of two.

**The page's order** is the 2.4.3 judgment's: Rampa never fails an order from geometry alone. The probe walks Tab (at most 120 stops) and nominates a positive tabindex (F44) and groups Tab visits going back at least twice, at most 4 per page. `src/criteria/focus-order.ts` asks the model whether the order breaks meaning or operation; a fail must cite suspect transitions, which the verifier recomputes from the recorded boxes. With `--no-llm` candidates are only counted. No ACT rule exists for 2.4.3. Fixtures: `test/fixtures/probes/focus-order-*.html`.

**Limits.** Only controls that say what they open, and a few guesses. One way in and one way out: dialogs closed only by "OK" or a click outside are not measured on closing. Shadow roots and frames are not counted. Interleaving is read from boxes. Chromium, one window size.

### 3.3.8 Accessible Authentication (Minimum) (`--probe auth`, rule `rampa/accessible-authentication`)

**Only when named**: it pastes a dummy value into password fields of real sign-in forms (cleared after), so `--probe all` leaves it out.

**What it does.** It follows the page's own navigations and self-submitted GET forms (an SSO, a bot check) until the page settles (at most 15 s); POST is always blocked. It finds sign-in and recovery steps (password fields, one-time codes, fields for characters of a secret, identifier-only forms); sign-up and change-of-password forms are left out, and steps that do not show are never opened. Into each password and code field it pastes `Rampa-probe-7319` (or digits) with the real Ctrl+V (`src/probes/clipboard.ts`), so the page gets a trusted `paste` and `beforeinput`; a paste that did not arrive is tried again, then one key is typed. Values and the clipboard are put back. It also reads read-only fields next to an on-screen keypad, quoted cognitive tests (characters of a secret, F109; a calculation; an image CAPTCHA), CAPTCHA widgets by vendor (never clicked), other ways to sign in (passkey, "Sign in with…", gov.br, QR code), and attributes that keep password managers away. It never presses Enter, clicks or submits.

**Results.**

- Failure, high (F109; H100): a password or code field a trusted paste did not reach, twice, while a key did; a code in one-character boxes that a paste fills only partly; a read-only password field with a keypad.
- Failure, medium: text that asks a cognitive function test. The 3.3.8 judgment (`src/criteria/accessible-authentication.ts`) keeps or clears it, quoting the step.
- Needs review: any failure next to another way to sign in (the Alternative exception); a field that took neither paste nor key; low for password-manager attributes and puzzle CAPTCHAs (Arkose, GeeTest).
- Not reported, counted: object-recognition and silent CAPTCHAs, fields that took the paste, identifier-only steps.
- No applicable content without a sign-in or recovery step; "not checked" when a bot check covered the page, a step was not showing, or the facts are not in the snapshot (the note suggests `--wait-for`).

3.3.8 is new in WCAG 2.2: under `--wcag 2.1` it never counts toward the exit code. No ACT rule exists for 3.3.8.

**Limits.** Steps behind a submit (identifier-first sign-ins, codes sent later) are not reached. A field that takes a paste and clears it on submit is not seen as blocking. Keypads drawn in a canvas or images go to review. Cognitive tests are found by wording in English, Portuguese and Spanish. The Alternative is noticed, never followed. Password managers are not run. Probes do not run with `--crawl`. Headless Chromium: pages that refuse it show a bot check, reported as not checked.

### 2.3.1 Three Flashes or Below Threshold (`--probe flash`, rule `rampa/three-flashes`)

**Only when named**: it plays videos (muted) and takes some 200 window captures, so `--probe all` leaves it out. One analyzer, measured failures only, no vision model and no certification claim (a PEAT or Harding pass needs those tools and a person). It runs in a 1024 × 768 window and stops at 60 s.

**Thresholds** (`src/pixels/flash.ts`). A general flash is a pair of opposing luminance transitions of 0.1 or more, the darker state below 0.80 (a slow fade counts once). A red flash involves a state with R/(R + G + B) ≥ 0.8 and a u′v′ distance over 0.2 (WCAG 2.2). More than three flashes is seven transitions within one second. The area is the largest share of one 341 × 256 field covered by a connected region of 4 × 4 px cells that flash together; regions apart are not added.

**What it reads.** Animated GIF, APNG and WebP images (at most 12 analyzed), decoded at their shown size; up to 3 videos, muted, for 3 s of media time, and again at full-screen size when they have controls; and the window itself, captured every 16 ms of the page's time for 3 s under Playwright's fake clock, plus up to two windows of 2 s further down.

**Results.** Seven or more transitions in one second over more than 21,824 CSS px² (25% of the field): failure, high for window captures and images, medium for a video whose sampling missed frames; named as red flashes for red transitions; medium for a video that fails only at full screen. Below that: no failure found, with the measures kept so a snapshot is judged again offline. Media that could not be read (a cross-origin video without CORS) is named, never failed. No ACT rule exists for 2.3.1; fixtures are made in `test/probes-flash.test.ts`. Not measured on pages that flash, nor cross-checked with EA's IRIS.

**Limits.** Frames are the page's in Chromium; screen frame rates are not modeled. Only the first windows and seconds are read: flashing after an interaction or further down is missed. DRM video and players in cross-origin frames (YouTube embeds) are not read. HDR is not handled. Moving high-contrast patterns count as transitions; no pattern rule is applied.

### 2.2.2 Pause, Stop, Hide and 2.2.1 Timing Adjustable (`--probe motion`)

**Only when named**: it moves the page's time for minutes (up to 20 hours) and presses controls, so neither `--probe all` nor `--probe interact` runs it. Two records: variant `motion` (2.2.2) and `time-limits` (2.2.1). Budgets: 110 s and 8 presses for 2.2.2, 60 s for 2.2.1.

**2.2.2** (`src/probes/motion.ts`, `src/pixels/motion.ts`). Under Playwright's fake clock, the probe lists animations, SVG animations, autoplaying videos, animated images, canvases and `marquee`, and captures the window in 230 ms steps for 10 s, then every 5 s up to 2 min 10 s. A region lasts when it changed more than once, over more than 5 s, after the fifth second; text that updates by itself is read as ACT efbfc7 defines it. Controls named to pause, stop or hide (English, Portuguese, Spanish) are pressed once each on a fresh load, nearest first, and the items watched for at least 4.6 s of page time; frequency controls are never set. What still moves is watched again on a second load.

- Failure, high: content that moves, blinks or scrolls for more than 5 s, or text that updates, next to other content, with no control named to pause, stop or hide it, seen on two loads; medium when only pixels show it, or when the controls pressed did not stop it.
- No failure found: a control stopped or hid it, or a video has the browser's controls (never a pass).
- Needs review: a control not pressed (skip list, cover, budget), a frequency control only, an unclear press, motion on one load of two, an animation that only changes colors.
- Not counted: motion that ends within 5 s or changes once; content alone on the page. A `marquee` axe-core failed is axe-core's. Essential motion is left to a person.

**2.2.1** (`src/probes/time-limits.ts`). The fake clock jumps through checkpoints from 10 s to 20 h. At each, the probe records a navigation, reload or submission (intercepted), the address set in place or most text replaced; a warning about the session or the time; text that went away; refused requests. A second load times the warning and the consequence; when the warning has a control named to extend ("Stay signed in"), or one that does not sign out ("OK"), a third load presses it. Sign-out controls are never pressed.

- Failure, high (SCR16, SCR1): with no input, a consequence within 20 h, on two loads, with no warning, or after a warning with no control that extends it.
- Failure, medium: the consequence still comes after the extend control was pressed; a warning less than 20 s ahead.
- No failure found: the control extended the time (one extension tried; WCAG asks for ten).
- Needs review: a consequence after a refused request or on one load; text that went away and never came back; a warning with nothing after it.
- A meta refresh is axe-core's `meta-refresh`; an HTTP `Refresh` header is `rampa/refresh-header`. Nothing in 20 hours: no applicable content.

**The judgment** (`src/criteria/timing-adjustable.ts`), only for a 2.2.1 failure: a pass must name an exception (real-time, essential, over 20 hours) or a way to adjust the limit and quote the page (12 characters at least). `rampa eval --rules pause-stop-hide,timing-adjustable` runs the probe on ACT efbfc7 and bc659a. Fixtures: `test/fixtures/probes/motion-*.html` and `time-*.html`.

**Limits.** Motion is read on load, with no input, at one window size. Pixels are compared, not understood. One mouse press per control. Whether motion is essential and a control easy to find stays with a person. Time limits are only those the page's scripts enforce with no input: server-ended sessions, idle timers that start on typing and anything behind a sign-in are not seen. Pages that compare the fake time with the server's may behave differently. Chromium only.

### 2.4.7 Focus Visible and 2.4.11 Focus Not Obscured (`--probe keyboard`)

These ride on the keyboard walk (probe version 2), which turns off animated scrolling and waits for scrolling to stop (at most 1.5 s) before each stop.

**2.4.7.** At each forward stop, the element's box plus 32 px is captured focused and twice blurred (the second marks pixels that change on their own as noise), then focus is given back. When nothing changed there, the whole viewport is compared (ACT oj04fd). No image is saved. The same captures give 1.4.11 the indicator's colors ([contrast in states](#contrast-in-states-143-and-1411---probe-states-and-the-keyboard-walk)). For a text field the caret's color and contrast are read from its styles. A change is never a pass:

- Failure, high: no pixel changes in the region or viewport; the same on a text field whose caret does not show or that is read-only; focus back on the document within 150 ms (F55). Medium when the element is entirely covered (pointing to 2.4.11).
- Not reported: a text field whose caret shows noticeably and nothing covers it (the Understanding's example of a visible indicator).
- Needs review: a change only elsewhere in the viewport; fewer noticeable pixels than a 1 px outline would paint. Noise over 10% of the region: not judged.

**2.4.11.** At every stop, a 5×5 `elementFromPoint` grid over the focused element, in the main walk and in a lighter walk at 390×844. Every point covered by something other than the element or its ancestors, and neither painting it magenta nor hiding it changes a pixel: failure, high, naming the cover (raised to its fixed or sticky layer) and suggesting `scroll-padding-top` or `-bottom`. A cookie banner counts as author content. Translucent and partial covers (2.4.12) are not reported. Under `--wcag 2.1` it never counts toward the exit code, even with `--fail-on any`.

**Limits.** Chromium scrolls a focused element to the middle, so fixed banners mostly cover elements already in view. 2.4.7 uses only the run's window size; the 390×844 walk serves 2.4.11 alone, in desktop mode unless `--device` emulates a phone. A faint change is a pixel count; forced colors are not tested. A page that changes its indicator on `focus` events may show the second focus differently.

### 2.4.1 Bypass Blocks: skip links (`--probe keyboard`, rule `rampa/bypass-blocks`)

The keyboard probe's third record (variant `skip-link`, version 1), on a fresh page.

**What it does.** From the top, Tab up to 8 times, recording fragment links (what they name, what they skip) and links named like skip links ("Skip to content", "Pular para o conteúdo"), read again 400 ms later for whether they show. Up to 3 whose target comes after them are pressed (Enter), and the probe records where focus and the next Tab land. Links to other pages, routes, buttons and form content are never pressed. A link works when focus or the next Tab lands on, in or after the target (`src/site/bypass-blocks.ts`).

**Results.** One page cannot show what repeats, so the rule never fails 2.4.1; failures come from a crawl ([criteria across pages](site-criteria.md#241-bypass-blocks)).

- No failure found: a skip link that shows on focus and works; a main landmark or heading after the blocks (ARIA11, H69); nothing to pass.
- Needs review: a skip link whose target is missing, or that leaves focus where it was; one that works but never shows (low, G1); blocks with no way past them (on the page); a way past that is a control the probe does not press.

This rule settles axe-core's `bypass` result when it ran.

**Limits.** Only the first 8 Tab stops; only links are pressed (skip buttons, collapsing menus and script focus stay with a person). The main content is a guess on one page. Visibility is read once. Chromium only.

### State variants: 1.1.1 and 3.1.1 (`--probe variants`, rules `rampa/carousel-name` and `rampa/language-versions`)

The same content in other states. Observe class: it never clicks. Only when named, never with `all`, since it loads other pages over the network.

**Carousels (1.1.1, F20).** Under Playwright's fake clock the probe finds carousels (`aria-roledescription`, or library classes such as `carousel`, `swiper`, `slick`, `splide`), at most four, plus large images whose address a script swaps, jumps the clock eight times by 2 s, and captures each picture once as a 16×16 grey thumbnail. `rampa/carousel-name`: two pictures or more that differ (a mean of 16 grey levels) under one non-empty name: failure, medium; review when not every picture could be captured. Names that change with the picture are 1.1.1's judgment's.

**Language versions (3.1.1).** From `hreflang` alternates and the language switcher's links, up to four other-language versions are loaded behind their own guards, and their text in the declared language (at most 3,000 characters) is read by the language identifier ([judged criteria](criteria.md#311-language-of-page)). `rampa/language-versions` fails a version whose `lang` the text is not in, only when clear (150 letters and 20 words at least, one language well ahead). The finding sits on the switcher's link, or the root when the version is only in the head.

Fixtures: `variants-carousel-*.html`, `variants-lang-home.html`. Not measured on a targeted corpus.

**Limits.** Only carousels that play on timers, or whose slides can be shown in place; click-only tracks go to review at most. CSS background pictures and `<picture>` sources are not followed. Whether one name fits several pictures is not decided. A version behind a sign-in or cookie wall reads the wall.

### The cognitive observation (`--probe cognitive`, read by `--profile cognitive`)

The probe of the cognitive profile ([cognitive-profile.md](cognitive-profile.md#checks-that-watch-the-live-page-motion-interruptions-layout-shifts-and-paste)); no WCAG rule reads it. `--profile cognitive` adds it to every web page Rampa loads; `--probe cognitive` records it alone for later replay. Never part of `all`.

**What it does.** `src/probes/cognitive.ts` loads the page twice at once, behind the guard: **observe** and **reduce** (`prefers-reduced-motion: reduce`). A recorder (`src/probes/cognitive-kit.ts`) logs layout shifts, permission requests (answered as closed, never granted), media that starts, and every 300 ms the dialogs, layers over the page, floating messages, carousel slides and playing videos. At 1 s and at the end of the window (8 s, 3 s with `--fast`, or `coga.observe`) it lists animations and reads up to 10 animated images already received. On the observe load it dispatches `paste`, `beforeinput` and `copy` events on up to 20 text fields and `copy` and `contextmenu` on the main text, recording whether the page cancelled them. Reads use `quietEvaluate` (no user gesture), so the page never gets user activation unless `--wait-for` waits for a selector.

**The record.** Two records of kind `cognitive`, version 1, variants `observe` and `reduce`, with the facts in `data` (`CogaData`); thresholds live in `src/advisory/checks/`. It costs the load time plus the window. No click, key, focus, scroll, typing or submission; nothing is written to the clipboard.

## App screens: Android and iOS

The keyboard walk, text at 200% and orientation on an app screen, written as the same observation records the web probes write, so the same rules judge them, offline from a saved snapshot too.

> [!WARNING]
> **None of this has run on a real device.** The Android probes are tested against a fake adb that answers from hand-written UI Automator dumps (`test/android-device.ts`, `test/fixtures/android/probes/`), and the iOS side against a hand-written export (`test/fixtures/ios/probes.json`). The Swift helper that writes iOS probe steps has not been compiled. Every report with app-screen probe records says so in its notes.

```sh
rampa check android: --probe keyboard,layout,orientation          # the connected device's screen, then the probes
rampa check recordings/android-com-example-shop-sign-in.snapshot.json   # judged again, with no device
rampa check sign-in-orientation.json sign-in-text.json             # XCUITest exports with probe steps (docs/ios.md)
```

| Kind | Android (over adb) | iOS (XCUITest export) | Record |
|---|---|---|---|
| keyboard | Tab and Shift+Tab as key events, the screen dumped after each | not built: Full Keyboard Access cannot be turned on from a UI test | `keyboard`, `keyboard-walk`, v2 |
| layout | font scale 1.0 and 2.0 | Dynamic Type default and AX2 | `layout`, `text-size-200`, v1 |
| orientation | upright, sideways, upright | upright, landscapeLeft, upright | `orientation`, `orientation`, v1 |

Each record has `platform` in its `data`, and its conditions name the device. Other probe kinds drive a browser and do not run on an app screen; a note says which. A saved dump is one state of the screen and is checked without probes.

### Android, over adb

Nothing is installed on the device. Keyboard runs first (it changes no setting), then layout and orientation; every step reads the screen with `uiautomator dump`. The walk sends `input keyevent 61` (Tab), `input keycombination 59 61` (Shift+Tab, Android 13 and later) and the arrows only to leave a suspected trap; it never presses Enter, Space, Back, Home or Esc, and never taps. Layout sets `settings put system font_scale` to 1.0 and 2.0; orientation turns `accelerometer_rotation` off and sets `user_rotation`. Settings are put back at the end, on failure and on Ctrl+C; if that fails, the terminal gives the adb command.

- **Keyboard** (2.1.1, 2.1.2, 3.2.1, 2.4.7, 2.4.11): Tab wraps round the app's window; focus returning to another stop or staying put is a suspected trap, tried with Shift+Tab and the arrows in two rounds. 2.4.7 compares each stop's screenshot with the next; 2.4.11 uses a 5×5 grid over the node's bounds. 3.2.1 changes (another app, a new window) go to review only. 1.4.11 focus indicators are not checked. Budgets: 60 stops each way, 240 s.
- **Text at 200%** (1.4.4): text whose box is shorter at 200% and no wider is cut (failure, high); text the app shortens ("Continue to chec…": medium); text pushed off or overlapping: review. Text cut inside a fixed box, or with `ellipsize`, is not seen. An app that comes back on another screen is not compared.
- **Orientation** (1.3.4): the display stays upright while the device is sideways (failure, high, as ACT b33eff); a landscape layout that only asks to turn back (high); most text gone with no message (review). On screens 600 dp wide or more, Android 16 ignores an app's orientation lock.

### iOS, from an XCUITest export

XCUITest runs on a Mac, so iOS probes are steps a UI test exports ([docs/ios.md](ios.md#probes-orientation-and-text-size)). `RampaExport.captureOrientation` turns the device to portrait, landscapeLeft and portrait and reads the app's frame. `RampaExport.captureTextSize` launches the app at the default Dynamic Type size and at AX2 (194% of the default body size, which the findings name); text past the window's edge is cut (failure, high), and on iOS 17 and later Apple's accessibility audit issues are items to review. There is no keyboard walk.

### How the rules read app-screen records

The web's rules, with messages and evidence worded for an app:

| SC | Rule | On an app screen |
|---|---|---|
| 1.3.4 | `rampa/orientation` | display kept upright; a layout that asks to turn back; text gone (review) |
| 1.4.4 | `rampa/resize-text` | text cut (high), shortened (medium), past the edge (iOS, high); pushed off, overlaps, audit issues (review) |
| 2.1.1 | `rampa/keyboard-reach` | a control the walk never reached |
| 2.1.2 | `rampa/keyboard-trap` | a cycle never left, twice; inside a dialog window, review |
| 2.4.7 | `rampa/focus-visible` | no pixel changed when it took focus |
| 2.4.11 | `rampa/focus-obscured` | every grid point covered, no pixel changed |
| 3.2.1 | `rampa/on-focus` | another app, window or screen after a Tab: review only |
| 1.4.11 | `rampa/focus-indicator-contrast` | not checked |

1.4.10 and 1.4.12 do not run on app screens. Nodes are matched to the snapshot by type, resource-id or accessibilityIdentifier, role and name; unmatched facts are counted as such.

### Running on a device, and what was tested

`adb devices` must list the device as `device`, with the screen to check open and animations turned off (a screen that keeps moving never lets UI Automator go idle). Then `rampa check android: --probe keyboard,layout,orientation --save recordings`. If a run is cut short, check the font size and auto-rotate settings. Everything was tested with the fakes only (`test/native-probes.test.ts`); their screenshots are drawn from the dumps.

## Known gap

On the Linux CI runner (Chrome), a page that autofocuses a field ends the keyboard walk with 2.1.1 not checked, while Edge on Windows completes the same walk. The report says the criterion was not checked, so nothing is claimed; the cause is still being investigated.

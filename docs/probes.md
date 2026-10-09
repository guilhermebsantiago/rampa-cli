# Probes

A probe drives a web page after Rampa has collected it, read-only, and records what it saw. Rules then turn those facts into findings. This is how Rampa checks criteria that no static scan can: what happens when the page is narrowed to 320 CSS px, when text spacing is raised, when someone moves through it with the keyboard.

```
target ─► collect (snapshot + axe) ─► probes (--probe) ─► rules and criteria ─► report
                                         │                      ▲
                                         └─ snapshot.observations ─┘   (rules read only the snapshot)
```

Probes are **off by default**. Turn them on per run:

```sh
rampa check https://example.com --probe all          # layout and keyboard
rampa check page.html --probe layout                 # reflow (1.4.10) and text spacing (1.4.12)
rampa check page.html --probe keyboard               # 2.1.1, 2.1.2, 3.2.1, 2.4.7, 2.4.11
rampa check page.html --probe all --save .rampa/rec  # keep the observations to replay offline
```

Why off: each probe loads the page again, and the keyboard walk takes screenshots at every Tab stop, so a probed page costs seconds to tens of seconds more than an unprobed one. The plan ([wcag-coverage.md](plans/wcag-coverage.md), 4.6) makes each kind a default only after it passes the evaluation gate and its cost is measured on real pages. `--probe` works with `rampa check` on URLs and HTML files; it does not run with `--crawl` yet.

## What a probe may do

Every probe in this release is in the **observe** class:

- it presses Tab, Shift+Tab and Esc, and the arrow keys only to try to leave a suspected keyboard trap;
- it resizes the viewport and injects CSS;
- it moves focus away with `blur()` to compare a focused element with its unfocused self;
- it never clicks, never presses Enter or Space on a control, never types, and never submits a form.

Each probe kind opens its own browser context with the same storage state, headers, cookies, color scheme and device settings as the collection (the layout probes force a 1280×1024 desktop window, as browser zoom would), and loads the page fresh, so one probe's state never leaks into another's.

### The network guard

The guard is on for the whole life of a probe page, including its load:

- only GET, HEAD and OPTIONS reach the network; every other request, `sendBeacon` included, is aborted and logged;
- once the page has loaded, a top-level navigation is answered locally with 204 and logged: the page stays, and the attempt is evidence (3.2.1);
- WebSockets and EventSource are blocked;
- `window.open` is hooked: it is logged and returns `null`; any popup that opens anyway is closed;
- form submission is hooked and cancelled, and logged;
- `alert`, `confirm` and `prompt` are dismissed (`confirm` answers cancel) and logged;
- downloads are refused and service workers are blocked, so nothing answers a request behind the guard's back;
- permission prompts are denied (Playwright grants none).

A GET can still have side effects on a badly built server. That cannot be ruled out, which is why probes never click. Every probe record lists what the guard blocked and which navigations it answered.

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
- **Needs review** (`report.needsReview`): what a person must look at, such as text that overlaps after spacing is raised or a faint focus change. Never a failure, never part of the exit code.
- **Beyond the target.** Rampa's reports target WCAG 2.1. A 2.4.11 result (new in WCAG 2.2) is shown and marked "beyond the 2.1 target", and never counts toward the exit code.
- **Coverage, per criterion and method.** `report.coverage.probes` lists, for each criterion a probe rule checked, the method and probe version, the conditions, how many elements it applied to, failures, items to review and unmatched facts. A probed criterion leaves the "not checked" list. "No failure found" applies to the conditions shown; it is never a pass.

```
Coverage of this run
  Checked by axe-core (partial):  …
  Judged with verified evidence:  …
  Not checked automatically:      41 of 50 WCAG 2.1 A/AA criteria (--verbose lists them)
  Probed (experimental):
    1.4.10  probe/layout@1 (rampa/reflow) · 320×256 CSS px · chromium 141 (headless): 2 failure(s) · 512 element(s)
```

## Coverage by criterion and method

What `--probe all` adds, and what each criterion still needs from a person. Every rule is experimental.

| SC | Method (probe, rule) | Failure | Needs review | Stays manual |
|---|---|---|---|---|
| 1.4.10 Reflow | `probe/layout@1`, `rampa/reflow`: 320×256 CSS px from 1280×1024 | content past the right edge of a page that scrolls sideways; text cut at 320 px that was whole at 1280 px | doubtful cuts; new overlaps | lost functionality; content gone behind collapsed menus (F102); the two-dimensional exception beyond element types |
| 1.4.12 Text Spacing | `probe/layout@1`, `rampa/text-spacing`: the four values as user overrides | text cut that was whole (F104); an ellipsis with no full text (medium) | doubtful cuts; new overlaps | scripts where a metric does not apply; text in canvas and images |
| 2.1.1 Keyboard | `probe/keyboard@2`, `rampa/keyboard-reach`: Tab and Shift+Tab walk | a control neither walk reached (medium for a negative tabindex) | — | operating what was reached; drag and drop; states after interaction; handler-only controls |
| 2.1.2 No Keyboard Trap | `probe/keyboard@2`, `rampa/keyboard-trap` | a cycle Tab, Shift+Tab, Esc and the arrows never leave, twice | traps inside dialogs; traps with exit text | traps after interaction; plug-ins |
| 2.4.7 Focus Visible | `probe/keyboard@2`, `rampa/focus-visible`: focused and blurred captures | no pixel changes in the region or the viewport; focus removed on arrival (F55) | a change only elsewhere; a faint change | whether a change is perceivable; forced colors; other browsers |
| 2.4.11 Focus Not Obscured (Minimum) | `probe/keyboard@2`, `rampa/focus-obscured`: 5×5 hit grid, confirmed by pixels | the element entirely under author content (beyond the 2.1 target) | — | content the user opened or moved; other viewports |
| 3.2.1 On Focus | `probe/keyboard@2`, `rampa/on-focus` | navigation, new window, submission or modal on focus (high); a browser dialog or a script focus move (medium) | an address change with no load | focus by mouse; changes after interaction; content changes that change meaning |

"No failure found" in a coverage line applies to the conditions it names: one browser engine, one viewport, the states the observe class reached. It is never a pass.

## Cost

Measured on 2026-10-09 with Microsoft Edge 154 headless on a Windows 11 desktop that other jobs were loading at the same time:

| Page | Reflow | Text spacing | Keyboard walk (with pixels) |
|---|---|---|---|
| rampa.guilhermebs.com.br | 1.7 s | 1.6 s | 25.7 s, 50 + 50 stops, 0.26 s per stop |
| www.gov.uk | 1.0 s | 2.0 s | 42.1 s, 89 + 89 stops, 0.24 s per stop |
| agenciabrasil.ebc.com.br | 4.5 s | 3.2 s | 67.8 s, 150 stops (budget reached), 0.45 s per stop |

The layout probes are within the plan's 2–5 s per page. The keyboard walk is above the plan's 0.2 s per stop: each forward stop takes three region captures, a backward stop only the hit grid, and a page whose pixels move on its own adds the viewport confirmation. Budgets: 150 stops per direction, 120 s per walk, 4,000 measured boxes per layout. Each record keeps `durationMs`, and a record cut short says why in `reason`. A saved snapshot with all probes is a few hundred kilobytes; screenshots are kept as hashes, not images.

## Not yet

- `--probe` runs from `rampa check` on URLs and HTML files. It does not run with `--crawl`, from the programmatic API, from `rampa mcp`, or from the Playwright and Puppeteer helpers.
- The `rampa.config` file has no `probe` key yet.
- Captures are not written next to a saved snapshot; only their hashes are recorded.
- The activate class (clicks, Enter and Space, `--probe interact`) and `--allow-submit` do not exist yet; nothing here clicks or submits.
- The plan's flake gate (each fixture 10 times in CI) is not wired into CI; the probe test files were run five times in a row by hand.

## The checks

### 1.4.10 Reflow (`--probe layout`, rule `rampa/reflow`)

**The probe.** The page loads in a 1280×1024 desktop window and settles; every element that owns text, and every control, is measured: its text box (the union of its own text fragments), the part of it that ancestors with `overflow: hidden` or `clip` leave visible, whether it sits inside content that needs two dimensions, and which pieces of text of different elements overlap. The window is then resized to 320×256 CSS px, which is 1280×1024 at 400% zoom (Understanding 1.4.10), and everything is measured again. Resizing instead of reloading is what zoom does; the window is in desktop mode, so the viewport meta is ignored as it is under browser zoom. Whether the window really scrolls sideways is tested by scrolling, not read from `scrollWidth`, because `overflow` on `html` or `body` can hide what `scrollWidth` reports.

Content that needs two dimensions is exempt by element type: `img`, `video`, `canvas`, `svg`, `math`, `pre`, `code`, `iframe`, `object`, `embed`, `role=application`, and data tables with header cells (the table as a whole). Text inside an element that scrolls sideways on its own is not "past the edge".

**The rule.**

| Observation | Result |
|---|---|
| The window scrolls sideways at 320 px and visible text or a control, outside exempt content, extends past the right edge (1 px tolerance) | failure, high |
| Text partly cut at 320 px (2 px across, or a quarter of a line down) that was whole at 1280 px | failure, high |
| The same, when a `title` or `aria-label` holds the full text, the cutting container hides other text completely (a carousel), or it shows an ellipsis | needs review |
| Text of two elements that overlaps at 320 px and did not at 1280 px | needs review |
| Text that disappears at 320 px (collapsed navigation, F102) | not reported: finding it needs the menu opened, which the observe class never does |

At most 10 findings per kind are listed; the coverage line counts the rest. Evidence gives the scroll width, the element's horizontal extent and how far it passes the edge, or how many pixels are cut and by which element.

**Limits.** One browser engine (Chromium). 320×256 is an emulation: a real 1280×1024 screen at 400% leaves about 318×236, hence the tolerances. Horizontal scrolling inside a container that is not exempt is not reported yet. Text in open shadow roots is measured, but it is unmatched in the snapshot, which does not collect shadow roots, so it is never reported.

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

### The keyboard walk: 2.1.1, 2.1.2 and 3.2.1 (`--probe keyboard`)

**The probe.** A fresh page at the run's viewport (1280×800 by default) settles, then sits for 1.5 s with no key pressed: whatever it does on its own then (timers that change the address, open windows, navigate) is recorded and later subtracted from what a Tab seems to cause. The probe lists the controls Tab should reach, then presses Tab until focus goes back to the document (once round the page) or the budget of 150 stops runs out, and then Shift+Tab backward the same way. At each stop it records the focused element (ref and identity), its box, the scroll position, the composite widget it belongs to, and, 150 ms later, where focus is then. In-page hooks record each element that receives focus (the `focus` event in the capture phase, so a script that moves focus on in its own `focus` handler is still seen), `window.open`, form submission, `showModal`, `history.pushState` and `replaceState`; the guard records navigations and dialogs. A walk takes about 0.4 s per stop on Edge.

**Suspected traps.** When focus comes back to a stop without having left the page's elements, the probe tries to leave the cycle: Tab, Shift+Tab, Esc then Tab, and each arrow key then Tab or Shift+Tab, as many presses as the cycle has elements plus two, in two rounds (a verdict that rests on an absence is measured twice).

**2.1.1 Keyboard (rule `rampa/keyboard-reach`).** A visible, enabled native control (`a[href]`, `button`, `input`, `select`, `textarea`, `summary`, `iframe`, `contenteditable`) or explicit widget role, not inert, `aria-hidden`, moved off the page or clipped out of view by its container, that neither walk reached, is a failure. Left out, as correct patterns: items of a composite widget that was reached (roving tabindex, `aria-activedescendant`), radios of a group that was reached, a link whose address a reached link also has (the duplicate image link of a card), and a control that holds a reached element. A widget none of whose items is reached is reported once. Confidence is high, and medium for an element with a negative `tabindex`, which is often a duplicate the walk cannot recognize. Handler-only candidates (a `div` with a click listener and no role) are not reported: listeners are too noisy, and they wait for the click-versus-key probe (C2). Nothing is reported when the walk did not go round the page.

**2.1.2 No Keyboard Trap (rule `rampa/keyboard-trap`, ACT 80af7b).** A cycle that every key failed to leave, in both rounds, is a failure, high. It goes to review instead when every element of the cycle is inside a dialog (a modal that holds focus is correct when a control inside closes it, which the observe class cannot press), or when nearby text names a way out ("press Ctrl+M"), which C2 will execute. A cycle that some key left is not reported; the coverage line says how focus left.

**3.2.1 On Focus (rule `rampa/on-focus`).** For each element the walk focused, what happened between that key press and the next, minus what the page did with no key pressed:

| Observation | Result |
|---|---|
| a navigation (answered locally by the guard), a new window, a form submission, or a modal dialog | failure, high |
| a browser dialog (`alert`, `confirm`, `prompt`), or focus moved by script outside the focused element | failure, medium |
| the address changed with no page load (`pushState`, `replaceState`) | needs review |
| content changed | not reported |

Evidence names the key sequence (`Tab ×4`), the element, what followed and how many milliseconds later.

**Limits.** Chromium's Tab order only, at one viewport. States reached by activating something (menus, dialogs opened by a button) are not walked. Inside a cross-origin frame the walk sees only the frame element, and stops after 60 stops inside one frame. Elements in open shadow roots are walked but are unmatched in the snapshot, so they are never reported. An event that a page fires more than 150 ms after focus may be attributed to the next stop. 2.1.1 does not test that a reached control can be operated with the keyboard; that needs the activate class (C2).

### 2.4.7 Focus Visible and 2.4.11 Focus Not Obscured (`--probe keyboard`)

These ride on the keyboard walk (probe version 2). The walk turns off animated scrolling (`scroll-behavior: auto`) and, before measuring a stop, waits for scrolling to stop (at most 1.5 s), so a page that scrolls with a library is measured where it lands.

**2.4.7, the probe.** At each forward stop, the element's box plus a 32 px margin is captured focused. Focus is then taken away with `blur()` and the same region is captured twice: the second capture marks pixels that change on their own (carousels, video, animation) as noise, never counted. Focus is then given back to the element with `focus({ preventScroll: true })`, so the next Tab reaches the element's own key handlers, as it would with no capture in between. When nothing changed in the region, the whole viewport is captured focused and blurred to confirm, because ACT oj04fd counts a change anywhere in the viewport. The record keeps, per stop, the region, the element's box, how many pixels changed, how many by at least 3:1 contrast, how many *noticeably* (3:1, or 48 in one color channel, which catches a change of hue), how many were noise, the bounding box of the change, its main colors, and hashes of the two captures. Captures are not saved as images.

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

**2.4.11, the probe.** At every stop, forward and backward, a 5×5 `elementFromPoint` grid over the part of the focused element inside the viewport. A point counts as covered when it hits something that is neither the element, inside it, nor an ancestor of it (an ancestor on top means the element lets the pointer through, which is not evidence of a cover). When every point is covered, two pixel checks follow: the element is painted magenta, then hidden; neither may change a pixel of the region. Focus is given back to the element afterwards.

**2.4.11, the rule.** Every point covered and neither check changed a pixel: failure, high. The finding names the cover, raised to its fixed or sticky layer, with its size and position, and suggests `scroll-padding-top` or `scroll-padding-bottom` of its height when it sits at the top or bottom of the window. A cover that lets pixels through (translucent) is not reported, and is counted in the coverage note; a partial cover is not reported (that is 2.4.12, AAA). 2.4.11 is new in WCAG 2.2: under Rampa's WCAG 2.1 target the result is marked "beyond the 2.1 target" and never counts toward the exit code, even with `--fail-on any`.

**Limits.** Chromium scrolls an out-of-view focused element to the middle of the window, so a fixed banner mostly covers elements that were already in view; other browsers scroll differently. Only the run's viewport is walked (the plan's second viewport, 390×844, is not run yet). A faint change is a pixel count, not a judgment of perceptibility, and forced colors are not tested. Focus indicators drawn with `:focus-visible` survive the probe's refocus (Chromium keeps the keyboard modality), but a page that changes its indicator on `focus` events may show the second focus differently.

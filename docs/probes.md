# Probes

A probe drives a web page after Rampa has collected it, behind a network guard, and records what it saw. Rules then turn those facts into findings. This is how Rampa checks criteria that no static scan can: what happens when the page is narrowed to 320 CSS px, when text spacing is raised, when someone moves through it with the keyboard.

```
target ─► collect (snapshot + axe) ─► probes (--probe) ─► rules and criteria ─► report
                                         │                      ▲
                                         └─ snapshot.observations ─┘   (rules read only the snapshot)
```

Probes are **off by default**. Turn them on per run:

```sh
rampa check https://example.com --probe all          # layout, keyboard, hover, orientation, shortcuts and media
rampa check page.html --probe layout                 # reflow (1.4.10), text spacing (1.4.12), 200% zoom (1.4.4)
rampa check page.html --probe keyboard               # 2.1.1, 2.1.2, 3.2.1, 2.4.7, 2.4.11, and skip links (2.4.1)
rampa check page.html --probe hover                  # content on hover or focus (1.4.13)
rampa check page.html --probe orientation            # portrait and landscape (1.3.4)
rampa check page.html --probe shortcuts              # single character key shortcuts (2.1.4)
rampa check page.html --probe media                  # audio and video: captions, alternatives, sound on load (1.2.1–1.2.5, 1.4.2)
rampa check page.html --probe all --save .rampa/rec  # keep the observations to replay offline
```

Why off: each probe loads the page again, and the keyboard walk takes screenshots at every Tab stop, so a probed page costs seconds to tens of seconds more than an unprobed one. The plan ([wcag-coverage.md](plans/wcag-coverage.md), 4.6) makes each kind a default only after it passes the evaluation gate and its cost is measured on real pages. `--probe` works with `rampa check` on URLs and HTML files; it does not run with `--crawl` yet.

## What a probe may do

Every probe but one is in the **observe** class:

- it presses Tab, Shift+Tab and Esc, and the arrow keys only to try to leave a suspected keyboard trap;
- it resizes the viewport, changes the device scale factor (200% zoom) and injects CSS;
- it moves focus away with `blur()` to compare a focused element with its unfocused self, and gives it back with `focus()`;
- it moves the pointer, gives an element focus with `focus()` to see what shows, and scrolls an element into view;
- it jumps Playwright's fake clock forward (the hover probe installs it before the page loads; time otherwise flows as usual);
- it turns the window between portrait and landscape and sets the screen orientation over the DevTools protocol, with a `window.orientation` shim where the browser has none (the orientation probe); it reads the web app manifest with a GET and runs axe-core's experimental css-orientation-lock in the probe page;
- it focuses the page's `body` for a moment before the walk, so the first Tab starts at the top of the page;
- it presses Enter on a link whose address is the page itself plus a fragment that names an element of the page (a skip link, `#main`), at most three such links among the first eight Tab stops, each from a fresh start at the top (the skip-link probe, 2.4.1); never on a link to another page, a route of a single-page app (`#/about`), a button, or anything in a form;
- it plays audio and video muted for a few seconds, makes their text tracks load, and reads their sound from a copy of their stream; it pauses them and puts their time, muted state and track modes back afterwards (the media probe). It never unmutes anything. For that probe the browser starts with `--autoplay-policy=no-user-gesture-required`, as a browser that lets pages play sound on load does; Playwright starts headless browsers with `--mute-audio`, so no sound reaches the speakers;
- it never clicks, never presses Enter or Space on a control (Enter on an in-page link, above, is the one exception the plan's observe class allows), never types, and never submits a form.

The shortcuts probe (`--probe shortcuts`, 2.1.4) is the first of the plan's **activate** class, and the only one so far. With focus on the page's `body`, it presses each printable key on its own (letters, digits, punctuation and symbols, then capitals; never Space, which scrolls), and a key may do whatever the page bound it to. Then it presses Space on the checkboxes, switches and radios it found named for shortcuts or keys, to toggle them, presses the keys again, and toggles them back. It never clicks, never presses Enter, never types into a field (focus goes back to the body before every key, and if a script keeps a field focused the probe stops pressing), never changes a select, and the network guard is on the whole time, so a key that posts something (archive, delete, send) is blocked and a key that navigates is answered locally. A GET a key sets off still reaches the server; run it on pages where that is harmless, as with every probe.

Each probe kind opens its own browser context with the same storage state, headers, cookies, color scheme and device settings as the collection (the layout probes force a 1280×1024 desktop window, as browser zoom would; the hover probe keeps the run's window size in desktop mode, so a pointer can hover even with `--device`), and loads the page fresh, so one probe's state never leaks into another's. The orientation probe opens four: a 1280×800 window and a 390×844 phone, each loaded upright and sideways; the phone has touch, device scale 3 and an Android Chrome user agent with the browser's own version (unless `--user-agent` sets one), since some pages show their "rotate your device" overlay only to phones.

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

What `--probe all` adds, and what each criterion still needs from a person. Every rule is experimental.

| SC | Method (probe, rule) | Failure | Needs review | Stays manual |
|---|---|---|---|---|
| 1.2.1 Audio-only and Video-only (Prerecorded) | `probe/media@1`, `rampa/audio-video-only`: media listed, played muted | — | each audio player that shows or played, and each video with no audio track, with the transcript signals found near it and on the page | whether a transcript or alternative is equivalent; decorative video; media labeled as an alternative for text |
| 1.2.2 Captions (Prerecorded) | `probe/media@1`, `rampa/captions`: text tracks made to load | every captions or subtitles track of a video with sound fails to load or holds no cues | a video with sound and no captions track; a track still loading; a known player (YouTube, Vimeo…) in a frame of another origin | accuracy, completeness and timing; open captions; captions a player draws itself |
| 1.2.3 Audio Description or Media Alternative (Prerecorded) | `probe/media@1`, `rampa/media-alternative` | — (never, by design) | each video with sound, listing descriptions tracks, audio description controls and transcripts found | whether the visual information matters, and whether the description or alternative is adequate |
| 1.2.4 Captions (Live) | `probe/media@1`, `rampa/live-captions`: media whose duration is infinite | — | each live video with sound: applies here, not checked | everything about live captions |
| 1.2.5 Audio Description (Prerecorded) | `probe/media@1`, `rampa/audio-description` | — (never, by design) | each video with sound, listing descriptions tracks and audio description controls (a transcript does not count) | quality of the description; whether the soundtrack already says it |
| 1.3.4 Orientation | `probe/orientation@1`, `rampa/orientation`: portrait and landscape at 1280×800 and at 390×844 (phone), each loaded and then turned | content turned a quarter between orientations: `html`, `body` or most of the text (ACT b33eff); content gone in one orientation behind a "turn your device" message | a smaller element with text or images turned a quarter; content gone with no message (two comparisons); a turn message while the content still shows | essential orientation; real devices and their rotation lock; native apps |
| 1.4.2 Audio Control | `probe/media@1`, `rampa/audio-control`: what plays on load, with sound, watched for at least 4.5 s; its level read from its stream | sound that plays on its own for more than 3 s (a media element, an `Audio` object or Web Audio) with no native controls and no named pause, stop, mute or volume control near it or for the sound on the page (ACT 80f0bf): high when the level was read, medium when not | the only control is a pause or stop button away from it; autoplay the browser did not start; sound that could not be measured; sound under 3 s that was still playing | whether a control works (it is never pressed); sound started by an interaction; players in frames of another origin |
| 1.4.4 Resize Text | `probe/layout@1`, `rampa/resize-text`: 640×512 CSS px at device scale 2 (1280×1024 at 200%) | text cut by an ancestor's overflow `hidden` or `clip` (ACT 59br37, with its no-wrap ellipsis and line-clamp exceptions): high when zoom cut it, medium when it was already cut | line clamps; cut text whose full text is in a name; carousels; text past the edges of a window that does not scroll; new overlaps; text the narrow layout hides with no control seen to show it | text behind menus; lost functionality; other browsers and text-only zoom |
| 1.4.10 Reflow | `probe/layout@1`, `rampa/reflow`: 320×256 CSS px from 1280×1024 | content past the right edge of a page that scrolls sideways; text cut at 320 px that was whole at 1280 px | doubtful cuts; new overlaps; text cut by a window that cannot scroll sideways | lost functionality; content gone behind collapsed menus (F102); the two-dimensional exception beyond element types |
| 1.4.12 Text Spacing | `probe/layout@1`, `rampa/text-spacing`: the four values as user overrides | text cut that was whole (F104); an ellipsis with no full text (medium) | doubtful cuts; new overlaps | scripts where a metric does not apply; text in canvas and images |
| 1.4.13 Content on Hover or Focus | `probe/hover@1`, `rampa/hover-content`: up to 30 triggers, hovered and then focused | content over other content that Esc does not close (SCR39); content the pointer cannot move onto (F95); content that goes within 10 s on its own; each loss measured twice | a loss seen once of two tries; content that may be an input error; Esc that only moved focus; content that stays after the pointer and focus leave | triggers the probe does not find; input-error wording; touch; content that moves |
| 2.1.1 Keyboard | `probe/keyboard@2`, `rampa/keyboard-reach`: Tab and Shift+Tab walk | a control neither walk reached (medium for a negative tabindex) | — | operating what was reached; drag and drop; states after interaction; handler-only controls |
| 2.1.2 No Keyboard Trap | `probe/keyboard@2`, `rampa/keyboard-trap` | a cycle Tab, Shift+Tab, Esc and the arrows never leave, twice | traps inside dialogs; traps with exit text | traps after interaction; plug-ins |
| 2.1.4 Character Key Shortcuts | `probe/shortcuts@1`, `rampa/character-key-shortcuts`: every printable key with focus on the body, twice, against a wait with no key; settings named for shortcuts toggled with Space; `judgment/2.1.4@1` only clears | printable keys that change the page while no control has focus and that no setting on the page stopped (F99), one finding per page, medium | — | settings on other pages or behind login (the message says to waive); shortcuts active only on focus; keyboard layouts and IMEs; speech input |
| 2.4.1 Bypass Blocks | `probe/keyboard@1` (variant `skip-link`), `rampa/bypass-blocks`: the first 8 Tab stops, and Enter on up to 3 skip links among them | — (never on one page, by design; failures come from `--crawl`, [site criteria](site-criteria.md)) | a skip link that points nowhere, does not move focus, or never shows; links and controls before the content with no skip link, main landmark or heading after them; a skip button or menu toggle, which is never pressed | which blocks repeat on other pages (a crawl compares them); interleaved blocks; single-page-app views; whether a block is substantial |
| 2.4.7 Focus Visible | `probe/keyboard@2`, `rampa/focus-visible`: focused and blurred captures | no pixel changes in the region or the viewport; focus removed on arrival (F55) | a change only elsewhere; a faint change | whether a change is perceivable; forced colors; other browsers |
| 2.4.11 Focus Not Obscured (Minimum) | `probe/keyboard@2`, `rampa/focus-obscured`: 5×5 hit grid at the run's window and at 390×844, confirmed by pixels | the element entirely under author content (beyond the target under `--wcag 2.1`) | — | content the user opened or moved; other window sizes and zoom levels |
| 3.2.1 On Focus | `probe/keyboard@2`, `rampa/on-focus` | navigation, new window, submission or modal on focus, repeated when focus comes back (high); a browser dialog or a script focus move, repeated (medium) | a change that did not repeat; an address change with no load | focus by mouse; changes after interaction; content changes that change meaning |

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

## Not yet

- With `--crawl`, 2.4.1 is compared across the pages from their markup alone: a link into the page counts without being pressed, since the skip-link probe does not run there yet.
- `--probe` runs from `rampa check` on URLs and HTML files, and the programmatic `check()` takes `probes: ['layout', 'keyboard', 'hover', 'orientation', 'shortcuts', 'media']` (a browser passed in to `check()` is used as it is: without `--autoplay-policy=no-user-gesture-required`, sound set to play on load is held by the browser and only goes to review). Probes do not run with `--crawl`, from `rampa mcp`, or from the Playwright and Puppeteer helpers.
- The `rampa.config` file has no `probe` key yet.
- Items to review appear with the engine's and the rules' in every format: grouped by criterion and rule in the terminal (each element with `--verbose`), the Markdown and the HTML reports, counted in SARIF's coverage, and listed in the JSON (`needsReview`).
- Captures are not written next to a saved snapshot; only their hashes are recorded.
- The rest of the activate class (clicks, Enter and Space on controls, select changes, `--probe interact`) and `--allow-submit` do not exist yet; nothing here clicks or submits, and the shortcuts probe presses only printable keys on the body and Space on the settings it found.
- The plan's flake gate (each fixture 10 times in CI) is not wired into CI; the four probe test files were run five times in a row by hand, with no verdict changing, the 1.4.4 and 1.4.13 tests three times in a row on Edge, with none changing either, and the 1.3.4 and 2.1.4 tests three times (twice in a row and once in the full suite), with none changing. The media tests ran four times in a row on Edge, and once in the full suite, with no verdict changing. They have not run yet on the Linux CI runner's Chrome.
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

## Known gap

On the Linux CI runner (Chrome), a page that autofocuses a field ends the keyboard walk with 2.1.1 not checked, while Edge on Windows completes the same walk. The report says the criterion was not checked, so nothing is claimed; the cause is still being investigated.

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

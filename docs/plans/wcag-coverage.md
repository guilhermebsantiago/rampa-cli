# Rampa WCAG 2.2 coverage roadmap

Date: 2026-10-09. Status: wave A (A1–A10) is built, and from wave B so far B1 (frames and shadow roots), B3 (pixel contrast), B4 (zoom 200%), B5 (content on hover or focus), B6 (orientation), B9 (character key shortcuts), B10 (site criteria), B11 (media probe), B12 (language identifier), B13 (hidden informative images) and B15 (label visibility). The rest is a plan.

This plan builds on:

- the Rampa source on `main` at 0459809, with axe-core 4.14.0;
- research on each WCAG guideline group, and a critique of the 1.3 group;
- the W3C Understanding documents for 1.4.10, 1.4.11, 1.4.12 and 1.4.13, read for this plan because the research did not cover them.

Where the research overclaimed, this plan says so (section 7). Four work items are shared with the [cognitive profile plan](cognitive-profile.md): A1 is its WI-9, A6 its WI-11, B7 its WI-12 and B8 its WI-17. Each is built once, by whichever plan starts it first.

---

## 0. Summary

**Where Rampa is.** Reports state coverage against the 50 WCAG 2.1 A/AA criteria. Against the 55 of WCAG 2.2:

- 19 criteria have a check that can report a common failure;
- 9 of those are judged by a model, with evidence verified against the snapshot;
- only one, 2.4.4, uses facts from beyond the loaded page: where its links lead.

Nothing on the web drives the page: no key is pressed, no viewport changes, no time passes. Two coverage statements are wrong today:

- 1.2.2, 1.4.2 and 2.4.1 are listed as "checked by axe-core", but the axe rules behind them can only return pass or incomplete, and Rampa drops incompletes.
- 4.1.1 is listed as "not checked", although W3C says to treat it as always satisfied for HTML and removed it in WCAG 2.2.

**What this plan adds.**

1. WCAG 2.2 as the target, with `--wcag 2.1|2.2`.
2. Honest coverage, per criterion and per method: rules, judgment, probe, manual.
3. A probe stage. It drives the page with the keyboard, the viewport, hover, the pointer, time and media, and records what it observes in the snapshot. Criteria stay pure functions of the snapshot, and a saved snapshot replays offline.
4. Four waves of independent work items, ordered by value and by false-positive risk.

**Counts.** Counted against the 55 WCAG 2.2 A/AA criteria. Each column is cumulative, and the first, fourth and fifth rows add up to 55.

| | Now | After A | After B | After C | After D |
|---|:---:|:---:|:---:|:---:|:---:|
| Criteria the report states coverage against | 50 (WCAG 2.1) | 55 | 55 | 55 | 55 |
| **Automated check for common failures** | **19** | **25** | **36** | **46** | **50** |
| … of which judged with verified evidence | 9 | 9 | 12 | 21 | 23 |
| … of which checked by a probe, by pixels or across pages | 1 | 8 | 21 | 36 | 43 |
| Needs review only: Rampa lists candidates, never a failure | 0 | 3 | 5 | 8 | 5 |
| Manual only: nothing automated | 36 | 27 | 14 | 1 | 0 |
| Listed as checked although no check can fail | 3, plus 4.1.1 misreported | 0 | 0 | 0 | 0 |

**How to read the counts.** "An automated check for common failures" means that some check can report a failure for the usual ways a criterion fails. It does not mean the criterion is tested. Every criterion keeps a manual part, shown in the last column of the matrix, and for most criteria that part is the larger one. After wave D, no criterion is left with nothing automated. That is not the same as 55 tested criteria, and no report may say so.

Every new check ships as `experimental`, below the default confidence threshold, until it passes the gate in 4.9. Experimental checks are included in the counts above.

**Wave A, the first branches:**

- A1: WCAG 2.2 list and `--wcag`.
- A2: honest coverage.
- A3: a rule stage with content rules.
- A4: structure rules.
- A5: 2.5.8 target size.
- A6: the probe stage.
- A7: the keyboard walk, for 2.1.1 reachability, 2.1.2 traps and 3.2.1 changes on focus.
- A8: focus visible (2.4.7) and focus not obscured (2.4.11), from screenshot pairs.
- A9: reflow at 320 CSS px (1.4.10).
- A10: text spacing (1.4.12).

---

## 1. Terms

| Term | Meaning in this plan |
|---|---|
| **R** rules | A deterministic check with no model: axe-core, or Rampa's own rules over the snapshot. |
| **J** judgment | A model answers one narrow question, and the claim is kept only if verified against the snapshot: the quote is in the cited node, or the cited measurement is in the recorded facts. "Clears only" means the model may lower or remove a finding, never create one. |
| **P** probe | Rampa drives the page: keys, pointer, viewport, injected CSS, a fake clock, media playback. It records facts, never verdicts. |
| **V** pixels | A verdict depends on measured pixels: contrast, change between two screenshots, visibility. A vision model looking at a crop is judgment, not V. |
| **S** site | The check compares several pages of a crawl, or reads pages a link leads to. |
| **M** media | Decoding audio or video: loudness, frames, caption cues. |
| Needs review | Rampa found something a person must look at. It is never a failure and never changes the exit code. |
| No failure found | What a clean check result means. Rampa never prints "passed" for a criterion. |
| Beyond the target | A WCAG 2.2-only result in a `--wcag 2.1` run. It is reported but never counted toward the target or the exit code, as in the cognitive profile plan. |

---

## 2. Coverage matrix

The "axe-core today" column lists rules as Rampa runs them: axe-core 4.14.0 with the tags `wcag2a`, `wcag2aa`, `wcag21a` and `wcag21aa`. axe excludes experimental and deprecated rules from a tag run.

- † marks a rule that can only return pass or incomplete, never a violation.
- In "Planned", the letter before the colon is the wave, followed by the methods from section 1.
- Priority runs from 1 (highest) to 5.

| SC | Name | Level | axe-core today | Rampa today | Planned | Stays manual | Pri |
|---|---|---|---|---|---|---|:---:|
| 1.1.1 | Non-text Content | A | image-alt, input-image-alt, role-img-alt, svg-img-alt, object-alt, aria-meter-name, aria-progressbar-name: a name exists | Judged with vision: the name serves the image's purpose | A: R placeholder and file-name alternatives (F30), with no model. B: J informative images hidden from assistive technology (ACT e88epe); svg and canvas crops; lazy images loaded before capture. D: P carousel images whose name never changes (F20) | Equivalence for complex and contextual images; decorative or not; long descriptions; CAPTCHA usability | 1 |
| 1.2.1 | Audio-only and Video-only (Prerecorded) | A | none: audio-caption is deprecated and never runs | Not checked | B: P/M media inventory and transcript signals, as needs review. D: J transcript found and quoted; a failure only for a placeholder or broken transcript | Whether a transcript is equivalent; decorative video-only; labeled media alternatives | 3 |
| 1.2.2 | Captions (Prerecorded) | A | video-caption† | Listed as checked; reports nothing | A: axe's incomplete shown as needs review. B: P/M captions tracks that fail to load or hold no cues. D: M/V speech with no captions in any form, after a burned-in captions check | Accuracy, completeness, synchronization, speakers; players Rampa cannot read | 2 |
| 1.2.3 | Audio Description or Media Alternative (Prerecorded) | A | none | Not checked | B: needs review, listing what was found: audio description control, described version, transcript, descriptions track | Whether visual information matters, and whether the description or alternative is adequate. Rampa never fails a video here (section 6) | 4 |
| 1.2.4 | Captions (Live) | AA | none | Not checked | B: live media detected, reported as "applies here, not checked" | Everything about live captions | 5 |
| 1.2.5 | Audio Description (Prerecorded) | AA | none | Not checked | B: needs review as for 1.2.3, where a transcript does not count | Quality of the description; pauses; importance of the visuals | 4 |
| 1.3.1 | Info and Relationships | A | aria-hidden-body, aria-required-children, aria-required-parent, definition-list, dlitem, list, listitem, td-headers-attr; th-has-data-cells†. Not run: p-as-heading, td-has-header and table-fake-caption, which are experimental | axe only | A: R presentational tables that keep th, caption or summary (F46, F92); a label element tied to no field (narrow F111); header cells with no assigned cells (a faithful port of ACT d0f69e); the experimental axe rules as needs review. B: R from the browser's accessibility tree; open shadow roots and same-origin frames. C: J text styled like the page's own headings (F2) | Whether formatting carries meaning; complex tables; charts and maps; structure "available in text" | 2 |
| 1.3.2 | Meaningful Sequence | A | none | Not checked | C: R letter-spaced words (F32), checked against a dictionary. D: J whitespace tables (F33, F34) and CSS reordering (F1) with a linearized render, below threshold | Whether an order matters; magazine and dashboard layouts; bidirectional text | 4 |
| 1.3.3 | Sensory Characteristics | A | none | Not checked | C: R filter from ACT 9bd38c with deterministic passes; J a failure only when the target is verified to have the visual property and no name, heading or landmark identifies it | Instructions in images and media; references that depend on context | 3 |
| 1.3.4 | Orientation | AA | css-orientation-lock exists but is experimental, so it does not run | Not checked | B: P portrait and landscape at 1280×800 and 800×1280, then 390×844 and 844×390, with the screen orientation set; a 90° rotation or a rotate-your-device message is a failure; J essential exception, clears only | Essential orientation; real devices with the rotation lock; native apps without build files | 2 |
| 1.3.5 | Identify Input Purpose | AA | autocomplete-valid: token syntax only | Judged: a field that collects the user's own data names its purpose | B: Chrome's form issues as corroboration; cue words ("recipient", "destinatário") that cap confidence; each form judged once per site | Whose data a field collects in ambiguous contexts; whether autofill works | 1 |
| 1.4.1 | Use of Color | A | link-in-text-block | axe only | A: incompletes shown as needs review. C: R/V current state or required fields shown only by color, confirmed on a grayscale render; J color words in instructions, quoted | Charts, maps, color-coded tables; whether a difference carries meaning | 3 |
| 1.4.2 | Audio Control | A | no-autoplay-audio† (review on fail) | Listed as checked; reports nothing | A: needs review. B: P/M autoplay probe that measures audible time from energy, not attributes, then tries the page's own pause and mute controls | Audio started by other interactions; games; cross-origin media; keyboard access to the control | 2 |
| 1.4.3 | Contrast (Minimum) | AA | color-contrast; its incompletes (images, gradients, overlaps) are dropped | axe only on the web; pixels on screenshots and native screens | A: incompletes shown as needs review. B: V pixel measurement of axe's incompletes, with ACT's highest-possible-contrast rule; `::placeholder`. C: P focus, hover, expanded and dark-scheme states; J logotype and incidental exceptions, clears only | Text over photos and video; text in images; logotypes | 1 |
| 1.4.4 | Resize Text | AA | meta-viewport | axe only | A: R ACT b4f0c3 exactly, which also catches the non-numeric values axe passes. B: P at 200% zoom (640×512 at device scale 2): clipped text as in ACT 59br37; overlaps and missing text as needs review | Lost functionality in complex widgets; acceptable truncation; real mobile browsers | 2 |
| 1.4.5 | Images of Text | AA | none | Judged with vision, on request | B: V OCR must agree with the model and the image must be mostly text; logos detected and each image judged once across a site; on by default once real-page precision is measured | Essential presentation; customizable images; infographics | 2 |
| 1.4.10 | Reflow | AA | none: meta-viewport is tagged 1.4.4 only | Not checked | A: P page resized to 320×256 CSS px, which is 1280×1024 at 400%: visible text or controls past the right edge; text clipped that was whole at 1280 px; content that needs two dimensions exempt by element type; J exception claims, clears only | Lost functionality at 320 px; content that scrolls horizontally (256 px high); whether a two-dimensional exception applies | 1 |
| 1.4.11 | Non-text Contrast | AA | none | Not checked | B: V icon-only controls: icon pixels against adjacent pixels, at least 3:1. C: V focus indicators from the keyboard walk; text-input boundaries; checked and selected indicators | Graphs and charts; whether a graphic is required; hover and active states; gradients | 2 |
| 1.4.12 | Text Spacing | AA | avoid-inline-spacing: inline `!important` values only (ACT 24afc2, 78fd32, 9e45ec) | axe only | A: P the four spacing values applied as user overrides; text clipped (F104) or overlapping that was not before; ellipsis with no way to the full text | Scripts where a metric does not apply; text in canvas and images | 1 |
| 1.4.13 | Content on Hover or Focus | AA | none | Not checked | B: P each trigger hovered and focused. The new content must close on Esc without moving pointer or focus (unless it covers nothing), stay while the pointer moves onto it, and stay until the trigger is left. `title` tooltips are exempt; J input-error exception, clears only | Triggers the probe does not find; touch; content that moves | 2 |
| 2.1.1 | Keyboard | A | frame-focusable-content (needs axe inside frames), scrollable-region-focusable, server-side-image-map | axe only | A: P keyboard walk: native controls and explicit widget roles that Tab never reaches. B: R axe in every frame. C: P click versus Enter/Space parity; hover-only menus; J equivalence and path-dependent exception, clears only | States behind login; drag and drop; canvas; other browsers; speech and switch input | 1 |
| 2.1.2 | No Keyboard Trap | A | none | Not checked | A: P forward and backward walk: a trap when Tab, Shift+Tab, Esc and arrows all fail to leave (ACT 80af7b). C: J exit instructions, which the probe then executes; clears only | Traps after interactions; the real browser UI; plug-ins; screen-reader modes | 1 |
| 2.1.4 | Character Key Shortcuts | A | none | Not checked | B: P printable keys with focus on the body (ACT ffbc54), then candidate settings toggled and the keys pressed again; J "clearly labeled" | Settings elsewhere or behind login; keyboard layouts and IMEs; speech input | 2 |
| 2.2.1 | Timing Adjustable | A | meta-refresh | axe only; a 0 s redirect crashes collection | A: R HTTP `Refresh` header (ACT bc659a); immediate redirects recorded, not crashed on. C: P fake clock up to 20 h: a navigation, reload or removed content with no warning and no way to extend | Server-side time-outs; flows behind login; the exceptions | 3 |
| 2.2.2 | Pause, Stop, Hide | A | blink, marquee | axe only | C: R motion inventory; P/V a time series and the page's pause controls tried; a failure when motion or updates last more than 5 s and nothing stops them (ACT efbfc7) | Essential motion; whether a control is discoverable; reliance on reduced motion | 2 |
| 2.3.1 | Three Flashes or Below Threshold | A | none | Not checked | D: V/M flash analyzer on frames of animated images and CSS animations, video later; measured failures only | Live and user-generated content; DRM; certification-grade sign-off | 4 |
| 2.4.1 | Bypass Blocks | A | bypass† (review on fail) | Listed as checked; reports nothing | A: needs review, with the mechanisms found. C: P skip-link probe; S blocks repeated across crawled pages | Whether a block is substantial; interleaved blocks; single-page-app views | 2 |
| 2.4.2 | Page Titled | A | document-title | Judged | A: R framework and editor default titles ("React App", "Vite + React", "Document"). C: S duplicate titles across a crawl; P route changes in single-page apps that keep the title | Whether a title fits the domain and audience | 3 |
| 2.4.3 | Focus Order | A | none | Not checked | C: P dialogs and menus: an opened modal that does not take or hold focus, focus lost to the body on close, focus far from the trigger (F85); J group interleaving and positive tabindex, with verified transitions | Whether an unusual order preserves meaning | 3 |
| 2.4.4 | Link Purpose (In Context) | A | link-name, area-alt | Judged, with where each link leads (S) | B: R same name, different destination (ACT fd3a94) into the eval. C: P destinations of scripted links | The "ambiguous to users in general" exception; destinations behind login | 2 |
| 2.4.5 | Multiple Ways | AA | none | Not checked | C: S ways found across the crawl (search, site map, navigation), as needs review; never a failure | Defining the set of pages; the process exception | 5 |
| 2.4.6 | Headings and Labels | AA | none; empty-heading is best practice and not run | Judged | A: R placeholder headings and labels ("Section 2", "Field 1", lorem ipsum). B: truncated labels recorded | Whether a heading or label fits the domain and audience | 3 |
| 2.4.7 | Focus Visible | AA | none | Not checked | A: P/V each Tab stop captured focused and blurred: no changed pixel is a failure (ACT oj04fd); focus removed on receipt (F55). C: J faint changes, as needs review | Whether a faint indicator is perceivable; other browsers; forced colors | 1 |
| 2.4.11 | Focus Not Obscured (Minimum) | AA, new in 2.2 | none | Not listed | A: P/V in the walk, at two viewports: every sample point hits author content outside the focused element, and hiding the element changes no pixel | Content the user opened or can move; zoomed states | 1 |
| 2.5.1 | Pointer Gestures | A | none | Not checked | C: R gesture handlers listed as needs review. D: P swipe and pinch, then a search for a single-pointer alternative; J essential claims, clears only | Essential gestures; alternatives elsewhere; real touch hardware | 3 |
| 2.5.2 | Pointer Cancellation | A | none | Not checked | C: P press, move away, release: a change committed on the down-event that persists; J essential or feedback, clears only | Essential down-events; undo in drag and drop; touch | 3 |
| 2.5.3 | Label in Name | A | label-content-name-mismatch | axe only | A: R hyphenation and abbreviation differences moved to needs review. B: R name source from the browser: an aria-label that overrides visible label text. C: J visible labels not tied to their control | Label versus nearby instruction; symbols and numbers; testing with speech input | 1 |
| 2.5.4 | Motion Actuation | A | none | Not checked | C: R motion and sensor APIs in use, as needs review. D: P synthetic motion, a disable switch and a UI alternative (ACT c249d5, 7677a9) | Camera gestures; real sensors; essential motion | 4 |
| 2.5.7 | Dragging Movements | AA, new in 2.2 | none | Not listed | C: R drag candidates; P the drag, then a search for at most two clicks, or typing, that reproduce the change; J longer paths, which the probe executes, and essential claims; clears only | Essential dragging; alternatives in another view; canvas editors | 2 |
| 2.5.8 | Target Size (Minimum) | AA, new in 2.2 | target-size exists (tag wcag22aa) but does not run | Not listed | A: R axe target-size under `--wcag 2.2`, with Rampa filters for unmodified native controls and equivalent targets to the same destination; the same rule from bounds on Android and iOS snapshots. C: J essential and equivalent, clears only | Essential or legally required presentation; equivalence; canvas and SVG maps | 1 |
| 3.1.1 | Language of Page | A | html-has-lang, html-lang-valid, html-xml-lang-mismatch | Judged | B: R an n-gram language identifier as a guard, and as a no-model failure for long, clear mismatches; the page title and accessible names judged too (ACT ucwvc8). D: P language switching in single-page apps | Balanced bilingual pages; dialects | 2 |
| 3.1.2 | Language of Parts | AA | valid-lang | Judged, for elements that declare lang | A: R language-switcher links whose text is a language's own name, with no lang. B: J unmarked passages, prefiltered by the identifier; short quotes below threshold | Single words; proper names; loanwords | 2 |
| 3.2.1 | On Focus | A | none | Not checked | A: P during the keyboard walk: navigation, a new window, a form submission or a dialog caused by focus alone; focus moved by script at medium confidence; content changes below threshold | Focus by mouse; states after interaction; content updates that change meaning | 2 |
| 3.2.2 | On Input | A | none | Not checked | C: P each setting changed (select, radio, checkbox, typing) with the network guard on: a navigation, new window or submission with no advance notice; J the notice, quoted; clears only | Whether notice is adequate; custom widgets; realistic data | 3 |
| 3.2.3 | Consistent Navigation | AA | none | Not checked | B: S navigation blocks repeated across crawled pages of one set, compared for relative order (F66), with no model | Defining the set; personalization; pages behind login | 2 |
| 3.2.4 | Consistent Identification | AA | none | Not checked | C: S/J the same function named differently within a page and across the set; deterministic grouping, the model decides name pairs by a majority of three runs | What counts as the same function; icons in context | 4 |
| 3.2.6 | Consistent Help | A, new in 2.2 | none | Not listed | B: S help links (mailto, tel, contact, FAQ, chat widgets) compared for relative order across the set, per viewport. C: J ambiguous help links | Help that is not a link; defining the set | 3 |
| 3.3.1 | Error Identification | A | none | Not checked | B: R/J pages already in an error state (ACT 36b590): an error shown without text, or a message that names no field. C: P validation on blur (type, then leave the field; never submit). D: P submission only with `--allow-submit=<origin>` | Errors the server finds; payment iframes; wording | 2 |
| 3.3.2 | Labels or Instructions | A | form-field-multiple-labels† | Judged: the label is visible, and an enforced pattern is explained | A: R fields whose every name source is invisible, for `--no-llm`. B: V pixel test of label visibility. C: J option groups with no visible question; format instructions | Whether instructions are enough; icons as labels | 1 |
| 3.3.3 | Error Suggestion | AA | none | Not checked | B: R/J in error states: when the page encodes the rule (min, max, pattern, type), the message must say how to fix the input. C: P invalid values derived from constraints | Whether a suggestion is correct; server-side errors; the security exception | 3 |
| 3.3.4 | Error Prevention (Legal, Financial, Data) | AA | none | Not checked | C: R/J "applies here" notes (payment tokens, transactional buttons) with the mechanisms seen; never a failure | Almost all of it | 5 |
| 3.3.7 | Redundant Entry | A, new in 2.2 | none | Not listed | C: R the same purpose asked twice on one page with no reuse control (autocomplete tokens), below threshold; P a "same as billing" toggle tried | Multi-step processes; third-party steps; the exceptions | 4 |
| 3.3.8 | Accessible Authentication (Minimum) | AA, new in 2.2 | none | Not listed | B: R login and recovery steps, one field per character, "enter the 2nd and 6th characters" (F109); P trusted paste into each authentication field, with nothing submitted; J cognitive-test wording, quoted | Later steps that need an account; CAPTCHA escalations; biometric steps | 2 |
| 4.1.1 | Parsing (removed in 2.2) | A | duplicate-id rules are deprecated and never run | Listed as "not checked", which is misleading | A: its own status. Under 2.1: "satisfied by definition for HTML and XML (WCAG 2.1, Note 1)". Under 2.2: absent, with a footnote. Never a finding; the consequences of duplicate ids go to 4.1.2 | Only whether a contract still asks for markup validation | 1 |
| 4.1.2 | Name, Role, Value | A | 28 rules for names, roles and ARIA validity; aria-hidden-focus and duplicate-id-aria often return incomplete | axe only | A: incompletes shown as needs review; R a duplicate id that hijacks a name or description. B: R from the browser's accessibility tree, for roles axe leaves out. C: P toggles whose exposed state never changes, and clickable elements with a non-interactive role; J iframes that share a name (ACT 4b1c6c) | Roles for custom widgets; values set by assistive technology; what is actually announced | 1 |
| 4.1.3 | Status Messages | AA | none | Not checked | B: R live-region inventory (advisory). C: P safe triggers (validation on blur, GET search, client-only controls); a deterministic F103 triage; J whether the change is a status message, quoted | Real announcements in screen readers; flows Rampa must not run | 3 |

---

## 3. Counts by wave

The table in section 0 follows from the matrix. Here is what moves in each wave.

**Now.**

- Automated checks (19): 1.1.1, 1.3.1, 1.3.5, 1.4.1, 1.4.3, 1.4.4, 1.4.5 (on request), 1.4.12, 2.1.1, 2.2.1, 2.2.2, 2.4.2, 2.4.4, 2.4.6, 2.5.3, 3.1.1, 3.1.2, 3.3.2, 4.1.2.
- Judged (9): 1.1.1, 1.3.5, 1.4.5, 2.4.2, 2.4.4, 2.4.6, 3.1.1, 3.1.2, 3.3.2.
- Beyond the loaded page: only 2.4.4 reads other pages. On the image, Android and iOS surfaces, 1.4.3 is also measured from pixels.
- The six 2.2-only criteria are not listed at all.

**After wave A (25 / 9 / 8 / 3 / 27).**

- New automated checks: 1.4.10, 2.1.2, 2.4.7, 2.4.11, 2.5.8, 3.2.1.
- Probes added to existing checks: 1.4.12, 2.1.1.
- 1.2.2, 1.4.2 and 2.4.1 move from a false "checked" to needs review.
- Many existing checks get no-model rules: 1.1.1, 1.3.1, 1.4.4, 2.2.1, 2.4.2, 2.4.6, 2.5.3, 3.1.2, 3.3.2 and 4.1.2.

**After wave B (36 / 12 / 21 / 5 / 14).**

- New automated checks: 1.2.2, 1.3.4, 1.4.2, 1.4.11, 1.4.13, 2.1.4, 3.2.3, 3.2.6, 3.3.1, 3.3.3, 3.3.8. The new judged criteria among them are 3.3.1, 3.3.3 and 3.3.8.
- Pixels or probes added to existing checks: 1.4.3, 1.4.4, 1.4.5, 3.3.2.
- Needs review only: 1.2.1, 1.2.3, 1.2.4, 1.2.5 and 2.4.1.

**After wave C (46 / 21 / 36 / 8 / 1).**

- New automated checks: 1.3.2, 1.3.3, 2.4.1, 2.4.3, 2.5.2, 2.5.7, 3.2.2, 3.2.4, 3.3.7, 4.1.3.
- New judgments: 1.3.1, 1.3.3, 1.4.1, 2.4.3, 2.5.3, 3.2.4, 3.2.6, 4.1.2, 4.1.3.
- Needs review only: 2.4.5, 2.5.1, 2.5.4 and 3.3.4 join the list.
- Only 2.3.1 is left manual only.

**After wave D (50 / 23 / 43 / 5 / 0).**

- New automated checks: 1.2.1, 2.3.1, 2.5.1, 2.5.4.
- Five criteria stay needs review only by design (section 6): 1.2.3, 1.2.4, 1.2.5, 2.4.5, 3.3.4.

**Under `--wcag 2.1`.** The denominator is 50. 4.1.1 gets its own "satisfied by definition" line. Results for 2.4.11, 2.5.7, 2.5.8, 3.2.6, 3.3.7 and 3.3.8 are reported as beyond the target.

---

## 4. Probe architecture

### 4.1 Where probes sit

```
target ─► collect (snapshot + axe, as today) ─► probes (optional) ─► rules and criteria ─► verification ─► report
                                                   │                      ▲
                                                   └─ snapshot.observations ─┘   (criteria read only the snapshot)
```

Probes run after the snapshot, in the same browser context, so they carry the same storage state, headers and device settings. Each probe kind gets its own freshly loaded page, so one probe's state never leaks into another's. A probe writes facts; a rule or a criterion turns facts into findings. A new finding source, `probe`, joins `engine`, `rule` and `judgment`. `probe` is the cognitive plan's value too, and it means a rule decided on probe observations.

### 4.2 Observations in the snapshot

This is an additive, optional field, so `schemaVersion` stays 1. It is the `snapshot.observations` field of the cognitive plan's WI-11.

```ts
interface Observations {
  probes: ProbeRecord[]
}

interface ProbeRecord {
  kind: 'keyboard' | 'layout' | 'hover' | 'orientation' | 'media' | 'auth' | 'clock' | 'interact' | 'form'
  version: string                       // the probe's version; a rule states which versions it reads
  conditions: {
    viewport: { width: number; height: number }
    deviceScaleFactor: number
    browser: string                     // 'chromium <version> (headless)'
    variant?: string                    // 'reflow-320x256', 'text-spacing', 'zoom-200', 'portrait'
    colorScheme?: 'light' | 'dark'
    reducedMotion?: boolean
  }
  status: 'complete' | 'partial' | 'skipped'
  reason?: string                       // 'stop budget reached (150)', 'page navigated away'
  guard: {                              // what the network guard did during this probe (4.4)
    blocked: Array<{ method: string; url: string; at: number }>
    navigations: Array<{ url: string; at: number; cause?: string }>
    dialogs: Array<{ type: string; message: string; at: number }>
  }
  durationMs: number
  data: unknown                         // per kind: refs, bounds, measured numbers, image hashes; never verdicts
}
```

- **Node identity.** Every observation cites a snapshot `ref` plus an identity check: role, name and a hash of the start tag. Probes run on a fresh load, and pages change between loads: random ids, A/B tests, ads. When a ref resolves to no element or to several, or the identity differs, the fact is recorded as `unmatched`. Rules treat an unmatched fact as cannot_tell, never as a failure.
- **Images.** Screenshots and crops are referenced by SHA-256. With `--save`, they are written next to the snapshot. Reports attach the crops that serve as evidence. Snapshots never inline full-page images.
- **Platform-neutral data.** Keyboard data is a list of stops with refs and bounds. Layout data is a list of text boxes, their clip rects and overflow. Nothing is DOM-specific, so the Android and iOS collectors can fill the same records later (D7): TAB key events over adb, `font_scale 2.0`, rotation.

### 4.3 Criteria stay pure, recordings replay offline

- A rule or criterion is a function of `(snapshot, engine results, options)`. It never opens a page.
- Thresholds live in the rules, not the probes. The keyboard probe records how many pixels changed; the 2.4.7 rule decides that zero is a failure. A saved snapshot can be judged again after a threshold changes, with no browser.
- **Verification** of a probe finding follows the same principle as quote verification. The cited ref exists in the snapshot. The cited observation exists. The numbers in the finding can be recomputed from its `data`.
- `rampa check snapshot.json`, `--offline` and the demo's offline mode read the observations. The judgment cache key includes the hash of any observation a judgment saw.
- The published JSON schema includes `observations`, so other exporters can fill it.

### 4.4 Safety

Probes fall into three classes.

| Class | What it may do | Enabled by |
|---|---|---|
| **Observe** | Tab, Shift+Tab, Esc and arrow keys (arrows only to escape a suspected trap); pointer moves; resizing; injected CSS; a fake clock; muted media playback; typing synthetic values into fields and leaving them; trusted paste into authentication fields; Enter on an in-page link (`#fragment`) only | `--probe <kinds>` at first; on by default once each kind passes the gate (4.9) |
| **Activate** | Click, Enter or Space on controls; single printable keys (2.1.4); changing select, radio and checkbox values; toggles; drags | `--probe interact` only |
| **Submit** | Form submission and its server response | `--allow-submit=<origin>` only |

Rules for every class:

- **Network guard, always on during probes.**
  - Only GET, HEAD and OPTIONS reach the network. Other requests are aborted and logged, and `sendBeacon` is aborted with them.
  - A top-level navigation is answered locally with 204 and recorded. A navigation attempt is itself evidence for 3.2.1 and 3.2.2.
  - WebSockets and EventSource are blocked.
  - `window.open` is hooked and recorded, and the popup is closed.
  - Downloads are cancelled.
  - `alert`, `confirm` and `prompt` are dismissed (`confirm` answers cancel) and recorded.
  - Permission prompts are denied.
  - A claim that depends on a blocked request is cannot_tell.
- **Never submit real forms without the flag.** Observe-class probes never press Enter or Space on a control and never call `submit` or `requestSubmit`. `--allow-submit` takes exact origins, with no wildcards. The report header prints it. The guard still blocks every other origin. `rampa mcp` refuses the flag unless the person running the agent passes it on the command line.
- **The activate class has a skip list.** It never touches:
  - submit buttons;
  - controls inside forms that hold password, payment or file fields;
  - links to other origins and download links;
  - controls whose name is destructive or transactional, from a word list in en, pt-BR and es: delete/excluir/eliminar, pay/pagar, buy/comprar, send/enviar, sign out/sair, unsubscribe/cancelar assinatura…

  A budget of 30 controls per page applies. An overlay that blocks the page, such as a cookie wall, is reported as "not exercised", never guessed past.
- **Credentials.** Typed values are synthetic. A password field only gets the dummy value the 3.3.8 paste probe uses, cleared afterwards. Rampa never solves or clicks a CAPTCHA.
- **Where probes run.** Rampa runs in development and CI, not in production pages. Activate-class probes refuse every origin except the target's. Crawls keep respecting robots.txt and the crawl's concurrency.
- **GET can have side effects.** That cannot be ruled out, so the observe class never clicks. Every GET a probe caused is listed in the probe log.

### 4.5 Determinism

- **Pixel probes use a fixed rendering setup:** `--force-color-profile=srgb`, `--disable-lcd-text`, `--font-render-hinting=none`, a fixed device scale factor, and `document.fonts.ready` awaited. Screenshots are taken with animations finished and the caret hidden.
- **Noise mask.** The unchanged state is captured twice. Pixels that differ between the two captures (carousels, video) are masked. A "no change" verdict is cannot_tell when the mask covers more than 10% of the region.
- **Settle.** A probe waits for 300 ms without mutations or layout shifts, capped at 3 s. Time probes use Playwright's fake clock instead of waiting.
- **Confirm before failing.** A verdict that rests on an absence (no pixel changed, focus never left, no content past the edge) is measured twice before it becomes a finding.
- **Recorded conditions.** The browser version, launch flags, viewport and device scale factor are recorded with every probe record.
- **Flake gate.** Each probe fixture runs 10 times in CI. A single flipped verdict blocks the merge.

### 4.6 CI cost

- **Opt-in first.** `--probe keyboard,layout,hover…` or `--probe all`. Kinds become default one at a time, after the gate in 4.9 and after measuring the cost on the real-page sample.
- **Budgets.**
  - Keyboard walk: at most 150 stops.
  - Screenshots: the element's box plus a 32 px margin; a full viewport only to confirm a zero-change failure.
  - Hover: at most 30 triggers.
  - Activate class: at most 30 controls.
  - Each probe record says when a budget cut it short.
- **Targets to measure in A6.** In scratch runs, full-viewport screenshots cost 0.5 to 1 s per stop.
  - Keyboard walk: box crops should bring that to 0.2 s or less per stop, about 15 s for 60 stops.
  - Layout variants: 2 to 5 s per page.
  - Hover: about 1 s per trigger.
  - These are targets, not results; A6 measures them and `usage` reports probe time per kind.
- **Sites.** With `--crawl`, probes run on one page per template cluster, using the crawl's finding signatures. Results for shared components are reused, and each is reported once with its pages.
- **No model cost for probe verdicts.** Models answer only the narrow questions marked J, and most of those only clear findings.
- **Reruns without a browser.** `--save` keeps the observations, and `--offline` replays them.

### 4.7 Coverage reporting per criterion and method

Each criterion gets one status and the list of methods that ran:

- **Status:** `failures`, `no-failure-found`, `needs-review`, `not-checked`, `no-applicable-content` (for example "no audio or video found; players in cross-origin frames or loaded later may be missed"), `satisfied-by-definition` (4.1.1 under 2.1) or `beyond-target`.
- **Methods:** rules (axe-core or Rampa), judgment, probe (with its conditions and counts), site, and the manual remainder.

```
Coverage of this run: WCAG 2.2 A/AA, 55 criteria
  2.4.7  Focus Visible           probe   keyboard walk, 64 stops at 1280×800, Chromium: 2 failures
  1.4.10 Reflow                  probe   320×256 CSS px: no failure found in 412 text boxes
  1.4.3  Contrast (Minimum)      rules   axe-core color-contrast: 3 failures; pixels: 4 need review
  2.4.4  Link Purpose            judged  31 links, with where they lead: 1 failure
  2.4.1  Bypass Blocks           review  axe-core could not decide; mechanisms found: none
  Not checked automatically: 14 of 55 (--verbose lists them)
Each criterion above also needs manual review. "No failure found" applies to the conditions shown.
This report does not declare the page accessible.
```

In JSON, the existing `coverage.engine`, `coverage.judged` and `coverage.notChecked` arrays stay, with tighter meanings (A2). An optional array is added:

```ts
coverage.criteria?: Array<{
  id: string; level: Level; target: 'in' | 'beyond'
  status: 'failures' | 'no-failure-found' | 'needs-review' | 'not-checked'
        | 'no-applicable-content' | 'satisfied-by-definition'
  methods: Array<{
    kind: 'axe' | 'rule' | 'judgment' | 'probe' | 'site'
    id: string                      // 'color-contrast', 'rampa/reflow', 'judgment/2.4.4@1', 'probe/keyboard@1'
    ran: boolean; applicable: number; failures: number; review: number
    conditions?: string             // '1280×800 Chromium', '320×256'
    maturity: 'stable' | 'experimental'
  }>
  manual: string                    // the matrix's last column, localized
}>
```

The "stays manual" text lives in `src/wcag.ts` next to each criterion's name, in EN and pt-BR, so every report can say what a person still has to do. Markdown, HTML, SARIF, MCP and the pull request comment render the same data. The pull request summary becomes one line: "Automated checks ran for N of 55 criteria (judged: J, probes: P); R need review; M not checked." The numbers come from `coverage.criteria`.

### 4.8 Moving to WCAG 2.2: `--wcag 2.1|2.2`

- **One table in `src/wcag.ts`.** It holds 56 criteria, each with `since: '2.0' | '2.1' | '2.2'`, plus `removedIn: '2.2'` for 4.1.1. `criteriaFor(version)` returns 50 criteria for 2.1 and 55 for 2.2.
- **axe tags by version.**
  - 2.1: `wcag2a, wcag2aa, wcag21a, wcag21aa`.
  - 2.2: those, plus `wcag22aa`. In axe-core 4.14 the only rule it adds is `target-size`, and no rule carries `wcag22a`.
  - Guard tests: no `wcag2a-obsolete`, no deprecated rule in the results, and no finding on 4.1.1.
- **Default 2.2.** WCAG 2.2 is the current W3C Recommendation, and content that conforms to it also conforms to 2.1. Rampa is not on npm yet, so this is the cheapest moment to change the default. `--wcag 2.1` stays for contracts that cite 2.1, such as EN 301 549 V3.2.1. The README badge changes with it.
- **Under 2.1**, 2.2-only criteria are beyond the target (the cognitive plan's routing), and 4.1.1 shows "satisfied by definition for HTML and XML (WCAG 2.1, Note 1); removed in WCAG 2.2".
- **Strings and links.**
  - Every i18n string that hard-codes "WCAG 2.1" takes the version as a variable. The cognitive plan, section 2.8, lists them.
  - Understanding links point to `WCAG22/Understanding/`, which also covers the 2.1 criteria; that includes `src/engine/rules.ts`.
  - The report gets `target: 'wcag21-aa' | 'wcag22-aa'`.
- **Prompts.** The judged criteria keep their prompts: WCAG 2.2 did not change their normative text. The license note adds WCAG 2.2.
- **Eval.** ACT test cases list some pages twice, under WCAG 2.1 and 2.2 copies. They are deduplicated by URL.

### 4.9 Evaluation gate: experimental to stable

A new check reports below the default confidence threshold, visible with `--verbose` or `--min-confidence low`, until all of these hold:

1. **ACT test cases, where they exist.** Every failed example is found and no passed example is flagged, scored the way ACT intends. For most rules, "passed" means "further testing needed", not "satisfied".
2. **Fixtures in pairs**, a passing and a failing variant per failure technique. They go into `rampa eval` through a no-model path for rule and probe criteria (A3). Today `rampa eval` only runs criteria that have a judgment module.
3. **Real-page precision.** At least 35 findings reviewed by a person with no false positive, or 53 with one, which gives a 95% Wilson lower bound of about 0.9. Rare checks get a targeted corpus, for example pages found by searching for "rotate your device" or "gire o celular", because a random sample will not produce enough findings.
4. **Stability.** The flake gate in 4.5.

A shared real-page sample starts now as a non-code item (EVAL-1): 100 pages, half pt-BR and half en, each a home page plus one inner page, with the probe records saved. It is the "false-positive study on real pages" already on the README roadmap.

---

## 5. Implementation waves

Each work item is one branch that one agent can build and merge on its own. Effort: S is 2 days or less, M is a week or less, L is up to 3 weeks. Files are paths in this repository.

### Wave A: cheap, high value, low false-positive risk

```
A1 wcag22-target ──► A5 target-size
A2 honest-coverage (first; every later item reports through it)
A3 rule-stage ──► A4 structure-rules
A6 probe-stage ─┬► A7 keyboard-walk ──► A8 focus-visible
                └► A9 reflow ──► A10 text-spacing
EVAL-1 real-page sample (non-code, starts now)
```

**A1 `feat/wcag22-target` (S-M).** All criteria; this is the cognitive plan's WI-9. Its flag is `--wcag`, and the report field is `target`.

- **Changes:**
  - the 56-criterion table and `criteriaFor()` in `src/wcag.ts`;
  - tags by version in `src/engine/axe.ts`;
  - the coverage denominator in `src/core/check.ts`;
  - `Report.target` in `src/core/types.ts`;
  - version variables in `src/i18n.ts` and `src/report/*`;
  - `--wcag` and the `wcag` config key in `src/cli/commands/check.ts`, `src/cli/config-options.ts` and `src/config.ts`;
  - WCAG22 Understanding URLs in `src/engine/rules.ts`;
  - the README and docs.
- **Evaluation:**
  - unit tests for 50 and 55 criteria;
  - the guard tests from 4.8;
  - golden reports in both locales under each version;
  - 2.2-only results land beyond the target under 2.1.

**A2 `feat/honest-coverage` (M).** Every criterion.

- **Engine coverage** counts only rules that can return a violation and had applicable nodes. Rules that can only pass or return incomplete are listed by id: th-has-data-cells, video-caption, form-field-multiple-labels, and the review-on-fail rules bypass, no-autoplay-audio and duplicate-id-aria.
- **axe incompletes** become `needsReview` items with axe's reason. They are never findings and never change the exit code.
- **Per-criterion coverage records** as in 4.7, with the "stays manual" text.
- **4.1.1** gets its own status.
- **Eval scoring fix:** an engine finding counts only for the ACT rule it implements, through axe's `actIds`. That removes four of the five ucwvc8 false positives without touching the checker.
- **Files:**
  - `src/core/check.ts`, `src/core/types.ts`;
  - `src/report/{pretty,markdown,html,sarif,common,site}.ts`, `src/mcp/format.ts`;
  - `src/i18n.ts`, `src/wcag.ts`;
  - `src/eval/metrics.ts`.
- **Evaluation:**
  - ACT cf77f2 Failed Example 1 shows 2.4.1 as needs review, not checked;
  - a page with an uncaptioned video shows 1.2.2 as needs review;
  - existing eval numbers are unchanged except ucwvc8's precision.

**A3 `feat/rule-stage` (M).** No-model rules for the web, in the same `rampa-rules` engine that native surfaces use, with finding source `rule`. It shares the `Check` interface with the cognitive plan's WI-1.

- **First rules, each already proven as a helper or by the research:**
  - 1.1.1 F30: placeholder and file-name alternatives, promoting `looksLikePlaceholder`;
  - 2.4.2: framework and editor default titles;
  - 2.4.6: placeholder headings and labels;
  - 1.4.4: ACT b4f0c3 implemented exactly;
  - 2.2.1: the `Refresh` response header, with immediate redirects recorded instead of crashing collection;
  - 3.1.2: language-switcher links whose text is a language's own name (CLDR autonyms through `Intl.DisplayNames`) with no `lang`;
  - 2.5.3: axe violations whose only difference is hyphenation or an abbreviation that is a prefix move to needs review;
  - 3.3.2: fields whose every name source is invisible, reusing the 3.3.2 module's helpers.
- **A no-model eval path** for rule and probe criteria in `src/eval/act.ts` and `src/cli/commands/eval.ts`.
- **Files:**
  - `src/engine/rules.ts` (the registry for every surface) and `src/rules/*.ts` (new);
  - `src/surfaces/in-page.ts` (viewport meta) and `src/surfaces/web.ts` (response headers, redirects);
  - `src/core/types.ts` (`source: 'rule'`).
- **Evaluation:**
  - ACT b4f0c3 (16 entries) and bc659a (15);
  - 2ee8b8 (38): no new miss, and both of axe's out-of-scope flags removed;
  - corrupted pairs for each content rule;
  - EVAL-1.

**A4 `feat/structure-rules` (M).** 1.3.1 and 4.1.2.

- **Collector facts:**
  - `label.control`;
  - a table grid with spans, scope and headers;
  - the computed presentational role;
  - fieldset mapped to a group named by its legend, which also fixes `groupOf` for 2.4.6.
- **Rules:**
  - presentational tables that keep th, caption or a non-empty summary (F46, F92);
  - the narrow F111 case: a `<label>` next to exactly one field, with no control, referenced by no `aria-labelledby`, while the field's name lacks the label's text;
  - ACT d0f69e ported faithfully: header cells count as assigned cells and emptiness does not matter; header-only, empty or `aria-busy` tables go to needs review;
  - 4.1.2: a duplicate id that hijacks a name or a description.
- **Experimental axe rules** td-has-header, table-fake-caption and p-as-heading run through `options.rules` inside the same axe run, as needs review only.
- **Files:** `src/surfaces/in-page.ts`, `src/rules/structure.ts`, `src/surfaces/page.ts`, `src/surfaces/web.ts`.
- **Evaluation:**
  - d0f69e: all 3 failed examples found, and a25f45 Passed Example 6 not flagged;
  - bc4a75, ff89c9 and 6cfa84 unchanged or better;
  - EVAL-1.

**A5 `feat/target-size` (S).** 2.5.8; depends on A1.

- axe target-size runs under 2.2, and its results are beyond the target under 2.1.
- **Post-filters:**
  - native controls whose computed size and appearance equal the browser defaults, measured once in a clean frame, are exempt as unmodified user-agent controls;
  - a target is exempt when another control to the same destination is at least 24×24 (Equivalent).
- **Native surfaces:** the same spacing rule runs from bounds on Android and iOS snapshots, converted to CSS px through `viewport.scale` and labeled as WCAG applied to non-web software.
- **Evidence:** an overlay screenshot with the 24 px circles.
- **Files:** `src/engine/axe.ts`, `src/rules/target-size.ts`, `src/engine/rules.ts`.
- **Evaluation:**
  - fixtures: touching 20 px icon buttons, 12 px dots 2 px apart and small pagination links fail; 16 px buttons 12 px apart, native date inputs and inline links pass;
  - no ACT rule exists;
  - EVAL-1.

**A6 `feat/probe-stage` (M).** The foundation from section 4; this is the cognitive plan's WI-11.

- **Scope:**
  - `snapshot.observations` (zod and the generated JSON schema);
  - a runner in `src/probes/` with `run.ts`, `guard.ts`, `settle.ts`, `identity.ts` and `pixels.ts`;
  - the safety classes, budgets, the determinism setup and offline replay;
  - `--probe <kinds>`, finding source `probe`, and probe coverage lines.
- The cognitive plan's clipboard lock and typing helper come with B7 if A6 lands first.
- **Files:** `src/snapshot/schema.ts`, `src/surfaces/web.ts`, `src/surfaces/browser-options.ts`, `src/cli/commands/check.ts`, `src/core/check.ts`.
- **Evaluation:**
  - the guard aborts POST, answers navigations, blocks WebSockets and closes popups;
  - a saved snapshot replays to identical findings;
  - an identity mismatch gives cannot_tell;
  - the cost per page is measured on 20 pages of EVAL-1.

**A7 `feat/keyboard-walk` (M).** 2.1.1, 2.1.2 and 3.2.1; depends on A6.

- **The probe:**
  - Tab forward until focus cycles or the budget runs out, then Shift+Tab backward;
  - each stop records its ref, identity, role, name, bounds, frame and scroll position, and focus is read again 150 ms later;
  - init-script hooks record `window.open`, form submission, location changes, `showModal`, and `focus()`/`blur()` calls made by script.
- **Rules:**
  - **2.1.2 trap.** Focus cannot leave a set of stops with Tab, Shift+Tab, Esc or the arrows. A trap is lowered to needs review when nearby text names an exit key ("press Ctrl+M"); C2 executes such instructions.
  - **2.1.1.** A visible, enabled native control or explicit widget role, not inert or hidden, that the walk never reached. Items of a composite widget are excluded when the widget is reached, since roving tabindex and `aria-activedescendant` are correct.
  - **3.2.1.** A navigation, new window, submission or modal caused by a Tab focus, after subtracting a no-input recording of the same length, is high confidence. A script focus move outside the focused widget is medium. Content changes stay below threshold.
- **Files:** `src/probes/keyboard.ts`, `src/rules/keyboard.ts`.
- **Evaluation:**
  - ACT 80af7b (16 entries, with its inputs a1b64e and ebe86a), akn7bn and 0ssw9k;
  - fixtures for 3.2.1, which has no ACT rule;
  - EVAL-1.

**A8 `feat/focus-visible` (M).** 2.4.7 and 2.4.11; depends on A7.

- **2.4.7.** At each stop, the element's box plus a margin is captured focused and blurred, with the noise mask.
  - When nothing changes in the box, the full viewport pair confirms before a failure, as ACT oj04fd counts any pixel in the viewport.
  - The probe records changed-pixel counts, the bounding box of the change and its colors. C15 reuses that for 1.4.11.
  - Rule: no changed pixel is a failure. A change smaller than a one-pixel outline is needs review. Focus removed on receipt (F55) is a failure.
- **2.4.11.**
  - Detection: a 5×5 `elementFromPoint` grid over the in-viewport part of the focused element, at 1280×800 and 390×844, in both directions.
  - Confirmation: when every point hits author content outside the focused subtree, two pixel checks follow. The element is hidden, then painted. No pixel may change in either.
  - The finding names the covering element. Its patch hint is `scroll-padding` equal to that element's height (C43).
- **Files:** `src/probes/keyboard.ts`, `src/rules/focus.ts`, `src/probes/pixels.ts`.
- **Evaluation:**
  - oj04fd (9 entries, 7 unique pages);
  - 2.4.11 fixtures: a sticky header, a cookie banner, a chat bubble, and a semi-transparent overlay that must pass;
  - flake gate;
  - EVAL-1.

**A9 `feat/reflow` (M).** 1.4.10, plus the layout measurement core that A10 and B4 reuse; depends on A6.

- **The probe.** A page loaded at 1280×1024 is resized to 320×256 CSS px. That is the Understanding's equivalence for 400% zoom; a real 1280×1024 screen leaves about 318×236, so 1 px tolerances apply. It runs in desktop mode, so the viewport meta is ignored, as with browser zoom. Resizing instead of reloading matches what zoom does.
- **What it records**, at both sizes, for every node with text or a control:
  - its box after clipping by its ancestors;
  - the document's scroll width;
  - whether the node sits inside content that needs two dimensions;
  - overlaps between text boxes of different elements.

  Content that needs two dimensions is exempt by element type: `img`, `video`, `canvas`, `svg`, `math`, data tables with header cells (the table as a whole, not the headings or controls around it), `pre` and `code`, `role=application`, and horizontally scrollable containers that hold only those.
- **Rules:**
  - The page scrolls horizontally and visible text or a control outside an exempt container extends past the right edge: failure, high.
  - Text clipped at 320 px that was whole at 1280: failure, high. It is needs review when the full text is reachable through a `title`, a name or a "more" control.
  - New overlaps: needs review.
  - Content gone at 320 px after opening collapsed navigation (F102) needs activation and waits for C1.
- **Judgment** may only clear a finding, by citing a container as a toolbar, game or presentation.
- **Files:** `src/probes/layout.ts`, `src/rules/reflow.ts`.
- **Evaluation:**
  - fixtures from C31, C32, C38 and F102 and from the Understanding's examples: a data table, a long URL, a fixed-width container, and an off-canvas menu that must not count;
  - the 5 b4f0c3 cases mapped to 1.4.10 apply to mobile zoom, which desktop emulation does not test, so they stay with 1.4.4;
  - EVAL-1.

**A10 `feat/text-spacing` (S).** 1.4.12; depends on A9.

- **The overrides.** Line height 1.5, letter spacing 0.12em and word spacing 0.16em go on every element, including open shadow roots, plus `margin-bottom: 2em` on `p`, the same choice the W3C bookmarklet makes. They are set as inline `!important` declarations, which wins over author `!important` the way a user style sheet does.
- **Scripts.** A metric the Understanding says a script does not use is not applied, for example paragraph spacing in Japanese, and the coverage line says so.
- **The comparison** is against the baseline at 1280 px.
- **Rules:**
  - text clipped that was whole (F104): failure, high;
  - an ellipsis with no mechanism to show the full text: failure, medium;
  - new text-on-text overlap: needs review until measured.
- **Files:** `src/probes/layout.ts`, `src/rules/text-spacing.ts`.
- **Evaluation:**
  - regression on ACT 24afc2, 78fd32 and 9e45ec, which axe implements;
  - fixtures from F104, C35 and C36: fixed-height boxes and `overflow: hidden` buttons;
  - EVAL-1.

### Wave B: more probe kinds, pixels, the first site criteria

| WI | Branch | Criteria | Methods and files | Evaluation | Effort |
|---|---|---|---|---|:---:|
| B1 | `feat/collector-reach` | all; 2.1.1 | Runs axe in every frame (`runPartial`/`finishRun`). Collects open shadow roots and same-origin iframes, with frame-qualified refs. Adds a settle wait after load. `src/surfaces/{in-page,web,page}.ts` | akn7bn Failed Example 1 found; every eval set the same or better | M |
| B2 | `feat/browser-ax-tree` | 2.5.3, 4.1.2, 1.3.1, 4.1.3 | Records Chromium's accessibility tree (role, name, name source, ignored) over CDP and maps it to refs. Rules: an aria-label that overrides visible label text (2.5.3), names required for roles axe leaves out (4.1.2), and an inventory of live regions (4.1.3, advisory). Criteria move to the computed name one at a time | 2ee8b8, e086e5, 97a4e1; every judged set run again | M |
| B3 | `feat/pixel-contrast-web` | 1.4.3, 1.4.11 | Measures axe's incompletes with pixels: the element as rendered against its text made transparent, using ACT's highest-possible contrast; mixed results are needs review. Adds `::placeholder`. For 1.4.11, icon-only controls: icon pixels against adjacent pixels, failing below 3:1, with unmodified native controls and disabled controls exempt. Reuses `src/pixels/contrast.ts` | afw4f7: the 3 failed cases lost as incomplete today; 09o5cg passed cases as 1.4.3 passes; icon fixtures (G207); EVAL-1 | M |
| B4 | `feat/zoom-200` | 1.4.4 | A9's core at 640×512 with device scale 2, the same as 1280×1024 at 200%. Clipping follows ACT 59br37, including its no-wrap ellipsis and line-clamp exceptions. Overlaps and missing text are needs review | 59br37 (14 entries), b4f0c3 | S |
| B5 | `feat/hover-focus-content` | 1.4.13 | **Triggers:** `aria-describedby` pointing to a tooltip, `aria-haspopup` or `aria-expanded` on hover-capable elements, stylesheet rules on `:hover`, `:focus` or `:focus-within` that show another element, and hover or focus listeners read over CDP. `title` is skipped as a user-agent tooltip. **Each trigger is tried:** hovered, then separately focused. New visible content must (1) close on Esc without moving pointer or focus, unless it overlaps no other content (geometry); (2) stay while the pointer moves to it in steps across any gap (F95); (3) stay after 10 s on the fake clock. The model only clears findings, by quoting an input-error message. `src/probes/hover.ts`, `src/rules/hover.ts` | Fixtures from SCR39 and F95; common tooltip and menu libraries; no ACT rule; EVAL-1 | M |
| B6 | `feat/orientation` | 1.3.4 | Portrait and landscape at both viewport pairs, with the CDP screen orientation and a `window.orientation` shim. Records rotation matrices, visible text and screenshots. A rotation of about 90° or a rotate message, with the main text gone, is a failure; content gone with no message is needs review. css-orientation-lock serves only as corroboration, keeping its related nodes. `ScreenOrientation.lock` calls and the manifest's `orientation` are notes. The model only clears findings, for essential use | b33eff (13 entries, deduplicated); a targeted corpus for positives; random pages bound the false-positive rate | M |
| B7 | `feat/accessible-authentication` | 3.3.8 | The cognitive plan's WI-12. Finds login and recovery steps (sign-up is out of scope) and F109 patterns. A trusted paste goes into each field; synthetic paste events are not used, because they falsely flag fields that trim or spread a pasted value. Nothing is submitted. Questions of the "2nd and 6th characters" or arithmetic kind are judged and quoted. CAPTCHAs are classified and never solved. The crawl finds login pages | The critique's fixtures: trim-on-paste and split code boxes pass; a `beforeinput` blocker and a read-only keypad fail; the H100 procedure | M |
| B8 | `feat/error-states-static` | 3.3.1, 3.3.3 | The cognitive plan's WI-17. Applies to pages already in an error state: `aria-invalid` with visible error text, or a state a Playwright test drove the page into. Rules: an error shown without text, and a message that does not state a rule the page encodes. The judgment follows ACT 36b590: does the message name the field and the cause? | 36b590 (9) added to `ACT_RULES`; 3.3.3 fixtures; a `checkPage` example after a failed fill | M |
| B9 | `feat/key-shortcuts` | 2.1.4 | Activate class. Presses printable keys with focus on the body and subtracts background changes. Then toggles candidate settings and presses the keys again. The model only decides "clearly labeled". The message says that a setting elsewhere satisfies the criterion and can be waived | ffbc54 (10) | S |
| B10 | `feat/site-criteria` | 3.2.3, 3.2.6 | Adds a `SiteCriterion` interface over a crawl's snapshots in `src/core/site.ts`. Sets are proposed from template clusters, can be named in the config, and are compared per viewport. 3.2.3: the relative order of repeated navigation items (F66), where added and removed items are allowed. 3.2.6: help mechanisms (mailto, tel, wa.me, contact or help paths, chat widgets) in relative order | Fixture sites with inversions and with sub-navigation added (must pass); language versions as separate sets; three real sites | M |
| B11 | `feat/media-probe` | 1.2.1–1.2.5, 1.4.2 | Plays visible media muted for 2–3 s and records duration, loudness, tracks, controls and whether it is live. Captions tracks forced to load. Rules: captions tracks that fail to load or have no cues (1.2.2); audible autoplay over 3 s that the page's own controls cannot silence (1.4.2). Needs review for 1.2.1, 1.2.3, 1.2.4 and 1.2.5, listing what was found | 80f0bf (8), eac66b (6), f51b46; fixtures with tracks that return 404 | M |
| B12 | `feat/language-identifier` | 3.1.1, 3.1.2 | An n-gram identifier, ELD or franc chosen by measuring. It guards model failures, and long clear mismatches fail with no model. The text judged for 3.1.1 follows ACT ucwvc8 (title, names). Unmarked passages for 3.1.2 are prefiltered by the identifier; the model classifies the exceptions; short quotes stay below threshold | ucwvc8, off6ek, de46e4; corrupted pairs | M |
| B13 | `feat/hidden-informative-images` | 1.1.1 | ACT e88epe: images hidden from assistive technology that carry information. Adds svg and canvas crops, scrolls before capture so lazy images load, and states how many images were not judged | e88epe (20) added to `ACT_RULES` | M |
| B14 | `feat/images-of-text-ocr` | 1.4.5 | tesseract.js with a pinned version, offline. A failure needs OCR and the model to agree and the image to be mostly text. Logos are detected across the site and verdicts cached by image hash. The module becomes a default after EVAL-1 | 0va7u6 (15), scored on the proposed version's "redundant" exception; EVAL-1 | M |
| B15 | `feat/label-visibility` | 3.3.2 | Pixel test of every label the rules rely on: its box captured as rendered and with its text transparent. Identical pixels mean the label is not visible | cc0f0a pairs; sr-only and white-on-white fixtures | S |
| B16 | `feat/judged-context` | 1.3.5, 2.4.2, 2.4.4, 2.4.6 | Chrome's Audits form issues as corroboration for 1.3.5, with words for other people's data capping confidence. Titles of sibling pages in the 2.4.2 context. fd3a94 scored for 2.4.4 with its destinations. Truncated labels recorded for 2.4.6 | The existing eval sets, without regressions | S |

### Wave C: activation, state changes, judgments that need probes

| WI | Branch | Criteria | Methods and files | Evaluation | Effort |
|---|---|---|---|---|:---:|
| C1 | `feat/interaction-harness` | (base for C2–C7, C10–C13); 2.4.4 | The activate class from 4.4: skip list, budget, a fresh page or a reload after each change, overlays reported as "not exercised". First user: the destinations of scripted links, intercepted rather than followed | A destructive-name fixture is never touched; the guard log matches | M |
| C2 | `feat/keyboard-parity` | 2.1.1, 2.1.2 | Compares click with Enter and Space (and arrows for sliders, tabs and menus). Finds hover-only menus whose links are not reachable elsewhere. Exit instructions from A7 are executed. The model judges only equivalence and the path-dependent exception, and only clears | Fixtures; EVAL-1 | L |
| C3 | `feat/focus-management` | 2.4.3 | Opens dialogs and menus. Findings: the modal never takes or holds focus, focus is lost to the body on close, or focus lands far from the trigger (F85). Group interleaving and positive tabindex go to the model, and a verifier recomputes the cited transitions | Fixtures (no ACT rule); EVAL-1 | M |
| C4 | `feat/state-exposure` | 4.1.2 | Toggle probe: the control's pixels or its controlled region change, but its exposed state never does. Role probe: a generic element with its own click listener and a pointer cursor that does something when clicked. The model judges ACT 4b1c6c (same-name iframes) and writes the message | 4b1c6c (23); 6cfa84 incompletes resolved | L |
| C5 | `feat/status-messages` | 4.1.3 | Safe triggers: validation on blur, GET search, client-only controls (copy, filter, sort). A deterministic F103 triage on the settled changes. The model decides whether the change is a status message and quotes it. A patch adds `role=status` | Fixtures (no ACT rule); Rampa's own landing page as a noise check | L |
| C6 | `feat/form-probes` | 3.3.1, 3.3.3, 3.3.7 | Invalid values derived from each field's constraints are typed, then the field is left. Nothing is submitted. Reuse controls ("same as billing") are toggled. Rule for 3.3.7: the same autocomplete purpose asked twice on one page with no reuse control, below threshold | 36b590; fixtures; EVAL-1 | M |
| C7 | `feat/pointer-probes` | 2.5.2, 2.5.7, 2.5.1 (review) | Press, move away and release: a change committed on the down-event that persists (2.5.2). Drags, then a search for at most two clicks or typing that reproduce the change; the model proposes longer paths, which the probe executes (2.5.7). Gesture handlers listed for review (2.5.1). The model only clears, for essential use | Fixtures with SortableJS, dnd-kit and sliders; EVAL-1 | L |
| C8 | `feat/color-only` | 1.4.1 | Current state or required fields that differ from their peers only in color, confirmed on an achromatopsia render with a halo around the elements. Color words in instructions are quoted and checked against the hue of what they name | Fixtures (no ACT rule); EVAL-1 | M |
| C9 | `feat/sensory-characteristics` | 1.3.3 | The ACT 9bd38c filter, with word lists in en, pt-BR and es, and the deterministic passes. A failure is kept only when the model, the broad matcher and the pixel or bounds check all agree | 9bd38c (21) as a sanity check, not a gate; it is a proposed rule | M |
| C10 | `feat/motion-and-time` | 2.2.2, 2.2.1 | Motion inventory from `getAnimations()`, SMIL, video and animated images. A 10 s pixel time series and the efbfc7 text-change detector, with pause controls tried. A fake clock up to 20 h for time-outs; the model reads countdown text and the exceptions | efbfc7 (11), bc659a; fixtures | L |
| C11 | `feat/on-input` | 3.2.2 | Activate class, one fresh load per control, at most 40. A navigation, new window or submission without advance notice is high confidence; the model quotes the notice and only clears. Never reports "form has no submit button" | Fixtures (no ACT rule) | L |
| C12 | `feat/site-consistency` | 3.2.4, 3.2.6, 2.4.2, 2.4.5 | 3.2.4: components grouped by function within a page and across the set, with the model deciding name pairs by a majority of three runs. 3.2.6: the model classifies ambiguous help links. 2.4.2: duplicate titles across a crawl, and route changes in single-page apps that keep the title. 2.4.5: ways found, as needs review only | Fixture sites; three real sites | M |
| C13 | `feat/bypass-blocks` | 2.4.1 | The skip-link probe, plus blocks repeated across crawled pages. A failure needs evidence from several pages and no working mechanism before the main content | cf77f2 (14), following one link per page | M |
| C14 | `feat/structure-judged` | 1.3.1, 2.5.3, 3.3.2 | Text whose typographic signature equals a real heading's but is not marked up (F2). Visible labels not tied to their control (2.5.3). Option groups with no visible question and missing format instructions (3.3.2). All below threshold until measured | Corrupted pairs; EVAL-1 | M |
| C15 | `feat/state-contrast` | 1.4.11, 1.4.3 | Focus indicator contrast from A8's records, as the dominant color of the change against its unchanged neighbours. Text-input boundaries where neither border nor background reaches 3:1. Checked and selected indicators from C4. axe color-contrast run again on focus, hover, expanded and dark-scheme states | Fixtures (C40, G195); EVAL-1 | M |
| C16 | `feat/letter-spaced-words` | 1.3.2 | F32: four or more single letters separated by spaces in one text node, joined into a dictionary word in the element's language. Shares Hunspell dictionaries with the cognitive plan's WI-8 | Fixtures; A–Z indexes must pass | S |
| C17 | `feat/scope-notes` | 3.3.4, 2.5.4 | "3.3.4 applies here" notes, listing payment tokens, transactional buttons and the mechanisms seen. Motion and sensor API use as needs review for 2.5.4 | Fixtures | S |

### Wave D: expensive or rare; may not all be built

| WI | Branch | Criteria | Methods | Effort |
|---|---|---|---|:---:|
| D1 | `feat/flash-analyzer` | 2.3.1 | One analyzer on downsampled luminance grids: animated images through `ImageDecoder`, CSS animations through WAAPI seeking, video later. Pruned by area (G176) and period (G19). Measured failures only, with frame indices. Cross-checked against EA's IRIS | L |
| D2 | `feat/gestures-and-motion` | 2.5.1, 2.5.4 | Swipe and pinch probes reusing C7, with a search for an alternative. Synthetic device motion, a disable switch and a UI alternative (ACT c249d5, 7677a9) | L |
| D3 | `feat/media-deep` | 1.2.1, 1.2.2 | Transcripts found and quoted; a failure only for a placeholder or broken transcript. Speech without captions in any form, after a burned-in caption check on sampled frames. Optional local speech recognition, at review level only | L |
| D4 | `feat/reading-order` | 1.3.2 | Whitespace tables in `pre` (F33, F34) and CSS reordering (F1) against a linearized render. Below threshold until pairs and 30 or more labeled real inversions measure precision | M |
| D5 | `feat/submit-probes` | 3.3.1, 3.3.3, 3.3.4, 3.3.7 | `--allow-submit=<origin>` only: errors from the server, user-supplied Playwright flows for multi-step processes, and review and confirmation steps on test environments | M |
| D6 | `feat/state-variants` | 1.1.1, 3.1.1, 3.1.2 | Carousel images whose name never changes (F20); language switching in single-page apps; caption `srclang` against the spoken language | M |
| D7 | `feat/native-probes` | (no new web counts) | The same observation records from Android (adb TAB key events, `font_scale 2.0`, rotation) and iOS, so A7–A10, B4 and B6 run on app screens | L |

---

## 6. What Rampa refuses to automate, and why

| Refused | Why |
|---|---|
| Saying a page is accessible, or that a criterion "passes" | A probe sees one browser, one viewport set and the states it reached. A clean result is "no failure found under these conditions". This is the first principle in the README. |
| Submitting forms, buying, signing in, deleting or changing account data, unless `--allow-submit=<origin>` names the origin | Rampa runs in development and CI. A probe that writes to a real system can do real harm, and a guard cannot tell a harmless POST from a costly one. |
| Solving, clicking or triggering CAPTCHAs | It defeats the purpose of the challenge and can lock the account being tested. 3.3.8 detects CAPTCHAs and alternatives; a person tests them. |
| Judging whether captions are accurate, an audio description is adequate, a transcript is complete, or live captions keep up (1.2.x) | Equivalence needs the full meaning of the media. Speech recognition and frame descriptions are not good enough to fail someone's video. Rampa finds media, broken tracks and missing signals. 1.2.3, 1.2.4 and 1.2.5 stay needs review only. |
| Letting a model create a failure from an exception (essential, logotype, incidental, "ambiguous to users in general", user-agent controlled) | Exceptions depend on intent and context the snapshot does not hold. A model may only lower or clear a finding, citing its reason, and the person can see that it did. |
| Judging contrast, or flashing, by looking | Models are poor at judging color and contrast by eye. Rampa measures pixels, and a model may only locate what to measure. For 2.3.1, no vision model and no certification claim: a "PEAT pass" or "Harding pass" needs those tools and a person. |
| Reading or focus order verdicts from geometry alone (1.3.2, 2.4.3) | DOM and visual order differ on most real pages without harm. Geometry only nominates candidates; a failure needs a broken relationship that can be verified. |
| Deciding by itself what a "set of web pages" is (2.4.5, 3.2.3, 3.2.4, 3.2.6) | Sets depend on purpose and authorship. Rampa proposes sets from templates; the person can name them in the config. 2.4.5 never produces a failure, because a crawl is never known to be complete. |
| Deciding what a screen reader announces (4.1.2, 4.1.3) | Rampa does not drive screen readers. It checks what is exposed, not what NVDA, JAWS, VoiceOver or TalkBack say. |
| Markup validation reported as WCAG (4.1.1) | W3C removed 4.1.1 in WCAG 2.2, and says to treat it as satisfied for HTML under 2.1. A validator could run as a separate, clearly labeled extra, never as a WCAG finding. |
| Fixing pages for users at run time | "Not an overlay." Patches are proposals for a developer to review. A suggested `alt` is never applied by itself. |
| Camera gestures, real sensors, touch hardware, other browsers and screen-reader modes | Synthetic events cannot reproduce them faithfully. The report names them as not checked. |
| Short-phrase language verdicts, and reading-level verdicts | Single words have no reliable language, and readability formulas are not a WCAG A/AA criterion. Short quotes stay below threshold; readability belongs to the cognitive profile as context, never as a verdict. |

---

## 7. Corrections to the research

These change what the research proposed or how it rated it.

- **Coverage was overstated, not only missing.** `src/core/check.ts` counts any axe outcome other than inapplicable as coverage, while `engineFindings` keeps only violations. Rules that can only pass or return incomplete therefore mark a criterion as "checked" with no possible finding: th-has-data-cells, video-caption, form-field-multiple-labels, bypass, no-autoplay-audio and duplicate-id-aria. A2 fixes this before anything is added.
- **A changed pixel on focus is not "focus visible".** ACT oj04fd maps a pass to "further testing needed". Rampa reports no changed pixel as a failure, a faint change as needs review, and any other change as "no failure found", never as a pass.
- **Keyboard reachability from event handlers is noisy.** Delegated handlers, analytics and wrappers all have click listeners. Wave A reports only native controls and explicit widget roles, and leaves out items of composite widgets that are reached. Handler-only candidates wait for the click-versus-key probe in C2.
- **1.3.4 is worth less on the web than the research ranked it.** Its own plan expected almost no failures on 100 real pages. It moves from priority 1 to 2, and positives come from a targeted corpus. The orientation probe also needs the CDP screen orientation and a `window.orientation` shim. A viewport resize alone left `screen.orientation` in landscape.
- **The 1.3.1 table check has to follow ACT d0f69e exactly.** In the rule, header cells count as assigned cells and emptiness does not matter. The research's "no non-empty data cell" would flag header-only tables and the empty tbody of a single-page app that is still loading. The lexical branch of label association ("short text left of a field") is not low risk, so only the narrow F111 case ships.
- **3.3.1 and 3.3.3 on a freshly loaded page have little to find.** Few pages load in an error state. B8 earns its value in Playwright tests that drive the page into one, and in C6.
- **Synthetic paste events give false failures for 3.3.8.** Fields that trim or spread a pasted value look blocked. Only a trusted paste counts, which the cognitive plan's critique already found.
- **axe target-size is a good base, not a finished check.** It flags unstyled native checkboxes, which the user-agent exception covers. It has no handling for Equivalent or Essential targets. Snapshot bounds are boxes, not hit areas. A5 adds the filters; the model only clears.
- **Reflow at 320×256 is an emulation.** A real 1280×1024 screen at 400% leaves about 318×236 CSS px, so measurements keep 1 px tolerances. Horizontal overflow alone is not a failure: an invisible off-canvas element can widen the page without any content needing two-dimensional scrolling. That is why A9 compares against the 1280 px baseline and requires visible content past the edge.
- **1.4.12 is about the user's override, not the author's values.** The ACT rules axe implements only cover inline `!important`. The probe applies the values as a user would, and the failure is clipping or overlap (F104), not the author's spacing.
- **1.4.11 has no ACT rule and many judgment calls.** Rampa starts with icon-only controls, where the icon is clearly required, and measures with pixels. Input boundaries, focus indicators and state indicators stay below threshold until measured. Graphs stay manual.
- **Media.** The research's speech-recognition and frame methods for 1.2.3 and 1.2.5 are not a basis for failures (section 6). Most of 1.2.x stays needs review.
- **Eval.** `rampa eval` runs only criteria with a judgment module, so rule and probe criteria need the new path in A3. A precision claim needs 35 or more reviewed findings with no false positive; a sample of 30 to 50 random pages will not yield that for rare checks.
- **Priorities from prevalence figures** in the research were not re-verified for this plan and are not repeated here.

---

## Appendix. Sources

- WCAG 2.2: https://www.w3.org/TR/WCAG22/ (4.1.1 removed; content that conforms to 2.2 also conforms to 2.1).
- Understanding, checked on 2026-10-09:
  - Reflow: https://www.w3.org/WAI/WCAG22/Understanding/reflow.html. 320 CSS px is 1280 px at 400%; the two-dimensional exception covers images, maps, diagrams, video, games, presentations, data tables (not individual cells) and toolbars; F102.
  - Non-text Contrast: https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html. Text buttons need no boundary; a text input's visual indicator needs 3:1; focus and state indicators are covered; unmodified user-agent controls and inactive components are exempt; G207, G209, F78.
  - Text Spacing: https://www.w3.org/WAI/WCAG22/Understanding/text-spacing.html. Authors need not use the values; clipping, overlap and ellipsis with no way to the full text fail; F104, C35, C36.
  - Content on Hover or Focus: https://www.w3.org/WAI/WCAG22/Understanding/content-on-hover-or-focus.html. Dismissible, hoverable, persistent; `title` tooltips out of scope; the input-error and does-not-obscure exceptions to dismissing; F95, SCR39.
- ACT rules and test cases: https://www.w3.org/WAI/standards-guidelines/act/rules/. Rampa downloads the test cases at run time. Rules named in this plan: 23a2a8, qt1vmo, e88epe, eac66b, f51b46, 80f0bf, afw4f7, 09o5cg, b4f0c3, 59br37, 24afc2, 78fd32, 9e45ec, b33eff, 9bd38c, d0f69e, a25f45, bc4a75, akn7bn, 0ssw9k, 80af7b, ffbc54, bc659a, efbfc7, cf77f2, fd3a94, oj04fd, 2ee8b8, c249d5, 7677a9, ucwvc8, off6ek, de46e4, 36b590, 4b1c6c, 6cfa84.
- axe-core 4.14.0 rule metadata (`axe.getRules()` and the rule definitions): 105 rules. No rule is tagged 1.4.10, 1.4.11 or 1.4.13. `avoid-inline-spacing` is tagged 1.4.12 (ACT 24afc2, 9e45ec, 78fd32). `target-size` is tagged `wcag22aa` and is disabled by default. `css-orientation-lock` is experimental. `audio-caption`, `duplicate-id` and `duplicate-id-active` are deprecated.
- The cognitive profile plan, for the shared items, the advisory routing and the `beyond-target` class: [cognitive-profile.md](cognitive-profile.md).

# Changelog

Changes to `rampa-cli`, newest first. Each released version has a `## [x.y.z] - date` section; the release workflow publishes that section as the version's GitHub release notes, and it stops before publishing when the section is missing ([RELEASING.md](RELEASING.md)). Changes not released yet go under Unreleased.

## Unreleased

- **A 4.1.3 pass clears its item to review again.** The status-message judgment (`judgment/4.1.3@2`, with `--probe status`) now asks the model to copy, on a pass, the text that appeared. Its prompt asked for empty evidence on a pass, and verification discards a pass that quotes nothing, so nearly every pass left its item for a person. The verification rule is unchanged; the version bump re-asks cached 4.1.3 judgments once.
- **Refs escape tag names.** A tag name the HTML parser takes whole but a selector misreads, such as `<x-a.b>` (`.` reads as a class) or `<foo:bar>` (`:` reads as a pseudo-class), is escaped the way ids already were: `x-a\.b`, `foo\:bar`. Before, the ref of such an element, or of anything inside it, named another element or none, so what finds an element by its ref (image and contrast captures, the probes) could miss it. The collector, the probe kit and the browser-tree reader build the same refs, and refs of ordinary tags are unchanged.

## [0.1.1] - 2026-10-15

Fixes found by the W3C ACT implementation report and by the dev half of the fresh-page study. Only the dev half was used to choose them; the held-out half has to be measured again on new pages.

- **1.1.1 judgments the page contradicts are dropped.** A brand glued to "logo" ("Instagramlogo") is a name, not a garbled alt; an alt that repeats its link's visible text is not "missing" anything; a linked image whose alt names the destination (its title, a part of its address, or the service a share link goes to) does say where the link leads; and an alt equal to its file name is a placeholder only when the name looks like a file name ("Lula" from `Lula.png` is a name). "img-1", "image.png", "logo" alone and an empty alt on an informative image still fail. On the dev pages, 1.1.1 precision went from 0.27 to 0.70 with no true failure lost ([notes](docs/studies/notes-111-dev-fixes.md)).
- **`rampa/link-color-only` compares a link with the text of its own block**, in the style most of it has, and does not apply where there is no such text (a menu, a list of links). On the dev pages its 10 labelled false positives are gone ([notes](docs/studies/notes-rules-dev-fixes.md)).
- **A text field's caret counts as its focus indicator** (Understanding 2.4.7), for `rampa/focus-visible` and `rampa/focus-indicator-contrast`. Buttons, links and read-only fields with no visible change are still reported.
- **A page cut at the collector's element limit says so** in every report, with the criteria whose checks did not run past the cut.
- **`rampa/placeholder-text`** keeps only phrases no page means ("Label here", "Seu rótulo aqui"); "Your label" is no longer flagged.
- **Standalone SVG and XML documents no longer stop the check.** axe-core is evaluated in the page instead of added as a `<script>`, which an SVG document has no head for. An SVG document is checked by axe-core and the rules that read the tree, and the report says what did not run on it (contrast from pixels, the probes). An XML document that the browser shows as its source tree is not checked, and the report says so, instead of checking the browser's view of the source. The snapshot records the kind of document (`document`). 13 of the W3C ACT test cases are such documents.
- **An experimental rule no longer hides an item to review.** A rule that takes over what axe-core left undecided (`resolves`; `rampa/pixel-contrast` for `color-contrast`, and the media, skip-link and link-color probe rules) now removes axe-core's item to review only when the report shows its result instead: its own item to review, a failure at the threshold in effect, or a pass at a confidence that meets it. At the default threshold an experimental rule's failure or pass leaves axe-core's item in place, with what the rule measured as its evidence. Before, the item went away and the failure stayed below the threshold, so the default output showed nothing (ACT afw4f7).
- The GitHub Action installs `rampa-cli` from npm, at the version in its own `package.json`, so `uses: guilhermebsantiago/rampa-cli@v0.1.0` runs exactly the published 0.1.0. It builds from its checkout only when that version is not on npm, or when `from-source: true` asks for it.
- `rampa init` pins the action in the workflow it writes to this release's tag instead of `@main`.
- Releases are published to npm from GitHub Actions with trusted publishing (OIDC) and provenance.

## [0.1.0] - 2026-10-15

Rampa's first release on npm, as **`rampa-cli`**. The command it installs is `rampa`.

```sh
npm install --global rampa-cli      # or once: npx rampa-cli check <url>
rampa doctor
rampa check https://example.com
```

Rampa checks pages against WCAG 2.2 A/AA. It reports what was checked and what was not, and it never says a page is accessible.

- **axe-core plus Rampa's own rules**, plus pixel checks and checks over the browser's accessibility tree.
- **Opt-in probes** that resize the page and press, click or type on it under a network guard.
- **Per-criterion judgment by a model**, local Gemma 4 12B through Ollama by default. Every claim must quote evidence that is on the page.
- **An opt-in cognitive profile** (`--profile cognitive`) with experimental advisories drawn from W3C COGA and GAIA.
- **Outputs and integrations:** SARIF, Markdown, HTML and JSON reports, a GitHub Action (`uses: guilhermebsantiago/rampa-cli@v0.1.0`), an MCP server, Playwright and Puppeteer helpers, and a library API.

How it measures against axe-core, Pa11y, IBM Equal Access, Siteimprove Alfa and QualWeb, with its caveats, is in [How it compares](https://github.com/guilhermebsantiago/rampa-cli#how-it-compares) and [docs/benchmark.md](https://github.com/guilhermebsantiago/rampa-cli/blob/main/docs/benchmark.md). Experimental checks report below the default confidence threshold until they pass the evaluation gate.

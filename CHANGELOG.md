# Changelog

Changes to `rampa-cli`, newest first. Each released version has a `## [x.y.z] - date` section; the release workflow publishes that section as the version's GitHub release notes, and it stops before publishing when the section is missing ([RELEASING.md](RELEASING.md)). Changes not released yet go under Unreleased.

## Unreleased

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

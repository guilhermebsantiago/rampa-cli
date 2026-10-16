# W3C Web Accessibility Evaluation Tools List: Rampa's entry

Answers for the W3C [Web Accessibility Evaluation Tools List](https://www.w3.org/WAI/test-evaluate/tools/list/), field by field, ready to paste into its form. **Nothing has been submitted.** The ACT implementation report is a separate submission: see [act-implementation.md](act-implementation.md).

## How a tool gets listed

- The list takes submissions through the form at **https://www.w3.org/WAI/test-evaluate/tools/submit-a-tool/**. On submit, a Netlify function opens a pull request in [w3c/wai-evaluation-tools-list](https://github.com/w3c/wai-evaluation-tools-list) with the answers as a JSON file under `_data/wai-evaluation-tools-list/submissions/`, and the list maintainers review and merge it ([the form's source](https://github.com/w3c/wai-evaluation-tools-list/blob/master/content/submit-a-tool.md), [the workflow that opens the pull request](https://github.com/w3c/wai-evaluation-tools-list/blob/master/.github/workflows/process-form-submission.yml)). There is no separate GitHub route for a new tool; changes and removals go by e-mail to group-wai-list-eval-tools@w3.org.
- **Everything submitted is public on GitHub**, the e-mail address included, in the pull request. The list itself never shows the e-mail address.
- The form says, as of 2026-10-15: "W3C staff temporarily has limited availability to process submissions. We expect to resume full support in November 2026."
- Scope: the list takes tools "specifically designed to help determine if digital content meets accessibility guidelines", and does not take tools that "primarily change content or code directly to improve accessibility". Rampa is in scope: it reports and never changes a page (it suggests patches for a person to apply).
- The "ACT Rules (URL)" field links to a tool's page under https://www.w3.org/WAI/standards-guidelines/act/implementations/. That page exists only once the ACT implementation report is accepted. W3C copies ACT data into the list every week ([copy-to-evaluation-tools-list.yml](https://github.com/w3c/wcag-act-rules/blob/main/.github/workflows/copy-to-evaluation-tools-list.yml)). Several tools built on axe-core link this field to axe-core's own ACT page; Rampa should not, since axe-core's page is Deque's report, not Rampa's.

## The answers

Field labels are the form's own. "Leave empty" and "leave unchecked" are deliberate, with the reason given.

### Before the form

| Field | Answer |
| --- | --- |
| I have read the above and confirm that this submission meets the criteria for tools that will be included (Required) | Check |

### 1/3 General information

| Field | Answer | Source, or why |
| --- | --- | --- |
| Tool name (Required) | `Rampa` | README, package `rampa-cli` |
| Web address (URL) (Required) | `https://rampa.guilhermebs.com.br` | CITATION.cff `url`; the site links the repository and has a Portuguese version at `/pt/` |
| Vendor / organization (Required) | `Guilherme Santiago` | CITATION.cff author, LICENSE copyright. There is no organization behind Rampa; **to confirm before submitting** |
| Email address (Required) | **The author chooses.** | It is published in the GitHub pull request. Rampa's repository lists no contact address (SECURITY.md uses GitHub's private reports), so pick one meant to be public |
| Release date (Required) | `2026-10-15` | The current version, 0.1.1: rampa-cli 0.1.1 on npm (2026-10-15T23:56Z, published by the release workflow with provenance) and the GitHub release v0.1.1 (2026-10-15T23:55Z). The first release, 0.1.0, came out the same day (npm 21:06Z, GitHub 21:08Z) |
| Accessibility statement (URL) | Leave empty | Neither the site nor the CLI has an accessibility statement, and this entry should not suggest one |
| ACT Rules (URL) | Leave empty for now | Fill it in, or send it by e-mail later, once W3C lists Rampa's ACT implementation: `https://www.w3.org/WAI/standards-guidelines/act/implementations/<key>/`, where the key is the one W3C picks (proposed: `rampa`) |

### 2/3 Tool functionality

**Short product description (max. 350 characters) (Required)**, 335 characters:

> Open-source command-line checker for web pages against WCAG 2.2 Level A and AA. It runs axe-core and its own rules, and can ask a language model, local or hosted, about what rules cannot decide, one criterion at a time; a model claim is kept only if the element and text it cites exist on the page. Many of its checks are experimental.

| Field | Check | Leave unchecked, and why |
| --- | --- | --- |
| Purpose (Required) | Automated testing | Manual testing: Rampa lists items a person has to review, but gives no step-by-step manual procedure. Simulated user experience: Rampa does not simulate users |
| Product evaluated (Required) | Website | Mobile application: `rampa check android:` and XCUITest exports exist, but `rampa check android:` has not been run on a real device and the iOS Swift helper has never been compiled ([android.md](android.md#status), [ios.md](ios.md#status)). Source code: Rampa checks pages as a browser renders them, local `.html` files included, not source code. Document, Other: no |
| File type | HTML / XHTML | CSS, PDF, EPUB, Office, ODF, SMIL, Markdown: Rampa reads none of these as files. It does measure rendered colors and layout, but that is HTML as rendered. The form has no SVG option; since 0.1.1 Rampa also checks a standalone SVG document at a URL, with axe-core and the rules that read the tree ([api.md](api.md)) |
| Scope (Required) | Single page/screen; Component (checks scoped to a component in Playwright tests and Storybook stories: [playwright.md](playwright.md), [storybook.md](storybook.md)); Sample of pages/screens (`--crawl`, `--sitemap`, 10 pages by default: [crawl.md](crawl.md)); Restricted or password protected pages (`--storage-state`, `--header`, `--cookie`: [browser-options.md](browser-options.md)) | Entire website / software / product: a crawl is bounded by `--max-pages` and is not a full-site audit |
| Standards | WCAG 2.2; WCAG 2.1 (`--wcag 2.1`) | WCAG 2.0: not offered as a target. EPUB: no |
| Assists by | Generating reports of evaluation results (terminal, JSON, SARIF, Markdown, single-file HTML: [output-formats.md](output-formats.md)) | Displaying information within web pages: Rampa is not an overlay or an extension. Creating an accessibility score: it gives none. Providing step-by-step evaluation guidance: no |

### 3/3 Tool details

| Field | Answer | Source, or why |
| --- | --- | --- |
| Language (Required) | English (`en`); Brazilian Portuguese (`pt-BR`) | The CLI and its reports in both (`--locale pt-BR`); the site in both. The form's list has `pt-BR` as "Brazilian Portuguese (Português do Brasil)" |
| License (Required) | Free; and Other: `Open source (MIT License)` | The form's "License" options are about price. LICENSE is MIT; axe-core, a dependency, is MPL-2.0 |
| Type of tool (Required) | Command-line / CI | Also defensible, **the author's call**: Programming tool plugin / IDE, for `rampa mcp` (an MCP server for coding agents in Claude Code, Cursor or VS Code: [mcp.md](mcp.md)) and the Playwright and Storybook integrations. Browser plugin, Bookmarklet, Desktop or Mobile application, Online tool, CMS plugin: no. Server-side integration: there is a Node.js API ([api.md](api.md)), but it is meant for tests and scripts, not a server product |
| Browser for plugin | Leave empty | Not a browser plugin. Rampa drives Chrome or Edge, or a Chromium from Playwright |
| Operating system | Windows; Linux | It needs Node.js 22.12+ and a Chromium-based browser. It is developed on Windows, and CI runs on Linux (`ubuntu-latest`). MacOS: probably works, but nothing tests it there; check it only after a run on a Mac |

### 4/5 Submitting your evaluation tool

**Comments** (public on GitHub, not shown in the list):

> Rampa is free and open source under the MIT License: https://github.com/guilhermebsantiago/rampa-cli, installed from npm as rampa-cli (the command is rampa). It is an individual project, the author's undergraduate final project.
>
> What does the checking: axe-core 4.14 (Deque, MPL-2.0) makes most of the deterministic checks; Rampa adds its own rules, opt-in browser probes, and optional judgments by a language model the user provides (Ollama or LM Studio locally, or a hosted provider). With --no-llm only the deterministic checks run.
>
> Limits: Rampa's own rules, every probe, the site-wide criteria, target size (2.5.8) and the cognitive accessibility advisories are experimental. They report below the default threshold, and do not fail a build, until enough of their findings have been reviewed by a person. Model judgments make mistakes: on fresh real pages, 0.38 of the judged findings at the default threshold were correct, by labels that two AI agents wrote and a person has not yet reviewed. Each report says what was checked, what was judged and what a person must review; Rampa never reports that a page is accessible or conforms. Reading Android screens and iOS XCUITest exports exists but has not been tried on real devices, so mobile applications are not listed.
>
> An ACT implementation report for Rampa (EARL) is prepared for w3c/wcag-act-rules; if W3C lists it, the ACT Rules URL will follow by e-mail.

| Field | Answer |
| --- | --- |
| I give permission for the information about this resource to be published in the Web Accessibility Evaluation Tools List and archived on GitHub (Required) | Check |

## Before submitting

- Confirm the vendor name and choose the e-mail address.
- Re-read the description and the comments against the README of the version that is current then; the answers above are for 0.1.1, and the numbers in them are from 2026-10-15.
- Submit the ACT report first if you want the ACT URL in the first submission; otherwise submit the tool now and send the URL to group-wai-list-eval-tools@w3.org later.

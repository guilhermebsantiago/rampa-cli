# Roadmap

What is built and what is next. Each study and plan it links has the detail.

- [x] Web surface: Playwright and axe-core over a normalized snapshot
- [x] WCAG 1.1.1 with vision, with a suggested `alt` as the patch, on `img`, `input type="image"`, `role="img"` and named `<canvas>`
- [x] WCAG 2.4.2 page titled, 2.4.4 link purpose in context, 2.4.6 headings and labels
- [x] WCAG 3.1.1 language of page and 3.1.2 language of parts, with image names from `aria-labelledby` counted as text
- [x] `rampa eval` with ACT test cases, corrupted pairs and the verification ablation
- [x] Local models and the major providers: OpenAI, Anthropic, Google, Azure, Bedrock, Vertex, Mistral, xAI, Groq, DeepSeek, Together, Fireworks, Cerebras, OpenRouter, Vercel AI Gateway
- [ ] The evaluation table for each provider's recommended model
- [x] Publish on npm: [`rampa-cli`](https://www.npmjs.com/package/rampa-cli)
- [x] MCP server, so coding agents can call `rampa check`
- [x] WCAG 2.4.4 with the destination page fetched, so a link can be compared with where it really goes
- [x] WCAG 1.3.5 identify input purpose, 3.3.2 labels or instructions, and 1.4.5 images of text on request
- [x] SARIF, Markdown and HTML reports, a GitHub Action that comments on pull requests, a pre-commit hook
- [x] Playwright and Storybook integration, and a library API
- [x] Whole-site crawls, pages behind a login, devices and dark mode
- [x] `rampa init`, baselines and waivers with expiry, for codebases that already have findings
- [x] Android (adb and UI Automator), iOS (XCUITest export) and image-only surfaces
- [x] `rampa compare`, to choose a model per criterion
- [x] [Rampa Lab](https://rampalab.guilhermebs.com.br/), a web app to explore evaluation runs in the browser
- [x] A first false-positive study on real pages ([report](studies/real-pages-2026-10.md)); human review of its labels is next
- [x] The study's dev-split fixes: destination evidence for 2.4.4, functional icons and stacked carousel images for 1.1.1, honeypot fields, home pages titled with the site's name ([re-measurement](studies/real-pages-2026-10-remeasure.md#what-changed-since-the-first-run))
- [x] WCAG 2.2 by default, with a status for every criterion and axe-core's incomplete results kept for review
- [x] Deterministic Rampa rules, and 2.5.8 target size (experimental)
- [x] Site criteria over a crawl: 3.2.3 consistent navigation and 3.2.6 consistent help (experimental)
- [x] An opt-in cognitive accessibility profile from the W3C COGA guidance: first four checks ([plan](plans/cognitive-profile.md))
- [x] Cognitive profile, second round (COGA and GAIA): motion, interruptions, layout shift, blocked paste, legibility, icon-only controls and new-window links, all experimental
- [x] Probes that drive the page, opt-in with `--probe`: media (captions, sound that plays by itself), orientation, text cut at 200% zoom, reflow at 320 px, text spacing, content on hover or focus, keyboard reachability and traps, single-key shortcuts, change on focus, focus visible and not obscured ([probes.md](probes.md))
- [x] Contrast measured from pixels where axe-core cannot decide (text over images, gradients and video; placeholders; icon-only controls), and axe-core in every frame, open shadow roots and same-origin frames in the snapshot ([rules.md](rules.md))
- [x] A language identifier that decides long, clear 3.1.1 and 3.1.2 cases without a model and drops model claims that contradict it
- [x] The rest of the probe waves: all four waves of the [plan](plans/wcag-coverage.md) are built, every check experimental and every probe off by default
- [x] The browser's accessibility tree in the snapshot (Chromium, over CDP): names and roles as assistive technology gets them, used by the rules and by 2.4.4, 2.4.6 and 3.3.2
- [x] The rest of the WCAG 2.2 waves, as experimental probes run only when named: accessible authentication (`auth`), focus management (`focus-order`), errors after submitting (`form` with `--allow-submit`), motion and time limits (`motion`)
- [x] ChatGPT and Gemini subscriptions through their official CLIs

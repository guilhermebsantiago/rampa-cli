# Security

Rampa loads the pages you point it at in a headless browser and sends parts of them to the model you configure. Do not point it at content you are not allowed to send to that model; use a local model (Ollama) or `--no-llm` for private code.

**Prompt injection is a residual risk.** The text of the pages you check goes into the model's prompts, and a page can carry instructions for whatever model reads it. Rampa limits what that can do: page data sits inside tags the model is told never to obey, the model answers only in a fixed JSON schema, it has no tool to act with (the Codex and Gemini CLIs run with their tools turned off, see [docs/subscriptions.md](docs/subscriptions.md)), and every claim must cite an element that exists and quote text that is in it, or it is dropped. None of that stops a page from steering a verdict: it can make a real failure pass, or a claim that verification accepts fail, and it can shape the wording of a message or of a suggested `alt` or other patch. Read model findings and suggested text as untrusted, and review a patch before you apply it.

Probes drive the page behind a network guard that lets only GET, HEAD and OPTIONS through. The one exception is `rampa check --probe form --allow-submit <origin>`, which submits forms on that exact origin and so writes to its server: use it on test environments only. What it never does is in [docs/probes.md](docs/probes.md#submitting-forms---allow-submit).

To report a vulnerability, open a private report through GitHub: **Security → Report a vulnerability** on this repository. Please do not open a public issue for it.

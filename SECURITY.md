# Security

Rampa loads the pages you point it at in a headless browser and sends parts of them to the model you configure. Do not point it at content you are not allowed to send to that model; use a local model (Ollama) or `--no-llm` for private code.

Probes drive the page behind a network guard that lets only GET, HEAD and OPTIONS through. The one exception is `rampa check --probe form --allow-submit <origin>`, which submits forms on that exact origin and so writes to its server: use it on test environments only. What it never does is in [docs/probes.md](docs/probes.md#submitting-forms---allow-submit).

To report a vulnerability, open a private report through GitHub: **Security → Report a vulnerability** on this repository. Please do not open a public issue for it.

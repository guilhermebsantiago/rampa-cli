# Judging on your AI subscription

Rampa's judgment layer can run on a plan you already pay for, a ChatGPT plan through Codex CLI or a Gemini Code Assist license through Gemini CLI, instead of an API key. It runs the official agent CLI that you installed and signed in to, in that CLI's documented non-interactive mode, once per judgment.

- **Rampa runs the CLI you installed and signed in to.** It finds `codex` (or `gemini`) on your PATH and starts it, as you would in a script.
- **It never reads your credentials.** Sign-in happens in the CLI, through the vendor's own flow. Rampa does not open, copy, store or forward tokens, and it offers no login of its own.
- **Usage counts against your plan.** Every judgment is one request on your account, under your plan's limits and the vendor's terms. Rampa does not pay for, resell or share it.

```sh
codex login                                         # once: sign in with ChatGPT
rampa doctor                                        # "Codex CLI  0.55.0 · signed in (ChatGPT)"
rampa check page.html --model codex:default         # judge on the plan
```

The report then ends its usage line with `on your ChatGPT plan, through Codex CLI` instead of a price.

| Provider | CLI | Plans | Model after the colon | Images (1.1.1) | Answer format | Sign-in check | Run against the real CLI |
| --- | --- | --- | --- | :---: | --- | --- | --- |
| `codex:` (or `codex-cli:`) | [Codex CLI](https://learn.chatgpt.com/docs/codex/cli), `codex` | ChatGPT plans that include Codex | a model your plan offers in Codex, or `default` | yes | JSON Schema, enforced by the CLI | `codex login status` | no: built from the documentation and tested against a stub |
| `gemini-cli:` | [Gemini CLI](https://geminicli.com), `gemini` | Gemini Code Assist Standard and Enterprise | `flash`, `pro`, a full id, or `default` | yes | schema in the instructions, checked by Rampa | the sign-in saved in `~/.gemini/settings.json` | no: built from the documentation and tested against a stub |

Every answer, from either of them, is validated against the criterion's schema by Rampa and then goes through evidence verification like any other model's.

**Gemini and Google AI Pro or Ultra.** Since 2026-06-18, Gemini CLI's Google sign-in no longer serves Google AI Pro and Ultra; Google moved those plans to Antigravity CLI ([Google's notice](https://developers.googleblog.com/an-important-update-transitioning-gemini-cli-to-antigravity-cli/)). Gemini CLI keeps serving Gemini Code Assist Standard and Enterprise. With a paid Gemini API key, use Rampa's `google:` provider directly: it is faster than going through a CLI and needs no subscription.

**Claude plans are not supported.** Anthropic's terms say that the advertised usage limits for Pro and Max plans "assume ordinary, individual usage of Claude Code and the Agent SDK", and that third-party developers may not "route requests through Free, Pro, or Max plan credentials on behalf of their users" ([Legal and compliance](https://code.claude.com/docs/en/legal-and-compliance)). To judge with Claude, use an API key: `anthropic:claude-haiku-5-5`, or Claude on Amazon Bedrock or Vertex AI (`rampa models` lists them).

**CLIs that are not supported, and why** (checked against their documentation on 2026-10-08):

- **Antigravity CLI (`agy`)**, the CLI for Google AI Pro and Ultra. Its headless mode enforces a JSON schema, but it takes no images, has no flag for instructions, and has no way to run without your plugins, hooks, rules and settings: your global `~/.gemini/AGENTS.md` and `GEMINI.md` always load, and print mode starts even MCP servers marked disabled ([issue 1088](https://github.com/google-antigravity/antigravity-cli/issues/1088)). Rampa could not keep your setup out of the judgment, so it waits for Antigravity to document a way to.
- **GitHub Copilot CLI.** It has a prompt mode with JSON output and image attachments, but no schema enforcement, no documented event format for prompt runs, and no token counts in that output ([issue 4107](https://github.com/github/copilot-cli/issues/4107)), while each run spends AI credits Rampa could not report.

## Setup

Install the CLI from its vendor, sign in once in the CLI itself, then let `rampa doctor` confirm it:

| CLI | Install | Sign in | Then |
| --- | --- | --- | --- |
| Codex CLI | `npm install -g @openai/codex`, or the standalone installer | `codex login`, with ChatGPT | `rampa check <page> --model codex:default` |
| Gemini CLI | `npm install -g @google/gemini-cli` | `gemini`, then Sign in with Google; with a Code Assist license, also set `GOOGLE_CLOUD_PROJECT` to your project ([Gemini CLI authentication](https://geminicli.com/docs/get-started/authentication/)) | `rampa check <page> --model gemini-cli:default` |

`RAMPA_MODEL=codex:default` or `model: 'codex:default'` in `rampa.config.ts` makes it the default, like any other model.

## How a judgment runs

Each judgment is one process. Rampa writes what the CLI needs into a fresh directory, starts the CLI with that directory's parent as its working directory, reads one JSON answer back, validates it against the criterion's schema, and deletes the directory. The answer then goes through the same evidence verification as any other model's.

### Codex CLI

```sh
codex exec --json --color never --skip-git-repo-check --ephemeral --ignore-user-config --ignore-rules --sandbox read-only \
  -c features.shell_tool=false -c features.unified_exec=false -c features.apps=false -c features.plugins=false \
  -c features.hooks=false -c features.multi_agent=false -c features.image_generation=false \
  -c web_search="disabled" -c tools.view_image=false -c project_doc_max_bytes=0 -c history.persistence="none" \
  -c developer_instructions="<instructions>" --output-schema <call>/schema.json --model <model> \
  --image=<call>/image-1.png  < prompt
```

- **The prompt goes through stdin**; Codex reads it there when no prompt argument is given. Each image goes in with the attached form `--image=<file>`, which ends that flag's list, so nothing after it is read as an image.
- **The instructions go in as developer instructions**, next to Codex's own prompt. Codex can also replace its prompt (`model_instructions_file`), but a replaced prompt may not be accepted on a ChatGPT sign-in, so Rampa does not.
- **The answer** is the last `agent_message` in the JSON event stream, held to the schema by `--output-schema` in strict mode; usage comes from `turn.completed`. Codex does not report the model it used, so the report shows the one you asked for.
- **`default`** leaves the model to Codex; a model name must be one your plan offers in Codex.
- **Your credential store.** `--ignore-user-config` also drops where you told Codex to keep its sign-in, so Rampa reads that one setting, `cli_auth_credentials_store`, from your `config.toml` and passes it back. It never reads the credentials.

### Gemini CLI

```sh
GEMINI_SYSTEM_MD=<call>/system.md GEMINI_CLI_TRUST_WORKSPACE=true NO_BROWSER=true \
  gemini --output-format json --extensions none --allowed-mcp-server-names rampa-none --model <model>  < prompt
```

- **Gemini CLI takes no schema**, so it goes into the instructions, which replace Gemini CLI's own system prompt through `GEMINI_SYSTEM_MD`. Rampa reads the JSON out of the `response` field, with or without a code fence, and validates it.
- **Images** are written into the call's directory and referenced in the prompt as `@<call>/image-1.png`; Gemini CLI reads them and sends them inline with the prompt.
- **Usage** sums the prompt, answer and thinking tokens of every model in `stats.models` (a router may add a small one); the model id is the one that wrote the answer.
- **Sign-in check**: Rampa reads which sign-in Gemini CLI saved in `~/.gemini/settings.json` (never the credential files) and refuses an API-key, Vertex AI or gateway setup.
- **Trust**: Gemini CLI refuses to run headless in a folder it does not trust, and only reads a folder's settings when it trusts it; `GEMINI_CLI_TRUST_WORKSPACE=true` trusts Rampa's own directory for these runs only.

## Keeping your setup out of the judgment

An agent CLI normally loads a lot of context: your settings, hooks, plugins, MCP servers, skills, memory files and the project you are in. None of it belongs in an accessibility judgment, and some of it, such as hooks, runs code. Rampa turns it off for its own runs only; your interactive sessions are untouched.

It is also a safety measure. The pages Rampa checks are untrusted, and a page can carry instructions for whatever model reads it. With the settings below, the model has no tool to act on them: all it can do is answer, and the answer still has to pass evidence verification.

Both CLIs run in Rampa's own empty directory (`%LOCALAPPDATA%\rampa\cli` on Windows, `~/.cache/rampa/cli` elsewhere), never in the project you are checking, so its `AGENTS.md`, `GEMINI.md`, settings, hooks and MCP servers never load.

| What | How Rampa keeps it out (Codex CLI) |
| --- | --- |
| The project you are checking, and git | Rampa's own directory, outside any repository (`--skip-git-repo-check`) |
| Your `config.toml`: MCP servers, profiles, `model_provider`, the `notify` command | `--ignore-user-config` (the sign-in still comes from `CODEX_HOME`) |
| Your execpolicy rules | `--ignore-rules` |
| Shell commands, apps, plugins, hooks, subagents, image generation, web search, the image viewer | `-c features.shell_tool=false`, `features.unified_exec`, `features.apps`, `features.plugins`, `features.hooks`, `features.multi_agent` and `features.image_generation` set to `false`, `web_search="disabled"`, `tools.view_image=false`, inside a `--sandbox read-only` |
| The project's `AGENTS.md` | `-c project_doc_max_bytes=0` |
| A saved session and prompt history | `--ephemeral` and `-c history.persistence="none"` |
| An API key in the environment | `CODEX_API_KEY`, which exec bills ahead of the ChatGPT sign-in, and `OPENAI_API_KEY` are removed from the CLI's environment |

What stays: your global `~/.codex/AGENTS.md`. Codex loads it from `CODEX_HOME` whatever the flags say, and moving `CODEX_HOME` would also move the sign-in. Keep it short, or free of anything that would bias a judgment.

For Gemini CLI, Rampa writes `.gemini/settings.json` into its own working directory; Gemini CLI reads it on top of your settings, for runs in that directory only:

| What | How Rampa keeps it out (Gemini CLI) |
| --- | --- |
| The project you are checking, its `GEMINI.md` and `.gemini/settings.json` | Rampa's own directory |
| Built-in tools (shell, files, web) | `"tools": {"core": []}`, an empty allowlist; `@` file references do not need a tool |
| Hooks, skills, checkpoints, auto-update | `"hooksConfig": {"enabled": false}`, `"skills": {"enabled": false}`, `"general": {"checkpointing": {"enabled": false}, "enableAutoUpdate": false}` |
| Your `GEMINI.md` files | `"context": {"fileName": "RAMPA-NO-CONTEXT.md"}`, a name no file has, and no directory tree in the prompt |
| Extensions | `--extensions none` |
| MCP servers | `--allowed-mcp-server-names rampa-none`, an allowlist that names no server |
| Gemini CLI's coding instructions | `GEMINI_SYSTEM_MD=<call>/system.md`, Rampa's prompt with the schema |
| A browser window for an expired sign-in | `NO_BROWSER=true`: the run fails with a message instead |
| An API key, Vertex AI or a gateway in the environment | `GEMINI_API_KEY`, `GOOGLE_API_KEY`, `GOOGLE_GENAI_USE_VERTEXAI` and `GOOGLE_GEMINI_BASE_URL` are removed from the CLI's environment |

What stays: Gemini CLI records its chat sessions under `~/.gemini/tmp/`, in a folder for Rampa's working directory; there is no setting to turn that off. Any `@` in page text makes Gemini CLI look for a file of that name in Rampa's directory; it finds none, and the text goes to the model unchanged.

## Limits and terms

A subscription is not an API key with a different price. Read your plan's terms before you point Rampa at it, and keep these in mind:

- **Your own work.** The subscription providers are meant for you, on your machine, checking your own work. For a CI pipeline, or for checking pages on someone else's behalf, use an API key.
- **No intermediating.** Rampa runs the unmodified `codex` or `gemini` binary on your machine, signed in by you, and never touches the credentials. Do not wrap it in a service that runs on your plan for other people. Whether a particular use fits your plan is for its terms to say; when in doubt, use an API key.
- **Shared limits.** Through Codex CLI, judgments draw on your ChatGPT plan's Codex limits, the same ones your own use of Codex draws on; through Gemini CLI, on your Gemini Code Assist license. A page with 50 candidates is 50 requests. Use `--criteria` to judge only what you need.
- **CI and teams.** For pipelines, use an API key (the providers in `rampa models`), billed per token to whoever owns the key. Business and Enterprise plans have their own terms; ask your administrator.

Before the first judgment, Rampa checks that the CLI is installed and signed in to a subscription (`codex login status`, or the sign-in Gemini CLI saved). If the CLI is set up with an API key or a cloud account instead, Rampa refuses to use it as a subscription and tells you to call that API directly, which is faster than going through a CLI.

## Settings

| Variable | Default | What it does |
| --- | --- | --- |
| `RAMPA_CLI_CONCURRENCY` | `3` | Most CLI processes running at once. Each judgment is a process with its own startup, so more is not always faster. `--concurrency` can only lower it. |
| `RAMPA_CLI_TIMEOUT` | `300` | Seconds before Rampa kills a CLI that has not answered, with its child processes. |
| `RAMPA_CODEX_BIN` | `codex` on PATH, then the standalone installer's place on Windows | Path to Codex CLI when it is not on PATH (a shell alias is invisible to Rampa). |
| `RAMPA_GEMINI_BIN` | `gemini` on PATH | Path to Gemini CLI. |

`--reasoning low|medium|high` becomes Codex's `model_reasoning_effort`; `none` and `minimal` become `low`, since newer models cannot turn reasoning off. Gemini CLI has no such switch, so `--reasoning` does not change it.

`<provider>:default` leaves the model to the CLI. With Codex CLI that is Codex's built-in default, not the model in your `config.toml`, since Rampa does not load it.

## Cache and reports

- **Cached judgments are keyed by provider and model**, so a `codex:` judgment never reuses an answer from `openai:` for the same model name, and `--offline` replays a subscription run without starting the CLI.
- **An alias follows the CLI.** `gemini-cli:flash` means whatever Gemini CLI calls `flash` that day, and `codex:default` whatever Codex picks, while the cache keeps the answers it already has under that name. Pin a full model id when a run has to be reproducible.
- **No price.** The usage line shows calls and tokens, then the plan, not a price: there is no per-token charge to estimate.
- **Rampa never picks a subscription on its own.** Without `--model`, it chooses a local model or an API key, as before.

## Troubleshooting

| Message | What to do |
| --- | --- |
| `Codex CLI (codex) is not installed or not on PATH` | Install it (`npm install -g @openai/codex`, or the standalone installer), or set `RAMPA_CODEX_BIN` to the executable. For Gemini CLI, `RAMPA_GEMINI_BIN`. |
| `Codex CLI is not signed in` | Run `codex login` and sign in with ChatGPT; `codex login status` shows how it is signed in. For Gemini CLI, run `gemini` and choose Sign in with Google. |
| `is signed in with an API key or a cloud account` | Sign the CLI in with your plan's account, or use that key directly with `--model openai:<model>` or `--model google:<model>`. |
| `Your ChatGPT plan reached its usage limit in Codex CLI` | Wait for the reset the message gives, or switch to a local model or an API key for the rest of the run. Rampa stops starting the CLI after the first limit message. |
| `Codex CLI did not answer within 300 s` | A slow model on a long page: raise `RAMPA_CLI_TIMEOUT`. If it happens every time, run the same `codex exec` by hand to see what it is waiting for. |
| `did not return an answer that matches the schema` | The model answered in another shape; that candidate is reported as a model error and the run continues. A stronger model helps; with `--runs 3`, one failed answer no longer loses the candidate. |
| `does not offer the model` | Use a model your plan offers in that CLI, or `default` for the CLI's own choice. |

With Gemini CLI, the same messages name it and say how to sign in to it. `RAMPA_DEBUG=1` prints stack traces for unexpected errors.

On Windows, CLIs installed with npm are `.cmd` shims. Node refuses to start those directly, so Rampa reads the shim and runs the script it points to with Node, without cmd.exe; any other batch file runs under cmd.exe with every argument escaped.

# Rampa for coding agents (MCP)

`rampa mcp` starts a [Model Context Protocol](https://modelcontextprotocol.io) server on stdio. A coding agent such as Claude Code, Cursor, GitHub Copilot or Codex can then check the page it just edited, read each finding with its evidence and patch, fix the markup and check again.

The checks are the same as `rampa check`: axe-core first, then a model judges, one WCAG criterion at a time, what axe-core cannot decide, and a claim reaches the report only if its quoted evidence is on the page. Every result ends with the coverage of the run. Rampa never says a page is accessible, and the tools never do either.

- [Before you start](#before-you-start)
- [Set up your client](#set-up-your-client): [Claude Code](#claude-code), [Claude Desktop](#claude-desktop), [Cursor](#cursor), [VS Code with GitHub Copilot](#vs-code-with-github-copilot), [Windsurf (Devin Desktop)](#windsurf-devin-desktop), [Codex CLI](#codex-cli)
- [Server options](#server-options)
- [Tools](#tools)
- [Prompts that work well](#prompts-that-work-well)
- [Troubleshooting](#troubleshooting)

## Before you start

You need what `rampa check` needs:

- **Node.js 22.12 or later.**
- **Chrome or Edge** (or `npx playwright-core install chromium`) to check URLs and `.html` files. A snapshot `.json` needs no browser.
- **A model for the judgment layer**: Ollama with `gemma4:12b` locally, or an API key for any provider in the [README](../README.md#models). Without one, a call can still pass `no_llm: true` and get axe-core's findings.

`rampa doctor` checks all three, and `rampa models` shows which model Rampa would pick.

**Rampa is not on npm yet.** The snippets below use `npx -y rampa mcp`, which works once it is published. Until then, build a clone and point your client at it:

```sh
git clone https://github.com/guilhermebsantiago/rampa-cli.git
cd rampa-cli
pnpm install
pnpm build
```

Then, in every snippet, replace the command `npx` with `node` and the arguments `-y rampa mcp` with the absolute path of `dist/cli.mjs` followed by `mcp`:

```json
"command": "node",
"args": ["/absolute/path/to/rampa-cli/dist/cli.mjs", "mcp"]
```

On Windows, write the path as `C:/Users/you/rampa-cli/dist/cli.mjs`, or double the backslashes in JSON.

### Two things every client gets wrong at first

- **Where the server runs.** Relative paths in `target`, the `.env` file, `rampa.config.*` and the `.rampa/cache` folder are all read from the server's working directory, and each client picks a different one: Claude Code uses the folder you started it in, VS Code uses the workspace folder, and Claude Desktop may use `/` on macOS. Ask the agent for absolute paths or URLs, and put API keys in the client's `env` block rather than in a shell profile, since several clients pass only a few environment variables to the server. If the working directory is not writable, judgments are not cached; pass `--cache-dir` with an absolute folder.
- **How long a check takes.** With axe-core alone, a page takes a few seconds. With a local model, each judgment takes one to a few seconds, and a long page can have dozens of candidates. Rampa sends progress notifications while it judges, but some clients stop waiting after a fixed time: raise the tool timeout where the client has one (see [Codex CLI](#codex-cli)), or pass `no_llm: true` or fewer `criteria`.

## Set up your client

### Claude Code

```sh
claude mcp add rampa -- npx -y rampa mcp
```

The server is now available in the current project. Add `--scope user` for every project, or `--scope project` to write a `.mcp.json` the team can commit. Server options go after `mcp`, and environment variables go in `--env`, after the server's name:

```sh
claude mcp add --scope user rampa --env ANTHROPIC_API_KEY=sk-ant-... -- npx -y rampa mcp --model anthropic:claude-haiku-5-5
```

The same server in a project's `.mcp.json`, with the key taken from your environment:

```json
{
  "mcpServers": {
    "rampa": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "rampa", "mcp"],
      "env": { "ANTHROPIC_API_KEY": "${ANTHROPIC_API_KEY}" }
    }
  }
}
```

Claude Code waits about 28 hours for a tool by default, so long checks finish; a call that runs for more than two minutes moves to the background. The first `npx -y` download can take longer than the 30-second startup limit: start Claude Code with `MCP_TIMEOUT=60000` once if the server does not connect. If `npx` does not start on Windows, use `node` with the absolute path of a built clone, as above.

In Claude Code 2.1.295 the model receives the structured result, not the text, when a tool returns both; every finding, note and the coverage statement are in it.

### Claude Desktop

Open Settings, Developer, Edit Config. The file is `~/Library/Application Support/Claude/claude_desktop_config.json` on macOS and `%APPDATA%\Claude\claude_desktop_config.json` on Windows:

```json
{
  "mcpServers": {
    "rampa": {
      "command": "npx",
      "args": ["-y", "rampa", "mcp", "--cache-dir", "/Users/you/.rampa-cache"],
      "env": { "ANTHROPIC_API_KEY": "sk-ant-...", "RAMPA_MODEL": "anthropic:claude-haiku-5-5" }
    }
  }
}
```

Quit Claude Desktop completely and open it again; closing the window is not enough. The server may start in `/`, so give Rampa absolute paths and an absolute `--cache-dir`. Claude Desktop passes only a few environment variables to servers, so keys go in `env`. If `npx` is not found on Windows, use `node` with the absolute path of a built clone, as above. The server's log is `mcp-server-rampa.log` in `~/Library/Logs/Claude` or `%APPDATA%\Claude\logs`.

### Cursor

Create `.cursor/mcp.json` in the project, or `~/.cursor/mcp.json` for every project:

```json
{
  "mcpServers": {
    "rampa": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "rampa", "mcp"],
      "env": { "ANTHROPIC_API_KEY": "${env:ANTHROPIC_API_KEY}" }
    }
  }
}
```

Cursor also reads keys from a file with `"envFile": "${workspaceFolder}/.env"`. Its documentation does not say which folder the server starts in, so ask for absolute paths.

### VS Code with GitHub Copilot

Create `.vscode/mcp.json` in the workspace. The `inputs` entry asks for the key once and stores it securely:

```json
{
  "inputs": [{ "type": "promptString", "id": "anthropic-key", "description": "Anthropic API key", "password": true }],
  "servers": {
    "rampa": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "rampa", "mcp"],
      "env": { "ANTHROPIC_API_KEY": "${input:anthropic-key}" }
    }
  }
}
```

The server starts in the workspace folder, so relative paths work. VS Code also reads the portable format, `.mcp.json` at the workspace root or `~/.copilot/mcp-config.json` for the user, with `mcpServers` in place of `servers`, and its newer guides prefer it. From a terminal, this adds the server to your user profile:

```sh
code --add-mcp "{\"name\":\"rampa\",\"command\":\"npx\",\"args\":[\"-y\",\"rampa\",\"mcp\"]}"
```

Use the tools in Copilot's agent mode.

### Windsurf (Devin Desktop)

Windsurf became Devin Desktop in June 2026. For the Cascade agent, open the MCP config file from the Cascade panel (the `...` menu, Open MCP config file) and add:

```json
{
  "mcpServers": {
    "rampa": {
      "command": "npx",
      "args": ["-y", "rampa", "mcp"],
      "env": { "ANTHROPIC_API_KEY": "${env:ANTHROPIC_API_KEY}" }
    }
  }
}
```

The file has moved between releases (`~/.codeium/windsurf/mcp_config.json` in Windsurf, `~/.config/devin/mcp_config.json` or `%APPDATA%\devin\mcp_config.json` in Devin Desktop), so open it from the app. For Devin Local, the default agent in new tabs:

```sh
devin mcp add -s user rampa -- npx -y rampa mcp
```

### Codex CLI

```sh
codex mcp add rampa --env ANTHROPIC_API_KEY=sk-ant-... -- npx -y rampa mcp
```

Codex gives a tool 60 seconds by default, which a check with a model can exceed. Raise it in `~/.codex/config.toml`:

```toml
[mcp_servers.rampa]
command = "npx"
args = ["-y", "rampa", "mcp"]
env_vars = ["ANTHROPIC_API_KEY"]   # passed through from your shell
startup_timeout_sec = 60           # default 10; the first npx download is slow
tool_timeout_sec = 900             # default 60
```

## Server options

```sh
rampa mcp [--model provider:model] [--no-llm] [--offline] [--cache-dir dir] [--concurrency n] [--reasoning level] [--locale en|pt-BR]
```

| Option | Default | Effect |
| --- | --- | --- |
| `-m, --model <provider:model>` | detected | Model for calls that do not name one |
| `--no-llm` | | axe-core only, unless a call passes `no_llm: false` |
| `--offline` | | Cached judgments only; the model is never called |
| `--cache-dir <dir>` | `.rampa/cache` | Judgment cache, shared with `rampa check` |
| `--concurrency <n>` | `4` | Parallel model calls |
| `--reasoning <level>` | `none` locally | `provider-default`, `none`, `minimal`, `low`, `medium`, `high` |
| `--locale <locale>` | `en` | Language of the messages: `en` or `pt-BR` |

The model is chosen as in `rampa check`: the call's `model`, then `--model`, then `RAMPA_MODEL`, then `model` in `rampa.config.*`, then a local Ollama model, then the first provider with an API key. A call can override the model, `no_llm` and the locale; the other options belong to the server.

Nothing but protocol messages goes to stdout. The server writes one line per check to stderr, which clients keep in their MCP logs:

```text
rampa mcp: check_html inline HTML: 3 finding(s), 5 model call(s), 0 cached, 8.7 s
```

## Tools

| Tool | What it does | Needs |
| --- | --- | --- |
| `check_page` | Checks one page: a URL, an `.html` file or a snapshot `.json` | a browser for URLs and HTML; a model unless `no_llm` |
| `check_html` | Checks markup the agent has in hand, through a temporary file it deletes afterwards | a browser; a model unless `no_llm` |
| `list_criteria` | What Rampa judges, and whether axe-core, Rampa or only a person checks each of the 50 WCAG 2.1 A/AA criteria | nothing |
| `explain_finding` | The WCAG text, why a finding failed, how to fix it, and links to the W3C Understanding document and ACT rules | nothing |

All four are read-only. `check_page` and `check_html` take the same options:

| Argument | Default | Effect |
| --- | --- | --- |
| `target` (`check_page`) | required | `http(s)` or `file` URL, an `.html` file or a snapshot `.json` recorded with `rampa check --save`. One page per call |
| `html` (`check_html`) | required | A whole document or a fragment |
| `base_url` (`check_html`) | | Where relative URLs point: an `http(s)` URL, a `file` URL or an absolute folder. Without it, relative images do not load, and images that do not render are not judged |
| `criteria` | all six | Criteria to judge: `1.1.1`, `2.4.2`, `2.4.4`, `2.4.6`, `3.1.1`, `3.1.2`. axe-core checks the whole page either way |
| `model` | the server's | `provider:model`, such as `ollama:gemma4:12b` |
| `no_llm` | the server's | `true` runs only axe-core |
| `locale` | the server's | `en` or `pt-BR` |
| `runs` | `1` | Judgments per candidate, 1 to 5, majority vote |
| `min_confidence` | `medium` | Leave out findings below `low`, `medium` or `high` |
| `max_findings` | `25` | Findings to list; the rest are counted by criterion |

`explain_finding` takes `finding_id`, an id from a check in the same session, or `criterion`, such as `"2.4.4"`.

### What a check returns

Each result has a short text report and the same content as structured data. Clients differ in which of the two the model sees, so each is complete:

```json
{
  "target": "examples/store/before.html",
  "judgment": "on",
  "model": "ollama:gemma4:12b",
  "summary": { "findings": 9, "from_engine": 1, "judged": 8, "left_out": 0, "discarded_claims": 0, "not_judged": 0 },
  "coverage": {
    "statement": "This report does not declare the page accessible. What was not checked needs manual review and testing with people.",
    "checked_by_engine": ["1.1.1", "1.3.1", "1.3.5", "1.4.3", "2.4.1", "2.4.2", "2.4.4", "3.1.1", "3.1.2", "3.3.2", "4.1.2"],
    "judged": ["1.1.1", "2.4.2", "2.4.4", "2.4.6", "3.1.1", "3.1.2"],
    "not_checked": ["1.2.1", "1.2.2", "…"]
  },
  "notes": ["Suggested text alternatives describe what the model saw in the image, which cannot be verified against the page: show them to a person before they ship."],
  "usage": { "model_calls": 0, "cached_calls": 13, "estimated_cost_usd": 0 },
  "findings": [
    {
      "id": "2c1d064d9cc7",
      "criterion": "1.1.1",
      "criterion_name": "Non-text Content",
      "level": "A",
      "source": "judgment",
      "selector": "html > body > main > div > figure:nth-of-type(1) > img",
      "message": "The text alternative \"IMG_2034.jpg\" is a file name or a placeholder.",
      "evidence": "IMG_2034.jpg",
      "patch": {
        "kind": "set-attribute",
        "attribute": "alt",
        "before": "<img src=\"mug.svg\" alt=\"IMG_2034.jpg\">",
        "after": "<img src=\"mug.svg\" alt=\"Blue mug with steaming hot drink\">"
      },
      "confidence": "high",
      "agreement": { "votes": 1, "total": 1 }
    }
  ]
}
```

(Shortened.) An axe-core finding has `rule_id`, `help_url`, the element's `html` and axe-core's `how_to_fix` instead of evidence and a patch. When a page has more findings than `max_findings`, the list takes them in turns from each rule and criterion, so a rule that fails on hundreds of elements cannot push the judged findings out, and a note counts the rest.

### Errors

A problem the agent can fix comes back as a tool error that says what to do, and the server keeps running:

| Situation | The error says |
| --- | --- |
| The target does not exist | the path it looked for, the server's working directory, and to pass an absolute path, a URL or the markup |
| A folder with several pages | to pass one page per call, with examples |
| No browser | to install Chrome, Edge or Chromium or set `RAMPA_BROWSER_PATH`, or to pass a snapshot `.json` |
| No model available | how to pass one, with examples, or to pass `no_llm: true` |
| Ollama is down, or the model is not pulled | `ollama serve`, `ollama pull <model>`, or the models it has |
| A missing API key | the variable to set, and where: the server's environment |
| Every judgment failed | the model's error, and to try another model or `no_llm: true` |

## Prompts that work well

- "Check the page I just edited, `src/pages/checkout.html`, with Rampa. Fix what it finds, then check again until it reports no confirmed failures, and tell me what Rampa says it did not check."
- "Run Rampa on http://localhost:3000/pricing with `no_llm`, fix the axe-core findings, then run it again with judgment."
- "Check the HTML this component renders with `check_html`, using `base_url` http://localhost:5173/, and propose fixes. Show me the suggested alt texts before you apply them."
- "Explain Rampa finding `1af8a73e209d` and show me the patch before applying it."
- "Use `list_criteria` and tell me which WCAG criteria on this page need manual testing."
- "Verifique a página com o Rampa em português (`locale: pt-BR`) e corrija o que ele encontrar."

A suggested alt text describes what a model saw in the image, which Rampa cannot check against the page: ask the agent to show those to you before they ship. Rampa's coverage statement is part of every result; ask the agent to pass it on rather than to call the page accessible.

## Troubleshooting

- **The server does not connect.** Run `rampa mcp` (or `node dist/cli.mjs mcp`) in a terminal: it should say it is serving on stdio and wait. Run `rampa doctor` for the browser and the models. To try the tools by hand, use the MCP Inspector: `npx @modelcontextprotocol/inspector node /absolute/path/to/rampa-cli/dist/cli.mjs mcp`.
- **"Target not found".** The server resolved a relative path against its own working directory, which the error names. Pass an absolute path.
- **Every check says "No model is available".** The server found no model. Pass `--model` in the client's config, set `RAMPA_MODEL` or a provider key in its `env`, or start Ollama.
- **Checks time out.** Raise the client's tool timeout, pass `no_llm: true`, narrow `criteria`, or use a faster model.
- **A check is slow the first time and fast the next.** Judgments are cached by their input, so a page that did not change costs nothing the second time. Share the cache with `rampa check` by giving both the same `--cache-dir`.

This server was tested with the official TypeScript SDK client, raw JSON-RPC over stdio, and Claude Code 2.1.295 in headless mode on Windows. The snippets for the other clients follow each vendor's documentation as of 2026-10-08.

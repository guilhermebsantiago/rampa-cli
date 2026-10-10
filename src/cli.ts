#!/usr/bin/env node
import { Command, Option } from 'commander'
import { CONFIG_FORMATS } from './adoption/init.ts'
import { PROFILES } from './advisory/types.ts'
import { runBaseline } from './cli/commands/baseline.ts'
import { runCheck } from './cli/commands/check.ts'
import { runCompare } from './cli/commands/compare.ts'
import { runDoctor } from './cli/commands/doctor.ts'
import { runEval } from './cli/commands/eval.ts'
import { runMcp } from './cli/commands/mcp.ts'
import { runInit } from './cli/commands/init.ts'
import { runModels } from './cli/commands/models.ts'
import { runWaive, runWaivers } from './cli/commands/waivers.ts'
import { withConfigOptions } from './cli/config-options.ts'
import type { GlobalContext } from './cli/context.ts'
import { FAIL_ON, parseFailOn } from './cli/exit-code.ts'
import { intro, menu } from './cli/intro.ts'
import { browserOptions, crawlOptions } from './cli/web-options.ts'
import { loadConfig } from './config.ts'
import { DEFAULT_MAX_CANDIDATES } from './core/check.ts'
import { RampaError, errorMessage } from './core/util.ts'
import { DEFAULT_CRITERIA } from './criteria/index.ts'
import { REASONING_LEVELS } from './providers/ai-sdk.ts'
import { resolveLocale } from './i18n.ts'
import { FOLLOW_LINKS } from './surfaces/destinations.ts'
import { FORMATS } from './report/formats.ts'
import { VERSION } from './version.ts'

// API keys can live in a local .env (never in rampa.config.*).
try {
  process.loadEnvFile()
} catch {
  // no .env in the working directory
}

async function context(command: Command): Promise<GlobalContext> {
  const globals = command.optsWithGlobals<{ locale?: string; motion?: boolean }>()
  const { config } = await loadConfig()
  return {
    locale: resolveLocale(globals.locale ?? process.env.RAMPA_LOCALE ?? config.locale),
    motion: globals.motion === false ? false : config.motion,
    config,
  }
}

/** The context without the config file, for a command that must run when the file is broken. */
function bareContext(command: Command): GlobalContext {
  const globals = command.optsWithGlobals<{ locale?: string; motion?: boolean }>()
  return { locale: resolveLocale(globals.locale ?? process.env.RAMPA_LOCALE), motion: globals.motion, config: {} }
}

/** The context, and the options with the config file's values where the command line left defaults. */
async function configured<O extends object>(command: Command, options: O): Promise<[O, GlobalContext]> {
  const ctx = await context(command)
  return [withConfigOptions(command, options, ctx.config), ctx]
}

function action<A extends unknown[]>(handler: (...args: A) => Promise<number>) {
  return async (...args: A) => {
    try {
      process.exitCode = await handler(...args)
    } catch (error) {
      const message = error instanceof RampaError ? error.message : errorMessage(error)
      process.stderr.write(`\nrampa: ${message}\n`)
      if (!(error instanceof RampaError) && process.env.RAMPA_DEBUG && error instanceof Error) process.stderr.write(`${error.stack}\n`)
      process.exitCode = 2
    }
  }
}

const program = new Command()
  .name('rampa')
  .description('Accessibility checks beyond syntax: a deterministic engine plus per-criterion LLM judgment with verified evidence.')
  .version(VERSION, '-v, --version')
  .option('--locale <locale>', 'report language: en (default) or pt-BR')
  .option('--no-motion', 'skip the intro animation')
  .showHelpAfterError()
  // A usage error exits 2, like any configuration error: 1 must keep meaning "findings" for CI.
  .exitOverride((error) => process.exit(error.exitCode === 0 ? 0 : 2))
  .action(
    action(async (_options: unknown, command: Command) => {
      const ctx = await context(command)
      await intro(ctx.locale, ctx.motion)
      process.stdout.write(menu(ctx.locale))
      return 0
    }),
  )

const check = program
  .command('check')
  .description('check web pages, HTML files, folders, snapshots, Android screens, XCUITest exports or PNG screenshots')
  .argument(
    '[targets...]',
    "URLs, .html files, folders, snapshot or XCUITest .json files, UI Automator .xml dumps, .png screenshots, or android:[serial] (default: the config's targets)",
  )
  .option('-c, --criteria <ids>', 'criteria to judge, comma-separated', DEFAULT_CRITERIA.join(','))
  .option('-m, --model <provider:model>', 'model for the judgment layer, e.g. ollama:gemma4:12b')
  .option('--no-llm', 'deterministic layer only (the baseline)')
  .option('-r, --runs <k>', 'judgments per candidate, majority vote', '1')
  .addOption(new Option('--wcag <version>', 'WCAG version to state coverage against: 2.2 (default) or 2.1').choices(['2.1', '2.2']).default('2.2'))
  .addOption(new Option('-f, --format <format>', 'output format').choices([...FORMATS]).default('pretty'))
  .option('-o, --output <file>', 'write the report to a file instead of the terminal; with pretty, the file gets JSON')
  .option('--json <file>', 'also write the JSON report to a file')
  .option('--sarif <file>', 'also write a SARIF 2.1.0 report (GitHub code scanning)')
  .option('--markdown <file>', 'also write a Markdown report (pull request comments)')
  .option('--html <file>', 'also write a single-file HTML report')
  .addOption(
    new Option('--fail-on <policy>', 'exit 1 on: confirmed findings, any finding, Level A ones, Level A or AA ones, confirmed findings or advisories, or none')
      .choices([...FAIL_ON])
      .argParser(parseFailOn)
      .default('confirmed'),
  )
  .addOption(new Option('--min-confidence <level>', 'hide findings below this level').choices(['low', 'medium', 'high']).default('medium'))
  .addOption(new Option('--reasoning <level>', 'model reasoning effort (local models default to none)').choices([...REASONING_LEVELS]))
  .option('--offline', 'use cached judgments only, never call the model')
  .option('--screenshots', 'save full-page screenshots to .rampa/screenshots')
  .option('--save <dir>', 'record each snapshot and its engine results, to check later without a browser or a device')
  .option('--cache-dir <dir>', 'judgment cache directory', '.rampa/cache')
  .option('--concurrency <n>', 'parallel model calls', '4')
  .option('--max-candidates <n>', 'judge at most n candidates per criterion and page, generic texts first; the rest are reported as not judged (0: no cap)', String(DEFAULT_MAX_CANDIDATES))
  .option('--time-limit <seconds>', 'stop asking the model this many seconds after a page starts loading, and report what was judged by then (default: no limit)')
  .option('--verbose', 'list discarded claims, low-confidence findings and unchecked criteria')
  .addOption(
    new Option('--follow-links <policy>', "read where links lead, to compare them with their text (2.4.4); same-origin reads a local page's local files")
      .choices([...FOLLOW_LINKS])
      .default('same-origin'),
  )
  .option('--probe <kinds>', 'drive web pages after collection: layout, keyboard, hover, orientation, shortcuts, media, color, all or none (default: none; docs/probes.md)')
  .option('--baseline <file>', 'report only the findings this baseline file does not have (rampa baseline writes it)')
  .option('--no-baseline', 'ignore the baseline set in the config')
  .addOption(
    new Option('--profile <name>', 'also run advisory checks beyond WCAG: cognitive (W3C COGA guidance; advisories, never WCAG failures)').choices([...PROFILES]),
  )
  .action(action(async (targets: string[], options, command: Command) => runCheck(targets, ...(await configured(command, options)))))
// Crawl and browser options live with their modules; --help lists them under their own headings.
for (const option of [...crawlOptions(), ...browserOptions()]) check.addOption(option)

const collect = (value: string, previous: string[] = []) => [...previous, value]

program
  .command('init')
  .description('set up Rampa in a project: config, waivers file, .gitignore and, with --github, a CI workflow')
  .option('--targets <list>', 'pages to check, comma-separated: URLs, .html files or folders (default: a build folder with HTML)')
  .option('-m, --model <provider:model>', 'pin a model in the config (default: none, so each machine picks one)')
  .option('-c, --criteria <ids>', 'criteria to judge, comma-separated (default: all six)')
  .addOption(new Option('--min-confidence <level>', 'hide findings below this level').choices(['low', 'medium', 'high']))
  .option('--github', 'also write .github/workflows/rampa.yml, which runs the Rampa action')
  .addOption(new Option('--config-format <format>', 'config file type (default: ts, or what this Node and package can load)').choices([...CONFIG_FORMATS]))
  .option('-y, --yes', 'never ask: use the flags and what was detected')
  .option('--force', 'overwrite an existing config and workflow (never the waivers)')
  .option('--no-detect', 'do not look for local model servers')
  // A config that does not load must not stop init, which can write one that does.
  .action(action(async (options, command: Command) => runInit(options, await context(command).catch(() => bareContext(command)))))

program
  .command('waive')
  .description('accept one finding on purpose, with a reason and an optional expiry date')
  .argument('<id>', 'the finding id (its fingerprint), as the report shows it')
  .requiredOption('--reason <text>', 'why the finding is acceptable')
  .option('--expires <date>', 'last day the waiver applies, as YYYY-MM-DD')
  .option('--file <path>', "waivers file (default: the config's, else .rampa/waivers.json)")
  .option('--report <file>', 'JSON report from rampa check -o to record what the finding is; repeatable', collect)
  .action(action(async (id: string, options, command: Command) => runWaive(id, options, await context(command))))

program
  .command('waivers')
  .description('list the waivers and flag the expired and unused ones')
  .option('--file <path>', "waivers file (default: the config's, else .rampa/waivers.json)")
  .option('--report <file>', 'JSON report from rampa check -o, to flag waivers no finding needs; repeatable', collect)
  .option('--prune', 'remove the expired waivers from the file')
  .addOption(new Option('-f, --format <format>', 'output format').choices(['pretty', 'json']).default('pretty'))
  .action(action(async (options, command: Command) => runWaivers(options, await context(command))))

program
  .command('baseline')
  .description('record the current findings, so rampa check --baseline reports only new ones')
  .argument('[targets...]', "URLs, .html files, folders or snapshot .json files (default: the config's targets)")
  .option('-o, --out <file>', "baseline file (default: the config's baseline, else .rampa/baseline.json)")
  .option('-c, --criteria <ids>', 'criteria to judge, comma-separated', DEFAULT_CRITERIA.join(','))
  .option('-m, --model <provider:model>', 'model for the judgment layer; use the one CI uses')
  .option('--no-llm', 'record engine findings only')
  .option('-r, --runs <k>', 'judgments per candidate, majority vote', '1')
  .addOption(new Option('--wcag <version>', 'WCAG version to state coverage against: 2.2 (default) or 2.1').choices(['2.1', '2.2']).default('2.2'))
  .addOption(new Option('--reasoning <level>', 'model reasoning effort (local models default to none)').choices([...REASONING_LEVELS]))
  .option('--offline', 'use cached judgments only, never call the model')
  .option('--cache-dir <dir>', 'judgment cache directory', '.rampa/cache')
  .option('--concurrency <n>', 'parallel model calls', '4')
  .action(action(async (targets: string[], options, command: Command) => runBaseline(targets, ...(await configured(command, options)))))

program
  .command('eval')
  .description('measure the baseline and the judgment layer against W3C ACT test cases and corrupted pairs')
  .option('-c, --criteria <ids>', 'criteria to evaluate, comma-separated', DEFAULT_CRITERIA.join(','))
  .option('--rules <ids>', 'instead of criteria, Rampa rules to measure against their ACT test cases, with no model (meta-viewport,refresh-header)')
  .option('-m, --model <provider:model>', 'model for the judgment layer')
  .option('--no-llm', 'measure the deterministic baseline only')
  .option('--no-pairs', 'skip the corrupted pairs')
  .option('--no-verify', 'ablation: keep model claims that fail verification')
  .option('-r, --runs <k>', 'judgments per candidate, majority vote', '1')
  .option('--limit <n>', 'evaluate at most n test cases (smoke test)')
  .addOption(new Option('--wcag <version>', 'WCAG version to state coverage against: 2.2 (default) or 2.1').choices(['2.1', '2.2']).default('2.2'))
  .addOption(new Option('--reasoning <level>', 'model reasoning effort').choices([...REASONING_LEVELS]))
  .option('--offline', 'use cached judgments only')
  .option('--refresh', 'download the ACT test cases again')
  .option('--cache-dir <dir>', 'judgment cache directory', '.rampa/cache')
  .option('--out-dir <dir>', 'where runs are written', '.rampa/runs')
  .option('--concurrency <n>', 'pages evaluated in parallel', '4')
  .addOption(
    new Option('--follow-links <policy>', 'read where links lead (2.4.4); same-origin reaches only the W3C host of the test pages')
      .choices([...FOLLOW_LINKS])
      .default('same-origin'),
  )
  .action(action(async (options, command: Command) => runEval(options, await context(command))))

program
  .command('compare')
  .description('compare rampa eval runs per criterion: scores with intervals, pairs, cost, and a paired test for two runs')
  .argument('<runs...>', 'run directories written by rampa eval, such as .rampa/runs/<run>')
  .option('--markdown [file]', 'Markdown tables instead of the terminal view, or written to a file')
  .option('--json [file]', 'the comparison as JSON instead of the terminal view, or written to a file')
  .action(action(async (runs: string[], options) => runCompare(runs, options)))

program
  .command('models')
  .description('recommended models per criterion and what is ready on this machine')
  .option('--default', 'print only the model rampa check would use without --model; exit 1 when there is none')
  .action(action(async (options, command: Command) => runModels(options, await context(command))))

program
  .command('doctor')
  .description('check Node, the browser, axe-core, local model servers and provider credentials')
  .action(action(async (_options, command: Command) => runDoctor(await context(command))))

program
  .command('mcp')
  .description('serve Rampa to coding agents over the Model Context Protocol, on stdio')
  .option('-m, --model <provider:model>', 'default model for the judgment layer; a tool call can name another')
  .option('--no-llm', 'deterministic layer only by default; a tool call can turn judgment back on')
  .addOption(new Option('--wcag <version>', 'default WCAG version to state coverage against: 2.2 or 2.1; a tool call can name the other').choices(['2.1', '2.2']).default('2.2'))
  .addOption(new Option('--reasoning <level>', 'model reasoning effort (local models default to none)').choices([...REASONING_LEVELS]))
  .option('--offline', 'use cached judgments only, never call the model')
  .option('--cache-dir <dir>', 'judgment cache directory', '.rampa/cache')
  .option('--concurrency <n>', 'parallel model calls', '4')
  .action(action(async (options, command: Command) => runMcp(options, await context(command))))

await program.parseAsync()

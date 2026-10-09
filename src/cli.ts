#!/usr/bin/env node
import { Command, Option } from 'commander'
import { CONFIG_FORMATS } from './adoption/init.ts'
import { runBaseline } from './cli/commands/baseline.ts'
import { runCheck } from './cli/commands/check.ts'
import { runDoctor } from './cli/commands/doctor.ts'
import { runEval } from './cli/commands/eval.ts'
import { runInit } from './cli/commands/init.ts'
import { runModels } from './cli/commands/models.ts'
import { runWaive, runWaivers } from './cli/commands/waivers.ts'
import { withConfigOptions } from './cli/config-options.ts'
import type { GlobalContext } from './cli/context.ts'
import { intro, menu } from './cli/intro.ts'
import { loadConfig } from './config.ts'
import { RampaError, errorMessage } from './core/util.ts'
import { DEFAULT_CRITERIA } from './criteria/index.ts'
import { REASONING_LEVELS } from './providers/ai-sdk.ts'
import { resolveLocale } from './i18n.ts'
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
  .action(
    action(async (_options: unknown, command: Command) => {
      const ctx = await context(command)
      await intro(ctx.locale, ctx.motion)
      process.stdout.write(menu(ctx.locale))
      return 0
    }),
  )

program
  .command('check')
  .description('check web pages, HTML files, folders or snapshot .json files')
  .argument('[targets...]', "URLs, .html files, folders or snapshot .json files (default: the config's targets)")
  .option('-c, --criteria <ids>', 'criteria to judge, comma-separated', DEFAULT_CRITERIA.join(','))
  .option('-m, --model <provider:model>', 'model for the judgment layer, e.g. ollama:gemma4:12b')
  .option('--no-llm', 'deterministic layer only (the baseline)')
  .option('-r, --runs <k>', 'judgments per candidate, majority vote', '1')
  .addOption(new Option('-f, --format <format>', 'output format').choices(['pretty', 'json']).default('pretty'))
  .option('-o, --output <file>', 'also write the JSON report to a file')
  .addOption(new Option('--fail-on <policy>', 'exit code policy').choices(['confirmed', 'any', 'never']).default('confirmed'))
  .addOption(new Option('--min-confidence <level>', 'hide findings below this level').choices(['low', 'medium', 'high']).default('medium'))
  .addOption(new Option('--reasoning <level>', 'model reasoning effort (local models default to none)').choices([...REASONING_LEVELS]))
  .option('--offline', 'use cached judgments only, never call the model')
  .option('--screenshots', 'save full-page screenshots to .rampa/screenshots')
  .option('--save <dir>', 'record each snapshot and its engine results, to check later without a browser')
  .option('--cache-dir <dir>', 'judgment cache directory', '.rampa/cache')
  .option('--concurrency <n>', 'parallel model calls', '4')
  .option('--verbose', 'list discarded claims, low-confidence findings and unchecked criteria')
  .option('--baseline <file>', 'report only the findings this baseline file does not have (rampa baseline writes it)')
  .option('--no-baseline', 'ignore the baseline set in the config')
  .action(action(async (targets: string[], options, command: Command) => runCheck(targets, ...(await configured(command, options)))))

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
  .addOption(new Option('--reasoning <level>', 'model reasoning effort (local models default to none)').choices([...REASONING_LEVELS]))
  .option('--offline', 'use cached judgments only, never call the model')
  .option('--cache-dir <dir>', 'judgment cache directory', '.rampa/cache')
  .option('--concurrency <n>', 'parallel model calls', '4')
  .action(action(async (targets: string[], options, command: Command) => runBaseline(targets, ...(await configured(command, options)))))

program
  .command('eval')
  .description('measure the baseline and the judgment layer against W3C ACT test cases and corrupted pairs')
  .option('-c, --criteria <ids>', 'criteria to evaluate, comma-separated', DEFAULT_CRITERIA.join(','))
  .option('-m, --model <provider:model>', 'model for the judgment layer')
  .option('--no-llm', 'measure the deterministic baseline only')
  .option('--no-pairs', 'skip the corrupted pairs')
  .option('--no-verify', 'ablation: keep model claims that fail verification')
  .option('-r, --runs <k>', 'judgments per candidate, majority vote', '1')
  .option('--limit <n>', 'evaluate at most n test cases (smoke test)')
  .addOption(new Option('--reasoning <level>', 'model reasoning effort').choices([...REASONING_LEVELS]))
  .option('--offline', 'use cached judgments only')
  .option('--refresh', 'download the ACT test cases again')
  .option('--cache-dir <dir>', 'judgment cache directory', '.rampa/cache')
  .option('--out-dir <dir>', 'where runs are written', '.rampa/runs')
  .option('--concurrency <n>', 'pages evaluated in parallel', '4')
  .action(action(async (options, command: Command) => runEval(options, await context(command))))

program
  .command('models')
  .description('recommended models per criterion and what is ready on this machine')
  .option('--default', 'print only the model rampa check would use without --model; exit 1 when there is none')
  .action(action(async (options, command: Command) => runModels(options, await context(command))))

program
  .command('doctor')
  .description('check Node, the browser, axe-core, local model servers and provider credentials')
  .action(action(async (_options, command: Command) => runDoctor(await context(command))))

await program.parseAsync()

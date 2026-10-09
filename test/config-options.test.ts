import { Command } from 'commander'
import { describe, expect, it } from 'vitest'
import { withConfigOptions } from '../src/cli/config-options.ts'

function parse(args: string[]) {
  const command = new Command()
    .exitOverride()
    .option('-c, --criteria <ids>', 'criteria', '1.1.1,2.4.2')
    .option('--min-confidence <level>', 'level', 'medium')
    .option('-r, --runs <k>', 'runs', '1')
    .option('--cache-dir <dir>', 'cache', '.rampa/cache')
  command.parse(args, { from: 'user' })
  return { command, options: command.opts<{ criteria: string; minConfidence: string; runs: string; cacheDir: string }>() }
}

describe('config file options', () => {
  it('apply where the command line left a default, and the command line wins', () => {
    const config = { criteria: ['3.1.2', '3.1.1'], minConfidence: 'high' as const, runs: 3, cacheDir: '.cache/rampa', concurrency: 2 }
    const { command, options } = parse(['--runs', '5'])
    expect(withConfigOptions(command, options, config)).toEqual({ criteria: '3.1.2,3.1.1', minConfidence: 'high', runs: '5', cacheDir: '.cache/rampa' })
  })

  it('leave the defaults when the config says nothing', () => {
    const { command, options } = parse([])
    expect(withConfigOptions(command, options, {})).toEqual({ criteria: '1.1.1,2.4.2', minConfidence: 'medium', runs: '1', cacheDir: '.rampa/cache' })
  })
})

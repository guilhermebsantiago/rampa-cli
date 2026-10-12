#!/usr/bin/env node
/**
 * The `rampa` command. Everything else loads from here with a dynamic import, so that an error while the modules load
 * (a broken install, a dependency that throws on import), or one nothing else caught, exits 2 like any error that is not
 * a finding: Node's own exit code for an uncaught error is 1, which CI reads as "findings".
 */

function crash(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error)
  process.stderr.write(`\nrampa: ${message}\n`)
  if (process.env.RAMPA_DEBUG && error instanceof Error && error.stack) process.stderr.write(`${error.stack}\n`)
  process.exit(2)
}

// An unhandled rejection reaches this handler too, as Node raises it as an uncaught exception.
process.on('uncaughtException', crash)

try {
  await import('./cli/main.ts')
} catch (error) {
  crash(error)
}

// Preloaded with --import by test/cli-entry.test.ts: src/version.ts, which every command loads, throws as it is
// evaluated, the way a broken install or a dependency that fails on import would.
import { registerHooks } from 'node:module'

registerHooks({
  load(url, context, nextLoad) {
    if (url.endsWith('/src/version.ts')) return { format: 'module', source: 'export const VERSION = "0"; throw new Error("a module failed to load")', shortCircuit: true }
    return nextLoad(url, context)
  },
})

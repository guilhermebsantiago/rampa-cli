import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { fileCache } from '../src/core/cache.ts'
import { checkSnapshot } from '../src/core/check.ts'
import { DEFAULT_CRITERIA, resolveCriteria } from '../src/criteria/index.ts'
import { emptyEngine } from '../src/engine/axe.ts'
import { providerIdentity } from '../src/providers/ai-sdk.ts'
import { loadEngineFor, loadSnapshot } from '../src/surfaces/targets.ts'

// The recorded demo replays its judgments from a cache keyed by the exact prompts. A prompt
// that changes, on purpose or not, shows up here as a miss; if the change is on purpose,
// bump the criterion's version and record the demo again (demo/README.md).
const dir = 'demo/recorded'

describe('the recorded demo', () => {
  for (const file of readdirSync(dir).filter((name) => name.endsWith('.snapshot.json'))) {
    it(`replays ${file} from its cache, without a model`, async () => {
      const path = join(dir, file)
      const report = await checkSnapshot(await loadSnapshot(path), (await loadEngineFor(path)) ?? emptyEngine(), {
        criteria: resolveCriteria(DEFAULT_CRITERIA),
        llm: true,
        provider: {
          ...providerIdentity('ollama:gemma4:12b'),
          judge() {
            throw new Error('offline')
          },
        },
        runs: 1,
        cache: fileCache(join(dir, 'cache')),
        offline: true,
        locale: 'en',
        minConfidence: 'medium',
        concurrency: 4,
      })
      const misses = report.criteria.reduce((total, criterion) => total + criterion.offlineMisses, 0)
      expect(misses, 'a prompt changed for a recorded page').toBe(0)
      expect(report.usage.cachedCalls).toBeGreaterThan(0)
    })
  }
})

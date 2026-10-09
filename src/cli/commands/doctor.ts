import { createRequire } from 'node:module'
import { errorMessage } from '../../core/util.ts'
import { chooseModel, detectEnvironment } from '../../providers/detect.ts'
import { hasGoogleAdc, lmStudioUrl, ollamaUrl } from '../../providers/registry.ts'
import { colorsEnabled, paint } from '../../report/color.ts'
import { adbVersion } from '../../surfaces/android/adb.ts'
import { launchBrowser } from '../../surfaces/web.ts'
import { VERSION } from '../../version.ts'
import type { GlobalContext } from '../context.ts'

const require = createRequire(import.meta.url)

export async function runDoctor(context: GlobalContext): Promise<number> {
  const p = paint(colorsEnabled())
  const ok = (label: string, detail: string) => console.log(`  ${p.green('✓')} ${label.padEnd(22)} ${detail}`)
  const bad = (label: string, detail: string) => console.log(`  ${p.red('✗')} ${label.padEnd(22)} ${detail}`)
  const info = (label: string, detail: string) => console.log(`  ${p.yellow('•')} ${label.padEnd(22)} ${detail}`)
  let failures = 0

  console.log(`\n  ${p.bold(`rampa ${VERSION} doctor`)}\n`)

  const [major = 0, minor = 0] = process.versions.node.split('.').map(Number)
  if (major > 22 || (major === 22 && minor >= 12)) ok('Node.js', process.versions.node)
  else {
    bad('Node.js', `${process.versions.node} (needs 22.12 or newer)`)
    failures++
  }

  try {
    const axe = require('axe-core/package.json') as { version: string }
    ok('axe-core', axe.version)
  } catch (error) {
    bad('axe-core', errorMessage(error))
    failures++
  }

  try {
    const browser = await launchBrowser()
    ok('Browser', `${browser.browserType().name()} ${browser.version()}`)
    await browser.close()
  } catch (error) {
    bad('Browser', errorMessage(error))
    failures++
  }

  const adb = await adbVersion()
  if (adb) ok('adb', `platform-tools ${adb} (for android: targets)`)
  else info('adb', 'not found (optional, for android: targets; see docs/android.md)')

  const env = await detectEnvironment()
  if (env.ollama.reachable) {
    ok('Ollama', env.ollama.models.length > 0 ? env.ollama.models.join(', ') : 'running, no models pulled (try: ollama pull gemma4:12b)')
  } else info('Ollama', `not reachable at ${ollamaUrl()} (optional, for local models)`)
  if (env.lmStudio.reachable) {
    ok('LM Studio', env.lmStudio.models.length > 0 ? env.lmStudio.models.join(', ') : `running at ${lmStudioUrl()}, no model loaded`)
  }

  const api = env.providers.filter((provider) => provider.where === 'api')
  for (const provider of api.filter((candidate) => candidate.ready)) {
    let detail = provider.set.join(', ')
    if ((provider.id === 'vertex' || provider.id === 'vertex-anthropic') && !process.env.GOOGLE_VERTEX_API_KEY) {
      detail += hasGoogleAdc() ? ' · Application Default Credentials' : ' · no Application Default Credentials found (gcloud auth application-default login)'
    }
    ok(provider.name, detail)
  }
  for (const provider of api.filter((candidate) => !candidate.ready && candidate.set.length > 0)) {
    info(provider.name, `needs ${provider.missing.join(' and ')}`)
  }
  if (!api.some((provider) => provider.ready)) {
    info('API providers', 'none configured (optional with a local model); rampa models lists them')
  }

  const model = await chooseModel(undefined, context.config.model)
  if (model) ok('Model', `${model} ${p.dim('(when --model is not given)')}`)
  else info('Model', 'none available: rampa check will run only the deterministic layer')
  console.log('')
  return failures > 0 ? 1 : 0
}

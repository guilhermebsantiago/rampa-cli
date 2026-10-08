import { createRequire } from 'node:module'
import { errorMessage } from '../../core/util.ts'
import { KEY_VARS, detectEnvironment } from '../../providers/detect.ts'
import { colorsEnabled, paint } from '../../report/color.ts'
import { launchBrowser } from '../../surfaces/web.ts'
import { VERSION } from '../../version.ts'

const require = createRequire(import.meta.url)

export async function runDoctor(): Promise<number> {
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

  const env = await detectEnvironment()
  if (env.ollama.reachable) {
    ok('Ollama', env.ollama.models.length > 0 ? env.ollama.models.join(', ') : 'running, no models pulled (try: ollama pull gemma4:12b)')
  } else info('Ollama', 'not reachable on localhost:11434 (optional, for local models)')

  const keys = KEY_VARS.filter((name) => env.keys[name])
  if (keys.length > 0) ok('API keys', keys.join(', '))
  else info('API keys', 'none set (optional if you use Ollama)')

  if (!env.ollama.reachable && keys.length === 0) {
    info('Judgment layer', 'no model available: rampa check will run only the deterministic layer')
  }
  console.log('')
  return failures > 0 ? 1 : 0
}

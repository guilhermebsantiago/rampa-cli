import { chooseModel, detectEnvironment } from '../../providers/detect.ts'
import { type ModelInfo, PRICES_AS_OF, RECOMMENDED } from '../../providers/models.ts'
import { PROVIDERS } from '../../providers/registry.ts'
import { colorsEnabled, paint } from '../../report/color.ts'
import type { GlobalContext } from '../context.ts'

const providerOf = (spec: string) => spec.slice(0, spec.indexOf(':'))
const NAME_WIDTH = 20
const SPEC_WIDTH = 36

export async function runModels(options: { default?: boolean }, context: GlobalContext): Promise<number> {
  if (options.default) {
    const spec = await chooseModel(undefined, context.config.model)
    if (spec) console.log(spec)
    return spec ? 0 : 1
  }
  const p = paint(colorsEnabled())
  const env = await detectEnvironment()
  const status = new Map(env.providers.map((provider) => [provider.id, provider]))

  const ready = (model: ModelInfo) => {
    const provider = providerOf(model.spec)
    const name = model.spec.slice(provider.length + 1)
    if (provider === 'ollama') return env.ollama.models.includes(name)
    if (provider === 'lmstudio') return env.lmStudio.models.includes(name)
    return status.get(provider)?.ready ?? false
  }
  const line = (mark: string, name: string, spec: string, rest: string) =>
    console.log(`  ${mark} ${name.padEnd(NAME_WIDTH)}${p.cyan(spec.padEnd(SPEC_WIDTH))} ${rest}`)

  console.log(`\n  ${p.bold('Models')} ${p.dim(`USD per 1M tokens in / out, as of ${PRICES_AS_OF}`)}\n`)
  for (const provider of PROVIDERS) {
    const state = status.get(provider.id)
    const needs = state && !state.ready && state.missing.length > 0 ? p.dim(`needs ${state.missing.join(' and ')}`) : ''
    const models = RECOMMENDED.filter((model) => providerOf(model.spec) === provider.id)
    if (models.length === 0) {
      const mark = state?.ready ? p.green('●') : p.gray('○')
      line(mark, provider.name, `${provider.id}:${provider.example}`, needs || p.dim('any model it serves'))
      continue
    }
    models.forEach((model, index) => {
      const price = model.where === 'local' ? 'local' : `${model.input} / ${model.output}`
      const vision = model.vision === undefined ? 'vision ?' : model.vision ? 'vision' : 'text only'
      const note = index === 0 && needs ? needs : p.dim(model.role)
      line(ready(model) ? p.green('●') : p.gray('○'), index === 0 ? provider.name : '', model.spec, `${price.padEnd(13)}${vision.padEnd(11)}${note}`)
    })
  }
  console.log(`\n  ${p.green('●')} ready here   ${p.gray('○')} needs credentials, ollama pull or a loaded model`)
  console.log('  Choose with --model provider:model, RAMPA_MODEL or the config file. 1.1.1 and 1.4.5 need vision.')
  console.log(p.dim('  The model per criterion should come from rampa eval, not from generic benchmarks.\n'))
  return 0
}

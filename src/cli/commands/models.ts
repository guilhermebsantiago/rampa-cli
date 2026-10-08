import { detectEnvironment } from '../../providers/detect.ts'
import { PRICES_AS_OF, RECOMMENDED } from '../../providers/models.ts'
import { colorsEnabled, paint } from '../../report/color.ts'

export async function runModels(): Promise<number> {
  const p = paint(colorsEnabled())
  const env = await detectEnvironment()
  console.log(`\n  ${p.bold('Recommended models')} ${p.dim(`(prices in USD per 1M tokens, as of ${PRICES_AS_OF})`)}\n`)
  const width = Math.max(...RECOMMENDED.map((m) => m.spec.length)) + 2
  for (const model of RECOMMENDED) {
    const price = model.where === 'local' ? 'local, no API cost' : `${model.input} in / ${model.output} out`
    const vision = model.vision === undefined ? 'vision ?' : model.vision ? 'vision' : 'text only'
    const available =
      model.where === 'local'
        ? env.ollama.models.includes(model.spec.slice('ollama:'.length))
        : model.spec.startsWith('anthropic:')
          ? env.keys.ANTHROPIC_API_KEY
          : model.spec.startsWith('openai:')
            ? env.keys.OPENAI_API_KEY
            : env.keys.GOOGLE_GENERATIVE_AI_API_KEY || env.keys.GEMINI_API_KEY
    const mark = available ? p.green('●') : p.gray('○')
    console.log(`  ${mark} ${p.cyan(model.spec.padEnd(width))}${price.padEnd(22)}${vision.padEnd(11)}${p.dim(model.role)}`)
  }
  console.log(`\n  ${p.green('●')} ready on this machine   ${p.gray('○')} needs an API key or ollama pull`)
  console.log(`  Use one with: rampa check <target> --model ${RECOMMENDED[0]?.spec}`)
  console.log(p.dim('  The final recommendation per criterion comes from rampa eval, not from generic benchmarks.\n'))
  return 0
}

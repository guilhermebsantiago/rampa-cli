// Mostra o que o núcleo do Rampa enxerga: a árvore normalizada de um snapshot.
// Uso: node demo/snapshot-summary.mjs demo/recorded/examples-store-before.snapshot.json
import { readFileSync } from 'node:fs'

const snapshot = JSON.parse(readFileSync(process.argv[2], 'utf8'))
const bold = (text) => (process.stdout.isTTY ? `\x1b[1m${text}\x1b[22m` : text)
const dim = (text) => (process.stdout.isTTY ? `\x1b[2m${text}\x1b[22m` : text)

console.log(bold(`superfície: ${snapshot.surface} · alvo: ${snapshot.target} · idioma: ${snapshot.locale}`))
console.log(dim('papel ARIA · nome acessível · idioma declarado · imagem renderizada (é tudo que os critérios leem)\n'))

let lines = 0
const walk = (node, depth) => {
  const relevant = node.role !== 'generic' || node.name || node.lang
  if (depth > 0 && relevant && lines < 24) {
    const parts = [node.role]
    if (node.name) parts.push(`"${node.name.length > 48 ? `${node.name.slice(0, 47)}…` : node.name}"`)
    if (node.lang) parts.push(`lang=${node.lang}`)
    if (node.image) parts.push(dim(`[imagem ${Math.round((node.image.length * 3) / 4 / 1024)} KB]`))
    console.log(`${'  '.repeat(Math.min(depth - 1, 5))}${parts.join('  ')}`)
    lines++
  }
  for (const child of node.children) walk(child, depth + 1)
}
walk(snapshot.root, 0)

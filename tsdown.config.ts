import { defineConfig } from 'tsdown'

export default defineConfig({
  // src/eval/index.ts is for bench/ and other evaluation scripts, not a public entry (see the file).
  entry: ['src/cli.ts', 'src/index.ts', 'src/playwright.ts', 'src/puppeteer.ts', 'src/eval/index.ts'],
  format: 'esm',
  platform: 'node',
  target: 'node22',
  fixedExtension: true,
  dts: true,
  clean: true,
})

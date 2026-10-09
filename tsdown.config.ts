import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['src/cli.ts', 'src/index.ts', 'src/playwright.ts', 'src/puppeteer.ts'],
  format: 'esm',
  platform: 'node',
  target: 'node22',
  fixedExtension: true,
  dts: true,
  clean: true,
})

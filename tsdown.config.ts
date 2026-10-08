import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['src/cli.ts', 'src/index.ts'],
  format: 'esm',
  platform: 'node',
  target: 'node22',
  fixedExtension: true,
  dts: true,
  clean: true,
})

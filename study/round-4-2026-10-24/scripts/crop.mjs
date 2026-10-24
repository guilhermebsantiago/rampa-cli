// Crops part of a PNG (a page screenshot) so a judge can look at it: node crop.mjs <in.png> <x> <y> <width> <height> <out.png>
// Coordinates are CSS pixels of the page, as in the snapshot's bounds; the screenshot is taken at 1280 px wide.
import { readFileSync, writeFileSync } from 'node:fs'
import { PNG } from 'pngjs'

const [, , input, ...rest] = process.argv
const [x, y, width, height] = rest.slice(0, 4).map((v) => Math.max(0, Math.round(Number(v))))
const output = rest[4]
const png = PNG.sync.read(readFileSync(input))
const w = Math.min(width, png.width - x)
const h = Math.min(height, png.height - y)
if (w <= 0 || h <= 0) {
  console.error(`out of the image (${png.width}x${png.height})`)
  process.exit(1)
}
const out = new PNG({ width: w, height: h })
PNG.bitblt(png, out, x, y, w, h, 0, 0)
writeFileSync(output, PNG.sync.write(out))
console.log(`${output}: ${w}x${h} from a ${png.width}x${png.height} image`)

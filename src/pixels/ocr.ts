import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { type PixelRect, type RgbaImage, encodePng } from './png.ts'

/**
 * Optical character recognition on a captured picture, for 1.4.5 Images of Text: which words are drawn in it, and
 * how much of the picture they make up. It runs locally with tesseract.js and its bundled English model
 * (`@tesseract.js-data/eng`, the 4.0.0 "best int" LSTM data), never reaching the network: the language data is read
 * from the package, not from a CDN, and nothing is written to the working directory. Both packages are optional
 * dependencies; without them `openOcr` returns undefined and 1.4.5 says so.
 *
 * English data reads the Latin alphabet; Portuguese and Spanish words come out without some accents, which the
 * comparison with a model's transcription ignores. Other scripts are not read.
 */

export const OCR_ENGINE = 'tesseract.js 7.0.0, eng 4.0.0_best_int'

export interface OcrWord {
  text: string
  /** Tesseract's confidence, 0 to 100. */
  confidence: number
  /** In the picture's own pixels. */
  box: PixelRect
  /** Edge pixels of the picture inside the word's box (padded for outlines and shadows), each counted for one word only. */
  detail: number
}

export interface OcrReading {
  /** Words read with confidence 60 or more and at least two letters, in reading order. */
  words: OcrWord[]
  /** Edge pixels of the whole picture: where its colour changes sharply, as at the strokes of letters or the texture of a photo. */
  detail: number
}

/** A word read with less confidence is noise more often than text: photos give fragments such as "nr" at 20 or 30. */
const MIN_CONFIDENCE = 60
/** A channel step this large between neighbouring pixels is an edge; JPEG noise and soft gradients stay below it. */
const EDGE_STEP = 48
/** Tesseract reads text best with letters 20 px tall or more: small pictures are enlarged up to four times first. */
const TARGET_HEIGHT = 120
const MAX_SCALE = 4
/** Larger pictures are not read: a capture this size is a page section, not an image. */
const MAX_PIXELS = 4_000_000

export interface OcrSession {
  read(image: RgbaImage): Promise<OcrReading | undefined>
  close(): Promise<void>
}

type TesseractModule = typeof import('tesseract.js')

/**
 * Starts an OCR worker, or returns undefined when tesseract.js or its English data is not installed (they are
 * optional dependencies) or cannot start. One worker reads one picture at a time; close it when done.
 */
export async function openOcr(): Promise<OcrSession | undefined> {
  let tesseract: TesseractModule
  let langPath: string
  let workerPath: URL
  try {
    const loaded = (await import('tesseract.js')) as TesseractModule & { default?: TesseractModule }
    tesseract = loaded.default ?? loaded
    const require = createRequire(import.meta.url)
    langPath = join(dirname(require.resolve('@tesseract.js-data/eng/package.json')), '4.0.0_best_int')
    workerPath = quietWorker(join(dirname(require.resolve('tesseract.js')), 'worker-script', 'node', 'index.js'))
  } catch {
    return undefined
  }
  let worker: Awaited<ReturnType<TesseractModule['createWorker']>>
  try {
    // LSTM only (OEM 1), the data read from the package and never cached to disk.
    const options = { langPath, workerPath: workerPath as unknown as string, cacheMethod: 'none', gzip: true, logger: () => undefined, errorHandler: () => undefined }
    worker = await tesseract.createWorker('eng', 1, options)
    // Tesseract's own messages ("Estimating resolution as …") go nowhere.
    await worker.setParameters({ debug_file: '/dev/null' })
  } catch {
    return undefined
  }
  return {
    async read(image) {
      if (image.width < 4 || image.height < 4) return { words: [], detail: 0 }
      const flat = flattened(image)
      const scale = scaleFor(flat)
      if (flat.width * flat.height * scale * scale > MAX_PIXELS) return undefined
      const png = encodePng(upscale(flat, scale))
      const found: Array<Omit<OcrWord, 'detail'>> = []
      // Automatic layout first, then sparse text, which finds words a layout pass misses, such as a label on a button.
      for (const mode of ['3', '11'] as const) {
        await worker.setParameters({ tessedit_pageseg_mode: mode as never })
        const { data } = await worker.recognize(png, {}, { blocks: true, text: false })
        const first = found.length
        for (const block of data.blocks ?? []) {
          for (const paragraph of block.paragraphs) {
            for (const line of paragraph.lines) {
              for (const word of line.words) {
                const text = word.text.trim()
                if (word.confidence < MIN_CONFIDENCE || letters(text) < 2) continue
                const box = { x: word.bbox.x0 / scale, y: word.bbox.y0 / scale, width: (word.bbox.x1 - word.bbox.x0) / scale, height: (word.bbox.y1 - word.bbox.y0) / scale }
                // The second pass only adds words where the first read none.
                if (first > 0 && found.slice(0, first).some((other) => overlap(other.box, box) > 0.5)) continue
                found.push({ text, confidence: word.confidence, box })
              }
            }
          }
        }
      }
      return measured(flat, found)
    },
    async close() {
      await worker.terminate().catch(() => undefined)
    },
  }
}

/**
 * tesseract.js's own worker script, started with its console silenced: Leptonica, the image library inside Tesseract,
 * prints errors such as "Error in pixScanForForeground: invalid box" on some pictures, and they would land in the
 * middle of a report. The worker is a module from a data: URL, which Node's worker threads accept; it loads the script
 * by its path, so nothing is written to disk.
 */
function quietWorker(script: string): URL {
  const code = [
    "import { createRequire } from 'node:module'",
    'console.error = console.warn = console.log = () => {}',
    `createRequire(${JSON.stringify(script)})(${JSON.stringify(script)})`,
  ].join('\n')
  return new URL(`data:text/javascript,${encodeURIComponent(code)}`)
}

/** Of the picture's detail, the share inside the boxes of these words: 1 for a picture that is all text, near 0 for a photo. */
export function textShare(reading: OcrReading, words: readonly OcrWord[] = reading.words): number {
  if (reading.detail === 0) return 0
  return Math.min(1, words.reduce((sum, word) => sum + word.detail, 0) / reading.detail)
}

/** Counts the picture's edge pixels, and gives each word those inside its padded box (a pixel goes to one word only). */
export function measured(image: RgbaImage, words: ReadonlyArray<Omit<OcrWord, 'detail'>>): OcrReading {
  const { width, height, data } = image
  const owner = new Int32Array(width * height).fill(-1)
  words.forEach((word, index) => {
    // Outlines, shadows and the antialiased rims of letters belong to the text too.
    const pad = Math.max(2, word.box.height * 0.15)
    const x0 = Math.max(0, Math.floor(word.box.x - pad))
    const y0 = Math.max(0, Math.floor(word.box.y - pad))
    const x1 = Math.min(width, Math.ceil(word.box.x + word.box.width + pad))
    const y1 = Math.min(height, Math.ceil(word.box.y + word.box.height + pad))
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) if (owner[y * width + x] === -1) owner[y * width + x] = index
  })
  const details = new Array<number>(words.length).fill(0)
  let detail = 0
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4
      let step = 0
      for (let c = 0; c < 3; c++) {
        const here = data[i + c] ?? 0
        if (x + 1 < width) step = Math.max(step, Math.abs(here - (data[i + 4 + c] ?? 0)))
        if (y + 1 < height) step = Math.max(step, Math.abs(here - (data[i + width * 4 + c] ?? 0)))
      }
      if (step < EDGE_STEP) continue
      detail++
      const word = owner[y * width + x] ?? -1
      if (word >= 0) details[word] = (details[word] ?? 0) + 1
    }
  }
  return { words: words.map((word, index) => ({ ...word, detail: details[index] ?? 0 })), detail }
}

/** How much a picture is enlarged before it is read: small ones up to four times, in half steps. */
export function scaleFor(image: Pick<RgbaImage, 'height'>): number {
  if (image.height >= TARGET_HEIGHT) return 1
  return Math.min(MAX_SCALE, Math.max(1, Math.round((TARGET_HEIGHT / Math.max(30, image.height)) * 2) / 2))
}

/** Transparency over white, as a page with no background shows it, so a transparent picture is not read as black. */
function flattened(image: RgbaImage): RgbaImage {
  const data = new Uint8Array(image.data.length)
  for (let i = 0; i < image.data.length; i += 4) {
    const alpha = (image.data[i + 3] ?? 255) / 255
    for (let c = 0; c < 3; c++) data[i + c] = Math.round((image.data[i + c] ?? 0) * alpha + 255 * (1 - alpha))
    data[i + 3] = 255
  }
  return { width: image.width, height: image.height, data }
}

/** Bilinear enlargement. */
export function upscale(image: RgbaImage, factor: number): RgbaImage {
  if (factor <= 1) return image
  const width = Math.round(image.width * factor)
  const height = Math.round(image.height * factor)
  const data = new Uint8Array(width * height * 4)
  const at = (x: number, y: number, c: number) => image.data[(y * image.width + x) * 4 + c] ?? 0
  for (let y = 0; y < height; y++) {
    const sy = Math.min(image.height - 1, Math.max(0, (y + 0.5) / factor - 0.5))
    const y0 = Math.floor(sy)
    const y1 = Math.min(image.height - 1, y0 + 1)
    const fy = sy - y0
    for (let x = 0; x < width; x++) {
      const sx = Math.min(image.width - 1, Math.max(0, (x + 0.5) / factor - 0.5))
      const x0 = Math.floor(sx)
      const x1 = Math.min(image.width - 1, x0 + 1)
      const fx = sx - x0
      for (let c = 0; c < 4; c++) {
        const top = at(x0, y0, c) * (1 - fx) + at(x1, y0, c) * fx
        const bottom = at(x0, y1, c) * (1 - fx) + at(x1, y1, c) * fx
        data[(y * width + x) * 4 + c] = Math.round(top * (1 - fy) + bottom * fy)
      }
    }
  }
  return { width, height, data }
}

function letters(text: string): number {
  return text.match(/\p{L}/gu)?.length ?? 0
}

/** The share of the smaller box that the two boxes have in common. */
function overlap(a: PixelRect, b: PixelRect): number {
  const width = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)
  const height = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y)
  if (width <= 0 || height <= 0) return 0
  return (width * height) / Math.max(1, Math.min(a.width * a.height, b.width * b.height))
}

declare module 'gifenc' {
  interface FrameOptions {
    palette?: number[][]
    /** Milliseconds. */
    delay?: number
    /** -1 plays once, 0 loops forever, n repeats n times. */
    repeat?: number
  }
  interface Encoder {
    writeFrame(index: Uint8Array, width: number, height: number, options?: FrameOptions): void
    finish(): void
    bytes(): Uint8Array
  }
  const gifenc: {
    GIFEncoder(): Encoder
    quantize(rgba: Uint8Array | Uint8ClampedArray, maxColors: number): number[][]
    applyPalette(rgba: Uint8Array | Uint8ClampedArray, palette: number[][]): Uint8Array
  }
  export default gifenc
}

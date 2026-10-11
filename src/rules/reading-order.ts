import { normalizeForMatch, truncate } from '../core/util.ts'
import { attributesOf, isHidden, startTagOf, subtreeText } from '../criteria/shared.ts'
import type { Locale } from '../i18n.ts'
import type { A11yNode, A11ySnapshot, Bounds } from '../snapshot/schema.ts'
import { type TreeIndex, indexTree, walkTree } from '../snapshot/tree.ts'
import type { Hit, RuleCheck } from './types.ts'

/**
 * 1.3.2 Meaningful Sequence: the order a screen reader reads (the markup's) against the order people see.
 *
 * Two failure techniques, both read from facts the collector records (src/surfaces/in-page.ts):
 *
 * - F33 and F34, text laid out with white space: a `pre` (or any box that keeps its spaces) whose lines share runs of
 *   white space at the same columns, so the text stands in columns. Read line by line, a table loses its columns and two
 *   columns of prose mix their sentences. The columns are found from the text alone: character columns that are blank
 *   on every line with two cells or more.
 * - F1, boxes CSS shows in another order than the markup's: `order`, a reversed flex direction, explicit grid placement,
 *   absolute positions. Geometry only nominates: most pages reorder boxes without harm. A failure needs a relationship
 *   that breaks and can be checked from the text and the boxes: numbered steps read out of order, content read under
 *   another heading than the one it shows under, a sentence whose two halves are read the wrong way round. A group the
 *   geometry nominates with none of these is left to the 1.3.2 judgment (src/criteria/meaningful-sequence.ts), which may
 *   only keep it, quoting the box whose order changes the meaning.
 */

const UNDERSTANDING = 'https://www.w3.org/WAI/WCAG22/Understanding/meaningful-sequence.html'

// Text laid out with white space: F33 (columns of text) and F34 (tables).

export interface PreformattedFacts {
  text: string
  /** The box's font gives every character the same width: spaces line the text up as written. */
  mono?: boolean | undefined
  tabSize: number
}

export function preformattedOf(node: A11yNode): PreformattedFacts | undefined {
  const value = node.native.preformatted as Partial<PreformattedFacts> | undefined
  if (!value || typeof value.text !== 'string') return undefined
  return { text: value.text, mono: typeof value.mono === 'boolean' ? value.mono : undefined, tabSize: typeof value.tabSize === 'number' && value.tabSize > 0 ? value.tabSize : 8 }
}

export interface LaidOutCell {
  /** Columns, after tabs are expanded; `end` is exclusive. */
  start: number
  end: number
  text: string
}

interface LaidOutLine {
  index: number
  /** The line with tabs expanded to their stops and every kind of space as one space. */
  text: string
  cells: LaidOutCell[]
  tabs: boolean
}

export interface WhitespaceLayout {
  /** table: three columns or more (F34); columns: every column holds running text (F33); pairs: two columns of short items. */
  kind: 'table' | 'columns' | 'pairs'
  columns: number
  /** Lines with something on both sides of a gutter. */
  rows: number
  /** Each such line, cut at the gutters: what sits in each column. */
  table: string[][]
  /** The fullest line as a screen reader reads it: its columns run together. */
  read: string
  tabs: boolean
}

const SPACE = /[   -   　]/

/** A line's cells: runs of text separated by two spaces or more, or by a tab. Single spaces stay inside a cell. */
export function splitCells(raw: string, tabSize = 8): { text: string; cells: LaidOutCell[]; tabs: boolean } {
  let text = ''
  const tabAt: boolean[] = []
  const line = raw.replace(/\r$/, '')
  for (let i = 0; i < line.length; i++) {
    const ch = line[i] as string
    if (ch === '\t') {
      const width = tabSize - (text.length % tabSize)
      text += ' '.repeat(width)
      for (let k = 0; k < width; k++) tabAt.push(true)
    } else {
      text += SPACE.test(ch) ? ' ' : ch
      tabAt.push(false)
    }
  }
  const cells: LaidOutCell[] = []
  let i = 0
  while (i < text.length) {
    if (text[i] === ' ') {
      i++
      continue
    }
    const start = i
    let end = i
    while (end < text.length) {
      if (text[end] !== ' ') {
        end++
        continue
      }
      let gap = end
      let tab = false
      while (gap < text.length && text[gap] === ' ') {
        if (tabAt[gap]) tab = true
        gap++
      }
      if (gap - end >= 2 || tab || gap === text.length) break
      end = gap
    }
    cells.push({ start, end, text: text.slice(start, end) })
    i = end
  }
  return { text, cells, tabs: tabAt.some(Boolean) }
}

/** Code, a terminal session: aligned on purpose, and read as code. Signs, not words: "Class" heads many a timetable. */
const CODE = /[{};]|=>|::|\/\/|\b\w+\([^)]*\)|^\s*(?:def|function|class|import|return|const|let|var|public|private)\s/
const PROMPT = /^\s*(?:\$|>|#|%|PS [A-Z]:\\)\s/
/** A table drawn with characters (pipes, box-drawing lines) is another layout, which this rule does not read. */
const DRAWN = /[|─-╿]/

const alnumShare = (text: string): number => {
  const visible = text.replace(/\s+/g, '')
  return visible.length === 0 ? 0 : (visible.match(/[\p{L}\p{N}]/gu)?.length ?? 0) / visible.length
}

const words = (text: string): number => text.split(/\s+/).filter((word) => /[\p{L}\p{N}]/u.test(word)).length

/**
 * How a text stands in columns made of white space, or undefined when it does not: at least three lines with two
 * cells or more whose gaps line up, so that some character columns are blank on every one of them. A long text is read
 * block by block, a block ending at two blank lines or at a line of running text, so a table between paragraphs (a
 * plain-text document) is found on its own. A table or columns of text win over two columns of short items.
 */
export function whitespaceLayout(text: string, tabSize = 8): WhitespaceLayout | undefined {
  const lines: LaidOutLine[] = text.split('\n').map((raw, index) => ({ index, ...splitCells(raw, tabSize) }))
  // A prompt anywhere makes the rest a command's output (`ls -l`, `docker ps`): aligned by the program, read as code.
  if (lines.some((line) => PROMPT.test(line.text))) return undefined
  const blocks: LaidOutLine[][] = [[]]
  lines.forEach((line, i) => {
    const previous = lines[i - 1]
    const prose = line.cells.length === 1 && words(line.text) >= 6
    const gap = line.cells.length === 0 && previous !== undefined && previous.cells.length === 0
    if (prose || gap) blocks.push([])
    else blocks.at(-1)?.push(line)
  })
  let pairs: WhitespaceLayout | undefined
  for (const block of blocks) {
    const layout = blockLayout(block)
    if (layout && layout.kind !== 'pairs') return layout
    pairs ??= layout
  }
  return pairs
}

function blockLayout(lines: LaidOutLine[]): WhitespaceLayout | undefined {
  // A title, a note or a rule line takes no part in the columns.
  const multi = lines.filter((line) => line.cells.length >= 2 && alnumShare(line.text) >= 0.3)
  if (multi.length < 3) return undefined
  if (multi.filter((line) => CODE.test(line.text)).length > multi.length * 0.2) return undefined
  if (multi.filter((line) => DRAWN.test(line.text)).length > multi.length * 0.5) return undefined
  const width = Math.max(...multi.map((line) => line.text.length))
  const blank = (line: LaidOutLine, c: number) => c >= line.text.length || line.text[c] === ' '
  const tabs = multi.some((line) => line.tabs)
  const gutters: Array<{ start: number; end: number }> = []
  for (let c = 0; c < width; ) {
    if (!multi.every((line) => blank(line, c))) {
      c++
      continue
    }
    const start = c
    while (c < width && multi.every((line) => blank(line, c))) c++
    // A gutter has text on both sides; leading indentation and the space past the longest line are not gutters.
    if (start > 0 && c < width && (c - start >= 2 || tabs)) gutters.push({ start, end: c })
  }
  const filled = (line: LaidOutLine, from: number, to: number) => line.text.slice(from, to).trim() !== ''
  const used = gutters.filter((gutter) => {
    const across = multi.filter((line) => filled(line, 0, gutter.start) && filled(line, gutter.end, line.text.length)).length
    return across >= 2 && across >= multi.length * 0.25
  })
  if (used.length === 0) return undefined
  const columns = used.length + 1
  const segments = (line: LaidOutLine): string[] => {
    const cuts = [0, ...used.flatMap((gutter) => [gutter.start, gutter.end]), line.text.length]
    const out: string[] = []
    for (let k = 0; k < cuts.length; k += 2) out.push(line.text.slice(cuts[k], cuts[k + 1]).replace(/\s+/g, ' ').trim())
    return out
  }
  const cut = multi.map((line) => ({ index: line.index, cells: segments(line) }))
  const rows = cut.filter((row) => row.cells.filter(Boolean).length >= 2)
  if (rows.length < 3) return undefined
  const prose = proseColumns(cut, columns)
  // The line that shows best what a screen reader makes of it: the first, for running text; for a table, the fullest
  // row with the most words, a row of data rather than the header.
  const filledCount = (row: { cells: string[] }) => row.cells.filter(Boolean).length
  const wordCount = (row: { cells: string[] }) => row.cells.reduce((sum, cell) => sum + words(cell), 0)
  const shown = prose ? rows[0] : [...rows].sort((a, b) => filledCount(b) - filledCount(a) || wordCount(b) - wordCount(a) || a.index - b.index)[0]
  const layout: Omit<WhitespaceLayout, 'kind'> = {
    columns,
    rows: rows.length,
    table: rows.map((row) => row.cells),
    read: (shown?.cells ?? []).filter(Boolean).join(' '),
    tabs,
  }
  if (prose) return { kind: 'columns', ...layout }
  return { kind: columns >= 3 ? 'table' : 'pairs', ...layout }
}

/**
 * Every column holds running text: segments of three words or more on average, and in each column at least two
 * places where a line breaks mid-sentence and the next line of the same column goes on in lower case.
 */
function proseColumns(cut: Array<{ index: number; cells: string[] }>, columns: number): boolean {
  for (let k = 0; k < columns; k++) {
    const cells = cut.map((row) => row.cells[k] ?? '').filter(Boolean)
    if (cells.length < 3 || cells.reduce((sum, cell) => sum + words(cell), 0) / cells.length < 3) return false
    let continued = 0
    for (let i = 0; i + 1 < cut.length; i++) {
      const here = cut[i]
      const next = cut[i + 1]
      if (!here || !next || next.index !== here.index + 1) continue
      const a = here.cells[k] ?? ''
      const b = next.cells[k] ?? ''
      if (words(a) >= 3 && /[\p{L}\p{N},]$/u.test(a) && /^\p{Ll}/u.test(b)) continued++
    }
    if (continued < 2) return false
  }
  return true
}

/** Class names of code blocks and terminals, as syntax highlighters and documentation sites write them. */
const CODE_CLASS = /(?:^|[\s_-])(?:language|lang|highlight|hljs|prism|shiki|sourcecode|code|codeblock|console|terminal|shell|syntax|cli)(?:$|[\s_-])/i
const CODE_TAGS = new Set(['code', 'samp', 'kbd', 'var'])

/** A code block or terminal output, or an element its author named (ASCII art with role="img"): left alone. */
export function leftAsCode(index: TreeIndex, node: A11yNode): boolean {
  if ([...walkTree(node)].some((inner) => CODE_TAGS.has(String(inner.native.tag ?? '')))) return true
  const attributes = attributesOf(node)
  if (node.role === 'img' || (attributes['aria-label'] ?? '').trim() !== '' || (attributes['aria-labelledby'] ?? '').trim() !== '') return true
  let entry = index.get(node.ref)
  for (let depth = 0; entry && depth < 4; depth++) {
    const current = entry.node
    if (CODE_TAGS.has(String(current.native.tag ?? '')) || CODE_CLASS.test(attributesOf(current).class ?? '')) return true
    entry = entry.parentRef === undefined ? undefined : index.get(entry.parentRef)
  }
  return false
}

const WS_TEXT: Record<Locale, { table: string; columns: string; read: string; proportional: string }> = {
  en: {
    table:
      'This preformatted text is a table laid out with spaces ({columns} columns, {rows} rows): a screen reader reads it line by line, with no header cells and no cells, so each value loses the column it belongs to (WCAG 1.3.1 and 1.3.2, F34). Mark it up as a table (table, th, td).',
    columns:
      'This preformatted text sets {columns} columns of text side by side with spaces: a screen reader reads across the columns line by line, mixing their sentences (WCAG 1.3.2, F33). Put each column in its own element, in reading order, and place them side by side with CSS.',
    read: 'read line by line: “{line}”',
    proportional: 'the font is not monospaced, so the columns may not even line up on screen',
  },
  'pt-BR': {
    table:
      'Este texto pré-formatado é uma tabela montada com espaços ({columns} colunas, {rows} linhas): o leitor de tela lê linha por linha, sem cabeçalhos e sem células, e cada valor perde a coluna a que pertence (WCAG 1.3.1 e 1.3.2, F34). Marque-o como tabela (table, th, td).',
    columns:
      'Este texto pré-formatado põe {columns} colunas de texto lado a lado com espaços: o leitor de tela lê atravessando as colunas linha por linha e mistura as frases (WCAG 1.3.2, F33). Ponha cada coluna em um elemento próprio, na ordem de leitura, e coloque-as lado a lado com CSS.',
    read: 'lido linha por linha: “{line}”',
    proportional: 'a fonte não é monoespaçada, então as colunas talvez nem se alinhem na tela',
  },
}

export const whitespaceTableRule: RuleCheck = {
  id: 'rampa/whitespace-table',
  version: '1',
  criteria: ['1.3.2', '1.3.1'],
  maturity: 'experimental',
  surfaces: ['web'],
  act: [],
  engineRules: [],
  // Text in columns of spaces is one way among many a reading order breaks: a page with none says nothing about 1.3.2.
  narrow: true,
  help: {
    en: 'Tables and columns of text must not be laid out with white space (F33, F34); use table markup, or one element per column',
    'pt-BR': 'Tabelas e colunas de texto não devem ser montadas com espaços (F33, F34); use marcação de tabela, ou um elemento por coluna',
  },
  helpUrl: 'https://www.w3.org/WAI/WCAG22/Techniques/failures/F34',
  run(snapshot, _engine, ctx) {
    const hits: Hit[] = []
    let applicable = 0
    for (const node of walkTree(snapshot.root)) {
      const facts = preformattedOf(node)
      if (!facts || isHidden(node) || leftAsCode(ctx.index, node)) continue
      const layout = whitespaceLayout(facts.text, facts.tabSize)
      if (!layout) continue
      applicable++
      // Two columns of short items (a label and its value) read well enough line by line: the judgment may say otherwise.
      if (layout.kind === 'pairs') continue
      const text = WS_TEXT[ctx.locale]
      const ragged = facts.mono === false && !layout.tabs
      const header = (layout.table[0] ?? []).filter(Boolean)
      hits.push({
        ref: node.ref,
        outcome: 'fail',
        subject: `${layout.kind}|${header.join('|')}`,
        evidence: [
          ctx.locale === 'pt-BR' ? `${layout.columns} colunas × ${layout.rows} linhas` : `${layout.columns} columns × ${layout.rows} rows`,
          text.read.replace('{line}', truncate(layout.read, 120)),
          ...(ragged ? [text.proportional] : []),
        ].join('; '),
        confidence: ragged ? 'medium' : 'high',
        html: startTagOf(node),
        facts: { kind: layout.kind, columns: layout.columns, rows: layout.rows, read: truncate(layout.read, 120) },
      })
    }
    return { hits, applicable }
  },
  message(hit, locale) {
    const text = WS_TEXT[locale]
    return (hit.facts.kind === 'columns' ? text.columns : text.table).replace('{columns}', String(hit.facts.columns)).replace('{rows}', String(hit.facts.rows))
  },
}

// Boxes CSS shows in another order than the markup's: F1.

export interface OrderBox {
  node: A11yNode
  /** What a person reads in the box. */
  text: string
  /** Its place among the group's boxes in the markup, which is the order a screen reader reads them in. */
  dom: number
  box: Bounds
  /** A heading, by its role or by its text: larger, or bold among regular text. */
  heading: boolean
  /** The step number its text starts with ("1.", "Step 2", "Passo 3"). */
  step?: number | undefined
  /** The number comes after a word that says it is a step. */
  stepWord?: boolean | undefined
}

export interface OrderBreak {
  kind: 'sequence' | 'heading' | 'sentence'
  /** The boxes the relationship involves, in the order people see them. */
  boxes: OrderBox[]
  facts: Record<string, string | number>
}

export interface ReadingOrder {
  container: A11yNode
  /** What may reorder the group: order, row-reverse, grid-placement, absolute... */
  by: string[]
  /** The boxes in the markup's order. */
  boxes: OrderBox[]
  /** The boxes as people see them: lines top to bottom, each left to right. */
  lines: OrderBox[][]
  /** A relationship the markup's order breaks, when one could be verified. */
  broken?: OrderBreak | undefined
  /**
   * The markup holds the group's numbered steps in order (1, 2, 3), whatever the screen shows: the sequence that
   * carries the meaning is the one a screen reader reads, so there is nothing left to judge.
   */
  intact?: 'sequence' | undefined
}

/** More boxes than this in one group is a list or a grid of items, not a sequence a rule can read. */
const MAX_BOXES = 40
const STEP_WORDS = 'step|steps|passo|etapa|paso|fase|phase|part|parte|stage'
const STEP = new RegExp(`^(?:(${STEP_WORDS})\\s*)?(?:n[º°o]\\.?\\s*|#\\s*)?(\\d{1,2})(?=$|[\\s.):ºª°–—-])`, 'iu')

const right = (b: Bounds) => b.x + b.width
const bottom = (b: Bounds) => b.y + b.height
const overlapY = (a: Bounds, b: Bounds) => Math.max(0, Math.min(bottom(a), bottom(b)) - Math.max(a.y, b.y))
const overlapX = (a: Bounds, b: Bounds) => Math.max(0, Math.min(right(a), right(b)) - Math.max(a.x, b.x))

/** The boxes in lines, as people read a page: top to bottom, and left to right in each line. */
export function linesOf(boxes: readonly OrderBox[]): OrderBox[][] {
  const sorted = [...boxes].sort((a, b) => a.box.y - b.box.y || a.box.x - b.box.x || a.dom - b.dom)
  const lines: Array<{ first: Bounds; items: OrderBox[] }> = []
  for (const item of sorted) {
    const line = lines.at(-1)
    if (line && overlapY(line.first, item.box) >= 0.5 * Math.min(line.first.height, item.box.height)) line.items.push(item)
    else lines.push({ first: item.box, items: [item] })
  }
  return lines.map((line) => line.items.sort((a, b) => a.box.x - b.box.x || a.dom - b.dom))
}

/** The boxes in columns: left to right, and top to bottom in each column. */
export function columnsOf(boxes: readonly OrderBox[]): OrderBox[][] {
  const sorted = [...boxes].sort((a, b) => a.box.x - b.box.x || a.box.y - b.box.y || a.dom - b.dom)
  const columns: Array<{ right: number; items: OrderBox[] }> = []
  for (const item of sorted) {
    const column = columns.at(-1)
    if (column && item.box.x < column.right - 2) {
      column.items.push(item)
      column.right = Math.max(column.right, right(item.box))
    } else columns.push({ right: right(item.box), items: [item] })
  }
  return columns.map((column) => column.items.sort((a, b) => a.box.y - b.box.y || a.dom - b.dom))
}

const sameOrder = (a: readonly OrderBox[], b: readonly OrderBox[]) => a.length === b.length && a.every((box, i) => box === b[i])

/** A box is a heading by its role, or holds nothing but a heading. */
function semanticHeading(node: A11yNode, text: string): boolean {
  if (node.role === 'heading') return true
  const wanted = normalizeForMatch(text)
  for (const inner of walkTree(node)) {
    if (inner.role === 'heading' && normalizeForMatch(subtreeText(inner)) === wanted) return true
  }
  return false
}

const fontOf = (node: A11yNode): [number, number] | undefined => {
  const font = node.native.font
  return Array.isArray(font) && typeof font[0] === 'number' && typeof font[1] === 'number' ? [font[0], font[1]] : undefined
}

const median = (values: number[]): number => {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)] ?? 0
}

/** Interactive boxes are read for their own sake (a menu's links), never as halves of a sentence. */
const INTERACTIVE = new Set(['link', 'button', 'menuitem', 'tab', 'option', 'checkbox', 'radio', 'switch', 'textbox', 'combobox'])
const interactive = (box: OrderBox): boolean =>
  INTERACTIVE.has(box.node.role) || [...walkTree(box.node)].some((inner) => INTERACTIVE.has(inner.role) && normalizeForMatch(subtreeText(inner) || inner.name || '') === normalizeForMatch(box.text))

/** The groups of boxes CSS may have reordered, each with how people see it and what breaks, if anything verifiable does. */
export function readingOrders(snapshot: A11ySnapshot, index: TreeIndex = indexTree(snapshot.root)): ReadingOrder[] {
  const orders: ReadingOrder[] = []
  for (const container of walkTree(snapshot.root)) {
    const by = container.native.reorder
    if (!Array.isArray(by) || by.length === 0 || isHidden(container)) continue
    // Right-to-left text runs the other way: bidirectional reading stays with a person.
    if (rightToLeft(index, container)) continue
    const boxes: OrderBox[] = []
    for (const child of container.children) {
      const box = child.bounds
      // A box fixed to the window (a sticky bar, a chat button) is not part of the page's sequence; a visually hidden one has no place on screen.
      if (!box || box.width < 4 || box.height < 4 || isHidden(child) || child.states.includes('offscreen') || child.native.position === 'fixed') continue
      const text = subtreeText(child)
      if (!/[\p{L}\p{N}]/u.test(text)) continue
      const match = STEP.exec(text.trim())
      boxes.push({
        node: child,
        text,
        dom: boxes.length,
        box,
        heading: semanticHeading(child, text),
        ...(match ? { step: Number(match[2]), stepWord: match[1] !== undefined } : {}),
      })
    }
    if (boxes.length < 2 || boxes.length > MAX_BOXES) continue
    // Boxes stacked in one place (slides, panels, an overlay) have no order on screen to compare.
    if (stacked(boxes)) continue
    emphasize(boxes)
    const lines = linesOf(boxes)
    const seen = lines.flat()
    const columns = columnsOf(boxes).flat()
    const heading = headingBreak(boxes)
    if (sameOrder(boxes, seen) && !heading) continue
    if (sameOrder(boxes, columns) && !heading) continue
    const broken = sequenceBreak(boxes, [seen, columns]) ?? heading ?? sentenceBreak(boxes, lines, columnsOf(boxes))
    const intact = !broken && stepsInOrder(boxes)
    orders.push({ container, by: by.map(String), boxes, lines, ...(broken ? { broken } : {}), ...(intact ? { intact: 'sequence' as const } : {}) })
  }
  return orders
}

const RTL = new Set(['ar', 'he', 'fa', 'ur', 'yi', 'ps', 'sd', 'ug', 'dv', 'ckb'])
function rightToLeft(index: TreeIndex, node: A11yNode): boolean {
  for (let entry = index.get(node.ref); entry; entry = entry.parentRef === undefined ? undefined : index.get(entry.parentRef)) {
    const attributes = attributesOf(entry.node)
    if (attributes.dir) return attributes.dir.toLowerCase() === 'rtl'
    if (entry.node.lang) return RTL.has(entry.node.lang.toLowerCase().split(/[-_]/)[0] ?? '')
  }
  return false
}

function stacked(boxes: readonly OrderBox[]): boolean {
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = (boxes[i] as OrderBox).box
      const b = (boxes[j] as OrderBox).box
      const shared = overlapX(a, b) * overlapY(a, b)
      if (shared > 0.5 * Math.min(a.width * a.height, b.width * b.height)) return true
    }
  }
  return false
}

/** Short text set larger than the rest, or bold among regular text, heads what is below it, as a heading would. */
function emphasize(boxes: OrderBox[]): void {
  const fonts = boxes.map((box) => fontOf(box.node))
  if (fonts.some((font) => !font)) return
  const sizes = fonts.map((font) => (font as [number, number])[0])
  const weights = fonts.map((font) => (font as [number, number])[1])
  const size = median(sizes)
  const weight = median(weights)
  const marked = boxes.map((box, i) => {
    const [s, w] = fonts[i] as [number, number]
    return !box.heading && words(box.text) <= 8 && !/[.!?]$/.test(box.text) && (s >= size * 1.15 || (w >= 600 && weight < 600 && s >= size))
  })
  // When every box is set that way, none stands out.
  if (marked.every(Boolean) || boxes.filter((box, i) => box.heading || marked[i]).length === boxes.length) return
  boxes.forEach((box, i) => {
    if (marked[i]) box.heading = true
  })
}

/** The boxes numbered as steps: three of them, or two that a step word introduces. */
function numberedSteps(boxes: readonly OrderBox[]): OrderBox[] | undefined {
  const numbered = boxes.filter((box) => box.step !== undefined)
  return numbered.length >= 3 || (numbered.length >= 2 && numbered.every((box) => box.stepWord)) ? numbered : undefined
}

const increasing = (list: readonly OrderBox[]) => list.every((box, i) => i === 0 || box.step === (list[i - 1]?.step ?? Number.NaN) + 1)

/** Every box of the group is a numbered step, and the markup holds them in order from 0 or 1. */
function stepsInOrder(boxes: readonly OrderBox[]): boolean {
  const numbered = numberedSteps(boxes)
  return numbered !== undefined && numbered.length === boxes.length && increasing(numbered) && (numbered[0]?.step ?? 9) <= 1
}

/** Numbered steps people see in order (1, 2, 3) that the markup holds in another. */
function sequenceBreak(boxes: readonly OrderBox[], orders: readonly OrderBox[][]): OrderBreak | undefined {
  const read = numberedSteps(boxes)
  if (!read || increasing(read)) return undefined
  const numbered = read
  for (const order of orders) {
    const seen = order.filter((box) => box.step !== undefined)
    if (seen.length !== numbered.length || !increasing(seen) || (seen[0]?.step ?? 9) > 1) continue
    return {
      kind: 'sequence',
      boxes: seen,
      facts: { seen: seen.map((box) => box.step).join(' · '), read: read.map((box) => box.step).join(' · '), first: truncate(seen[0]?.text ?? '', 60) },
    }
  }
  return undefined
}

/**
 * Content shown under a heading but read under another (or before its own): the heading a box belongs to is the closest
 * one above it whose column holds it; the heading it is read under is the last one before it in the markup.
 */
function headingBreak(boxes: readonly OrderBox[]): OrderBreak | undefined {
  const headings = boxes.filter((box) => box.heading)
  if (headings.length === 0 || headings.length === boxes.length) return undefined
  // Each heading's column runs from its left edge to the next heading's in the same line.
  const span = new Map<OrderBox, [number, number]>()
  for (const line of linesOf(headings)) {
    line.forEach((heading, i) => {
      const next = line[i + 1]
      span.set(heading, [heading.box.x - 4, next ? next.box.x - 4 : Number.POSITIVE_INFINITY])
    })
  }
  for (const item of boxes) {
    if (item.heading) continue
    const owners = headings.filter((heading) => {
      const [from, to] = span.get(heading) ?? [0, 0]
      return bottom(heading.box) <= item.box.y + 2 && item.box.x >= from && item.box.x < to
    })
    const owner = owners.sort((a, b) => bottom(b.box) - bottom(a.box))[0]
    if (!owner) continue
    const before = headings.filter((heading) => heading.dom < item.dom).sort((a, b) => b.dom - a.dom)[0]
    if (before === owner) continue
    return {
      kind: 'heading',
      boxes: [owner, item, ...(before ? [before] : [])],
      facts: { item: truncate(item.text, 60), owner: truncate(owner.text, 60), ...(before ? { readUnder: truncate(before.text, 60) } : {}) },
    }
  }
  return undefined
}

/** Two halves of a sentence side by side, or one under the other, that the markup holds the other way round. */
function sentenceBreak(boxes: readonly OrderBox[], lines: readonly OrderBox[][], columns: readonly OrderBox[][]): OrderBreak | undefined {
  const pairs: Array<[OrderBox, OrderBox]> = []
  // Side by side within a line's height of each other, as words of one line are; boxes further apart are columns.
  for (const line of lines) {
    for (let i = 0; i + 1 < line.length; i++) {
      const a = line[i] as OrderBox
      const b = line[i + 1] as OrderBox
      if (b.box.x - right(a.box) <= Math.max(a.box.height, b.box.height)) pairs.push([a, b])
    }
  }
  for (const column of columns) {
    for (let i = 0; i + 1 < column.length; i++) {
      const a = column[i] as OrderBox
      const b = column[i + 1] as OrderBox
      if (b.box.y - bottom(a.box) < Math.max(a.box.height, b.box.height)) pairs.push([a, b])
    }
  }
  for (const [a, b] of pairs) {
    if (b.dom > a.dom || a.heading || b.heading || interactive(a) || interactive(b)) continue
    if (words(a.text) < 2 || words(b.text) < 2) continue
    if (!/[\p{L}\p{N},]$/u.test(a.text) || !/^\p{Ll}/u.test(b.text)) continue
    if (!boxes.includes(a) || !boxes.includes(b)) continue
    return { kind: 'sentence', boxes: [a, b], facts: { first: truncate(a.text, 80), second: truncate(b.text, 80) } }
  }
  return undefined
}

/** What moved the boxes, as the message names it. */
export function mechanismText(by: readonly string[], locale: Locale): string {
  const names: Record<string, Record<Locale, string>> = {
    order: { en: 'CSS order', 'pt-BR': 'order no CSS' },
    'row-reverse': { en: 'flex-direction: row-reverse', 'pt-BR': 'flex-direction: row-reverse' },
    'column-reverse': { en: 'flex-direction: column-reverse', 'pt-BR': 'flex-direction: column-reverse' },
    'wrap-reverse': { en: 'flex-wrap: wrap-reverse', 'pt-BR': 'flex-wrap: wrap-reverse' },
    'grid-dense': { en: 'dense grid packing', 'pt-BR': 'grid-auto-flow: dense' },
    'grid-placement': { en: 'explicit grid placement', 'pt-BR': 'posicionamento explícito no grid' },
    absolute: { en: 'absolute positioning', 'pt-BR': 'posicionamento absoluto' },
  }
  return by.map((key) => names[key]?.[locale] ?? key).join(', ')
}

const ORDER_TEXT: Record<Locale, Record<OrderBreak['kind'], string> & { fix: string }> = {
  en: {
    sequence: 'These numbered steps show in order on screen ({seen}), but the markup holds them as {read}, so a screen reader reads them out of order ({by}; WCAG 1.3.2, F1).',
    heading: '“{item}” shows under “{owner}”, but the markup puts it {where}, so a screen reader reads it as part of another section ({by}; WCAG 1.3.2, F1).',
    sentence: 'On screen “{first}” goes on with “{second}”, but the markup holds the second half first, so a screen reader reads the sentence the wrong way round ({by}; WCAG 1.3.2, F1).',
    fix: 'Put the elements in the markup in the order they are meant to be read, and lay them out with CSS without reordering them.',
  },
  'pt-BR': {
    sequence: 'Estes passos numerados aparecem em ordem na tela ({seen}), mas a marcação os traz como {read}, então o leitor de tela os lê fora de ordem ({by}; WCAG 1.3.2, F1).',
    heading: '“{item}” aparece sob “{owner}”, mas a marcação o põe {where}, então o leitor de tela o lê como parte de outra seção ({by}; WCAG 1.3.2, F1).',
    sentence: 'Na tela, “{first}” continua em “{second}”, mas a marcação traz a segunda metade antes, então o leitor de tela lê a frase invertida ({by}; WCAG 1.3.2, F1).',
    fix: 'Ponha os elementos na marcação na ordem em que devem ser lidos, e arrume-os com CSS sem reordená-los.',
  },
}

function whereText(facts: Hit['facts'], locale: Locale): string {
  if (typeof facts.readUnder === 'string') return locale === 'pt-BR' ? `depois de “${facts.readUnder}”` : `after “${facts.readUnder}”`
  return locale === 'pt-BR' ? `antes de “${facts.owner}”` : `before “${facts.owner}”`
}

export const cssReadingOrderRule: RuleCheck = {
  id: 'rampa/css-reading-order',
  version: '1',
  criteria: ['1.3.2'],
  maturity: 'experimental',
  surfaces: ['web'],
  act: [],
  engineRules: [],
  // Only groups CSS reordered: a page with none says nothing about 1.3.2.
  narrow: true,
  help: {
    en: 'Content CSS shows in another order than the markup must keep its meaning when read in the markup order (F1)',
    'pt-BR': 'Conteúdo que o CSS mostra em outra ordem que a da marcação precisa manter o sentido lido na ordem da marcação (F1)',
  },
  helpUrl: 'https://www.w3.org/WAI/WCAG22/Techniques/failures/F1',
  run(snapshot, _engine, ctx) {
    const hits: Hit[] = []
    const orders = readingOrders(snapshot, ctx.index)
    let unverified = 0
    for (const order of orders) {
      const broken = order.broken
      if (!broken) {
        // Steps the markup holds in order are read right, however the screen shows them.
        if (!order.intact) unverified++
        continue
      }
      const facts: Hit['facts'] = { kind: broken.kind, by: mechanismText(order.by, 'en'), byKey: order.by.join(','), ...broken.facts }
      const quoted = broken.boxes.map((box) => `“${truncate(box.text, 50)}”`).join(' → ')
      const read = [...broken.boxes].sort((a, b) => a.dom - b.dom).map((box) => `“${truncate(box.text, 50)}”`).join(' → ')
      hits.push({
        ref: order.container.ref,
        outcome: 'fail',
        subject: `${broken.kind}|${broken.boxes.map((box) => box.text.slice(0, 40)).join('|')}`,
        evidence: ctx.locale === 'pt-BR' ? `na tela: ${quoted}; lido: ${read}; ${mechanismText(order.by, ctx.locale)}` : `on screen: ${quoted}; read: ${read}; ${mechanismText(order.by, ctx.locale)}`,
        // Numbers and headings are what the page says; the halves of a sentence are read from case and punctuation.
        confidence: broken.kind === 'sentence' ? 'medium' : 'high',
        html: startTagOf(order.container),
        facts,
      })
    }
    const note =
      unverified > 0
        ? ctx.locale === 'pt-BR'
          ? `${unverified} grupo(s) reordenado(s) pelo CSS sem relação verificável quebrada: ficam para o julgamento de 1.3.2 (--criteria 1.3.2)`
          : `${unverified} group(s) CSS reordered with no relationship verified to break: left to the 1.3.2 judgment (--criteria 1.3.2)`
        : undefined
    return { hits, applicable: orders.length, ...(note ? { note } : {}) }
  },
  message(hit, locale) {
    const kind = String(hit.facts.kind) as OrderBreak['kind']
    const by = mechanismText(String(hit.facts.byKey ?? '').split(',').filter(Boolean), locale)
    const text = ORDER_TEXT[locale][kind]
      .replace('{seen}', String(hit.facts.seen ?? ''))
      .replace('{read}', String(hit.facts.read ?? ''))
      .replace('{item}', String(hit.facts.item ?? ''))
      .replace('{owner}', String(hit.facts.owner ?? ''))
      .replace('{where}', whereText(hit.facts, locale))
      .replace('{first}', String(hit.facts.first ?? ''))
      .replace('{second}', String(hit.facts.second ?? ''))
      .replace('{by}', by)
    return `${text} ${ORDER_TEXT[locale].fix}`
  },
}

export const READING_ORDER_RULES: readonly RuleCheck[] = [whitespaceTableRule, cssReadingOrderRule]

export { UNDERSTANDING as MEANINGFUL_SEQUENCE_URL }

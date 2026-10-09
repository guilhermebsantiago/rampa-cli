import type { Patch } from '../core/types.ts'
import { normalizeForMatch, truncate } from '../core/util.ts'
import { attributesOf, isHidden, startTagOf, subtreeText, withAttribute } from '../criteria/shared.ts'
import type { A11yNode, A11ySnapshot } from '../snapshot/schema.ts'
import { type TreeIndex, walkTree } from '../snapshot/tree.ts'
import type { Hit, RuleCheck } from './types.ts'

/**
 * Structure rules (wave A4 of docs/plans/wcag-coverage.md): relationships the markup states and the
 * browser computes, read from facts the collector records (a table's grid, what a label labels, a
 * role the browser keeps or drops). 1.3.1 Info and Relationships and 4.1.2 Name, Role, Value.
 */

const UNDERSTANDING = 'https://www.w3.org/WAI/WCAG22/Understanding/'

// The table grid the collector records for each table (src/surfaces/in-page.ts).

export interface TableCell {
  ref: string
  header: boolean
  x: number
  y: number
  w: number
  h: number
  /** row, col, rowgroup, colgroup, or '' for the auto state. */
  scope: string
  headers: string[]
  id: string
  role: string
  empty: boolean
  hidden: boolean
}

export interface TableFacts {
  kind: 'html' | 'aria'
  busy: boolean
  caption: string
  summary: string
  cells: TableCell[]
  truncated: boolean
}

export function tableFactsOf(node: A11yNode): TableFacts | undefined {
  const value = node.native.table as TableFacts | undefined
  return value && Array.isArray(value.cells) ? value : undefined
}

const CELL_ROLES = new Set(['', 'cell', 'gridcell', 'columnheader', 'rowheader'])
const HEADER_ROLES = new Set(['', 'columnheader', 'rowheader'])

/**
 * For each header cell, the cells it is assigned to, by the HTML algorithm "forming relationships between
 * data cells and header cells": a cell's headers attribute when it has one, and otherwise a scan left along
 * its rows and up along its columns, where a header block hides the headers beyond it.
 */
export function assignedCells(cells: readonly TableCell[]): Map<TableCell, TableCell[]> {
  const slots = new Map<string, TableCell[]>()
  for (const cell of cells) {
    for (let dx = 0; dx < cell.w; dx++) {
      for (let dy = 0; dy < cell.h; dy++) {
        const key = `${cell.x + dx},${cell.y + dy}`
        slots.set(key, [...(slots.get(key) ?? []), cell])
      }
    }
  }
  const covering = (x: number, y: number) => slots.get(`${x},${y}`) ?? []
  const anyData = (keep: (cell: TableCell) => boolean) => cells.some((cell) => !cell.header && keep(cell))
  const overlaps = (from: number, size: number, start: number, length: number) => from < start + length && start < from + size
  const columnHeader = (cell: TableCell) =>
    cell.header && (cell.scope === 'col' || cell.scope === 'colgroup' || (cell.scope === '' && !anyData((other) => overlaps(other.y, other.h, cell.y, cell.h))))
  const rowHeader = (cell: TableCell) =>
    cell.header &&
    (cell.scope === 'row' || cell.scope === 'rowgroup' || (cell.scope === '' && !columnHeader(cell) && !anyData((other) => overlaps(other.x, other.w, cell.x, cell.w))))

  const scan = (principal: TableCell, list: Set<TableCell>, startX: number, startY: number, dx: number, dy: number) => {
    const opaque: TableCell[] = []
    let inBlock = principal.header
    let block: TableCell[] = principal.header ? [principal] : []
    let x = startX
    let y = startY
    for (;;) {
      x += dx
      y += dy
      if (x < 0 || y < 0) return
      const here = covering(x, y)
      if (here.length !== 1) continue
      const current = here[0] as TableCell
      if (current.header) {
        inBlock = true
        block.push(current)
        let blocked = false
        if (dx === 0) {
          if (opaque.some((cell) => cell.x === current.x && cell.w === current.w)) blocked = true
          if (!columnHeader(current)) blocked = true
        }
        if (dy === 0) {
          if (opaque.some((cell) => cell.y === current.y && cell.h === current.h)) blocked = true
          if (!rowHeader(current)) blocked = true
        }
        if (!blocked) list.add(current)
      } else if (inBlock) {
        inBlock = false
        opaque.push(...block)
        block = []
      }
    }
  }

  const byId = new Map<string, TableCell>()
  for (const cell of cells) if (cell.id && !byId.has(cell.id)) byId.set(cell.id, cell)
  const assigned = new Map<TableCell, TableCell[]>(cells.filter((cell) => cell.header).map((cell) => [cell, []]))
  for (const principal of cells) {
    const list = new Set<TableCell>()
    if (principal.headers.length > 0) {
      for (const id of principal.headers) {
        const header = byId.get(id)
        if (header) list.add(header)
      }
    } else {
      for (let y = principal.y; y < principal.y + principal.h; y++) scan(principal, list, principal.x, y, -1, 0)
      for (let x = principal.x; x < principal.x + principal.w; x++) scan(principal, list, x, principal.y, 0, -1)
      for (const header of [...list]) if (header.empty) list.delete(header)
    }
    list.delete(principal)
    for (const header of list) assigned.get(header)?.push(principal)
  }
  return assigned
}

function nodeAt(index: TreeIndex, ref: string): A11yNode | undefined {
  return index.get(ref)?.node
}

const textOf = (node: A11yNode | undefined) => truncate((node ? subtreeText(node) || node.name || '' : '').trim(), 80)

/** A table the browser exposes as one: not hidden, and not turned into layout by role="presentation". */
function exposedTable(node: A11yNode): boolean {
  return !isHidden(node) && node.native.presentational !== true && node.role !== 'presentation' && node.role !== 'none'
}

// 1.3.1, ACT d0f69e: every header cell heads at least one cell.

export const tableHeadersRule: RuleCheck = {
  id: 'rampa/table-header-cells',
  version: '1',
  criteria: ['1.3.1'],
  maturity: 'experimental',
  surfaces: ['web'],
  act: ['d0f69e'],
  engineRules: ['th-has-data-cells', 'td-headers-attr'],
  help: {
    en: 'A table header cell must head at least one cell (ACT d0f69e)',
    'pt-BR': 'Uma célula de cabeçalho de tabela precisa encabeçar pelo menos uma célula (ACT d0f69e)',
  },
  helpUrl: 'https://www.w3.org/WAI/standards-guidelines/act/rules/d0f69e/',
  run(snapshot, _engine, ctx) {
    const hits: Hit[] = []
    let applicable = 0
    for (const node of walkTree(snapshot.root)) {
      const table = tableFactsOf(node)
      if (!table || table.truncated || !exposedTable(node)) continue
      const targets = table.cells.filter((cell) => cell.header && HEADER_ROLES.has(cell.role) && !cell.hidden && !cell.empty)
      if (targets.length === 0) continue
      applicable += targets.length
      const assigned = assignedCells(table.cells)
      // Header only, nothing at all under the headers yet (a list still loading), or busy: a person decides.
      const hasData = table.cells.some((cell) => !cell.header)
      const unsure = table.busy || !hasData || table.cells.some((cell) => cell.scope === 'rowgroup' || cell.scope === 'colgroup')
      for (const target of targets) {
        const cells = (assigned.get(target) ?? []).filter((cell) => CELL_ROLES.has(cell.role))
        if (cells.length > 0) continue
        const text = textOf(nodeAt(ctx.index, target.ref))
        const why = table.busy ? 'busy' : !hasData ? 'header-only' : 'unassigned'
        hits.push({
          ref: target.ref,
          outcome: unsure ? 'review' : 'fail',
          subject: text || target.ref,
          evidence: text ? `<th>${text}</th>` : undefined,
          facts: { text, why },
        })
      }
    }
    return { hits, applicable }
  },
  message(hit, locale) {
    const text = hit.facts.text ? `"${hit.facts.text}"` : ''
    if (hit.facts.why === 'busy' || hit.facts.why === 'header-only') {
      return locale === 'pt-BR'
        ? `O cabeçalho ${text} não encabeça nenhuma célula, mas a tabela ${hit.facts.why === 'busy' ? 'está marcada como carregando (aria-busy)' : 'só tem cabeçalhos'}: confira se os dados ainda vão aparecer.`
        : `The header cell ${text} heads no cell, but the table ${hit.facts.why === 'busy' ? 'is marked as loading (aria-busy)' : 'holds only headers'}: check whether its data is still to come.`
    }
    return locale === 'pt-BR'
      ? `O cabeçalho ${text} não encabeça nenhuma célula: nenhuma célula da linha ou da coluna dele está associada a ele, então o leitor de tela o anuncia sem nada (ACT d0f69e).`
      : `The header cell ${text} heads no cell: no cell in its row or column is associated with it, so a screen reader announces it with nothing under it (ACT d0f69e).`
  },
}

// 1.3.1, F46 and F92: a table turned into layout that still carries data-table structure.

export const presentationalTableRule: RuleCheck = {
  id: 'rampa/presentational-table',
  version: '1',
  criteria: ['1.3.1'],
  maturity: 'experimental',
  surfaces: ['web'],
  act: [],
  engineRules: [],
  help: {
    en: 'A table marked as layout (role="presentation") must not keep header cells, a caption or a summary (F46, F92)',
    'pt-BR': 'Uma tabela marcada como layout (role="presentation") não pode manter cabeçalhos, legenda ou resumo (F46, F92)',
  },
  helpUrl: 'https://www.w3.org/WAI/WCAG22/Techniques/failures/F46',
  run(snapshot) {
    const hits: Hit[] = []
    let applicable = 0
    for (const node of walkTree(snapshot.root)) {
      const table = tableFactsOf(node)
      // Only a role the browser keeps: with focus or a global ARIA attribute, it is a table again.
      if (!table || table.kind !== 'html' || node.native.presentational !== true || isHidden(node)) continue
      applicable++
      const headers = table.cells.filter((cell) => cell.header && !cell.hidden && !cell.empty)
      const kept = [
        headers.length > 0 ? `${headers.length} <th>` : undefined,
        table.caption ? `<caption>${truncate(table.caption, 60)}</caption>` : undefined,
        table.summary ? `summary="${truncate(table.summary, 60)}"` : undefined,
      ].filter((part): part is string => part !== undefined)
      if (kept.length === 0) continue
      hits.push({ ref: node.ref, outcome: 'fail', subject: kept.join(', '), evidence: `role="${attributesOf(node).role}" · ${kept.join(', ')}`, facts: { kept: kept.join(', ') }, html: startTagOf(node) })
    }
    return { hits, applicable }
  },
  message(hit, locale) {
    return locale === 'pt-BR'
      ? `Esta tabela está marcada como layout (role="presentation"), mas mantém ${hit.facts.kept}: o leitor de tela descarta a estrutura, e os cabeçalhos deixam de se relacionar com os dados. Se é uma tabela de dados, tire o role; se é de layout, use td e nenhuma legenda.`
      : `This table is marked as layout (role="presentation") but keeps ${hit.facts.kept}: screen readers drop its structure, so the headers no longer relate to the data. If it is a data table, remove the role; if it is a layout table, use td and no caption.`
  },
}

// 1.3.1, the narrow case of F111: a label beside one field, tied to nothing.

const FIELD_TAGS = new Set(['input', 'select', 'textarea'])
const NOT_FIELDS = new Set(['hidden', 'submit', 'reset', 'button', 'image'])

function isField(node: A11yNode): boolean {
  const tag = typeof node.native.tag === 'string' ? node.native.tag : ''
  return FIELD_TAGS.has(tag) && !NOT_FIELDS.has((attributesOf(node).type ?? '').toLowerCase()) && !isHidden(node) && !node.states.includes('hidden')
}

export const orphanLabelRule: RuleCheck = {
  id: 'rampa/orphan-label',
  version: '1',
  criteria: ['1.3.1'],
  maturity: 'experimental',
  surfaces: ['web'],
  act: [],
  engineRules: ['label', 'select-name', 'label-title-only'],
  help: {
    en: 'A visible label must be tied to its field (for, nesting or aria-labelledby), so the field is announced with it',
    'pt-BR': 'Um rótulo visível precisa estar ligado ao campo (for, aninhamento ou aria-labelledby), para o campo ser anunciado com ele',
  },
  helpUrl: `${UNDERSTANDING}info-and-relationships.html`,
  run(snapshot, _engine, ctx) {
    const hits: Hit[] = []
    let applicable = 0
    const nodes = [...walkTree(snapshot.root)]
    const referenced = new Set(nodes.flatMap((node) => (attributesOf(node)['aria-labelledby'] ?? '').split(/\s+/).filter(Boolean)))
    for (const label of nodes) {
      // Only labels the collector read: labelControl is null when the label labels nothing.
      if (label.native.tag !== 'label' || label.native.labelControl !== null || isHidden(label) || label.states.includes('offscreen')) continue
      const text = subtreeText(label)
      if (text === '' || [...walkTree(label)].some((inner) => inner !== label && FIELD_TAGS.has(String(inner.native.tag)))) continue
      const id = attributesOf(label).id
      if (id && referenced.has(id)) continue
      const parentRef = ctx.index.get(label.ref)?.parentRef
      const parent = parentRef ? nodeAt(ctx.index, parentRef) : undefined
      if (!parent) continue
      const fields = [...walkTree(parent)].filter(isField)
      // Exactly one field beside it, and no other label for it to belong to.
      const labels = [...walkTree(parent)].filter((node) => node.native.tag === 'label' && subtreeText(node) !== '')
      if (fields.length !== 1 || labels.length !== 1) continue
      applicable++
      const field = fields[0] as A11yNode
      if (normalizeForMatch(field.name ?? '').includes(normalizeForMatch(text))) continue
      hits.push({
        ref: field.ref,
        outcome: 'fail',
        subject: text,
        evidence: `<label>${truncate(text, 60)}</label>`,
        facts: { label: truncate(text, 60), name: field.name?.trim() ?? '', labelRef: label.ref, labelTag: startTagOf(label), fieldId: attributesOf(field).id ?? '' },
        html: startTagOf(field),
      })
    }
    return { hits, applicable }
  },
  message(hit, locale) {
    const name = String(hit.facts.name)
    if (locale === 'pt-BR') {
      return `O rótulo "${hit.facts.label}" está ao lado deste campo, mas não ligado a ele: o leitor de tela anuncia o campo ${name ? `como "${name}"` : 'sem nome'}, sem o rótulo.`
    }
    return `The label "${hit.facts.label}" sits beside this field but is not tied to it: a screen reader announces the field ${name ? `as "${name}"` : 'with no name'}, without the label.`
  },
  patch(hit): Patch | undefined {
    const id = String(hit.facts.fieldId)
    if (!id) return undefined
    const before = String(hit.facts.labelTag)
    return { ref: String(hit.facts.labelRef), kind: 'set-attribute', attribute: 'for', to: id, before, after: withAttribute(before, 'for', id) }
  },
}

// 4.1.2: an id used twice, so a name or a description comes from the other element.

const REFERENCES = ['aria-labelledby', 'aria-describedby', 'for'] as const

function depthOf(index: TreeIndex, ref: string): string[] {
  const path: string[] = []
  let current: string | undefined = ref
  while (current) {
    path.unshift(current)
    current = index.get(current)?.parentRef
  }
  return path
}

/** How far apart two elements sit: steps up to their closest common ancestor, from the first. */
function distance(index: TreeIndex, a: string, b: string): number {
  const pa = depthOf(index, a)
  const pb = depthOf(index, b)
  let common = 0
  while (common < pa.length && common < pb.length && pa[common] === pb[common]) common++
  return pa.length - common
}

export const duplicateIdReferenceRule: RuleCheck = {
  id: 'rampa/duplicate-id-reference',
  version: '1',
  criteria: ['4.1.2'],
  maturity: 'experimental',
  surfaces: ['web'],
  act: [],
  engineRules: [],
  help: {
    en: 'An id that names or describes an element must be unique, or the name comes from the wrong element',
    'pt-BR': 'Um id que dá nome ou descrição a um elemento precisa ser único, senão o nome vem do elemento errado',
  },
  helpUrl: `${UNDERSTANDING}name-role-value.html`,
  run(snapshot, _engine, ctx) {
    const hits: Hit[] = []
    let applicable = 0
    const nodes = [...walkTree(snapshot.root)]
    const byId = new Map<string, A11yNode[]>()
    for (const node of nodes) {
      const id = attributesOf(node).id
      if (id) byId.set(id, [...(byId.get(id) ?? []), node])
    }
    for (const node of nodes) {
      if (isHidden(node)) continue
      const attributes = attributesOf(node)
      for (const attribute of REFERENCES) {
        if (attribute === 'for' && node.native.tag !== 'label') continue
        for (const id of (attributes[attribute] ?? '').split(/\s+/).filter(Boolean)) {
          const owners = byId.get(id) ?? []
          if (owners.length < 2) continue
          applicable++
          // The browser takes the first element with the id; the one beside the reference is the one meant.
          const used = owners[0] as A11yNode
          const nearest = [...owners].sort((a, b) => distance(ctx.index, node.ref, a.ref) - distance(ctx.index, node.ref, b.ref))[0] as A11yNode
          if (nearest === used || distance(ctx.index, node.ref, nearest.ref) >= distance(ctx.index, node.ref, used.ref)) continue
          // A label can only mean a field.
          if (attribute === 'for' && !isField(nearest)) continue
          const usedText = textOf(used)
          const meantText = textOf(nearest)
          // The same text either way changes nothing a person hears.
          if (attribute !== 'for' && normalizeForMatch(usedText) === normalizeForMatch(meantText)) continue
          hits.push({
            ref: node.ref,
            outcome: 'fail',
            subject: `${attribute}=${id}`,
            evidence: `${attribute}="${id}" · ${owners.length} elements have id="${id}"`,
            facts: { attribute, id, count: owners.length, used: usedText, meant: meantText },
            html: startTagOf(node),
          })
        }
      }
    }
    return { hits, applicable }
  },
  message(hit, locale) {
    const what = hit.facts.attribute === 'aria-describedby' ? { en: 'description', 'pt-BR': 'descrição' } : { en: 'name', 'pt-BR': 'nome' }
    if (hit.facts.attribute === 'for') {
      return locale === 'pt-BR'
        ? `${hit.facts.count} elementos têm id="${hit.facts.id}": este rótulo nomeia o primeiro deles, não o campo ao lado dele. Dê a cada campo um id único.`
        : `${hit.facts.count} elements have id="${hit.facts.id}": this label names the first of them, not the field beside it. Give each field a unique id.`
    }
    return locale === 'pt-BR'
      ? `${hit.facts.count} elementos têm id="${hit.facts.id}": a ${what['pt-BR']} deste elemento vem do primeiro ("${hit.facts.used}"), não do que está ao lado dele ("${hit.facts.meant}"). Dê a cada um um id único.`
      : `${hit.facts.count} elements have id="${hit.facts.id}": this element's ${what.en} comes from the first of them ("${hit.facts.used}"), not from the one beside it ("${hit.facts.meant}"). Give each a unique id.`
  },
}

export const STRUCTURE_RULES: readonly RuleCheck[] = [tableHeadersRule, presentationalTableRule, orphanLabelRule, duplicateIdReferenceRule]

/** For tests and tools: the snapshot nodes that carry a recorded table. */
export function tablesOf(snapshot: A11ySnapshot): A11yNode[] {
  return [...walkTree(snapshot.root)].filter((node) => tableFactsOf(node) !== undefined)
}

// Writes the JSON Schema of the normalized snapshot: the contract any platform
// exporter (Android, iOS, desktop) implements to feed `rampa check snapshot.json`.
import { mkdir, writeFile } from 'node:fs/promises'
import { z } from 'zod'
import { A11ySnapshotSchema } from '../src/snapshot/schema.ts'

const schema = z.toJSONSchema(A11ySnapshotSchema, { target: 'draft-2020-12' })
await mkdir('schema', { recursive: true })
await writeFile(
  'schema/snapshot.schema.json',
  `${JSON.stringify({ $id: 'https://github.com/guilhermebsantiago/rampa-cli/schema/snapshot.schema.json', title: 'Rampa accessibility snapshot', ...schema }, null, 2)}\n`,
  'utf8',
)
console.log('schema/snapshot.schema.json written')

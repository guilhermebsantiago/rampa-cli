import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { errorMessage } from '../../core/util.ts'
import { Hunspell, type WordList } from './hunspell.ts'

/**
 * The Hunspell dictionaries the abbreviation check reads to tell a word in capitals (ENTRAR) from an
 * acronym (CPF). Like the ACT test cases, they are downloaded at run time from LibreOffice's dictionary
 * repository at a pinned commit, checked against the hashes below, cached, and never redistributed:
 * pt_BR is VERO (LGPLv3 or MPL), en_US comes from SCOWL. Without a dictionary the check says so and
 * does not run for that language, instead of guessing.
 */

export type DictionaryLanguage = 'pt-BR' | 'en'

const COMMIT = '32b006a2c22a4ac7e8ed3f03346f7b3d85a970a4'
const BASE = `https://raw.githubusercontent.com/LibreOffice/dictionaries/${COMMIT}`

interface DictionaryFile {
  path: string
  sha256: string
}

export const DICTIONARIES: Record<DictionaryLanguage, { aff: DictionaryFile; dic: DictionaryFile }> = {
  'pt-BR': {
    aff: { path: 'pt_BR/pt_BR.aff', sha256: '21d8ad2a769a60e17e2b5ea4ef11d4d593a58b9e2a82d642ef82d6a4c5523865' },
    dic: { path: 'pt_BR/pt_BR.dic', sha256: 'a38bfb26b68ece2834e79fe83e48d5792652970ace12db89d1b9674bf9933183' },
  },
  en: {
    aff: { path: 'en/en_US.aff', sha256: 'e746c882dd6f303c2c46e7452804b9201115a6942cfeb15f18f8edf774d2e24e' },
    dic: { path: 'en/en_US.dic', sha256: 'f0b1a234bd178bdd01875b2a392a9647f888b8fe879f79c52aae62c2759b3647' },
  },
}

/** Loads a dictionary for a language; undefined or a rejection means the check cannot read that language. */
export type DictionarySource = (language: DictionaryLanguage) => Promise<WordList>

export const DICTIONARY_DIR = '.rampa/dictionaries'

const loaded = new Map<string, Promise<WordList>>()

/** Downloads once per machine (cached in `dir`) and parses once per process. */
export function downloadedDictionaries(dir = DICTIONARY_DIR): DictionarySource {
  return (language) => {
    const key = `${dir}|${language}`
    let found = loaded.get(key)
    if (!found) {
      found = load(language, dir)
      // A failure is not cached: the next run tries again.
      found.catch(() => loaded.delete(key))
      loaded.set(key, found)
    }
    return found
  }
}

async function load(language: DictionaryLanguage, dir: string): Promise<WordList> {
  const files = DICTIONARIES[language]
  const [aff, dic] = await Promise.all([fetchVerified(files.aff, dir), fetchVerified(files.dic, dir)])
  return new Hunspell(aff, dic)
}

async function fetchVerified(file: DictionaryFile, dir: string): Promise<string> {
  const path = join(dir, file.path.split('/').at(-1) ?? file.path)
  const cached = await readFile(path).catch(() => undefined)
  if (cached && sha256(cached) === file.sha256) return cached.toString('utf8')
  let bytes: Buffer
  try {
    const response = await fetch(`${BASE}/${file.path}`, { signal: AbortSignal.timeout(60_000) })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    bytes = Buffer.from(await response.arrayBuffer())
  } catch (error) {
    throw new Error(`could not download ${file.path} (${errorMessage(error)})`)
  }
  if (sha256(bytes) !== file.sha256) throw new Error(`${file.path} does not match its pinned hash`)
  await mkdir(dir, { recursive: true })
  await writeFile(path, bytes)
  return bytes.toString('utf8')
}

function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex')
}

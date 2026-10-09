/**
 * The curated lists behind the abbreviation check, per language. They are a seed: the plan has a
 * plain-language editor review them (docs/plans/cognitive-profile.md, ANN-1), and the version below
 * keys the cache and goes into every report.
 *
 * - `common`: abbreviations more common than their full term. COGA o3p01 asks to explain an abbreviation
 *   "unless the abbreviation is more common than the full term", so these never become COGA advisories;
 *   WCAG 3.1.4 (AAA) still asks for a way to find their expanded form, which is reported beyond the target.
 * - `expansions`: one meaning each, as the body that owns the name publishes it. Only these, or an
 *   expansion the page itself writes, ever become a patch; ambiguous ones (MP: Ministério Público or
 *   Medida Provisória) are left out on purpose.
 */

export const LISTS_VERSION = '1'

export interface AbbreviationList {
  common: ReadonlySet<string>
  expansions: ReadonlyMap<string, string>
}

const PT_EXPANSIONS: Record<string, string> = {
  BPC: 'Benefício de Prestação Continuada',
  CadÚnico: 'Cadastro Único',
  CEP: 'Código de Endereçamento Postal',
  CLT: 'Consolidação das Leis do Trabalho',
  CNH: 'Carteira Nacional de Habilitação',
  CNPJ: 'Cadastro Nacional da Pessoa Jurídica',
  CNS: 'Cartão Nacional de Saúde',
  CPF: 'Cadastro de Pessoas Físicas',
  CRAS: 'Centro de Referência de Assistência Social',
  CREAS: 'Centro de Referência Especializado de Assistência Social',
  CTPS: 'Carteira de Trabalho e Previdência Social',
  DARF: 'Documento de Arrecadação de Receitas Federais',
  ENEM: 'Exame Nacional do Ensino Médio',
  // An English acronym Brazilian sites write next to its translation.
  FAQ: 'Perguntas Frequentes',
  FGTS: 'Fundo de Garantia do Tempo de Serviço',
  FIES: 'Fundo de Financiamento Estudantil',
  IBGE: 'Instituto Brasileiro de Geografia e Estatística',
  INSS: 'Instituto Nacional do Seguro Social',
  IPTU: 'Imposto Predial e Territorial Urbano',
  IPVA: 'Imposto sobre a Propriedade de Veículos Automotores',
  IRPF: 'Imposto sobre a Renda das Pessoas Físicas',
  LGPD: 'Lei Geral de Proteção de Dados Pessoais',
  MEI: 'Microempreendedor Individual',
  NIS: 'Número de Identificação Social',
  PIS: 'Programa de Integração Social',
  RG: 'Registro Geral',
  SISU: 'Sistema de Seleção Unificada',
  SUS: 'Sistema Único de Saúde',
  UBS: 'Unidade Básica de Saúde',
}

const EN_EXPANSIONS: Record<string, string> = {
  ATM: 'automated teller machine',
  DOB: 'date of birth',
  DVLA: 'Driver and Vehicle Licensing Agency',
  EIN: 'Employer Identification Number',
  EU: 'European Union',
  FAQ: 'frequently asked questions',
  GPS: 'Global Positioning System',
  HMRC: "His Majesty's Revenue and Customs",
  IRS: 'Internal Revenue Service',
  ITIN: 'Individual Taxpayer Identification Number',
  NHS: 'National Health Service',
  PIN: 'personal identification number',
  SSN: 'Social Security Number',
  UK: 'United Kingdom',
  USA: 'United States of America',
  VAT: 'value added tax',
}

export const LISTS: Record<'pt' | 'en', AbbreviationList> = {
  pt: {
    common: new Set(['CPF', 'CEP', 'RG', 'CNH', 'SUS', 'INSS', 'FGTS', 'IPTU', 'IPVA', 'ENEM', 'CNPJ', 'PIX', 'DDD', 'SMS', 'TV', 'OK', 'ONG', 'ONU']),
    expansions: new Map(Object.entries(PT_EXPANSIONS)),
  },
  en: {
    common: new Set(['OK', 'TV', 'US', 'USA', 'UK', 'EU', 'ID', 'PIN', 'ATM', 'DVD', 'USB', 'FAQ', 'ZIP', 'GPS', 'PC', 'AM', 'PM']),
    expansions: new Map(Object.entries(EN_EXPANSIONS)),
  },
}

/** Brazilian state codes: on a Brazilian page "SP" is São Paulo, not an abbreviation to explain. */
export const BR_STATES = new Set('AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO BR'.split(' '))

/** US state codes, excluded only where an address writes them: "Springfield, IL". */
export const US_STATES = new Set(
  'AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY DC'.split(' '),
)

export const FILE_FORMATS = new Set(
  'PDF DOC DOCX XLS XLSX CSV ODT ODS ODP PPT PPTX TXT RTF XML JSON HTML HTM JPG JPEG PNG GIF SVG WEBP ZIP RAR MP3 MP4 AVI MOV WAV EPUB KML KMZ SHP'.split(' '),
)

/** Units, excluded only after a number: "100 KM", "8 GB". */
export const UNITS = new Set('KB MB GB TB PB KBPS MBPS GBPS KM KG ML MM CM MHZ GHZ KHZ HZ KW KWH MW MWH GW KV MAH DB RPM BTU PSI MPH KMH'.split(' '))

/** Currencies most pages name without a number next to them. Any ISO 4217 code next to a number is a currency too. */
export const COMMON_CURRENCIES = new Set('BRL USD EUR GBP JPY CAD AUD CHF CNY ARS'.split(' '))

export const CURRENCIES = new Set(Intl.supportedValuesOf('currency'))

/** Roman numerals; with L, C, D or M only after a word that numbers something (inciso, capítulo, part). */
const ROMAN = /^M{0,3}(?:CM|CD|D?C{0,3})(?:XC|XL|L?X{0,3})(?:IX|IV|V?I{0,3})$/
const NUMBERING = /(?:inciso|incisos|cap[ií]tulo|cap\.|t[ií]tulo|anexo|se[çc][ãa]o|parte|livro|s[ée]culo|art\.|artigo|item|al[ií]nea|volume|vol\.|fase|etapa|lote|edi[çc][ãa]o|chapter|part|section|book|annex|appendix|century|war|phase|stage|grade|level)\s*$/i

export function isRomanNumeral(token: string, before: string): boolean {
  if (!ROMAN.test(token)) return false
  if (/^[IVX]+$/.test(token)) return true
  return NUMBERING.test(before)
}

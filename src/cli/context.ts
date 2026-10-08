import type { RampaConfig } from '../config.ts'
import type { Locale } from '../i18n.ts'

export interface GlobalContext {
  locale: Locale
  motion: boolean | undefined
  config: RampaConfig
}

import type { Page } from 'playwright-core'

/**
 * Corrupted pairs, after López-Gil & Pereira (2025): take a case that passes,
 * break it on purpose, and check that the verdict flips. A tool that gives
 * both versions the same verdict is not judging.
 */

/** A valid tag for a different language, so the engine's syntax check still passes. */
export const LANGUAGE_SWAP: Readonly<Record<string, string>> = {
  nl: 'es',
  es: 'nl',
  en: 'de',
  de: 'en',
  fr: 'it',
  it: 'fr',
  pt: 'fi',
  fi: 'pt',
  ja: 'ko',
  ko: 'ja',
  zh: 'ja',
  ar: 'he',
  he: 'ar',
}

export interface Corruptor {
  id: string
  criterion: string
  /** Mutates the live page; returns how many elements were changed (0 = no pair). */
  apply(page: Page): Promise<number>
}

/** 3.1.2: swap the lang of every element that has enough text to judge. */
export const langSwap: Corruptor = {
  id: 'lang-swap',
  criterion: '3.1.2',
  async apply(page) {
    return page.evaluate((swap: Record<string, string>) => {
      let changed = 0
      for (const element of Array.from(document.querySelectorAll('body [lang]'))) {
        const declared = (element.getAttribute('lang') ?? '').trim()
        const letters = (element.textContent ?? '').match(/\p{L}/gu)?.length ?? 0
        if (declared === '' || letters < 4) continue
        const primary = declared.split('-')[0]?.toLowerCase() ?? ''
        element.setAttribute('lang', swap[primary] ?? (primary === 'es' ? 'nl' : 'es'))
        changed++
      }
      return changed
    }, LANGUAGE_SWAP)
  },
}

/** 1.1.1: replace every non-empty alt with a placeholder, the "img-1" case. */
export const altPlaceholder: Corruptor = {
  id: 'alt-placeholder',
  criterion: '1.1.1',
  async apply(page) {
    return page.evaluate(() => {
      let changed = 0
      for (const [index, image] of Array.from(document.querySelectorAll('img[alt]')).entries()) {
        if ((image.getAttribute('alt') ?? '').trim() === '') continue
        image.setAttribute('alt', `img-${index + 1}`)
        changed++
      }
      return changed
    })
  },
}

/** 1.1.1: replace every non-empty alt with a fluent description of something else. */
export const altSwap: Corruptor = {
  id: 'alt-swap',
  criterion: '1.1.1',
  async apply(page) {
    return page.evaluate(() => {
      let changed = 0
      for (const image of Array.from(document.querySelectorAll('img[alt]'))) {
        if ((image.getAttribute('alt') ?? '').trim() === '') continue
        image.setAttribute('alt', 'A bowl of fresh fruit on a wooden kitchen table')
        changed++
      }
      return changed
    })
  },
}

export const CORRUPTORS: Readonly<Record<string, Corruptor[]>> = {
  '1.1.1': [altPlaceholder, altSwap],
  '3.1.2': [langSwap],
}

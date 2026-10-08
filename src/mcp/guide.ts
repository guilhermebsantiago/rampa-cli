import { createRequire } from 'node:module'
import type { AnyCriterion } from '../core/types.ts'
import { AXE_TAGS } from '../engine/axe.ts'
import { criterionFromAxeTag, successCriterion } from '../wcag.ts'

/**
 * What an agent needs to understand a criterion without calling a model: the WCAG text,
 * what axe-core checks, what Rampa judges on top, and how to fix a failure.
 *
 * The normative text is quoted from WCAG 2.1 (https://www.w3.org/TR/WCAG21/),
 * Copyright © W3C, under the W3C Document License. Everything else is Rampa's own wording.
 */

export interface CriterionGuide {
  /** Normative text, quoted. */
  wcag: string
  /** Context for the quote, in Rampa's words. */
  note?: string | undefined
  axeChecks: string
  rampaJudges: string
  example: string
  failsWhen: string[]
  fix: string[]
}

/** Guides for the criteria with a judgment module. A criterion added later without one still gets a generic explanation. */
export const GUIDES: Readonly<Record<string, CriterionGuide>> = {
  '1.1.1': {
    wcag: 'All non-text content that is presented to the user has a text alternative that serves the equivalent purpose, except for the situations listed below.',
    note: 'The exceptions cover controls and inputs, time-based media, tests, sensory experiences, CAPTCHA, and content that is pure decoration, formatting or invisible, which must be hidden from assistive technology.',
    axeChecks: 'that an image has a text alternative at all',
    rampaJudges: 'whether a non-empty alternative serves the same purpose as the image, seen as it renders; inside a link or a button, whether it conveys the destination or the action',
    example: 'alt="img-1" on a photo of a dog',
    failsWhen: [
      'the alternative is a file name, an id or a placeholder, such as "img-1" or "IMG_2034.jpg"',
      'it is a category word that says nothing about this image, such as "product"',
      'it names things the image does not show',
      'it leaves out what the image conveys here, such as where a linked image goes',
      'the image is decorative but has a name, so screen readers announce it',
    ],
    fix: [
      'Write the alternative for the purpose the image serves on this page: what a person would need if they could not see it.',
      'Keep it short (under about 125 characters) and leave out "image of" or "picture of"; screen readers already say it is an image.',
      'For a linked image or an image button, name the destination or the action ("Corner Store home"), not the picture.',
      'For a purely decorative image, use alt="" with no title or aria-label, so screen readers skip it.',
      'For a chart or another complex image, give a short alternative and put the full information in nearby text.',
      "Rampa's suggested alternative describes what a model saw: have a person review it before it ships.",
    ],
  },
  '2.4.2': {
    wcag: 'Web pages have titles that describe topic or purpose.',
    axeChecks: 'that the page has a non-empty title',
    rampaJudges: 'whether the title describes this page, read against its headings and opening text',
    example: '<title>Untitled document</title>',
    failsWhen: [
      'the title is generic, such as "Untitled document", "Home" or "Page"',
      'it is a file name or an address',
      'it names a different subject than the page',
    ],
    fix: [
      'Give each page a <title> that names its topic or purpose, most specific part first: "Shipping and returns | Corner Store".',
      'In a single-page app, update document.title whenever the view changes.',
      'Keep it short enough for a browser tab and a search result, under about 70 characters.',
    ],
  },
  '2.4.4': {
    wcag: 'The purpose of each link can be determined from the link text alone or from the link text together with its programmatically determined link context, except where the purpose of the link would be ambiguous to users in general.',
    note: 'The programmatically determined link context is the text of the same sentence, paragraph, list item or table cell, the heading the link sits under, and the description from aria-describedby.',
    axeChecks: 'that a link has an accessible name',
    rampaJudges: 'whether the link text, with its sentence, paragraph, list item, cell or heading, tells where the link goes or what it does',
    example: 'a lone "Click here"',
    failsWhen: [
      'the text is generic, such as "click here", "read more" or "more", and nothing around it explains it',
      'the text is a raw address or a file name',
      'the text names something other than what the link leads to',
    ],
    fix: [
      'Make the link text name the destination or the action: "Shipping and returns" instead of "Click here".',
      'If the design needs a short visible text, put the context in the same sentence, list item, table cell or heading, or add it with aria-describedby or visually hidden text inside the link.',
      'If you set the name with aria-label, keep the visible text in it, or speech users cannot say it (WCAG 2.5.3 Label in Name).',
    ],
  },
  '2.4.6': {
    wcag: 'Headings and labels describe topic or purpose.',
    note: 'The criterion does not require headings or labels to exist; when they exist, they must describe what they introduce.',
    axeChecks: 'that headings are not empty and form fields have a label',
    rampaJudges: 'whether a heading describes the content under it, and whether a label says what to enter or choose',
    example: '"Section 2" over customer reviews, "Field 1" on an email field',
    failsWhen: [
      'the text is a numbering or a placeholder word that names no subject, such as "Section 2", "Title" or "Field 1"',
      'it names a different subject than its content, or different data than its field asks for',
      'it is filler such as "Lorem ipsum"',
    ],
    fix: [
      'Rewrite the heading to name the subject of its section ("What customers say"), and the label to name the data to enter ("Email address").',
      'Keep both short: they need to describe, not explain.',
      'When several fields share a label, such as "Street" for billing and shipping, group them under a visible name (fieldset and legend) that tells them apart.',
    ],
  },
  '3.1.1': {
    wcag: 'The default human language of each Web page can be programmatically determined.',
    axeChecks: 'that the page declares a lang and that it is a valid language tag',
    rampaJudges: 'whether the declared lang is the language most of the page is written in',
    example: 'lang="en" on a page written in Portuguese',
    failsWhen: ['most of the text is written in a language other than the one on <html lang>'],
    fix: [
      'Set lang on the <html> element to the language most of the page is written in, such as <html lang="pt-BR">.',
      'In templates shared by several languages, set lang from the locale of each page, not as a fixed value.',
      'Mark passages in other languages with their own lang attribute (WCAG 3.1.2).',
    ],
  },
  '3.1.2': {
    wcag: 'The human language of each passage or phrase in the content can be programmatically determined except for proper names, technical terms, words of indeterminate language, and words or phrases that have become part of the vernacular of the immediately surrounding text.',
    axeChecks: 'that lang values are valid language tags',
    rampaJudges: 'whether each element with a lang attribute contains text in that language',
    example: 'a Dutch review marked lang="es"',
    failsWhen: ['an element declares one language and its text is clearly in another; proper names, technical terms and loanwords do not count'],
    fix: [
      'Set lang on the element to the language its text is written in, such as <blockquote lang="nl">.',
      'Wrap a passage in a language other than the page in an element with its own lang, such as <span lang="fr">.',
      'Leave proper names, technical terms and words that belong to the surrounding language unmarked.',
    ],
  },
}

/** `Non-text Content` becomes `non-text-content`, the slug of the W3C Understanding document. */
function slugOf(name: string): string {
  return name
    .toLowerCase()
    .replace(/[(),]/g, '')
    .replace(/\s+/g, '-')
}

export function understandingUrl(id: string): string | undefined {
  const sc = successCriterion(id)
  return sc ? `https://www.w3.org/WAI/WCAG21/Understanding/${slugOf(sc.name.en)}.html` : undefined
}

export function actRuleUrl(id: string): string {
  return `https://www.w3.org/WAI/standards-guidelines/act/rules/${id}/`
}

let axeRules: Map<string, string[]> | undefined

/**
 * axe-core rules that test each WCAG 2.1 A/AA criterion, from axe-core's own metadata.
 * Reading it needs no browser; it is loaded on first use, since only the criteria tools ask.
 * Disabled rules (deprecated or experimental) are left out: a check never runs them.
 */
export function axeRulesByCriterion(): Map<string, string[]> {
  if (axeRules) return axeRules
  const map = new Map<string, string[]>()
  try {
    const axe = createRequire(import.meta.url)('axe-core') as {
      getRules(tags?: string[]): Array<{ ruleId: string; tags: string[]; enabled?: boolean }>
    }
    for (const rule of axe.getRules(AXE_TAGS)) {
      if (rule.enabled === false) continue
      for (const id of new Set(rule.tags.flatMap((tag) => criterionFromAxeTag(tag) ?? []))) {
        if (!successCriterion(id)) continue
        map.set(id, [...(map.get(id) ?? []), rule.ruleId])
      }
    }
  } catch {
    // Without the metadata, criteria still list; only the rule names are missing.
  }
  axeRules = map
  return map
}

/** The engine rules of a criterion: those its judgment module builds on first, then the rest axe-core maps to it. */
export function engineRulesOf(id: string, criterion?: AnyCriterion): string[] {
  return [...new Set([...(criterion?.engineRules ?? []), ...(axeRulesByCriterion().get(id) ?? [])])]
}
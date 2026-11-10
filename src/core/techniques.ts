/**
 * The documented WCAG technique or failure each kind of claim applies, for the eight criteria Rampa judges by default.
 * A citation says which documented reading of the criterion a claim applies; it does not say the page fails WCAG. A
 * kind with no citation has none that fits, and is left empty rather than given a loose one. A judgment finding carries
 * the ids of its claim's kind (`Finding.techniques`, set in core/check.ts from `Criterion.claimKind`), and every report
 * format shows them with their titles (report/common.ts, `readingText`).
 *
 * Every page was read on w3.org on 2026-11-09, at the address its row carries (the Techniques for WCAG 2.2): the title is
 * copied from the page, the page lists the criterion among the success criteria it relates to, and what it describes
 * is what the claim says. The table can go stale; each row keeps its address so it can be read again.
 *
 * The kinds are those the studies name (`claim_kind` in study/human-review-2026-10/scripts/common.py), read from a
 * finding's message, with 1.1.1 split finer: an alternative that leaves out what the image conveys, a short one, and
 * an image that is all its link or button holds. Two of the studies' kinds hold more than one claim:
 * - `1.3.5 autocomplete` holds a missing token and a wrong one. F107 ("incorrect autocomplete attribute values") tests
 *   that a field "has an autocomplete attribute and value pair that does not match the purpose of the input", which a
 *   missing token is not, so only H98, whose test covers both, is cited.
 * - the studies read every 3.3.2 finding as `3.3.2 label_not_visible`. H44 fits the claim that a field's label does
 *   not show ("Check that the label element is visible"); it does not fit a pattern or a date format that nothing on
 *   screen explains, or a group with no legend. Those claims have no key here, and must not be keyed as this one.
 *
 * Titles are the W3C's own, in English. The Portuguese gloss is this project's wording, not a W3C translation: the
 * W3C's list of WAI translations (https://www.w3.org/WAI/translations/, read 2026-11-09) has authorized Brazilian
 * Portuguese translations of WCAG 2.2 and 2.0 themselves, and none of the Techniques.
 */

export type TechniqueId = string

export interface Technique {
  id: TechniqueId
  type: 'technique' | 'failure'
  /** The W3C's own title, in English, copied from the technique's page. */
  title: string
  /** A short gloss in Brazilian Portuguese: this project's wording, not a W3C translation. */
  gloss: string
  /** https://www.w3.org/WAI/WCAG22/Techniques/<html|general|failures|aria|css>/<ID> */
  url: string
}

const BASE = 'https://www.w3.org/WAI/WCAG22/Techniques'

function technique(id: TechniqueId, folder: 'html' | 'general' | 'failures' | 'aria' | 'css', title: string, gloss: string): Technique {
  return { id, type: folder === 'failures' ? 'failure' : 'technique', title, gloss, url: `${BASE}/${folder}/${id}` }
}

export const TECHNIQUES: Readonly<Record<TechniqueId, Technique>> = Object.fromEntries(
  [
    technique(
      'F30',
      'failures',
      'Failure of Success Criterion 1.1.1 and 1.2.1 due to using text alternatives that are not alternatives (e.g., filenames or placeholder text)',
      'Falha: um texto alternativo que não é alternativa, como um nome de arquivo ou um placeholder.',
    ),
    technique(
      'G94',
      'general',
      'Providing short text alternative for non-text content that serves the same purpose and presents the same information as the non-text content',
      'Um texto alternativo curto que cumpre o mesmo propósito e passa a mesma informação do conteúdo não textual.',
    ),
    technique(
      'H30',
      'html',
      'Providing link text that describes the purpose of a link for anchor elements',
      'Um texto do link que diz a finalidade dele; num link que só tem uma imagem, o texto alternativo dela diz essa finalidade.',
    ),
    technique('H36', 'html', 'Using alt attributes on images used as submit buttons', 'O atributo alt numa imagem usada como botão de envio, que diz o que o botão faz.'),
    technique(
      'F39',
      'failures',
      'Failure of Success Criterion 1.1.1 due to providing a text alternative that is not null (e.g., alt="spacer" or alt="image") for images that should be ignored by assistive technology',
      'Falha: um texto alternativo não vazio (como alt="spacer" ou alt="image") numa imagem que as tecnologias assistivas deveriam ignorar.',
    ),
    technique(
      'H67',
      'html',
      'Using null alt text and no title attribute on img elements for images that assistive technology should ignore',
      'alt vazio e nenhum atributo title numa imagem que as tecnologias assistivas devem ignorar.',
    ),
    technique(
      'H81',
      'html',
      'Identifying the purpose of a link in a nested list using link text combined with the parent list item under which the list is nested',
      'A finalidade de um link numa lista aninhada, dada pelo texto do link junto com o item de lista sob o qual a lista está.',
    ),
    technique(
      'H80',
      'html',
      'Identifying the purpose of a link using link text combined with the preceding heading element',
      'A finalidade de um link dada pelo texto do link junto com o título que vem antes dele.',
    ),
    technique('G91', 'general', 'Providing link text that describes the purpose of a link', 'Um texto do link que diz a finalidade do link.'),
    technique('G130', 'general', 'Providing descriptive headings', 'Títulos que descrevem a seção que abrem.'),
    technique('G131', 'general', 'Providing descriptive labels', 'Rótulos que deixam claro para que serve cada campo ou controle.'),
    technique(
      'F25',
      'failures',
      'Failure of Success Criterion 2.4.2 due to the title of a web page not identifying the contents',
      'Falha: o título da página não identifica o conteúdo dela.',
    ),
    technique('G88', 'general', 'Providing descriptive titles for web pages', 'Títulos de página que descrevem a página.'),
    technique('H57', 'html', 'Using the language attribute on the HTML element', 'O atributo lang no elemento html, com o idioma da página.'),
    technique('H58', 'html', 'Using language attributes to identify changes in the human language', 'O atributo lang para marcar cada trecho em outro idioma.'),
    technique('H98', 'html', 'Using HTML autocomplete attributes', 'O atributo autocomplete do HTML nos campos que pedem dados de quem preenche.'),
    technique(
      'H44',
      'html',
      'Using label elements to associate text labels with form controls',
      'O elemento label para ligar um rótulo de texto a cada campo do formulário.',
    ),
  ].map((entry) => [entry.id, entry]),
)

/** Keyed "<criterion> <kind>", the kind as the studies name it. At most two ids per kind, the most specific first. */
export const CLAIM_TECHNIQUES: Readonly<Record<string, readonly TechniqueId[]>> = {
  // F30: the text "cannot be used in place of the non-text content without losing information or function". A file
  // name, a placeholder or a lone category word ("product") is that.
  '1.1.1 placeholder': ['F30'],
  '1.1.1 generic': ['F30'],
  // G94's test: "Remove, hide, or mask the non-text content. Replace it with the text alternative. Check that nothing
  // is lost". G94 also says the alternative "should not necessarily describe the non-text content", so "does not
  // describe the image" (a short alternative) is read as that test, not as a request for a description.
  '1.1.1 wrong_content': ['G94'],
  '1.1.1 missing_information': ['G94'],
  '1.1.1 short_alternative': ['G94'],
  // H30: "If an img element is the only content of the a element, check that its text alternative describes the
  // purpose of the link." H36: "Check that the value of the alt attribute describes the button's function." H36's page
  // is about input type="image"; it is the reading the module applies to any image that is all its button holds.
  '1.1.1 functional_link': ['H30'],
  '1.1.1 functional_button': ['H36'],
  // F39 is the failure the claim names; H67 is how such an image is marked.
  '1.1.1 decorative': ['F39', 'H67'],
  // None of the failures Understanding 1.1.1 lists describes an image that conveys something and is hidden with
  // alt="", role="presentation" or "none", aria-hidden or an svg with no name: F65 is an alt attribute left out, F38
  // the opposite case, F3 a CSS background image. H67 is the marking the claim disputes, not a reading it applies.
  '1.1.1 hidden_image': [],
  // H81 (sufficient for 2.4.4) and H80 (advisory, as its page says) are the context readings the shared-text fact compares,
  // besides the sentence, list item, cell and header cells of the definition itself; each "lets a user distinguish this
  // link from links in the web page that lead to other destinations". F63 is left out: it fails a link whose needed
  // context "is located in content that is not programmatically determined link context", and the claim says only
  // that nothing in this link's context tells it apart, not that such context is elsewhere on the page.
  '2.4.4 shared_text': ['H81', 'H80'],
  // G91's test: "Check that text of the link describes the purpose of the link"; and "The URI of the destination is
  // generally not sufficiently descriptive."
  '2.4.4 generic': ['G91'],
  '2.4.4 address': ['G91'],
  '2.4.4 mismatch': ['G91'],
  // G130: "Check that each heading identifies its section of the content." G131: "Check that each label makes the
  // component's purpose clear."
  '2.4.6 heading': ['G130'],
  '2.4.6 label': ['G131'],
  // F25's test: "Check whether the title of each web page identifies the contents or purpose of the web page."
  '2.4.2 title': ['F25', 'G88'],
  // H57: the lang attribute "reflects the primary language used by the web page". H58: "Check that the language code
  // matches the language of the content it applies to."
  '3.1.1 page_language': ['H57'],
  '3.1.2 passage_language': ['H58'],
  // H98's test: a valid autocomplete pair, and "The purpose of the form field indicated by the label corresponds with
  // the autocomplete token on the input."
  '1.3.5 autocomplete': ['H98'],
  // H44: "for Success Criterion 3.3.2 (Labels or Instructions), the label element must be visible". G131 asks for a
  // descriptive label, not a visible one; F82 is about a set of phone number fields only.
  '3.3.2 label_not_visible': ['H44'],
}

/** The techniques and failures a claim of this kind applies, the most specific first; none for a kind not in the table. */
export function techniquesFor(criterion: string, kind: string): readonly Technique[] {
  const key = `${criterion} ${kind}`
  if (!Object.hasOwn(CLAIM_TECHNIQUES, key)) return []
  return (CLAIM_TECHNIQUES[key] ?? []).flatMap((id) => {
    const found = Object.hasOwn(TECHNIQUES, id) ? TECHNIQUES[id] : undefined
    return found ? [found] : []
  })
}

/** The ids a claim of this kind cites, the most specific first; none for a kind not in the table or one with no citation. */
export function techniqueIds(criterion: string, kind: string): string[] {
  const key = `${criterion} ${kind}`
  return Object.hasOwn(CLAIM_TECHNIQUES, key) ? [...(CLAIM_TECHNIQUES[key] ?? [])] : []
}

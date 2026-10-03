import type { VerificationStatus } from './types'

/**
 * The single wording for a catalogue position's provenance.
 *
 * Four components each had their own copy of this switch — the catalogue list, the
 * specification, the print report and the demo project — and they had drifted apart: the same
 * status read «Исторические данные» in one place and «старые данные» in another, and the
 * missing-status case had no wording at all in two of them, so a product with no
 * `verificationStatus` was rendered as bare text. A reader comparing the screen and the printed
 * report had no way to tell whether the difference meant something.
 */
export const VERIFICATION_LABELS: Record<VerificationStatus, string> = {
  verified: 'Подтверждено',
  unverified: 'Параметры не подтверждены',
  template: 'Шаблон',
  legacy: 'Исторические данные',
}

/**
 * `sentence` lower-cases the first letter for text that runs on inside a sentence, e.g. the
 * print report cell «подтверждено · источник указан в каталоге». A label that is only a word
 * («Шаблон») is left alone in both cases.
 */
export const verificationLabel = (status: VerificationStatus | undefined, options?: { sentence?: boolean }) => {
  const label = status ? VERIFICATION_LABELS[status] : VERIFICATION_LABELS.unverified
  if (!options?.sentence || !label) return label
  return label.charAt(0).toLowerCase() + label.slice(1)
}

/**
 * Whether a status may come with a `sourceUrl` attached as if that page had been read.
 *
 * `verified` means the row itself was read there. `template` means the row was generated from
 * that series page and its parameters are still a template — the pointer is real, the numbers
 * are not, and the catalogue shows both facts side by side. `unverified` and `legacy` must not
 * carry a link at all: nobody read a page for those, so pointing at one would be a claim the
 * catalogue cannot support. That is why the built-in rows, which were never checked against a
 * datasheet, deliberately ship without a `sourceUrl` instead of a plausible-looking one.
 */
export const claimsASource = (status: VerificationStatus | undefined) => status === 'verified' || status === 'template'

/**
 * The single source for the wire thickness range.
 *
 * The same limit used to be written out four times — 0.5–8 in the migration, the editor command
 * and the number input, and 0.1–100 in the project schema. The schema is the one that guards
 * imported files, so the widest copy won: a project with a 50 mm connection was accepted on import
 * and then rendered as a line no wire ever is, while the input next to it clamped to 8 and showed
 * the user a number they had never set.
 */
export const CONNECTION_THICKNESS_MM = {
  min: 0.5,
  max: 8,
  step: 0.5,
  default: 2,
} as const

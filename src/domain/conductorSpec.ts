/**
 * Preliminary conductor data.
 *
 * This is a preliminary check, not a design calculation: it uses the current-carrying capacity of
 * a copper conductor in a group installation from the method-B1 column of a common reference
 * table, rounded to whole amps. Method B1 assumes the most unfavourable of seven simultaneous
 * live conductors, which is the safe side to err on for a preproduction hint, and it is why a
 * circuit's `wireCrossSection` is compared against the rating of the device that protects it
 * rather than against the load alone.
 *
 * What this deliberately does not do: check the voltage drop over the line length, the grouping
 * factor for a specific installation method, the ambient temperature, or the real number of
 * conductors drawn through one duct. A row that passes here still has to be checked properly by
 * a qualified specialist against the actual installation.
 */

/** Copper, PVC insulated, group installation, 30 °C, in a duct. */
export const CONDUCTOR_CAPACITY_A: Readonly<Record<number, number>> = {
  0.5: 11,
  0.75: 15,
  1: 19,
  1.5: 24,
  2.5: 32,
  4: 42,
  6: 56,
  10: 76,
  16: 100,
  25: 133,
  35: 167,
  50: 213,
  70: 274,
  95: 330,
  120: 386,
  150: 442,
  185: 504,
  240: 580,
}

/** Nominal cross-sections, in mm², in ascending order. */
export const CONDUCTOR_SECTIONS_MM2 = [0.5, 0.75, 1, 1.5, 2.5, 4, 6, 10, 16, 25, 35, 50, 70, 95, 120, 150, 185, 240] as const

const SECTIONS = CONDUCTOR_SECTIONS_MM2 as readonly number[]

const at = (section: number) => CONDUCTOR_CAPACITY_A[section] ?? 0

/**
 * Capacity credited to an arbitrary section, interpolated linearly between the two surrounding
 * catalogue rows. A section the inspector cannot produce (it steps through the list above) can
 * still arrive in an imported file, and that value is checked rather than waved through: crediting
 * it with the next larger row would pass a cable that is genuinely too small, while crediting it
 * with the smaller one would raise a warning on a correctly sized 3 mm² line.
 */
export const capacityForSection = (section: number): number => {
  if (!Number.isFinite(section) || section <= 0) return 0
  if (section <= SECTIONS[0]!) return at(SECTIONS[0]!)
  const last = SECTIONS[SECTIONS.length - 1]!
  if (section >= last) return at(last)
  const index = SECTIONS.findIndex((value) => value > section)
  const below = SECTIONS[index - 1]!
  const above = SECTIONS[index]!
  const ratio = (section - below) / (above - below)
  return at(below) + (at(above) - at(below)) * ratio
}

/**
 * The smallest catalogueued section that carries `amps`, or `undefined` when the rating is above
 * the table — above 580 A this data says nothing, and the caller reports that rather than
 * inventing a section.
 */
export const sectionForAmps = (amps: number): number | undefined => {
  if (!Number.isFinite(amps) || amps < 0) return undefined
  return SECTIONS.find((section) => at(section) >= amps)
}

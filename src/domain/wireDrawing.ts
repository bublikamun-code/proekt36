import type { RoutedWire } from './wireRouting'

/**
 * How a routed wire becomes SVG paint. The board is drawn in two places — the editor canvas
 * and the read-only demo view — and these helpers are the single copy of that translation:
 * the router owns where a conductor runs, this module owns what it looks like, so the two
 * boards cannot drift into different strokes again.
 */

/** A jumper carries no phase, so it takes the neutral grey; everything else takes its bus. */
export const wireClass = (path: Pick<RoutedWire, 'kind' | 'bus' | 'phase'>): string => {
  if (path.kind === 'jumper') return 'jumper'
  if (path.bus === 'N') return 'n'
  if (path.bus === 'PE') return 'pe'
  return `l phase-${path.phase ?? 1}`
}

/**
 * Millimetres of conductor to pixels of stroke. The default 2 mm section lands on the widths the
 * stylesheet already used (0.8 px core, 2.4 px casing), so a board nobody has edited draws exactly
 * as it did before the inspector's colour and thickness could reach the drawing at all.
 */
const MM_TO_STROKE_PX = 0.4

export const conductorStyle = (
  path: Pick<RoutedWire, 'customColor' | 'color' | 'thickness'>,
  role: 'core' | 'casing',
): Record<string, string> => {
  const style: Record<string, string> = {}
  if (path.customColor) style.stroke = path.color
  const px = path.thickness * MM_TO_STROKE_PX * (role === 'casing' ? 3 : 1)
  style.strokeWidth = `${px}px`
  return style
}

/**
 * SVG path builders for the drawn device faces.
 *
 * Both the chassis outline and the toggle levers are plain point lists, so the conversion lives
 * here instead of inside the components: `<script setup>` code is not reachable from a test, and
 * this project has no component test renderer on purpose.
 *
 * Every builder opens with a moveto command. A path assembled as "0.7 2.8 L 2.8 0.7 L ..." starts
 * with a number, which browsers reject as a parse error and then draw nothing at all — the failure
 * is silent in the markup and loud only in the console.
 */

export type PathPoint = { x: number; y: number }

/** An open polyline: `M x y L x y L …`. Empty input yields an empty path rather than a bare `M`. */
export const polylinePath = (values: PathPoint[]): string =>
  values.length ? `M ${values.map((point) => `${point.x} ${point.y}`).join(' L ')}` : ''

/** A closed polyline: the same, plus the closepath command. */
export const closedPolylinePath = (values: PathPoint[]): string => {
  const path = polylinePath(values)
  return path ? `${path} Z` : ''
}
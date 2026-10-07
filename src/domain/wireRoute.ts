/** Shared limits for persisted manual routes and editor commands. Coordinates are board millimetres. */
export const WIRE_ROUTE_LIMITS = { points: 128, coordinate: 10000 } as const

export const wireRouteError = (value: unknown): string | null => {
  if (value === undefined) return null
  if (!value || typeof value !== 'object' || Array.isArray(value)) return 'Трасса провода должна содержать точки и слои участков.'
  const route = value as Record<string, unknown>
  if (!Array.isArray(route.points) || route.points.length > WIRE_ROUTE_LIMITS.points) return 'В трассе допускается до 128 точек.'
  for (const point of route.points) {
    if (!point || typeof point !== 'object' || Array.isArray(point)) return 'Укажите координаты точки трассы.'
    for (const coordinate of ['x', 'y']) {
      const number = (point as Record<string, unknown>)[coordinate]
      if (typeof number !== 'number' || !Number.isFinite(number) || number < 0 || number > WIRE_ROUTE_LIMITS.coordinate) return 'Координаты трассы должны быть конечными числами от 0 до 10000 мм.'
    }
  }
  if (!Array.isArray(route.segmentLayers) || route.segmentLayers.length !== route.points.length + 1) return 'Каждому участку трассы нужен слой.'
  for (const layer of route.segmentLayers) {
    if (layer !== 'front' && layer !== 'rear') return 'Выберите слой участка: перед аппаратами или за аппаратами.'
  }
  return null
}

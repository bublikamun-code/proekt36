import { deviceTerminals } from './terminals'
import type { TerminalRef } from './terminals'
import type { BusAssembly, Connection as SeptemberConnection, DeviceDefinition, PanelProject } from './shim'

/**
 * Спайк A2 (REWORK_PLAN, решение D2): связывает электрический граф октябрьской линии
 * с зажимной моделью и роутером сентябрьской. Здесь только отображение и проверка
 * приземления; семантику соединений слой не меняет.
 */

/** Часть октябрьского Connection, которую определяет граф, — без косметики. */
export interface GraphConnection {
  id: string
  circuitId?: string
  fromBus: 'L' | 'N' | 'PE'
  toDeviceId: string
  kind?: 'circuit' | 'busbar' | 'bus'
  fromDeviceId?: string
  /** Номер зажима внутри стороны устройства, с нуля (семантика октября). */
  terminal?: number
}

/**
 * Октябрьский номер зажима → сентябрьская ссылка. Полюс сентябрьской модели печатается
 * на аппарате с единицы, а сторона выводится из роли провода: подвод (шина, гребёнка)
 * входит сверху, линия цепи уходит снизу.
 */
export const toTerminalRef = (connection: GraphConnection): TerminalRef => ({
  deviceId: connection.toDeviceId,
  pole: (connection.terminal ?? 0) + 1,
  side: connection.kind === 'circuit' ? 'bottom' : 'top',
})

/** Зажим существует на аппарате: провод не может попасть в винт, которого нет. */
export const clampExists = (product: DeviceDefinition, ref: TerminalRef): boolean =>
  deviceTerminals(product).some((terminal) => terminal.pole === ref.pole && terminal.side === ref.side)

export const terminalKey = (ref: TerminalRef): string => `${ref.deviceId}:${ref.pole}:${ref.side}`

/** id шины по её типу — первой в списке; как и на доске, N и PE живут по своей сборке. */
export const busIdByKind = (assemblies: BusAssembly[]): Map<'L' | 'N' | 'PE', string> => {
  const map = new Map<'L' | 'N' | 'PE', string>()
  for (const assembly of assemblies) if (!map.has(assembly.kind)) map.set(assembly.kind, assembly.id)
  return map
}

/**
 * Граф октября → соединения сентября для роутера. Подвод от шины (`kind: 'bus'`)
 * становится линией, запитанной от именованной сборки (`busId`). Сборки существуют
 * только для N и PE — фазного L-бара в модели сентября нет, фазный подвод остаётся
 * абстрактным входом слева (как в миграции v2→v3) или приходит гребёнкой; связи
 * с номером зажима получают `toTerminal`. Связность — то же множество пар
 * (устройство, зажим).
 */
export const routerConnections = (graph: GraphConnection[], assemblies: BusAssembly[]): SeptemberConnection[] => {
  const busIds = busIdByKind(assemblies)
  return graph.map((connection) => {
    const base = {
      id: connection.id,
      circuitId: connection.circuitId ?? '',
      fromBus: connection.fromBus,
      toDeviceId: connection.toDeviceId,
      color: '',
      thickness: 2,
      label: '',
    }
    if (connection.kind === 'bus') {
      const busId = connection.fromBus === 'L' ? undefined : busIds.get(connection.fromBus)
      if (connection.fromBus !== 'L' && !busId) {
        throw new Error(`Соединение ${connection.id}: шина ${connection.fromBus} не собрана`)
      }
      return busId ? { ...base, kind: 'circuit' as const, busId } : { ...base, kind: 'circuit' as const }
    }
    return {
      ...base,
      kind: connection.kind === 'busbar' ? ('busbar' as const) : ('circuit' as const),
      fromDeviceId: connection.fromDeviceId,
      toTerminal: toTerminalRef(connection),
    }
  })
}

/** Минимальный проект сентябрьской формы для роутера: один ряд, данные из графа. */
export const routerProject = (base: PanelProject, graph: GraphConnection[]): PanelProject => ({
  ...base,
  connections: routerConnections(graph, base.busAssemblies ?? []),
})

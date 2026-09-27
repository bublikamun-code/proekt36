import { getEnclosureMinimum, getFootprintModules, getFreeSlots, getRowCapacity, isDinDevice } from './layout'
import { pricing } from './pricing'
import { VALIDATION_REVISION } from './projectSchema'
import type { DeviceDefinition, PanelProject, ValidationIssue } from './types'

const issue = (id: string, level: ValidationIssue['level'], title: string, message: string, ruleCode: string, context: Record<string, unknown> = {}, deviceId?: string): ValidationIssue => ({
  id, level, title, message, deviceId,
  ruleCode, version: VALIDATION_REVISION, ruleVersion: VALIDATION_REVISION, context,
})

export const validateProject = (project: PanelProject, definitions: Map<string, DeviceDefinition>): ValidationIssue[] => {
  const issues: ValidationIssue[] = []
  const minimum = getEnclosureMinimum(project, definitions)
  const occupied = new Map<string, string>()
  const seenDeviceIds = new Set<string>()
  const seenCircuitIds = new Set<string>()
  const seenConnectionIds = new Set<string>()

  for (const item of project.devices ?? []) {
    if (seenDeviceIds.has(item.instanceId)) issues.push(issue(`duplicate-device-${item.instanceId}`, 'error', 'Повторяется идентификатор устройства', `Устройство «${item.instanceId}» встречается несколько раз. Укажите уникальный instanceId.`, 'project.ids.duplicate', { kind: 'device', id: item.instanceId }, item.instanceId))
    seenDeviceIds.add(item.instanceId)
    const product = definitions.get(item.productId)
    if (!product) {
      issues.push(issue(`missing-${item.instanceId}`, 'error', 'Нет товара', 'Товар удалён из каталога, но остался на схеме. Выберите товар заново или удалите позицию.', 'catalog.product.missing', { productId: item.productId }, item.instanceId))
      continue
    }
    if (isDinDevice(item)) {
      const footprint = getFootprintModules(item, definitions)
      for (let index = 0; index < footprint; index += 1) {
        const key = `${item.row}:${item.slot + index}`
        if (occupied.has(key)) {
          issues.push(issue(`overlap-${item.instanceId}`, 'error', 'Наложение устройств', `${product.name} пересекается с другой позицией в ряду ${item.row + 1}. Переместите одно из устройств.`, 'layout.overlap', { row: item.row, slot: item.slot, footprint, otherInstanceId: occupied.get(key) }, item.instanceId))
          break
        }
        occupied.set(key, item.instanceId)
      }
      if (item.slot < 0 || item.slot + footprint > getRowCapacity(project)) {
        issues.push(issue(`row-overflow-${item.instanceId}`, 'error', 'Устройство выходит за ряд', `${product.name}: позиция ${item.slot + 1}–${item.slot + footprint} не помещается в рейку на ${getRowCapacity(project)} модулей. Сдвиньте устройство влево.`, 'layout.row.overflow', { row: item.row, slot: item.slot, footprint, capacity: getRowCapacity(project) }, item.instanceId))
      }
    }
    if (item.row >= project.settings.rows) issues.push(issue(`row-${item.instanceId}`, 'error', 'Ряд не существует', `Перенесите ${product.name} в один из ${project.settings.rows} настроенных рядов.`, 'layout.row.missing', { row: item.row, rows: project.settings.rows }, item.instanceId))
    if (product.ratedCurrent > project.settings.inputCurrent && product.category === 'MCB') issues.push(issue(`current-${item.instanceId}`, 'warning', 'Ток выше вводного', `${product.name}: номинал ${product.ratedCurrent} А при вводном ${project.settings.inputCurrent} А. Проверьте защиту ввода.`, 'electrical.current.preliminary', { ratedCurrent: product.ratedCurrent, inputCurrent: project.settings.inputCurrent }, item.instanceId))
  }
  if (project.settings.enclosureWidth < minimum.width) issues.push(issue('width', 'error', 'Корпус уже расчётного минимума', `Для текущего наполнения нужно не менее ${minimum.width} мм. Выберите корпус большей ширины или измените ряд.`, 'layout.enclosure.minimum', { minimum: minimum.width, actual: project.settings.enclosureWidth }))
  if (!project.devices.some((item) => ['RCCB', 'RCBO'].includes(definitions.get(item.productId)?.category ?? ''))) issues.push(issue('rccd', 'warning', 'Не выбрана защита утечки', 'Проверьте необходимость УЗО или дифавтоматов по проекту.', 'protection.rccd.preliminary'))
  if (!project.devices.some((item) => definitions.get(item.productId)?.category === 'SPD')) issues.push(issue('spd', 'warning', 'Не выбран УЗИП', 'Для рабочего проекта предусмотрите защиту от импульсных перенапряжений.', 'protection.spd.preliminary'))

  const circuitById = new Map<string, (typeof project.circuits)[number]>()
  for (const circuit of project.circuits ?? []) circuitById.set(circuit.id, circuit)
  const connectionKeys = new Set<string>()
  for (const connection of project.connections ?? []) {
    if (seenConnectionIds.has(connection.id)) issues.push(issue(`duplicate-connection-${connection.id}`, 'error', 'Повторяется идентификатор подключения', `Подключение «${connection.label || connection.id}» встречается несколько раз.`, 'project.ids.duplicate', { kind: 'connection', id: connection.id }))
    seenConnectionIds.add(connection.id)
    const circuit = connection.kind === 'busbar' ? undefined : circuitById.get(connection.circuitId)
    if (connection.kind !== 'busbar' && !circuit) issues.push(issue(`connection-circuit-${connection.id}`, 'error', 'Подключение без цепи', `Подключение «${connection.label || connection.id}» ссылается на несуществующую цепь. Выберите существующую цепь.`, 'connection.circuit.missing', { connectionId: connection.id, circuitId: connection.circuitId }))
    if (connection.kind === 'busbar' && !connection.fromDeviceId) issues.push(issue(`connection-busbar-source-${connection.id}`, 'error', 'Нет источника шины', `Подключение «${connection.label || connection.id}» не указывает шину-источник.`, 'connection.busbar.source.missing', { connectionId: connection.id }))
    if (connection.kind === 'busbar' && connection.fromDeviceId && !project.devices.some((device) => device.instanceId === connection.fromDeviceId)) issues.push(issue(`connection-busbar-source-missing-${connection.id}`, 'error', 'Шина-источник удалена', `Подключение «${connection.label || connection.id}» ссылается на удалённую шину.`, 'connection.busbar.source.missing', { connectionId: connection.id, fromDeviceId: connection.fromDeviceId }, connection.fromDeviceId))
    if (!project.devices.some((device) => device.instanceId === connection.toDeviceId)) issues.push(issue(`connection-device-${connection.id}`, 'error', 'Подключение без устройства', `Подключение «${connection.label || connection.id}» ссылается на удалённое устройство.`, 'connection.device.missing', { connectionId: connection.id, toDeviceId: connection.toDeviceId }, connection.toDeviceId))
    if (!['L', 'N', 'PE'].includes(connection.fromBus)) issues.push(issue(`connection-bus-${connection.id}`, 'error', 'Неизвестная шина', `В подключении «${connection.label || connection.id}» указана неизвестная шина. Выберите L, N или PE.`, 'connection.bus.unknown', { connectionId: connection.id, fromBus: connection.fromBus }))
    if (!connection.label.trim()) issues.push(issue(`connection-label-${connection.id}`, 'warning', 'Подключение без подписи', 'Добавьте понятную подпись к линии на схеме.', 'connection.label.missing', { connectionId: connection.id }))
    const connectionKey = connection.kind === 'busbar' ? `busbar:${connection.fromDeviceId ?? ''}:${connection.toDeviceId}` : `circuit:${connection.circuitId}:${connection.fromBus}:${connection.toDeviceId}`
    if (connectionKeys.has(connectionKey)) issues.push(issue(`connection-duplicate-${connection.id}`, 'warning', 'Повторяется подключение', `В цепи «${circuit?.name ?? connection.circuitId}» уже есть такая же линия.`, 'connection.duplicate', { connectionKey }))
    connectionKeys.add(connectionKey)
    if (connection.thickness <= 0) issues.push(issue(`connection-thickness-${connection.id}`, 'warning', 'Некорректная толщина линии', `В подключении «${connection.label || connection.id}» укажите толщину больше нуля.`, 'connection.thickness.invalid', { connectionId: connection.id }))
  }

  const circuitNames = new Set<string>()
  for (const circuit of project.circuits ?? []) {
    if (seenCircuitIds.has(circuit.id)) issues.push(issue(`duplicate-circuit-${circuit.id}`, 'error', 'Повторяется идентификатор цепи', `Цепь «${circuit.name}» встречается несколько раз.`, 'project.ids.duplicate', { kind: 'circuit', id: circuit.id }))
    seenCircuitIds.add(circuit.id)
    circuitById.set(circuit.id, circuit)
    if (circuitNames.has(circuit.name)) issues.push(issue(`circuit-name-${circuit.id}`, 'warning', 'Повторяется название цепи', `Цепь «${circuit.name}» должна иметь уникальное имя.`, 'circuit.name.duplicate', { circuitId: circuit.id, name: circuit.name }))
    circuitNames.add(circuit.name)
    const protection = project.devices.find((item) => item.instanceId === circuit.protectionDeviceId)
    const protectionProduct = protection ? definitions.get(protection.productId) : undefined
    if (!protection || !protectionProduct) issues.push(issue(`circuit-protection-${circuit.id}`, 'error', 'Не выбрано защитное устройство', `Для цепи «${circuit.name}» не найден автомат, УЗО или дифавтомат. Выберите защитное устройство.`, 'circuit.protection.missing', { circuitId: circuit.id, protectionDeviceId: circuit.protectionDeviceId }))
    if (protectionProduct && circuit.current > protectionProduct.ratedCurrent) issues.push(issue(`circuit-overload-${circuit.id}`, 'warning', 'Ток цепи выше номинала защиты', `${circuit.name}: ${circuit.current} А при номинале ${protectionProduct.ratedCurrent} А.`, 'circuit.current.over-protection', { current: circuit.current, ratedCurrent: protectionProduct.ratedCurrent }))
    if (project.settings.phase === 1 && circuit.phase !== 1) issues.push(issue(`circuit-phase-${circuit.id}`, 'error', 'Фаза цепи не совпадает с сетью', `${circuit.name} назначена на L${circuit.phase}, а проект однофазный. Укажите L1.`, 'circuit.phase.mismatch', { phase: circuit.phase, projectPhase: project.settings.phase }))
    if (project.settings.phase === 1 && circuit.current > project.settings.inputCurrent) issues.push(issue(`circuit-input-current-${circuit.id}`, 'warning', 'Ток цепи выше вводного', `${circuit.name}: расчётный ток ${circuit.current} А при вводном ${project.settings.inputCurrent} А. Проверьте защиту и нагрузку.`, 'circuit.current.input.preliminary', { current: circuit.current, inputCurrent: project.settings.inputCurrent }))

    const buses = new Set((project.connections ?? []).filter((connection) => connection.kind !== 'busbar' && connection.circuitId === circuit.id).map((connection) => connection.fromBus))
    for (const bus of ['L', 'N', 'PE'] as const) {
      if (!buses.has(bus)) issues.push(issue(`circuit-bus-missing-${bus.toLowerCase()}-${circuit.id}`, 'info', `Предварительно: нет шины ${bus}`, `У цепи «${circuit.name}» не найдено подключение ${bus}. Это предварительная проверка комплектности, а не нормативное заключение.`, 'circuit.bus.completeness.preliminary', { circuitId: circuit.id, bus }))
    }
    if (!project.connections?.some((connection) => connection.kind !== 'busbar' && connection.circuitId === circuit.id && project.devices.some((item) => item.instanceId === connection.toDeviceId))) issues.push(issue(`circuit-connection-${circuit.id}`, 'warning', 'Цепь не подключена', `У цепи «${circuit.name}» нет подключения к устройству.`, 'circuit.connection.missing', { circuitId: circuit.id }))
  }

  // A single-phase panel already gets a per-circuit check above; a three-phase one had no
  // aggregate check at all, so the phase totals were computed and shown but never compared with
  // the incoming rating. Only real circuits count here: phaseBalance falls back to summing device
  // ratings, and a sum of protective ratings is not a load. The incoming breaker is rated per
  // phase, so the busiest phase is what matters, not the total across all three.
  if (project.settings.phase === 3 && project.circuits?.length) {
    for (const [index, load] of phaseBalance(project, definitions).totals.entries()) {
      if (load <= project.settings.inputCurrent) continue
      const bus = `L${index + 1}`
      issues.push(issue(`phase-load-${bus.toLowerCase()}`, 'warning', `Нагрузка на ${bus} выше вводного`, `На фазе ${bus} суммарно ${load} А при вводном ${project.settings.inputCurrent} А. Проверьте вводной аппарат и перераспределите нагрузку по фазам.`, 'electrical.phase-load.preliminary', { phase: index + 1, load, inputCurrent: project.settings.inputCurrent }))
    }
  }

  const free = getFreeSlots(project, definitions)
  if (free < project.settings.reserveModules) issues.push(issue('reserve', 'warning', 'Малый запас модулей', `Осталось ${free} мод. из требуемых ${project.settings.reserveModules} резервных. Уменьшите наполнение или выберите корпус больше.`, 'layout.reserve.preliminary', { free, reserveModules: project.settings.reserveModules }))
  const result = pricing(project.devices, definitions)
  if (!project.devices.length) issues.push(issue('empty', 'info', 'Пустая панель', 'Добавьте аппарат из каталога или выберите мастер.', 'project.empty'))
  issues.push(issue('preliminary', 'info', 'Предварительный расчёт', `${result.hasUnknownPrices ? 'Стоимость с неизвестными ценами уточняется; известная часть ' : 'Расчётная стоимость '}${result.total.toLocaleString('ru-RU')} ₽. Проверьте по схеме, паспортам и действующим требованиям.`, 'calculation.preliminary', { knownTotal: result.total, hasUnknownPrices: result.hasUnknownPrices }))
  return issues
}

export const phaseBalance = (project: PanelProject, definitions: Map<string, DeviceDefinition>) => {
  const totals = [0, 0, 0]
  if (project.circuits?.length) {
    for (const circuit of project.circuits) totals[(circuit.phase - 1) % 3] += Math.max(0, circuit.current)
  } else {
    for (const item of project.devices) totals[(item.phase - 1) % 3] += (definitions.get(item.productId)?.ratedCurrent ?? 0) * item.quantity
  }
  const activeTotals = project.settings.phase === 1 ? totals.slice(0, 1) : totals
  // A panel with no load at all is balanced, not maximally skewed. Forcing a
  // non-zero denominator here reported «Разброс фаз 100 %» on an empty board.
  const max = Math.max(...activeTotals)
  const min = Math.min(...activeTotals)
  return { totals, spread: max <= 0 ? 0 : Math.round(((max - min) / max) * 100) }
}

export const layoutCheck = (project: PanelProject, _definitions: Map<string, DeviceDefinition>) => {
  const capacity = getRowCapacity(project) * project.settings.rows
  return { capacity, rows: project.settings.rows, width: project.settings.enclosureWidth, height: project.settings.enclosureHeight }
}

import { circuitLoadCheck, conductorCheck, currentForPowerA, PHASE_IMBALANCE_LIMIT_PERCENT, phaseBalance, phaseImbalance, protectionLoads } from './electrical'
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
    // The address is the designator that identifies the device in the documentation around this
    // board, so two devices answering to one address make every drawing and specification of it
    // ambiguous. `autoNumber` never produces that, which is exactly why it needs a rule: a hand
    // edit or an imported file can.
    if (!item.address.trim()) issues.push(issue(`address-missing-${item.instanceId}`, 'warning', 'Нет адреса', `${product.name} в ряду ${item.row + 1} не имеет обозначения. Задайте адрес — по нему аппарат опознаётся в схеме и спецификации.`, 'device.address.missing', { row: item.row, slot: item.slot }, item.instanceId))
  }

  const addressOwners = new Map<string, string>()
  for (const item of project.devices ?? []) {
    const address = item.address.trim()
    if (!address) continue
    const owner = addressOwners.get(address)
    if (owner && owner !== item.instanceId) {
      issues.push(issue(`address-duplicate-${item.instanceId}`, 'error', 'Повторяется адрес', `Адрес «${address}» уже занят другим аппаратом. Обозначения должны быть уникальными: по ним идёт маркировка и спецификация.`, 'device.address.duplicate', { address, otherInstanceId: owner }, item.instanceId))
      continue
    }
    addressOwners.set(address, item.instanceId)
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

    // A conductor is protected against overload by the same device as its circuit, so the
    // declared cross-section is compared with the rating of that device, not with the load.
    const conductor = protectionProduct ? conductorCheck(circuit.wireCrossSection, protectionProduct.ratedCurrent) : null
    if (conductor) issues.push(issue(`circuit-conductor-${circuit.id}`, 'warning', 'Сечение провода меньше номинала защиты', `${circuit.name}: ${conductor.actual} мм² при защите ${protectionProduct!.ratedCurrent} А. Для этого номинала нужен провод от ${conductor.required} мм². Это предварительная проверка, а не расчёт кабеля.`, 'circuit.conductor.cross-section', { crossSection: conductor.actual, required: conductor.required, capacity: conductor.capacity, ratedCurrent: protectionProduct!.ratedCurrent, circuitId: circuit.id }))

    // Power and current are entered independently, so they can disagree. A circuit designed for
    // more than it carries is ordinary, so only the direction that cannot be right is reported —
    // and neither number is rewritten: the check says what the other one implies.
    const load = protectionProduct ? circuitLoadCheck(circuit, protectionProduct.ratedCurrent) : null
    if (load?.exceedsCurrent) issues.push(issue(`circuit-power-mismatch-${circuit.id}`, 'warning', 'Мощность не соответствует току', `${circuit.name}: ${Math.round(circuit.power)} Вт — это около ${Math.round(load.implied)} А, а цепь объявлена на ${circuit.current} А. Проверьте, какое из двух значений верно.`, 'circuit.power.current.mismatch', { power: circuit.power, current: circuit.current, implied: Math.round(load.implied), circuitId: circuit.id }))
    if (load?.exceedsProtection && protectionProduct) issues.push(issue(`circuit-power-over-protection-${circuit.id}`, 'warning', 'Нагрузка выше номинала защиты', `${circuit.name}: ${Math.round(circuit.power)} Вт — это около ${Math.round(load.implied)} А при защите ${protectionProduct.ratedCurrent} А. Проверьте номинал аппарата.`, 'circuit.power.over-protection', { power: circuit.power, implied: Math.round(load.implied), ratedCurrent: protectionProduct.ratedCurrent, circuitId: circuit.id }))
    if (circuit.power > 0 && circuit.current <= 0) issues.push(issue(`circuit-current-undetermined-${circuit.id}`, 'info', 'Мощность задана, ток — нет', `${circuit.name}: ${Math.round(circuit.power)} Вт соответствует примерно ${Math.round(currentForPowerA(circuit.power, circuit.phase))} А. Укажите ток, иначе нагрузка не попадёт в расчёт фаз.`, 'circuit.current.undetermined', { power: circuit.power, suggested: Math.round(currentForPowerA(circuit.power, circuit.phase)), circuitId: circuit.id }))
  }

  // One protective device feeding several circuits has to be rated for their sum. The editor makes
  // this easy to do by accident: a new circuit defaults to the first protection device on the
  // board, and only the per-circuit comparison above existed to catch it.
  for (const load of protectionLoads(project, definitions).values()) {
    if (load.ratedCurrent <= 0 || load.circuits.length < 2 || load.current <= load.ratedCurrent) continue
    const placed = project.devices.find((item) => item.instanceId === load.instanceId)
    const product = placed ? definitions.get(placed.productId) : undefined
    issues.push(issue(`shared-protection-${load.instanceId}`, 'warning', 'Общий защитный аппарат перегружен', `${product?.name || 'Защитный аппарат'} на ${load.ratedCurrent} А защищает ${load.circuits.length} цепи с суммой ${Math.round(load.current)} А (${load.circuits.map((item) => item.name).join(', ')}). Разделите цепи или поставьте аппарат большего номинала.`, 'circuit.shared-protection.overload', { instanceId: load.instanceId, current: load.current, ratedCurrent: load.ratedCurrent, circuits: load.circuits.map((item) => item.id) }, load.instanceId))
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
    // The spread was computed for the inspector and never acted on, so a panel with all its load
    // on L1 passed every check. It only means something once at least two phases carry load.
    const imbalance = phaseImbalance(project, definitions)
    if (imbalance) issues.push(issue('phase-imbalance', 'warning', 'Разброс фаз', `Нагрузка распределена неравномерно: ${imbalance.totals.map((value, index) => `L${index + 1} ${value} А`).join(', ')}, разброс ${imbalance.spread} % при пороге ${PHASE_IMBALANCE_LIMIT_PERCENT} %. Перераспределите нагрузку.`, 'electrical.phase-imbalance.preliminary', { spread: imbalance.spread, totals: imbalance.totals, limit: PHASE_IMBALANCE_LIMIT_PERCENT }))
  }

  const free = getFreeSlots(project, definitions)
  if (free < project.settings.reserveModules) issues.push(issue('reserve', 'warning', 'Малый запас модулей', `Осталось ${free} мод. из требуемых ${project.settings.reserveModules} резервных. Уменьшите наполнение или выберите корпус больше.`, 'layout.reserve.preliminary', { free, reserveModules: project.settings.reserveModules }))
  const result = pricing(project.devices, definitions)
  if (!project.devices.length) issues.push(issue('empty', 'info', 'Пустая панель', 'Добавьте аппарат из каталога или выберите мастер.', 'project.empty'))
  issues.push(issue('preliminary', 'info', 'Предварительный расчёт', `${result.hasUnknownPrices ? 'Стоимость с неизвестными ценами уточняется; известная часть ' : 'Расчётная стоимость '}${result.total.toLocaleString('ru-RU')} ₽. Проверьте по схеме, паспортам и действующим требованиям.`, 'calculation.preliminary', { knownTotal: result.total, hasUnknownPrices: result.hasUnknownPrices }))
  return issues
}

export const layoutCheck = (project: PanelProject, _definitions: Map<string, DeviceDefinition>) => {
  const capacity = getRowCapacity(project) * project.settings.rows
  return { capacity, rows: project.settings.rows, width: project.settings.enclosureWidth, height: project.settings.enclosureHeight }
}

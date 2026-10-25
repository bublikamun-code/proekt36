<script setup lang="ts">
import { computed, ref } from 'vue'
import { storeToRefs } from 'pinia'
import AppDialog from '../ui/AppDialog.vue'
import AppSelect from '../ui/AppSelect.vue'
import { getFootprintModules } from '../../domain/layout'
import { formatAmps } from '../../domain/electrical'
import { connectionWord, lineWord } from '../../domain/plural'
import { CIRCUIT_KINDS, type Circuit, type CircuitKind } from '../../domain/types'
import { circuitCurrentA } from '../../domain/electrical'
import { CIRCUIT_KIND_LABELS } from '../../domain/loadBook'
import { phaseBalance } from '../../domain/validation'
import { formatDropPercent, voltageDrop } from '../../domain/voltageDrop'
import { useProjectStore } from '../../stores/project'

/**
 * The planning layer over the board: lines grouped by room, the way a worksheet expects them.
 * A line row edits the circuit directly, and the protection cell points back at the board —
 * the planner and the visual panel are two views of one project, not two sources of truth.
 */

const emit = defineEmits<{ 'goto-board': [] }>()

const store = useProjectStore()
const { currentProject, definitions } = storeToRefs(store)

const KIND_LABELS = CIRCUIT_KIND_LABELS

interface RoomGroup {
  key: string
  title: string
  roomId?: string
  floor?: number
  lines: Circuit[]
}

const groups = computed<RoomGroup[]>(() => {
  const rooms = [...(currentProject.value.rooms ?? [])].sort((a, b) => a.floor - b.floor || a.name.localeCompare(b.name, 'ru'))
  const byRoom = new Map<string, Circuit[]>()
  const ungrouped: Circuit[] = []
  for (const circuit of currentProject.value.circuits) {
    if (circuit.roomId && rooms.some((room) => room.id === circuit.roomId)) {
      const bucket = byRoom.get(circuit.roomId) ?? []
      bucket.push(circuit)
      byRoom.set(circuit.roomId, bucket)
    } else {
      ungrouped.push(circuit)
    }
  }
  const result: RoomGroup[] = rooms.map((room) => ({
    key: room.id, title: room.name, roomId: room.id, floor: room.floor,
    lines: byRoom.get(room.id) ?? [],
  }))
  result.push({ key: 'ungrouped', title: 'Без помещения', lines: ungrouped })
  return result
})

const balance = computed(() => phaseBalance(currentProject.value, definitions.value))
const usedModules = computed(() => currentProject.value.devices.reduce(
  (sum, device) => sum + getFootprintModules(device, definitions.value), 0))
const wiredCount = computed(() => currentProject.value.connections.filter((item) => item.circuitId).length)

const protectionOptions = computed(() => {
  const devices = currentProject.value.devices
  return devices.map((device) => {
    const product = definitions.value.get(device.productId)
    const category = product?.category
    if (category !== 'MCB' && category !== 'RCCB' && category !== 'RCBO') return null
    return { value: device.instanceId, label: `${device.address || device.instanceId} · ${product?.name ?? device.productId}` }
  }).filter((item): item is { value: string; label: string } => Boolean(item))
})

const catalogOptions = computed(() => Array.from(definitions.value.entries())
  .filter(([, product]) => product.category === 'MCB' || product.category === 'RCCB' || product.category === 'RCBO')
  .map(([id, product]) => ({ value: id, label: `${product.name} · ${product.brand}` }))
  .sort((a, b) => a.label.localeCompare(b.label, 'ru')))

const roomOptions = computed(() => (currentProject.value.rooms ?? []).map((room) => ({
  value: room.id, label: `${room.name} (этаж ${room.floor})`,
})))

/** Selecting a line's breaker on the board is the shortest path from plan to wiring. */
const focusDevice = (deviceId: string) => {
  if (!currentProject.value.devices.some((item) => item.instanceId === deviceId)) return
  store.selectedDeviceId = deviceId
  emit('goto-board')
}

const removeLine = (circuit: Circuit) => { store.deleteLine(circuit.id) }

/** План или кабельный журнал — один набор линий, два взгляда на него. */
const view = ref<'plan' | 'schedule'>('plan')

/** The cable schedule: one row per line, the way it is printed for the rough-in crew. */
const CABLE_CORES: Record<CircuitKind, number> = { power: 3, light: 3, dc: 2, control: 2 }
const scheduleRows = computed(() => currentProject.value.circuits.map((circuit, index) => {
  const room = (currentProject.value.rooms ?? []).find((item) => item.id === circuit.roomId)
  // The schedule prints the same derived current the balance and the checks read: a line
  // planned by power shows its calculated amperes, not whatever was typed by hand.
  const currentA = circuitCurrentA(circuit)
  const drop = voltageDrop({
    lengthM: circuit.cableLength ?? 0,
    currentA,
    crossSectionMm2: circuit.wireCrossSection,
    system: currentProject.value.settings.phase === 3 ? 3 : 1,
  })
  return {
    number: index + 1,
    id: circuit.id,
    name: circuit.name,
    room: room?.name ?? '—',
    cable: `${CABLE_CORES[circuit.kind ?? 'power']}×${String(circuit.wireCrossSection).replace('.', ',')}`,
    length: circuit.cableLength ?? 0,
    current: currentA,
    dropPercent: drop.dropPercent,
    dropText: formatDropPercent(drop.dropPercent),
    ok: drop.ok,
  }
}))

// ── диалог «+ Линия» ────────────────────────────────────────────────────────────────────────
const lineDialogOpen = ref(false)
const lineForm = ref({ name: '', roomId: '', kind: 'power', phase: '1', protectionProductId: '', current: '16' })
const kindOptions = CIRCUIT_KINDS.map((kind) => ({ value: kind, label: KIND_LABELS[kind] }))
const phaseOptions = [
  { value: '1', label: 'L1' }, { value: '2', label: 'L2' }, { value: '3', label: 'L3' },
]
const openLineDialog = () => {
  lineForm.value = {
    name: `Линия ${currentProject.value.circuits.length + 1}`,
    roomId: '', kind: 'power', phase: '1',
    protectionProductId: catalogOptions.value[0]?.value ?? '',
    current: '16',
  }
  lineDialogOpen.value = true
}
const submitLine = () => {
  const current = Number(lineForm.value.current.replace(',', '.'))
  // A refused line (bad input, packed board) keeps the dialog open with its toast: closing it
  // would throw away everything the user just typed for the sake of a clean animation.
  const created = store.addLine({
    name: lineForm.value.name,
    roomId: lineForm.value.roomId || undefined,
    kind: lineForm.value.kind as CircuitKind,
    phase: Number(lineForm.value.phase) as 1 | 2 | 3,
    protectionProductId: lineForm.value.protectionProductId,
    current: Number.isFinite(current) ? current : 0,
  })
  if (created) lineDialogOpen.value = false
}

// ── диалог «+ Помещение» ────────────────────────────────────────────────────────────────────
const roomDialogOpen = ref(false)
const roomForm = ref({ name: '', floor: '1' })
const openRoomDialog = () => { roomForm.value = { name: '', floor: '1' }; roomDialogOpen.value = true }
const submitRoom = () => {
  const floor = Number(roomForm.value.floor)
  store.addRoom(roomForm.value.name, Number.isInteger(floor) ? floor : 1)
  roomDialogOpen.value = false
}
</script>

<template>
  <section class="lines-panel" aria-labelledby="lines-title" data-lines-panel>
    <div class="panel-heading">
      <div><span class="eyebrow">Планировщик</span><h3 id="lines-title">Линии щита</h3></div>
      <span class="mono count">{{ currentProject.circuits.length }}</span>
    </div>

    <div class="lines-summary" role="status">
      <strong>{{ currentProject.circuits.length }} {{ lineWord(currentProject.circuits.length) }} · {{ wiredCount }} {{ connectionWord(wiredCount) }}</strong>
      <span>Занято модулей: {{ usedModules }}</span>
      <span>Баланс фаз: {{ balance.totals.map(formatAmps).join(' / ') }} А<template v-if="currentProject.settings.phase === 3"> (разброс {{ balance.spread }} %)</template></span>
    </div>

    <div class="lines-actions">
      <div class="lines-view-switch" role="group" aria-label="Вид панели линий">
        <button type="button" :aria-pressed="view === 'plan'" :class="{ active: view === 'plan' }" @click="view = 'plan'">План</button>
        <button type="button" :aria-pressed="view === 'schedule'" :class="{ active: view === 'schedule' }" @click="view = 'schedule'">Журнал</button>
      </div>
      <template v-if="view === 'plan'">
        <button type="button" class="primary-button" @click="openLineDialog">+ Линия</button>
        <button type="button" @click="openRoomDialog">+ Помещение</button>
      </template>
    </div>

    <table v-if="view === 'schedule'" class="lines-schedule" aria-label="Кабельный журнал">
      <thead>
        <tr><th scope="col">№</th><th scope="col">Линия</th><th scope="col">Помещение</th><th scope="col">Кабель</th><th scope="col">Длина, м</th><th scope="col">Ток, А</th><th scope="col">ΔU</th><th scope="col">Статус</th></tr>
      </thead>
      <tbody>
        <tr v-for="row in scheduleRows" :key="row.id" :class="{ bad: !row.ok }" @click="store.selectLine(row.id)">
          <td class="mono">{{ row.number }}</td>
          <td>{{ row.name }}</td>
          <td>{{ row.room }}</td>
          <td class="mono">{{ row.cable }}</td>
          <td class="mono">{{ String(row.length).replace('.', ',') }}</td>
          <td class="mono">{{ row.current }}</td>
          <td class="mono">{{ row.dropText }}</td>
          <td>{{ row.length > 0 ? (row.ok ? 'в норме' : 'выше 4 %') : 'нет длины' }}</td>
        </tr>
      </tbody>
    </table>

    <div v-if="view === 'plan'" v-for="group in groups" :key="group.key" class="lines-group" :class="{ ungrouped: !group.roomId && group.key === 'ungrouped', empty: !group.lines.length }">
      <div class="lines-group-head">
        <h4>{{ group.roomId ? group.title : 'Без помещения' }}</h4>
        <span v-if="group.roomId" class="mono">этаж {{ group.floor }}</span>
        <span class="mono">{{ group.lines.length }}</span>
        <button v-if="group.roomId" type="button" class="lines-room-remove" :aria-label="`Удалить помещение ${group.title}`" @click="store.deleteRoom(group.roomId!)">×</button>
      </div>

      <p v-if="!group.lines.length" class="lines-empty">Линий пока нет — добавьте первой кнопкой «+ Линия».</p>

      <div v-for="circuit in group.lines" :key="circuit.id" class="lines-row" :class="{ selected: store.selectedLineId === circuit.id }" data-line-row>
        <div class="lines-row-main" @click="store.selectLine(circuit.id)">
          <span class="lines-kind" :data-kind="circuit.kind ?? 'power'">{{ KIND_LABELS[circuit.kind ?? 'power'] }}</span>
          <input class="lines-name" :value="circuit.name" maxlength="160" aria-label="Название линии" @change="store.updateCircuit(circuit.id, { name: ($event.target as HTMLInputElement).value })" @click.stop />
          <span class="lines-phase" :data-phase="circuit.phase">L{{ circuit.phase }}</span>
        </div>
        <div class="lines-row-details">
          <label>Ток, А<input class="mono" type="number" min="0" max="10000" step="0.5" :value="circuit.current" aria-label="Ток линии" @change="store.updateCircuit(circuit.id, { current: Number(($event.target as HTMLInputElement).value) })" /></label>
          <label>Кабель, м<input class="mono" type="number" min="0" max="1000" step="0.5" :value="circuit.cableLength ?? 0" aria-label="Длина кабеля линии" @change="store.updateCircuit(circuit.id, { cableLength: Number(($event.target as HTMLInputElement).value) })" /></label>
          <label>Сечение, мм²<input class="mono" type="number" min="0.5" max="1000" step="0.5" :value="circuit.wireCrossSection" aria-label="Сечение провода линии" @change="store.updateCircuit(circuit.id, { wireCrossSection: Number(($event.target as HTMLInputElement).value) })" /></label>
          <div class="lines-protection">
            <AppSelect :model-value="circuit.protectionDeviceId" :options="protectionOptions" label="Защита линии" @update:model-value="store.updateCircuit(circuit.id, { protectionDeviceId: $event })" />
          </div>
          <span class="lines-cascade mono">{{ store.cascadeLabel(circuit.protectionDeviceId) || 'от гребёнки/шины' }}</span>
          <div class="lines-row-actions">
            <button type="button" :aria-label="`Показать аппарат линии ${circuit.name} на доске`" @click="focusDevice(circuit.protectionDeviceId)">на доску →</button>
            <button type="button" :aria-label="`Соединить линию ${circuit.name}`" @click="store.wireLine(circuit.id)">Соединить</button>
            <button type="button" class="danger" :aria-label="`Удалить линию ${circuit.name}`" @click="removeLine(circuit)">×</button>
          </div>
        </div>
      </div>
    </div>

    <AppDialog :open="lineDialogOpen" title="Новая линия" description="Линия появится в плане, а её аппарат защиты — на доске." @close="lineDialogOpen = false">
      <form class="app-dialog-form" @submit.prevent="submitLine">
        <label>Название<input v-model="lineForm.name" required maxlength="160" autofocus /></label>
        <label>Помещение<AppSelect v-model="lineForm.roomId" :options="[{ value: '', label: 'Без помещения' }, ...roomOptions]" label="Помещение линии" /></label>
        <label>Вид<AppSelect v-model="lineForm.kind" :options="kindOptions" label="Вид линии" /></label>
        <label>Аппарат защиты<AppSelect v-model="lineForm.protectionProductId" :options="catalogOptions" label="Аппарат защиты линии" /></label>
        <label>Фаза<AppSelect v-model="lineForm.phase" :options="phaseOptions" label="Фаза линии" /></label>
        <label>Ток, А<input v-model="lineForm.current" type="number" min="0" max="10000" step="0.5" required /></label>
        <div class="app-dialog-actions"><button type="button" @click="lineDialogOpen = false">Отмена</button><button class="primary-button" type="submit">Добавить линию</button></div>
      </form>
    </AppDialog>

    <AppDialog :open="roomDialogOpen" title="Новое помещение" description="Линии группируются по помещениям, как в кабельном журнале." @close="roomDialogOpen = false">
      <form class="app-dialog-form" @submit.prevent="submitRoom">
        <label>Название<input v-model="roomForm.name" required maxlength="200" autofocus /></label>
        <label>Этаж<input v-model="roomForm.floor" type="number" min="0" max="100" step="1" required /></label>
        <div class="app-dialog-actions"><button type="button" @click="roomDialogOpen = false">Отмена</button><button class="primary-button" type="submit">Добавить помещение</button></div>
      </form>
    </AppDialog>
  </section>
</template>

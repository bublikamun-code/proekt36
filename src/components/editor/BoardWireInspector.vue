<script setup lang="ts">
import { computed } from 'vue'
import AppSelect from '../ui/AppSelect.vue'
import { CONNECTION_THICKNESS_MM } from '../../domain/connectionSpec'
import { useProjectStore } from '../../stores/project'
import { faceTerminals, wireColor } from '../../domain/wiring'
import type { BusType, WireRoute, WireLayer } from '../../domain/types'

/**
 * The properties of the selected wire.
 *
 * A wire used to be a drawing and nothing else: it could be created and undone, but not read,
 * changed or removed. The only way to get rid of one was to delete a device it happened to touch,
 * which removes far more than the wire, so in practice wires stayed. This card is the other half of
 * making a wire selectable — the hit area on the board finds it, this says what it is.
 *
 * It sits on the board rather than in a side panel because the wire is one or two millimetres wide
 * and the side panels are overlays that can cover it.
 */
const props = defineProps<{ routeDraft?: WireRoute | null }>()
const emit = defineEmits<{
  editRoute: []; applyRoute: []; cancelRoute: [];
  addRoutePoint: [index: number]; removeRoutePoint: [index: number]; setRouteLayer: [index: number, layer: WireLayer];
}>()
const store = useProjectStore()

const connection = computed(() => store.selectedConnection)
const open = computed(() => Boolean(connection.value))

const BUS_OPTIONS = [
  { value: 'L', label: 'L — фаза' },
  { value: 'N', label: 'N — нейтраль' },
  { value: 'PE', label: 'PE — заземление' },
]

/** Where the wire comes from, in the words the board uses. */
const source = computed(() => {
  const wire = connection.value
  if (!wire) return ''
  if (wire.fromDeviceId) return store.currentProject.devices.find((device) => device.instanceId === wire.fromDeviceId)?.address || 'аппарат'
  return `шина ${wire.fromBus}`
})

const target = computed(() => {
  const wire = connection.value
  if (!wire) return ''
  return store.currentProject.devices.find((device) => device.instanceId === wire.toDeviceId)?.address || 'аппарат'
})

/** A wire that belongs to a circuit is drawn in the circuit's colour, so it is said so plainly. */
const belongsToCircuit = computed(() => Boolean(connection.value?.circuitId))

/**
 * The terminal block's screws, when the wire ends on one.
 *
 * A breaker decides for itself which clamp carries which bus, so there is nothing to choose. A
 * terminal block cannot: six screws of the same bus, and only the person who wired it knows that
 * this circuit sits on the third. Choosing the screw from the wire is what turns a block of six
 * drawn screws into six connection points.
 */
const terminalOptions = (source = false) => {
  const wire = connection.value
  if (!wire) return []
  const id = source ? wire.fromDeviceId : wire.toDeviceId
  const device = store.currentProject.devices.find((item) => item.instanceId === id)
  const product = device && store.definitions.get(device.productId)
  if (!product) return []
  const terminals = faceTerminals(product)
  return [...terminals.top, ...terminals.bottom]
    .filter((terminal) => terminal.bus === wire.fromBus || terminal.bus === 'aux')
    .map((terminal) => ({ value: `${terminal.side}:${terminal.column}`, label: `${terminal.label} · ${terminal.side === 'top' ? 'сверху' : 'снизу'}` }))
}
const terminals = computed(() => terminalOptions())
const sourceTerminals = computed(() => terminalOptions(true))
const selectedTerminal = (source = false) => {
  const wire = connection.value!
  const side = source ? wire.fromSide ?? 'bottom' : wire.toSide ?? 'top'
  const column = source ? wire.fromTerminal : wire.terminal
  return column === undefined ? terminalOptions(source).find((item) => item.value.startsWith(side))?.value ?? '' : `${side}:${column}`
}
const setTerminal = (value: string, source = false) => {
  const [side, column] = value.split(':')
  if (side !== 'top' && side !== 'bottom') return
  update(source ? { fromSide: side, fromTerminal: Number(column) } : { toSide: side, terminal: Number(column) })
}

const update = (patch: Parameters<typeof store.updateConnection>[1]) => {
  const wire = connection.value
  if (wire) store.updateConnection(wire.id, patch)
}

const thickness = (event: Event) => {
  const value = Number((event.target as HTMLInputElement).value)
  if (!Number.isFinite(value)) return
  update({ thickness: Math.min(CONNECTION_THICKNESS_MM.max, Math.max(CONNECTION_THICKNESS_MM.min, value)) })
}

const remove = () => {
  const wire = connection.value
  if (!wire) return
  store.deleteConnection(wire.id)
}

defineExpose({ remove })
</script>

<template>
  <aside v-if="open && connection" class="board-wire-inspector" role="group" aria-label="Свойства провода" data-testid="board-wire-inspector">
    <header>
      <strong>Провод</strong>
      <span class="board-wire-route">{{ source }} → {{ target }}</span>
      <button class="board-wire-close" type="button" aria-label="Закрыть свойства провода" @click="store.selectConnection(null)">×</button>
    </header>

    <p class="board-wire-kind">
      {{ belongsToCircuit ? 'Линия цепи' : connection.fromDeviceId ? 'Каскад между аппаратами' : `Запитка от шины ${connection.fromBus}` }}
    </p>

    <fieldset v-if="!props.routeDraft">
    <label>
      Шина
      <AppSelect
        label="Шина провода"
        :model-value="connection.fromBus"
        :options="BUS_OPTIONS"
        @update:model-value="update({ fromBus: $event as BusType })"
      />
    </label>
    <label v-if="terminals.length > 1">
      Куда · зажим
      <AppSelect label="Зажим провода" :model-value="selectedTerminal()" :options="terminals" @update:model-value="setTerminal($event)" />
    </label>
    <label v-if="sourceTerminals.length > 1">
      Откуда · зажим
      <AppSelect label="Зажим источника" :model-value="selectedTerminal(true)" :options="sourceTerminals" @update:model-value="setTerminal($event, true)" />
    </label>
    <label>
      Подпись
      <input :value="connection.label" placeholder="Например, L → QF01" @change="update({ label: ($event.target as HTMLInputElement).value })" />
    </label>
    <label>
      Толщина линии, мм
      <input
        :value="connection.thickness"
        type="number"
        :min="CONNECTION_THICKNESS_MM.min"
        :max="CONNECTION_THICKNESS_MM.max"
        :step="CONNECTION_THICKNESS_MM.step"
        @change="thickness"
      />
    </label>
    <label>
      Цвет
      <input
        type="color"
        :value="connection.color || wireColor(connection.fromBus)"
        @change="update({ color: ($event.target as HTMLInputElement).value })"
      />
    </label>

    </fieldset>
    <section v-if="props.routeDraft" class="route-editor" aria-label="Редактирование трассы">
      <strong>Трасса провода</strong>
      <p>Тяните точки на щите. Изменения сохранятся после применения.</p>
      <div v-for="(layer, index) in props.routeDraft.segmentLayers" :key="index" class="route-segment-control">
        <label>Участок {{ index + 1 }}
          <select :aria-label="`Слой участка ${index + 1}`" :value="layer" @change="emit('setRouteLayer', index, ($event.target as HTMLSelectElement).value as WireLayer)">
            <option value="front">Перед аппаратами</option><option value="rear">За аппаратами</option>
          </select>
        </label>
        <button type="button" :aria-label="`Добавить поворот на участке ${index + 1}`" :disabled="props.routeDraft.points.length >= 64" @click="emit('addRoutePoint', index)">+ Поворот</button>
        <button v-if="index < props.routeDraft.points.length" type="button" :aria-label="`Удалить поворот ${index + 1}`" @click="emit('removeRoutePoint', index)">− Точка {{ index + 1 }}</button>
      </div>
      <div class="route-actions"><button type="button" @click="emit('applyRoute')">Применить трассу</button><button type="button" @click="emit('cancelRoute')">Отменить трассу</button></div>
    </section>
    <button v-else type="button" class="route-edit-button" @click="emit('editRoute')">Изменить трассу</button>
    <button v-if="!props.routeDraft" class="board-wire-delete" type="button" @click="remove">Удалить провод</button>
  </aside>
</template>

<style scoped>
.board-wire-inspector {
  position: absolute;
  z-index: 5;
  top: 8px;
  /* The side panels are fixed overlays; the board already keeps that room clear for itself. */
  right: 8px;
  display: grid;
  gap: 6px;
  width: min(260px, calc(100% - 16px));
  max-height: calc(100% - 16px);
  overflow-y: auto;
  padding: 10px 12px;
  font-size: 12px;
  color: var(--text);
  background: var(--surface);
  border: 1px solid var(--accent);
  border-radius: 4px;
  box-shadow: 0 6px 18px rgb(0 0 0 / .18);
}

.board-wire-inspector header {
  display: flex;
  align-items: center;
  gap: 8px;
}

.board-wire-route {
  flex: 1;
  font-family: var(--mono);
  color: var(--text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.board-wire-kind {
  margin: 0;
  color: var(--text-muted);
}

.board-wire-close {
  padding: 0 4px;
  font-size: 15px;
  line-height: 1;
  color: var(--text-muted);
  background: none;
  border: 0;
  cursor: pointer;
}

.board-wire-inspector label {
  display: grid;
  gap: 2px;
  font-size: 11px;
  color: var(--text-muted);
}

.board-wire-inspector input {
  padding: 3px 6px;
  font: inherit;
  color: var(--text);
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 3px;
}

.board-wire-inspector input[type='color'] {
  height: 24px;
  padding: 1px;
}

.board-wire-delete {
  padding: 5px 8px;
  font: inherit;
  color: var(--error);
  background: none;
  border: 1px solid var(--error);
  border-radius: 3px;
  cursor: pointer;
}
</style>
<style scoped>
.board-wire-inspector fieldset { display: grid; gap: 6px; border: 0; padding: 0; margin: 0; min-width: 0; }
.route-editor { display: grid; gap: 8px; border-top: 1px solid var(--line); padding-top: 8px; }
.route-editor p { margin: 0; color: var(--text-muted); font-size: 11px; }
.route-segment-control { display: flex; gap: 5px; flex-wrap: wrap; padding: 6px; background: var(--canvas); border-radius: 3px; }
.route-segment-control label { flex-basis: 100%; }
.route-segment-control select { max-width: 100%; padding: 5px; color: var(--text); background: var(--surface); border: 1px solid var(--line); }
.route-actions { position: sticky; bottom: -10px; z-index: 2; display: flex; gap: 6px; flex-wrap: wrap; padding: 10px 0; margin-top: 2px; background: var(--surface); border-top: 1px solid var(--line); }
.route-editor button, .route-edit-button { padding: 6px 8px; border: 1px solid var(--line); background: var(--surface); color: var(--text); border-radius: 3px; cursor: pointer; }
</style>

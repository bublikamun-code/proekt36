<script setup lang="ts">
import { computed } from 'vue'
import AppSelect from '../ui/AppSelect.vue'
import { CONNECTION_THICKNESS_MM } from '../../domain/connectionSpec'
import { useProjectStore } from '../../stores/project'
import { faceTerminals, wireColor } from '../../domain/wiring'
import type { BusType } from '../../domain/types'

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
const terminals = computed(() => {
  const wire = connection.value
  if (!wire) return []
  const device = store.currentProject.devices.find((item) => item.instanceId === wire.toDeviceId)
  const product = device ? store.definitions.get(device.productId) : undefined
  if (!product || product.category !== 'terminals') return []
  return faceTerminals(product).top.map((terminal, index) => ({ value: String(index), label: `Зажим ${terminal.label}` }))
})

const setTerminal = (value: string) => {
  const index = Number(value)
  update({ terminal: index === 0 ? undefined : index })
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
      Зажим
      <AppSelect label="Зажим провода" :model-value="String(connection.terminal ?? 0)" :options="terminals" @update:model-value="setTerminal" />
    </label>
    <label>
      Подпись
      <input :value="connection.label" placeholder="Например, L → QF01" @change="update({ label: ($event.target as HTMLInputElement).value })" />
    </label>
    <label>
      Толщина, мм
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

    <button class="board-wire-delete" type="button" @click="remove">Удалить провод</button>
  </aside>
</template>

<style scoped>
.board-wire-inspector {
  position: absolute;
  z-index: 5;
  top: 8px;
  /* The side panels are fixed overlays; the board already keeps that room clear for itself. */
  right: calc(var(--panel-overlay-inline, 0px) + 8px);
  display: grid;
  gap: 6px;
  width: 232px;
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
<script setup lang="ts">
import { computed } from 'vue'
import { storeToRefs } from 'pinia'
import { bomToCsv, buildBom } from '../../domain/pricing'
import { verificationLabel as verificationLabelFor } from '../../domain/provenance'
import { useProjectStore } from '../../stores/project'

const props = defineProps<{ showPlacements?: boolean; highlightProductId?: string }>()
const emit = defineEmits<{ 'show-device': [instanceId: string] }>()
const columnCount = computed(() => props.showPlacements ? 7 : 6)
const store = useProjectStore()
const { currentProject, definitions } = storeToRefs(store)
const lines = computed(() => buildBom(currentProject.value.devices, definitions.value))
const grouped = computed(() => {
  const map = new Map<string, typeof lines.value>()
  for (const line of lines.value) map.set(line.category, [...(map.get(line.category) ?? []), line])
  return [...map.entries()]
})
const knownTotal = computed(() => lines.value.reduce((sum, line) => sum + (line.priceKnown ? line.total : 0), 0))
const hasUnknownPrices = computed(() => lines.value.some((line) => !line.priceKnown))
const weight = computed(() => currentProject.value.devices.reduce((sum, item) => sum + (definitions.value.get(item.productId)?.weight ?? 0) * item.quantity, 0))
const placements = computed(() => {
  const map = new Map<string, typeof currentProject.value.devices>()
  for (const device of currentProject.value.devices) {
    const group = map.get(device.productId) ?? []
    group.push(device)
    map.set(device.productId, group)
  }
  return map
})
const productFor = (productId: string) => definitions.value.get(productId)
const verificationLabel = (productId: string) => {
  const product = productFor(productId)
  // An imported row says so by name: "parameters not confirmed" on its own would hide the more
  // useful fact that the position came from the user's own file.
  return product?.imported && product.verificationStatus !== 'verified'
    ? 'Импорт, не проверено'
    : verificationLabelFor(product?.verificationStatus)
}

const exportCsv = () => {
  const csv = '\ufeff' + bomToCsv(currentProject.value.devices, definitions.value, ';')
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = `${currentProject.value.name || 'panel36'}-BOM.csv`; anchor.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
</script>

<template>
  <section class="bom-panel" aria-labelledby="bom-title">
    <div class="bom-heading">
      <div><span class="eyebrow">Спецификация</span><h2 id="bom-title">Сводная ведомость</h2></div>
      <div class="bom-totals">
        <span>{{ lines.length }} позиций</span>
        <strong v-if="!hasUnknownPrices">{{ knownTotal.toLocaleString('ru-RU') }} ₽</strong>
        <strong v-else>Коммерческая сумма не рассчитана</strong>
        <small>{{ weight.toFixed(2) }} кг · цены: {{ hasUnknownPrices ? 'часть уточняется' : 'предварительные' }}</small>
      </div>
      <button class="secondary-button" @click="exportCsv">Экспорт CSV</button>
    </div>
    <p v-if="hasUnknownPrices" class="bom-price-note" role="status">Для части изделий цена неизвестна. «уточняется» не является нулём; известная часть не образует коммерческую стоимость проекта.</p>
    <p v-if="showPlacements" class="bom-placement-note">Ведомость по аппаратам проекта. Количество к закупке может отличаться от числа аппаратов на щите. Нажмите обозначение, чтобы найти аппарат.</p>
    <p v-if="!lines.length" class="bom-empty">В проекте пока нет оборудования. Добавьте аппараты из каталога в режиме «Сборка щита».</p>
    <div v-else class="bom-table-wrap" tabindex="0" role="region" aria-label="Таблица спецификации">
      <table>
        <thead><tr><th>Категория / наименование</th><th>Артикул</th><th class="num">{{ showPlacements ? 'К закупке, шт.' : 'Кол-во' }}</th><th class="num">Цена, ₽</th><th class="num">Сумма, ₽</th><th>Проверка / источник</th><th v-if="showPlacements">На щите</th></tr></thead>
        <tbody v-for="[category, group] in grouped" :key="category" class="bom-group">
          <tr class="group-row"><td :colspan="columnCount">{{ category }} <span>{{ group.reduce((sum, line) => sum + line.quantity, 0) }} шт.</span></td></tr>
          <tr v-for="line in group" :key="line.productId" :data-product-id="line.productId" :class="{ 'is-highlighted': showPlacements && line.productId === highlightProductId }">
            <td><strong>{{ line.name }}</strong><small>{{ line.brand }}</small></td><td class="mono">{{ line.sku }}</td><td class="num">{{ line.quantity }}</td>
            <td class="num">{{ line.priceKnown ? line.unitPrice.toLocaleString('ru-RU') : '«уточняется»' }}</td>
            <td class="num">{{ line.priceKnown ? line.total.toLocaleString('ru-RU') : '«уточняется»' }}</td>
            <td><span>{{ verificationLabel(line.productId) }}</span><small v-if="productFor(line.productId)?.sourceUrl">Источник указан</small><small v-else>URL не указан</small></td>
            <td v-if="showPlacements" class="bom-placements">
              <span>{{ placements.get(line.productId)?.length ?? 0 }} шт.</span>
              <div class="bom-device-links">
                <button v-for="device in placements.get(line.productId)" :key="device.instanceId" type="button" class="secondary-button" :aria-label="`Показать ${device.address || 'аппарат без адреса'} на щите, ряд ${device.row + 1}, место ${device.slot + 1}`" @click="emit('show-device', device.instanceId)">{{ device.address || 'Без адреса' }} <small>Ряд {{ device.row + 1 }} · {{ device.slot + 1 }}</small></button>
              </div>
            </td>
          </tr>
        </tbody>
        <tfoot><tr><td colspan="4">{{ hasUnknownPrices ? 'Сумма с неизвестными ценами' : 'Итого, предварительно' }}</td><td :colspan="columnCount - 4" class="num">{{ hasUnknownPrices ? '«уточняется»' : `${knownTotal.toLocaleString('ru-RU')} ₽` }}</td></tr></tfoot>
      </table>
    </div>
  </section>
</template>

<style scoped>
.bom-placement-note, .bom-empty { margin: 0; padding: 14px; color: var(--text-muted); font-size: 13px; line-height: 1.6; }
.bom-empty { padding: 32px 14px; text-align: center; }
.bom-placements { min-width: 180px; }
.bom-device-links { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px; }
.bom-device-links button { text-align: left; padding: 6px 8px; }
.bom-device-links small { display: block; color: var(--text-muted); }
.is-highlighted { background: var(--accent-soft); }
.is-highlighted > td:first-child { box-shadow: inset 3px 0 var(--accent); }
.bom-table-wrap:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
</style>

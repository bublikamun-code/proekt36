<script setup lang="ts">
import { computed } from 'vue'
import { storeToRefs } from 'pinia'
import { bomToCsv, buildBom } from '../../domain/pricing'
import { verificationLabel as verificationLabelFor } from '../../domain/provenance'
import { useProjectStore } from '../../stores/project'

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
    <div class="bom-table-wrap">
      <table>
        <thead><tr><th>Категория / наименование</th><th>Артикул</th><th class="num">Кол-во</th><th class="num">Цена, ₽</th><th class="num">Сумма, ₽</th><th>Проверка / источник</th></tr></thead>
        <tbody v-for="[category, group] in grouped" :key="category" class="bom-group">
          <tr class="group-row"><td :colspan="6">{{ category }} <span>{{ group.reduce((sum, line) => sum + line.quantity, 0) }} шт.</span></td></tr>
          <tr v-for="line in group" :key="line.productId">
            <td><strong>{{ line.name }}</strong><small>{{ line.brand }}</small></td><td class="mono">{{ line.sku }}</td><td class="num">{{ line.quantity }}</td>
            <td class="num">{{ line.priceKnown ? line.unitPrice.toLocaleString('ru-RU') : '«уточняется»' }}</td>
            <td class="num">{{ line.priceKnown ? line.total.toLocaleString('ru-RU') : '«уточняется»' }}</td>
            <td><span>{{ verificationLabel(line.productId) }}</span><small v-if="productFor(line.productId)?.sourceUrl">Источник указан</small><small v-else>URL не указан</small></td>
          </tr>
        </tbody>
        <tfoot><tr><td colspan="4">{{ hasUnknownPrices ? 'Сумма с неизвестными ценами' : 'Итого, предварительно' }}</td><td colspan="2" class="num">{{ hasUnknownPrices ? '«уточняется»' : `${knownTotal.toLocaleString('ru-RU')} ₽` }}</td></tr></tfoot>
      </table>
    </div>
  </section>
</template>

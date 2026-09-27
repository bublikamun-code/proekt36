<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import { storeToRefs } from 'pinia'
import { useRouter } from 'vue-router'
import BrandMark from '../components/ui/BrandMark.vue'
import AppDialog from '../components/ui/AppDialog.vue'
import ProjectWizard from '../components/projects/ProjectWizard.vue'
import { useProjectStore } from '../stores/project'
import { useAuthStore } from '../stores/auth'
import { downloadProject, readProjectFile } from '../domain/projectFile'
import { backupNeedsLocalCad, downloadWorkspaceBackup, readWorkspaceBackup, type RestoredWorkspaceBackup } from '../domain/projectBackup'
import { useConfirm } from '../composables/useConfirm'
import { cabinetById, railById } from '../data/enclosures'
import AppSelect, { type AppSelectOption } from '../components/ui/AppSelect.vue'
import type { PanelProject } from '../domain/types'

const router = useRouter()
const store = useProjectStore()
const auth = useAuthStore()
const { confirm } = useConfirm()
const { projects, currentProject, currentProjectId, storageStatus, storageAlert, hasStorageBackup, hasStorageRecovery, lastSavedAt } = storeToRefs(store)
const { displayName, session } = storeToRefs(auth)
const wizardOpen = ref(false)
const importInput = ref<HTMLInputElement | null>(null)
const backupInput = ref<HTMLInputElement | null>(null)
const importError = ref('')
const pendingBackup = ref<RestoredWorkspaceBackup | null>(null)
const query = ref('')
const presetFilter = ref('all')
const cabinetFilter = ref('all')
const railFilter = ref('all')
const dateFilter = ref('all')
const sortBy = ref<'updated-desc' | 'updated-asc' | 'name'>('updated-desc')
const renameTarget = ref<PanelProject | null>(null)
const renameValue = ref('')
const deleteTarget = ref<PanelProject | null>(null)
const liveMessage = ref('')

const ALL = 'all'
const filterOptions = (items: AppSelectOption[]): AppSelectOption[] => [{ value: ALL, label: '' }, ...items]
const allOption = (options: AppSelectOption[], label: string): AppSelectOption[] =>
  options.map((option) => (option.value === ALL ? { ...option, label } : option))
const presetFilterOptions = computed<AppSelectOption[]>(() => filterOptions(presetOptions.value.map((preset) => ({ value: preset, label: presetTitles[preset] || preset }))))
const cabinetFilterOptions = computed<AppSelectOption[]>(() => filterOptions(cabinetOptions.value.map((id) => ({ value: id, label: id === 'legacy' ? 'Legacy-параметры' : cabinetById.get(id)?.name || id }))))
const railFilterOptions = computed<AppSelectOption[]>(() => filterOptions(railOptions.value.map((id) => ({ value: id, label: id === 'legacy' ? '17,5 мм legacy' : railById.get(id as 'rail-12' | 'rail-18')?.name || id }))))
const dateFilterOptions: AppSelectOption[] = [
  { value: ALL, label: 'За всё время' },
  { value: 'today', label: 'Сегодня' },
  { value: 'week', label: '7 дней' },
  { value: 'month', label: '30 дней' },
  { value: 'older', label: 'Более 30 дней' },
]
const sortOptions: AppSelectOption[] = [
  { value: 'updated-desc', label: 'Сначала изменённые' },
  { value: 'updated-asc', label: 'Сначала старые' },
  { value: 'name', label: 'По названию' },
]
const presetTitles: Record<string, string> = {
  apartment: 'Квартира', house: 'Дом', workshop: 'Мастерская', lighting: 'Освещение', demo: 'Demo board',
}
const formatDate = (value: string) => new Intl.DateTimeFormat('ru-RU', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
const cabinetName = (project: PanelProject) => project.settings.cabinetId ? cabinetById.get(project.settings.cabinetId)?.name || 'Legacy-параметры' : 'Legacy-параметры'
const railName = (project: PanelProject) => project.settings.railId ? railById.get(project.settings.railId)?.name || '17,5 мм legacy' : '17,5 мм legacy'
const phaseName = (project: PanelProject) => project.settings.phase === 3 ? '3 фазы' : '1 фаза'
const projectWord = (count: number) => {
  const mod100 = count % 100
  const mod10 = count % 10
  if (mod100 >= 11 && mod100 <= 14) return 'проектов'
  if (mod10 === 1) return 'проект'
  if (mod10 >= 2 && mod10 <= 4) return 'проекта'
  return 'проектов'
}
const projectAge = (project: PanelProject) => {
  const days = Math.floor((Date.now() - (Date.parse(project.updatedAt) || 0)) / 86_400_000)
  if (days <= 0) return 'today'
  if (days <= 7) return 'week'
  if (days <= 30) return 'month'
  return 'older'
}
const filtersActive = computed(() => Boolean(query.value || presetFilter.value !== 'all' || cabinetFilter.value !== 'all' || railFilter.value !== 'all' || dateFilter.value !== 'all'))
const dateMatches = (project: PanelProject) => {
  if (dateFilter.value === 'all') return true
  const age = projectAge(project)
  if (dateFilter.value === 'today') return age === 'today'
  if (dateFilter.value === 'week') return age === 'today' || age === 'week'
  if (dateFilter.value === 'month') return age === 'today' || age === 'week' || age === 'month'
  return age === 'older'
}
const filteredProjects = computed(() => {
  const term = query.value.trim().toLocaleLowerCase('ru')
  return projects.value.filter((project) => {
    const cabinet = project.settings.cabinetId || 'legacy'
    const rail = project.settings.railId || 'legacy'
    return (!term || `${project.name} ${project.preset} ${cabinetName(project)} ${railName(project)}`.toLocaleLowerCase('ru').includes(term))
      && (presetFilter.value === 'all' || project.preset === presetFilter.value)
      && (cabinetFilter.value === 'all' || cabinet === cabinetFilter.value)
      && (railFilter.value === 'all' || rail === railFilter.value)
      && dateMatches(project)
  }).sort((a, b) => {
    if (sortBy.value === 'name') return a.name.localeCompare(b.name, 'ru')
    const delta = (Date.parse(a.updatedAt) || 0) - (Date.parse(b.updatedAt) || 0)
    return sortBy.value === 'updated-asc' ? delta : -delta
  })
})
const presetOptions = computed(() => [...new Set(projects.value.map((project) => project.preset))].sort())
const cabinetOptions = computed(() => [...new Set(projects.value.map((project) => project.settings.cabinetId || 'legacy'))].sort())
const railOptions = computed(() => [...new Set(projects.value.map((project) => project.settings.railId || 'legacy'))].sort())
const saveLabel = computed(() => storageStatus.value === 'saved' ? 'Сохранено' : storageStatus.value === 'saving' ? 'Сохранение…' : storageStatus.value === 'storage-unavailable' ? 'Хранилище недоступно' : 'Ошибка сохранения')
const saveTime = computed(() => lastSavedAt.value ? new Date(lastSavedAt.value).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) : '')
const clearFilters = () => {
  query.value = ''; presetFilter.value = 'all'; cabinetFilter.value = 'all'; railFilter.value = 'all'; dateFilter.value = 'all'
  liveMessage.value = 'Фильтры сброшены.'
}

const openProject = (id: string) => {
  if (!projects.value.some((project) => project.id === id)) return
  store.switchProject(id)
  void router.push({ name: 'editor', params: { projectId: id } })
}
const createProject = ({ name, preset }: { name: string; preset: string }) => {
  store.newProject(name, preset); store.applyPreset(preset); wizardOpen.value = false; openProject(currentProjectId.value)
}
const askRename = async (id: string) => {
  const project = projects.value.find((item) => item.id === id)
  if (!project) return
  renameTarget.value = project; renameValue.value = project.name
  await nextTick()
}
const saveRename = () => {
  if (!renameTarget.value || !renameValue.value.trim()) return
  store.renameProject(renameTarget.value.id, renameValue.value)
  liveMessage.value = `Проект переименован в «${renameValue.value.trim()}».`
  renameTarget.value = null
}
const duplicateProject = (id: string) => { store.duplicateProject(id); openProject(currentProjectId.value) }
const confirmDelete = () => {
  if (!deleteTarget.value) return
  const name = deleteTarget.value.name
  store.deleteProject(deleteTarget.value.id)
  liveMessage.value = `Проект «${name}» удалён.`
  deleteTarget.value = null
}
const chooseImport = () => { importError.value = ''; importInput.value?.click() }
const importProject = async (event: Event) => {
  const input = event.target as HTMLInputElement; const file = input.files?.[0]; if (!file) return
  try {
    importError.value = ''; store.importProject(await readProjectFile(file)); openProject(currentProjectId.value)
  } catch (error) { importError.value = error instanceof Error ? error.message : 'Не удалось импортировать проект' }
  finally { input.value = '' }
}
const exportProject = (project: PanelProject) => { downloadProject(project); liveMessage.value = `Экспорт проекта «${project.name}» начат.` }
const exportBackup = async () => {
  const pending = backupNeedsLocalCad(projects.value)
  if (pending.length) {
    const sample = pending.slice(0, 3).join(', ') + (pending.length > 3 ? ` и ещё ${pending.length - 3}` : '')
    const proceed = await confirm({
      title: 'Копия не включает CAD-модели?',
      description: `Эти проекты используют локально импортированные модели (${sample}). Их файлы в копию не попадают: после восстановления такие аппараты появятся как «нет в каталоге», пока модель не будет импортирована заново. Продолжить выгрузку копии?`,
      confirmLabel: 'Выгрузить копию',
      danger: true,
    })
    if (!proceed) return
  }
  downloadWorkspaceBackup(projects.value, store.importedModels, currentProjectId.value)
  liveMessage.value = 'Экспорт резервной копии начат.'
}
const chooseBackupRestore = () => { importError.value = ''; backupInput.value?.click() }
const prepareBackupRestore = async (event: Event) => {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  try {
    importError.value = ''
    pendingBackup.value = await readWorkspaceBackup(file)
  } catch (error) {
    pendingBackup.value = null
    importError.value = error instanceof Error ? error.message : 'Не удалось прочитать резервную копию'
  } finally {
    input.value = ''
  }
}
const confirmBackupRestore = async () => {
  if (!pendingBackup.value) return
  const restored = pendingBackup.value
  pendingBackup.value = null
  await store.restoreWorkspaceBackup(restored)
  liveMessage.value = restored.pendingLocalCad.length
    ? `Резервная копия восстановлена: ${restored.projects.length} ${projectWord(restored.projects.length)}. ${restored.pendingLocalCad.length} позиций ждут повторного импорта CAD-модели.`
    : `Резервная копия восстановлена: ${restored.projects.length} ${projectWord(restored.projects.length)}.`
}
const backupDescription = computed(() => {
  const backup = pendingBackup.value
  if (!backup) return ''
  const base = `Копия содержит ${backup.projects.length} ${projectWord(backup.projects.length)}. Текущий список проектов будет заменён; локальная библиотека CAD-моделей останется доступна.`
  if (!backup.pendingLocalCad.length) return base
  const sample = backup.pendingLocalCad.slice(0, 3).join(', ') + (backup.pendingLocalCad.length > 3 ? ` и ещё ${backup.pendingLocalCad.length - 3}` : '')
  return `${base} В копии ${backup.pendingLocalCad.length} ${backup.pendingLocalCad.length === 1 ? 'позиция опирается' : 'позиций опираются'} на локально импортированные CAD-модели (${sample}), файлы которых в копию не входят: они появятся как «нет в каталоге», пока модели не будут импортированы заново.`
})
const downloadRecoverySnapshot = () => {
  if (store.downloadStorageSnapshot()) liveMessage.value = 'Снимок повреждённых данных сохранён в файл.'
}
const rollbackToSnapshot = async () => {
  const ok = await confirm({
    title: 'Откатиться к предыдущему снимку?',
    description: 'Текущие проекты будут заменены снимком, сохранённым перед последней удачной записью. Действие можно отменить через Ctrl+Z.',
    confirmLabel: 'Откатиться',
    danger: true,
  })
  if (!ok) return
  if (await store.restoreStorageBackup()) liveMessage.value = 'Восстановлен предыдущий снимок локального хранилища.'
}
const signOut = async () => { await auth.signOut(); await router.push('/') }
</script>

<template>
  <main class="projects-shell">
    <header class="projects-header">
      <RouterLink to="/" class="projects-brand" aria-label="Панель 36 — главная"><BrandMark /></RouterLink>
      <div class="projects-account">
        <span class="projects-local" :class="{ 'has-error': storageStatus === 'save-failed' || storageStatus === 'storage-unavailable' }" role="status" aria-live="polite"><i></i> {{ saveLabel }}<b v-if="saveTime" class="mono"> {{ saveTime }}</b></span>
        <span class="projects-user"><small>{{ session?.kind === 'demo' ? 'Демо-профиль' : 'Локальный режим' }}</small><strong>{{ displayName }}</strong></span>
        <button class="toolbar-button" @click="signOut">Выйти</button>
      </div>
    </header>

    <section class="projects-workspace" aria-labelledby="projects-title">
      <div class="projects-intro">
        <div>
          <span class="eyebrow">Рабочая область</span>
          <h1 id="projects-title">Проекты щитов</h1>
          <p>Проекты и импортированные модели хранятся в этом браузере. Demo-профиль не создаёт отдельное серверное хранилище.</p>
        </div>
        <div class="projects-primary-actions">
          <input ref="importInput" class="sr-only" tabindex="-1" aria-label="Файл проекта JSON" type="file" accept=".json,application/json" @change="importProject" />
          <input ref="backupInput" class="sr-only" tabindex="-1" aria-label="Файл резервной копии" type="file" accept=".json,application/json" @change="prepareBackupRestore" />
          <button class="toolbar-button" @click="chooseImport">Импортировать JSON</button>
          <button class="toolbar-button" @click="exportBackup">Создать копию</button>
          <button class="toolbar-button" @click="chooseBackupRestore">Восстановить копию</button>
          <button class="primary-button" @click="wizardOpen = true">＋ Создать панель</button>
        </div>
      </div>

      <p v-if="importError" class="home-import-error" role="alert"><b>Импорт не выполнен</b>{{ importError }}</p>
      <p v-if="storageAlert" class="home-import-error" role="alert"><b>Локальное сохранение</b>{{ storageAlert }}</p>
      <div v-if="storageAlert" class="home-import-error-actions">
        <button v-if="hasStorageRecovery" type="button" @click="downloadRecoverySnapshot">Скачать снимок</button>
        <button v-if="hasStorageBackup" type="button" @click="rollbackToSnapshot">Откатиться к снимку</button>
        <button type="button" @click="store.dismissStorageAlert">Скрыть</button>
      </div>

      <section class="projects-filters" aria-label="Поиск и фильтрация проектов">
        <label class="project-search">Поиск проекта<input v-model="query" type="search" placeholder="Название, пресет, корпус или рейка" /></label>
        <label>Пресет<AppSelect label="Пресет" :model-value="presetFilter" :options="allOption(presetFilterOptions, 'Все пресеты')" @update:model-value="presetFilter = $event" /></label>
        <label>Корпус<AppSelect label="Корпус" :model-value="cabinetFilter" :options="allOption(cabinetFilterOptions, 'Все корпуса')" @update:model-value="cabinetFilter = $event" /></label>
        <label>Рейка<AppSelect label="Рейка" :model-value="railFilter" :options="allOption(railFilterOptions, 'Все рейки')" @update:model-value="railFilter = $event" /></label>
        <label>Дата изменения<AppSelect label="Дата изменения" :model-value="dateFilter" :options="dateFilterOptions" @update:model-value="dateFilter = $event" /></label>
        <label>Сортировка<AppSelect label="Сортировка" :model-value="sortBy" :options="sortOptions" @update:model-value="sortBy = $event as 'updated-desc' | 'updated-asc' | 'name'" /></label>
        <button type="button" :disabled="!filtersActive" @click="clearFilters">Сбросить фильтры</button>
        <p class="filter-count" role="status" aria-live="polite">Показано {{ filteredProjects.length }} из {{ projects.length }}</p>
      </section>

      <div v-if="filteredProjects.length" class="project-card-grid">
        <article v-for="project in filteredProjects" :key="project.id" class="home-project-card" :class="{ current: project.id === currentProject.id }">
          <div class="project-card-top"><span class="project-card-kind">{{ presetTitles[project.preset] || 'Проект' }}</span><span v-if="project.id === currentProject.id" class="current-badge">Текущий</span></div>
          <h2>{{ project.name }}</h2>
          <div class="project-card-metrics"><span><b>{{ project.devices.length }}</b> устройств</span><span><b>{{ project.circuits.length }}</b> цепей</span><span><b>{{ project.settings.rows }}</b> рядов</span></div>
          <dl class="project-card-specs"><div><dt>Корпус</dt><dd>{{ cabinetName(project) }}</dd></div><div><dt>Рейка</dt><dd>{{ railName(project) }}</dd></div><div><dt>Сеть</dt><dd>{{ phaseName(project) }} · {{ project.settings.inputCurrent }} А</dd></div></dl>
          <footer class="project-card-footer">
            <time :datetime="project.updatedAt">Изменён {{ formatDate(project.updatedAt) }}</time>
            <div class="project-card-actions">
              <button class="icon-button" :aria-label="`Открыть проект ${project.name}`" title="Открыть" @click="openProject(project.id)">↗</button>
              <button class="icon-button" :aria-label="`Экспортировать проект ${project.name}`" title="Экспортировать" @click="exportProject(project)">↧</button>
              <button class="icon-button" :aria-label="`Переименовать проект ${project.name}`" title="Переименовать" @click="askRename(project.id)">✎</button>
              <button class="icon-button" :aria-label="`Дублировать проект ${project.name}`" title="Дублировать" @click="duplicateProject(project.id)">⧉</button>
              <button class="icon-button danger" :aria-label="`Удалить проект ${project.name}`" title="Удалить" @click="deleteTarget = project">×</button>
            </div>
          </footer>
        </article>
      </div>

      <section v-else class="projects-empty" role="status" aria-live="polite">
        <span aria-hidden="true">∅</span>
        <h2>{{ projects.length ? 'Проекты не найдены' : 'Проектов пока нет' }}</h2>
        <p>{{ projects.length ? 'Измените запрос или сбросьте фильтры.' : 'Создайте первую панель или импортируйте JSON.' }}</p>
        <button v-if="filtersActive" type="button" @click="clearFilters">Сбросить фильтры</button>
        <button v-else class="primary-button" @click="wizardOpen = true">Создать панель</button>
      </section>

      <p class="home-storage-note"><span>i</span> Экспортируйте проект или резервную копию в JSON, чтобы сохранить переносимую копию.</p>
    </section>

    <ProjectWizard v-if="wizardOpen" @close="wizardOpen = false" @create="createProject" />
    <AppDialog :open="Boolean(pendingBackup)" title="Восстановить резервную копию?" :description="backupDescription" @close="pendingBackup = null">
      <div class="app-dialog-actions"><button type="button" autofocus @click="pendingBackup = null">Отмена</button><button class="danger-button" type="button" @click="confirmBackupRestore">Заменить и восстановить</button></div>
    </AppDialog>
    <AppDialog :open="Boolean(renameTarget)" title="Переименовать проект" description="Введите новое название. Изменение можно отменить кнопкой «Отмена»." @close="renameTarget = null">
      <form class="app-dialog-form" @submit.prevent="saveRename">
        <label>Новое имя панели<input v-model="renameValue" required maxlength="160" autofocus /></label>
        <div class="app-dialog-actions"><button type="button" @click="renameTarget = null">Отмена</button><button class="primary-button" type="submit">Сохранить</button></div>
      </form>
    </AppDialog>
    <AppDialog :open="Boolean(deleteTarget)" title="Удалить проект?" :description="deleteTarget ? `Проект «${deleteTarget.name}» и его локальная копия будут удалены. Это действие нельзя отменить.` : ''" @close="deleteTarget = null">
      <div class="app-dialog-actions"><button type="button" autofocus @click="deleteTarget = null">Отмена</button><button class="danger-button" type="button" @click="confirmDelete">Удалить безвозвратно</button></div>
    </AppDialog>
    <p class="sr-only" aria-live="polite">{{ liveMessage }}</p>
  </main>
</template>

<style scoped>
.projects-shell { min-height: 100vh; background: var(--canvas); }
.projects-header { min-height: 66px; display: flex; align-items: center; justify-content: space-between; gap: 24px; padding: 0 clamp(16px, 4vw, 64px); background: var(--surface); border-bottom: 1px solid var(--line); }
.projects-brand { min-height: 44px; display: inline-flex; align-items: center; color: inherit; text-decoration: none; }
.projects-account { display: flex; align-items: center; gap: 16px; }
.projects-local { display: inline-flex; align-items: center; gap: 7px; color: var(--text-muted); font:500 var(--text-micro) var(--mono); }
.projects-local i { width: 7px; height: 7px; border-radius: 50%; background: var(--ok); box-shadow: 0 0 0 3px var(--ok-soft); }
.projects-local.has-error i { background: var(--error); box-shadow: 0 0 0 3px var(--error-soft); }
.projects-user { display: flex; flex-direction: column; align-items: flex-end; gap: 2px; }
.projects-user small { color: var(--text-faint); font-size: var(--text-micro); }.projects-user strong { max-width: 180px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: var(--text-xs); }
.projects-workspace { width: min(100% - 32px, 1280px); margin: 0 auto; padding: clamp(42px, 7vw, 82px) 0 72px; }
.projects-intro { display: flex; align-items: flex-end; justify-content: space-between; gap: 32px; margin-bottom: 24px; }.projects-intro > div:first-child { max-width: 650px; }.projects-intro h1 { margin-top: 7px; font-size: clamp(32px, 5vw, 52px); letter-spacing: -.035em; }.projects-intro p { max-width: 620px; margin-top: 14px; color: var(--text-muted); font-size: var(--text-sm); line-height: 1.6; }.projects-primary-actions { display: flex; flex-wrap: wrap; gap: 8px; }.projects-primary-actions button { min-height: 44px; padding: 0 15px; }
.projects-filters { display: grid; grid-template-columns: minmax(220px, 2fr) repeat(5, minmax(130px, 1fr)) auto; gap: 8px; align-items: end; margin-bottom: 18px; padding: 12px; background: var(--surface); border: 1px solid var(--line); }.projects-filters button { min-height: 36px; }.filter-count { grid-column: 1 / -1; color: var(--text-muted); font:var(--text-micro) var(--mono); }.projects-local b { font-size: var(--text-micro); }
.projects-empty { display: grid; justify-items: center; gap: 8px; padding: 54px 20px; background: var(--surface); border: 1px dashed var(--line); text-align: center; }.projects-empty > span { font: 42px var(--mono); color: var(--accent); }.projects-empty p { max-width: 440px; color: var(--text-muted); font-size: var(--text-xs); }.projects-empty button { min-height: 42px; margin-top: 6px; }
@media (max-width: 1000px) { .projects-filters { grid-template-columns: repeat(3, 1fr); }.project-search { grid-column: 1 / -1; } }
@media (max-width: 760px) {
  .projects-header { min-height: 58px; padding: 0 8px 0 14px; }.projects-local { display: none; }.projects-user small { display: none; }.projects-user strong { max-width: 120px; }
  .projects-workspace { width: min(100% - 28px, 1280px); padding-top: 38px; }.projects-intro { display: block; }.projects-primary-actions { display: grid; grid-template-columns: 1fr 1fr; margin-top: 22px; }.projects-primary-actions button { width: 100%; padding: 0 8px; }.projects-primary-actions button:last-child { grid-column: 1 / -1; }
  .projects-filters { grid-template-columns: 1fr 1fr; }.project-search { grid-column: 1 / -1; }.projects-filters > button { grid-column: 1 / -1; }
}
</style>

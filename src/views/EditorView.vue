<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useRoute, useRouter } from 'vue-router'
import CatalogPanel from '../components/catalog/CatalogPanel.vue'
import Editor2D from '../components/editor/Editor2D.vue'
import DevicePositionPad from '../components/editor/DevicePositionPad.vue'
import InspectorPanel from '../components/inspector/InspectorPanel.vue'
import BomPanel from '../components/bom/BomPanel.vue'
import BrandMark from '../components/ui/BrandMark.vue'
import AppDialog from '../components/ui/AppDialog.vue'
import ProjectPrintReport from '../components/ui/ProjectPrintReport.vue'
import ProjectWizard from '../components/projects/ProjectWizard.vue'
import { useProjectStore } from '../stores/project'
import { usePreferencesStore } from '../stores/preferences'
import { downloadProject, readProjectFile } from '../domain/projectFile'
import { backupNeedsLocalCad, downloadWorkspaceBackup, readWorkspaceBackup, type RestoredWorkspaceBackup } from '../domain/projectBackup'
import { useConfirm } from '../composables/useConfirm'
import type { Category, PanelProject } from '../domain/types'

const route = useRoute()
const router = useRouter()
const store = useProjectStore()
const preferences = usePreferencesStore()
const { confirm } = useConfirm()
const { currentProject, projects, currentProjectId, selectedDevice, undoStack, redoStack, theme, definitions, importedModels, storageStatus, storageError, storageAlert, hasStorageBackup, hasStorageRecovery, lastSavedAt } = storeToRefs(store)
const { panelsOpen } = storeToRefs(preferences)
/**
 * Whether the editor shows the board alone. It is kept rather than reset on every visit: a
 * refresh in the middle of a layout should not also close the panels the user was working with.
 * Writable, so the existing assignments and the scrim keep working unchanged.
 */
const canvasFocus = computed({
  get: () => !panelsOpen.value,
  set: (value: boolean) => { preferences.setPanelsOpen(!value) },
})
const wizardOpen = ref(false)
const catalogFocus = ref<Category | null>(null)
const mobilePanel = ref<'catalog' | 'inspector' | null>(null)
const projectOpen = ref(false)
const jsonInput = ref<HTMLInputElement | null>(null)
const backupInput = ref<HTMLInputElement | null>(null)
const pendingBackup = ref<RestoredWorkspaceBackup | null>(null)
const renameTarget = ref<PanelProject | null>(null)
const renameValue = ref('')
const deleteTarget = ref<PanelProject | null>(null)
const clearConfirmOpen = ref(false)
const liveMessage = ref('')
const projectSwitcher = ref<HTMLButtonElement | null>(null)
const projectSwitcherWrap = ref<HTMLElement | null>(null)
const projectMenu = ref<HTMLElement | null>(null)

const autosaveLabel = computed(() => ({ saving: 'Сохранение…', saved: 'Сохранено', 'save-failed': 'Не сохранено', 'storage-unavailable': 'Хранилище недоступно' }[storageStatus.value]))
const projectWord = (count: number) => {
  const mod100 = count % 100
  const mod10 = count % 10
  if (mod100 >= 11 && mod100 <= 14) return 'проектов'
  if (mod10 === 1) return 'проект'
  if (mod10 >= 2 && mod10 <= 4) return 'проекта'
  return 'проектов'
}
const autosaveTime = computed(() => storageStatus.value === 'saved' && lastSavedAt.value ? new Date(lastSavedAt.value).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) : '')
const replaceEditorRoute = (id: string) => router.replace({ name: 'editor', params: { projectId: id } })
const openProject = (id: string) => {
  if (!projects.value.some((project) => project.id === id)) return
  store.switchProject(id); projectOpen.value = false; void replaceEditorRoute(id)
}
/**
 * The parameterless `/app/editor` link is canonicalised in the router guard, so by the time this
 * view exists the route already carries a project id. What is left to handle is an id that points
 * at a project which is no longer there.
 */
const syncProjectFromRoute = async () => {
  const routeProjectId = route.params.projectId
  const projectId = Array.isArray(routeProjectId) ? routeProjectId[0] : routeProjectId
  if (typeof projectId !== 'string') return
  if (projects.value.some((project) => project.id === projectId)) {
    if (currentProjectId.value !== projectId) store.switchProject(projectId)
    return
  }
  store.notify('Проект не найден', 'error'); await router.replace({ name: 'projects' })
}
watch(() => route.params.projectId, () => { void syncProjectFromRoute() }, { immediate: true })

const createFromMaster = ({ name, preset }: { name: string; preset: string }) => {
  store.newProject(name, preset); store.applyPreset(preset); wizardOpen.value = false; mobilePanel.value = null; void replaceEditorRoute(currentProjectId.value)
}
const exportProject = () => { downloadProject(currentProject.value); liveMessage.value = `Экспорт проекта «${currentProject.value.name}» начат.` }
/**
 * The archive never carries CAD binaries, so a project that uses a locally imported model
 * only comes back as a placeholder. Saying so before the download beats letting the user
 * discover it after wiping the browser.
 */
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
  downloadWorkspaceBackup(projects.value, importedModels.value, currentProjectId.value)
  liveMessage.value = 'Экспорт резервной копии начат.'
}
const chooseBackupRestore = () => { backupInput.value?.click() }
const prepareBackupRestore = async (event: Event) => {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  try {
    pendingBackup.value = await readWorkspaceBackup(file)
  } catch (error) {
    store.notify(error instanceof Error ? error.message : 'Не удалось прочитать резервную копию', 'error')
  } finally {
    input.value = ''
  }
}
const confirmBackupRestore = async () => {
  if (!pendingBackup.value) return
  const restored = pendingBackup.value
  pendingBackup.value = null
  await store.restoreWorkspaceBackup(restored)
  void replaceEditorRoute(currentProjectId.value)
  liveMessage.value = restored.pendingLocalCad.length
    ? `Резервная копия восстановлена: ${restored.projects.length} ${projectWord(restored.projects.length)}. ${restored.pendingLocalCad.length} позиций ждут повторного импорта CAD-модели.`
    : `Резервная копия восстановлена: ${restored.projects.length} ${projectWord(restored.projects.length)}.`
}
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
const backupDescription = computed(() => {
  const backup = pendingBackup.value
  if (!backup) return ''
  const base = `Копия содержит ${backup.projects.length} ${projectWord(backup.projects.length)}. Текущий список проектов будет заменён; локальная библиотека CAD-моделей останется доступна.`
  if (!backup.pendingLocalCad.length) return base
  const sample = backup.pendingLocalCad.slice(0, 3).join(', ') + (backup.pendingLocalCad.length > 3 ? ` и ещё ${backup.pendingLocalCad.length - 3}` : '')
  return `${base} В копии ${backup.pendingLocalCad.length} ${backup.pendingLocalCad.length === 1 ? 'позиция опирается' : 'позиций опираются'} на локально импортированные CAD-модели (${sample}), файлы которых в копию не входят: они появятся как «нет в каталоге», пока модели не будут импортированы заново.`
})

const removeSelected = async () => {
  if (!selectedDevice.value) return
  const name = selectedDevice.value.address || selectedDevice.value.instanceId
  const ok = await confirm({
    title: 'Удалить устройство?',
    description: `Устройство «${name}» и все его подключения будут удалены из щита. Действие можно отменить через Ctrl+Z.`,
    confirmLabel: 'Удалить устройство',
    danger: true,
  })
  if (ok) store.deleteSelected()
}
const saveNow = async () => {
  const status = await store.flushPersistence()
  liveMessage.value = status === 'saved' ? 'Изменения сохранены локально.' : storageError.value || 'Не удалось сохранить изменения.'
}
const importProject = async (event: Event) => {
  const input = event.target as HTMLInputElement; const file = input.files?.[0]; if (!file) return
  try { store.importProject(await readProjectFile(file)); void replaceEditorRoute(currentProjectId.value) }
  catch (error) { store.notify(error instanceof Error ? error.message : 'Не удалось импортировать проект', 'error') }
  input.value = ''
}
const duplicate = (id: string) => { store.duplicateProject(id); closeProjectMenu(); void replaceEditorRoute(currentProjectId.value) }
/**
 * The menu rows live inside a `v-if`, so they are detached the moment the menu
 * closes. Park focus on the trigger first: the dialog restores focus to whatever
 * was focused when it opened, and `<body>` would lose the user's place entirely.
 */
const closeProjectMenuForDialog = async () => {
  projectOpen.value = false
  await nextTick()
  projectSwitcher.value?.focus()
}
const askRename = async (id: string) => {
  const project = projects.value.find((item) => item.id === id); if (!project) return
  renameTarget.value = project; renameValue.value = project.name; await closeProjectMenuForDialog()
}
const saveRename = () => {
  if (!renameTarget.value || !renameValue.value.trim()) return
  store.renameProject(renameTarget.value.id, renameValue.value); liveMessage.value = 'Название проекта обновлено.'; renameTarget.value = null
}
const askDelete = async (id: string) => {
  deleteTarget.value = projects.value.find((item) => item.id === id) || null
  await closeProjectMenuForDialog()
}
const remove = () => {
  if (!deleteTarget.value) return
  const deletedId = deleteTarget.value.id
  store.deleteProject(deletedId); liveMessage.value = 'Проект удалён.'; deleteTarget.value = null
  void replaceEditorRoute(currentProjectId.value)
}
const clearData = async () => {
  await store.clearLocalData(); clearConfirmOpen.value = false; liveMessage.value = 'Локальные данные удалены.'
}
const printProject = () => requestAnimationFrame(() => window.print())
const togglePanels = () => {
  if (window.matchMedia('(max-width: 760px)').matches) { mobilePanel.value = mobilePanel.value === 'catalog' ? null : 'catalog'; return }
  canvasFocus.value = !canvasFocus.value
}
const isTextEntry = (target: EventTarget | null) => target instanceof HTMLElement && (target.matches('input, textarea, select') || target.isContentEditable)
/** Collapse the floating panels when the board itself is clicked, but keep the click that selects a device. */
const onWorkspaceClick = (event: MouseEvent) => {
  if (canvasFocus.value || window.matchMedia('(max-width: 1024px)').matches) return
  const target = event.target
  if (target instanceof Element && target.closest('.catalog-panel, .inspector-panel')) return
  if (target instanceof Element && target.closest('.placed-device, .slot-cell, .row-capacity, .cabinet-label, button, a, input, select, textarea')) return
  canvasFocus.value = true
}
const focusCatalogSearch = async () => { await nextTick(); document.querySelector<HTMLInputElement>('[aria-label="Поиск по каталогу"]')?.focus() }
const menuItems = () => Array.from(projectMenu.value?.querySelectorAll<HTMLElement>('.project-select') ?? [])
/** Open the project menu on the project that is already current, so the keyboard path starts where the user is. */
const openProjectMenu = async () => {
  projectOpen.value = !projectOpen.value
  if (!projectOpen.value) return
  await nextTick()
  const current = projectMenu.value?.querySelector<HTMLElement>('[aria-current="page"]') as HTMLElement | null
  ;(current ?? menuItems()[0])?.focus()
}
const onProjectMenuKeydown = (event: KeyboardEvent) => {
  const items = menuItems()
  if (!items.length) return
  const index = items.indexOf(document.activeElement as HTMLElement)
  const step = (from: number) => items[(from + items.length) % items.length]
  const keys: Record<string, HTMLElement | undefined> = {
    ArrowDown: step(index + 1),
    ArrowUp: step(index - 1),
    Home: items[0],
    End: items[items.length - 1],
  }
  const next = keys[event.key]
  if (!next) return
  event.preventDefault()
  next.focus()
}
const closeProjectMenu = () => {
  if (!projectOpen.value) return
  projectOpen.value = false
  nextTick(() => projectSwitcher.value?.focus())
}
const onDocumentPointerDown = (event: MouseEvent) => {
  if (projectOpen.value && !projectSwitcherWrap.value?.contains(event.target as Node)) projectOpen.value = false
}
const keyHandler = (event: KeyboardEvent) => {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault()
    if (window.matchMedia('(max-width: 760px)').matches) mobilePanel.value = 'catalog'
    else { canvasFocus.value = false; void focusCatalogSearch() }
  }
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z' && !isTextEntry(event.target)) { event.preventDefault(); event.shiftKey ? store.redo() : store.undo() }
  if (event.key === 'Escape' && !wizardOpen.value && !pendingBackup.value && !renameTarget.value && !deleteTarget.value && !clearConfirmOpen.value) { closeProjectMenu(); mobilePanel.value = null }
}
onMounted(() => {
  window.addEventListener('keydown', keyHandler)
  document.addEventListener('mousedown', onDocumentPointerDown)
})
onUnmounted(() => {
  window.removeEventListener('keydown', keyHandler)
  document.removeEventListener('mousedown', onDocumentPointerDown)
})
</script>

<template>
  <div class="app-shell canvas-focus" :class="{ 'panels-open': !canvasFocus }">
    <header class="app-header">
      <BrandMark />
      <button class="toolbar-button projects-back" aria-label="Вернуться к проектам" @click="router.push({ name: 'projects' })">← Проекты</button>
      <div ref="projectSwitcherWrap" class="project-switcher-wrap">
        <button ref="projectSwitcher" class="project-switcher" :aria-expanded="projectOpen" aria-haspopup="true" aria-controls="project-menu" @click="openProjectMenu">
          <span><small>Текущий проект</small><strong>{{ currentProject.name }}</strong></span>
          <svg viewBox="0 0 20 20" aria-hidden="true"><path d="m5 7 5 5 5-5" /></svg>
        </button>
        <div v-if="projectOpen" id="project-menu" ref="projectMenu" class="project-menu" role="group" aria-label="Проекты" @keydown="onProjectMenuKeydown">
          <div class="project-menu-list">
            <div v-for="project in projects" :key="project.id" class="project-row" :class="{ active: project.id === currentProject.id }">
              <button class="project-select" :aria-label="`Открыть проект ${project.name}: ${project.devices.length} устройств, фаза ${project.settings.phase}`" :aria-current="project.id === currentProject.id ? 'page' : undefined" @click="openProject(project.id)"><span><strong>{{ project.name }}</strong><small>{{ project.devices.length }} устройств · {{ project.settings.phase }} ф.</small></span></button>
              <span class="project-actions">
                <button class="project-action" :aria-label="`Переименовать проект ${project.name}`" title="Переименовать" @click="askRename(project.id)">✎</button>
                <button class="project-action" :aria-label="`Дублировать проект ${project.name}`" title="Дублировать" @click="duplicate(project.id)">⧉</button>
                <button class="project-action danger" :aria-label="`Удалить проект ${project.name}`" title="Удалить" @click="askDelete(project.id)">×</button>
              </span>
            </div>
          </div>
          <button class="new-project-button" @click="wizardOpen = true; projectOpen = false">＋ Новый проект</button>
          <button class="project-clear-button" data-local-clear @click="clearConfirmOpen = true; projectOpen = false">Очистить локальные данные</button>
        </div>
      </div>
      <div class="header-status" :class="{ 'status-error': storageStatus === 'save-failed', 'status-warning': storageStatus === 'storage-unavailable' }" role="status" aria-live="polite" :title="storageError || autosaveLabel"><i></i><span>{{ autosaveLabel }}</span><b v-if="autosaveTime" class="mono">{{ autosaveTime }}</b></div>
      <div class="header-actions">
        <input ref="jsonInput" class="sr-only" tabindex="-1" aria-label="Файл проекта JSON" type="file" accept=".json,application/json" @change="importProject" />
        <input ref="backupInput" class="sr-only" tabindex="-1" aria-label="Файл резервной копии" type="file" accept=".json,application/json" @change="prepareBackupRestore" />
        <button class="toolbar-button" @click="jsonInput?.click()">Импорт JSON</button>
        <button class="toolbar-button" @click="exportProject">Экспорт</button>
        <button class="toolbar-button" @click="exportBackup">Создать копию</button>
        <button class="toolbar-button" @click="chooseBackupRestore">Восстановить</button>
        <button class="toolbar-button" :disabled="storageStatus === 'saved'" @click="saveNow">Сохранить</button>
        <button class="toolbar-button" data-print-project @click="printProject">Печать</button>
        <button class="toolbar-button icon-only" :aria-label="theme === 'light' ? 'Включить тёмную тему' : 'Включить светлую тему'" @click="store.theme = theme === 'light' ? 'dark' : 'light'">{{ theme === 'light' ? '◐' : '○' }}</button>
      </div>
    </header>

    <div v-if="storageAlert" class="editor-storage-alert" role="alert"><b>Локальное сохранение</b><span>{{ storageAlert }}</span><button type="button" @click="saveNow">Повторить</button><button type="button" @click="exportBackup">Экспортировать копию</button><button v-if="hasStorageRecovery" type="button" @click="downloadRecoverySnapshot">Скачать снимок</button><button v-if="hasStorageBackup" type="button" @click="rollbackToSnapshot">Откатиться к снимку</button><button type="button" @click="store.dismissStorageAlert">Скрыть</button></div>

    <div class="action-bar">
      <div class="project-name"><span class="mono">ID {{ currentProject.id.slice(0, 8).toUpperCase() }}</span><b>{{ currentProject.name }}</b></div>
      <div class="edit-actions" role="toolbar" aria-label="Действия редактирования">
        <button :disabled="!undoStack.length" title="Отменить (Ctrl+Z)" @click="store.undo">↶ Отменить</button>
        <button :disabled="!redoStack.length" title="Повторить (Ctrl+Shift+Z)" @click="store.redo">↷ Повторить</button>
        <span class="action-separator"></span><button :disabled="!selectedDevice" @click="store.duplicateSelected">Дублировать</button><button class="danger" :disabled="!selectedDevice" @click="removeSelected">Удалить</button><button @click="store.autoNumberAll">Авто-нумерация</button>
      </div>
    </div>

    <main class="workspace" @click="onWorkspaceClick">
      <CatalogPanel :focus-category="catalogFocus" :class="{ 'mobile-active': mobilePanel === 'catalog' }" />
      <div class="center-workspace">
        <Editor2D :focused="canvasFocus" @toggle-focus="togglePanels" />
        <DevicePositionPad v-if="selectedDevice" />
        <BomPanel />
        <ProjectPrintReport :project="currentProject" :definitions="definitions" />
      </div>
      <InspectorPanel :class="{ 'mobile-active': mobilePanel === 'inspector' }" @focus-category="catalogFocus = $event" />
    </main>

    <Transition name="panel-scrim"><div v-if="!canvasFocus" class="panel-scrim" @click="canvasFocus = true"></div></Transition>
    <nav class="mobile-nav" aria-label="Мобильные панели">
      <button :class="{ active: mobilePanel === 'catalog' }" :aria-pressed="mobilePanel === 'catalog'" aria-label="Открыть каталог устройств" @click="mobilePanel = mobilePanel === 'catalog' ? null : 'catalog'">Каталог</button>
      <button :class="{ active: mobilePanel === null }" :aria-pressed="mobilePanel === null" aria-label="Показать схему щита" @click="mobilePanel = null">Схема</button>
      <button :class="{ active: mobilePanel === 'inspector' }" :aria-pressed="mobilePanel === 'inspector'" aria-label="Открыть инспектор" @click="mobilePanel = mobilePanel === 'inspector' ? null : 'inspector'">Инспектор</button>
    </nav>
    <div v-if="mobilePanel" class="sheet-backdrop" @click="mobilePanel = null"></div>

    <ProjectWizard v-if="wizardOpen" @close="wizardOpen = false" @create="createFromMaster" />
    <AppDialog :open="Boolean(pendingBackup)" title="Восстановить резервную копию?" :description="backupDescription" @close="pendingBackup = null">
      <div class="app-dialog-actions"><button type="button" autofocus @click="pendingBackup = null">Отмена</button><button class="danger-button" type="button" @click="confirmBackupRestore">Заменить и восстановить</button></div>
    </AppDialog>
    <AppDialog :open="Boolean(renameTarget)" title="Переименовать проект" description="Введите новое название проекта." @close="renameTarget = null">
      <form class="app-dialog-form" @submit.prevent="saveRename"><label>Новое имя панели<input v-model="renameValue" required maxlength="160" autofocus /></label><div class="app-dialog-actions"><button type="button" @click="renameTarget = null">Отмена</button><button class="primary-button" type="submit">Сохранить</button></div></form>
    </AppDialog>
    <AppDialog :open="Boolean(deleteTarget)" title="Удалить проект?" :description="deleteTarget ? `Проект «${deleteTarget.name}» будет удалён без возможности восстановления.` : ''" @close="deleteTarget = null">
      <div class="app-dialog-actions"><button type="button" autofocus @click="deleteTarget = null">Отмена</button><button class="danger-button" type="button" @click="remove">Удалить безвозвратно</button></div>
    </AppDialog>
    <AppDialog :open="clearConfirmOpen" title="Очистить локальные данные?" description="Все локальные проекты и импортированные CAD-модели будут удалены. Это действие нельзя отменить." @close="clearConfirmOpen = false">
      <div class="app-dialog-actions"><button type="button" autofocus @click="clearConfirmOpen = false">Отмена</button><button class="danger-button" type="button" @click="clearData">Очистить всё</button></div>
    </AppDialog>
    <p class="sr-only" aria-live="polite">{{ liveMessage }}</p>
  </div>
</template>

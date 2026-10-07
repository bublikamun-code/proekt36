<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useRoute, useRouter } from 'vue-router'
import BrandMark from '../components/ui/BrandMark.vue'
import BomPanel from '../components/bom/BomPanel.vue'
import CatalogPanel from '../components/catalog/CatalogPanel.vue'
import InspectorPanel from '../components/inspector/InspectorPanel.vue'
import BoardScene, { type BoardTool } from '../components/editor/BoardScene.vue'
import ProjectPrintReport from '../components/ui/ProjectPrintReport.vue'
import { demoProject } from '../data/demoProject'
import { useProjectStore } from '../stores/project'
import { usePreferencesStore } from '../stores/preferences'
import { downloadProject } from '../domain/projectFile'
import { useProjectArchive } from '../composables/useProjectArchive'

/**
 * The rebuilt workspace.
 *
 * It wears the shell the rest of the application already has — the same catalogue, the same
 * inspector, the same undo rules — and replaces only the board. That is the whole point of keeping
 * the domain layer: the panels are bound to the store, not to a particular drawing component, so
 * moving to the new scene meant mounting the same components around it rather than rewriting them.
 */
const store = useProjectStore()
const router = useRouter()
const { importProjectFile, exportProjectArchive, busy: archiveBusy } = useProjectArchive()
const liveMessage = ref('')
const route = useRoute()
const { currentProject, projects, currentProjectId, definitions, undoStack, redoStack, storageStatus, storageError } = storeToRefs(store)
const preferences = usePreferencesStore()
const theme = computed(() => preferences.theme)

const scale = ref(1)
const mobilePanel = ref<'catalog' | 'inspector'>('catalog')
const scene = ref<InstanceType<typeof BoardScene> | null>(null)

const workspaceMode = computed(() => route.query.view === 'bom' ? 'bom' : 'assembly')
const modeLocation = (mode: 'assembly' | 'bom') => {
  const { view: _view, ...query } = route.query
  return { path: route.path, query: mode === 'bom' ? { ...query, view: 'bom' } : query }
}
const showDeviceOnBoard = async (instanceId: string) => {
  if (!currentProject.value.devices.some((device) => device.instanceId === instanceId)) return
  store.selectDevice(instanceId)
  // On phones an open side panel covers the board. Reveal the selected apparatus first.
  canvasFocus.value = true
  tool.value = 'select'
  await router.push(modeLocation('assembly'))
  await nextTick()
  await scene.value?.revealDevice(instanceId)
}
const tool = ref<BoardTool>('select')
watch(workspaceMode, () => {
  tool.value = 'select'
  scene.value?.cancelInteraction()
})
const TOOLS: { id: BoardTool; label: string; hint: string }[] = [
  { id: 'select', label: 'Выбрать', hint: 'Выделить аппарат или провод. Клавиша 1' },
  { id: 'address', label: 'Адрес', hint: 'Подписать аппарат на корпусе. Клавиша 2' },
  { id: 'pan', label: 'Переместить вид', hint: 'Перетаскивание вида. Клавиша 4; также средняя кнопка мыши или Пробел на поле' },
  { id: 'wire', label: 'Провести', hint: 'Соединить два зажима или зажим с шиной L, N или PE. Клавиша 3' },
]

const onBoardKey = (event: KeyboardEvent) => {
  // The shortcut is for the board, not for whatever the person happens to be typing into. A digit
  // typed into a price field must not switch tools, and Escape in a text field must not.
  const target = event.target as HTMLElement | null
  if (target && (target.isContentEditable || /^(input|textarea|select)$/i.test(target.tagName))) return
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
    event.preventDefault(); if (event.shiftKey) store.redo(); else store.undo(); return
  }
  if (workspaceMode.value !== 'assembly') return
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() !== 'd') return
  if (event.altKey) return
  if (event.key === '1') { tool.value = 'select'; return }
  if (event.key === '2') { tool.value = 'address'; return }
  if (event.key === '3') { tool.value = 'wire'; return }
  if (event.key === '4') { tool.value = 'pan'; return }
  if (event.key.toLowerCase() === 'c' && store.selectedDevice) { scene.value?.createCircuit(store.selectedDeviceId!); return }
  if (event.key === 'Escape') { tool.value = 'select'; scene.value?.cancelInteraction(); store.selectConnection(null); return }

  // Delete and duplicate act on whatever is selected, and both are one keystroke away from a
  // mistake. They are undoable, which is why there is no confirmation dialog: an interrupted
  // two-step dialog is worse than an action that is both faster and reversible.
  if (event.key === 'Delete' || event.key === 'Backspace') {
    // A picked wire goes before a picked device: it is the smaller thing to lose, and Delete on
    // the one you can see highlighted is the one you meant.
    if (store.selectedConnection) {
      event.preventDefault()
      store.deleteConnection(store.selectedConnection.id)
      return
    }
    if (store.selectedDevice) {
      event.preventDefault()
      store.deleteSelected()
      return
    }
  }
  if (event.key.toLowerCase() === 'd' && (event.ctrlKey || event.metaKey)) {
    event.preventDefault()
    store.duplicateSelected()
  }
}

// The board is not a focusable widget, so the shortcut has to be heard from the window. Typing into
// the address field keeps its own digits.
onMounted(() => window.addEventListener('keydown', onBoardKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onBoardKey))
const canvasFocus = ref(false)

const panelsOpen = ref(preferences.panelsOpen)

/**
 * A board with nothing wired on it cannot show whether the tracing works, so an empty workspace
 * gets the demo project: connections on all three buses and a cascade, as an ordinary editable
 * project.
 *
 * The condition is deliberately "no projects at all" rather than "no project has connections".
 * The looser rule hijacked a real workspace: open the new board with an ordinary seeded project
 * lying about and you get a different project pushed in front of you because none of your devices
 * happened to be wired yet. That made the page depend on unrelated history — including, in the test
 * suite, on whichever test had run before this one.
 *
 * `?fixture=demo` asks for it explicitly, which is what the tests and the runbook use.
 */
const wantsDemoFixture = () => route.query.fixture === 'demo'

/**
 * The project named in the address, when there is one.
 *
 * The route `/app/projects/:projectId/board` is what a person reaches from the project list, and it
 * says which project it draws. Following it here — rather than only switching the store — is what
 * makes a link to somebody else's board open their board instead of whichever one was last open.
 */
const openProjectInRoute = () => {
  const id = typeof route.params.projectId === 'string' ? route.params.projectId : ''
  if (!id || id === currentProjectId.value) return false
  if (!projects.value.some((project) => project.id === id)) return false
  store.switchProject(id)
  return true
}

onMounted(() => {
  if (wantsDemoFixture() || !store.projects.length) {
    store.importProject({ ...structuredClone(demoProject), id: 'board-fixture', name: 'Доска · проверка трассировки' })
    const { fixture: _fixture, ...query } = route.query
    void router.replace({ name: 'project-board', params: { projectId: store.currentProjectId }, query })
  }
  // An explicit fixture is an explicit request for that project, so the address does not get to
  // choose: `?fixture=demo` was arriving at `/app/projects/<другой>/board`, where the guard had put
  // the seeded project, and the board came up with no wires on it at all.
  if (!wantsDemoFixture()) openProjectInRoute()
})

const togglePanels = () => {
  panelsOpen.value = canvasFocus.value || !panelsOpen.value
  preferences.setPanelsOpen(panelsOpen.value)
  canvasFocus.value = false
}

const printReport = () => window.print()

/**
 * Taking the project out of the browser, and putting a file back in.
 *
 * The same functions the old editor uses, over the same store. Export writes a plain JSON envelope;
 * import accepts either that envelope or a model archive, so a file exported from either place
 * opens here. Without this the board was a way of looking at a project rather than a way of doing
 * one: everything lived in the tab and left with the tab.
 */
const exportProject = () => {
  downloadProject(currentProject.value)
  liveMessage.value = `Экспорт проекта «${currentProject.value.name}» начат.`
}

const exportWithModels = async () => {
  const result = await exportProjectArchive(currentProject.value)
  liveMessage.value = result.missing
    ? `Экспорт архива начат. ${result.missing} моделей не нашлось в библиотеке и в архив не попали.`
    : `Экспорт архива начат. В архиве ${result.archive} моделей.`
  return result
}

const importFile = async (event: Event) => {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  try {
    const result = await importProjectFile(file)
    liveMessage.value = `Проект «${result.project.name}» загружен.`
  } catch (error) {
    store.notify(error instanceof Error ? error.message : 'Не удалось прочитать файл', 'error')
  }
}

/**
 * The project switcher, as a plain select.
 *
 * The old editor opens a menu with rename, duplicate and delete beside each project. A select
 * cannot carry that, and pretending otherwise would be worse than saying what it is: this one
 * switches projects and nothing else, while those actions stay on the projects page, where the
 * whole list is visible to act on.
 */
const openProject = (event: Event) => {
  const id = (event.target as HTMLSelectElement).value
  if (id && id !== currentProjectId.value) {
    store.switchProject(id)
    // The address names the project, so switching by hand keeps saying which one is on the board.
    // A stale address is worse than no address: a refresh would bring back the board just left.
    void router.replace({ name: 'project-board', params: { projectId: id }, query: route.query })
  }
}

watch(() => route.params.projectId, () => { if (!wantsDemoFixture()) openProjectInRoute() })
const deleteSelection = () => {
  if (store.selectedConnection) store.deleteConnection(store.selectedConnection.id)
  else store.deleteSelected()
}
const saveStatus = computed(() => storageStatus.value === 'saving' ? 'Сохраняем…' : storageStatus.value === 'saved' ? 'Все изменения сохранены на устройстве' : 'Проект хранится на устройстве')

const canUndo = () => undoStack.value.length > 0
const canRedo = () => redoStack.value.length > 0
</script>

<template>
  <div class="app-shell canvas-focus board-workspace" :class="[{ 'panels-open': panelsOpen && !canvasFocus }, `mobile-panel-${mobilePanel}`]">
    <header class="app-header">
      <BrandMark />
      <button class="toolbar-button projects-back" aria-label="Вернуться к проектам" @click="router.push({ name: 'projects' })">← Проекты</button>
      <label class="board-switcher">
        <span class="sr-only">Текущий проект</span>
        <select :value="currentProjectId" data-testid="board-project-switcher" @change="openProject">
          <option v-for="project in projects" :key="project.id" :value="project.id">{{ project.name }}</option>
        </select>
      </label>

      <nav class="workspace-modes" aria-label="Режим проекта">
        <RouterLink :to="modeLocation('assembly')" :aria-current="workspaceMode === 'assembly' ? 'page' : undefined">Сборка щита</RouterLink>
        <RouterLink :to="modeLocation('bom')" :aria-current="workspaceMode === 'bom' ? 'page' : undefined">Спецификация</RouterLink>
      </nav>

      <div v-show="workspaceMode === 'assembly'" class="board-tools" role="toolbar" aria-label="Инструменты доски">
        <button
          v-for="entry in TOOLS"
          :key="entry.id"
          class="toolbar-button"
          :aria-pressed="tool === entry.id"
          :title="entry.hint"
          :data-tool="entry.id"
          @click="tool = entry.id"
        >{{ entry.label }}</button>
      </div>

      <div v-show="workspaceMode === 'assembly'" class="board-scale">
        <label for="board-zoom">Масштаб</label>
        <input id="board-zoom" v-model.number="scale" type="range" min="0.5" max="2.5" step="0.1" />
        <span aria-live="off">{{ Math.round(scale * 100) }}%</span>
        <button class="toolbar-button" :aria-pressed="scale === 1" @click="scene?.fitView()">Вписать</button>
      </div>

      <div class="toolbar-group">
        <button v-show="workspaceMode === 'assembly'" class="toolbar-button" :disabled="!store.selectedDevice" title="Создать цепь для выбранного аппарата. Клавиша C" @click="scene?.createCircuit(store.selectedDeviceId!)">Создать цепь</button>
        <button v-show="workspaceMode === 'assembly'" class="toolbar-button" :disabled="!store.selectedDevice && !store.selectedConnection" title="Удалить выбранный аппарат или провод. Клавиша Delete" @click="deleteSelection">Удалить</button>
        <button v-show="workspaceMode === 'assembly'" class="toolbar-button" :disabled="!store.selectedDevice" title="Продублировать выбранный аппарат. Ctrl+D" @click="store.duplicateSelected()">Дублировать</button>
        <button class="toolbar-button" :disabled="!canUndo()" @click="store.undo()">↶ Отменить</button>
        <button class="toolbar-button" :disabled="!canRedo()" @click="store.redo()">↷ Повторить</button>
        <button v-show="workspaceMode === 'assembly'" class="toolbar-button" :aria-pressed="panelsOpen && !canvasFocus" @click="togglePanels">
          {{ panelsOpen && !canvasFocus ? 'Скрыть боковые панели' : 'Показать боковые панели' }}
        </button>
        <button class="toolbar-button" :aria-pressed="theme === 'dark'" :aria-label="theme === 'dark' ? 'Включить светлую тему' : 'Включить тёмную тему'" @click="preferences.toggleTheme()">{{ theme === 'light' ? '◐' : '○' }}</button>
        <label class="toolbar-button board-import" :class="{ 'is-busy': archiveBusy }">
          Импорт
          <input type="file" accept=".json,.panel36.zip" class="sr-only" data-testid="board-import" @change="importFile" />
        </label>
        <button class="toolbar-button" :disabled="archiveBusy" @click="exportProject">Экспорт</button>
        <button class="toolbar-button" :disabled="archiveBusy" title="Экспорт проекта вместе с CAD-моделями" @click="exportWithModels">Экспорт с моделями</button>
        <button class="toolbar-button" @click="printReport">Печать</button>
      </div>
      <div v-if="workspaceMode === 'assembly' && panelsOpen && !canvasFocus" class="mobile-panel-tabs" role="group" aria-label="Боковая панель">
        <button class="toolbar-button" :aria-pressed="mobilePanel === 'catalog'" @click="mobilePanel = 'catalog'">Каталог</button>
        <button class="toolbar-button" :aria-pressed="mobilePanel === 'inspector'" @click="mobilePanel = 'inspector'">Свойства</button>
      </div>
    </header>

    <p v-if="storageError" class="storage-banner" role="status">{{ storageError }}</p>
    <p v-else-if="liveMessage" class="storage-banner storage-banner-quiet" role="status">{{ liveMessage }}</p>
    <p v-else class="storage-banner storage-banner-quiet" role="status">{{ saveStatus }} · {{ currentProject.devices.length }} аппаратов · {{ currentProject.connections.length }} соединений</p>

    <main class="workspace" :class="{ 'specification-mode': workspaceMode === 'bom' }">
      <CatalogPanel v-show="workspaceMode === 'assembly'" :class="{ 'mobile-active': false }" />
      <div class="center-workspace">
        <BoardScene v-show="workspaceMode === 'assembly'" ref="scene" :active="workspaceMode === 'assembly'" :scale="scale" :tool="tool" @update:scale="scale = $event" @update:tool="tool = $event" />
        <BomPanel v-if="workspaceMode === 'bom'" show-placements :highlight-product-id="store.selectedDevice?.productId" @show-device="showDeviceOnBoard" />
        <ProjectPrintReport :project="currentProject" :definitions="definitions" />
      </div>
      <InspectorPanel v-show="workspaceMode === 'assembly'" />
    </main>
  </div>
</template>

<style scoped>
.workspace-modes { display: flex; gap: 4px; padding: 3px; border: 1px solid var(--line); border-radius: 8px; background: var(--surface); }
.workspace-modes a { padding: 7px 10px; border-radius: 5px; color: var(--text-muted); text-decoration: none; font-size: 13px; white-space: nowrap; }
.workspace-modes a[aria-current='page'] { background: var(--accent); color: var(--on-accent); }
.workspace-modes a:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.board-workspace { grid-template-columns: minmax(0, 1fr); grid-template-rows: auto auto minmax(0, 1fr); padding-bottom: 0; }
.board-workspace .app-header { min-width: 0; flex-wrap: wrap; gap: 10px 14px; padding: 12px 16px; }
.board-workspace .brand { color: var(--heading); }
.board-switcher { flex: 1; min-width: 140px; max-width: 340px; }
.board-switcher select { width: 100%; text-overflow: ellipsis; }
.board-workspace .toolbar-group { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; flex-basis: 100%; padding-top: 8px; border-top: 1px solid var(--line-soft); }
.board-workspace .toolbar-button { min-height: 34px; border-radius: 6px; white-space: nowrap; }
.board-workspace .workspace { min-width: 0; min-height: 0; overflow: hidden; }
.board-workspace.panels-open .workspace { grid-template-columns: 280px minmax(240px, 1fr) 300px; }
.board-workspace .workspace > .catalog-panel,
.board-workspace .workspace > .inspector-panel { position: static; width: auto; min-height: 0; height: 100%; transform: none; box-shadow: none; transition: none; overflow-y: auto; }
.board-workspace:not(.panels-open) .workspace > .catalog-panel,
.board-workspace:not(.panels-open) .workspace > .inspector-panel { display: none; }
.mobile-panel-tabs { display: none; }
@media (max-width: 1100px) {
  .board-workspace.panels-open .workspace { grid-template-columns: 270px minmax(0, 1fr); }
  .mobile-panel-tabs { display: flex; gap: 6px; }
  .board-workspace.mobile-panel-catalog .workspace > .inspector-panel,
  .board-workspace.mobile-panel-inspector .workspace > .catalog-panel { display: none; }
  .board-workspace.mobile-panel-inspector .workspace > .inspector-panel { grid-column: 1; grid-row: 1; }
  .board-workspace.panels-open .center-workspace { grid-column: 2; grid-row: 1; }
}
@media (max-width: 600px) {
  .board-workspace .app-header { gap: 6px; padding: 8px; }
  .board-workspace .toolbar-group { flex-wrap: nowrap; overflow-x: auto; overflow-y: hidden; padding-bottom: 4px; }
  .board-scale { flex: 1; }
  .board-workspace.panels-open .workspace { grid-template-columns: minmax(0, 1fr); }
  .board-workspace.panels-open .workspace > .catalog-panel,
  .board-workspace.panels-open .workspace > .inspector-panel { grid-column: 1; grid-row: 1; }
  .board-workspace.panels-open .center-workspace { visibility: hidden; grid-column: 1; }
}

.board-import {
  display: inline-flex;
  align-items: center;
  padding: 6px 10px;
  border: 1px solid var(--line);
  position: relative;
  cursor: pointer;
}

.board-import.is-busy {
  opacity: .5;
  pointer-events: none;
}

.board-tools {
  display: flex;
  gap: 4px;
}

.board-tools .toolbar-button[aria-pressed='true'] {
  background: var(--accent);
  color: var(--on-accent);
}

.board-title {
  font-size: 15px;
  margin: 0;
  font-weight: 600;
}

.board-scale {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--text-muted);
}

.board-scale input {
  width: 120px;
}

.storage-banner {
  margin: 0;
  padding: 6px 16px;
  font-size: 12px;
  background: var(--surface-raised);
  color: var(--text);
  border-bottom: 1px solid var(--board-plate-edge);
}

.storage-banner-quiet {
  background: var(--surface-raised);
}
.board-workspace .workspace.specification-mode { grid-template-columns: minmax(0, 1fr); }
.board-workspace .specification-mode .center-workspace { min-height: 0; grid-column: 1; grid-row: 1; visibility: visible; overflow-y: auto; }
.board-workspace .specification-mode :deep(.bom-panel) { display: block; margin: 20px auto; width: calc(100% - 32px); max-width: 1400px; border-radius: 10px; overflow: hidden; }
.board-workspace .specification-mode :deep(.bom-table-wrap) { max-height: none; }
@media (max-width: 600px) {
  .board-workspace .specification-mode :deep(.bom-panel) { width: calc(100% - 16px); margin: 8px; }
  .board-workspace .specification-mode :deep(.bom-heading) { grid-template-columns: 1fr; gap: 12px; }
  .board-workspace .specification-mode :deep(.bom-totals) { text-align: left; display: flex; flex-wrap: wrap; grid-column: 1; grid-row: auto; }
  .board-workspace .specification-mode :deep(.bom-heading .secondary-button) { grid-column: 1; grid-row: auto; }
}


</style>

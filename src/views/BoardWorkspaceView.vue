<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { storeToRefs } from 'pinia'
import { useRoute, useRouter } from 'vue-router'
import BrandMark from '../components/ui/BrandMark.vue'
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
const scene = ref<InstanceType<typeof BoardScene> | null>(null)

/**
 * The board's active tool, and the shortcut that reaches it.
 *
 * Two tools so far. The wire tool is deliberately absent: it is the one mode whose behaviour is
 * still an open decision, and a button promising a wire that cannot be drawn yet would be a lie.
 */
const tool = ref<BoardTool>('select')
const TOOLS: { id: BoardTool; label: string; hint: string }[] = [
  { id: 'select', label: 'Выбрать', hint: 'Выделить аппарат или провод. Клавиша 1' },
  { id: 'address', label: 'Адрес', hint: 'Подписать аппарат на корпусе. Клавиша 2' },
  { id: 'wire', label: 'Провести', hint: 'Соединить два зажима или зажим с шиной L, N или PE. Клавиша 3' },
]

const onBoardKey = (event: KeyboardEvent) => {
  // The shortcut is for the board, not for whatever the person happens to be typing into. A digit
  // typed into a price field must not switch tools, and Escape in a text field must not.
  const target = event.target as HTMLElement | null
  if (target && (target.isContentEditable || /^(input|textarea|select)$/i.test(target.tagName))) return
  if (event.key === '1') { tool.value = 'select'; return }
  if (event.key === '2') { tool.value = 'address'; return }
  if (event.key === '3') { tool.value = 'wire'; return }
  if (event.key.toLowerCase() === 'c' && store.selectedDevice) { scene.value?.createCircuit(store.selectedDeviceId!); return }
  if (event.key === 'Escape') { tool.value = 'select'; scene.value?.cancelWire(); store.selectConnection(null); return }

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
  }
  // An explicit fixture is an explicit request for that project, so the address does not get to
  // choose: `?fixture=demo` was arriving at `/app/projects/<другой>/board`, where the guard had put
  // the seeded project, and the board came up with no wires on it at all.
  if (!wantsDemoFixture()) openProjectInRoute()
})

const togglePanels = () => {
  panelsOpen.value = !panelsOpen.value
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

const canUndo = () => undoStack.value.length > 0
const canRedo = () => redoStack.value.length > 0
</script>

<template>
  <div class="app-shell canvas-focus" :class="{ 'panels-open': panelsOpen && !canvasFocus }">
    <header class="app-header">
      <BrandMark />
      <button class="toolbar-button projects-back" aria-label="Вернуться к проектам" @click="router.push({ name: 'projects' })">← Проекты</button>
      <label class="board-switcher">
        <span class="sr-only">Текущий проект</span>
        <select :value="currentProjectId" data-testid="board-project-switcher" @change="openProject">
          <option v-for="project in projects" :key="project.id" :value="project.id">{{ project.name }}</option>
        </select>
      </label>

      <div class="board-tools" role="toolbar" aria-label="Инструменты доски">
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

      <div class="board-scale">
        <label for="board-zoom">Масштаб</label>
        <input id="board-zoom" v-model.number="scale" type="range" min="0.5" max="2.5" step="0.1" />
        <span aria-live="off">{{ Math.round(scale * 100) }}%</span>
      </div>

      <div class="toolbar-group">
        <button class="toolbar-button" :disabled="!store.selectedDevice" title="Создать цепь для выбранного аппарата. Клавиша C" @click="scene?.createCircuit(store.selectedDeviceId!)">Создать цепь</button>
        <button class="toolbar-button" :disabled="!store.selectedDevice" title="Удалить выбранный аппарат. Клавиша Delete" @click="store.deleteSelected()">Удалить</button>
        <button class="toolbar-button" :disabled="!store.selectedDevice" title="Продублировать выбранный аппарат. Ctrl+D" @click="store.duplicateSelected()">Дублировать</button>
        <button class="toolbar-button" :disabled="!canUndo()" @click="store.undo()">↶ Отменить</button>
        <button class="toolbar-button" :disabled="!canRedo()" @click="store.redo()">↷ Повторить</button>
        <button class="toolbar-button" :aria-pressed="panelsOpen" @click="togglePanels">
          {{ panelsOpen ? 'Скрыть боковые панели' : 'Показать боковые панели' }}
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
    </header>

    <p v-if="storageError" class="storage-banner" role="status">{{ storageError }}</p>
    <p v-else-if="liveMessage" class="storage-banner storage-banner-quiet" role="status">{{ liveMessage }}</p>
    <p v-else class="storage-banner storage-banner-quiet" role="status">Сохранено локально · {{ storageStatus }}</p>

    <main class="workspace">
      <CatalogPanel :class="{ 'mobile-active': false }" />
      <div class="center-workspace">
        <BoardScene ref="scene" :scale="scale" :tool="tool" @update:tool="tool = $event" />
        <ProjectPrintReport :project="currentProject" :definitions="definitions" />
      </div>
      <InspectorPanel />
    </main>
  </div>
</template>

<style scoped>
.board-import {
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
  color: var(--board-ink);
}

.board-scale input {
  width: 120px;
}

.storage-banner {
  margin: 0;
  padding: 6px 16px;
  font-size: 12px;
  background: var(--board-slot-wide);
  color: var(--text);
  border-bottom: 1px solid var(--board-plate-edge);
}

.storage-banner-quiet {
  background: var(--board-slot);
}
</style>

import { computed, ref, type Ref } from 'vue'
import { backupNeedsLocalCad, downloadWorkspaceBackup, readWorkspaceBackup, type RestoredWorkspaceBackup } from '../domain/projectBackup'
import { useProjectStore } from '../stores/project'
import type { ModelMetadata, PanelProject } from '../domain/types'

/** Russian plural for "проект", which has three forms and is easy to get wrong by hand. */
export const projectWord = (count: number) => {
  const mod100 = count % 100
  const mod10 = count % 10
  if (mod100 >= 11 && mod100 <= 14) return 'проектов'
  if (mod10 === 1) return 'проект'
  if (mod10 >= 2 && mod10 <= 4) return 'проекта'
  return 'проектов'
}

/** Joins the first few names and counts the rest, so a long list does not fill the dialog. */
const sampleNames = (names: string[]) => `${names.slice(0, 3).join(', ')}${names.length > 3 ? ` и ещё ${names.length - 3}` : ''}`

const RESTORE_READ_FAILED = 'Не удалось прочитать резервную копию'
const ROLLBACK_CONFIRM = 'Откатиться к предыдущему снимку?'
const ROLLBACK_DESCRIPTION = 'Текущие проекты будут заменены снимком, сохранённым перед последней удачной записью. Действие можно отменить через Ctrl+Z.'
const CAD_ABSENT_TITLE = 'Копия не включает CAD-модели?'
const CAD_ABSENT_DESCRIPTION = (sample: string) => `Эти проекты используют локально импортированные модели (${sample}). Их файлы в копию не попадают: после восстановления такие аппараты появятся как «нет в каталоге», пока модель не будет импортирована заново. Продолжить выгрузку копии?`
const RESTORED_MESSAGE = (projects: number, pendingLocalCad: number) => pendingLocalCad
  ? `Резервная копия восстановлена: ${projects} ${projectWord(projects)}. ${pendingLocalCad} позиций ждут повторного импорта CAD-модели.`
  : `Резервная копия восстановлена: ${projects} ${projectWord(projects)}.`

export interface WorkspaceBackupOptions {
  projects: Ref<PanelProject[]>
  importedModels: Ref<ModelMetadata[]>
  currentProjectId: Ref<string | null>
  /**
   * The file input the view renders. It stays with the view because it is markup, and a template
   * ref declared inside this composable is not something the type checker recognises as used by
   * the view's own template.
   */
  backupInput: Ref<HTMLInputElement | null>
  confirm: (input: { title: string; description: string; confirmLabel: string; danger?: boolean }) => Promise<boolean>
  /** Where the view puts a status line the screen reader announces. */
  announce: (text: string) => void
  /** Where the view puts a read failure; the project list has its own inline error slot. */
  reportError?: (text: string) => void
  /** Runs before the file picker opens, so the list can clear a stale import error. */
  beforeChoose?: () => void
  /** Runs after a restore, so the editor can put its deep link back where the store now points.
   *  Whatever the router call returns is ignored, so any return type is accepted. */
  onRestored?: () => unknown
}

/**
 * Workspace backup and recovery, for the two places that offer it: the project list and the
 * editor. Both asked the user about missing CAD models, read the archive, described what was
 * about to be replaced and offered the storage rollback with the same words; a difference in one
 * copy reached the user and the other kept saying the old thing. The copies are what this
 * composable removes — the two views keep only what is genuinely theirs: where the message goes
 * and what to do with the route afterwards.
 */
export const useWorkspaceBackup = (options: WorkspaceBackupOptions) => {
  const store = useProjectStore()
  const pendingBackup = ref<RestoredWorkspaceBackup | null>(null)
  const { backupInput } = options

  const reportError = options.reportError ?? ((text: string) => store.notify(text, 'error'))

  const exportBackup = async () => {
    const pending = backupNeedsLocalCad(options.projects.value)
    if (pending.length) {
      const proceed = await options.confirm({
        title: CAD_ABSENT_TITLE,
        description: CAD_ABSENT_DESCRIPTION(sampleNames(pending)),
        confirmLabel: 'Выгрузить копию',
        danger: true,
      })
      if (!proceed) return
    }
    downloadWorkspaceBackup(options.projects.value, options.importedModels.value, options.currentProjectId.value)
    options.announce('Экспорт резервной копии начат.')
  }

  const chooseBackupRestore = () => {
    options.beforeChoose?.()
    backupInput.value?.click()
  }

  const prepareBackupRestore = async (event: Event) => {
    const input = event.target as HTMLInputElement
    const file = input.files?.[0]
    if (!file) return
    try {
      pendingBackup.value = await readWorkspaceBackup(file)
    } catch (error) {
      pendingBackup.value = null
      reportError(error instanceof Error ? error.message : RESTORE_READ_FAILED)
    } finally {
      // Cleared so re-picking the same file fires `change` again.
      input.value = ''
    }
  }

  const confirmBackupRestore = async () => {
    if (!pendingBackup.value) return
    const restored = pendingBackup.value
    pendingBackup.value = null
    await store.restoreWorkspaceBackup(restored)
    await options.onRestored?.()
    options.announce(RESTORED_MESSAGE(restored.projects.length, restored.pendingLocalCad.length))
  }

  const backupDescription = computed(() => {
    const backup = pendingBackup.value
    if (!backup) return ''
    const base = `Копия содержит ${backup.projects.length} ${projectWord(backup.projects.length)}. Текущий список проектов будет заменён; локальная библиотека CAD-моделей останется доступна.`
    if (!backup.pendingLocalCad.length) return base
    const pending = backup.pendingLocalCad.length
    const plural = pending === 1 ? 'позиция опирается' : 'позиций опираются'
    return `${base} В копии ${pending} ${plural} на локально импортированные CAD-модели (${sampleNames(backup.pendingLocalCad)}), файлы которых в копию не входят: они появятся как «нет в каталоге», пока модели не будут импортированы заново.`
  })

  const downloadRecoverySnapshot = () => {
    if (store.downloadStorageSnapshot()) options.announce('Снимок повреждённых данных сохранён в файл.')
  }

  const rollbackToSnapshot = async () => {
    const ok = await options.confirm({
      title: ROLLBACK_CONFIRM,
      description: ROLLBACK_DESCRIPTION,
      confirmLabel: 'Откатиться',
      danger: true,
    })
    if (!ok) return
    if (await store.restoreStorageBackup()) options.announce('Восстановлен предыдущий снимок локального хранилища.')
  }

  return { pendingBackup, exportBackup, chooseBackupRestore, prepareBackupRestore, confirmBackupRestore, backupDescription, downloadRecoverySnapshot, rollbackToSnapshot }
}

import { computed, ref, type Ref } from 'vue'
import { backupNeedsLocalCad, describeBackupRestore, downloadWorkspaceBackup, readWorkspaceBackup, type RestoredWorkspaceBackup } from '../domain/projectBackup'
import { modelWord, projectWord } from '../domain/plural'
import { useProjectStore } from '../stores/project'
import { useProjectArchive } from './useProjectArchive'
import { BACKUP_ENTRY, jsonFileFor, type ArchivedModel } from '../domain/cadArchive'
import type { ModelMetadata, PanelProject } from '../domain/types'

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
  const archive = useProjectArchive()
  const pendingBackup = ref<RestoredWorkspaceBackup | null>(null)
  /** Models carried by the picked archive, restored only after the user confirms. */
  const pendingCad = ref<ArchivedModel[]>([])
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

  /**
   * The archive variant. It asks the same question as the JSON copy and then does what the copy
   * cannot: carry the models themselves, so a restore after clearing the browser does not come
   * back full of "нет в каталоге".
   */
  const exportBackupWithCad = async () => {
    const result = await archive.exportWorkspaceArchive()
    if (!result.archive && !result.missing) {
      // Nothing in the projects reaches outside the catalogue, so there is nothing to carry and
      // the plain copy is the better file. No archive is left behind and no success is announced.
      await exportBackup()
      return
    }
    options.announce(result.missing
      ? `Архив выгружен: ${result.archive} ${modelWord(result.archive)}, но ${result.missing} ${modelWord(result.missing)} в локальной библиотеке не найдено и в архив не попала.`
      : `Архив с моделями выгружен: ${result.archive} ${modelWord(result.archive)}.`)
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
      const opened = await archive.openArchive(file)
      pendingCad.value = opened?.models ?? []
      pendingBackup.value = opened
        ? await readWorkspaceBackup(jsonFileFor(BACKUP_ENTRY, opened.json))
        : await readWorkspaceBackup(file)
    } catch (error) {
      pendingBackup.value = null
      pendingCad.value = []
      reportError(error instanceof Error ? error.message : RESTORE_READ_FAILED)
    } finally {
      // Cleared so re-picking the same file fires `change` again.
      input.value = ''
    }
  }

  const confirmBackupRestore = async () => {
    if (!pendingBackup.value) return
    const restored = pendingBackup.value
    const models = pendingCad.value
    // The picked file is only forgotten once the restore actually happened. A storage failure in
    // between used to discard the user's choice and leave the promise unhandled.
    try {
      await store.restoreWorkspaceBackup(restored)
      pendingBackup.value = null
      pendingCad.value = []
      // Models go in after the projects, so a project that references one finds it already there.
      const carried = models.length ? await archive.restoreModels(models) : { models: 0, skipped: 0 }
      await options.onRestored?.()
      options.announce(`${RESTORED_MESSAGE(restored.projects.length, restored.pendingLocalCad.length)}${carried.models ? ` Возвращено моделей: ${carried.models}.` : ''}`)
    } catch (error) {
      reportError(error instanceof Error ? error.message : 'Не удалось восстановить копию')
    }
  }

  /**
   * The archive carries the models, so the two files have to be described differently: a JSON copy
   * says the geometry is not in it and will have to be imported again, an archive says what it does
   * bring back. Telling an archive "the files are not in the copy" was the wrong thing in both
   * directions — it lost the point of the archive and contradicted the message shown afterwards.
   */
  const backupDescription = computed(() => {
    const backup = pendingBackup.value
    if (!backup) return ''
    // The description is a pure function of the copy and what the archive carries, so it lives in
    // the domain and is tested directly. Its earlier version lived in this computed, which is how a
    // branch became unreachable: the condition could never be false, and nobody noticed because
    // reading a computed is not a test.
    return describeBackupRestore(backup, pendingCad.value.map((item) => item.metadata.id))
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

  return { pendingBackup, archiveBusy: archive.busy, exportBackup, exportBackupWithCad, chooseBackupRestore, prepareBackupRestore, confirmBackupRestore, backupDescription, downloadRecoverySnapshot, rollbackToSnapshot, archive }
}

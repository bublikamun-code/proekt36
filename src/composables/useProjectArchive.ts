import { ref } from 'vue'
import {
  ARCHIVE_MAX_BYTES,
  BACKUP_ENTRY,
  PROJECT_ENTRY,
  createCadArchive,
  downloadArchive,
  isZipArchive,
  jsonFileFor,
  modelBytes,
  readCadArchive,
  safeFileName,
  type ArchivedModel,
} from '../domain/cadArchive'
import { backupNeedsLocalCad, createWorkspaceBackup } from '../domain/projectBackup'
import { createProjectFileEnvelope, readProjectFile } from '../domain/projectFile'
import { detectImportKind, validateGltfZip, validateModelFile } from '../storage/modelImport'
import { getModelAsset } from '../storage/modelDb'
import { useProjectStore } from '../stores/project'
import type { ModelMetadata, PanelProject } from '../domain/types'

/**
 * The archive path, in one place.
 *
 * There are two ways to take work out of this application — one project, or the whole workspace —
 * and two ways to put it back, and the JSON-only pair of them already existed. The archive adds a
 * third to each. Spreading that over two views and a store would have produced four copies of the
 * same "which models does this file need" question, so the rule lives here:
 *
 * - a project archive carries only the models that project uses, not the whole library;
 * - a workspace archive carries every model the projects in it reference;
 * - on the way back, model bytes are handed to `validateModelFile` — the same check a manual
 *   import goes through — before anything is written to IndexedDB. An archive is a transport, not
 *   a way around the import rules.
 */

export type ArchiveImportResult = { models: number; skipped: number }

/** Models a project reaches, by the same rule the backup warning uses: outside the catalogue. */
export const modelsUsedBy = (projects: PanelProject[], library: ModelMetadata[]): ModelMetadata[] => {
  const referenced = new Set(backupNeedsLocalCad(projects))
  return library.filter((model) => referenced.has(model.id))
}

const readModelBytes = async (models: ModelMetadata[]): Promise<ArchivedModel[]> => {
  const archived: ArchivedModel[] = []
  for (const metadata of models) {
    const data = await getModelAsset(metadata.id).catch(() => undefined)
    // A model whose bytes are gone from IndexedDB is skipped and counted, rather than written
    // into an archive as a manifest entry with no data behind it.
    if (data) archived.push({ metadata, data: new Uint8Array(data) })
  }
  return archived
}

export const useProjectArchive = () => {
  const store = useProjectStore()
  const busy = ref(false)

  /**
   * Reads an archive without applying any of it, so the caller decides what the file means: the
   * project path imports it, the backup path puts it in front of the user and waits for a
   * confirmation, exactly as it does for a JSON copy.
   */
  const openArchive = async (file: File) => {
    if (file.size > ARCHIVE_MAX_BYTES) throw new Error('Архив больше 200 МБ')
    const data = await file.arrayBuffer()
    if (!isZipArchive(data)) return null
    return readCadArchive(data)
  }

  /**
   * Restores the model binaries. The bytes go through `validateModelFile`, which is the same
   * validation a hand-picked file gets, and a model whose id is already in the library is left
   * alone: overwriting it would silently replace geometry the user may have re-imported.
   */
  const restoreModels = async (archived: ArchivedModel[]): Promise<ArchiveImportResult> => {
    let models = 0
    let skipped = 0
    for (const item of archived) {
      if (store.importedModels.some((model) => model.id === item.metadata.id)) {
        skipped += 1
        continue
      }
      try {
        // A model that was imported from a .zip keeps the .zip as its file name, and
        // `validateModelFile` only knows .glb and .gltf. Going through the same dispatch as the
        // catalogue import is what keeps those models from being carried in an archive and then
        // being refused on the way back in.
        const bytes = modelBytes(item)
        const file = new File([bytes], item.metadata.fileName, { type: item.metadata.fileType === 'gltf' ? 'model/gltf+json' : 'model/gltf-binary' })
        if (detectImportKind(file) === 'zip') validateGltfZip(bytes, file)
        else await validateModelFile(file)
        await store.addImportedModel(item.metadata, bytes, { silent: true })
        models += 1
      } catch {
        // One unreadable model must not cost the user the rest of the archive, and the projects in
        // it are worth restoring either way: the validation rules already report a device whose
        // product is missing, which is the honest way to show a model that did not come back.
        skipped += 1
      }
    }
    return { models, skipped }
  }

  /** Imports a project from a JSON file or an archive, with the models it came with. */
  const importProjectFile = async (file: File) => {
    const archive = await openArchive(file)
    if (!archive || archive.entry !== PROJECT_ENTRY) {
      const project = await readProjectFile(file)
      store.importProject(project)
      return { project, models: 0, skipped: 0 }
    }
    const project = await readProjectFile(jsonFileFor(PROJECT_ENTRY, archive.json))
    const restored = await restoreModels(archive.models)
    store.importProject(project)
    return { project, ...restored }
  }

  const exportProjectArchive = async (project: PanelProject) => {
    busy.value = true
    try {
      const needed = modelsUsedBy([project], store.importedModels)
      const models = await readModelBytes(needed)
      const archive = createCadArchive(createProjectFileEnvelope(project), PROJECT_ENTRY, models)
      downloadArchive(archive, safeFileName(project.name, '.panel36.zip'))
      return { archive: models.length, missing: needed.length - models.length }
    } finally {
      busy.value = false
    }
  }

  const exportWorkspaceArchive = async () => {
    busy.value = true
    try {
      const projects = store.projects
      const needed = modelsUsedBy(projects, store.importedModels)
      const models = await readModelBytes(needed)
      const archive = createCadArchive(createWorkspaceBackup(projects, store.importedModels, store.currentProjectId), BACKUP_ENTRY, models)
      downloadArchive(archive, `panel36-backup-${new Date().toISOString().slice(0, 10)}.panel36.zip`)
      return { archive: models.length, missing: needed.length - models.length }
    } finally {
      busy.value = false
    }
  }

  return { busy, openArchive, restoreModels, importProjectFile, exportProjectArchive, exportWorkspaceArchive }
}

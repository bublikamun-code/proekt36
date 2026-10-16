import { afterEach, describe, expect, it, vi } from 'vitest'
import { createProject } from '../src/domain/project'
import {
  APPLICATION_REVISION,
  CATALOG_REVISION,
  PROJECT_SCHEMA_VERSION,
  VALIDATION_REVISION,
} from '../src/domain/projectSchema'
import { createProjectFileEnvelope, downloadProject, readProjectFile } from '../src/domain/projectFile'
import { allCatalog } from '../src/data/catalog'
import { installBrowserEnv } from './support/browser-env'
import type { BrowserEnv } from './support/browser-env'

let env: BrowserEnv | null = null

afterEach(() => {
  env?.restore()
  env = null
  vi.useRealTimers()
})

const project = (name = 'Экспорт') => createProject(name, 'apartment')
const envelope = (patch: Record<string, unknown> = {}) => ({
  ...createProjectFileEnvelope(project(), '2026-01-01T00:00:00.000Z'),
  ...patch,
})
const file = (value: unknown) => new File([JSON.stringify(value)], 'project.json', { type: 'application/json' })

/** The reasons a file is refused, as one string — every case in this file is a message. */
const refusal = async (value: unknown) => {
  try {
    await readProjectFile(file(value))
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
  return ''
}

describe('конверт проекта', () => {
  it('кладёт в файл снимок каталога и его отпечаток', () => {
    const built = createProjectFileEnvelope(project(), '2026-01-01T00:00:00.000Z')

    expect(built.schema).toBe(`panel36.project.v${PROJECT_SCHEMA_VERSION}`)
    expect(built.catalog.snapshot).toHaveLength(allCatalog.length)
    expect(built.catalog.manifest.count).toBe(allCatalog.length)
    expect(built.catalog.manifest.hash).toMatch(/^[0-9a-f]{8}$/)
    expect(built.catalog.manifest.productIds).toHaveLength(allCatalog.length)
    // The revisions are stated twice on purpose: flat for old readers, nested for current ones.
    expect(built.catalogRevision).toBe(CATALOG_REVISION)
    expect(built.validationRevision).toBe(VALIDATION_REVISION)
    expect(built.validation.revision).toBe(VALIDATION_REVISION)
  })

  it('записывает в manifest только те товары, которых нет в каталоге', () => {
    const board = project()
    board.devices = [
      { instanceId: 'd1', productId: allCatalog[0]!.id, row: 0, slot: 0, address: 'QF1', quantity: 1, phase: 1, note: '', marking: '', mount: 'din' },
      { instanceId: 'd2', productId: 'своя-модель', row: 1, slot: 0, address: 'QF2', quantity: 1, phase: 1, note: '', marking: '', mount: 'din' },
    ]

    const built = createProjectFileEnvelope(board, '2026-01-01T00:00:00.000Z')

    expect(built.cadModelManifest.modelIds).toEqual(['своя-модель'])
    expect(built.cad.modelManifest).toEqual(built.cadModelManifest)
    expect(built.cad.binaryIncluded).toBe(false)
  })
})

describe('отказ читать файл', () => {
  it('ловит слишком большой файл и нечитаемый JSON', async () => {
    await expect(readProjectFile(new File([new Uint8Array(6 * 1024 * 1024)], 'huge.json'))).rejects.toThrow('больше 5 МБ')
    await expect(readProjectFile(new File(['{'], 'x.json'))).rejects.toThrow('Не удалось прочитать JSON')
    expect(await refusal([1, 2])).toContain('нет корректного проекта')
  })

  it('перечисляет, что именно не так в конверте', async () => {
    const cases: Array<[Record<string, unknown>, string]> = [
      [{ application: { name: 'Другой', revision: APPLICATION_REVISION } }, 'ревизия приложения'],
      [{ applicationRevision: '9999-01-01' }, 'applicationRevision новее'],
      [{ applicationRevision: 'не-ревизия' }, 'неверна applicationRevision'],
      [{ application: { name: 'Panel36', revision: '9999-01-01' } }, 'приложение в файле новее'],
      [{ schemaRevision: 99 }, 'ожидается schemaRevision'],
      [{ catalogRevision: '9999-01-01' }, 'каталог в файле новее'],
      // A revision that cannot be read is not «newer» — it never took part in a comparison, so
      // it is refused for what it is, and the «новее» wording stays a claim about a real version.
      [{ catalogRevision: 'не-ревизия' }, 'неверна ревизия каталога'],
      [{ validationRevision: 9999 }, 'validationRevision новее'],
      [{ validationRevision: 'не-ревизия' }, 'неверна revision проверок'],
      [{ validation: 'нет' }, 'вложенная ревизия валидации'],
      [{ validation: { revision: 9999 } }, 'вложенная ревизия валидации новее'],
      [{ validation: { revision: 'не-ревизия' } }, 'неверна вложенная ревизия валидации'],
      [{ exportedAt: 'вчера' }, 'корректная дата exportedAt'],
      [{ project: 'нет' }, 'отсутствует project'],
      [{ cadModelManifest: { revision: '9', count: 0, modelIds: [] } }, 'manifest CAD-моделей'],
      [{ cadModelManifest: { revision: '1', count: -1, modelIds: [] } }, 'некорректна manifest CAD-моделей'],
      [{ cad: { revision: '1', binaryIncluded: true, modelManifest: { revision: '1', count: 0, modelIds: [] } } }, 'вложенная manifest CAD-моделей'],
    ]

    for (const [patch, fragment] of cases) {
      const message = await refusal(envelope(patch))
      expect(message, JSON.stringify(patch)).toContain(fragment)
    }
  })

  it('принимает конверт без плоской applicationRevision — он опционален', async () => {
    const built = envelope()
    const { applicationRevision, ...rest } = built

    // The revision nested in `application` is the one that counts; the flat copy was added later,
    // so a file written before it existed must still read. An absent field is not a revision
    // that can be newer than anything.
    const project = await readProjectFile(file(rest))

    expect(project.name).toBe(built.project.name)
  })

  it('ловит расхождение между вложенным снимком каталога и плоским', async () => {
    const built = envelope()
    const flat = { ...built, catalogSnapshot: [{ id: 'чужой' }] }

    expect(await refusal(flat)).toContain('не совпадает с catalogSnapshot')

    const flatManifest = { ...built, catalogManifest: { revision: CATALOG_REVISION, count: 0, productIds: [], hash: '0' } }
    expect(await refusal(flatManifest)).toContain('не совпадает с catalogManifest')
  })

  it('проверяет, что manifest каталога описывает именно этот снимок', async () => {
    const built = envelope()
    const { manifest, ...catalog } = built.catalog
    const cases: Array<[Record<string, unknown>, string]> = [
      [{ ...manifest, count: manifest.count + 1 }, 'count каталога не совпадает'],
      [{ ...manifest, productIds: manifest.productIds.slice(1) }, 'productIds manifest не совпадают'],
      [{ ...manifest, hash: '00000000' }, 'hash каталога не совпадает'],
      [{ ...manifest, revision: '9999-01-01' }, 'ревизия manifest каталога новее'],
      [{ ...manifest, revision: 'не-ревизия' }, 'неверна ревизия manifest каталога'],
    ]

    for (const [patch, fragment] of cases) {
      const message = await refusal({ ...built, catalog: { ...catalog, manifest: patch } })
      expect(message, JSON.stringify(patch)).toContain(fragment)
    }

    // A snapshot with no manifest at all is equally unreadable.
    expect(await refusal({ ...built, catalog: { ...catalog, manifest: undefined } })).toContain('отсутствует catalogManifest')
    expect(await refusal({ ...built, catalog: { ...catalog, snapshot: 'нет' } })).toContain('отсутствует catalogSnapshot')
  })

  it('отличает нечитаемую вложенную ревизию каталога от более новой', async () => {
    const built = envelope()

    // The nested copy is checked on its own, so a file whose flat revision is fine can still be
    // refused for the copy inside `catalog` — and refused for the right reason.
    expect(await refusal({ ...built, catalog: { ...built.catalog, revision: '9999-01-01' } })).toContain('вложенная ревизия каталога новее')
    expect(await refusal({ ...built, catalog: { ...built.catalog, revision: 'не-ревизия' } })).toContain('неверна вложенная ревизия каталога')
  })

  it('не путает неизвестный формат конверта с битым', async () => {
    const built = envelope()

    expect(await refusal({ ...built, schema: 'panel36.project.v99' })).toContain('новее поддерживаемой')
    expect(await refusal({ ...built, schema: 'чужой.формат' })).toContain('ожидается schema')
    expect(await refusal({ ...built, schema: 'совсем другое', project: built.project })).toContain('ожидается schema')
  })

  it('показывает ошибки проекта, а не самого конверта', async () => {
    const message = await refusal(envelope({ project: { ...project(), name: '' } }))

    expect(message).toContain('project.name')
  })
})

describe('чтение того, что записано', () => {
  it('возвращает проект из своего же конверта', async () => {
    const original = project('Мой щит')

    const restored = await readProjectFile(file(createProjectFileEnvelope(original, '2026-01-01T00:00:00.000Z')))

    expect(restored.id).toBe(original.id)
    expect(restored.name).toBe('Мой щит')
  })

  it('переносит проект из конверта прошлой версии', async () => {
    const current = createProjectFileEnvelope(project('Старый'), '2026-01-01T00:00:00.000Z')
    const v2 = { ...current, schema: 'panel36.project.v2', schemaRevision: 2, project: { ...current.project, schemaVersion: 2 } }
    const v1 = { ...current, schema: 'panel36.project.v1', schemaRevision: 1, project: { ...current.project, schemaVersion: 1 } }

    for (const legacy of [v1, v2]) {
      const restored = await readProjectFile(file(legacy))
      expect(restored.schemaVersion, legacy.schema).toBe(PROJECT_SCHEMA_VERSION)
    }
  })

  it('берёт голый проект и строго, если он текущий', async () => {
    const current = project('Голый')

    const restored = await readProjectFile(file(current))

    expect(restored.name).toBe('Голый')
    // A raw project that claims the current schema but is broken is damage, not an old format,
    // so it is refused with the field that broke rather than quietly migrated into something else.
    expect(await refusal({ ...current, name: '' })).toContain('name')
  })

  it('переносит голый проект без указания версии', async () => {
    const { schemaVersion, ...unversioned } = project('Без версии')

    const restored = await readProjectFile(file(unversioned))

    expect(restored.name).toBe('Без версии')
    expect(restored.schemaVersion).toBe(PROJECT_SCHEMA_VERSION)
  })

  it('отказывает конверту без ревизий, если версия ему не подходит', async () => {
    const built = envelope()
    const bare = { project: built.project, schema: built.schema }

    // No `application`, no catalogue, no CAD manifest: the loose branch, which only accepts the
    // schema it knows and migrates what is inside.
    expect((await readProjectFile(file(bare))).schemaVersion).toBe(PROJECT_SCHEMA_VERSION)
    expect(await refusal({ ...bare, schema: 'panel36.project.v7' })).toContain('неизвестный формат конверта')
  })
})

describe('выгрузка проекта', () => {
  it('называет файл по названию щита и отпускает ссылку', () => {
    env = installBrowserEnv()
    vi.useFakeTimers()
    const created: string[] = []
    const revoked: string[] = []
    const realCreate = URL.createObjectURL
    const realRevoke = URL.revokeObjectURL
    URL.createObjectURL = (() => { const url = `blob:node:${created.length}`; created.push(url); return url }) as typeof URL.createObjectURL
    URL.revokeObjectURL = ((url: string) => { revoked.push(url) }) as typeof URL.revokeObjectURL

    downloadProject(project('Квартира 12 / этаж 3'))

    // Punctuation a filesystem would rather not see becomes a dash rather than a path separator.
    expect(env.lastDownload()?.download).toBe('Квартира-12-этаж-3.panel36.json')
    expect(env.lastDownload()?.clicks).toBe(1)

    vi.advanceTimersByTime(1000)
    URL.createObjectURL = realCreate
    URL.revokeObjectURL = realRevoke
    expect(revoked).toEqual(created)
  })

  it('подставляет имя, когда назвать щит нечем', () => {
    env = installBrowserEnv()
    vi.useFakeTimers()

    downloadProject(project(''))
    // A name made only of punctuation still reduces to a dash, so only a truly blank one needs
    // the fallback — and it must not produce a file called ".panel36.json".
    expect(env.lastDownload()?.download).toBe('panel36.panel36.json')

    downloadProject(project('///'))
    expect(env.lastDownload()?.download).toBe('-.panel36.json')
    vi.advanceTimersByTime(1000)
  })
})

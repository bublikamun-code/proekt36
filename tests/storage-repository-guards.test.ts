import { describe, expect, it } from 'vitest'
import { createProject } from '../src/domain/project'
import { PROJECT_SCHEMA_VERSION } from '../src/domain/projectSchema'
import {
  actionableStorageError,
  CURRENT_PROJECT_KEY,
  isImportedProduct,
  LEGACY_MODELS_BACKUP_KEY,
  LEGACY_MODELS_KEY,
  LEGACY_PROJECTS_KEYS,
  MODELS_BACKUP_KEY,
  MODELS_KEY,
  PROJECTS_BACKUP_KEY,
  PROJECTS_KEY,
  RECOVERY_KEY,
  WorkspaceRepository,
  migrateLegacyModels,
} from '../src/storage/projectRepository'
import type { DeviceDefinition, PanelProject } from '../src/domain/types'

/** A storage that can be told to fail on one key, the way a full or blocked browser does. */
class FaultyStorage {
  private readonly values = new Map<string, string>()
  failsOn: string | null = null
  readonly error: Error

  constructor(error: Error) {
    this.error = error
  }

  getItem(key: string) {
    if (this.failsOn === key) throw this.error
    return this.values.get(key) ?? null
  }

  setItem(key: string, value: string) {
    if (this.failsOn === key) throw this.error
    this.values.set(key, value)
  }

  removeItem(key: string) {
    if (this.failsOn === key) throw this.error
    this.values.delete(key)
  }

  put(key: string, value: unknown) { this.values.set(key, JSON.stringify(value)) }
  putRaw(key: string, value: string) { this.values.set(key, value) }
  peek(key: string) { return this.values.get(key) ?? null }
  keys() { return [...this.values.keys()].sort() }
}

const named = (error: Error, name: string) => Object.assign(error, { name })

const project = (name: string) => createProject(name, 'demo')
const emptyLibrary = { assets: [], products: [], bindings: {} }
const saved = (repository: WorkspaceRepository, projects = [project('Щит')]) =>
  repository.save({ projects, models: emptyLibrary, currentProjectId: projects[0]!.id })

const product: DeviceDefinition = {
  id: 'импорт-1', name: 'Импортированный', brand: 'Своя', sku: 'SKU-1', category: 'MCB',
  moduleWidth: 1, poles: 1, ratedCurrent: 16, voltage: 230, bus: 'L', price: 100, weight: 200,
  height: 80, depth: 70, imported: true, modelId: 'модель-1',
}

describe('хранилище недоступно', () => {
  it('отдаёт запасной набор и честно говорит, что писать некуда', () => {
    const repository = new WorkspaceRepository(null)
    const fallback = [project('Запасная')]

    const snapshot = repository.load(fallback)

    expect(snapshot.available).toBe(false)
    expect(snapshot.projects).toEqual(fallback)
    expect(snapshot.projects).not.toBe(fallback)
    expect(snapshot.currentProjectId).toBeNull()
  })

  it('не обещает сохранение того, что не сможет выполнить', () => {
    const repository = new WorkspaceRepository(null)

    expect(repository.available).toBe(false)
    expect(() => saved(repository)).toThrow('Локальное хранилище недоступно')
    expect(() => repository.saveCurrentProjectId('x')).toThrow('Локальное хранилище недоступно')
    expect(() => repository.clear()).toThrow('Локальное хранилище недоступно')
  })

  it('считает браузер недоступным, когда первое же чтение запрещено', () => {
    const storage = new FaultyStorage(named(new Error('Access denied'), 'SecurityError'))
    const repository = new WorkspaceRepository(storage)
    storage.failsOn = PROJECTS_KEY

    const snapshot = repository.load([project('Запасная')])

    expect(snapshot.available).toBe(false)
    expect(snapshot.projects[0]!.name).toBe('Запасная')
  })

  it('возвращает запасной набор, а не половину прочитанного, когда запись сорвалась', () => {
    const storage = new FaultyStorage(named(new Error('The operation is insecure'), 'SecurityError'))
    const repository = new WorkspaceRepository(storage)
    storage.put(PROJECTS_KEY, [project('Из хранилища')])
    storage.failsOn = CURRENT_PROJECT_KEY

    // The projects and the library were read fine, but the last key threw. Returning what was
    // read so far would open a board whose model library was never checked.
    const snapshot = repository.load([project('Запасная')])

    expect(snapshot.available).toBe(false)
    expect(snapshot.projects.map((item) => item.name)).toEqual(['Запасная'])
  })
})

describe('разбор сохранённых данных', () => {
  it('не принимает за проекты то, что не массив', () => {
    const storage = new FaultyStorage(named(new Error('нет'), 'Error'))
    storage.put(PROJECTS_KEY, { nope: true })

    expect(() => new WorkspaceRepository(storage).load([project('Запасная')])).not.toThrow()
    const snapshot = new WorkspaceRepository(storage).load([project('Запасная')])
    // The damaged record is kept verbatim for the user, and the seed is what opens.
    expect(snapshot.projects.map((item) => item.name)).toEqual(['Запасная'])
    expect(snapshot.recovery[0]!.raw).toContain('nope')
  })

  it('перечисляет все повреждённые записи, когда не уцелела ни одна', () => {
    const storage = new FaultyStorage(named(new Error('нет'), 'Error'))
    storage.put(PROJECTS_KEY, [{ schemaVersion: 99 }, { schemaVersion: 98 }])

    const repository = new WorkspaceRepository(storage)
    const snapshot = repository.load([project('Запасная')])

    expect(snapshot.projects[0]!.name).toBe('Запасная')
    expect(snapshot.recovery[0]!.reason).toContain('projects[0]')
    expect(snapshot.recovery[0]!.reason).toContain('projects[1]')
  })

  it('не открывает список, где два проекта делят один идентификатор', () => {
    const storage = new FaultyStorage(named(new Error('нет'), 'Error'))
    const first = project('Первый')
    storage.put(PROJECTS_KEY, [first, { ...structuredClone(first), name: 'Второй' }])

    const snapshot = new WorkspaceRepository(storage).load([project('Запасная')])

    expect(snapshot.recovery[0]!.reason).toContain('повторяется идентификатор')
  })

  it('переносит библиотеку из обоих устаревших ключей', () => {
    for (const key of [LEGACY_MODELS_KEY, LEGACY_MODELS_BACKUP_KEY]) {
      const storage = new FaultyStorage(named(new Error('нет'), 'Error'))
      storage.put(key, [{ id: 'модель-1', name: 'Модель', brand: 'Своя', sku: 'SKU', category: 'MCB', moduleWidth: 1, poles: 1, ratedCurrent: 16, voltage: 230, bus: 'L', price: 0, weight: 0, height: 80, depth: 70, fileName: 'm.glb', fileType: 'glb', createdAt: '2026-01-01T00:00:00.000Z' }])

      const snapshot = new WorkspaceRepository(storage).load([project('Щит')])

      expect(snapshot.models.assets.map((item) => item.id), key).toEqual(['модель-1'])
      expect(snapshot.models.products.map((item) => item.id), key).toEqual(['модель-1'])
    }
  })

  it('не открывает библиотеку, где у двух записей один идентификатор', () => {
    const storage = new FaultyStorage(named(new Error('нет'), 'Error'))
    const asset = { id: 'a', name: 'A', source: 'local', format: 'glb', transform: { scale: 1, rotationY: 0 }, createdAt: '2026-01-01T00:00:00.000Z' }
    storage.put(MODELS_KEY, { assets: [asset, { ...asset }], products: [], bindings: {} })

    const snapshot = new WorkspaceRepository(storage).load([project('Щит')])

    expect(snapshot.models.assets).toEqual([])
    expect(snapshot.recovery[0]!.reason).toContain('повторяется идентификатор ассета')
  })

  it('не открывает библиотеку, где товар или привязка битые', () => {
    const cases: Array<[Record<string, unknown>, string]> = [
      [{ assets: [], products: [], bindings: [] }, 'bindings должен быть объектом'],
      [{ assets: [], products: [{ id: 'p', name: 'P', imported: false }], bindings: {} }, 'некорректный товар импорта'],
      [{ assets: [{ id: '', name: 'A', source: 'local', format: 'glb', transform: { scale: 1, rotationY: 0 }, createdAt: 'x' }], products: [], bindings: {} }, 'некорректный ассет'],
      [{ assets: [], products: [], bindings: { 'p': '   ' } }, 'некорректная привязка'],
    ]

    for (const [library, fragment] of cases) {
      const storage = new FaultyStorage(named(new Error('нет'), 'Error'))
      storage.put(MODELS_KEY, library)
      const snapshot = new WorkspaceRepository(storage).load([project('Щит')])
      expect(snapshot.recovery[0]!.reason, JSON.stringify(library)).toContain(fragment)
    }
  })

  it('переносит старый список моделей, пропуская то, что доехать не может', () => {
    const library = migrateLegacyModels([
      { id: 'ok', name: 'Модель', brand: 'Б', sku: 'S', category: 'MCB', moduleWidth: 1, poles: 1, ratedCurrent: 16, voltage: 400, bus: 'N', price: 10, weight: 20, height: 80, depth: 70, fileName: 'm.gltf', fileType: 'gltf', createdAt: '2026-01-01T00:00:00.000Z' },
      { id: 'нет-чисел', name: 'Битая' },
      'не объект',
      null,
    ])

    expect(library.assets.map((item) => [item.id, item.format])).toEqual([['ok', 'gltf']])
    expect(library.products[0]).toMatchObject({ voltage: 400, bus: 'N', category: 'MCB' })
  })

  it('не признаёт товаром импорта то, что не проходит все проверки', () => {
    expect(isImportedProduct(product)).toBe(true)
    const broken: Array<[Record<string, unknown>, string]> = [
      [{ ...product, id: '  ' }, 'пустой id'],
      [{ ...product, category: 'Лампочка' }, 'неизвестная категория'],
      [{ ...product, moduleWidth: 0 }, 'нулевая ширина'],
      [{ ...product, moduleWidth: 99 }, 'шире корпуса'],
      [{ ...product, poles: 0 }, 'нет полюсов'],
      [{ ...product, poles: 99 }, 'слишком много полюсов'],
      [{ ...product, ratedCurrent: 0 }, 'нулевой ток'],
      [{ ...product, voltage: 220 }, 'чужое напряжение'],
      [{ ...product, bus: 'Земля' }, 'чужая шина'],
      [{ ...product, price: -1 }, 'отрицательная цена'],
      [{ ...product, weight: -1 }, 'отрицательный вес'],
      [{ ...product, height: 0 }, 'нулевая высота'],
      [{ ...product, depth: 0 }, 'нулевая глубина'],
      [{ ...product, imported: false }, 'не импорт'],
      [{ ...product, moduleWidth: Number.NaN }, 'не число'],
    ]

    for (const [value, why] of broken) {
      expect(isImportedProduct(value), why).toBe(false)
    }
    expect(isImportedProduct(null)).toBe(false)
    expect(isImportedProduct([])).toBe(false)
  })
})

describe('сохранение', () => {
  it('не записывает то, что сама схема не примет', () => {
    const repository = new WorkspaceRepository(new FaultyStorage(named(new Error('нет'), 'Error')))
    const broken = { ...project('Щит'), name: '' } as PanelProject

    expect(() => repository.save({ projects: [broken], models: emptyLibrary, currentProjectId: 'x' })).toThrow()
    expect(() => repository.save({
      projects: [project('Щит')],
      models: { ...emptyLibrary, products: [{ ...product, moduleWidth: 0 } as DeviceDefinition] },
      currentProjectId: 'x',
    })).toThrow('Некорректная библиотека моделей')
  })

  it('записывает библиотеку при первом сохранении даже без флага изменения', () => {
    const storage = new FaultyStorage(named(new Error('нет'), 'Error'))
    const repository = new WorkspaceRepository(storage)

    repository.save({ projects: [project('Щит')], models: emptyLibrary, currentProjectId: 'a' })

    // Never saved before: skipping the key would leave the library nowhere to live.
    expect(storage.peek(MODELS_KEY)).not.toBeNull()
  })

  it('держит предыдущий снимок резервной копией и не затирает его повреждённым', () => {
    const storage = new FaultyStorage(named(new Error('нет'), 'Error'))
    const repository = new WorkspaceRepository(storage)
    saved(repository, [project('Первая')])
    saved(repository, [project('Вторая')])

    expect(JSON.parse(storage.peek(PROJECTS_BACKUP_KEY)!)[0].name).toBe('Первая')
    expect(JSON.parse(storage.peek(PROJECTS_KEY)!)[0].name).toBe('Вторая')
  })

  it('оставляет повреждённое содержимое на месте, а не заменяет его копией', () => {
    const storage = new FaultyStorage(named(new Error('нет'), 'Error'))
    const broken = JSON.stringify([{ schemaVersion: PROJECT_SCHEMA_VERSION, name: '' }])
    storage.putRaw(PROJECTS_KEY, broken)
    const repository = new WorkspaceRepository(storage)
    repository.load([project('Щит')])

    saved(repository)

    // A record the user may still want by hand is never overwritten behind their back; the
    // recovery snapshot holds it, and the backup key stays as it was.
    expect(storage.peek(PROJECTS_BACKUP_KEY)).toBeNull()
    expect(repository.recoveryData[0]!.preserved).toBe(true)
  })

  it('убирает устаревшие ключи библиотеки, а повторную попытку переживает', () => {
    const storage = new FaultyStorage(named(new Error('нет'), 'Error'))
    storage.putRaw(LEGACY_MODELS_KEY, '[]')
    const repository = new WorkspaceRepository(storage)
    storage.failsOn = LEGACY_MODELS_BACKUP_KEY
    saved(repository)
    storage.failsOn = null

    // The first removal threw and was swallowed on purpose; the next save tries again.
    saved(repository)
    expect(storage.peek(LEGACY_MODELS_KEY)).toBeNull()
    expect(storage.peek(LEGACY_MODELS_BACKUP_KEY)).toBeNull()
  })

  it('не отмечает текущим проект, которого больше нет', () => {
    const storage = new FaultyStorage(named(new Error('нет'), 'Error'))
    const repository = new WorkspaceRepository(storage)
    const [first, second] = [project('Первая'), project('Вторая')]
    repository.save({ projects: [first, second], models: emptyLibrary, currentProjectId: second.id })

    const snapshot = repository.load([project('Щит')])

    expect(snapshot.currentProjectId).toBe(second.id)
  })

  it('отказывает пустому идентификатору текущего проекта', () => {
    const repository = new WorkspaceRepository(new FaultyStorage(named(new Error('нет'), 'Error')))

    expect(() => repository.saveCurrentProjectId('   ')).toThrow('пустой идентификатор')
    repository.saveCurrentProjectId('  щт  ')
    expect(repository.backupData.currentProjectId).toBe('  щт  ')
  })
})

describe('восстановление после повреждения', () => {
  it('запоминает исходный текст и даёт причину, а не пустой щит', () => {
    const storage = new FaultyStorage(named(new Error('нет'), 'Error'))
    const raw = JSON.stringify([{ schemaVersion: 42 }])
    storage.putRaw(PROJECTS_KEY, raw)
    const repository = new WorkspaceRepository(storage)

    const snapshot = repository.load([project('Щит')])

    expect(snapshot.recovery[0]).toMatchObject({ sourceKey: PROJECTS_KEY, raw, preserved: true })
    expect(snapshot.recovery[0]!.reason).toContain(String(PROJECT_SCHEMA_VERSION))
    expect(snapshot.recovery[0]!.capturedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  it('перечитывает сохранённое восстановление при следующей загрузке', () => {
    const storage = new FaultyStorage(named(new Error('нет'), 'Error'))
    storage.putRaw(PROJECTS_KEY, JSON.stringify([{ schemaVersion: 42 }]))
    new WorkspaceRepository(storage).load([project('Щит')])
    const record = JSON.parse(storage.peek(RECOVERY_KEY)!)

    expect(record.schema).toBe('panel36.storage-recovery.v1')
    expect(record.records).toHaveLength(1)

    const second = new WorkspaceRepository(storage)
    const snapshot = second.load([project('Щит')])
    expect(snapshot.recovery[0]!.sourceKey).toBe(PROJECTS_KEY)
  })

  it('не падает на повреждённом файле восстановления', () => {
    for (const raw of ['{', JSON.stringify({ records: 'нет' }), JSON.stringify({ records: [{ nope: 1 }] })]) {
      const storage = new FaultyStorage(named(new Error('нет'), 'Error'))
      storage.putRaw(RECOVERY_KEY, raw)
      const snapshot = new WorkspaceRepository(storage).load([project('Щит')])
      expect(snapshot.projects[0]!.name, raw).toBe('Щит')
    }
  })

  it('отдаёт копию снимка, а не сам снимок', () => {
    const storage = new FaultyStorage(named(new Error('нет'), 'Error'))
    const repository = new WorkspaceRepository(storage)
    saved(repository)

    const backup = repository.backupData
    backup.projects![0]!.name = 'Испорчено'
    expect(repository.backupData.projects![0]!.name).not.toBe('Испорчено')
  })

  it('берёт сохранённый снимок, когда основной ключ пуст или сломан', () => {
    const storage = new FaultyStorage(named(new Error('нет'), 'Error'))
    const good = [project('Из резервной копии')]
    storage.put(PROJECTS_BACKUP_KEY, good)

    const snapshot = new WorkspaceRepository(storage).load([project('Щит')])

    expect(snapshot.projects[0]!.name).toBe('Из резервной копии')
    expect(snapshot.backup.projects).not.toBeNull()
    expect(snapshot.backup.rawProjects).toBe(storage.peek(PROJECTS_BACKUP_KEY))
  })

  it('не отказывает рабочему щиту из-за сломанной старой резервной копии', () => {
    const storage = new FaultyStorage(named(new Error('нет'), 'Error'))
    storage.put(PROJECTS_KEY, [project('Рабочая')])
    storage.putRaw(PROJECTS_BACKUP_KEY, '{')

    const snapshot = new WorkspaceRepository(storage).load([project('Щит')])

    expect(snapshot.projects[0]!.name).toBe('Рабочая')
    expect(snapshot.backup.projects).toBeNull()
  })
})

describe('очистка', () => {
  it('убирает всё, что занимает хранилище, включая устаревшие ключи', () => {
    const storage = new FaultyStorage(named(new Error('нет'), 'Error'))
    for (const key of [PROJECTS_KEY, ...LEGACY_PROJECTS_KEYS, PROJECTS_BACKUP_KEY, MODELS_KEY, MODELS_BACKUP_KEY, LEGACY_MODELS_KEY, LEGACY_MODELS_BACKUP_KEY, CURRENT_PROJECT_KEY, RECOVERY_KEY]) {
      storage.put(key, [])
    }
    const repository = new WorkspaceRepository(storage)

    repository.clear()

    expect(storage.keys()).toEqual([])
    expect(repository.recoveryData).toEqual([])
    expect(repository.backupData.projects).toBeNull()
  })

  it('собирает ошибки всех ключей, а не молчит о первой', () => {
    const storage = new FaultyStorage(named(new Error('запрещено'), 'SecurityError'))
    const repository = new WorkspaceRepository(storage)
    storage.failsOn = PROJECTS_KEY

    expect(() => repository.clear()).toThrow(/запрещено/)
    expect(repository.available).toBe(false)
  })
})

describe('перевод ошибки в Advice', () => {
  it('различает переполнение, запрет и всё остальное', () => {
    const quota = actionableStorageError(Object.assign(new Error('full'), { name: 'QuotaExceededError' }), 'модель')
    expect(quota).toContain('переполнено')
    expect(quota).toContain('модель')

    expect(actionableStorageError(Object.assign(new Error('x'), { name: 'NS_ERROR_DOM_QUOTA_REACHED' }))).toContain('переполнено')
    expect(actionableStorageError(new Error('quota is over'))).toContain('переполнено')

    expect(actionableStorageError(Object.assign(new Error('x'), { name: 'SecurityError' }))).toContain('запретил')
    expect(actionableStorageError(Object.assign(new Error('x'), { name: 'NotAllowedError' }))).toContain('запретил')
    expect(actionableStorageError(new Error('access denied by policy'))).toContain('запретил')
    expect(actionableStorageError(new Error('storage blocked'))).toContain('запретил')

    // Anything unrecognised still says what happened instead of pretending it knows better.
    expect(actionableStorageError(new Error('диск сломался'))).toBe('Не удалось сохранить данные: диск сломался')
    expect(actionableStorageError('строка', 'проект')).toContain('проект')
    expect(actionableStorageError(null)).toContain('Не удалось сохранить данные')
  })
})

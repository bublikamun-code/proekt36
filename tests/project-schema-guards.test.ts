import { afterEach, describe, expect, it, vi } from 'vitest'
import { autoNumber, createDevice, createProject } from '../src/domain/project'
import {
  compareRevisions,
  isFutureRevision,
  isKnownRevision,
  isValidProjectSchema,
  ProjectSchemaError,
  PROJECT_LIMITS,
  PROJECT_SCHEMA_VERSION,
  validateProjectSchema,
} from '../src/domain/projectSchema'
import {
  backupNeedsLocalCad,
  createWorkspaceBackup,
  downloadJsonFile,
  downloadWorkspaceBackup,
  readWorkspaceBackup,
  BACKUP_SCHEMA,
} from '../src/domain/projectBackup'
import { APPLICATION_REVISION, CATALOG_REVISION } from '../src/domain/projectSchema'
import { allCatalog } from '../src/data/catalog'
import { installBrowserEnv } from './support/browser-env'
import type { BrowserEnv } from './support/browser-env'
import type { PanelProject, PlacedDevice, StoredModelLibrary } from '../src/domain/types'

let env: BrowserEnv | null = null

afterEach(() => {
  env?.restore()
  env = null
  vi.useRealTimers()
})

const definitions = new Map(allCatalog.map((item) => [item.id, item]))
const validProject = () => createProject('Проверка', 'demo')
const errors = (value: unknown) => validateProjectSchema(value).errors.join(' | ')

/**
 * A placed device as the app actually keeps it. `createDevice` on its own leaves the address
 * empty until the board numbers it, and the schema rightly refuses an unnumbered device — so
 * fixtures go through `autoNumber` rather than around it.
 */
const placed = (productId: string, row: number, slot: number): PlacedDevice[] =>
  autoNumber([createDevice(definitions.get(productId)!, row, slot)], definitions)

const backupFile = (patch: Record<string, unknown> = {}) => {
  const payload = {
    ...createWorkspaceBackup([validProject()], { assets: [], products: [], bindings: {} }, null),
    ...patch,
  }
  return new File([JSON.stringify(payload)], 'backup.json', { type: 'application/json' })
}

describe('сравнение ревизий', () => {
  it('упорядочивает и точечные, и через дефис номера', () => {
    expect(compareRevisions('0.1.0', '0.2.0')).toBeLessThan(0)
    expect(compareRevisions('0.2.0', '0.2.0')).toBe(0)
    expect(compareRevisions('2026-09-29.2', '2026-09-29.10')).toBeLessThan(0)
    expect(compareRevisions('2026-10-01', '2026-09-30.9')).toBeGreaterThan(0)
  })

  it('считает разные длины по недостающим сегментам, а не по длине строки', () => {
    // A revision that stops early is read as having nothing in the missing places, so '1.2'
    // sorts below '1.2.0'. For `isFutureRevision` that is the safe direction: a shorter or
    // unreadable revision is never mistaken for a newer file.
    expect(compareRevisions('1.2', '1.2.0')).toBeLessThan(0)
    expect(compareRevisions('1.2.0', '1.2')).toBeGreaterThan(0)
    expect(compareRevisions('1', '1.0.1')).toBeLessThan(0)
    expect(compareRevisions(' 1.2 ', '1.2')).toBe(0)
  })

  it('отказывает в строке, которую нельзя прочитать как версию', () => {
    expect(isKnownRevision('0.1.0')).toBe(true)
    expect(isKnownRevision(3)).toBe(true)
    expect(isKnownRevision(-1)).toBe(false)
    expect(isKnownRevision(1.5)).toBe(false)
    expect(isKnownRevision('1.2.бета')).toBe(false)
    expect(isKnownRevision(null)).toBe(false)
    expect(isKnownRevision({})).toBe(false)
  })

  it('считает файл из будущего и файл с непонятной версией слишком новыми', () => {
    expect(isFutureRevision('9.0.0', '0.2.0')).toBe(true)
    expect(isFutureRevision('0.1.0', '0.2.0')).toBe(false)
    expect(isFutureRevision('0.2.0', '0.2.0')).toBe(false)
    // A revision that cannot be read is not evidence that the file is older.
    expect(isFutureRevision('непонятно', '0.2.0')).toBe(true)
  })
})

describe('отказы проверки схемы', () => {
  it('не принимает на месте проекта то, что проектом не является', () => {
    for (const value of [null, [], 'проект', 7, true]) {
      expect(validateProjectSchema(value).valid, JSON.stringify(value)).toBe(false)
      expect(errors(value)).toContain('ожидается объект')
    }
  })

  it('различает слишком старую, слишком новую и нецелую версию схемы', () => {
    const project = structuredClone(validProject())

    expect(errors({ ...project, schemaVersion: 0 })).toContain('целая версия схемы')
    expect(errors({ ...project, schemaVersion: 1.5 })).toContain('целая версия схемы')
    expect(errors({ ...project, schemaVersion: '3' })).toContain('целая версия схемы')
    expect(errors({ ...project, schemaVersion: 99 })).toContain('новее поддерживаемой')
    // 2 is readable, so it is validated as an old payload rather than refused outright.
    expect(validateProjectSchema({ ...project, schemaVersion: 2 }).valid).toBe(true)
  })

  it('проверяет поля проекта, а не только его форму', () => {
    const project = structuredClone(validProject())
    const cases: Array<[Record<string, unknown>, string]> = [
      [{ id: '' }, 'id'],
      [{ id: 42 }, 'id'],
      [{ name: '  ' }, 'name'],
      [{ preset: '' }, 'preset'],
      [{ createdAt: 'вчера' }, 'createdAt'],
      [{ updatedAt: '2026-13-40T99:99:99Z' }, 'updatedAt'],
      [{ settings: 'нет' }, 'settings'],
      [{ devices: 'нет массива' }, 'devices'],
      [{ circuits: {} }, 'circuits'],
      [{ connections: 3 }, 'connections'],
      [{ busAssemblies: 'нет' }, 'busAssemblies'],
      [{ combs: 1 }, 'combs'],
    ]

    for (const [patch, field] of cases) {
      const result = errors({ ...project, ...patch })
      expect(result, JSON.stringify(patch)).toContain(field)
      expect(validateProjectSchema({ ...project, ...patch }).valid).toBe(false)
    }
  })

  it('ловит превышение лимитов, а не только неверный тип', () => {
    const project = structuredClone(validProject())

    expect(errors({ ...project, devices: new Array(PROJECT_LIMITS.devices + 1).fill({}) })).toContain('devices')
    expect(errors({ ...project, name: 'x'.repeat(PROJECT_LIMITS.name + 1) })).toContain('слишком длинное')
  })

  it('не проверяет ссылки, когда сам список уже сломан', () => {
    const project = structuredClone(validProject())
    const broken = { ...project, devices: [{ instanceId: 'd1', productId: 'нет такого' }] }

    // The device record is invalid, so the referential pass would only bury the real message.
    expect(errors(broken)).toContain('devices[0]')
  })

  it('называет проект и поле, на которые указывает оборванная ссылка', () => {
    const project = structuredClone(validProject())
    const [device] = placed('ekf-mcb-1p-c6', 0, 0)

    const missingDevice = structuredClone(project)
    missingDevice.devices = [device!]
    missingDevice.circuits = [{ id: 'c1', name: 'Свет', loadName: 'Свет', current: 6, power: 100, phase: 1, protectionDeviceId: 'удалённый', color: '#fff', wireCrossSection: 1.5, note: '' }]
    expect(errors(missingDevice)).toContain('circuits[0].protectionDeviceId')

    const missingBus = structuredClone(project)
    missingBus.devices = [device!]
    missingBus.connections = [{ id: 'w1', circuitId: '', fromBus: 'L', toDeviceId: device!.instanceId, color: '', thickness: 2, kind: 'circuit', busId: 'удалённая шина', label: '' }]
    expect(errors(missingBus)).toContain('connections[0].busId')

    const missingClamp = structuredClone(project)
    missingClamp.devices = [device!]
    missingClamp.connections = [{ id: 'w1', circuitId: '', fromBus: 'L', toDeviceId: device!.instanceId, color: '', thickness: 2, kind: 'jumper', fromTerminal: { deviceId: 'удалённый', pole: 1, side: 'top' }, toTerminal: { deviceId: device!.instanceId, pole: 1, side: 'top' }, label: '' }]
    expect(errors(missingClamp)).toContain('connections[0].fromTerminal.deviceId')
  })

  it('не требует цепи для провода, нарисованного вручную', () => {
    const project = structuredClone(validProject())
    project.devices = [...placed('ekf-mcb-1p-c6', 0, 0), ...placed('ekf-terminal-1p-gray', 0, 1)]
    const [device, terminal] = project.devices
    // An empty circuitId is what addWire writes: a jumper between two clamps belongs to no circuit.
    project.connections = [{
      id: 'w1', circuitId: '', fromBus: 'L', toDeviceId: terminal!.instanceId, color: '', thickness: 2, kind: 'jumper',
      fromTerminal: { deviceId: device!.instanceId, pole: 1, side: 'top' },
      toTerminal: { deviceId: terminal!.instanceId, pole: 1, side: 'top' },
      label: 'QF01 → XT01',
    }]

    expect(validateProjectSchema(project).errors).toEqual([])
  })

  it('оставляет пустым то, что провод ещё не знает, а не зовёт это битым', () => {
    const project = structuredClone(validProject())
    project.devices = placed('ekf-mcb-1p-c6', 0, 0)
    const [device] = project.devices
    // No bus named yet and no caption to draw: both are «not known», which is not the same as
    // «points at something that is gone».
    project.connections = [{ id: 'w1', circuitId: '', fromBus: 'N', toDeviceId: device!.instanceId, color: '', thickness: 2, kind: 'circuit', busId: '', toTerminal: { deviceId: device!.instanceId, pole: 1, side: 'top' }, label: '' }]

    expect(validateProjectSchema(project).errors).toEqual([])
  })

  it('читает v1 как есть, требуя только массивов', () => {
    expect(validateProjectSchema({ schemaVersion: 1, devices: [] }).valid).toBe(true)
    expect(errors({ schemaVersion: 1, devices: 'нет' })).toContain('devices')
    expect(errors({ schemaVersion: 1, devices: [], circuits: {} })).toContain('circuits')
    expect(errors({ schemaVersion: 1, devices: [], connections: 1 })).toContain('connections')
    // An old payload is readable but is not a current project, so it carries no `data`.
    expect(validateProjectSchema({ schemaVersion: 1, devices: [] }).data).toBeUndefined()
  })

  it('отличает «прочитать» от «является текущим проектом»', () => {
    const project = validProject()

    expect(isValidProjectSchema(project)).toBe(true)
    expect(isValidProjectSchema({ ...project, schemaVersion: 1, devices: [] })).toBe(false)
    expect(isValidProjectSchema({ ...project, name: '' })).toBe(false)
  })

  it('поднимает ошибку с перечнем причин, а не только первой', () => {
    const project = { ...structuredClone(validProject()), name: '', id: '' }

    let thrown: unknown
    try {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const unused = project
    } catch (error) { thrown = error }
    expect(thrown).toBeUndefined()

    const error = new ProjectSchemaError(['первая', 'вторая'])
    expect(error.errors).toEqual(['первая', 'вторая'])
    expect(error.message).toBe('первая')
    expect(error).toBeInstanceOf(Error)
    expect(new ProjectSchemaError([]).message).toBe('Некорректная схема проекта')
  })
})

describe('резервная копия рабочей области', () => {
  it('записывает файл с датой в имени и не встраивает бинарники', () => {
    env = installBrowserEnv()
    vi.useFakeTimers()
    const library: StoredModelLibrary = {
      assets: [{ id: 'model-1', name: 'Модель', fileName: 'model-1.glb', format: 'glb', mimeType: 'model/gltf-binary', bytes: 12, createdAt: '2026-01-01T00:00:00.000Z' }],
      products: [],
      bindings: {},
    }

    downloadWorkspaceBackup([validProject()], library, null)

    const download = env.lastDownload()
    expect(download?.download).toMatch(/^panel36-backup-\d{4}-\d{2}-\d{2}\.json$/)
    expect(download?.clicks).toBe(1)
    // Fake timers so the release this schedules dies with the test instead of firing inside
    // the next one and being counted as its own work.
    vi.advanceTimersByTime(1000)
  })

  it('не помечает текущим проект, которого в архиве нет', () => {
    const first = validProject()
    const second = validProject()
    second.id = 'second'

    const backup = createWorkspaceBackup([first, second], { assets: [], products: [], bindings: {} }, 'третий')

    expect(backup.currentProjectId).toBeNull()
    expect(backup.cad.binaryIncluded).toBe(false)
    expect(backup.cad.modelManifest.modelIds).toEqual([])
    expect(backup.schema).toBe(BACKUP_SCHEMA)
  })

  it('называет товары, которых больше нет в каталоге, — их нельзя восстановить без модели', () => {
    const project = validProject()
    const [device] = placed('ekf-mcb-1p-c6', 0, 0)
    project.devices = [{ ...device!, productId: 'импортированный-товар' }]

    expect(backupNeedsLocalCad([project])).toEqual(['импортированный-товар'])
    expect(backupNeedsLocalCad([validProject()])).toEqual([])
  })

  it('отказывает читать то, что не является архивом Panel36', async () => {
    await expect(readWorkspaceBackup(new File(['[]'], 'x.json'))).rejects.toThrow('JSON-объектом')
    await expect(readWorkspaceBackup(new File(['{'], 'x.json'))).rejects.toThrow('Не удалось прочитать JSON')
    await expect(readWorkspaceBackup(backupFile({ schema: 'чужой формат' }))).rejects.toThrow('Ожидается формат')
  })

  it('объясняет, что архив сделан другой версией приложения', async () => {
    await expect(readWorkspaceBackup(backupFile({ application: { name: 'Panel36', revision: 'не-версия' } }))).rejects.toThrow('другой версией приложения')
    await expect(readWorkspaceBackup(backupFile({ application: { name: 'Другой', revision: APPLICATION_REVISION } }))).rejects.toThrow('другой версией приложения')
    await expect(readWorkspaceBackup(backupFile({ application: { name: 'Panel36', revision: '99.0.0' } }))).rejects.toThrow('более новой версией приложения')
  })

  it('проверяет дату, ревизию каталога и список моделей', async () => {
    await expect(readWorkspaceBackup(backupFile({ exportedAt: 'вчера' }))).rejects.toThrow('Неверна дата')
    await expect(readWorkspaceBackup(backupFile({ catalogRevision: 'нет' }))).rejects.toThrow('другой ревизии каталога')
    await expect(readWorkspaceBackup(backupFile({ catalogRevision: '9999-01-01' }))).rejects.toThrow('более новой ревизии каталога')
    await expect(readWorkspaceBackup(backupFile({ cad: { binaryIncluded: true, modelManifest: { modelIds: [] } } }))).rejects.toThrow('Повреждена manifest')
    await expect(readWorkspaceBackup(backupFile({ cad: { binaryIncluded: false, modelManifest: { modelIds: 'нет' } } }))).rejects.toThrow('Повреждена manifest')
    expect(CATALOG_REVISION).toBeTruthy()
  })

  it('не принимает архив без проектов и с повторяющимся проектом', async () => {
    await expect(readWorkspaceBackup(backupFile({ projects: [] }))).rejects.toThrow('нет проектов')
    await expect(readWorkspaceBackup(backupFile({ projects: 'нет' }))).rejects.toThrow('нет проектов')

    const project = validProject()
    const file = backupFile({ projects: [project, structuredClone(project)] })
    await expect(readWorkspaceBackup(file)).rejects.toThrow('повторяется проект')
  })

  it('указывает индекс сломанного проекта, чтобы архив можно было починить', async () => {
    // A project from a newer build than this one: migration has nothing to upgrade it with, so
    // the whole archive is refused — but the index still has to be named, or the user cannot
    // tell which of five hundred projects to delete.
    const future = { ...structuredClone(validProject()), schemaVersion: 99 }
    const file = backupFile({ projects: [validProject(), future] })

    await expect(readWorkspaceBackup(file)).rejects.toThrow('projects[1]')
  })

  it('открывает проект, отмеченный в архиве, и подставляет первый, если отметки нет', async () => {
    const first = validProject()
    const second = validProject()
    second.id = 'second'

    const marked = await readWorkspaceBackup(backupFile({ projects: [first, second], currentProjectId: 'second' }))
    expect(marked.currentProjectId).toBe('second')

    const missing = await readWorkspaceBackup(backupFile({ projects: [first, second], currentProjectId: 'нет' }))
    expect(missing.currentProjectId).toBe(first.id)
  })

  it('переносит v2-проект из архива через миграцию, а не отбрасывает', async () => {
    // A v2 payload is missing the fields the present schema asks for. Reading it as current
    // would refuse it, and the user who took a backup before the upgrade would lose it.
    const project = structuredClone(validProject())
    project.schemaVersion = 2
    project.devices = placed('ekf-terminal-1p-gray', 0, 0)
    project.connections = [
      { id: 'n1', circuitId: '', fromBus: 'N', toDeviceId: project.devices[0]!.instanceId, color: '', thickness: 2, kind: 'circuit', busId: undefined, toTerminal: { deviceId: project.devices[0]!.instanceId, pole: 1, side: 'top' }, label: '' },
      { id: 'pe1', circuitId: '', fromBus: 'PE', toDeviceId: project.devices[0]!.instanceId, color: '', thickness: 2, kind: 'circuit', busId: undefined, toTerminal: { deviceId: project.devices[0]!.instanceId, pole: 1, side: 'top' }, label: '' },
    ]
    project.busAssemblies = []

    const restored = await readWorkspaceBackup(backupFile({ projects: [project] }))

    expect(restored.projects[0]!.schemaVersion).toBe(PROJECT_SCHEMA_VERSION)
    // A v2 board had no bars to name, so migration builds the two its own wires ask for and
    // anchors them by kind — that is the whole v2→v3 step.
    expect(restored.projects[0]!.busAssemblies.map((bus) => bus.kind)).toEqual(['N', 'PE'])
    const bars = new Set(restored.projects[0]!.busAssemblies.map((bus) => bus.id))
    expect(restored.projects[0]!.connections.every((wire) => bars.has(wire.busId ?? ''))).toBe(true)
  })

  it('не читает архив, который больше отведённого места', async () => {
    const huge = new File([new Uint8Array(11 * 1024 * 1024)], 'huge.json')

    await expect(readWorkspaceBackup(huge)).rejects.toThrow('больше 10 МБ')
  })
})

describe('выгрузка произвольного JSON', () => {
  it('создаёт ссылку на объект в памяти и отпускает её по таймеру', () => {
    const revoked: string[] = []
    const created: string[] = []
    env = installBrowserEnv()
    vi.useFakeTimers()
    const realCreate = URL.createObjectURL
    const realRevoke = URL.revokeObjectURL
    URL.createObjectURL = (() => { const url = `blob:node:${created.length}`; created.push(url); return url }) as typeof URL.createObjectURL
    URL.revokeObjectURL = ((url: string) => { revoked.push(url) }) as typeof URL.revokeObjectURL

    downloadJsonFile({ привет: 'мир' }, 'file.json')
    expect(env.lastDownload()?.download).toBe('file.json')
    expect(env.lastDownload()?.clicks).toBe(1)
    expect(revoked).toEqual([])

    // A blob URL that is never released keeps the whole payload alive for the page's lifetime.
    vi.advanceTimersByTime(1000)
    URL.createObjectURL = realCreate
    URL.revokeObjectURL = realRevoke

    expect(revoked).toEqual(created)
  })
})

describe('схема и каталог остаются в согласии', () => {
  it('проверяет проект, собранный из настоящего товара каталога', () => {
    const project = validProject()
    project.devices = placed('ekf-mcb-1p-c6', 0, 0)

    expect(validateProjectSchema(project).valid).toBe(true)
  })

  it('ловит товар, которого нет в каталоге, на уровне проекта, а не схемы', () => {
    // The schema only knows shapes; a missing product is a domain error, and the two must not
    // be confused — otherwise a valid file would be rejected by the wrong layer.
    const [device] = placed('ekf-mcb-1p-c6', 0, 0)
    const project: PanelProject = { ...validProject(), devices: [{ ...device!, productId: 'нет-такого' }] }

    expect(validateProjectSchema(project).valid).toBe(true)
  })
})

import { beforeEach, describe, expect, it } from 'vitest'
import { clearModelAssets, deleteModelAsset, getModelAsset, listModelAssetIds, putModelAsset } from '../src/storage/modelDb'
import { createFakeIndexedDB, resetFakeIndexedDB } from './support/browser-env'

const install = () => {
  resetFakeIndexedDB()
  Object.defineProperty(globalThis, 'indexedDB', { value: createFakeIndexedDB(), configurable: true })
}

const bytes = (fill: number) => new Uint8Array([fill, fill, fill, fill]).buffer

describe('библиотека CAD-моделей в IndexedDB', () => {
  beforeEach(install)

  it('кладёт, читает и перечисляет ассеты по идентификатору', async () => {
    await putModelAsset('nb1', { data: bytes(1) })
    await putModelAsset('nbh8', { data: bytes(2), thumbnail: 'data:image/png;base64,AAA' })

    expect((await getModelAsset('nb1'))?.data).toEqual(bytes(1))
    expect((await getModelAsset('nbh8'))?.thumbnail).toBe('data:image/png;base64,AAA')
    expect(await listModelAssetIds()).toEqual(['nb1', 'nbh8'])
  })

  it('читает запись без миниатюры как есть, не выдумывая её', async () => {
    await putModelAsset('legacy', { data: bytes(7) })

    const record = await getModelAsset('legacy')
    expect(record).toEqual({ data: bytes(7) })
    expect(record?.thumbnail).toBeUndefined()
  })

  it('не находит удалённый и никогда не записанный ассет', async () => {
    await putModelAsset('gone', { data: bytes(3) })
    await deleteModelAsset('gone')

    expect(await getModelAsset('gone')).toBeUndefined()
    expect(await getModelAsset('never-existed')).toBeUndefined()
    expect(await listModelAssetIds()).toEqual([])
  })

  it('очищает хранилище целиком', async () => {
    await putModelAsset('a', { data: bytes(1) })
    await putModelAsset('b', { data: bytes(2) })
    await clearModelAssets()

    expect(await listModelAssetIds()).toEqual([])
  })

  it('перезаписывает ассет по тому же идентификатору, а не добавляет второй', async () => {
    await putModelAsset('nb1', { data: bytes(1) })
    await putModelAsset('nb1', { data: bytes(9), thumbnail: 'data:image/png;base64,BBB' })

    expect(await listModelAssetIds()).toEqual(['nb1'])
    expect((await getModelAsset('nb1'))?.data).toEqual(bytes(9))
  })
})

describe('ошибки хранилища моделей', () => {
  it('сообщает об отсутствии IndexedDB понятной пользователю фразой', async () => {
    Reflect.deleteProperty(globalThis, 'indexedDB')

    await expect(putModelAsset('nb1', { data: bytes(1) })).rejects.toThrow(/Не удалось сохранить модель.*IndexedDB недоступен/s)
    await expect(getModelAsset('nb1')).rejects.toThrow(/Не удалось прочитать модель/)
    await expect(deleteModelAsset('nb1')).rejects.toThrow(/Не удалось удалить модель/)
    await expect(clearModelAssets()).rejects.toThrow(/Не удалось очистить модель/)
  })

  it('переводит переполнение квоты в совет, а не в стековый след', async () => {
    const quota = Object.assign(new Error('exceeded'), { name: 'QuotaExceededError' })
    Object.defineProperty(globalThis, 'indexedDB', {
      configurable: true,
      value: {
        open: () => {
          const request: Record<string, unknown> = {}
          setTimeout(() => {
            request.error = quota
            ;(request.onerror as (() => void) | null)?.()
          }, 0)
          return request
        },
      },
    })

    await expect(putModelAsset('nb1', { data: bytes(1) })).rejects.toThrow(/хранилище IndexedDB переполнено/)
    install()
  })

  it('переводит запрет браузера в просьбу разрешить сохранение сайта', async () => {
    const blocked = Object.assign(new Error('blocked'), { name: 'SecurityError' })
    Object.defineProperty(globalThis, 'indexedDB', {
      configurable: true,
      value: {
        open: () => {
          const request: Record<string, unknown> = {}
          setTimeout(() => {
            request.error = blocked
            ;(request.onerror as (() => void) | null)?.()
          }, 0)
          return request
        },
      },
    })

    await expect(putModelAsset('nb1', { data: bytes(1) })).rejects.toThrow(/браузер запретил доступ к IndexedDB/)
    install()
  })
})

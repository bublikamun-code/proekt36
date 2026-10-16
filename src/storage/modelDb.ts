const DB_NAME = 'panel36-models'
const STORE_NAME = 'assets'
const DB_VERSION = 1

/** What the store holds per asset: the raw CAD bytes plus the import-time raster preview. */
export interface ModelAssetRecord {
  data: ArrayBuffer
  thumbnail?: string
}

const assetError = (error: unknown, action: string) => {
  const name = error && typeof error === 'object' && 'name' in error ? String(error.name) : ''
  if (name === 'QuotaExceededError' || name === 'NS_ERROR_DOM_QUOTA_REACHED' || /quota/i.test(error instanceof Error ? error.message : String(error))) {
    return new Error(`Не удалось ${action} модель: хранилище IndexedDB переполнено. Удалите неиспользуемые модели или освободите место в браузере.`)
  }
  if (name === 'SecurityError' || name === 'NotAllowedError') {
    return new Error(`Не удалось ${action} модель: браузер запретил доступ к IndexedDB. Разрешите сохранение сайта и повторите.`)
  }
  return new Error(`Не удалось ${action} модель: ${error instanceof Error ? error.message : String(error)}`)
}

const openDb = () => new Promise<IDBDatabase>((resolve, reject) => {
  if (typeof indexedDB === 'undefined') {
    reject(new Error('IndexedDB недоступен в этом браузере или режиме'))
    return
  }
  const request = indexedDB.open(DB_NAME, DB_VERSION)
  request.onupgradeneeded = () => {
    if (!request.result.objectStoreNames.contains(STORE_NAME)) request.result.createObjectStore(STORE_NAME)
  }
  request.onsuccess = () => resolve(request.result)
  request.onerror = () => reject(request.error ?? new Error('Не удалось открыть хранилище моделей'))
  request.onblocked = () => reject(new Error('Хранилище моделей заблокировано другой вкладкой'))
})

/** Records written before the thumbnail existed hold a bare ArrayBuffer; they read as-is. */
const asRecord = (value: unknown): ModelAssetRecord | undefined =>
  value instanceof ArrayBuffer ? { data: value }
    : value && typeof value === 'object' && 'data' in value && (value as { data?: unknown }).data instanceof ArrayBuffer
      ? value as ModelAssetRecord
      : undefined

const runTransaction = async <T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> => {
  let db: IDBDatabase | undefined
  try {
    db = await openDb()
    return await new Promise<T | undefined>((resolve, reject) => {
      const transaction = db!.transaction(STORE_NAME, mode)
      const request = run(transaction.objectStore(STORE_NAME))
      if (request) request.onsuccess = () => resolve(request.result)
      else transaction.oncomplete = () => resolve(undefined)
      transaction.onerror = () => reject(transaction.error ?? new Error('Ошибка транзакции'))
      transaction.onabort = () => reject(transaction.error ?? new Error('Транзакция прервана'))
    })
  } catch (error) {
    throw assetError(error, 'прочитать')
  } finally {
    db?.close()
  }
}

export async function putModelAsset(id: string, record: ModelAssetRecord) {
  let db: IDBDatabase | undefined
  try {
    db = await openDb()
    await new Promise<void>((resolve, reject) => {
      const transaction = db!.transaction(STORE_NAME, 'readwrite')
      transaction.objectStore(STORE_NAME).put(record, id)
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error ?? new Error('Ошибка транзакции'))
      transaction.onabort = () => reject(transaction.error ?? new Error('Транзакция сохранения прервана'))
    })
  } catch (error) {
    throw assetError(error, 'сохранить')
  } finally {
    db?.close()
  }
}

export async function getModelAsset(id: string): Promise<ModelAssetRecord | undefined> {
  const value = await runTransaction('readonly', (store) => store.get(id) as IDBRequest<unknown>)
  return asRecord(value)
}

export async function listModelAssetIds(): Promise<string[]> {
  const keys = await runTransaction('readonly', (store) => store.getAllKeys() as IDBRequest<IDBValidKey[]>)
  return (keys ?? []).map((key) => String(key))
}

export async function deleteModelAsset(id: string) {
  let db: IDBDatabase | undefined
  try {
    db = await openDb()
    await new Promise<void>((resolve, reject) => {
      const transaction = db!.transaction(STORE_NAME, 'readwrite')
      transaction.objectStore(STORE_NAME).delete(id)
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error ?? new Error('Ошибка транзакции'))
      transaction.onabort = () => reject(transaction.error ?? new Error('Транзакция удаления прервана'))
    })
  } catch (error) {
    throw assetError(error, 'удалить')
  } finally {
    db?.close()
  }
}

export async function clearModelAssets() {
  let db: IDBDatabase | undefined
  try {
    db = await openDb()
    await new Promise<void>((resolve, reject) => {
      const transaction = db!.transaction(STORE_NAME, 'readwrite')
      transaction.objectStore(STORE_NAME).clear()
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error ?? new Error('Ошибка транзакции'))
      transaction.onabort = () => reject(transaction.error ?? new Error('Транзакция очистки прервана'))
    })
  } catch (error) {
    throw assetError(error, 'очистить')
  } finally {
    db?.close()
  }
}

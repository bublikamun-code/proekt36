import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { createProject } from '../src/domain/project'
import { createProjectFileEnvelope } from '../src/domain/projectFile'
import { APPLICATION_REVISION, isKnownRevision } from '../src/domain/projectSchema'

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }

describe('версия приложения', () => {
  it('совпадает с версией в package.json', () => {
    expect(APPLICATION_REVISION, `версия в src/version.ts (${APPLICATION_REVISION}) разошлась с package.json (${pkg.version}) — синхронизируйте их при выпуске`).toBe(pkg.version)
  })

  it('остаётся сравнимой ревизией, иначе импорт файлов новых версий не отсекается', () => {
    expect(isKnownRevision(APPLICATION_REVISION)).toBe(true)
  })

  it('попадает в конверт экспорта в обоих полях', () => {
    const envelope = createProjectFileEnvelope(createProject('Импорт', 'apartment', { phase: 1, inputCurrent: 40 }), '2026-09-24T12:00:00.000Z')

    expect(envelope.application.revision).toBe(APPLICATION_REVISION)
    expect(envelope.applicationRevision).toBe(APPLICATION_REVISION)
  })
})

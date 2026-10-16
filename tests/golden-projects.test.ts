import { readFileSync, readdirSync } from 'node:fs'
import { describe, it, expect } from 'vitest'
import { migrateProject } from '../src/domain/project'
import { validateProjectSchema, PROJECT_SCHEMA_VERSION } from '../src/domain/projectSchema'
import type { PanelProject } from '../src/domain/types'

/**
 * Золотой набор проектов — ворота слияния линий разработки (карточка A1 из REWORK_PLAN).
 * Каждая фикстура в tools/golden/ — реальный проект одной из схем: v1/v2 октября,
 * v2/v3/v4 сентября. Ожидаемое поведение текущего (октябрьского) кода: v1/v2 мигрируют
 * без потери смысла, v3/v4 честно отклоняются как новее поддерживаемой версии. После
 * слияния (схема v5) этот же набор станет приёмочным для сквозной миграции 1→5:
 * ожидания ниже меняются вместе с PROJECT_SCHEMA_VERSION, фикстуры — нет.
 */
const goldenDir = new URL('../tools/golden/', import.meta.url).pathname
const fixtureNames = readdirSync(goldenDir).filter((name) => name.endsWith('.json')).sort()

/** Коллекции, чей состав не имеет права молча меняться при миграции. */
const semanticCounts = (project: Record<string, unknown>) => ({
  devices: (project.devices as unknown[] | undefined)?.length ?? 0,
  circuits: (project.circuits as unknown[] | undefined)?.length ?? 0,
  connections: (project.connections as unknown[] | undefined)?.length ?? 0,
})

describe('золотой набор проектов', () => {
  it('фикстуры собраны для всех представляющих интерес версий', () => {
    expect(fixtureNames).toContain('october-v1.json')
    expect(fixtureNames).toContain('october-demo-v2.json')
    expect(fixtureNames).toContain('september-v2.json')
    expect(fixtureNames).toContain('september-v3.json')
    expect(fixtureNames).toContain('september-v4.json')
  })

  for (const name of fixtureNames) {
    const raw = JSON.parse(readFileSync(`${goldenDir}${name}`, 'utf8')) as Record<string, unknown>
    const version = typeof raw.schemaVersion === 'number' ? raw.schemaVersion : 1
    const supported = version <= PROJECT_SCHEMA_VERSION

    it(`${name} (v${version}): ${supported ? 'миграция без потери смысла' : 'честный отказ'}`, () => {
      if (!supported) {
        expect(() => migrateProject(raw as never)).toThrow('новее поддерживаемой')
        expect(validateProjectSchema(raw).errors.join(' ')).toContain('новее')
        return
      }
      const before = semanticCounts(raw)
      const migrated = migrateProject(raw as never)
      expect(migrated.schemaVersion).toBe(PROJECT_SCHEMA_VERSION)
      expect(semanticCounts(migrated as never as Record<string, unknown>)).toEqual(before)
      expect(migrated.name).toBe(typeof raw.name === 'string' && raw.name ? raw.name : 'Импортированная панель')
      const reMigrated = migrateProject(structuredClone(migrated))
      expect(reMigrated).toEqual(migrated)
    })
  }

  it('демо-проект октября проходит доменную схему после миграции', () => {
    const demo = JSON.parse(readFileSync(`${goldenDir}october-demo-v2.json`, 'utf8'))
    const migrated = migrateProject(demo as never) as PanelProject
    const check = validateProjectSchema(migrated)
    expect(check.errors.filter((error) => !error.includes('каталог'))).toEqual([])
  })
})

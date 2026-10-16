#!/usr/bin/env node
/**
 * Ворота слияния линий разработки: прогон золотого набора проектов (карточка A1
 * из docs/REWORK_PLAN.md). Печатает таблицу фикстур с ожиданием и запускает
 * vitest-проверку; код возврата передаётся наружу.
 *
 *   node tools/golden-check.mjs
 */
import { readdirSync, readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const goldenDir = join(here, 'golden')
const supported = Number(process.argv[2] ?? 2)

const fixtures = readdirSync(goldenDir).filter((name) => name.endsWith('.json')).sort()
if (!fixtures.length) {
  console.error('Золотой набор пуст: tools/golden/ не содержит фикстур')
  process.exit(1)
}

console.log('Золотой набор проектов (ожидание при поддерживаемой версии схемы v%s):\n', supported)
for (const name of fixtures) {
  const raw = JSON.parse(readFileSync(join(goldenDir, name), 'utf8'))
  const version = typeof raw.schemaVersion === 'number' ? raw.schemaVersion : 1
  const outcome = version <= supported
    ? `миграция в v${supported} без потери смысла (цепей: ${raw.circuits?.length ?? 0}, аппаратов: ${raw.devices?.length ?? 0})`
    : 'честный отказ: схема новее поддерживаемой'
  console.log(`  ${name.padEnd(24)} v${version}  →  ${outcome}`)
}

console.log('\nПрогон проверки:')
const run = spawnSync('npx', ['vitest', 'run', 'tests/golden-projects.test.ts'], { stdio: 'inherit' })
process.exit(run.status ?? 1)

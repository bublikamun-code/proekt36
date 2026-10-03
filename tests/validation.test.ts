import { describe, expect, it } from 'vitest'
import { allCatalog, builtinCatalog } from '../src/data/catalog'
import { createDevice, createProject } from '../src/domain/project'
import { phaseBalance } from '../src/domain/electrical'
import { validateProject } from '../src/domain/validation'
import type { Circuit } from '../src/domain/types'

const definitions = new Map(allCatalog.map((item) => [item.id, item]))

const circuit = (patch: Partial<Circuit> = {}): Circuit => ({
  id: 'circuit-1',
  name: 'Цепь 1',
  loadName: 'Розетка',
  current: 10,
  power: 0,
  phase: 1,
  protectionDeviceId: '',
  color: '#c65c3b',
  wireCrossSection: 1.5,
  note: '',
  ...patch,
})

describe('project validation', () => {
  it('marks preliminary calculation and empty board', () => {
    const issues = validateProject(createProject(), definitions)
    expect(issues.some((issue) => issue.id === 'empty')).toBe(true)
    expect(issues.some((issue) => issue.id === 'preliminary')).toBe(true)
  })

  it('reports over-current protection and missing protection categories', () => {
    const project = createProject('test', 'demo', { inputCurrent: 16 })
    project.devices = [createDevice(definitions.get('ekf-mcb-3p-c25')!, 0, 0)]
    const issues = validateProject(project, definitions)
    expect(issues.some((issue) => issue.id.startsWith('current-'))).toBe(true)
    expect(issues.some((issue) => issue.id === 'rccd')).toBe(true)
    expect(issues.some((issue) => issue.id === 'spd')).toBe(true)
  })

  it('reports row overflow on a selected 12-module rail', () => {
    const project = createProject('Короткий ряд', 'apartment', { cabinetId: 'enmas-nx8-24-embedded', railId: 'rail-12' })
    const device = createDevice(definitions.get('ekf-mcb-4p-b32')!, 0, 10)
    project.devices = [device]
    const issues = validateProject(project, definitions)
    expect(issues.some((issue) => issue.id === `row-overflow-${device.instanceId}`)).toBe(true)
  })

  it('requires a real source for a busbar connection', () => {
    const project = createProject('Шины', 'apartment')
    const target = createDevice(definitions.get('enmas-nb1-63h-1p-16a-c')!, 0, 0)
    project.devices = [target]
    project.connections = [{
      id: 'fork-link', circuitId: '', fromBus: 'L', toDeviceId: target.instanceId,
      color: '#aeb8b4', thickness: 2, label: 'FORK', kind: 'busbar', fromDeviceId: 'missing-busbar',
    }]
    const issues = validateProject(project, definitions)
    expect(issues.some((issue) => issue.id === 'connection-busbar-source-missing-fork-link')).toBe(true)
  })

  it('calls an unloaded board balanced instead of maximally skewed', () => {
    // A zero denominator used to be forced to 1, which reported a 100 % spread on
    // a panel that has no load at all.
    const empty = createProject('Пусто', 'demo', { phase: 3 })
    expect(phaseBalance(empty, definitions).spread).toBe(0)

    const loaded = createProject('Одна фаза', 'demo', { phase: 3 })
    loaded.devices = [createDevice(definitions.get('ekf-mcb-3p-c25')!, 0, 0)]
    expect(phaseBalance(loaded, definitions).spread).toBe(100)
  })

  it('reports a three-phase load above the incoming rating', () => {
    // A single-phase board already had a per-circuit check; a three-phase one had no aggregate
    // check, so the phase totals were displayed but never compared with the incoming rating.
    const project = createProject('Перегруз по L1', 'demo', { phase: 3, inputCurrent: 40 })
    project.circuits = [1, 2, 3].map((index) => ({ ...circuit(), id: `c${index}`, name: `Цепь ${index}`, current: 20, phase: 1 }))

    const flagged = validateProject(project, definitions).filter((issue) => issue.ruleCode === 'electrical.phase-load.preliminary')
    expect(flagged.map((issue) => issue.id)).toEqual(['phase-load-l1'])
    expect(flagged[0].message).toContain('60 А')
  })

  it('stays quiet while every phase is under the incoming rating', () => {
    const project = createProject('В норме', 'demo', { phase: 3, inputCurrent: 40 })
    project.circuits = [1, 2, 3].map((index) => ({ ...circuit(), id: `c${index}`, name: `Цепь ${index}`, current: 10, phase: 1 }))

    const flagged = validateProject(project, definitions).filter((issue) => issue.ruleCode === 'electrical.phase-load.preliminary')
    expect(flagged).toEqual([])
  })

  it('does not read device ratings as load on a board with no circuits', () => {
    // phaseBalance falls back to summing the rated current of every device when a project has no
    // circuits. A sum of protective ratings is not a load, so this must not raise the alarm —
    // otherwise every freshly seeded board would come out overloaded.
    const project = createProject('Без цепей', 'demo', { phase: 3, inputCurrent: 16 })
    project.devices = ['ekf-mcb-4p-b32', 'ekf-mcb-3p-c25', 'ekf-mcb-1p-b16'].map((id, index) => createDevice(definitions.get(id)!, 0, index * 4))

    const flagged = validateProject(project, definitions).filter((issue) => issue.ruleCode === 'electrical.phase-load.preliminary')
    expect(flagged).toEqual([])
  })
})

describe('requested ENMAS catalog scope', () => {
  it('contains the named families and excludes the unrequested DC series', () => {
    const series = new Set(allCatalog.map((item) => item.series))
    expect(series.has('NB1-63H')).toBe(true)
    expect(series.has('NL1')).toBe(true)
    expect(series.has('NB1L')).toBe(true)
    expect(series.has('NB310L')).toBe(true)
    expect(series.has('NJVA1-63')).toBe(true)
    expect(series.has('FORK')).toBe(true)
    expect(series.has('NU6-IIG')).toBe(true)
    expect(series.has('ШК')).toBe(true)
    expect(series.has('КБР')).toBe(true)
    expect(series.has('КСВ')).toBe(true)
    expect(series.has('NGU')).toBe(true)
    expect(series.has('PSU-DIN-24V-5A')).toBe(true)
    expect(allCatalog.some((item) => item.name.includes('NB1-63DC'))).toBe(false)
    expect(builtinCatalog.some((item) => item.name.includes('NB1-63DC'))).toBe(false)
  })
})

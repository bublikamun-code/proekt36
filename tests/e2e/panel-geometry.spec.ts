import type { Page } from '@playwright/test'
import { expect, test } from '@playwright/test'
import { unlockWorkspace } from './helpers'

const SESSION = { kind: 'guest', name: 'Геометрия', createdAt: '2026-01-01T00:00:00.000Z' }

const device = (productId: string, row: number, slot: number, quantity = 1) => ({
  instanceId: `${productId}-${row}-${slot}`,
  productId,
  row,
  slot,
  address: `QF${row}${slot}`,
  quantity,
  phase: 1,
  note: '',
  marking: `QF${row}${slot}`,
  mount: 'din',
})

const project = (name: string, settings: Record<string, unknown>, devices: ReturnType<typeof device>[]) => ({
  schemaVersion: 2,
  id: `geometry-${name}`,
  name,
  preset: 'test',
  createdAt: '2026-09-25T00:00:00.000Z',
  updatedAt: '2026-09-25T00:00:00.000Z',
  settings: { inputCurrent: 63, phase: 1, reserveModules: 4, rows: 1, enclosureWidth: 310, enclosureHeight: 300, enclosureDepth: 105, ...settings },
  devices,
  circuits: [],
  connections: [],
})

const openEditorWith = async (page: Page, value: unknown) => {
  await unlockWorkspace(page)
  await page.addInitScript(({ key, payload }) => localStorage.setItem(key, JSON.stringify(payload)), {
    key: 'panel36.projects.v1',
    payload: [value],
  })
  await page.goto('/app/editor')
  await expect(page.getByRole('region', { name: 'Схема электрощита' })).toBeVisible()
  await expect(page.locator('.editor-storage-alert')).toHaveCount(0)
}

const boardMetrics = (page: Page) => page.evaluate(() => {
  const rect = (element: Element | null) => {
    if (!element) return null
    const box = element.getBoundingClientRect()
    return { x: box.x, y: box.y, width: box.width, height: box.height, bottom: box.bottom, right: box.right }
  }
  const slots = [...document.querySelectorAll('.din-row:first-of-type .slot-cell')].map((element) => rect(element))
  const devices = [...document.querySelectorAll('.placed-device')].map((element) => ({
    footprint: Number(element.getAttribute('data-footprint-modules')),
    widthMm: Number(element.getAttribute('data-width-mm')),
    box: rect(element),
    rail: rect(element.closest('.din-row')?.querySelector('.din-rail') ?? null),
  }))
  return {
    spec: document.querySelector('.canvas-spec')?.textContent?.trim() ?? '',
    slotCount: slots.length,
    slots,
    devices,
    rail: rect(document.querySelector('.din-rail')),
    plate: rect(document.querySelector('.mounting-plate')),
    label: rect(document.querySelector('.row-label')),
  }
})

test('a 12-module rail renders 18 mm pitch and footprint-based device widths', async ({ page }) => {
  await openEditorWith(page, project('Геометрия 12', { cabinetId: 'panel36-12-embedded', railId: 'rail-12' }, [
    device('ekf-mcb-1p-c6', 0, 0),
    device('ekf-mcb-4p-b32', 0, 1),
    device('ekf-rccb-2p-25', 0, 5, 6),
  ]))

  await expect(page.locator('.canvas-spec')).toHaveText('12 мод./рейка · 18 мм')

  const board = await boardMetrics(page)
  expect(board.slotCount).toBe(12)
  const slotWidth = board.slots[0]!.width
  expect(slotWidth).toBeGreaterThan(0)
  for (const slot of board.slots) expect(slot.width).toBeCloseTo(slotWidth, 1)
  expect(board.slots[1]!.x - board.slots[0]!.x).toBeCloseTo(slotWidth, 1)
  expect(board.rail!.width).toBeCloseTo(slotWidth * 12, 0)
  expect(board.rail!.x).toBeGreaterThanOrEqual(board.plate!.x)

  expect(board.devices.map((item) => item.footprint)).toEqual([1, 4, 2])
  expect(board.devices.map((item) => item.widthMm)).toEqual([18, 72, 36])
  for (const item of board.devices) expect(item.box!.width).toBeCloseTo(slotWidth * item.footprint, 0)

  const sorted = [...board.devices].sort((a, b) => a.box!.x - b.box!.x)
  for (let index = 1; index < sorted.length; index += 1) {
    expect(sorted[index]!.box!.x).toBeGreaterThanOrEqual(sorted[index - 1]!.box!.right - 1)
  }
  for (const item of board.devices) {
    expect(item.box!.y).toBeGreaterThanOrEqual(board.plate!.y - 1)
    expect(item.box!.bottom).toBeLessThanOrEqual(board.plate!.bottom + 1)
    expect(item.box!.y + item.box!.height / 2).toBeCloseTo(item.rail!.y + item.rail!.height / 2, 0)
  }
  expect(board.label!.right).toBeLessThanOrEqual(board.rail!.x + 1)
})

test('an 18-module rail renders 18 slots and the same 18 mm pitch', async ({ page }) => {
  await openEditorWith(page, project('Геометрия 18', { cabinetId: 'panel36-18-r18-embedded', railId: 'rail-18', enclosureWidth: 354, enclosureHeight: 260 }, [
    device('ekf-mcb-3p-c25', 0, 2),
    device('schneider-spd-t2-4p', 0, 6),
  ]))

  await expect(page.locator('.canvas-spec')).toHaveText('18 мод./рейка · 18 мм')

  const board = await boardMetrics(page)
  expect(board.slotCount).toBe(18)
  const slotWidth = board.slots[0]!.width
  expect(board.rail!.width).toBeCloseTo(slotWidth * 18, 0)
  expect(board.devices.map((item) => item.widthMm)).toEqual([54, 72])
  for (const item of board.devices) expect(item.box!.width).toBeCloseTo(slotWidth * item.footprint, 0)
})

test('a legacy project keeps the 17.5 mm fallback and 29 slots', async ({ page }) => {
  await openEditorWith(page, {
    name: 'Legacy геометрия',
    preset: 'house',
    settings: { inputCurrent: 63, phase: 1, rows: 1, reserveModules: 4, enclosureWidth: 540, enclosureHeight: 650, enclosureDepth: 110 },
    devices: [device('ekf-mcb-1p-c6', 0, 0), device('ekf-mcb-2p-c16', 0, 4)],
    circuits: [],
    connections: [],
  })

  await expect(page.locator('.canvas-spec')).toHaveText('29 мод./рейка · 17.5 мм · legacy')

  const board = await boardMetrics(page)
  expect(board.slotCount).toBe(29)
  expect(board.devices.map((item) => item.widthMm)).toEqual([17.5, 35])
  const slotWidth = board.slots[0]!.width
  for (const item of board.devices) expect(item.box!.width).toBeCloseTo(slotWidth * item.footprint, 0)
})

test('every placed device renders a frontal face with per-pole levers and pockets', async ({ page }) => {
  await openEditorWith(page, project('Лицо', { cabinetId: 'panel36-12-embedded', railId: 'rail-12' }, [
    device('ekf-mcb-1p-c6', 0, 0),
    device('ekf-rcbo-1p-c16', 0, 1),
    device('ekf-rccb-2p-25', 0, 3),
  ]))

  const faces = await page.evaluate(() => [...document.querySelectorAll('.placed-device')].map((element) => {
    const svg = element.querySelector('svg.device-visual')
    const box = svg?.getBoundingClientRect()
    const deviceBox = element.getBoundingClientRect()
    return {
      modules: Number(element.getAttribute('data-footprint-modules')),
      hasFace: Boolean(svg),
      viewBox: svg?.getAttribute('viewBox') ?? '',
      label: svg?.getAttribute('aria-label') ?? '',
      toggles: svg?.querySelectorAll('.dv-toggle').length ?? 0,
      pockets: svg?.querySelectorAll('.dv-pocket').length ?? 0,
      fillsBox: Boolean(box && box.width > deviceBox.width * 0.6 && box.height > 0),
    }
  }))

  expect(faces).toHaveLength(3)
  for (const face of faces) {
    expect(face.hasFace).toBe(true)
    const [, , widthMm, heightMm] = face.viewBox.split(' ').map(Number)
    expect(widthMm).toBeCloseTo(face.modules * 18)
    expect(heightMm).toBeGreaterThan(40)
    expect(face.label).toContain('Схематичное изображение')
    expect(face.fillsBox).toBe(true)
  }
  // 1P: one lever and one pocket per side; 1P+N: one shared lever for two terminal columns.
  expect(faces[0]).toMatchObject({ modules: 1, toggles: 1, pockets: 2 })
  expect(faces[1]).toMatchObject({ modules: 2, toggles: 1, pockets: 4 })
  expect(faces[2]).toMatchObject({ modules: 2, toggles: 2, pockets: 4 })

  const frontView = page.locator('[data-front-view]')
  await page.getByRole('button', { name: 'Показать боковые панели' }).click()
  await page.locator('.placed-device').first().click()
  await expect(frontView).toBeVisible()
  await expect(frontView.locator('svg.device-visual')).toBeVisible()
  const frontBox = await frontView.locator('svg.device-visual').boundingBox()
  expect(frontBox!.height).toBeGreaterThan(120)
})

test('the read-only demo uses the same physical pitch as the editor', async ({ page }) => {
  await page.goto('/demo/project')
  const board = page.locator('.demo-project-board-view')
  await expect(board).toBeVisible()
  await expect(page.locator('.cabinet-footer b')).toHaveText('18 мм на модуль')

  const metrics = await page.evaluate(() => {
    const rect = (element: Element | null) => {
      if (!element) return null
      const box = element.getBoundingClientRect()
      return { x: box.x, y: box.y, width: box.width, height: box.height }
    }
    const slots = [...document.querySelectorAll('.demo-project-row .demo-project-slot')].slice(0, 12).map((element) => rect(element))
    const devices = [...document.querySelectorAll('.demo-project-device')].slice(0, 8).map((element) => ({
      footprint: Number(element.getAttribute('data-footprint-modules')),
      widthMm: Number(element.getAttribute('data-width-mm')),
      box: rect(element),
      rail: rect(element.closest('.demo-project-row')?.querySelector('.demo-project-rail') ?? null),
    }))
    return { slots, devices, rail: rect(document.querySelector('.demo-project-rail')) }
  })

  expect(metrics.slots).toHaveLength(12)
  const slotWidth = metrics.slots[0]!.width
  expect(metrics.slots[1]!.x - metrics.slots[0]!.x).toBeCloseTo(slotWidth, 1)
  expect(metrics.rail!.width).toBeCloseTo(slotWidth * 12, 0)
  for (const item of metrics.devices) {
    expect(item.box!.width).toBeCloseTo(slotWidth * item.footprint, 0)
    expect(item.widthMm).toBeCloseTo(item.footprint * 18, 5)
    expect(item.box!.y + item.box!.height / 2).toBeCloseTo(item.rail!.y + item.rail!.height / 2, 0)
  }
  await expect(page.getByRole('button', { name: /Добавить устройство|Удалить устройство/ })).toHaveCount(0)
})

test('a 48-module TEHNOPLAST cabinet keeps its published vertical proportions', async ({ page }) => {
  await openEditorWith(page, project('U48C', { cabinetId: 'panel36-48-r12-embedded', railId: 'rail-12' }, [
    device('ekf-mcb-1p-c6', 0, 0),
    device('ekf-mcb-4p-b32', 3, 6),
  ]))

  await expect(page.locator('.canvas-spec')).toHaveText('12 мод./рейка · 18 мм')

  const board = await boardMetrics(page)
  // 4 rows of 12 modules, 283 × 676 × 106 mm — the housing must be tall, not wide.
  const rowCount = await page.locator('.din-row').count()
  expect(rowCount).toBe(4)
  expect(board.slots).toHaveLength(12)
  expect(board.devices.map((item) => item.widthMm)).toEqual([18, 72])

  const plateRatio = board.plate!.width / board.plate!.height
  expect(plateRatio).toBeGreaterThan(0.35)
  expect(plateRatio).toBeLessThan(0.48)

  const cabinet = await page.evaluate(() => {
    const element = document.querySelector('.mounting-plate')?.parentElement
    if (!element) return null
    const box = element.getBoundingClientRect()
    return { width: box.width, height: box.height }
  })
  expect(cabinet).not.toBeNull()
  expect(cabinet!.width / cabinet!.height).toBeCloseTo(283 / 676, 1)

  await expect(page.locator('.cabinet-label small')).toContainText('283×676×106 мм')
  await expect(page.locator('.cabinet-label small')).not.toContainText('IP54')
})

test('the demo cabinet is not stretched by a minimum width', async ({ page }) => {
  await page.goto('/demo/project')
  // The inline width is set from a computed, so the element must be mounted before it can be
  // measured. Reading the DOM straight after goto raced the mount and returned null.
  await expect(page.locator('.demo-project-cabinet')).toBeVisible()
  const cabinet = await page.evaluate(() => {
    const element = document.querySelector('.demo-project-cabinet')
    const caption = document.querySelector('.demo-project-plate .cabinet-caption b')
    if (!element || !caption) return null
    const box = element.getBoundingClientRect()
    const [widthMm, heightMm] = (caption.textContent ?? '').match(/(\d+) × (\d+)/)?.slice(1).map(Number) ?? []
    return { width: box.width, height: box.height, inline: Number(element.style.width.replace('px', '')), widthMm: widthMm ?? 0, heightMm: heightMm ?? 0 }
  })
  expect(cabinet).not.toBeNull()
  // The inline width follows the catalog millimetres at the shared 1.5 factor, with no pixel floor.
  expect(cabinet!.inline).toBeCloseTo(cabinet!.widthMm * 1.5, 0)
  expect(cabinet!.inline).toBeLessThan(520)
  expect(cabinet!.width).toBeLessThan(cabinet!.height)
})

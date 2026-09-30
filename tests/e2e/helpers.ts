import type { Locator, Page } from '@playwright/test'

const DEMO_SESSION = {
  kind: 'guest',
  name: 'Тестовый пользователь',
  createdAt: '2026-01-01T00:00:00.000Z',
}

export const unlockWorkspace = async (page: Page) => {
  await page.addInitScript((session) => {
    sessionStorage.setItem('panel36.demo-session.v1', JSON.stringify(session))
  }, DEMO_SESSION)
}

export const gotoEditor = async (page: Page) => {
  await unlockWorkspace(page)
  await page.goto('/app/editor')
}

/** The same editor, opened on a project the test planted under a known id. */
export const gotoProjectEditor = async (page: Page, projectId: string) => {
  await unlockWorkspace(page)
  await page.goto(`/app/projects/${projectId}/editor`)
}

/** Opens a styled AppSelect trigger and picks an option the way a user would. */
export const pickOption = async (scope: Locator, label: string | RegExp, optionLabel: string) => {
  const trigger = scope.getByLabel(label)
  await trigger.click()
  const listbox = scope.getByRole('listbox').first()
  await listbox.getByRole('option', { name: optionLabel, exact: false }).first().click()
}

/** Opens a styled AppSelect trigger and chooses an option with the keyboard. */
export const pickOptionByKeyboard = async (scope: Locator, label: string | RegExp, optionLabel: string) => {
  const trigger = scope.getByLabel(label)
  await trigger.focus()
  await trigger.press('Enter')
  const listbox = scope.getByRole('listbox').first()
  await listbox.getByRole('option', { name: optionLabel, exact: false }).first().press('Enter')
}

/**
 * Drags with a real pointer press, the way a hand does. The board only starts a
 * drag after the pointer has clearly moved, so a plain click stays a click.
 * `onHover` runs while the button is still down, which is where a drag preview
 * can be inspected.
 */
export const dragWithPointer = async (page: Page, from: Locator, to: Locator, onHover?: () => Promise<void>) => {
  // Both ends must be reachable by the pointer: a long catalogue list or a tall
  // cabinet leaves the other endpoint outside the viewport, and a mouse move to
  // coordinates the viewport does not contain presses nothing at all.
  await from.scrollIntoViewIfNeeded()
  await to.scrollIntoViewIfNeeded()
  const source = await from.boundingBox()
  const target = await to.boundingBox()
  if (!source || !target) throw new Error('Drag endpoints are unavailable')
  const start = { x: source.x + source.width / 2, y: source.y + source.height / 2 }
  const end = { x: target.x + target.width / 2, y: target.y + target.height / 2 }
  await page.mouse.move(start.x, start.y)
  await page.mouse.down()
  await page.mouse.move(start.x + 10, start.y, { steps: 3 })
  await page.mouse.move(end.x, end.y, { steps: 12 })
  if (onHover) await onHover()
  await page.mouse.up()
}

/** Loads a known project so a drag test can assert on exact positions. */
export const seedProject = async (page: Page, devices: Array<{ id: string; row: number; slot: number }>) => {
  await page.addInitScript((seed) => {
    // The one-time orientation card eats the center column and shrinks the auto-fit board
    // until a module is smaller than the tests' pixel tolerance, so a position lab starts
    // from the settled editor.
    localStorage.setItem('panel36.hints.v1', 'dismissed')
    localStorage.setItem('panel36.projects.v3', JSON.stringify([{
      schemaVersion: 3,
      id: 'drag-lab',
      name: 'Стенд перетаскивания',
      preset: 'demo',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      settings: {
        inputCurrent: 63, phase: 1, rows: 2, reserveModules: 4,
        enclosureWidth: 283, enclosureHeight: 357, enclosureDepth: 106,
        cabinetId: 'panel36-24-embedded', railId: 'rail-12',
      },
      devices: seed.map((item) => ({
        instanceId: item.id,
        productId: 'ekf-mcb-1p-c6',
        row: item.row,
        slot: item.slot,
        address: item.id.toUpperCase(),
        quantity: 1,
        phase: 1,
        note: '',
        marking: item.id.toUpperCase(),
        mount: 'din',
      })),
      circuits: [],
      connections: [],
      busAssemblies: [
        { id: 'bus-n-bottom', kind: 'N', placement: 'bottom', label: 'N' },
        { id: 'bus-pe-bottom', kind: 'PE', placement: 'bottom', label: 'PE' },
      ],
      combs: [],
    }]))
  }, devices)
}

/**
 * A board with something on it to connect: two breakers on one row and the neutral and earth
 * bars along the bottom. A wiring test needs terminals that are free and a bus to feed from, and
 * an empty board would make the wire tool look like it draws nothing simply because there is
 * nowhere to draw it.
 */
export const seedWiringProject = async (page: Page) => {
  await page.addInitScript(() => {
    localStorage.setItem('panel36.hints.v1', 'dismissed')
    const device = (instanceId: string, productId: string, row: number, slot: number, address: string) => ({
      instanceId, productId, row, slot, address, quantity: 1, phase: 1, note: '', marking: address, mount: 'din',
    })
    localStorage.setItem('panel36.projects.v3', JSON.stringify([{
      schemaVersion: 3,
      id: 'wiring-lab',
      name: 'Стенд разводки',
      preset: 'demo',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      settings: {
        inputCurrent: 63, phase: 1, rows: 2, reserveModules: 4,
        enclosureWidth: 283, enclosureHeight: 357, enclosureDepth: 106,
        cabinetId: 'panel36-24-embedded', railId: 'rail-12',
      },
      devices: [
        device('qf01', 'ekf-mcb-1p-c6', 0, 0, 'QF01'),
        device('qf02', 'ekf-mcb-1p-c6', 0, 1, 'QF02'),
        device('qf03', 'ekf-mcb-1p-c6', 0, 2, 'QF03'),
      ],
      circuits: [],
      connections: [],
      busAssemblies: [
        { id: 'bus-n-bottom', kind: 'N', placement: 'bottom', label: 'N' },
        { id: 'bus-pe-bottom', kind: 'PE', placement: 'bottom', label: 'PE' },
      ],
      combs: [],
    }]))
  })
}

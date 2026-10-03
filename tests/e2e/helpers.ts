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

const boardRegion = (page: Page) => page.getByRole('region', { name: 'Схема электрощита' })

/**
 * Opens the side panels, whichever state the editor came up in.
 *
 * The editor opens focused, and a reload that also cleared the workspace puts it back that way.
 * Checking `isVisible()` on the trigger alone is not enough: right after a reload the button is not
 * there yet, so the check answers "no" and the panels stay shut for the rest of the test.
 */
export const openSidePanels = async (page: Page) => {
  await boardRegion(page).waitFor({ state: 'visible', timeout: 60_000 })
  const trigger = page.getByRole('button', { name: 'Показать боковые панели' })
  if (await trigger.isVisible()) await trigger.click()
  await page.getByRole('heading', { name: 'Каталог' }).waitFor({ state: 'visible' })
}

/**
 * The board's readiness signal. Every spec that opens the editor starts from it, so start-up cost
 * is paid once, here, instead of being charged to whichever assertion happens to run first.
 */
/**
 * Waits until an element has stopped moving, then reads where it is.
 *
 * Devices animate into place, so a reading taken during the transition catches a position in flight.
 * A test that compares that against a settled number fails for a reason that has nothing to do with
 * the board — and it fails more often on a loaded machine, which is exactly when a red test is least
 * useful. Two consecutive frames with an unchanged box means nothing is moving.
 */
export const settledLeftOf = async (page: Page, selector: string) => {
  const locator = page.locator(selector).first()
  await locator.waitFor({ state: 'attached' })
  await locator.evaluate((element) => new Promise<void>((resolve) => {
    let last = element.getBoundingClientRect().left
    const tick = () => {
      const now = element.getBoundingClientRect().left
      if (now === last) return resolve()
      last = now
      requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  }))
  const box = await locator.boundingBox()
  if (!box) throw new Error(`Nothing is at ${selector}`)
  return box.x
}

/** The settled width of an element, for the same reason `settledLeftOf` exists for positions. */
export const settledWidthOf = async (page: Page, selector: string) => {
  const locator = page.locator(selector).first()
  await locator.waitFor({ state: 'attached' })
  await locator.evaluate((element) => new Promise<void>((resolve) => {
    let last = element.getBoundingClientRect().width
    const tick = () => {
      const now = element.getBoundingClientRect().width
      if (now === last) return resolve()
      last = now
      requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  }))
  return (await locator.boundingBox())?.width ?? 0
}

export const gotoEditor = async (page: Page) => {
  await unlockWorkspace(page)
  await page.goto('/app/editor')
  // The editor mounts only after the store has read the workspace, laid out the cabinet and drawn
  // the board. Returning before that left the first assertion of a spec racing start-up, and on a
  // loaded machine the board sometimes needed longer than the default assertion timeout. This waits
  // on the same element the specs check, so nothing is asserted twice and nothing is skipped.
  await boardRegion(page).waitFor({ state: 'visible', timeout: 60_000 })
}

/**
 * A page or any element scope: both expose the role and label queries these helpers drive, and
 * specs legitimately start from either.
 */
type QueryScope = Page | Locator

/** Opens a styled AppSelect trigger and picks an option the way a user would. */
export const pickOption = async (scope: QueryScope, label: string | RegExp, optionLabel: string) => {
  const trigger = scope.getByLabel(label)
  await trigger.click()
  const listbox = scope.getByRole('listbox').first()
  await listbox.getByRole('option', { name: optionLabel, exact: false }).first().click()
}

/** Opens a styled AppSelect trigger and chooses an option with the keyboard. */
export const pickOptionByKeyboard = async (scope: QueryScope, label: string | RegExp, optionLabel: string) => {
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
    localStorage.setItem('panel36.projects.v2', JSON.stringify([{
      schemaVersion: 2,
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
    }]))
  }, devices)
}

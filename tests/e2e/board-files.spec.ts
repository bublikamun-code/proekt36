import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import { unlockWorkspace } from './helpers'

/**
 * Getting the project out of the browser and back in.
 *
 * The round trip is the whole point: an export nobody can re-import is a screenshot. The check is
 * made on the board itself — the same devices, in the same places, with the same wires — because a
 * file that parses is not the same as a project that survived the trip.
 */
test.describe('файлы проекта', () => {
  test.setTimeout(180_000)

  const openBoard = async (page: import('@playwright/test').Page) => {
    await unlockWorkspace(page)
    await page.goto('/app/board?fixture=demo')
    await expect(page.locator('.board-scene')).toBeVisible({ timeout: 60_000 })
  }

  const fingerprint = (page: import('@playwright/test').Page) => page.evaluate(() => ({
    devices: [...document.querySelectorAll<SVGGElement>('.scene-device')]
      .map((el) => `${el.getAttribute('data-instance-id')}@${el.getAttribute('transform')}`)
      .sort(),
    wires: document.querySelectorAll('.scene-wire').length,
    addresses: [...document.querySelectorAll('.scene-device-address')].map((el) => el.textContent).sort(),
  }))

  test('экспорт и импорт возвращают тот же проект', async ({ page }) => {
    await openBoard(page)
    const before = await fingerprint(page)
    expect(before.devices.length).toBeGreaterThan(0)

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Экспорт', exact: true }).click(),
    ])
    const path = await download.path()
    expect(path).toBeTruthy()
    // The file has to be a real project envelope, not an empty or HTML response.
    const envelope = JSON.parse(await readFile(path!, 'utf8')) as { project?: { devices?: unknown[] } }
    expect(Array.isArray(envelope.project?.devices)).toBe(true)
    expect(envelope.project!.devices).toHaveLength(before.devices.length)

    // Import it straight back over the same workspace.
    await page.getByTestId('board-import').setInputFiles(path!)
    await expect(page.locator('.storage-banner')).toContainText('загружен')
    await expect.poll(async () => JSON.stringify(await fingerprint(page))).toEqual(JSON.stringify(before))
  })

  test('экспорт с моделями отдаёт архив, а не JSON', async ({ page }) => {
    await openBoard(page)
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Экспорт с моделями' }).click(),
    ])
    const path = await download.path()
    const bytes = await readFile(path!)
    // A ZIP begins with PK; a JSON envelope would not. A silent downgrade would hand the user a
    // file without the models while the button said otherwise.
    expect(bytes.subarray(0, 2).toString('latin1')).toBe('PK')
  })
})

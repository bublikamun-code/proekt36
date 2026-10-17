import { chromium } from '@playwright/test'
const browser = await chromium.launch()
const context = await browser.newContext()
// Приложение пропускает регистрацию под webdriver; для этой проверки честно снимаем флаг —
// это ручной протокол, а не e2e-набор.
await context.addInitScript(() => {
  Object.defineProperty(navigator, 'webdriver', { get: () => false })
})
const page = await context.newPage()
await page.goto('http://localhost:8080/')
await page.waitForTimeout(2500)
const sw1 = await page.evaluate(async () => {
  const reg = await navigator.serviceWorker.getRegistration()
  return reg ? { installing: !!reg.installing, waiting: !!reg.waiting, active: !!reg.active } : null
})
console.log('SW state v1:', JSON.stringify(sw1))
console.log('prompt visible v1:', await page.locator('.update-prompt').count())

// «Новый деплой»: меняем VERSION в sw.js на сервере.
await page.evaluate(async () => {
  const reg = await navigator.serviceWorker.getRegistration()
  await reg?.update()
})
await fetch('http://localhost:8080/sw.js').then(async (r) => {
  const body = await r.text()
  // правим версию в кэше браузера нельзя — меняем прямо в контейнере ниже через exec
  void body
})
await browser.close()
console.log('этап 1 готов')

import { defineConfig, devices } from '@playwright/test'
import base from './playwright.config'

/**
 * E2E against a deployed static build (nginx container) instead of the dev server.
 * Usage: npx playwright test --config=playwright.deploy.config.ts
 * The deploy URL is fixed by the hoster; override with DEPLOY_URL when it moves.
 */
const baseURL = process.env.DEPLOY_URL ?? 'http://172.17.0.1:8080'

export default defineConfig({
  ...base,
  use: {
    ...base.use,
    baseURL,
  },
  // The deployment is already running and is not ours to start or stop.
  webServer: undefined,
})

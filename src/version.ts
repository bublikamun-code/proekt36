/**
 * The single place where the application version is written down.
 *
 * `package.json` carries the same string because npm needs it, and the two are kept in step
 * by `tests/app-version.test.ts`, which runs as part of `npm run verify`. A module was
 * preferred over a build-time substitution on purpose: the version is read by Vite, Vitest
 * and Playwright alike, and a plain module needs no injection wiring in each of them.
 *
 * Bump this together with `package.json` when releasing — see the release steps in
 * `CHANGELOG.md` and section 10 of the runbook.
 */
export const APP_VERSION = '0.3.0'

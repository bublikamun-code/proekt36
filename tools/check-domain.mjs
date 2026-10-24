// Guards the domain boundary (C1): src/domain is the separately compiled calculation core,
// so it may import its own files, the catalogue data and the version constant — and nothing
// else. No Vue/Pinia, no stores, views or components, no browser services. `npm run
// domain:check` runs this after `tsc -p tsconfig.domain.json`, so a boundary breach fails
// the gate even though the application itself would still compile.
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const domainDir = join(root, 'src/domain')

const listFiles = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    return entry.isDirectory() ? listFiles(path) : entry.name.endsWith('.ts') ? [path] : []
  })

// Relative imports that leave src/domain are only allowed to land on these; everything
// else outside the domain is application territory. The catalogue and the enclosure
// reference are data the core computes from (both provenance-tracked), not app layers.
const allowedOutside = [/^\.\.\/data\/catalog(\/|$)/, /^\.\.\/data\/enclosures$/, /^\.\.\/version$/]
// Bare package specifiers the core may depend on; extending this list is a decision, not
// an accident, so an import of anything else is reported.
const allowedPackages = []

const sources = listFiles(domainDir)
const violations = []
for (const source of sources) {
  const text = readFileSync(source, 'utf8')
  const specifiers = [...text.matchAll(/(?:from\s+|import\s*\(\s*)['"]([^'"]+)['"]/g)].map((match) => match[1])
  for (const specifier of specifiers) {
    const from = relative(root, source)
    if (!specifier.startsWith('.')) {
      if (!allowedPackages.includes(specifier)) violations.push(`${from}: посторонний пакет «${specifier}»`)
      continue
    }
    const target = resolve(dirname(source), specifier)
    const insideDomain = target.startsWith(domainDir + '/')
    if (insideDomain) continue
    if (allowedOutside.some((pattern) => pattern.test(specifier))) continue
    violations.push(`${from}: импорт вне домена «${specifier}»`)
  }
}

if (violations.length) {
  console.error(`check-domain: домен должен зависеть только от себя, каталога и версии (${violations.length})`)
  for (const violation of violations) console.error(`  ${violation}`)
  process.exit(1)
}
console.log(`check-domain: граница чиста, ${sources.length} файлов`)

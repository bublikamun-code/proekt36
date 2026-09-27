import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Guards the token layer itself.
 *
 * A custom property that is used but never defined is not a build error: the browser simply
 * drops the declaration, so a renamed token shows up as a silent colour change rather than a
 * failure. That is exactly how a self-referential `--x: var(--x)` slips in, which happened
 * once during the board-palette refactor.
 */

const root = join(process.cwd(), 'src')

const collect = (dir: string): string[] => readdirSync(dir).flatMap((entry) => {
  const path = join(dir, entry)
  if (statSync(path).isDirectory()) return collect(path)
  return path.endsWith('.css') || path.endsWith('.vue') ? [path] : []
})

const sources = collect(root).map((path) => ({ path, text: readFileSync(path, 'utf8') }))

const styleText = ({ path, text }: { path: string; text: string }) => {
  if (path.endsWith('.css')) return text
  const open = text.indexOf('<style')
  if (open === -1) return ''
  const gt = text.indexOf('>', open)
  const close = text.indexOf('</style>', gt)
  return text.slice(gt + 1, close)
}

describe('design tokens', () => {
  const defined = new Map<string, string>()
  for (const source of sources) {
    for (const match of styleText(source).matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
      if (!defined.has(match[1])) defined.set(match[1], match[2].trim())
    }
  }

  it('finds the token layer at all', () => {
    // A floor, not a target: the layer is currently 85 tokens. If this drops sharply the
    // parsing below is broken rather than the design getting smaller.
    expect(defined.size).toBeGreaterThan(70)
  })

  it('never defines a token in terms of itself', () => {
    const selfReferential = [...defined].filter(([name, value]) => value.includes(`var(${name})`))
    expect(selfReferential.map(([name]) => name)).toEqual([])
  })

  it('resolves every custom property that is used', () => {
    const used = new Map<string, string[]>()
    for (const source of sources) {
      for (const match of styleText(source).matchAll(/var\((--[\w-]+)/g)) {
        if (!used.has(match[1])) used.set(match[1], [])
        used.get(match[1])!.push(source.path.replace(`${process.cwd()}/`, ''))
      }
    }
    // A fallback inside `var(--x, fallback)` does not excuse the name: it is exactly how an
    // undefined token stays invisible, quietly rendering the fallback instead. Report them all.
    const missing = [...used].filter(([name]) => !defined.has(name))
    expect(missing.map(([name, where]) => `${name} (${[...new Set(where)].join(', ')})`)).toEqual([])
  })

  it('defines every board token in both themes or neither', () => {
    // The drawn cabinet keeps its own greys in both themes, so the whole group is
    // theme-independent. A board token appearing only in :root means a later edit added it
    // to one theme and forgot the other, which is the mistake the group is meant to prevent.
    const css = readFileSync(join(root, 'style.css'), 'utf8')
    const block = (selector: string) => {
      const at = css.indexOf(selector)
      if (at === -1) return ''
      const open = css.indexOf('{', at)
      let depth = 0
      for (let i = open; i < css.length; i += 1) {
        if (css[i] === '{') depth += 1
        else if (css[i] === '}') { depth -= 1; if (depth === 0) return css.slice(open, i) }
      }
      return ''
    }
    const boardIn = (text: string) => new Set([...text.matchAll(/(--board-[\w-]+)\s*:/g)].map((m) => m[1]))
    const light = boardIn(block(':root {'))
    const dark = boardIn(block(":root[data-theme='dark'] {"))
    expect([...light].filter((name) => dark.has(name))).toEqual([])
  })
})

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * Colour pairs that are supposed to carry text, checked against WCAG 2.2 AA for normal text
 * (1.4.3, 4.5:1). The failures this guards against were real: white on the dark theme's
 * `--error` measured 2.48:1, and `--text-faint` on the light canvas measured 2.79:1.
 */
const stylesheet = readFileSync(new URL('../src/style.css', import.meta.url), 'utf8')

// Balances braces rather than taking the first `}`: `@media print` contains a nested `@page`
// block, and stopping at its close would read the page margins as the whole print stylesheet.
const blockFor = (selector: string): string => {
  const start = stylesheet.indexOf(selector)
  if (start < 0) throw new Error(`Блок ${selector} не найден в src/style.css`)
  const open = stylesheet.indexOf('{', start)
  let depth = 0
  for (let index = open; index < stylesheet.length; index += 1) {
    if (stylesheet[index] === '{') depth += 1
    if (stylesheet[index] === '}') {
      depth -= 1
      if (depth === 0) return stylesheet.slice(open + 1, index)
    }
  }
  throw new Error(`Блок ${selector} не закрыт в src/style.css`)
}

const tokensOf = (selector: string): Record<string, string> =>
  Object.fromEntries(
    [...blockFor(selector).matchAll(/(--[\w-]+):\s*([^;]+);/g)].map(([, name, value]) => [name, value.trim()]),
  )

const resolve = (value: string, tokens: Record<string, string>, seen = new Set<string>()): string => {
  const nested = /^var\((--[\w-]+)\)$/.exec(value)
  if (!nested) return value
  if (seen.has(nested[1])) throw new Error(`Циклическая ссылка на токен ${nested[1]}`)
  return resolve(tokens[nested[1]], tokens, new Set([...seen, nested[1]]))
}

const toRgb = (hex: string): number[] => {
  const raw = hex.replace('#', '')
  const full = raw.length === 3 ? [...raw].map((c) => c + c).join('') : raw
  return full.match(/../g)!.map((pair) => parseInt(pair, 16))
}

const luminance = (hex: string): number => {
  const channels = toRgb(hex).map((value) => value / 255).map((value) => (value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4))
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2]
}

const contrast = (foreground: string, background: string): number => {
  const values = [luminance(foreground), luminance(background)].sort((a, b) => b - a)
  return (values[0] + 0.05) / (values[1] + 0.05)
}

const themes = [
  { name: 'светлая', tokens: tokensOf(':root') },
  { name: 'тёмная', tokens: tokensOf(":root[data-theme='dark']") },
]

describe('контраст токенов', () => {
  it.each(themes)('$name тема: пары, несущие текст, проходят AA 4.5:1', ({ tokens }) => {
    const pairs: Array<[string, string]> = [
      ['--text', '--canvas'],
      ['--text', '--surface'],
      ['--text', '--surface-raised'],
      ['--text-muted', '--canvas'],
      ['--text-muted', '--surface'],
      ['--text-muted', '--surface-raised'],
      ['--text-faint', '--canvas'],
      ['--text-faint', '--surface'],
      ['--text-faint', '--surface-raised'],
      ['--heading', '--canvas'],
      ['--heading', '--surface'],
      ['--accent', '--canvas'],
      ['--on-accent', '--accent'],
      ['--on-accent', '--accent-hover'],
      ['--on-error', '--error'],
      ['--on-error', '--error-hover'],
      ['--on-service', '--service'],
      ['--on-ok', '--ok'],
      // The catalogue's "not confirmed" chip: dark text on a warning tint, so the flag stays
      // readable over its row and over the row's hover fill alike.
      ['--text', '--warning-soft'],
    ]

    const failures = pairs.flatMap(([foreground, background]) => {
      const ratio = contrast(resolve(tokens[foreground], tokens), resolve(tokens[background], tokens))
      return ratio >= 4.5 ? [] : [`${foreground} на ${background}: ${ratio.toFixed(2)}:1`]
    })

    expect(failures, `не проходит порог 4.5:1 — ${failures.join('; ')}`).toEqual([])
  })

  it('печатные цвета намеренно чёрно-белые и не следуют за темой', () => {
    // The print stylesheet overrides the theme on purpose, so `#fff` and `#111` must survive there.
    const print = blockFor('@media print')
    expect(print).toContain('#fff')
    expect(print).toContain('#111')
  })
})

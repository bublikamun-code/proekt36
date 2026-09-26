import { describe, expect, it } from 'vitest'
import { plans } from '../src/content/plans'

 describe('preliminary subscription plans', () => {
  it('keeps plan ids unique and prices in one content module', () => {
    expect(new Set(plans.map((plan) => plan.id)).size).toBe(plans.length)
    expect(plans.map((plan) => plan.price)).toEqual(['0 ₽', '990 ₽', '2 490 ₽'])
    expect(plans.every((plan) => plan.cta.length > 0)).toBe(true)
  })
})

/**
 * Russian plural forms for the two nouns this application counts in user-facing text.
 *
 * A count next to a noun is the one place where a wrong form cannot be missed: «2 модели» and
 * «5 модель» are not subtle. The rules are the ordinary ones — 1, 2-4, 5-20, with 11-14 as a
 * separate case that a naive `n % 10` gets wrong, which is exactly how «11 моделей» becomes
 * «11 модель».
 *
 * They live in the domain rather than in a component because two different views print both words.
 */
export const projectWord = (count: number) => {
  const mod100 = count % 100
  const mod10 = count % 10
  if (mod100 >= 11 && mod100 <= 14) return 'проектов'
  if (mod10 === 1) return 'проект'
  if (mod10 >= 2 && mod10 <= 4) return 'проекта'
  return 'проектов'
}

export const modelWord = (count: number) => {
  const mod100 = count % 100
  const mod10 = count % 10
  if (mod100 >= 11 && mod100 <= 14) return 'моделей'
  if (mod10 === 1) return 'модель'
  if (mod10 >= 2 && mod10 <= 4) return 'модели'
  return 'моделей'
}
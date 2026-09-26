export type Plan = {
  id: 'start' | 'pro' | 'team'
  name: string
  price: string
  period: string
  note: string
  features: string[]
  cta: string
  to: string
  featured?: boolean
}

export const plans: Plan[] = [
  {
    id: 'start',
    name: 'Старт',
    price: '0 ₽',
    period: 'навсегда',
    note: 'Локальный режим',
    features: ['2D-компоновка щита', 'Каталог и спецификация', 'JSON import/export', 'Данные в этом браузере'],
    cta: 'Открыть бесплатно',
    to: '/demo/project',
  },
  {
    id: 'pro',
    name: 'Про',
    price: '990 ₽',
    period: 'в месяц',
    note: 'Планируется после подключения синхронизации',
    features: ['Всё из «Старта»', 'Синхронизация проектов', 'История изменений', 'Расширенный экспорт'],
    cta: 'Посмотреть возможности',
    to: '/features',
    featured: true,
  },
  {
    id: 'team',
    name: 'Команда',
    price: '2 490 ₽',
    period: 'в месяц',
    note: 'Планируется для совместной работы',
    features: ['Всё из «Про»', 'Общие рабочие проекты', 'Роли и доступы', 'Поддержка команды'],
    cta: 'Посмотреть возможности',
    to: '/features',
  },
]

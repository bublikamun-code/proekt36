export type PageMetadata = {
  title: string
  description: string
  robots: 'index,follow' | 'noindex,nofollow'
  public: boolean
}

export const pageMetadata: Record<string, PageMetadata> = {
  home: {
    title: 'Панель 36 — конфигуратор распределительных щитов',
    description: 'Собирайте физически осмысленные 2D-схемы электрощитов, проверяйте размещение модулей и выгружайте спецификацию в браузере.',
    robots: 'index,follow',
    public: true,
  },
  features: {
    title: 'Возможности — Панель 36',
    description: 'Корпуса, рейки, 2D-раскладка, каталог, цепи, BOM и предварительные проверки в одном браузерном конфигураторе щита.',
    robots: 'index,follow',
    public: true,
  },
  pricing: {
    title: 'Тарифы — Панель 36',
    description: 'Предварительные тарифы браузерного конфигуратора электрощитов. Оплата и серверная синхронизация пока не подключены.',
    robots: 'index,follow',
    public: true,
  },
  demo: {
    title: 'DEMO-конфигуратор — Панель 36',
    description: 'Посмотрите интерактивный DEMO-макет 2D-конфигуратора распределительного щита и откройте отдельную ограниченную страницу проекта.',
    robots: 'index,follow',
    public: true,
  },
  'demo-project': {
    title: 'DEMO-проект — Панель 36',
    description: 'Ограниченный предварительный просмотр 2D-проекта распределительного щита без аккаунта и изменения данных.',
    robots: 'noindex,nofollow',
    public: false,
  },
  privacy: {
    title: 'Конфиденциальность — Панель 36',
    description: 'Как предварительная браузерная версия Панель 36 хранит проекты, тему, demo-сессию и импортированные модели.',
    robots: 'index,follow',
    public: true,
  },
  terms: {
    title: 'Условия использования — Панель 36',
    description: 'Условия предварительной версии Панель 36 и статус предварительных расчётов и проверок.',
    robots: 'index,follow',
    public: true,
  },
  login: {
    title: 'Вход — Панель 36',
    description: 'Локальный демо-вход в рабочую область Панель 36.',
    robots: 'noindex,nofollow',
    public: false,
  },
  register: {
    title: 'Регистрация — Панель 36',
    description: 'Локальная демо-регистрация в Панель 36.',
    robots: 'noindex,nofollow',
    public: false,
  },
  projects: {
    title: 'Проекты — Панель 36',
    description: 'Локальная рабочая область Панель 36.',
    robots: 'noindex,nofollow',
    public: false,
  },
  editor: {
    title: 'Конфигуратор щита — Панель 36',
    description: '2D-компоновка распределительного щита в Панель 36.',
    robots: 'noindex,nofollow',
    public: false,
  },
  'current-editor': {
    title: 'Конфигуратор щита — Панель 36',
    description: '2D-компоновка распределительного щита в Панель 36.',
    robots: 'noindex,nofollow',
    public: false,
  },
  notFound: {
    title: 'Страница не найдена — Панель 36',
    description: 'Запрошенная страница Панель 36 не найдена.',
    robots: 'noindex,nofollow',
    public: false,
  },
}

const setMeta = (selector: string, attribute: 'name' | 'property', key: string, content: string) => {
  let element = document.head.querySelector<HTMLMetaElement>(selector)
  if (!element) {
    element = document.createElement('meta')
    element.setAttribute(attribute, key)
    document.head.append(element)
  }
  element.content = content
}

export const applyPageMetadata = (metadata: PageMetadata) => {
  document.title = metadata.title
  setMeta('meta[name="description"]', 'name', 'description', metadata.description)
  setMeta('meta[name="robots"]', 'name', 'robots', metadata.robots)
  setMeta('meta[property="og:title"]', 'property', 'og:title', metadata.title)
  setMeta('meta[property="og:description"]', 'property', 'og:description', metadata.description)
  // Every page in this app is a website page; nothing here is an article or a video.
  setMeta('meta[property="og:type"]', 'property', 'og:type', 'website')
  setMeta('meta[name="twitter:card"]', 'name', 'twitter:card', 'summary')
  setMeta('meta[name="twitter:title"]', 'name', 'twitter:title', metadata.title)
  setMeta('meta[name="twitter:description"]', 'name', 'twitter:description', metadata.description)

  const siteUrl = import.meta.env.VITE_SITE_URL || window.location.origin
  let canonical = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]')
  if (!canonical) {
    canonical = document.createElement('link')
    canonical.rel = 'canonical'
    document.head.append(canonical)
  }
  canonical.href = new URL(window.location.pathname, siteUrl).toString()

  const script = document.head.querySelector<HTMLScriptElement>('script[data-panel36-schema]')
  if (metadata.public) {
    const structuredData = {
      '@context': 'https://schema.org',
      '@type': 'SoftwareApplication',
      name: 'Панель 36',
      applicationCategory: 'BusinessApplication',
      operatingSystem: 'Web',
      description: metadata.description,
    }
    if (script) {
      script.textContent = JSON.stringify(structuredData)
    } else {
      const element = document.createElement('script')
      element.type = 'application/ld+json'
      element.dataset.panel36Schema = 'true'
      element.textContent = JSON.stringify(structuredData)
      document.head.append(element)
    }
  } else {
    script?.remove()
  }
}

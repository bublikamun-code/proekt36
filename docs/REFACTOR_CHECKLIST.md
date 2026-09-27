# Чек-лист остатка рефакторинга: каталог → JSON и багфиксы

Этот документ — самодостаточная инструкция. Контекст беседы не нужен: все якоря — файлы и
символы в текущем коде. Выполнять блоки по порядку, внутри блока — пункт за пунктом.

## Контекст: что уже сделано (не ломать)

Рефакторинг моделей устройств уже выполнен (коммиты `89b6bea`, `b95e687`, `7590a90`):

- Товар каталога (`DeviceDefinition`) и CAD-модель (`ModelAsset`) — отдельные сущности.
  Связь: `DeviceDefinition.modelId`. Привязки моделей к встроенным товарам —
  `StoredModelLibrary.bindings` (`src/domain/types.ts`).
- Хранилище: `panel36.models.v2` (`{ assets, products, bindings }`), бинарники и миниатюры —
  в IndexedDB (`src/storage/modelDb.ts`, запись `{ data, thumbnail? }`). Миграция v1→v2
  без потерь уже написана и покрыта тестами (`tests/storage-repository.test.ts`) —
  **код миграции не трогать**.
- Рендер: один offscreen WebGL-рендерер отдаёт растровые миниатюры
  (`src/services/modelRender.ts`); живой канвас — только в инспекторе (`ModelPreview.vue`).
- Импорт: диалог нормализации (масштаб/поворот/габариты), обновление существующего ассета
  «на месте» по совпадению имени файла и размера, опциональная товар-заготовка,
  замена товара у устройства без товара, сверка ассетов с IndexedDB при старте
  (`reconcileModelAssets` в `src/stores/project.ts`).

## Правила работы

1. Каждый пункт/багфикс — отдельный коммит. Сообщение — русский императив, как в `git log`
   (пример: «Сверять нагрузку по фазам с вводным номиналом…»).
2. После каждого пункта: `npm run typecheck && npm test`. Затронут e2e — прогнать конкретный
   спек: `npx playwright test tests/e2e/<spec>.spec.ts`.
3. Финал каждого блока и всей работы: `npm run verify` (typecheck + vitest + e2e + preview).
4. Тесты не ослаблять: никаких `.skip`, таймаут-повышений и удаления ассертов. Ассерты можно
   только уточнять под новое осознанное поведение.
5. Ничего не удалять из `public/models/`. Перед удалением «мёртвого» кода — `grep -rn` по
   всему репозиторию, включая `tests/`.

---

## Блок A — каталог как данные (JSON вместо кода)

Сейчас весь каталог (39 builtin + 344 ENMAS + 2 sample) генерируется кодом в
`src/data/catalog.ts` при импорте модуля.

- **A1. Структура.** Создать каталог `src/data/catalog/`:
  - `builtin.json` — 39 записей из `builtinCatalog` (поля = `DeviceDefinition`);
  - `sample.json` — 2 записи City9 (у `city9-mcb-2p-c16` поле `modelId: "city9-mcb-2p"`);
  - `enmas.generated.json` — результат работы генератора (A2); файл коммитится в репозиторий;
  - `schema.ts` — рантайм-валидатор записи (id/имена — непустые строки; category из
    `DEVICE_CATEGORIES`; moduleWidth 0.5–24; poles 1–12; числа конечны; voltage 230|400;
    bus L/N/PE). Валидировать при загрузке в dev-режиме (`import.meta.env.DEV`), в prod —
    только `import json` с типизацией;
  - `index.ts` — те же экспорты, что даёт сейчас `src/data/catalog.ts`
    (`builtinCatalog`, `enmasSeriesCatalog`, `sampleCatalog`, `allCatalog`,
    `categoryLabels`, `CATALOG_REVISION`). Удалить старый `src/data/catalog.ts` — все
    импорты `'../data/catalog'` продолжат разрешаться в `catalog/index.ts`.
- **A2. Генератор ENMAS.** `tools/generate-enmas.mjs`: перенести комбинаторику (NB1-63H,
  NL1, NB1L, NB310L, NJVA1, FORK, NU6-IIG, клеммы, БП) из `catalog.ts` и писать
  `enmas.generated.json`. Скрипты в `package.json`: `catalog:generate` и `catalog:check`
  (check = regenerate во временный файл и сравнить с закоммиченным; расхождение — ошибка).
- **A3. Фиксы данных при переносе:**
  - ENMAS: `sku` сейчас равно имени серии (`NB1-63H` у 156 товаров) — сделать полным
    обозначением, например `NB1-63H-2P-C16` (собирается из тех же параметров, что и `name`);
  - `src/data/catalog.ts:132` — мёртвый тернарник `poles === 1 ? 2 : 2` (всегда 2):
    в генераторе оставить просто `2`;
  - счётчики (6 модулей) и БП: `height`/`depth` сейчас 82–90/70 — оставить как есть, если
    нет данных получше (не выдумывать).
- **A4.** Bump `CATALOG_REVISION` (строка-дата в `catalog/index.ts`; реэкспорт в
  `src/domain/projectSchema.ts` не менять).
- **A5. Тест консистентности** `tests/catalog-data.test.ts`: уникальность `id`; уникальность
  пары `(brand, sku)`; категории из `DEVICE_CATEGORIES`; `moduleWidth`/`poles` в диапазонах;
  `verificationStatus` только из допустимых; количество записей ≥ 380; `sampleCatalog` не
  пересекается с ENMAS по id.
- **Проверка блока:** `npm run typecheck && npm test && npm run catalog:check`; затем
  `npm run test:e2e` — особенно `catalog-verification`, `editor-2d`, `validation`,
  `device-face` (тесты итерируют `allCatalog` и завязаны на имена/серии ENMAS — при смене sku
  обновить точные строки-ассерты через `grep -rn "NB1-63H" tests/`).

## Блок B — багфиксы (каждый отдельным коммитом)

- **B1. Пресеты берут тестовый City9.** `src/stores/project.ts`, `applyPreset` (строка ~306):
  `new Map(products.map((item) => [item.category, item]))` оставляет ПОСЛЕДНИЙ товар
  категории, а `sampleCatalog` (City9, «тестовый образец») идёт после ENMAS и фильтр
  `!item.imported` его не отсекает. Итог: во всех пресетах автомат = City9. Фикс: выбирать
  ПЕРВЫЙ подходящий товар категории с `verificationStatus !== 'template'` (это отсечёт и
  City9, и ENMAS-шаблоны), first-wins. Новый unit-тест (например `tests/presets.test.ts`):
  для каждого пресета ни один выбранный товар не `city9-*` и не `template`.
- **B2. Seed-проект теряет геометрию корпуса.** `src/stores/project.ts:42` (`seedProject`):
  литерал `project.settings = { inputCurrent: 40, ... }` затирает `cabinetId`/`railId`,
  которые выставил `createProject` (пресет `apartment` = `enmas-nx8-24-embedded` + `rail-12`),
  и деградирует до legacy-геометрии (29 модулей/ряд, шаг 17.5 мм вместо 12 модулей/18 мм).
  Фикс: `{ ...project.settings, inputCurrent: 40, phase: 1, rows: 9, reserveModules: 8 }`
  без затирания корпусных полей и размеров кабинета. ОСТОРОЖНО: ёмкость ряда меняется с 29
  на 12 — 9 устройств сида (15 модулей) перераспределятся по рядам; проверь
  `tests/e2e/editor-reload.spec.ts` (сидирует проект и ждёт устройства),
  `panel-geometry.spec.ts` (шаг 18 мм) и при необходимости подгони seed-набор.
- **B3. Одиночный экспорт отклоняет старые ревизии каталога.** `src/domain/projectFile.ts`,
  строки 92, 99, 107: `... !== DOMAIN_CATALOG_REVISION` — строгая проверка отклоняет любой
  файл, экспортированный до bump'а ревизии, вопреки собственному комментарию в строках
  89–90 («A file written against an older catalogue is still readable») и поведению
  backup-пути (`src/domain/projectBackup.ts:95-98`, там future-only). Фикс: заменить все
  три условия на паттерн из projectBackup: ошибкой считать только
  `isFutureRevision(...)`, плюс `!isKnownRevision(...)`. Тест в
  `tests/project-file.test.ts` по образцу `tests/project-backup.test.ts:56-67`
  (старая ревизия читается, будущая — нет).
- **B4. BOM молча теряет устройства без товара.** `src/domain/pricing.ts:9`:
  `if (!product) continue` — после пропадания товара из каталога позиции тихо исчезают из
  BOM и суммы/веса занижаются. Фикс: включать такую позицию строкой с
  `name = productId` (или «нет в каталоге»), `priceStatus: 'unknown'`, `weight: 0`,
  количество сохраняется. Unit-тест в `tests/pricing.test.ts`.
- **B5. Снапшот каталога пишется в экспорт дважды.** `src/domain/projectFile.ts`,
  `createProjectFileEnvelope` (строки ~52–68): `catalogSnapshot` и `catalog.snapshot` (+
  `catalogManifest` и `catalog.manifest`) дублируют одни и те же ~385 записей, и
  `validateEnvelope` (строки 100–101) требует их поэлементного равенства. Фикс: писать только
  вложенные `catalog.snapshot`/`catalog.manifest`; при чтении, если вложенного нет, но есть
  плоский `catalogSnapshot`/`catalogManifest` (старый файл) — использовать их. Тип конверта
  обновить; старые файлы обязаны читаться (тест).
- **B6. Три разные лестницы verification-лейблов.** Создать `src/domain/verification.ts`
  с единственной функцией `verificationLabel(product: Pick<DeviceDefinition,
  'verificationStatus' | 'imported'>): string` (ветки: verified → «Подтверждено»;
  imported → «Импорт, не проверено»; template → «Шаблон»; legacy → «Исторические данные»;
  иначе → «Статус не указан»). Заменить локальные реализации:
  `src/components/catalog/CatalogPanel.vue:82`, `src/components/bom/BomPanel.vue:19`,
  `src/components/ui/ProjectPrintReport.vue:26` (у печати сейчас `undefined` → «старые
  данные», т.е. импорт в печатном отчёте помечается как «исторические данные» — это баг).
  Проверить `tests/e2e/catalog-verification.spec.ts` и `preproduction-ui.spec.ts` —
  точные строки лейблов там захардкожены.
- **B7. Документация врёт про restore.** `README.md:159` («restore отклонит такую копию») и
  `docs/PREPRODUCTION_RUNBOOK.md:74` («восстановление блокируется») — на самом деле
  `readWorkspaceBackup` восстанавливает с предупреждением и списком `pendingLocalCad`
  (см. комментарий в `src/domain/projectBackup.ts:123-125`). Поправить формулировки.
- **B8. Двойное округление зума.** `src/stores/preferences.ts:51` округляет до 0.01,
  `src/components/editor/Editor2D.vue:102` `clampScale` — до 0.1, и `changeZoom` (строка 104)
  идёт через clampScale, после чего стор пере-округляет. Фикс: округление только в
  `setBoardZoom`; `clampScale` — только clamp без округления. Проверить
  `tests/e2e/editor-zoom.spec.ts`.
- **B9. Глобальное проглатывание клика после drag.** `src/composables/useBoardDrag.ts`
  (строки 22, 48–49, 93–99): флаг `swallowClick` + постоянный capture-слушатель click на
  `window` глотает первый клик после дропа ВЕЗДЕ, включая кнопки вне доски. Фикс: проглатывать
  только клики, начавшиеся в пределах области доски (например, проверять
  `event.target` принадлежит `.board-canvas`/`.din-row`, или вешать/снимать слушатель
  динамически на момент дропа). Проверить `tests/e2e/device-drag.spec.ts`.
- **B10. Номинал выше вводного проверяется только у автоматов.**
  `src/domain/validation.ts:42`: условие `product.category === 'MCB'`. Расширить на
  `'RCCB' | 'RCBO'` (остаётся warning). SPD не трогать (номинал УЗИП — пропускная
  способность, выше вводного — норма). Обновить `tests/validation.test.ts`.
- **B11. Мёртвый код** (перед каждым удалением — `grep -rn` по `src/` и `tests/`):
  `src/domain/project.ts:187` (`demoProductIds`), `src/data/catalog.ts` / новый
  `catalog/index.ts` (`catalogCategories`), `src/storage/modelImport.ts:168` (`utf8Size`),
  `src/domain/layout.ts:21` (`getDeviceFootprint`), пустая директория
  `src/components/viewer3d/`.

Осознанно НЕ менять: отсутствие `verificationStatus` у builtin-каталога — это задокументированное
решение (см. комментарий в `CatalogPanel.verificationLabel` и коммит `58ac1ae`); фильтр
«Только проверенные» их исключает — зафиксировать это юнит-тестом при переходе на общий
лейбл (B6).

## Блок C — финал

1. `grep -rn "modelPreviewUrl\|modelAssetId\|ModelMetadata" src/ tests/` — должен быть пуст
   (наследие старой модели; если нашлось — это регрессия).
2. `npm run verify` — полностью зелёный (typecheck, vitest, e2e, preview-смоук).
3. Обновить `CHANGELOG.md` по образцу существующих записей.
4. Итоговые коммиты — по одному на пункт, `git log` должен читаться как список действий.

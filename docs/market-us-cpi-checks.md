# Проверки CPI / Core CPI

База — main `65342d2d48ecbf367f497c0dcb98ebe94747f748`. Итоговые статусы полного CI — в Draft PR.

## Locale: проверка до изменений CPI

Известное падение main CI 42083733107: `Expected: "en"`, `Received: "ru"` в
`Language and sessions settings follow the account > the language chosen on the laptop comes to the phone; changed on the phone → back on the laptop`.

Повтор локально на неизменённой базе:
`npx playwright test -c playwright.supabase.config.ts sync-sessions-locale.spec.ts --grep "the language chosen"`.
Первый запуск остановился до теста:
```text
Error: EPERM: operation not permitted, mkdir 'C:\Users\malki\Documents\ayra_trading\.next-e2e-supabase\static\chunks\app'
Error: next build exited with 1
Error: Process from config.webServer was not able to start. Exit code: 1
```
Повтор с локальным Next dev и тем же fake Supabase:
```text
Test timeout of 150000ms exceeded.
Error: page.goto: net::ERR_ABORTED at http://localhost:3001/settings/interface
```
Строка теста 46 — переход в interface, до клика English. Это **не** воспроизведение исходного locale assertion.
Сервер остановился на компиляции `/settings/[section]`; другой раздел ради этого PR не менялся.
### Подтверждённая причина locale (06.11.2026)

Полный локальный production e2e затем прошёл исходный locale-тест. Отдельная диагностическая копия
того же сценария с записью profile requests тоже PASS. После добавления только двухсекундного ожидания
завершения первоначального обмена перед первым выбором English ошибка воспроизведена:
```text
Error: expect(received).toBe(expected) // Object.is equality
Expected: "en"
Received: "ru"
- Timeout 20000ms exceeded while waiting on the predicate
```
В браузере `ayra_lang=en`, HTML `lang=en`, в облаке locale остаётся `ru`; запрос PATCH locale после
клика отсутствует. Состояние `ayra_locale_sync` отсутствует и до, и после клика. Код приложения не менялся.

Причина в существующей цепочке `ProfileTimezoneSync` / `profile-timezone.ts`:
1. Пока язык не выбран, `localLang=null`, облако содержит default ru, synced=null.
   `decideLocale` возвращает none. `settle` сохраняет baseline только при truthy mine, поэтому baseline не записан.
2. При первом выборе English эффект выставляет dirty только если synced!==null. Условие ложно.
3. Автоматический эффект запускает exchange только при dirty; PATCH locale не отправляется.
4. Если около клика успевает завершиться новый обмен журнала, он независимо вызывает exchange и отправляет en.
   В PASS-трассе `lastSyncAt` меняется около клика; в FAIL-трассе остаётся прежним. Это объясняет timing-зависимость.

Ранее предполагавшийся running-guard race не нужен для объяснения этого воспроизведения.
Диагностические сценарии остались локальными scratch-файлами; locale/auth/journal не входят в diff.
Исправление первой синхронизации языка требует отдельного разрешённого этапа, не относится к CPI.

## Сборка

`npm run build` в песочнице:
```text
Error: EPERM: operation not permitted, mkdir 'C:\Users\malki\Documents\ayra_trading\.next\server\app\auth'
> Build failed because of webpack errors
```
Повтор той же команды после разрешения выполнения вне песочницы — PASS, без исправления кода сборки.

## Промежуточные ошибки новых тестов

- `npx tsc --noEmit`:
  `lib/market/feeds/cpi-db.test.ts(25,12): error TS2571: Object is of type 'unknown'.`
  Добавлен тип результата PGlite query, без `any`. Повтор PASS.
- `npx vitest run lib/market/feeds/cpi.test.ts`,
  `CPI dated BLS release > reads four explicitly published changes, their period and release vintage from the real archive`:
  Различие из вывода Vitest: `- "previous": null`, `+ "previous": "3.4%"` при `actual: "3.7%"`.
  Ожидание обновлено после добавления строгого чтения явно опубликованного previous г/г.
- `npx vitest run lib/market/feeds/cpi.test.ts lib/market/feeds/cpi-db.test.ts`,
  `CPI dated BLS release > uses only a proven adjacent release for missing annual previous, never an unversioned legacy figure`:
  `AssertionError: expected undefined to be '2.1%' // Object.is equality`.
  Причина — memory seed выставляет `scheduled` независимо от переданного status. Fixture теперь явно
  устанавливает прошлым событиям `released`, как в реальной БД. Код приложения для этого не менялся.

Полные unit и миграционные тесты, TypeScript, lint, build и browser suites запускаются перед завершением.
Lint предупреждения в login/journal и React act warnings существующих unit не исправляются в этом PR.

## Browser: связанные ожидания названия CPI

Первый полный `npx playwright test -c playwright.supabase.config.ts` выявил три старых ожидания:
`Market — «Today important» and official news > 1440: Overview — the nearest event with a countdown; today's important items by time; trust mark, source, status`,
тот же тест для `360`, и
`«Today important» is on the Overview only (owner 2026-11-04): the Calendar opens on the world calendar without it`.
Во всех трёх:
```text
Error: expect(locator).toHaveText(expected) failed
Expected: "Индекс потребительских цен (CPI)"
Received: "CPI, м/м"
Timeout:  5000ms
```
Обновлены только связанные с CPI текстовые ожидания теста, без изменения Overview/новостей приложения.

## Итог локальных проверок

- TypeScript и lint PASS (существующие lint warnings сохранены).
- Build PASS вне песочницы. Unit: 96 файлов, 774 теста PASS. Source tests: 130 PASS.
- `node scripts/test-migrations.mjs`: A–L PASS, включая повторное применение0012 и старые дубли/значения.
- Полный fake-Supabase прогон: 99 PASS / 9 FAIL. Три связанных CPI-ожидания исправлены выше.
- Остальные шесть FAIL — отсутствующий локальный WebKit:
  `Error: browserType.launch: Executable doesn't exist at C:\Users\malki\Documents\Codex\work\playwright\webkit-2359\Playwright.exe`.
  Точные тесты:
  - `Number of screenshots follows deletions on another device > webkit: deleted on the phone in the trade card → the laptop's list shows the live number`
  - `Number of screenshots follows deletions on another device > webkit: deleted on the phone in the edit form, closed WITHOUT saving → the laptop's list shows the live number`
  - `Number of screenshots follows deletions on another device > webkit: the trade still lists a screenshot deleted elsewhere (its own update waits, e.g. a conflict) → the list counts only live screenshots`
  - `0005-C: old screenshots go up; the cloud folder is cleaned once a day > webkit: old screenshots upload with progress, «Stop» holds, «Continue» finishes`
  - `0005-C: old screenshots go up; the cloud folder is cleaned once a day > webkit: daily cleanup removes only what the rules allow`
  - `Screenshots in the cloud on WebKit (0005-B) > added on desktop Chromium → on a WebKit phone the preview and the full picture are drawn, also after a reload`.
- Повтор связанных browser suites:
  `npx playwright test -c playwright.supabase.config.ts market-own-calendar.spec.ts market-today-news.spec.ts`:
  **28 PASS**, включая новые четыре CPI сценария RU/EN × 1440/360 и отсутствие overflow.
- Оба полных browser набора выполняются в Linux CI с установленным WebKit. Их итог и ссылку на run
  фиксируем в PR; отсутствие локального браузера не выдаётся за зелёный полный локальный e2e.

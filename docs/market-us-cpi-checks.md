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
Чтение `ProfileTimezoneSync` выявляет возможный race: вызов exchange во время running пропускается,
повтор после завершения не ставится в очередь. Это гипотеза, не доказанная причина прежнего CI падения.
Сам locale/auth/journal-код не входит в diff CPI; исходная ошибка существовала до этой ветки.

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

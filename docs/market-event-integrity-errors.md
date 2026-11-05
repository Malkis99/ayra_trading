# Журнал проверок календаря

Промежуточные неуспешные проверки сохранены; итоговый статус CI находится в Draft PR.

## Миграции

Команда: `node scripts/test-migrations.mjs`.
Первый запуск секции L остановился до применения0012:
```text
error: cannot insert multiple commands into a prepared statement
```
Причина: новый тест использовал PGlite `query()` для preflight из нескольких SELECT. Исправлено на
`exec()` с сравнением всех результатов. Следующий запуск A–L PASS; миграция не исправляла production.

## TypeScript

Команда: `npx tsc --noEmit`.
```text
lib/market/feeds/memory-db.ts(65,229): error TS2367: This comparison appears to be unintentional because the types '"released" | "scheduled"' and '"cancelled"' have no overlap.
```
Исправлено: состояние восстановления вычисляется отдельно от проверки cancelled (control-flow narrowing).
Повтор PASS.

При добавлении browser-сценария та же команда typecheck обнаружила:
```text
e2e-supabase/market-own-calendar.spec.ts(122,48): error TS2339: Property 'id' does not exist on type '{ kind: string; code: null; country: string; importance: number; time_tbd: boolean; status: string; actual: null; previous: null; hidden: boolean; updated_at: string; }'.
```
Исправлено явным Record<string,unknown> для существующего динамического fixture, без any и без изменения данных.

## Первые source-тесты после расширения контракта

Команда: `npx vitest run lib/market/feeds` — 9 failed /94 passed. Точные названия и сообщения:

| Тест | Текст ошибки | Исправление |
|---|---|---|
| `Eurostat's release calendar (iCal, Euro indicators) > all-day entries are read with their day; the timed reader leaves them out` | `AssertionError: expected [ { …(3) }, …(8) ] to deep equally contain { …(2) }` | Проверка сохраняет day/summary и учитывает теперь возвращаемый UID |
| `Eurostat's release calendar (iCal, Euro indicators) > our five releases at 11:00 Luxembourg time in UTC (10:00 in winter, 09:00 in summer); the rest left out` | `AssertionError: expected [ [ …(3) ], [ …(3) ], [ …(3) ], …(2) ] to deeply equal [ [ …(3) ], [ …(3) ], [ …(3) ], …(3) ]` | Старый fixture повторял один UID для всех дат. У каждого отдельного release теперь отдельный synthetic UID; отдельные тесты проверяют версии одного UID |
| `Eurostat figures (dissemination API, JSON-stat) > a figure once the dataset was updated with the release: rates as they are, changes with a sign` | `AssertionError: expected { …(6) } to deeply equal { …(5) }` | Учитывается новый result_meta; GDP preliminary теперь сознательно null до доказательства vintage |
| `the collector and Eurostat > schedules: the iCal becomes calendar rows; logged as «eurostat-schedule»` | `AssertionError: expected { source: 'eurostat-schedule', …(5) } to match object { ok: true, items: 6 } (4 matching properties omitted from actual)` | Тот же повторённый UID в fixture; проверено сохранение шести самостоятельных событий |
| `sources: importance and noise > BEA: each release is news, and its figure goes to the calendar event` | `AssertionError: expected [ { …(8) } ] to deeply equal [ { …(5) } ]` | Контракт теперь включает reference_period/release_stage/result_meta, news-ожидания сохранены |
| `BLS figures from the official API > payrolls change and the unemployment rate, CPI month over month; nothing before the reference month is out` | `AssertionError: expected [ { …(6) }, { …(6) }, { …(6) } ] to deeply equal [ { …(5) }, { …(5) }, { …(5) } ]` | Старые ожидаемые цифры сохранены; новые provenance поля проверяются отдельными сценариями |
| `«previous» before the release > BEA: the stored release's figure passes to the next one of the same indicator` | `AssertionError: expected { id: 'bea:us_pce:2026-10-29', …(10) } to match object { status: 'released', actual: '+0.2%' } (10 matching properties omitted from actual)` | Fixture получил явные периоды/стадии; previous проверяется после daily schedules, без stage-to-stage carry |
| `EIA figures > the week's change and the one before: crude in million barrels, gas in Bcf` | `AssertionError: expected { …(6) } to deeply equal { …(5) }` | Учитывается result_meta; ожидаемые реальные по fixture изменения не менялись |
| `the collector asks EIA, Census and DOL only around their releases > DOL: Thursday after 8:30 the release is read and its figure saved` | `AssertionError: expected { source: 'dol-claims', …(3) } to match object { ok: true, items: 1 } (2 matching properties omitted from actual)` | Добавлен отсутствовавший DOL provenance по явно указанной неделе и embargo Eastern Time |

После этих исправлений все103 существующих source-теста прошли. Следующий запуск с новыми сценариями
также прошёл. JSON reporter сохранял точные assertion messages; сокращения `…` выше — часть вывода Vitest.

## Полный unit

Команда: `npx vitest run --reporter=json --outputFile=<local report>` — 1 failed /762 passed:
```text
«previous» before the release > the daily schedules run fills «previous» of every indicator's next release from what the sources publish now
expected { id: 'bls:us_nfp:2026-11-06', …(16) } to match object { previous: '+29K · 4.2%' }
(17 matching properties omitted from actual)
```
Исправлено ожидание: предыдущий payrolls change — `+29K`, без смешивания с текущей unemployment rate.
В опубликованном actual сочетание payrolls/unemployment не менялось. Повтор полного набора763/763 PASS.

## Build

Команда: `npm run build` на Windows:
```text
Error: EPERM: operation not permitted, mkdir 'C:\Users\malki\Documents\Codex\work\ayra147\.next\static\chunks\app\settings\[section]'
> Build failed because of webpack errors
```
Без изменений конфигурации/зависимостей сборка и полный e2e проверяются на Linux CI.

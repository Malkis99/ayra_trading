# Журнал проверок PPI

Итог полного CI и серверные ограничения находятся в Draft PR и `market-us-ppi.md`.

## Реальная сеть

Node fetch с User-Agent проекта к BLS PPI schedule/archive/ICS: HTTP403 Access Denied, Content-Type text/html,
1323 символа, Last-Modified отсутствует. Блокировка не выдаётся за ошибку JSON/parser или нехватку API Key.
OMB2027 PDF и официальная копия BLS-релиза на DOL: HTTP200, проверены PDF signatures и доступность текста.
Никакой обход/прокси, production collector, cron, миграция или изменение env не выполнялись.

## Промежуточные тестовые ошибки

Команда: `npx vitest run lib/market/feeds` — первый запуск3FAIL/135PASS:

1. `the collector > schedules: the listed FOMC / ECB / BLS events and BEA's .ics; every run is logged`:
   `AssertionError: expected [ [ 'schedules-listed', true ], …(4) ] to deeply equal [ [ 'schedules-listed', true ], …(3) ]`.
   Вывод diff добавляет `["bls-ppi-schedule", false]`: старый fixture сети не содержит новый официальный URL.
   Ожидание журнала расширено; ошибка источника в fixture остаётся явной, остальные schedules проверяются.
2. `«previous» before the release > the daily schedules run fills «previous» of every indicator's next release from what the sources publish now`:
   `AssertionError: expected '2 set; Census: Census API us_retail_s…' to match /^3 set; /`.
   PPI намеренно больше не заполняется latest API. Ожидание изменено на2, NFP/JOLTS сохраняются.
3. `«previous» before the release > each source's latest figure: BLS, EIA, Census (the month before the release), Eurostat (GDP twice a quarter)`:
   `AssertionError: expected Map{ 'us_nfp' => '+29K · 4.2%', …(1) } to deeply equal Map{ 'us_nfp' => '+29K · 4.2%', …(2) }`.
   Удалено прежнее ожидание API PPI +1.3%; его новый релизный путь проверяется отдельно.

Следующий запуск1FAIL/141PASS:
`PPI published release > a reviewed cancellation/restoration affects all four indicators without changing identities`:
```text
Error: calendar conflict: schedule freshness unproven
```
Fixture ошибочно применял reviewed-list SEQUENCE к записи без baseline SEQUENCE. Тест теперь явно
использует исходный reviewed-list baseline0. Защита0012 не ослаблялась; отдельный тест подтверждает отказ
неверсионированному переносу и сохранение старой даты. Повтор source suite:144/144PASS.

Названия/числа выше — промежуточные результаты; окончательные количества после всех добавлений — в PR.
TypeScript, lint, build, полный Vitest, миграции A–L и оба e2e набора запускаются перед завершением.
Существующие посторонние предупреждения и flaky-падения не исправляются изменением других разделов.

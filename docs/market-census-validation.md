# Census: диагностика и ограничение доступа

Дата: 2026-11-05. Ветка `fix/census-official-data`, база main `8748099a`.

## Установленные причины и границы доказательств

Старая ошибка production: `0 set; Census: Unexpected token '<', "<html styl"... is not valid JSON`.
Её непосредственная причина — `JSON.parse` тела без проверки формата, после HTTP 2xx.
Старый журнал не сохранял body/final URL/content-type: определить, была ли это key-page,
maintenance или блокировка, задним числом невозможно. Не утверждаем, что ключ единственная причина.

Отдельно подтверждено:
- Все четыре существующих EITS endpoints (`marts`, `advm3`, `resconst`, `ressales`) с этой машины
  возвращают HTTP403, text/html, Cloudflare «Sorry, you have been blocked».
- У marts проверены Accept application/json и */*, redirect manual/follow: 403, без Location.
  Это не исправляется заголовком Accept и не является наблюдаемым редиректом.
- Базовый URL и get/for/time-параметры соответствуют официальной документации; успешный запрос
  с ключом и точные категории четырёх программ ещё не подтверждены реальным payload.
- [EITS guidance, revised May20 2026](https://www.census.gov/data/developers/data-sets/economic-indicators.html)
  требует ключ для всех data queries. Старое предположение «500 запросов без ключа» неверно.
- Официальная [Missing Key](https://api.census.gov/data/missing_key.html) — HTML, а не JSON.
  Это возможное объяснение HTTP2xx HTML, но не доказанная идентичность старого ответа.
- Владелец тоже получил Cloudflare при регистрации ключа. Ключа для live-проверки сейчас нет.

Не обходили защиту, не использовали прокси/чужие ключи/платные API, не вызывали production collector.
Проверки Node HTTP были из локального окружения, не из Vercel. Серверный live-доступ с ключом
остаётся непроверенным; доступ через web-reader к документации не доказывает доступ из Vercel.

## Что исправлено

- `CENSUS_API_KEY` передаётся только серверным route; в .env.example только пустое имя.
  Без ключа Census data request не отправляется, ошибка понятна в закрытом журнале сборщика.
- Census-only transport: JSON Accept, запрет редиректов с ключом, abort15sec на запрос и чтение тела.
  Различаются HTTP429/5xx, HTML missing/invalid-key, block-page, прочий HTML, неверный JSON/schema,
  network/read failure и timeout. URL, response body и upstream exception не записываются.
- Существующие run/tryAsk/per-event catch продолжают изолировать Census; другие источники,
  их повторы и расписания не менялись. Нет немедленных повторов и повышения частоты.
- Запрос ограничен reference-month, не всей будущей историей. Actual берётся только за месяц события,
  previous — за непосредственно предыдущий; нет подстановки latest и нет нулей вместо пропусков.
  Отсутствие seasonal adjustment больше не принимается за SA. Housing starts сохраняет тысячную
  долю M, вместо потери точности при двух знаках; home sales не округляется до целого без необходимости.
- Синтетические schema fixtures проверяют алгоритм, но не являются реальными полученными значениями.
  **Новых live-значений Census для приложения этим PR пока не подтверждено.**

## Официальные альтернативы без Census Data API key

Это самостоятельные публикуемые Census downloads, не обход API. Подключение fallback не делалось:
нужно проверить доступ с сервера, структуру/период/единицы и тесты, не добавляя новую зависимость наугад.

| Показатель | Официальный файл/страница | Проверено / что ещё нужно |
|---|---|---|
| Retail | [MARTS sales](https://www.census.gov/retail/sales.html), [SA total text](https://www.census.gov/retail/marts/www/adv44X72.txt) | Web-reader прочитал реальную таблицу SA sales, не forecast. Есть отдельная таблица seasonal factors: нельзя смешать. Страница содержит actual m/m и revised previous. Backend fetch файла ещё не подтверждён |
| Durable orders | [M3 time series](https://www.census.gov/manufacturing/m3/historical/timeseries.html), [new orders workbook](https://www.census.gov/manufacturing/m3/prel/historical_data/histshts/naics/naicsnop.xlsx) | Официальный download найден. Локально403 Cloudflare; не получен workbook payload. Нужна проверка aggregate durable/SA, advance против full revision |
| Housing starts | [NRC series](https://www.census.gov/construction/nrc/data/series.html), [starts workbook](https://www.census.gov/construction/nrc/xls/starts_cust.xlsx) | Официальная ссылка, XLSX вместо старого XLS с2024. Нужна проверка national total, SAAR, month и revised prior; payload не проверен |
| New home sales | [NRS series](https://www.census.gov/construction/nrs/data/series.html), [sold workbook](https://www.census.gov/construction/nrs/xls/sold_cust.xlsx) | Локально403 Cloudflare. Проверять national total sold/SAAR, не existing homes, inventory или price |

Собственные статистические данные Census доступны для reuse с атрибуцией, но источники/notes и точность
сохраняются ([terms](https://www.census.gov/data/developers/about/terms-of-service.html)).
Файлы latest могут пересматриваться; они не восстанавливают первоначальную публикацию за старую дату.
PDF/press release — ещё один официальный путь, но произвольный HTML не парсится как статистика.
Никакие факты из web-reader вручную в БД не переносились. FRED/BEA и другие модули не подменяют Census.

## После получения ключа

1. [Регистрация](https://api.census.gov/data/key_signup.html) или Request a Key с официальной guidance.
   Если Cloudflare блокирует, обратиться в Census Developer support по ссылке Contact Us; обход не нужен.
2. Владелец добавляет `CENSUS_API_KEY` в Vercel → AYRA → Settings → Environment Variables → Preview,
   без NEXT_PUBLIC_. Не в GitHub, не в PR/чат, не в committed .env. Пересобрать Preview после добавления.
3. Ограниченный read-only smoke четырёх endpoints, отдельно от collector/production БД:
   проверить HTTP/content-type, ключ не логировать; canonical categories, series, units, SA и reference month
   сверить с release tables. Ключ не гарантирует снятие Cloudflare block.
4. Проверить actual и revised previous по одному опубликованному периоду каждого показателя;
   для будущего reference month actual остаётся пустым. Прогноз не подставлять.
5. Только после владельческого review решать production env/deploy. Cron и миграции не нужны.

## Проверки и ошибки разработки

Команда: `npx vitest run lib/market/feeds/census-fetch.test.ts lib/market/feeds/us-sources.test.ts`.
Первый запуск: `FAIL lib/market/feeds/census-fetch.test.ts`:
`Error: Failed to resolve import "./test-db" from "lib/market/feeds/census-fetch.test.ts". Does the file exist?`
Исправлено на существующий `./memory-db`.

Повтор: `Census values and collector isolation > logs a Census HTML failure, keeps stored values and still runs a later source`:
`AssertionError: expected undefined to be null` (line79).
Исправлена проверка: сравнение полного состояния до/после; optional actual в memory DB отсутствует.

`npx tsc --noEmit`: `lib/market/feeds/census-fetch.test.ts(15,17): error TS2322: Type 'VitestUtils' is not assignable to type 'Awaitable<void>'.`
Исправлен afterEach: void block вместо возврата vi.useRealTimers(). Повтор typecheck PASS.

Итог локально: полный Vitest **747/747 PASS**, TypeScript PASS, lint PASS с прежними предупреждениями
login/journal, `node scripts/test-migrations.mjs` A–K PASS (только локальный PGlite, production не трогался).

`npm run build` на Windows:
```text
Failed to compile.
Error: EPERM: operation not permitted, mkdir 'C:\Users\malki\Documents\Codex\work\ayra147\.next\server\app\auth'
> Build failed because of webpack errors
```
Это не успешная сборка. Linux build и оба существующих e2e набора проверяются в CI Draft PR;
итог будет указан в описании PR, без выдачи старого CI за новый.

UI/RU/EN, TradingView, новости, SQL, Supabase, production env, cron и другие источники не менялись.
Новый дальнейший план сохранён в market-feeds-plan.md; лицензии — market-data-future-sources.md.

# WATCH-2C — отделяем напоминания от ценового мониторинга

22 ноября 2026. **Проект для отдельного ревью: уведомления в #215 не реализуются и не включаются.** Неизменённая архитектура уведомлений проверена по исходникам `e71a134d9cb2221cd5038286bd4dcb8ac2a1b66f`; Focus V2 относится к расширению #215. Production SQL, тариф и внешние workers не проверялись. Inbox можно переиспользовать, но готовые Focus producer и Web Push в проверенном коде отсутствуют. Локальный Focus V2 неизвестен серверу. Для ручных событий цены не нужны; для серверных напоминаний нужны отдельные правила и доставка, для POI — также числовая зона и разрешённый feed.

## Inbox не заменяет producer и delivery outbox

В [registry](https://github.com/Malkis99/ayra_trading/blob/e71a134d9cb2221cd5038286bd4dcb8ac2a1b66f/lib/notifications/registry.ts#L1) все типы имеют `available:false`, включая session_open/price_trigger. Наличие названий каналов не доказывает transport. [SQL 0011](https://github.com/Malkis99/ayra_trading/blob/e71a134d9cb2221cd5038286bd4dcb8ac2a1b66f/supabase/migrations/0011_notifications.sql#L5) содержит inbox, preferences, RLS и `UNIQUE(user_id,event_key,type_code)`. Клиент не имеет INSERT в notifications; service_role остаётся только на сервере. UNIQUE дедуплицирует строки inbox, но не внешнюю отправку. Минутный опрос inbox/count — чтение, не Push и не проверка цен. Производитель Focus-событий, SW/VAPID sender и внешняя доставка в исходниках не найдены; существование сервисов вне репозитория этим не опровергается.

| Триггер | Предлагаемый режим | Условие следующего этапа |
|---|---|---|
| Начало сессии | Локальная подсказка по occurrence UTC | Для закрытого браузера: durable server rule, scheduler, expiry, transport |
| Зона POI | Только проект ценового правила | Bounds, валюта, venue, bid/ask/last, срок, лицензия и server feed |
| Завершение чек-листа | Ручное событие после commit | Opt-in, атомарный cycle/event ID; для inbox — server bridge |
| Ручное напоминание | Локальный reminder с инструментом и временем | Для закрытого приложения: серверное правило и доставка |

## Сессии и checklist completion требуют точной семантики

Текущие [sessionDefs](https://github.com/Malkis99/ayra_trading/blob/e71a134d9cb2221cd5038286bd4dcb8ac2a1b66f/lib/market/sessions.ts#L32): London 08:00 Europe/London, New York 09:30 America/New_York. Это окна AYRA, не доказанное открытие единой FX-биржи. Killzones заданы отдельно, обе в NY-времени. Следует использовать `occurrences(sessionDefs(settings))`, сопоставив Focus newYork с sessions newyork. Helper londonNewYorkGapHours сравнивает 08:00 двух зон и не планирует NY09:30. Биржевые праздники/early close потребуют отдельного источника и согласования.

Хранить IANA/local rule и revision, вычислять occurrence UTC вместо фиксированного offset. В 2026 переходы UK — 29 марта/25 октября, США — 8 марта/1 ноября: mismatch weeks обязательны в тестах. Источники: [GOV.UK](https://www.gov.uk/when-do-the-clocks-change), [NIST](https://www.nist.gov/pml/time-and-frequency-division/popular-links/daylight-saving-time-dst). Несуществующий/двойной локальный час ручного reminder нельзя молча переносить: требуется явный корректный выбор.

Для checklist V2 событие означает **ручной checkbox-action**, успешный commit и переход непустого списка из incomplete в all checked. `every([])`, reload, миграция, rename/reorder и удаление последнего unchecked-пункта не уведомляют. Stable item IDs позволяют атомарно сохранить один cycle/event UUID; две вкладки должны увидеть одно событие. Новая активация после uncheck/reset/rearm требует согласованной политики. Сообщение «Вы отметили все пункты» не означает обнаруженный рыночный паттерн: автоматических Sweep/MSS/Displacement нет.

## Официальный ticker ещё не означает бесплатный мониторинг

Текущий btc — BITSTAMP:BTCUSD. [Bitstamp API](https://www.bitstamp.net/api/) документирует `GET /api/v2/ticker/{market_symbol}/`, пример btcusd, last/bid/ask/timestamp. Это технический кандидат нужного venue, но раздел Commercial Use направляет компании за Data License Agreement. **Бесплатные права AYRA non-display monitoring/redistribution, цена договора, live GET и доступность из Vercel не подтверждены.** Детали WS без проверенного протокола/прав не утверждаются. Подключения автоматически нет.

[Coinbase ticker](https://docs.cdp.coinbase.com/api-reference/exchange-api/rest-api/products/get-product-ticker) — другое venue, не fallback; [Market Data Terms](https://www.coinbase.com/legal/market_data) не подтверждают право AYRA строить внешнее end-user приложение по базовой лицензии. По TradingView [FAQ](https://www.tradingview.com/widget-docs/faq/data/) виджет не предоставляет data API. Штатное отображение embed и извлечение данных для собственного автоматического/non-display мониторинга — разные разрешения; права AYRA на extraction не доказаны и ограничены [условиями использования](https://www.tradingview.com/policies/). Scraping iframe/canvas, внутренние WS, proxy и обходы не рассматриваются.

Разрешённое бесплатное покрытие forex, акций и CFD не установлено. FOREXCOM:SPXUSD, CAPITALCOM:DXY, OANDA:XAUUSD и OANDA:USB10YUSD нельзя подменять другим venue, похожим индексом или yield: bond widget показывает цену. POI сейчас enum, не числовые bounds. Нужны quote kind, precision, timestamp freshness, expiry и определение sampled-inside против crossing/touch. Snapshot polling способен пропустить касание между проверками; stale tick/gap/outage означает «не проверено». Не доказаны ни успешный серверный ответ, ни реальная задержка источника.

## Каналы, безопасность и порядок внедрения

| Канал | Честное ограничение |
|---|---|
| Local in-page cue | Приложение работает; это не облачный inbox |
| Local system notification | Permission и поддержка API; timer не гарантирует фон/закрытый браузер |
| Server inbox | Нужен producer и подтверждённая запись; строка не доказывает OS-доставку |
| Server Web Push | Подписка, service worker, sender, opt-in; OS/сеть не дают точного SLA |
| Telegram/email | Не включать до отдельной реализации transport |

По [MDN Push API](https://developer.mozilla.org/en-US/docs/Web/API/Push_API) серверное сообщение получает SW даже без страницы; endpoint подписки — чувствительный capability URL. Нужны серверный VAPID-ключ и subscription. На мобильных устройствах применяется [SW showNotification](https://developer.mozilla.org/en-US/docs/Web/API/Notifications_API/Using_the_Notifications_API), не обещание работы `new Notification()`. [WebKit](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/) описывает iOS/iPadOS 16.4+ Home Screen apps с прямым действием пользователя. [Таймеры](https://developer.mozilla.org/en-US/docs/Web/API/Window/setTimeout) ограничиваются браузером; offline не маскируется как успешная доставка.

Opt-in каждого триггера/канала выключен по умолчанию. Permission — только по явной кнопке; denied/default/unsupported не обходятся повторными prompts или молчаливым fallback. Существующие master/quiet/type preferences проверяются при создании и доставке; Focus не получает security-исключение. Guest не создаёт серверных правил и не переносится при login. Identity берётся из проверенной auth session, payload/href/type — из whitelist. Подписка account-scoped, проверяется перед отправкой и отключается при logout/revoke; A → B → Guest → A не переносит данные. Пользовательские названия не выводятся на lock screen по умолчанию.

Ключи проекта: session — ruleId + occurrenceStartUTC; checklist — cycle UUID; reminder — reminder UUID + due instant; price — rule revision + согласованный crossing cycle. Durable outbox должен иметь lease/attempts/expiry; изменение rule отменяет старую pending попытку. 429/Retry-After и временные сбои требуют ограниченных retries до expiry, без лавины просроченных alerts. Дедупликация не обещает exactly-once внешней доставки при потере receipt.

Сначала отдельно согласуются local opt-in checklist/manual cues; затем authenticated inbox bridge и server session/reminder rules; затем Push transport. Price monitoring — только после лицензии, числовой модели и read-only server probe. SQL/cron/флаги сейчас не меняются. [Vercel Cron docs](https://vercel.com/docs/schedules/cron-jobs/usage-and-pricing) для Hobby допускают нативный запуск не чаще раза в сутки в пределах часа; это не доказательство фактического production-плана/trigger AYRA. Текущий десятиминутный цикл нельзя автоматически присвоить Focus или уменьшать бюджеты ONS/BLS/Eurostat.

| Приёмка будущего этапа | Доказательство |
|---|---|
| Completion | Commit/abort, две вкладки/один цикл; нет alert от empty/rename/delete/reload/reset |
| Время | GMT/BST, US DST, mismatch weeks, weekday/holiday semantics, перенос/expiry |
| Доставка | Opt-in/master/quiet, denied/offline, lost receipt, Retry-After, parallel workers |
| Изоляция | Account epochs, revoked subscriptions, удалённые rules, безопасный payload/href |
| Цена | Лицензия, venue/quote kind, server GET, freshness, gaps/out-of-order, crossing |

Владелец отдельно утверждает объём, семантику сессий, каналы, задержку/expiry/rearm и лимиты. Серверное хранение правил, SQL/RLS, transport credentials, scheduler и источник/стоимость требуют нового разрешения. Статус WATCH-2C: **спроектирован, не внедрён**.

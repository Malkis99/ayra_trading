# WATCH-2E — Custom Session Reminders

23 ноября 2026. Подготовка: PR #217 MERGED в
`43b06f5943abade46ac0741d36cd03bd0efd7139`; обязательный CI 4/4 PASS.
Автоматический production deployment `dpl_2ZJ4XkMfaoFcFwgr3sXPuRUT4Mdp` READY,
SHA соответствует merge. В рамках WATCH-2E production не менялся.

## Время и пользовательская семантика

Пользовательская сессия хранит HH:mm start/end, IANA timezone и настройки напоминания.
Дни — ISO Monday=1…Sunday=7, относятся к **локальному дню начала**. Для старого отсутствующего
поля показывается Mon–Fri, но уведомления выключены. Пустой набор дней допустим и явно
показывается как отсутствие доставки. Lead — 0, 5 или 15 минут.

Использован `@js-temporal/polyfill` 0.5.1, зафиксирован в lockfile (ISC; транзитивный
jsbi — Apache-2.0). Это библиотека времени, без глобального polyfill/изменения Date,
сетевого сервиса и изменения календаря других модулей. См. [проект библиотеки](https://github.com/js-temporal/temporal-polyfill)
и [семантику неоднозначного времени Temporal](https://tc39.es/proposal-temporal/docs/timezone.html).
Часовые правила берутся из IANA-данных браузера/Intl; их актуальность зависит от среды.

- `earlier` выбирает первый instant fold. Round-trip в PlainDateTime должен точно
  совпасть с введёнными часами: иначе gap, occurrence пропускается, часы не сдвигаются.
- End < start — следующий локальный календарный день через PlainDate.add(days:1).
  К UTC-instant не прибавляются механические 24 часа. Start=end по-прежнему недопустим.
- Оба конца должны существовать; gap окончания также пропускает occurrence.
- Окончание должно быть позже начала. Выбор first instant применяется и к fold окончания.
- Reminder due = start instant − lead. Для срока перед полуночью берётся weekday даты
  предстоящего старта, а не weekday самого напоминания.
- Проверяются соседние локальные даты вокруг now. Это не генератор пропущенных событий.
  Глобальные London/New York, forex week и настройки прочих модулей не менялись.

## Локальное хранение и совместимость

IndexedDB `ayra_market_focus_v1` остаётся **version 2**, stores entries/preferences/spaces
не меняются. Record-level V2/V3, checklist и localAlerts сохраняются.

Новый session.reminders:

```ts
{ version: 1, days: number[], enabled: boolean, lead: 0|5|15, armedAt: number }
```

Enabled — явный opt-in для этой сессии во всём локальном пространстве account/Guest.
Он действует для каждого инструмента текущего Watchlist, выбравшего эту сессию; это
видно в подписи checkbox. Стандартный per-instrument localAlerts.session сохраняется
отдельно и не включает Custom. При Custom стандартные controls скрыты, а подсказка
направляет к редактору; возврат к London/New York восстанавливает прежние controls.

Каталог V1 читается без записи и без автоматического opt-in. При обычном rename/time edit
старой сессии поле не материализуется. После явного изменения новых controls или создания
новой сессии сохраняется **catalog version 2**. Новый reader поддерживает V1/V2;
WATCH-2D reader отвергает V2 вместо опасного редактирования неизвестного расписания.
Библиотека в старой вкладке потребует обновления целиком; строки и raw export не теряются.
Замороженный реальный WATCH-2D parser проверяется в `test-fixtures/market-focus-2d`.
Каталог не возвращается к V1 после удаления сессий. Future/неоднозначные контракты read-only.

Новые opaque extensions строки инструмента:

```ts
customSessionSelection: { version:1, id:UUID, fieldRevision:number, armedAt:number }
customSessionReceipts: { version:1, seen: { [sessionUUID]: "YYYY-MM-DD" } }
```

Scope и InstrumentId определяются ключом строки и явно входят в candidate token; UUID и локальная дата старта завершают
идентичность occurrence. В receipt — монотонный high-water civil day на UUID, без ежедневного
роста массива. Rename, lead, часы, дни и timezone не меняют эту идентичность. Уже обработанный
цикл и более ранние циклы не доставляются снова. При смене timezone новый локальный день —
другой цикл, но всё равно действует барьер будущего срока. Tombstone и receipts сохраняются.

Revision/CAS, а не часы устройства, разрешают конфликты. armedAt — только запрет catch-up:
изменение времени/zone/days/lead/opt-in или новый выбор сессии допускают лишь строго будущий
due. Rename сохраняет этот барьер. Изменение конфигурации само не создаёт сообщение.
Неизвестные поля сохраняются, namespaces будущих версий не перезаписываются.

## Claim, доставка и настройки

Это расширение существующего poller WATCH-2C, не второй engine и не Inbox producer.
Сканируются только инструменты текущего Watchlist; закрытый/невидимый Watchlist не доставляет.
Скан — прежние 20 секунд плюс существующие события focus/storage/visibility.

Кандидат содержит scope, InstrumentId, UUID, cycle, itemRevision и fieldRevision. В одной readwrite-транзакции
entries/preferences/spaces проверяются purge epoch, актуальная запись, каталог, tombstone,
revision, опт-ин, weekdays, arming barrier и срок; затем атомарно записывается receipt.
Две вкладки не могут подтвердить один цикл дважды. Устаревший кандидат после rename/edit/delete
не принимается; свежий кандидат сохраняет прежний dedupe key. Quota/abort не являются успехом.

Перед показом подтверждённого Custom сообщения повторно проверяются актуальные refs/revisions,
scope, видимость, срок и generation настроек уведомлений. При edit после claim сообщение может
быть подавлено; receipt не откатывается. Это **at-most-once, не exactly-once**: падение после
commit и до отрисовки может потерять сообщение. Квитанция не означает серверную доставку.

Custom cue хранит candidate metadata и в памяти очереди. Истёкшая cue не открывается
после dismiss другого сообщения. Очередь повторно проверяет каталог/refs/revisions;
edit/delete, master-policy change и скрытие страницы удаляют устаревшие Custom cue,
сохраняя receipts. Legacy completion/manual/standard-session сообщения не меняют поведения.
Пять component regression cases проверяют очередь за completion: expiry, delete, edit,
pause и hide; completion при этом остаётся видимым. Исходное падение воспроизведено до фикса.

Прежний grace — менее 60 секунд после due, но новый runtime visibility barrier дополнительно
запрещает catch-up, если Custom due был до открытия/возвращения видимой страницы. Время устройства
и фоновые ограничения браузера влияют на доставку; точность в секундах не обещается.

Используются существующие session_open/site, master pause, quiet hours (timezone аккаунта)
и инструментальные фильтры. Account policy читается только при due; ошибка сети — fail closed.
Изменение policy инвалидирует ожидающий старый Custom-ответ. Guest не имеет отдельной страницы
глобальных настроек в текущей AYRA: используется прежняя Guest default policy и локальный opt-in.
Новая система Guest master-настроек не создаётся. Account offline может пропустить срок при
недоступной policy; Guest может доставить локальную cue offline.

Настройки сессии остаются видимыми после подтверждённого Save; форма не показывает
ложный OFF из нового пустого шаблона. Список библиотеки также показывает выбранные дни
и ON/lead либо OFF. Новый пустой шаблон открывается только явной командой «Новое значение».

Нет Web Push, запроса браузерных разрешений, cloud Inbox INSERT, cron, server producer,
price alerts, автоматического MSS/Sweep и торговых сигналов.

## Export, cleanup и откат

Существующий raw export включает каталог V2, выбор и receipts только своего пространства.
Scoped cleanup/purge удаляет их вместе с Focus; автоматического Guest→account копирования нет.
Reset инструмента сохраняет библиотеку и receipts. Удаление инструмента из Watchlist не удаляет
данные, но останавливает доставку до его возврата. A→B→Guest→A и поздние callbacks fenced.

Откат предпочтителен через V2-catalog-readable клиент без новых controls/доставки. WATCH-2D
может экспортировать raw данные, но не редактировать upgraded-каталог до обновления. Автоматического
downgrade, удаления receipts или готового UI импорта JSON нет. Production SQL/миграций нет.

## Проверки и реальные скриншоты

Unit: gap/fold London/New York/Lord Howe, skipped day Apia, Kathmandu offset, ночные DST
окна, разъезд EU/US DST, локальные даты/weekday, сроки/grace/arming, receipts, CAS, quota,
изоляция инструментов/аккаунтов, legacy catalog, reset, master/quiet/filter/site/network,
изменение policy во время pending ответа и скрытая страница.

Chromium: 16 новых сценариев, offline/reload, две вкладки, rename без дубля, отсутствие catch-up,
gap London, fold New York, A→B→Guest→A и RU/EN × 360/390/768/1024/1440. Full CI и SHA указаны
в Draft PR. Тестовые записи — только локальная IndexedDB/fake Supabase.

- [390 RU](screens/watch-2e/390-ru.png)
- [390 EN](screens/watch-2e/390-en.png)
- [1440 RU](screens/watch-2e/1440-ru.png)
- [1440 EN](screens/watch-2e/1440-en.png)

Диагностика: первый двухвкладочный тест ошибочно делал два fastForward — часы Playwright
общие на browser context, поэтому второй сдвиг делал кандидат просроченным. Теперь один
общий сдвиг запускает проверки обеих страниц; строгое условие одного сообщения сохранено.
Новый schedule-компонент явно импортирует React для classic JSX runtime Vitest.

В первом GitHub check `45121527119` новый component test не дождался запроса policy
(1643 unit PASS / 1 failed / 1 existing skip). Обнаружен фактор недетерминизма: реальные
Node BroadcastChannel передают сообщения между Vitest worker threads, включая параллельные
AuthProvider-тесты с тем же именем канала. Отдельная worker-проверка подтвердила передачу.
Unit fixture теперь использует управляемый channel с реальным account guard, явными A→B→Guest→A
сигналами и проверкой cleanup подписок. Производственные Auth/channel не менялись; настоящие
вкладки и account switching остаются в Chromium E2E. Проверки не ослаблены, таймауты не увеличены.

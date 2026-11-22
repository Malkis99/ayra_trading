# WATCH-2B — Market Focus и пользовательский чек-лист

Владелец одобрил WATCH-2A, затем расширил текущий Draft PR #215 пользовательским
чек-листом и интеграцией с экспортом/очисткой профиля. Лимиты подтверждены отдельно:
**30 пунктов на инструмент, 160 Unicode code points в названии**.

## Интерфейс

Один контейнер после списка Watchlist и TradingView Quotes. Только существующие
инструменты Watchlist; поиск/категория/Pin-фильтр не сужают picker и не меняют порядок.
Четыре ручных поля: направление, POI, MSS, сессия. Null — «Не выбрано», отдельно от
Neutral и Session None. Никаких котировок, сигналов, TP/SL/RR, сделок, заметок, планов
и наград. Настоящие значения пустые по умолчанию; состояние UX-макета не переносится.

При первом использовании — шаблон из шести условий: POI reached, Liquidity sweep,
Displacement, MSS/CISD, Retracement/Test, Reaction. Пользователь может добавлять,
переименовывать, удалять и переставлять пункты. Отметка привязана к стабильному id,
а не тексту или позиции. Переименование/перестановка не меняют отметку. MSS-поле
и галочка MSS/CISD независимы. Пустой пользовательский список остаётся пустым после reload.

«Настроить» открывает компактные Up/Down/Edit/Delete действия. Клавиатура управляет
обычными кнопками; после перемещения/удаления возвращается фокус. Удаление пункта
с его отметкой требует явного подтверждения. Текст — обычный React text node,
не HTML/Markdown; ссылки и скрипты не выполняются. Длинный текст переносится.
Ограничение названия не обрезает вставленный текст молча: показывается счётчик,
сохранение недоступно сверх лимита, та же валидация есть в модели транзакции.

Reset очищает четыре поля и галочки, **сохраняя пользовательские названия и порядок**.
Cancel/Esc ничего не меняют. Ни сессия, ни дата/reload, ни заполнение списка не вызывают reset.
Удаление инструмента не удаляет Focus; re-add восстанавливает данные без автоматического
переключения с текущего инструмента. При пустом Watchlist — короткий empty state.

RU/EN, существующие AYRA Select/Checkbox/ConfirmDialog, фокус/ARIA, 360/390/768/1024/1440.
На mobile одна колонка, на desktop поля 4 колонки и компактный список отметок.

## Локальный контракт V2

База исторически называется `ayra_market_focus_v1`, но **IndexedDB database version = 2**.
Это локальная браузерная миграция, не Supabase/SQL.

| Store | Ключ | Содержание |
|---|---|---|
| entries | [spaceId, instrumentId] | документ Focus V2 |
| preferences | spaceId | version 1, selectedInstrumentId |
| spaces | spaceId | поколение очистки epoch, без текста/отметок пользователя |

spaceId — `account:<uuid>` или `guest`. Пример формы документа:

```ts
{
  version: 2, spaceId, instrumentId, revision,
  direction, poi, mss, session,
  checklist: {
    orderRevision,
    items: [{ id, template, text, checked, revision }]
  }
}
```

У стартовых пунктов id = `template:<key>`, template — стабильный ключ словаря,
text = null. Переводы по умолчанию не сохраняются. Новые пункты получают UUID,
text — введённый пользователем текст. Явно изменённое название не переводится
при смене RU/EN. Названия, галочки и порядок отдельны для каждого account/Guest/инструмента.

Глобальная revision — локальная последовательность, не timestamp и не cloud revision.
item.revision защищает редактирование/удаление; orderRevision — структурные перестановки.
Неизвестные поля документа/checklist/item сохраняются. Будущая version и невалидные
записи не перезаписываются автоматически. Неизвестные инструменты сохраняются в базе/экспорте,
но picker показывает только текущий Watchlist. Пустое чтение не создаёт entry.

## Атомарность и две вкладки

Каждая операция читает последнюю запись и применяет минимальный patch в одной
readwrite-транзакции. Разные поля/пункты и параллельные append сохраняются независимо.
При конкуренции за 30-й слот успешен только один append. Проверки количества/длины
выполняются внутри транзакции, не только в UI.

Check меняет только checked выбранного id. Rename/Delete требуют просмотренную ревизию
пункта; Move — просмотренную ревизию порядка. Конфликт не разрешается автоматически.
Старый toggle удалённого id не воссоздаёт пункт. При конфликте редактор оставляет
черновик, предлагает актуальный текст и новое явное решение.

Reset сравнивает глобальную revision из диалога с текущей entry. Если другая вкладка
изменила данные, ничего не очищается, требуется новый просмотр/подтверждение.
В интерфейсе нет постоянного polling: свой CustomEvent/BroadcastChannel и перечитывание
при focus/visibility. MARKET_STORE_EVENT и облачные запросы Focus не используются.

Promise записи подтверждается только в transaction.oncomplete. Успешный put-запрос,
после которого транзакция abort, не считается Saved. До commit — Pending; при ошибке
возвращается подтверждённое состояние с видимой ошибкой. Ошибка IDB не блокирует Watchlist.

## Безопасный перенос V1 → V2

Один onupgradeneeded versionchange transaction:
1. Существующие entries/preferences остаются на месте; добавляется store spaces.
2. Каждая корректная V1 entry получает V2 items в исходном порядке и те же шесть boolean.
3. Stable instrument/account ids и поля direction/POI/MSS/session сохраняются.
4. Неизвестные поля сохраняются; global revision увеличивается, клиентские часы не используются.
5. Любая ошибка записи/квоты откатывает весь upgrade, включая ранее обновлённые cursor rows.

Некорректная/будущая запись, переполнение ревизии или конфликт неизвестного V1 поля
с новыми items/orderRevision не исправляются предположениями. Raw остаётся для экспорта,
редактирование блокируется с понятной ошибкой. Повторное открытие V2 не повторяет миграцию.
Старый клиент, запрашивающий IDB version 1, после upgrade получает VersionError и не может
затереть V2 старым boolean-форматом. Нужна перезагрузка/обновление клиента.

## Account isolation и очистка

UI keyed по space/auth epoch/instrument; поздние ответы A не применяются к B, Guest
или новой A epoch. Принятый клик сохраняется только в захваченной записи. Автоматического
Guest → account переноса нет. Обычный logout сохраняет Focus для повторного входа.
Offline работает локально; cloud_sync=false не запрещает локальные отметки.

Действующие deleteGuestData и deleteAccountDeviceData теперь сначала атомарно очищают
Focus выбранного пространства и preferences. Остальные аккаунты не затрагиваются.
При ошибке Focus-очистки операция не сообщает об успехе и не начинает удалять остальные
локальные ключи. Старые условия безопасности (аккаунт уже вышел / Guest не активен)
сохраняются. Бизнес-правила и облачные данные Журнала не изменяются.

В spaces остаётся только технический epoch tombstone (scope UUID + счётчик), без
названий/отметок. Контроллер захватывает epoch заранее, а каждая запись проверяет его
в той же транзакции с entries. Поэтому отложенный старый write/select не воскресит
данные после purge. Оповещение об очистке инвалидирует старое UI-подтверждение.

DeviceDataCard обнаруживает Focus-only Guest-данные: экспорт/очистка доступны даже без
прогресса/сделок. Кнопка копирования Журнала не выдаётся за перенос Focus.

## Экспорт

- Guest JSON получает отдельное additive поле marketFocus с databaseVersion, raw entries
  и preferences только Guest. Существующее поле data не меняет формат.
- «Экспортировать мои данные (JSON)» в StatsTab добавляет Focus только текущего space.
  Расчёты статистики, XP/Coins и исходный экспортируемый профиль не меняются.
- Ошибка чтения Focus не маскируется пустым экспортом; файл не скачивается с ложным
  подтверждением полноты. Поздний account export отменяется при смене auth epoch.
- Read-only snapshot не создаёт отсутствующую базу и не изменяет raw будущих записей.
- Экспорт не отправляется на сервер. UI импорта Focus и облачного восстановления нет.

## Проверки

Unit: все поля/отметки, CRUD/order, revision-конфликты, две connections и последний слот,
Unicode boundary, schema migration/повтор/rollback/opaque fields, два simultaneous resets,
put-success-then-abort, scoped export/cleanup, purge fence и поздние acknowledgements,
A → B → Guest → A, IDB denied/quota, отсутствие cloud events.

E2E: реальная IndexedDB Chromium + fake-auth/fake-Supabase, legacy V1 upgrade,
create/edit/reorder/delete/reset с клавиатурой, два tab/conflicts, JSON downloads,
Guest/account UI-cleanup, offline/reload/re-add, максимальный список 30/длинный текст,
отсутствие HTML interpretation, RU/EN × пять ширин, регрессии WATCH-1A/1B и Quotes lifecycle.
Все тестовые записи — в изолированной базе браузера и fake-Supabase, не production.
Итоговые counts и обязательный CI указываются в PR на точном HEAD.

Локальная проверка расширения: полный чистый unit 1526 PASS + 1 существующий skip;
61 совместный E2E Focus/Custom/WATCH-1A/WATCH-1B PASS; отдельный maximum-list/XSS-text
browser test PASS. TypeScript/lint/build PASS, сохранены существующие предупреждения
чужих модулей. Runtime-файлы тестовой сборки сверены SHA-256 с рабочей веткой.
Скриншоты default и customize состояний — docs/screens/watch-2b, 390/1440 RU/EN.
Новые полные mock-auth/fake-Supabase выполняются на обновлённом HEAD обязательным CI.

## Зафиксированные ошибки разработки

Ранее: Windows sandbox build EPERM для `.next/static/chunks` — повтор вне sandbox PASS;
старые work/uk3-pg node_modules попадали в Vitest с `Cannot find module ./testing/...` —
повтор в чистой копии; точный i18n allowlist для утверждённых терминов; TS callback
afterEach возвращал VitestUtils — исправлен void. Таймауты не увеличивались.

В расширении:
- Unit `cleanup abort leaves both data and the purge fence unchanged`: Expected 0,
  Received 1. Подтверждён дефект: синхронная ошибка delete отвергала Promise, но не abort
  транзакцию. Исправлен явный abort, теперь прежние данные/epoch сохраняются.
- Hook late-read test требовал дождаться начала именно A.read после нового epoch-read;
  добавлено причинное ожидание вызова A, не sleep/timeout.
- Новые export/cleanup E2E ошибочно искали действия в /settings/account и достигали
  `Test timeout of 30000ms exceeded`. Исправлен маршрут на существующий /settings/cloud.
- После sign-out-and-delete публичная /settings/cloud остаётся открытой, а не redirect
  /login. Исправлено тестовое ожидание: Guest UI и фактическая очистка, без изменения навигации.

## Ограничения и откат

Нет синхронизации Focus между устройствами, шифрования, автоматического backup или
публичного quote feed. Очистка данных сайта удаляет Focus вместе с техническими tombstones.
Сохранность в private browsing/при запрете storage не обещается.

Откат кода не удаляет базу. Автоматический downgrade V2 → V1 запрещён: он потерял бы
пользовательские пункты. До возврата совместимого V2-клиента старый Focus может быть
недоступен, но данные остаются; raw JSON экспорт — путь сохранения для диагностики.

Уведомления — только отдельный проект WATCH-2C в watchlist-market-focus-notifications.md.
В #215 нет notification producer, browser permissions, ценового мониторинга, SW или Push.
Новых зависимостей, production SQL/RLS/grants/cron/флагов нет. watchlist_meta и cloud sync,
UK-3C, рыночные API, TradingView, Quest Hub и игровые правила не изменяются.

# WATCH-2C — локальная доставка, без серверных обещаний

## Реализуемый объём

Все триггеры изначально выключены. Настройки и квитанции находятся в `localAlerts`
существующей локальной записи Focus V2. База, версия IndexedDB, cloud sync и
`watchlist_meta` не меняются. Экспорт и очистка профиля включают эти поля вместе с
Focus. Чужие/будущие версии метаданных не перезаписываются.

Локальные сообщения видны внутри Market Focus через доступный `role=status`, а
не второй Inbox. Существующий глобальный toast не используется для account-scoped
содержимого: его очередь живёт вне Focus и могла бы пережить смену аккаунта.
Существующие UI tokens, Button, notification preferences и session calendar
переиспользуются. Browser Notification/Push не запрашиваются и не включаются.

## События и атомарность

- Completion создаётся только ручным `check=true`, переводящим непустой список из
  incomplete в complete. Событие записывается вместе с отметкой; abort не создаёт
  событие. Load/upgrade/rename/move/delete/reset сами не создают событие.
- Uncheck/add/remove сбрасывают незавершённое completion-событие. Reset делает
  список incomplete. Старый токен не может уведомить после нового цикла.
- London/New York — выбранная Focus session, часы из существующих настроек AYRA,
  `occurrences(sessionDefs(...))`. DST, forex week и рабочие дни — существующие
  правила. Это не биржевой праздничный календарь. Пользователь выбирает 0/5/15
  минут до начала (0 означает начало); это параметры UX, не прогноз задержки.
- Один ручной reminder на инструмент; native дата/время явно в UTC, поэтому ввод
  не неоднозначен при DST. Изменение/удаление — CAS конфигурации.
- Перед доставкой IDB readwrite повторно вычисляет due по актуальной записи и
  атомарно записывает квитанцию. Две вкладки не списывают один токен дважды.
  Смена сессии, отмена, новая конфигурация, purge делают старый token недействительным.

Доставка **at most once**, не exactly once: падение/закрытие после commit квитанции
до отрисовки может потерять локальное сообщение. Квитанция не означает облачную
доставку. Потерянные сообщения не пересоздаются. Reload не создаёт события,
но ещё не списанное подтверждённое событие может быть показано в пределах окна.

## Окно и настройки

Проверки локальной базы — каждые 20 секунд и при focus/visibility/изменениях Focus,
только пока Watchlist смонтирован и видим. Обрабатываются инструменты текущего
Watchlist, а не только выбранный. Удалённый инструмент сохраняет настройки, но не
получает сообщения до возврата. Технический допуск — менее 60 секунд после срока;
старое событие не догоняется после сна/закрытия. Таймер браузера может задержаться.

Account policy читается существующим read-only repository **только при due-событии**;
master pause, quiet hours, instrument filter и отключённый `session_open/site`
соблюдаются. Для completion/manual нет подходящих server type codes: их opt-in
локален; master/quiet/instrument policy остаётся общей. При ошибке чтения account
policy доставка приостанавливается (fail closed), а не использует default permission.
Offline Guest может доставлять локальные сообщения; account offline может быть
приостановлен из-за недоступной политики. Подключение/focus повторяет проверку
только если событие ещё не просрочено.

Ни server INSERT, ни service_role, ни новые каналы/доступность registry не добавлены.
Настройки не синхронизируются между устройствами. Guest отдельно; автоматического
переноса нет. Capture account epoch и purge ticket защищают A→B→Guest→A и поздние
ответы. Очистка профиля удаляет правила/квитанции вместе с Focus.

## Следующий серверный объём — не реализован

Для центра уведомлений/закрытого браузера нужны отдельно утверждённые server rule,
producer/outbox, разрешённые типы, доставка/Push, права и обработка истечения.
Исходный проект: [WATCH-2C](watchlist-market-focus-notifications.md).
Ценовые источники, POI alerts, MSS/Sweep/Displacement и торговые сигналы отсутствуют.

## Проверки

Unit: defaults, commit/abort, last manual check, no rename/move/delete/reset events,
parallel claims, CAS, cancel/expiry/purge/isolation, custom hours и DST mismatch weeks,
master/quiet/type/instrument filtering. Browser: two tabs/reload, UTC cancel/offline,
RU/EN × 360/390/768/1024/1440 и keyboard details. Полный CI обязателен перед ревью.

## Диагностика разработки

- `npx tsc --noEmit`: `TS2322: Type 'VitestUtils' is not assignable to type
  'Awaitable<void>'` в новом afterEach. Callback теперь явно возвращает void.
- `npx playwright test -c playwright.supabase.config.ts e2e-supabase/market-focus-notifications.spec.ts`:
  `Clicking the checkbox did not change its state`. Pending draft теперь виден
  сразу; Saved по-прежнему только после commit, ошибка откатывает draft.
- Новый account-тест изначально использовал helper с прогрессом Guest: onboarding
  завершался на `/profile-select`, а ожидался `/`. Исправлена подготовка чистого
  контекста, существующая навигация не менялась.
- Тест ошибки политики с HTTP 503 ожидал paused за 5 секунд. В установленном
  postgrest-js 503 повторяется 3 раза с backoff 1/2/4 секунды. Для детерминированного
  отказа тест использует неповторяемый HTTP 500; настройки и таймауты SDK не менялись.
  Для account ошибка/ожидание политики не дают разрешения на доставку.
- Проверка, пришедшая во время другого IDB scan, теперь выполняет один причинный
  follow-up после завершения текущего scan. Параллельных scan нет.

Таймауты тестов не увеличены, force/skip для обхода ошибок не добавлены.

Дополнительные component tests с управляемыми Promise проверяют поздний policy
ответ A→B→A, отрицательный результат claim и purge до получения положительного
claim-ответа. Последний сценарий требует проверки epoch не только при записи,
но и непосредственно перед показом сообщения. React импортирован явно для
classic JSX runtime существующей Vitest-конфигурации.

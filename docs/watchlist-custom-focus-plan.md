# WATCH-2D — проект Custom Market Focus и барьер совместимости

Продолжение WATCH-2E: [проверенная модель Custom Session Reminders](watchlist-custom-session-reminders.md).
Исходные ограничения уведомлений ниже относятся к WATCH-2D; новый opt-in, catalog V2 и receipts
описаны отдельно, без изменения IndexedDB V2 и record-level V3.

22 ноября 2026. **Владелец одобрил record-level V3 при сохранении IndexedDB V2;
реализация включена в Draft PR #217 для ревью.** Изначальный барьер совместимости
исследован ниже; выбранный контракт и его ограничения утверждены отдельно.
Результаты проверок: [отчёт реализации](watchlist-custom-focus-implementation.md).
SQL, RLS, cloud sync, Q4.5, UK-3C и флаги не изменяются.

## Основание и проверенные факты

WATCH-2C #216 объединён стандартным merge commit
`9a3a6e50e210bb7bcf20f86a7c3ce9ae1a3b5b81`. Vercel автоматически развернул этот SHA:
`dpl_YcqczMwVt7fGANxKM9gzcQhBKXwC`, Ready, production alias ayra-trading.vercel.app.
Guest smoke RU/EN × 390/1440: default off, последний ручной check → сообщение после
commit, reload без дубля, без JS errors/overflow. Новые ephemeral Guest contexts,
сетевые записи заблокированы; реальных аккаунтов и серверных данных проверка не меняла.

Текущий [модельный код](https://github.com/Malkis99/ayra_trading/blob/9a3a6e50e210bb7bcf20f86a7c3ce9ae1a3b5b81/lib/market/market-focus.ts)
фиксирует `version:2` и четыре конечных enum. `parseFocus` отвергает custom ID во всех
четырёх полях; `patchFocus` тоже не принимает неизвестное значение. Старая версия
не сможет безопасно редактировать такую запись, даже если убрать только TS-проверку.

**Неустранимая неоднозначность sidecar в V2:** пусть `poi=null`, а opaque
`customSelections.poi` ссылается на пользовательский тип. Старый клиент не знает
sidecar. Его явное «очистить POI» и независимое «очистить MSS» при исходном `mss=null`
дают одинаковый JSON, сохраняя custom ссылку. В одном случае пользователь ожидает
удаления выбора POI, в другом — его сохранения. По записанным данным различить эти
намерения невозможно. Ни клиентское время, ни общая revision проблему не решают.

Версия записи 3 честно блокирует V2 parser. Повышение версии самой IDB до 3 защищает
от старого writer, но **делает недоступными старому клиенту весь Focus и его export**:
его open(name,2) получает VersionError, а probe/export отвергает db.version>2.
Данные при этом могут сохраняться целиком. Это значимая смена совместимости, а не
обычное добавление UI-кнопки. Не включаем такой переход без отдельного ревью владельца.

Есть более узкий вариант: **IDB остаётся V2**, V3 применяется только к записи инструмента
при первом custom-выборе, а каталог хранится в opaque `preferences.customCatalog`.
Тест с существующим V2-клиентом подтверждает: `select` сохраняет каталог, обычный
инструмент читается, raw export включает V3-запись и каталог, cleanup удаляет свой scope.
Старый writer custom-записи получает unsupported и не перезаписывает её. Это предпочтительнее
глобального DB gate, однако **не является полной обратной read/write совместимостью**:
затронутому инструменту всё равно нужен новый клиент. Именно этот контракт требуется
согласовать перед реализацией, не выдавая ограниченный режим за прозрачное обновление.

Эти утверждения воспроизводятся в `lib/market/focus-custom-compatibility.test.ts`:
12 тестов, fake-indexeddb в памяти. Никакая реальная база не повышалась до V3.

| Вариант | Результат |
|---|---|
| Custom ID прямо в V2 enum | Существующая запись становится invalid для старого reader |
| Custom sidecar + старые поля null | Невозможно определить намерение старого writer; скрытое восстановление выбора |
| Две независимые базы | Сохраняет ту же неоднозначность выбора; теряет общую атомарность |
| Молчаливое отображение custom direction как Neutral | Ложная семантика; запрещено |
| Контракт V3 + IDB version gate | Сохраняет данные, но блокирует старый Focus/export целиком; не выбран |
| V3 только для custom-записей + IDB V2 | Предпочтительный проект: обычные инструменты/export/cleanup сохраняются; custom-запись требует обновления |

## Утверждённая и реализованная модель V3

Имя базы остаётся `ayra_market_focus_v1`; **локальная IDB version 2**, новых stores нет.
Существующие `entries`, `preferences`, `spaces` сохраняются. Каталог — отдельное
версионированное поле `preferences.customCatalog` с revision и массивом items;
ключ элемента внутри scope — `[kind,id]`. Сам preferences row остаётся version 1:
старый select читает свежую запись в транзакции и сохраняет opaque поля через spread.
Guest и каждый account — разные spaceId.
Каталог общий внутри одного пространства; выбор по-прежнему индивидуален для инструмента.
Удаление инструмента из Watchlist не удаляет его запись/выбор/каталог.

```ts
type Selection = { kind: "system"; id: string } | { kind: "custom"; id: string } | null;
type Field = "direction" | "poi" | "mss" | "session";
interface CatalogItem {
  version: 1;
  spaceId: string;
  kind: Field;
  id: string;          // UUID, не имя и не перевод
  revision: number;    // CAS, не часы клиента
  label: string;      // plain text, не HTML
  deleted: boolean;   // tombstone сохраняет использованное значение
  session?: { start: string; end: string; zone: string };
  // Неизвестные поля сохраняются; неизвестная версия read-only.
}
// FocusEntry V3: те же identity/revision/checklist/localAlerts,
// но direction/poi/mss/session — Selection, плюс fieldRevisions по четырём полям.
```

Системные ID не меняются и не хранят переведённые названия. Системные значения нельзя
переименовать/удалить ни UI, ни storage-командой. Custom UUID не меняется при rename.
Custom direction не маппится на bullish/bearish/neutral и не влияет на другие модули.
Проверка типа учитывает kind: POI ID нельзя записать как session.

Утверждённые границы: до 30 активных custom элементов на kind и 160 Unicode code points
на название. Удалённые элементы сохраняются как tombstones и не занимают активный лимит.
Пустые строки и control characters отвергаются; HTML отображается как plain text.
Повторяющееся имя не определяет identity; UI предупреждает, но не объединяет записи.

## Атомарность, удаление и сброс

Все операции работают только с captured account generation и purge epoch. `Saved`
возвращается после `tx.oncomplete`; abort/quota/blocked/VersionError не подтверждают запись.
Общая revision каталога увеличивается атомарно; edit/delete проверяют revision элемента,
custom select — revision выбранного элемента и fieldRevision, первая конверсия — revision V2.
В одной readwrite-транзакции проверяются preferences, entries и spaces.
Разные поля не перетираются полным snapshot. Повторы ограничены; конфликт не разрешается
автоматическим overwrite и не обходит CAS.

Delete открывает подтверждение с названием и перечнем использующих инструментов.
Перед commit список ссылок/revision проверяются снова. Concurrent новый выбор или rename
требует повторного просмотра. Удаление — tombstone: элемент скрыт из новых вариантов,
но используемый выбор остаётся видимым с пометкой «Удалённый пользовательский тип».
Ни автоподмены на системный вариант, ни скрытого null. Замена/очистка — явное действие
пользователя по инструменту. Системные пункты всегда остаются доступными.

Reset выбранного инструмента требует актуальной revision, очищает selections и отметки,
но сохраняет checklist titles/order и каталог. Удаление всех локальных данных профиля
атомарно удаляет entries/preferences (включая каталог) нужного пространства и увеличивает его
purge fence; чужие аккаунты не затрагиваются. Обычный logout ничего не стирает.

## Миграция и откат

1. Смешанный V2/V3 reader, raw export и очистка проверяются тестами. Для custom-инструмента
   старую вкладку необходимо обновить. Обычные инструменты остаются V2.
2. Создание первого custom-выбора делает lazy V2→V3 **одной записи** в общей readwrite
   транзакции entries/preferences/spaces: проверить исходную revision и каталог,
   преобразовать запись и установить custom reference атомарно. Существующая V1→V2
   миграция остаётся прежней. Ни нового DB upgrade, ни массовой перезаписи всех записей.
3. Сохранять space/instrument identity, checklist IDs/text/marks/order и opaque fields.
   Стандартные enum → system references без изменения смысла; null остаётся null.
   Добавить fieldRevisions. Не создавать custom значения из примеров и не объединять имена.
4. Сохранить localAlerts и receipts без генерации completion. Стандартные session reminders
   адаптировать к system selection, сохранив календарь/opt-in/дедупликацию WATCH-2C.
5. Некорректные/неизвестные/future rows сохранить raw и read-only; не чинить их догадками.
   Ошибка read/put/validation abort откатывает все изменения соответствующей транзакции.
   Создание элемента каталога и его последующий выбор — отдельные явные действия:
   ошибка выбора не удаляет ранее сохранённый элемент библиотеки.
6. Проверить count, identity, marks, receipts и opaque data до/после, повторное открытие,
   export, cleanup и блокировку старого writer именно custom-записи. Pending legacy patch
   читает актуальную запись внутри своей транзакции: если уже V3, запись отвергается;
   если он успел первым, новая миграция замечает изменение исходной revision и конфликтует.

Новый export включает raw catalogs только выбранного пространства; неизвестные версии
не удаляются при экспорте. Focus-only Guest export/cleanup остаются доступны. Перенос
гостевого Журнала не становится переносом Focus или catalogs.

**Откат не удаляет custom данные и не превращает custom direction в Neutral.**
Предпочтителен V3-readable клиент без редакторов. При возврате к нынешнему V2-клиенту
custom-запись недоступна для чтения/редактирования до обновления, но обычные записи,
raw export и scoped cleanup сохраняются благодаря IDB V2. Автоматического downgrade
custom-записей нет. Снимок JSON — сохранение данных для диагностики, а не обещание
готового UI импорта/автоматического восстановления.

## Время пользовательских сессий

Стандартные London/New York продолжают использовать существующий календарь AYRA.
Общие `sessionDefs`, `instantOf`, часы других пользователей и других модулей не меняются.
Custom start/end — HH:mm в выбранной IANA zone. End < start означает следующий **локальный
календарный день**, не +24h в UTC. Start=end отвергается как неоднозначные 0/24 часа.
Зона валидируется Intl; UTC offset не заменяет IANA zone. Привязка session — по UUID.

`instantOf` предназначен для фиксированных часов AYRA и не является достаточным generic
resolver: тесты показывают gap London 29.03.2026 01:30 и New York 08.03.2026 02:30,
а fold даёт по два UTC instant для одного локального времени. Нельзя молча использовать
его «час сдвигается вперёд» для пользовательского расписания.

Для будущего custom resolver нужны round-trip проверка всех кандидатов, явные gap/fold
политики для start/end, правила local days/weekends/holiday semantics и срок доставки.
Предложение: gap пропускает occurrence; fold — один явно выбранный earlier/later instant,
без повторной отправки. Решение о днях custom sessions не выводится из Forex-календаря:
у пользователя может быть инструмент и стратегия с другим режимом.

**Custom session notifications остаются OFF** до отдельной проверки этой модели и тестов.
Создание/rename/изменение времени не создаёт сессионного уведомления само по себе.
Базовая идентичность occurrence должна переживать rename/config edits: space + instrument
+ session UUID + локальный civil cycle. Revision проверяет актуальность расчёта, но не
должна сама создавать новый dedupe key для уже обработанного цикла. Отмена и удаление
инвалидируют незавершённый расчёт; будущая доставка сохраняет WATCH-2C at-most-once contract.
При выборе custom session UI явно сообщает об отсутствии напоминаний, не показывает
ложное подтверждение. Standard reminders, completion и ручной reminder должны пройти
регрессию независимо. Custom POI не запускает ценовой мониторинг.

## UX и макеты

Один прежний блок внизу Watchlist, после TradingView Quotes. Четыре компактных селектора
с Add/Manage рядом, без отдельных карточек на инструмент. Редактор открывает только
нужный kind; Enter/Space/Escape, возврат фокуса, label/ARIA и мобильная вертикальная
компоновка обязательны. System/custom пометки, опасное удаление с подтверждением,
конфликт с сохранённым черновиком. Названия — пользовательский plain text, не переводы.

[Интерактивный HTML-макет](reference/watch2d-custom-focus.html) и screenshots — **проект**,
не работающий Market и не доказательство сохранения данных. Нет IDB, уведомлений,
сети или кнопки с ложным Saved. RU/EN задаётся query `?lang=ru` / `?lang=en`.

## Матрица приёмки реализации

| Область | Обязательная проверка |
|---|---|
| V2/V1→V3 | Реальная browser IDB, lazy record upgrade, поля/marks/receipts/opaque rows; abort, old pending writer, reopen |
| Catalog | CRUD, stable UUID, system protection, wrong kind, length/cap, tombstone/reference visibility |
| Конкуренция | Разные инструменты/поля, один тип, delete vs new reference, rename vs select, lost result |
| Account | A→B→Guest→A, purge generation, поздние ответы, offline/reload, без Guest copy |
| Reset/export/cleanup | Без потери каталога/marks при ошибке, только нужный scope, future versions/raw snapshot |
| Time | GMT/BST/US mismatch, gap/fold, overnight, end bounds, IANA invalid/aliases, изменившийся день |
| WATCH-2C | Standard sessions, last manual check, cancel/expiry, две вкладки, no new events on migration |
| UX | RU/EN; 360/390/768/1024/1440; keyboard/dialog focus; no overflow; нет false Saved |
| Регрессии | Watchlist pins/order/notes/TradingView; полный обязательный CI, без SQL/cloud/Q4.5 изменений |

## Утверждённое решение

Реализован V3 record gate при сохранении IDB V2. Обычные V2 rows, raw export и cleanup
сохраняют совместимость; старой вкладке необходимо обновление для чтения и редактирования
custom-записи, включая её чек-лист. Автоматического downgrade нет. Исходный HTML-макет
остаётся проектным артефактом; реальные скриншоты находятся в `screens/watch-2d-implementation`.

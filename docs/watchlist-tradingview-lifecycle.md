# WATCH-1A.1 — жизненный цикл котировок TradingView

## Причина

При закрытии Quotes во время загрузки асинхронный `embed-widget-market-quotes.js` мог выполниться после удаления своего script-тега. В `_replaceScript` официальный скрипт читает `scriptElement.parentNode`, затем вызывает `querySelector` без проверки на null. В read-only аудите получен stack: `_replaceScript`, `https://s3.tradingview.com/external-embedding/embed-widget-market-quotes.js:2:2414`. У первого production smoke-test сохранилось только сообщение; совпадение именно первого случая невозможно доказать без его стека.

Удаление script-тега не является гарантированной отменой уже начатой загрузки. Удерживать удалённые контейнеры до неопределённого ответа поставщика тоже небезопасно: они могут накапливаться.

## Решение

Только котировки Watchlist явно включают `isolateScript` и выполняют тот же официальный скрипт в отдельном iframe-документе (`srcdoc`). При закрытии, смене языка/списка, retry или уходе со страницы удаляется весь browsing context. Внутренний DOM загружающегося скрипта по отдельности не очищается. В том числе Overview, который тоже использует `market-quotes`, сохраняет прежний путь загрузки. Это дополнительно проверяется unit-тестами.

Это граница **жизненного цикла**, а не защита от недоверенного кода поставщика. Скрипт доверенный, как и до изменения, когда он выполнялся прямо в документе AYRA. Sandbox без same-origin был проверен и отвергнут: реальный TradingView обращается к cookies и не работает в opaque origin. Обычный iframe сохраняет существующую модель доверия и совместимость. Отдельный origin для более сильной security isolation потребовал бы другого инфраструктурного решения; здесь его нет.

Сохраняются загрузка только после раскрытия, максимальная высота 320 px, внутренняя прокрутка, источник/предупреждение о задержке и повторное открытие. Фильтры не меняют полный список котировок и не перезагружают его. Источники, конфигурация символов и бизнес-логика не изменены.

Один запуск имеет один родительский deadline (прежние 15 секунд) и один message listener. Внутри frame — один observer, отключаемый при появлении iframe поставщика. Готовность принимается только от contentWindow данного frame с совпадающим token и допустимым статусом. При ready startup listener/deadline удаляются; при ошибке или timeout удаляется сам frame. При размонтировании уничтожается весь документ со скриптами и observer. Retry начинает чистый контекст. Глобальных error/pageerror обработчиков с подавлением ошибок нет.

Ready, как и раньше, означает появление iframe поставщика, а не подтверждение актуальности цен.

## Регрессионные проверки

- Управляемая задержка внешнего JS: закрытие, смена языка, перестановка списка и переход к графику до завершения ответа.
- Fixture использует то же незащищённое обращение к parentNode. Отдельный контроль показывает исходный TypeError при старом удалении script-тега.
- После повторного открытия существует ровно один wrapper frame, один embed script и один внутренний iframe. Фильтры не вызывают повторный embed GET; после закрытия wrapper отсутствует. Все pageerror в рабочих сценариях проверяются, а не игнорируются.
- Unit: экранирование JSON/HTML, проверка источника postMessage, cleanup, timer, timeout и retry.
- Существующий Watchlist: RU/EN, 360/390/768/1024/1440 px, 30 инструментов, прокрутка и переход в график.
- Реальный официальный скрипт проверяется отдельно от детерминированных fixtures. Это проверка доступности из среды разработки, не заявление о production deployment.

## Ошибки промежуточных запусков

1. `npx tsc --noEmit`: `TS2339: Property 'toHaveBeenCalledExactlyOnceWith' does not exist on type 'Assertion<Mock<any, any>>'` — тестовый matcher отсутствует в установленном Vitest 1.6.1. Заменён на проверки числа вызовов и аргументов.
2. `npx vitest run lib/market/tradingview-quotes-frame.test.ts components/market/TradingViewWidget.test.tsx`, тест `disposes the entire pending browsing context and its deadline/listener`: `TypeError: Cannot read properties of undefined (reading 'contains')` — jsdom не реализует `iframe.sandbox` как DOMTokenList. Проверка изменена на поддерживаемые свойства DOM. Последующий sandbox-вариант полностью отвергнут по реальной совместимости.
3. Первый `npx playwright test -c playwright.supabase.config.ts e2e-supabase/market-watchlist-lifecycle.spec.ts e2e-supabase/market-watchlist-compact.spec.ts`: 15 PASS, 4 FAIL (`pending quotes: close/language/list/chart destroys the context, reopening has exactly one frame`). Точная причина: `SecurityError: Failed to read the 'sessionStorage' property from 'Window': The document is sandboxed and lacks the 'allow-same-origin' flag.` Также аналогичная ошибка для localStorage. Это промежуточная сборка sandbox-варианта; новый тест корректно обнаружил ошибки, хотя старые проверки видели только готовый iframe.
4. Реальный TradingView в sandbox-варианте дал `SecurityError: Failed to read the 'cookie' property from 'Document': The document is sandboxed and lacks the 'allow-same-origin' flag.` В окончательном обычном iframe символ EURUSD отобразился, JS-ошибок не было. Нельзя считать наличие пустого iframe достаточным доказательством работы внешнего поставщика.
5. Локальная Windows-обёртка `work/watch1a1-webkit.config.ts` вызвала `TS2769: No overload matches this call`: типизированный `base.webServer` допускает массив/undefined, поэтому его spread не гарантировал обязательный command. Обёртка исправлена явным webServer; она не входит в PR. Повторный `npx tsc --noEmit` — PASS.
6. CI run `44877032503`, mock-auth: `e2e/market-overview.spec.ts:68` — четыре случая Chromium/WebKit × 360/1440, на строке 91: `Expected substring: "FX:EURUSD"; Received string: ""; Timeout: 5000ms`. Получилось 444 PASS / 1 skip / 4 FAIL; fake Supabase не запускался. Исходная версия применила изоляцию ко всем market-quotes, включая Overview, а тесты ожидали прежнюю вложенность. Исправление ограничено явным opt-in Watchlist; тесты Overview не ослаблялись и не менялись. Две unit-проверки фиксируют эту границу.

## Итоги локальных проверок

- TypeScript и lint — PASS (только прежние предупреждения Login/Journal).
- 12 первоначальных целевых unit — PASS; после ограничения opt-in добавлены ещё две проверки границы Overview/Watchlist.
- 20 целевых fake Supabase E2E — PASS: 15 проверок компактного Watchlist и 5 lifecycle/контрольных тестов.
- Повтор lifecycle-набора пять раз — 25 PASS, без нестабильных падений.
- 20 существующих Chart/Watchlist E2E — PASS, Chromium и WebKit.
- Четыре lifecycle-сценария отдельно в WebKit — 4 PASS на готовой сборке; локальная Windows-обёртка не входит в PR.
- Реальная задержка официального скрипта вне production AYRA: ответ получен, wrapper закрыт до доставки JS, затем повторно открыт. Символ EURUSD отобразился; два embed GET, ноль pageerror; после закрытия остался только основной browser frame. Поставщик доступен из среды разработки; это не гарантия постоянной доступности.

Production, SQL, Supabase, API, cron и feature flags не менялись. WATCH-1B и WATCH-2 не реализованы.

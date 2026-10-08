# AYRA Trading — Spec v1.6: Журнал сделок (v1, T6a–T6c-1)

## Overview
Этот спецификационный документ описывает архитектуру данных, контракты, чистые формулы расчёта, аналитический движок Dashboard, Календаря и Отчётов, справочники, правила анти-фарма, пользовательские счета, стратегии (Playbook), Process Score, журнал «не вошёл» и интерфейс Журнала сделок v1 (этапы T6a, T6b и T6c-1).

---

## 1. Архитектура данных и репозиторий (`lib/journal/`)

- **Репозиторий:** Интерфейс `JournalRepository` реализован локально в `LocalStorageJournalRepository` с изолированным ключом `ayra_journal_v1` и `schemaVersion: 1`. В будущем (T7) реализация будет заменена на серверный клиент Supabase без изменения интерфейсов компонентов.
- **Хук `useJournal()`:** Предоставляет реактивное состояние для счетов, сделок и статистики заполнения хранилища.

### Размеры хранилища (Storage Usage)
- При превышении 80% объёма localStorage (>4MB от стандартного лимита ~5MB) показывается мягкое предупреждение с кнопкой мгновенного экспорта JSON.

---

## 2. Счета (`Account`)

```ts
export type AccountType = "personal" | "prop" | "demo";
export type AccountCurrency = "USD" | "EUR" | "GBP" | "GEL" | "RUB" | "UAH" | "KZT" | "USDT";

export interface Account {
  id: string;
  name: string | null; // null -> отображается из словаря ("Основной счёт" / "Main Account")
  type: AccountType;
  currency: AccountCurrency;
  startBalance?: number;
  platform: "manual";
  archivedAt?: string | null;
  createdAt: string; // ISO String
  propRules?: Record<string, unknown> | null; // Зарезервировано для T6d
}
```

### Правила счетов
1. Счёт со сделками **нельзя удалить** (вызывается исключение, интерфейс предлагает архивирование).
2. Пустой счёт удаляется с прямого подтверждения.
3. При отсутствии счетов при записи сделки включается встроенная быстрая форма создания счёта.

---

## 3. Сделки (`Trade`)

```ts
export type TradeDirection = "long" | "short";
export type TradeStatus = "open" | "closed";
export type TradeResult = "win" | "loss" | "breakeven";
export type TradeSession = "asia" | "london" | "newyork" | "overlap" | "other";
export type TradeVerification = "unverified" | "imported" | "connected" | "verified";

export interface Trade {
  id: string; // uuid / ts
  accountId: string;
  instrument: string; // Нормализовано в UPPERCASE без пробелов
  direction: TradeDirection;
  status: TradeStatus;
  openedAt: string; // ISO String
  closedAt?: string;
  entryPrice?: number;
  exitPrice?: number;
  stopLoss?: number;
  takeProfit?: number;
  size?: number;
  fees?: number;
  riskAmount?: number;
  pnlMoney?: number;
  rMultiple?: number;
  result: TradeResult;
  strategyId?: string | null;
  strategyVersion?: number | null;
  ruleChecks?: Record<string, "passed" | "failed" | "na">;
  processScore?: number | null;
  processScoreSnapshot?: ProcessScoreSnapshot | null;
  session?: TradeSession;
  emotions: string[];
  entryReason?: string; // до 500 символов
  mistakes: string[];
  executionRating?: number; // 1-5
  notes?: string; // до 1000 символов
  verification: TradeVerification; // "unverified" для ручных
  source: "manual";
  createdAt: string;
  updatedAt: string;
  schemaVersion: number; // version 2
}
```

### 3.1 Стратегия (`Strategy`)

```ts
export type RuleGroup = "entry" | "exit" | "risk" | "management";
export type RuleWeight = "required" | "optional";

export interface StrategyRule {
  id: string;
  group: RuleGroup;
  text: string; // до 120 символов
  weight: RuleWeight;
}

export interface Strategy {
  id: string;
  name: string | null; // null -> из словаря ("Моя стратегия")
  description?: string | null;
  color: string;
  rules: StrategyRule[];
  tags: string[]; // до 12 тегов
  riskLimit?: { type: "r" | "percent"; value: number } | null;
  allowedSessions?: TradeSession[] | null;
  version: number;
  archivedAt?: string | null;
  createdAt: string;
}
```

### 3.2 Журнал «не вошёл» (`NoTradeEntry`)

```ts
export type NoTradeReason =
  | "setup_incomplete"
  | "outside_session"
  | "risk_limit"
  | "news"
  | "emotional_state"
  | "plan_not_matching"
  | "other";

export interface NoTradeEntry {
  id: string;
  date: string; // YYYY-MM-DD или ISO
  accountId?: string | null;
  instrument?: string | null;
  reason: NoTradeReason;
  note?: string | null; // до 500 символов
  createdAt: string;
}
```

---

## 4. Чистые формулы и Аналитический движок (`lib/journal/calc.ts`, `lib/journal/stats.ts`)

Учитываются **только закрытые сделки** (`status === "closed"`).

### 4.1 Пороги и константы (`lib/game-config.ts`)
- `BREAKEVEN_R_THRESHOLD = 0.05` — порог безубытка в R.
- `JOURNAL_MIN_SAMPLE_SIZE = 20` — порог малой выборки. Если число сделок $< 20$, рядом с процентами и Profit Factor выводится нейтральная пометка «Мало данных: N сделок» без красных предупреждений.
- `MAX_ACTIVE_STRATEGIES = 10` — лимит активных стратегий.
- `MAX_RULES_PER_STRATEGY = 25` — лимит правил на стратегию.
- `PROCESS_SCORE`:
  - `WEIGHTS`: `{ rules: 50, risk: 25, session: 25 }`
  - `REQUIRED_RULE_MULTIPLIER = 2.0`
  - `MISTAKE_PENALTY_PER_ITEM = 15`
  - `MAX_MISTAKE_PENALTY = 30`
  - `THRESHOLDS`: `{ GOOD: 80, BAD: 50 }`
- `NO_TRADE_XP = 10` — XP характеристике «Дисциплина» за отказ от сделки.
- `NO_TRADE_DAILY_CAP = 1` — лимит засчитываемых отказов в день.

### 4.2 Формула Process Score (`lib/journal/process-score.ts`)

Оценка качества исполнения сделки $0..100$ рассчитывается чистыми функциями независимо от P&L:
1. **Правила (`rules`)**: соотношение выполненных правил к применимым. Обязательные правила (`required`) имеют вес 2.0, необязательные (`optional`) — 1.0. Неприменимые (`na`) исключаются.
2. **Риск (`risk`)**: 100%, если риск в R или % в пределах лимита стратегии.
3. **Сессия (`session`)**: 100%, если сессия сделки совпадает с разрешёнными сессиями стратегии.
4. **Штраф за ошибки (`mistakesPenalty`)**: $\min(15 \times \text{число ошибок (без other)}, 30)$.
5. **Нормировка:** При отсутствии базовых компонентов веса оставшихся нормируются до 100%. Если недоступен ни один базовый компонент, оценка `null` (`"—"`).
6. **Пороги Шкалы:** $\ge 80$ — Сильное исполнение, $50..79$ — Среднее, $<50$ — Есть над чем поработать.

### 4.2 Основные метрики
1. **Winrate:**
   $$\text{Winrate} = \frac{\text{Победы}}{\text{Все закрытые сделки}}$$
   *Примечание:* Безубыточные сделки учитываются в знаменателе.

2. **Результат:**
   - Сумма R: $\sum R_i$
   - Сумма в деньгах: $\sum \text{pnlMoney}_i$ (доступно только при единой валюте)
   - % от стартового баланса: $\sum (\text{pnlMoney}_i / \text{startBalance}_k) \times 100$

3. **Profit Factor:**
   $$\text{Profit Factor} = \frac{\text{Валовая прибыль}}{\text{Валовой убыток}}$$
   *Примечание:* Если валовой убыток $= 0$, возвращается `null` (отображается `"—"` в UI, без деления на 0).

4. **Expectancy (R):**
   $$\text{Expectancy R} = \frac{\sum R_i}{\text{Сделки с известным R}}$$

5. **Payoff Ratio:**
   $$\text{Payoff} = \frac{\text{Средний выигрыш R}}{|\text{Средний проигрыш R}|}$$

6. **Максимальная просадка (Max Drawdown):**
   - Рассчитывается от пика до дна по кривой накопленного результата:
   $$\text{Peak}_t = \max_{0 \le k \le t}(\text{Cum}_k), \quad \text{DD}_t = \text{Peak}_t - \text{Cum}_t, \quad \text{MaxDD} = \max_t(\text{DD}_t)$$

7. **Матрица «Процесс × Результат» (2×2):**
   - Хорошее исполнение ($\text{rating} \ge 4$) / Плохое исполнение ($\text{rating} \le 2$) против Win / Loss.
   - Сделки без оценки учитываются отдельным счётчиком.
   - Подпись: «Результат отдельной сделки не равен качеству решения».

8. **Мультивалютность:**
   - Деньги из разных валют никогда не суммируются.
   - Если в выборе несколько валют, денежные метрики и режим «$» заблокированы с подсказкой «Выбери один счёт или валюту».

---

## 5. Справочники по ID

- **Инструменты (автодополнение):** XAUUSD, NAS100, US30, SPX500, GER40, EURUSD, GBPUSD, USDJPY, USOIL, UKOIL, BTCUSD, ETHUSD.
- **Сессии:** `asia`, `london`, `newyork`, `overlap`, `other`.
- **Эмоции:** `calm`, `confident`, `focused`, `anxious`, `fearful`, `greedy`, `impatient`, `frustrated`, `euphoric`, `bored`, `tired`, `revenge`.
- **Ошибки:** `early_entry`, `late_entry`, `no_stop`, `moved_stop`, `oversized`, `overtrading`, `revenge_trade`, `ignored_plan`, `fomo`, `exited_early`, `held_too_long`, `news_ignored`, `other`.

---

## 6. Анти-фарм и правила XP

1. **Базовый XP:** Запись ручной сделки дает +10 XP характеристике `Trading`.
2. **Множитель уровня достоверности (`VERIFICATION_XP_MULTIPLIER`):**
   - `unverified` (ручной ввод): 1.0x (10 XP)
   - `imported`: 1.2x (12 XP)
   - `connected`: 1.5x (15 XP)
   - `verified`: 1.5x (15 XP)
3. **Дневной лимит:** Максимум 3 сделки в день (`MAX_DAILY_TRADE_XP_COUNT = 3`) дают XP.
4. **Проверки правдоподобия:**
   - Дубликаты (тот же счёт, инструмент, направление и время в пределах 1 мин) даёт 0 XP.
   - Даты из будущего (>24 часов в будущем) даёт 0 XP.
5. **Квест `q_tradelog`:** Закрывается автоматически и идемпотентно при первой записанной сделке за день.
6. **Достижение:** «Первая сделка» (`firstTrade`) открывается одноразово при первой записанной сделке.
7. **XP за скриншоты к сделкам (T6c-2b):**
   - За прикреплённый к сделке валидный скриншот начисляется +10 XP характеристике `Trading`.
   - **Дневной лимит:** не более 1 засчитываемого скриншота в день (`SCREENSHOT_DAILY_XP_CAP = 1`).
   - **Размер:** минимальный размер по меньшей стороне $\ge 300\text{ px}$.
   - **Анти-дубли:** повторное добавление файла с тем же хэшем SHA-256 XP не даёт.
   - **Проверка времени:** добавление к сделке с датой из будущего XP не даёт.
   - **Достижение:** одноразовое «Первый скриншот» (`firstScreenshot`).

---

## 7. Модель вложений и локальное хранилище IndexedDB (T6c-2b)

- **Интерфейс `AttachmentRepository`:** Хранение оригиналов и превью изображений в IndexedDB (`ayra_attachments_v1`). В объекте сделки `Trade` сохраняется только массив `attachmentIds: string[]` (`schemaVersion: 3`).
- **Метаданные вложения (`AttachmentMetadata`):**
  - `id`, `tradeId`, `kind` (`before` | `after` | `other`), `width`, `height`, `bytes`, `mime` (`image/png` | `image/jpeg` | `image/webp`), `hash` (SHA-256), `createdAt`, `caption` (до 120 символов).
- **Обработка изображений (`ImageProcessor`):**
  - Валидация по Magic Bytes (PNG, JPEG, WebP; SVG и GIF отклоняются).
  - Лимит размера исходного файла 10 МБ, защита от пиксельных «бомб» ($>40\text{ МП}$).
  - Декодирование и повторное кодирование через Canvas (автоматическое удаление EXIF и геоданных).
  - Масштабирование длинной стороны до 1600 px, WebP качество ~0.82 (с запасом JPEG), создание превью 320 px.
- **Ограничения хранилища:**
  - Предупреждение в Settings при заполнении IndexedDB $\ge 80\%$.
  - Запрос `navigator.storage.persist()` при первом добавлении.
  - Автоматическая фоновая очистка «осиротевших» вложений ($>24$ часов без соответствующего `tradeId`).

---

## 8. Экспорт JSON (версия `"1.3"`)

Экспорт включает метаданные вложений без двоичных данных картинки:
```json
{
  "app": "ayra",
  "exportVersion": "1.3",
  "exportedAt": "2026-10-08T12:00:00.000Z",
  "user": { ... },
  "journal": {
    "accounts": [ ... ],
    "trades": [ ... ],
    "strategies": [ ... ],
    "noTrades": [ ... ],
    "attachments": [
      {
        "id": "att_123",
        "tradeId": "tr_456",
        "kind": "before",
        "width": 1600,
        "height": 900,
        "bytes": 240120,
        "mime": "image/webp",
        "hash": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
        "createdAt": "2026-10-08T12:00:00.000Z",
        "caption": "Breakout setup"
      }
    ],
    "imagesIncluded": false
  }
}
```
*Примечание:* Демо-сделки полностью исключаются из экспорта JSON и из расчёта статистики профиля.

---

## 9. План на следующие этапы (T6c-2c – T7)

- **T6c-2c:** Инструменты разметки графиков (фигуры, стрелки, уровни, текст) поверх скриншотов.
- **T6d:** Prop Rules Tracker (трекинг правил проп-челленджей) и кастомные расширенные отчеты.
- **T7:** Облачная синхронизация Supabase (хранение скриншотов в Supabase Storage).

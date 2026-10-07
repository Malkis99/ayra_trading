# AYRA Trading — Spec v1.6: Журнал сделок (v1, T6a–T6b)

## Overview
Этот спецификационный документ описывает архитектуру данных, контракты, чистые формулы расчёта, аналитический движок Dashboard, Календаря и Отчётов, справочники, правила анти-фарма, пользовательские счета и интерфейс Журнала сделок v1 (этапы T6a и T6b).

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
  strategyId?: string; // Зарезервировано для T6c
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
  schemaVersion: number;
}
```

---

## 4. Чистые формулы и Аналитический движок (`lib/journal/calc.ts`, `lib/journal/stats.ts`)

Учитываются **только закрытые сделки** (`status === "closed"`).

### 4.1 Пороги и константы (`lib/game-config.ts`)
- `BREAKEVEN_R_THRESHOLD = 0.05` — порог безубытка в R.
- `JOURNAL_MIN_SAMPLE_SIZE = 20` — порог малой выборки. Если число сделок $< 20$, рядом с процентами и Profit Factor выводится нейтральная пометка «Мало данных: N сделок» без красных предупреждений.

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

---

## 7. Экспорт JSON (версия `"1.1"`)

Экспорт включает блок `journal`:
```json
{
  "app": "ayra",
  "exportVersion": "1.1",
  "exportedAt": "2026-10-05T12:00:00.000Z",
  "user": { ... },
  "journal": {
    "accounts": [ ... ],
    "trades": [ ... ]
  }
}
```
*Примечание:* Демо-сделки полностью исключаются из экспорта JSON и из расчёта статистики профиля.

---

## 8. План на следующие этапы (T6c – T6d)

- **T6c:** Стратегии (Playbook), теги сетапов, прикрепление и разметка скриншотов графиков.
- **T6d:** Prop Rules Tracker (трекинг правил проп-челленджей) и расширенные отчеты.

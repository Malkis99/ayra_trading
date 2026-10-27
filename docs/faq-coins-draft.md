# FAQ: монеты — черновик (RU / EN)

Статус: **черновик для будущего FAQ** (2026-10-27). Тексты сняты с вкладки «Монеты» в профиле: по решению владельца там остались только баланс и история начислений.

Числа — по правилам в `lib/game-config.ts` и `lib/quests.ts` на эту дату. Если правила изменятся, числа здесь нужно сверить.

---

## RU

**Где хранятся монеты?**
Монеты пока хранятся на этом устройстве. Общий баланс для всех устройств появится вместе с серверной экономикой.

**Как получить монеты?**

- **Ежедневная награда.** Раз в день на «Главной», по дню серии: +10 · +10 · +15 · +15 · +20 · +25 · +50.
- **Задания дня, которые приложение проверяет само.** Они закрываются сами по журналу, один раз в день, по +10 монет:
  - запись сделки в журнал;
  - Daily Bias перед сессией;
  - проверка дневного лимита риска;
  - 10 минут рефлексии.
- **Первое действие — один раз на аккаунт.** Награда за первое действие каждого вида:
  - счёт — +10, сделка — +20, импорт — +20, стратегия — +10;
  - заметка, план дня, план недели, «Не вошёл», скриншот — по +5.

  Если такие записи уже есть (в том числе удалённые или пришедшие с другого устройства), второй раз награда не начисляется. Статусы: «получено», «уже было раньше».

**Есть ли ограничения?**

- Не больше 100 монет в день с заданий и ежедневной награды.
- Задания, которые отмечаются вручную (прогулка, медитация и т. п.), дают только XP.
- Правка, повторное сохранение, синхронизация, «Отменить» и перенос гостя монет не дают.

**Почему в истории не все мои монеты?**
История ведётся с даты, указанной на вкладке. Более ранние начисления в ней не показаны, но учтены в балансе.

---

## EN

**Where are coins kept?**
Coins are kept on this device for now. One balance for all devices comes with the server economy.

**How do I earn coins?**

- **Daily reward.** Once a day on Home, by the day of your streak: +10 · +10 · +15 · +15 · +20 · +25 · +50.
- **Daily quests the app checks itself.** They close by themselves from the journal, once a day, +10 coins each:
  - log a trade in the journal;
  - Daily Bias before the session;
  - daily risk limit check;
  - 10 minutes of reflection.
- **First action — once per account.** A reward for the first action of each kind:
  - account +10, trade +20, import +20, strategy +10;
  - note, day plan, week plan, “Did not trade”, screenshot +5 each.

  If such records already exist (deleted ones or ones from another device included), it is not given again. Statuses: “received”, “done before”.

**Are there limits?**

- At most 100 coins a day from quests and the daily reward.
- Quests you tick yourself (a walk, meditation, etc.) give XP only.
- Edits, saving again, sync, “Undo” and the guest copy give no coins.

**Why are not all my coins in the history?**
The history is kept since the date shown on the tab. Earlier credits are not listed but are in the balance.

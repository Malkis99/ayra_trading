# AYRA Trading — Spec v1.7: Схема базы данных, правила доступа (RLS) и серверная архитектура

Документ описывает реализацию T7a (база данных, RLS, вход по почте) и закладывает основу для этапов T7b–T7d.

---

## 1. Схема базы данных (Database Schema)

### 1.1 `public.profiles`
Таблица профилей пользователей, связанная 1:1 с `auth.users`.

| Колонка | Тип | Ограничения | Описание |
|---|---|---|---|
| `id` | UUID | PK, REFS `auth.users(id)` ON DELETE CASCADE | Уникальный идентификатор пользователя |
| `nickname` | TEXT | UNIQUE, CHECK `^[A-Za-z0-9_.-]{3,24}$` | Отображаемое имя (уникальное регистронезависимо через индекс `LOWER(nickname)`) |
| `locale` | TEXT | NOT NULL, DEFAULT 'ru', CHECK `IN ('ru', 'en')` | Предподчитаемый язык интерфейса |
| `timezone` | TEXT | NOT NULL, DEFAULT 'UTC' | Часовой пояс пользователя |
| `age_group` | TEXT | CHECK `IN ('16-17', '18-24', '25-34', '35+')` | Возрастная категория |
| `minor_mode` | BOOLEAN | NOT NULL, DEFAULT FALSE | Вычисляется автоматически триггером `tr_profiles_minor_mode` из `age_group` |
| `consent_at` | TIMESTAMPTZ | NULLABLE | Дата и время принятия Условий и Политики конфиденциальности |
| `consent_version` | TEXT | NULLABLE | Версия принятого юридического документа (напр. '1.0-draft') |
| `created_at` | TIMESTAMPTZ | NOT NULL, DEFAULT `now()` | Дата создания профиля |
| `updated_at` | TIMESTAMPTZ | NOT NULL, DEFAULT `now()` | Обновляется триггером `tr_profiles_updated_at` |

### 1.2 `public.audit_log`
Журнал аудит-событий безопасности.

| Колонка | Тип | Описание |
|---|---|---|
| `id` | UUID | PK, DEFAULT `gen_random_uuid()` |
| `user_id` | UUID | REFS `auth.users(id)` ON DELETE CASCADE |
| `event` | TEXT | Название события (напр. 'age_group_changed') |
| `meta` | JSONB | Дополнительные данные события |
| `created_at` | TIMESTAMPTZ | Время записи события |

### 1.3 Резервные таблицы T7c (Заблокированы RLS по умолчанию)
- `public.telegram_identities`: (`user_id` UUID PK, `telegram_id` BIGINT UNIQUE, `linked_at` TIMESTAMPTZ).
- `public.link_tokens`: (`token_hash` TEXT PK, `user_id` UUID, `expires_at` TIMESTAMPTZ, `used_at` TIMESTAMPTZ).

---

## 2. Таблица политик доступа (RLS Matrix)

Row Level Security включён на всех таблицах. Права на `public.profiles` ограничены на уровне колонок для роли `authenticated`.

| Таблица | Роль | Разрешённые операции | Условие RLS / Ограничения колонок |
|---|---|---|---|
| `profiles` | `anon` | None (запрещено) | Доступ полностью закрыт |
| `profiles` | `authenticated` | `SELECT` | `auth.uid() = id` (только собственная строка) |
| `profiles` | `authenticated` | `UPDATE` | `auth.uid() = id`. Разрешены только колонки: `nickname`, `locale`, `timezone`, `age_group`, `consent_at`, `consent_version`. Изменение `minor_mode`, `id`, `created_at` клиентом напрямую запрещено! |
| `profiles` | `authenticated` | `INSERT` / `DELETE` | Запрещено клиенту (создаётся триггером `handle_new_user`, удаляется CASCADE) |
| `audit_log` | `anon` / `authenticated` | None | Вставка выполняется только из `SECURITY DEFINER` функций (RPC `set_age_group`) |
| `telegram_identities` | `anon` / `authenticated` | None | Политики отсутствуют (доступ закрыт, используется только сервером) |
| `link_tokens` | `anon` / `authenticated` | None | Политики отсутствуют (доступ закрыт, используется только сервером) |

---

## 3. Переменные окружения (Environment Variables)

| Переменная | Назначение | Доступность на клиенте | Описание |
|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | URL проекта Supabase | Да (клиент и сервер) | Публичный URL экземпляра Supabase |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Анонимный ключ Supabase | Да (клиент и сервер) | Публичный анонимный API ключ с ограничениями RLS |
| `AYRA_E2E_AUTH_MOCK` | Флаг эмуляции авторизации | Нет (только CI / E2E) | Устанавливается в `1` для Playwright и Vitest мока. Запрещён в продакшене |

> **СТРОГИЙ ЗАПРЕТ:** Использование `SUPABASE_SERVICE_ROLE_KEY` в клиентском коде или включение его в клиентский бандл строго запрещено.

---

## 4. Инструкция по настройке для владельца (Setup Guide)

1. **Создание проекта в Supabase:**
   - Зарегистрируйте проект на [supabase.com](https://supabase.com).
   - Скопируйте **Project URL** и **anon / public key**.

2. **Настройка переменных окружения в Vercel / Vercel Preview:**
   - Добавьте `NEXT_PUBLIC_SUPABASE_URL` и `NEXT_PUBLIC_SUPABASE_ANON_KEY` в переменные окружения проекта Vercel.

3. **Настройка Email Провайдера и Шаблона писем:**
   - В Supabase Dashboard перейдите в **Authentication** -> **Email Templates**.
   - Скопируйте содержимое файла `supabase/email-templates/otp.html` и вставьте его в шаблон Magic Link / OTP.

4. **Применение миграции и проверка RLS:**
   - В Supabase Dashboard откройте **SQL Editor**.
   - Выполните скрипт из файла `supabase/migrations/0001_init.sql`.
   - Выполните тестовый скрипт из `supabase/tests/rls.sql` для проверки правильности изоляции данных.

---

## 5. Модель угроз и ограничения (Threat Model & Limitations)

1. **Клиентская авторитетность наград в T7a:**
   - На этапе T7a расчет XP, Coins и наград выполняется на клиенте для сохранения работоспособности локального гостевого режима.
   - **Ограничение:** Продвинутый пользователь может изменить локальное состояние в браузерном хранилище. Серверная авторитетность с ledger-журналом начислений и валидацией будет внедрена на этапе E1 (перед экономикой с реальной ценностью).

2. **Защита от перебора никнеймов:**
   - Запросы к RPC `is_nickname_available` выполняются с клиентским дебаунсом (debounce 300ms). В будущем на сервере будет добавлен rate limiting.

3. **Защита от Open Redirect:**
   - Параметр `next` при обработке `/auth/callback` и `/login` строго строгифицируется и проверяется функцией `sanitizeRedirectUrl`. Все внешние ссылки (напр. `http://`, `//`) отвергаются с возвратом на `/`.

---

## 6. Дорожная карта T7b–T7d

- **T7b (Синхронизация данных):** Перенос и объединение локального журнала сделок, планов и настроек с облачной базой данных после входа.
- **T7c (Telegram Интеграция):** Привязка Telegram аккаунта, валидация `initData`, одноразовые токены слияния аккаунтов.
- **T7d (Управление аккаунтом):** Полное удаление аккаунта по GDPR/приватам, экспорты данных, сессии устройств.

---

## 7. Чек-лист ручной проверки на предпросмотре (Preview Checklist)

- [ ] Вход в гостевом режиме: приложение загружается без паданий в консоли при отсутствии переменных окружения.
- [ ] Форма `/login`: ввод почты -> чекбокс согласия -> отправка OTP кода -> повторный таймер (60 сек) заблокирован.
- [ ] Страницы `/legal/terms` и `/legal/privacy`: плашка «Черновик» отображается на RU и EN.
- [ ] Онбординг `/awakening`: занятый ник 'taken_nick' вызывает ошибку и предлагает ввести другой; итоговый ник сохраняется.
- [ ] Настройки `/settings`: раздел «Аккаунт» показывает текущую почту и дату регистрации, кнопка «Выйти» очищает сессию.

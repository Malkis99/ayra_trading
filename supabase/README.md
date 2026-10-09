# AYRA Trading — Supabase Instructions & Migration Setup

> **ВНИМАНИЕ / WARNING:** Внимательно проверьте SQL перед запуском в рабочей или тестовой базе данных Supabase!

## Порядок применения миграций (Migration Order)

1. Откройте **Supabase Dashboard** -> **SQL Editor**.
2. Скопируйте и выполните содержимое файла `supabase/migrations/0001_init.sql`.
   - Создаёт таблицу `public.profiles` с каскадным удалением от `auth.users`.
   - Настраивает триггеры для вычисления `minor_mode` и автоматического создания пустых профилей.
   - Включает RLS на всех таблицах и ограничивает UPDATE на уровне колонок для роли `authenticated`.
   - Создаёт RPC-функции `is_nickname_available` и `set_age_group`.
   - Создаёт резервные таблицы `telegram_identities` и `link_tokens` без политик (доступ закрыт по умолчанию).

## Проверка RLS (Manual Verification)

1. Откройте **Supabase Dashboard** -> **SQL Editor**.
2. Вставьте содержимое `supabase/tests/rls.sql` и нажмите **Run**.
3. Убедитесь, что запросы выполняются успешно без ошибок синтаксиса и что изоляция пользователей соблюдается.

## Настройка шаблона писем (Email OTP Template Setup)

1. В **Supabase Dashboard** перейдите в раздел **Authentication** -> **Email Templates**.
2. Выберите шаблон **Magic Link** или **Confirm signup / OTP**.
3. Скопируйте HTML из файла `supabase/email-templates/otp.html` и вставьте его в редактор шаблона.
4. Сохраните изменения.

## Откат изменений (Rollback)

Для полной очистки базы данных и отката схемы выполните содержимое файла `supabase/migrations/0001_init.down.sql`.

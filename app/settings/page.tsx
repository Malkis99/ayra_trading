"use client";

import React from "react";

export default function SettingsPage() {
  return (
    <div className="space-y-4 max-w-2xl">
      <div>
        <h1 className="font-serif text-2xl font-bold text-tx">Настройки</h1>
        <p className="text-xs text-mu mt-1">Профиль, язык, приватность и параметры аккаунта</p>
      </div>

      <div className="card space-y-4">
        <h4 className="h4">Параметры интерфейса</h4>
        <div className="text-xs text-mu space-y-2">
          <p>• Переключение языка интерфейса (RU / EN) будет доступно в Т2.</p>
          <p>• Настройка темы: тёмная графитовая тема по умолчанию.</p>
          <p>• Уведомления и приватность в социальных разделах.</p>
        </div>
      </div>
    </div>
  );
}

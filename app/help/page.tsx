"use client";

import React from "react";

export default function HelpPage() {
  return (
    <div className="space-y-4 max-w-2xl">
      <div>
        <h1 className="font-serif text-2xl font-bold text-tx">Помощь и справка</h1>
        <p className="text-xs text-mu mt-1">Ответы на часто задаваемые вопросы и поддержка</p>
      </div>

      <div className="card space-y-4">
        <h4 className="h4">Часто задаваемые вопросы</h4>
        <div className="text-xs text-mu space-y-3">
          <div>
            <b className="text-tx block mb-1">Что такое AYRA Trading?</b>
            Платформа для трейдеров, превращающая ежедневную торговую дисциплину в рост игрового персонажа.
          </div>
          <div>
            <b className="text-tx block mb-1">Влияет ли подписка на XP или рейтинг?</b>
            Нет. Подписки Free/Pro/Elite расширяют аналитический инструментарий и доступ к косметике, но никогда не дают преимуществ в XP, рейтингах или репутации.
          </div>
        </div>
      </div>
    </div>
  );
}

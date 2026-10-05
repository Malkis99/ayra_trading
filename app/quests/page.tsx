"use client";

import React, { useState } from "react";
import { TabHeader } from "@/components/TabHeader";

const tabs = ["Today", "Week", "Goals", "Discipline", "History"];

export default function QuestsPage() {
  const [activeTab, setActiveTab] = useState(0);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-serif text-2xl font-bold text-tx">Quests</h1>
        <p className="text-xs text-mu mt-1">Персонализированные ежедневные задания и дисциплина</p>
      </div>

      <TabHeader tabs={tabs} activeTab={activeTab} onTabChange={setActiveTab} />

      <div className="card">
        <h4 className="h4">Вкладка: {tabs[activeTab]}</h4>
        <p className="text-xs text-mu">Раздел находиться в разработке (T3). Наказаний за пропуски нет.</p>
        <div className="mt-4 h-32 rounded-xl bg-s2/50 border border-line border-dashed flex items-center justify-center text-xs text-mu">
          Список квестов {tabs[activeTab]}
        </div>
      </div>
    </div>
  );
}

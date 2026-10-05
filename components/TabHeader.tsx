"use client";

import React from "react";

interface TabHeaderProps {
  tabs: string[];
  activeTab: number;
  onTabChange: (index: number) => void;
}

export function TabHeader({ tabs, activeTab, onTabChange }: TabHeaderProps) {
  if (tabs.length <= 1) return null;

  return (
    <div className="tabs">
      {tabs.map((tab, idx) => (
        <button
          key={tab}
          onClick={() => onTabChange(idx)}
          className={`tab ${idx === activeTab ? "on" : ""}`}
        >
          {tab}
        </button>
      ))}
    </div>
  );
}

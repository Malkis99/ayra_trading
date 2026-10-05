"use client";

import React from "react";
import { useApp } from "@/lib/context";

export default function HelpPage() {
  const { dict } = useApp();

  return (
    <div className="space-y-4 max-w-2xl">
      <div>
        <h1 className="font-serif text-2xl font-bold text-tx">{dict.help.title}</h1>
        <p className="text-xs text-mu mt-1">{dict.help.subtitle}</p>
      </div>

      <div className="card space-y-4">
        <h4 className="h4">{dict.help.faqTitle}</h4>
        <div className="text-xs text-mu space-y-3">
          <div>
            <b className="text-tx block mb-1">{dict.help.q1}</b>
            {dict.help.a1}
          </div>
          <div>
            <b className="text-tx block mb-1">{dict.help.q2}</b>
            {dict.help.a2}
          </div>
        </div>
      </div>
    </div>
  );
}

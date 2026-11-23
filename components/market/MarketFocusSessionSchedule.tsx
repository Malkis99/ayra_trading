"use client";
import React from "react";
import { useApp } from "@/lib/context";
import type { SessionReminder } from "@/lib/market/custom-session-time";

export function MarketFocusSessionSchedule({ value, disabled, onChange }: { value: SessionReminder; disabled: boolean; onChange: (value:SessionReminder)=>void }) {
  const t=useApp().dict.market.focus.customSession;
  return <fieldset className="min-w-0 space-y-2 rounded border border-pri/30 p-3 sm:col-span-2" disabled={disabled} data-testid="focus-session-schedule">
    <legend className="px-1 text-xs text-mu">{t.title}</legend>
    <div className="flex flex-wrap gap-x-3 gap-y-1">{t.days.map((label,index)=>{const day=index+1;return <label key={day} className="flex min-h-[44px] items-center gap-1.5 text-xs"><input type="checkbox" checked={value.days.includes(day)} onChange={event=>onChange({...value,days:event.target.checked?[...value.days,day].sort():value.days.filter(d=>d!==day)})} />{label}</label>;})}</div>
    {!value.days.length && <p role="status" className="text-xs text-mu">{t.noDays}</p>}
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2"><label className="flex min-h-[44px] items-center gap-2 text-xs"><input type="checkbox" data-testid="focus-custom-session-enabled" checked={value.enabled} onChange={event=>onChange({...value,enabled:event.target.checked})}/>{t.enable}</label>
      <label className="flex min-h-[44px] items-center gap-2 text-xs">{t.lead}<select className="rounded border border-pri bg-bg p-2" value={value.lead} onChange={event=>onChange({...value,lead:Number(event.target.value)})}>{[0,5,15].map(n=><option key={n} value={n}>{n}</option>)}</select></label></div>
    <p className="text-[11px] text-mu">{t.local}</p><p className="text-[11px] text-mu">{t.dst}</p>
  </fieldset>;
}

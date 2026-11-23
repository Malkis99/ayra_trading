"use client";

import React, { useEffect, useRef, useState } from "react";
import { Pencil, Trash2, LockKeyhole } from "lucide-react";
import { useApp } from "@/lib/context";
import { formatString } from "@/lib/i18n";
import { FOCUS_FIELDS, FOCUS_ITEM_LIMIT, FOCUS_TEXT_LIMIT, focusText, type FocusField } from "@/lib/market/market-focus";
import { validateCustomSession, sessionReminder, type CustomSession, type CatalogItem, type CatalogCommand, type CatalogSnapshot } from "@/lib/market/focus-catalog";
import { defaultSessionReminder, type SessionReminder } from "@/lib/market/custom-session-time";
import { instrumentName, isInstrumentId } from "@/lib/market/instruments";
import { browserTimeZone } from "@/lib/timezones";
import { Button, Input } from "@/components/ui";
import { TimezoneSelect } from "@/components/TimezoneSelect";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import type { FocusIssue } from "@/lib/market/use-market-focus";
import { MarketFocusSessionSchedule } from "./MarketFocusSessionSchedule";

type Draft = { id?: string; revision?: number; label: string; start: string; end: string; zone: string; reminders: SessionReminder; scheduled: boolean };
const fresh = (): Draft => ({ label: "", start: "", end: "", zone: browserTimeZone(), reminders: defaultSessionReminder(), scheduled:true });
const fromItem = (item: CatalogItem): Draft => ({ id: item.id, revision: item.revision, label: item.label, start: item.session?.start ?? "", end: item.session?.end ?? "", zone: item.session?.zone ?? browserTimeZone(), reminders: item.session ? sessionReminder(item.session) : defaultSessionReminder(), scheduled:item.session?.reminders !== undefined });
export function MarketFocusCatalogEditor({ field, snapshot, pending, issue, change, reload, close }: {
  field: FocusField; snapshot?: CatalogSnapshot; pending: boolean; issue?: FocusIssue;
  change: (command: CatalogCommand) => Promise<boolean>; reload: () => void; close: () => void;
}) {
  const { dict } = useApp(), f = dict.market.focus, t = f.catalog;
  const [draft, setDraft] = useState<Draft>(fresh), [saved, setSaved] = useState(false);
  const [removing, setRemoving] = useState<{ item: CatalogItem; references: string[]; conflict: boolean } | null>(null);
  const input = useRef<HTMLInputElement>(null), alive = useRef(true), submitting = useRef(false);
  useEffect(() => { alive.current = true; input.current?.focus(); return () => { alive.current = false; }; }, []);
  const items = snapshot?.catalog.items.filter(item => item.kind === field && !item.deleted) ?? [];
  const current = snapshot?.catalog.items.find(item => item.id === draft.id);
  const changed = !!draft.id && (!current || current.deleted || current.revision !== draft.revision);
  let valid = false;
  try { focusText(draft.label); if (field === "session") validateCustomSession({ start: draft.start, end: draft.end, zone: draft.zone, ...(draft.scheduled ? { reminders: draft.reminders } : {}) }); valid = true; } catch { /* Draft remains visible. */ }
  const duplicate = items.some(item => item.id !== draft.id && item.label.toLocaleLowerCase() === draft.label.trim().toLocaleLowerCase());
  const submit = async () => {
    if (!valid || pending || issue || changed || submitting.current) return;
    submitting.current = true; setSaved(false);
    const values = { label: draft.label, ...(field === "session" ? { session: { start: draft.start, end: draft.end, zone: draft.zone, ...(draft.scheduled ? { reminders: draft.reminders } : {}) } } : {}) };
    try {
      const id=draft.id ?? crypto.randomUUID();
      const ok = await change(draft.id ? { update: id, itemRevision: draft.revision!, ...values } : { create: id, kind: field, ...values });
      if (ok && alive.current) { setDraft(field === "session" ? {...draft,id,revision:(draft.revision??0)+1} : fresh()); setSaved(true); input.current?.focus(); }
    } finally { submitting.current = false; }
  };
  const remove = async () => {
    if (!removing || pending || submitting.current) return;
    if (removing.conflict) { setRemoving(null); reload(); return; }
    submitting.current = true;
    try {
      const ok = await change({ remove: removing.item.id, itemRevision: removing.item.revision, references: removing.references });
      if (!alive.current) return;
      if (ok) { if (draft.id === removing.item.id) setDraft(fresh()); setRemoving(null); setSaved(true); input.current?.focus(); }
      else setRemoving({ ...removing, conflict: true });
    } finally { submitting.current = false; }
  };
  const updateDraft = (value: Partial<Draft>) => { setSaved(false); setDraft(old => ({ ...old, ...value })); };
  const sessionSummary = (session:CustomSession) => {
    const value=sessionReminder(session),s=f.customSession;
    return `${value.days.map(day=>s.days[day-1]).join(", ") || s.noDays} · ${value.enabled ? formatString(s.enabledLabel,{lead:value.lead}) : s.disabledLabel}`;
  };
  return <div className="mt-4 min-w-0 border-y border-pri/30 py-3" data-testid="focus-catalog-editor" onKeyDown={event => { if (event.key === "Escape" && !removing && !event.defaultPrevented) { event.stopPropagation(); close(); } }}>
    <div className="flex items-start justify-between gap-2"><h3 className="text-sm font-medium">{formatString(t.title, { field: f.fields[field] })}</h3><Button size="sm" variant="ghost" onClick={close}>{t.close}</Button></div>
    <p className="mt-1 text-[11px] text-mu">{t.local}</p>
    <div className="my-2 flex flex-wrap gap-2">{FOCUS_FIELDS[field].map(value => <span key={value} className="inline-flex items-center gap-1 rounded border border-pri/20 px-2 py-1 text-[11px] text-mu"><LockKeyhole size={11} aria-hidden="true" />{field === "mss" && value === "bullish" ? f.options.mssBullish : field === "mss" && value === "bearish" ? f.options.mssBearish : f.options[value]} <span className="sr-only">{t.systemTag}</span></span>)}</div>
    <ul className="my-2 max-h-56 overflow-y-auto divide-y divide-pri/20">{items.map(item => <li key={item.id} className="flex min-w-0 items-center gap-2 py-1" data-testid={`focus-catalog-item-${item.id}`}>
      <span className="min-w-0 flex-1 break-words text-xs">{item.label}{items.filter(other => other.label.toLocaleLowerCase() === item.label.toLocaleLowerCase()).length > 1 && <span className="block break-all text-[10px] text-mu">{item.id}</span>}{item.session && <span className="block text-[10px] text-mu">{item.session.start}–{item.session.end} · {item.session.zone}<span className="block">{sessionSummary(item.session)}</span></span>}</span>
      <button type="button" className="min-h-[44px] min-w-[44px] rounded text-mu hover:text-vi focus-visible:ring-2 focus-visible:ring-vi" aria-label={`${t.edit}: ${item.label}`} disabled={pending} onClick={() => { setDraft(fromItem(item)); setSaved(false); input.current?.focus(); }}><Pencil size={14} className="mx-auto" aria-hidden="true" /></button>
      <button type="button" className="min-h-[44px] min-w-[44px] rounded text-mu hover:text-danger focus-visible:ring-2 focus-visible:ring-vi" aria-label={`${t.remove}: ${item.label}`} disabled={pending || !!issue || !snapshot?.referencesKnown} onClick={() => setRemoving({ item, references: [...(snapshot?.references[item.id] ?? [])], conflict: false })}><Trash2 size={14} className="mx-auto" aria-hidden="true" /></button>
    </li>)}</ul>
    {!items.length && <p className="my-2 text-xs text-mu">{t.empty}</p>}
    {snapshot && !snapshot.referencesKnown && <p role="alert" className="my-2 text-xs text-mu">{t.unknownReferences}</p>}
    <form onSubmit={event => { event.preventDefault(); void submit(); }} className="space-y-3">
      <Input ref={input} label={t.label} value={draft.label} onChange={event => updateDraft({ label: event.target.value })} disabled={pending} data-testid="focus-catalog-name" />
      <p className="text-[10px] text-mu">{Array.from(draft.label.trim()).length} / {FOCUS_TEXT_LIMIT} · {formatString(t.count, { n: items.length, max: FOCUS_ITEM_LIMIT })}</p>
      {field === "session" && <div className="grid min-w-0 gap-3 sm:grid-cols-2"><Input type="time" label={t.start} value={draft.start} onChange={event => updateDraft({ start: event.target.value })} disabled={pending} data-testid="focus-session-start" /><Input type="time" label={t.end} value={draft.end} onChange={event => updateDraft({ end: event.target.value })} disabled={pending} data-testid="focus-session-end" /><div className="min-w-0 sm:col-span-2"><TimezoneSelect label={t.zone} value={draft.zone} onChange={zone => updateDraft({ zone })} disabled={pending} /></div>{draft.start && draft.end && draft.end < draft.start && <p className="text-xs text-mu sm:col-span-2">{t.overnight}</p>}<MarketFocusSessionSchedule value={draft.reminders} disabled={pending} onChange={reminders => updateDraft({ reminders, scheduled:true })} /></div>}
      {duplicate && <p role="status" className="text-xs text-mu">{t.duplicate}</p>}
      {changed && <p role="alert" className="text-xs text-vi">{t.changed} {current && !current.deleted && <Button size="sm" variant="ghost" onClick={() => { setDraft(fromItem(current)); setSaved(false); reload(); }}>{t.useLatest}</Button>}</p>}
      <div className="flex flex-wrap gap-2"><Button type="submit" size="sm" disabled={!snapshot || pending || !!issue || changed || !valid || !draft.id && items.length >= FOCUS_ITEM_LIMIT} data-testid="focus-catalog-save">{draft.id ? t.save : t.add}</Button><Button size="sm" variant="ghost" disabled={pending} onClick={() => { setDraft(fresh()); setSaved(false); input.current?.focus(); }}>{t.newItem}</Button></div>
    </form>
    <p role={issue ? "alert" : "status"} className="mt-2 text-xs text-mu">{issue ? t[issue] : pending ? t.pending : saved ? t.saved : !snapshot ? t.loading : ""}</p>
    {issue && <Button size="sm" variant="ghost" onClick={reload}>{t.retry}</Button>}
    <ConfirmDialog isOpen={!!removing} title={t.removeTitle} description={<>{removing?.conflict && <p role="alert" className="mb-2 text-vi">{t.changed}</p>}<p className="break-words font-medium">{removing?.item.label}</p><p>{t.removeDescription}</p><p className="mt-2">{formatString(t.uses, { n: removing?.references.length ?? 0 })}</p><ul>{removing?.references.map(value => <li key={value}>{isInstrumentId(value) ? instrumentName(value, dict.market.instruments) : value}</li>)}</ul></>} confirmLabel={removing?.conflict ? t.reviewRemove : t.confirmRemove} cancelLabel={f.cancel} isDanger onCancel={() => setRemoving(null)} onConfirm={() => void remove()} />
  </div>;
}

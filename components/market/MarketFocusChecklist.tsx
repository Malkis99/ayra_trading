"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Pencil, Plus, SlidersHorizontal, Trash2 } from "lucide-react";
import { useApp } from "@/lib/context";
import { formatString } from "@/lib/i18n";
import { FOCUS_ITEM_LIMIT, FOCUS_TEXT_LIMIT, focusText, type FocusEntry, type FocusItem, type FocusPatch } from "@/lib/market/market-focus";
import { Button, Checkbox, Input } from "@/components/ui";
import { ConfirmDialog } from "@/components/ConfirmDialog";

type Editor = { id: string; revision: number; text: string; adding: boolean };
export function MarketFocusChecklist({ entry, disabled, pending, patch }: { entry?: FocusEntry; disabled: boolean; pending: boolean; patch: (patch: FocusPatch) => Promise<boolean> }) {
  const t = useApp().dict.market.focus, c = t.custom;
  const [editing, setEditing] = useState(false), [editor, setEditor] = useState<Editor | null>(null), [removing, setRemoving] = useState<FocusItem | null>(null);
  const [busy, setBusy] = useState(false);
  const alive = useRef(true), root = useRef<HTMLDivElement>(null), add = useRef<HTMLButtonElement>(null), input = useRef<HTMLInputElement>(null);
  const [focusTarget, setFocusTarget] = useState<{ id?: string } | null>(null);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const editorId = editor?.id;
  useEffect(() => { if (editorId) input.current?.focus(); }, [editorId]); // only opening, never while typing
  const items = entry?.checklist.items ?? [];
  const title = (item: FocusItem) => item.text ?? (item.template ? t.checks[item.template] : "");
  const edit = (item: FocusItem) => setEditor({ id: item.id, revision: item.revision, text: title(item), adding: false });
  const make = () => { setEditing(true); setEditor({ id: crypto.randomUUID(), revision: 0, text: "", adding: true }); };
  useEffect(() => {
    if (!focusTarget || pending) return;
    (focusTarget.id ? root.current?.querySelector<HTMLButtonElement>(`[data-focus-edit="${focusTarget.id}"]`) : add.current)?.focus(); setFocusTarget(null);
  }, [focusTarget, pending]);
  const returnFocus = (id?: string) => setFocusTarget({ id });
  const current = editor && items.find(item => item.id === editor.id);
  const changed = !!editor && !editor.adding && (!current || current.revision !== editor.revision);
  const unchanged = !!editor && !editor.adding && !!current && editor.text.trim() === title(current);
  let valid = true; try { focusText(editor?.text ?? ""); } catch { valid = false; }
  const submit = async () => {
    if (!editor || busy || pending || disabled || !valid || changed || unchanged) return;
    setBusy(true);
    const ok = await patch(editor.adding ? { add: editor.id, text: editor.text } : { rename: editor.id, text: editor.text, itemRevision: editor.revision });
    if (!alive.current) return;
    setBusy(false); if (ok) { const id = editor.id; setEditor(null); returnFocus(id); }
  };
  const move = async (item: FocusItem, step: -1 | 1) => { if (!entry) return; if (await patch({ move: item.id, step, orderRevision: entry.checklist.orderRevision })) returnFocus(item.id); };
  const remove = async () => {
    if (!removing || busy) return; const index = items.findIndex(item => item.id === removing.id), next = items[index + 1] ?? items[index - 1];
    setBusy(true); const ok = await patch({ remove: removing.id, itemRevision: removing.revision });
    if (!alive.current) return; setBusy(false); setRemoving(null); if (ok) returnFocus(next?.id);
  };
  const action = "grid h-11 w-9 place-items-center rounded text-mu hover:bg-s2 hover:text-vi focus-visible:ring-2 focus-visible:ring-vi disabled:opacity-30";
  return <div ref={root} data-testid="market-focus-checklist">
    <div className="mb-2 flex flex-wrap items-center justify-between gap-2"><h3 className="text-xs font-semibold text-tx">{t.checklist}</h3>
      <button type="button" aria-pressed={editing} onClick={() => { setEditing(value => !value); setEditor(null); }} data-testid="focus-checklist-customize" className="inline-flex min-h-[44px] items-center gap-1.5 rounded px-1 text-xs text-mu focus-visible:ring-2 focus-visible:ring-vi"><SlidersHorizontal size={14} aria-hidden="true" />{editing ? c.done : c.customize}</button>
    </div>
    {!items.length && <p className="py-2 text-xs text-mu">{c.empty}</p>}
    <ul className={editing ? "divide-y divide-line/60" : "grid min-w-0 gap-x-4 md:grid-cols-2 lg:grid-cols-3"}>
      {items.map((item, index) => <li key={item.id} data-testid={`focus-item-${item.id}`} className={editing ? "grid min-w-0 items-start gap-x-3 sm:grid-cols-[minmax(0,1fr)_auto]" : "min-w-0"}>
        <Checkbox label={<span className="break-words [overflow-wrap:anywhere]">{title(item)}</span>} checked={item.checked} disabled={disabled} onChange={value => void patch({ check: item.id, value })} className="min-w-0 text-xs" />
        {editing && <div className="flex justify-end">
          <button type="button" className={action} disabled={disabled || pending || busy || index === 0} aria-label={`${c.up}: ${title(item)}`} onClick={() => void move(item, -1)}><ArrowUp size={15} aria-hidden="true" /></button>
          <button type="button" className={action} disabled={disabled || pending || busy || index === items.length - 1} aria-label={`${c.down}: ${title(item)}`} onClick={() => void move(item, 1)}><ArrowDown size={15} aria-hidden="true" /></button>
          <button type="button" data-focus-edit={item.id} className={action} disabled={disabled || pending || busy} aria-label={`${c.edit}: ${title(item)}`} onClick={() => edit(item)}><Pencil size={15} aria-hidden="true" /></button>
          <button type="button" className={action} disabled={disabled || pending || busy} aria-label={`${c.remove}: ${title(item)}`} onClick={() => setRemoving(item)}><Trash2 size={15} aria-hidden="true" /></button>
        </div>}
      </li>)}
    </ul>
    {(editing || !items.length) && <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
      <button ref={add} type="button" disabled={disabled || pending || busy || items.length >= FOCUS_ITEM_LIMIT} onClick={make} data-testid="focus-item-add" className="inline-flex min-h-[44px] items-center gap-1.5 rounded text-xs text-vi focus-visible:ring-2 focus-visible:ring-vi disabled:opacity-40"><Plus size={15} aria-hidden="true" />{c.add}</button>
      <span className="text-[11px] text-mu">{formatString(c.count, { n: items.length, max: FOCUS_ITEM_LIMIT })}</span>
    </div>}
    {editor && <form className="mt-3 space-y-2 rounded-md border border-line bg-field p-3" onSubmit={event => { event.preventDefault(); void submit(); }}>
      <Input ref={input} label={c.title} value={editor.text} onChange={event => setEditor({ ...editor, text: event.target.value })} disabled={busy} data-testid="focus-item-text" />
      <p className="text-[11px] text-mu">{formatString(c.characters, { n: Array.from(editor.text.trim()).length, max: FOCUS_TEXT_LIMIT })}</p>
      {changed && <p role="alert" className="text-xs text-vi">{c.changed}</p>}
      {changed && current && <Button variant="ghost" onClick={() => edit(current)}>{c.useLatest}</Button>}
      <div className="flex flex-wrap gap-2"><Button type="submit" disabled={disabled || pending || busy || !valid || changed || unchanged} data-testid="focus-item-save">{c.save}</Button><Button variant="secondary" onClick={() => { const id = editor.adding ? undefined : editor.id; setEditor(null); returnFocus(id); }}>{t.cancel}</Button></div>
    </form>}
    <ConfirmDialog isOpen={removing !== null} title={c.removeTitle} description={<><p className="mb-2 break-words [overflow-wrap:anywhere] text-tx">{removing && title(removing)}</p><p>{c.removeDescription}</p></>}
      isDanger confirmLabel={c.removeConfirm} cancelLabel={t.cancel} onCancel={() => setRemoving(null)} onConfirm={() => void remove()} />
  </div>;
}

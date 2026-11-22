"use client";

import { useEffect, useRef, useState } from "react";
import { Focus, RotateCcw } from "lucide-react";
import { useApp } from "@/lib/context";
import { useAuth } from "@/lib/auth/auth-context";
import { spaceTabChannel } from "@/lib/auth/space-channel";
import { focusStorage } from "@/lib/storage/market-focus";
import { FOCUS_FIELDS, FOCUS_ITEM_LIMIT, FOCUS_TEXT_LIMIT, customFocusId, focusFieldRevision, focusSelectionValue, hasFocus, type FocusField, type FocusPatch } from "@/lib/market/market-focus";
import { useMarketFocus } from "@/lib/market/use-market-focus";
import { useFocusCatalog } from "@/lib/market/use-focus-catalog";
import { instrumentName, type InstrumentId } from "@/lib/market/instruments";
import { formatString } from "@/lib/i18n";
import { Button, Select } from "@/components/ui";
import { MarketFocusChecklist } from "./MarketFocusChecklist";
import { MarketFocusNotifications } from "./MarketFocusNotifications";
import { MarketFocusCatalogEditor } from "./MarketFocusCatalogEditor";
import { ConfirmDialog } from "@/components/ConfirmDialog";

function Heading() {
  const t = useApp().dict.market.focus;
  return <div className="min-w-0"><h2 className="flex items-center gap-2 font-serif text-xl font-bold text-tx"><Focus size={19} className="shrink-0 text-vi" aria-hidden="true" />{t.title}</h2><p className="mt-1 text-[11px] text-mu">{t.subtitle}</p></div>;
}
/** One local focus below Quotes. Neither its data nor its events enter Market cloud sync. */
export function MarketFocus({ ids }: { ids: InstrumentId[] }) {
  const { user, isSpaceReady } = useAuth();
  const [epoch, setEpoch] = useState(0);
  useEffect(() => spaceTabChannel.subscribe(message => { if (message.fromSpaceId !== message.toSpaceId) setEpoch(n => n + 1); }), []);
  const space = user?.id ? `account:${user.id}` : "guest";
  return <section className="mt-4 min-w-0 rounded-lg border border-pri/50 bg-[linear-gradient(120deg,#211b2d_0%,#19171f_60%)] p-4 shadow-[inset_3px_0_#50348f] md:px-[22px] md:py-5" data-testid="market-focus">
    {isSpaceReady ? <FocusSpace key={`${space}:${epoch}`} space={space} ids={ids} /> : <div aria-busy="true"><Heading /></div>}
  </section>;
}
function FocusSpace({ space, ids }: { space: string; ids: InstrumentId[] }) {
  const t = useApp().dict.market.focus;
  const [selection, setSelection] = useState<string | null>(null), [loaded, setLoaded] = useState(false);
  const [selectionError, setSelectionError] = useState(false), [changed, setChanged] = useState(false);
  const active = useRef(true), selectionSequence = useRef(0), ticket = useRef<number>();
  useEffect(() => {
    let reading = true;
    active.current = true;
    void focusStorage.epoch(space).then(value => { if (!reading) return null; ticket.current = value; return focusStorage.selection(space); }).then(value => { if (reading) setSelection(value); }, () => { if (reading) setSelectionError(true); }).finally(() => { if (reading) setLoaded(true); });
    return () => { reading = false; active.current = false; };
  }, [space]);
  const selected = ids.includes(selection as InstrumentId) ? selection as InstrumentId : ids[0];
  const previous = useRef<InstrumentId | undefined>();
  useEffect(() => {
    if (!loaded) return;
    if (previous.current && !ids.includes(previous.current)) setChanged(true);
    previous.current = selected;
    // Keep the fallback as this view's selection; re-adding the removed id must not jump back.
    if (!ids.includes(selection as InstrumentId)) setSelection(selected ?? null);
  }, [selected, ids, loaded, selection]);
  const select = (id: InstrumentId) => {
    setSelection(id); setChanged(false); const seq = ++selectionSequence.current;
    if (ticket.current === undefined) { setSelectionError(true); return; }
    void focusStorage.select(space, id, ticket.current, () => active.current && seq === selectionSequence.current).then(() => { if (active.current && seq === selectionSequence.current) setSelectionError(false); }, () => { if (active.current && seq === selectionSequence.current) setSelectionError(true); });
  };
  if (!loaded) return <div aria-busy="true"><Heading /><p role="status" className="mt-3 text-xs text-mu">{t.loading}</p></div>;
  if (!selected) return <><Heading /><p className="mt-3 text-sm text-mu" data-testid="market-focus-empty">{t.empty}</p></>;
  return <>
    <FocusInstrument key={selected} space={space} id={selected} ids={ids} select={select} />
    {selectionError && <p role="alert" className="mt-2 text-xs text-danger">{t.selectionError}</p>}
    {changed && <p role="status" className="sr-only">{t.instrumentChanged}</p>}
  </>;
}
function FocusInstrument({ space, id, ids, select }: { space: string; id: InstrumentId; ids: InstrumentId[]; select: (id: InstrumentId) => void }) {
  const { dict } = useApp(), t = dict.market.focus;
  const state = useMarketFocus(space, id), [dialog, setDialog] = useState<{ revision: number; conflict: boolean } | null>(null);
  const library = useFocusCatalog(space, id), [managed, setManaged] = useState<FocusField | null>(null);
  const manageButtons = useRef<Partial<Record<FocusField, HTMLButtonElement | null>>>({});
  const mounted = useRef(true), resetRunning = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const disabled = !state.entry || !!state.issue;
  const status = state.issue ? formatString(t[state.issue], { max: FOCUS_ITEM_LIMIT, length: FOCUS_TEXT_LIMIT }) : state.pending ? t.pending : !state.entry ? t.loading : state.entry.revision > 0 ? t.saved : t.localDefault;
  const reset = async () => {
    if (!dialog || resetRunning.current) return;
    resetRunning.current = true;
    try {
      const result = await state.api?.reset(dialog.revision);
      if (!mounted.current) return;
      if (result === "conflict") setDialog({ revision: -1, conflict: true });
      else setDialog(null);
    } finally { resetRunning.current = false; }
  };
  const field = (key: FocusField) => {
    const selected = state.entry ? focusSelectionValue(state.entry, key) : "", custom = state.entry ? customFocusId(state.entry, key) : null;
    const items = library.snapshot?.catalog.items.filter(item => item.kind === key && (!item.deleted || item.id === custom)) ?? [];
    const session = key === "session" ? items.find(item => item.id === custom)?.session : undefined;
    const customOptions = items.map(item => {
      const duplicate = items.filter(other => other.label.toLocaleLowerCase() === item.label.toLocaleLowerCase()).length > 1;
      return { value: `custom:${item.id}`, label: `${item.label} · ${item.deleted ? t.catalog.deleted : t.catalog.customTag}${duplicate ? ` · ${item.id}` : ""}`, description: item.session ? `${item.session.start}–${item.session.end} · ${item.session.zone}` : undefined, disabled: item.deleted };
    });
    if (custom && !items.some(item => item.id === custom)) customOptions.push({ value: `custom:${custom}`, label: t.catalog.unavailable, description: undefined, disabled: true });
    return <Select<string> key={key} data-testid={`market-focus-${key}`} label={t.fields[key]} disabled={disabled}
      labelAction={<button type="button" ref={element => { manageButtons.current[key] = element; }} data-testid={`focus-manage-${key}`} aria-label={formatString(t.catalog.manageField, { field: t.fields[key] })} className="min-h-[44px] shrink-0 rounded px-1 text-[11px] text-vi focus-visible:ring-2 focus-visible:ring-vi disabled:opacity-40" disabled={!library.snapshot || library.pending || state.pending || disabled} onClick={() => setManaged(key)}>{t.catalog.manage}</button>}
      hint={session ? `${session.start}–${session.end} · ${session.zone}${session.end < session.start ? ` · ${t.catalog.overnight}` : ""}` : undefined}
      value={selected} onChange={value => {
        if (!state.entry) return;
        if (value.startsWith("custom:")) {
          const item = items.find(item => item.id === value.slice(7));
          if (item && !item.deleted) void state.api?.patch({ custom: key, id: item.id, entryRevision: state.entry.revision, fieldRevision: focusFieldRevision(state.entry, key), catalogRevision: item.revision });
        } else void state.api?.patch({ field: key, value: value === "" ? null : value, fieldRevision: focusFieldRevision(state.entry, key) } as FocusPatch);
      }}
      options={[{ value: "", label: t.notSelected }, ...FOCUS_FIELDS[key].map(value => ({ value, label: key === "mss" && value === "bullish" ? t.options.mssBullish : key === "mss" && value === "bearish" ? t.options.mssBearish : t.options[value], group: t.catalog.systemTag })), ...customOptions]} />;
  };
  return <>
    <header className="flex items-start justify-between gap-3"><Heading />
      <button type="button" data-testid="market-focus-reset" disabled={disabled || state.pending || !state.entry || !hasFocus(state.entry)}
        onClick={() => state.entry && setDialog({ revision: state.entry.revision, conflict: false })}
        className="inline-flex min-h-[44px] shrink-0 items-center gap-1.5 rounded px-1 text-xs text-mu hover:text-vi focus-visible:ring-2 focus-visible:ring-vi disabled:opacity-40"><RotateCcw size={14} aria-hidden="true" />{t.reset}</button>
    </header>
    <div className="my-4 max-w-sm"><Select<InstrumentId> label={t.instrument} value={id} onChange={select} data-testid="market-focus-instrument"
      options={ids.map(value => ({ value, label: instrumentName(value, dict.market.instruments) }))} /></div>
    <div className="grid min-w-0 gap-3 md:grid-cols-2 lg:grid-cols-4">{(Object.keys(FOCUS_FIELDS) as FocusField[]).map(field)}</div>
    {managed && <MarketFocusCatalogEditor key={managed} field={managed} snapshot={library.snapshot} pending={library.pending} issue={library.issue} change={command => library.api?.change(command) ?? Promise.resolve(false)} reload={() => library.api?.reload()} close={() => { const key = managed; setManaged(null); manageButtons.current[key]?.focus(); }} />}
    {!managed && library.issue && <p role="alert" className="mt-2 text-xs text-mu">{t.catalog[library.issue]} <Button size="sm" variant="ghost" onClick={() => library.api?.reload()}>{t.catalog.retry}</Button></p>}
    <div className="my-4 h-px bg-pri/30" />
    <MarketFocusChecklist entry={state.entry} disabled={disabled} pending={state.pending} patch={patch => state.api?.patch(patch) ?? Promise.resolve(false)} />
    <footer className="mt-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-pri/30 pt-3 text-[11px] text-mu">
      <span role={state.issue ? "alert" : "status"} data-testid="market-focus-status" data-kind={state.issue ?? (state.pending ? "pending" : !state.entry ? "loading" : state.entry.revision > 0 ? "saved" : "default")}>{status}</span>
      {state.issue && <Button size="sm" variant="ghost" onClick={() => state.api?.reload()}>{t.retry}</Button>}
      <span>{space === "guest" ? t.guest : t.localOnly}</span>
    </footer>
    <p className="mt-2 text-[10px] text-mu">{t.disclaimer}</p>
    <MarketFocusNotifications space={space} id={id} ids={ids} customSession={!!state.entry && !!customFocusId(state.entry, "session")} />
    <ConfirmDialog isOpen={dialog !== null} title={formatString(t.resetTitle, { instrument: instrumentName(id, dict.market.instruments) })}
      description={<>{dialog?.conflict && <p role="alert" className="mb-3 text-vi">{t.conflict}</p>}<p>{t.resetDescription}</p></>}
      isDanger confirmLabel={dialog?.conflict ? t.reviewReset : t.resetConfirm} cancelLabel={t.cancel} onCancel={() => setDialog(null)}
      onConfirm={() => { if (dialog?.conflict) { if (state.entry && !state.pending && !state.issue) setDialog({ revision: state.entry.revision, conflict: false }); } else void reset(); }} />
  </>;
}

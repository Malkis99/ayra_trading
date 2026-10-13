"use client";

import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "../cn";
import { Field, LabelAction, describedBy, fieldClasses, useFormsText } from "./field";
import { Popover, useOutsideClose } from "./popover";

/** Local date/time strings in the same format as <input type="datetime-local">: "YYYY-MM-DDTHH:mm" / "YYYY-MM-DD". */
const pad = (n: number) => String(n).padStart(2, "0");
export const toDateKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const toLocalDateTime = (d: Date) => `${toDateKey(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;

function parse(value: string | null | undefined): Date | null {
  if (!value) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/.exec(value);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4] ?? 0), Number(m[5] ?? 0));
  return Number.isNaN(d.getTime()) ? null : d;
}

const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n, d.getHours(), d.getMinutes());
const addMonths = (d: Date, n: number) => {
  const target = new Date(d.getFullYear(), d.getMonth() + n, 1, d.getHours(), d.getMinutes());
  const last = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  target.setDate(Math.min(d.getDate(), last));
  return target;
};

export type DateTimePickerProps = {
  value: string;
  onChange: (value: string) => void;
  mode?: "datetime" | "date";
  label?: React.ReactNode;
  hint?: React.ReactNode;
  error?: React.ReactNode;
  optional?: boolean;
  placeholder?: string;
  /** Shows "Now" next to the label. */
  showNow?: boolean;
  clearable?: boolean;
  disabled?: boolean;
  className?: string;
  id?: string;
  "data-testid"?: string;
};

/** Custom date (and time) picker: dark popover calendar with keyboard navigation, no native grey widget. */
export function DateTimePicker({
  value,
  onChange,
  mode = "datetime",
  label,
  hint,
  error,
  optional,
  placeholder,
  showNow = true,
  clearable,
  disabled,
  className,
  id: idProp,
  "data-testid": testId,
}: DateTimePickerProps) {
  const { t, lang } = useFormsText();
  const locale = lang === "ru" ? "ru-RU" : "en-US";
  const autoId = useId();
  const id = idProp ?? autoId;
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);

  const selected = parse(value);
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState<Date>(() => selected ?? new Date());
  const weekStartsOn = lang === "ru" ? 1 : 0;

  const close = useCallback((refocus = true) => {
    setOpen(false);
    if (refocus) triggerRef.current?.focus();
  }, []);
  const closeNoFocus = useCallback(() => close(false), [close]);
  useOutsideClose([triggerRef, panelRef], open, closeNoFocus);

  useEffect(() => {
    if (!open) return;
    const raf = requestAnimationFrame(() => gridRef.current?.querySelector<HTMLElement>('[tabindex="0"]')?.focus());
    return () => cancelAnimationFrame(raf);
  }, [open]);

  const emit = (d: Date) => onChange(mode === "date" ? toDateKey(d) : toLocalDateTime(d));

  const selectDay = (day: Date) => {
    const base = selected ?? new Date();
    const next = new Date(day.getFullYear(), day.getMonth(), day.getDate(), base.getHours(), base.getMinutes());
    emit(next);
    setCursor(next);
    if (mode === "date") close();
  };

  const setNow = () => {
    const now = new Date();
    emit(now);
    setCursor(now);
  };

  const monthLabel = useMemo(
    () => new Intl.DateTimeFormat(locale, { month: "long", year: "numeric" }).format(cursor),
    [cursor, locale]
  );
  const weekdayLabels = useMemo(() => {
    const fmt = new Intl.DateTimeFormat(locale, { weekday: "short" });
    return Array.from({ length: 7 }, (_, i) => fmt.format(new Date(2024, 0, 7 + ((i + weekStartsOn) % 7))));
  }, [locale, weekStartsOn]);

  const days = useMemo(() => {
    const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    const offset = (first.getDay() - weekStartsOn + 7) % 7;
    const start = addDays(first, -offset);
    return Array.from({ length: 42 }, (_, i) => addDays(start, i));
  }, [cursor, weekStartsOn]);

  const display = selected
    ? new Intl.DateTimeFormat(locale, {
        day: "numeric",
        month: "short",
        year: "numeric",
        ...(mode === "datetime" ? { hour: "2-digit", minute: "2-digit" } : {}),
      }).format(selected)
    : null;
  const todayKey = toDateKey(new Date());
  const selectedKey = selected ? toDateKey(selected) : null;
  const dayFmt = new Intl.DateTimeFormat(locale, { weekday: "long", day: "numeric", month: "long", year: "numeric" });

  const onGridKeyDown = (e: React.KeyboardEvent) => {
    const moves: Record<string, () => Date> = {
      ArrowLeft: () => addDays(cursor, -1),
      ArrowRight: () => addDays(cursor, 1),
      ArrowUp: () => addDays(cursor, -7),
      ArrowDown: () => addDays(cursor, 7),
      PageUp: () => addMonths(cursor, -1),
      PageDown: () => addMonths(cursor, 1),
      Home: () => addDays(cursor, -((cursor.getDay() - weekStartsOn + 7) % 7)),
      End: () => addDays(cursor, 6 - ((cursor.getDay() - weekStartsOn + 7) % 7)),
    };
    if (moves[e.key]) {
      e.preventDefault();
      const next = moves[e.key]();
      setCursor(next);
      requestAnimationFrame(() => gridRef.current?.querySelector<HTMLElement>('[tabindex="0"]')?.focus());
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      selectDay(cursor);
    }
  };

  const onPanelKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close();
    }
  };

  const setTimePart = (part: "h" | "m", raw: string) => {
    const n = Number(raw.replace(/\D/g, ""));
    if (!Number.isFinite(n)) return;
    const base = selected ?? cursor;
    const next = new Date(base);
    if (part === "h") next.setHours(Math.max(0, Math.min(23, n)));
    else next.setMinutes(Math.max(0, Math.min(59, n)));
    emit(next);
  };

  const timeField = (part: "h" | "m") => {
    const v = selected ? (part === "h" ? selected.getHours() : selected.getMinutes()) : null;
    return (
      <input
        type="text"
        inputMode="numeric"
        maxLength={2}
        aria-label={part === "h" ? t.hours : t.minutes}
        value={v == null ? "" : pad(v)}
        placeholder="--"
        onChange={(e) => setTimePart(part, e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "ArrowUp" || e.key === "ArrowDown") {
            e.preventDefault();
            const max = part === "h" ? 24 : 60;
            const cur = v ?? 0;
            setTimePart(part, String((cur + (e.key === "ArrowUp" ? 1 : -1) + max) % max));
          }
        }}
        className="h-11 w-14 rounded-md border border-edge bg-field text-center text-base font-semibold tabular-nums text-tx focus:border-vi focus:outline-none focus:ring-2 focus:ring-vi/30"
      />
    );
  };

  return (
    <Field
      id={id}
      label={label}
      hint={hint}
      error={error}
      optional={optional}
      className={className}
      labelAction={showNow && !disabled ? <LabelAction onClick={setNow}>{t.now}</LabelAction> : undefined}
    >
      <button
        ref={triggerRef}
        id={id}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-describedby={describedBy(id, hint, error)}
        data-testid={testId}
        data-value={value}
        disabled={disabled}
        onClick={() => {
          if (open) return close();
          setCursor(selected ?? new Date());
          setOpen(true);
        }}
        className={fieldClasses({ invalid: Boolean(error), className: cn("flex items-center gap-2 text-left", open && "border-vi ring-2 ring-vi/30") })}
      >
        <CalendarDays size={16} aria-hidden="true" className="shrink-0 text-mu" />
        <span className={cn("flex-1 truncate", display ? "text-tx" : "text-mu/70")}>{display ?? placeholder ?? t.pickDate}</span>
      </button>

      <Popover anchor={triggerRef} open={open} panelRef={panelRef} minWidth={300} preferredHeight={440} role="dialog" aria-label={typeof label === "string" ? label : t.pickDate}>
        <div className="space-y-3 overflow-y-auto p-3" onKeyDown={onPanelKeyDown}>
          <div className="flex items-center justify-between">
            <button
              type="button"
              aria-label={t.prevMonth}
              onClick={() => setCursor(addMonths(cursor, -1))}
              className="grid h-10 w-10 place-items-center rounded-md text-mu hover:bg-s2 hover:text-tx focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vi"
            >
              <ChevronLeft size={18} aria-hidden="true" />
            </button>
            <div className="text-sm font-semibold capitalize text-tx" aria-live="polite">
              {monthLabel}
            </div>
            <button
              type="button"
              aria-label={t.nextMonth}
              onClick={() => setCursor(addMonths(cursor, 1))}
              className="grid h-10 w-10 place-items-center rounded-md text-mu hover:bg-s2 hover:text-tx focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vi"
            >
              <ChevronRight size={18} aria-hidden="true" />
            </button>
          </div>

          <div ref={gridRef} role="grid" aria-label={monthLabel} onKeyDown={onGridKeyDown}>
            <div role="row" className="grid grid-cols-7">
              {weekdayLabels.map((w) => (
                <div key={w} role="columnheader" className="py-1 text-center text-xs font-medium capitalize text-mu">
                  {w}
                </div>
              ))}
            </div>
            {Array.from({ length: 6 }, (_, week) => (
              <div role="row" key={week} className="grid grid-cols-7">
                {days.slice(week * 7, week * 7 + 7).map((d) => {
                  const key = toDateKey(d);
                  const inMonth = d.getMonth() === cursor.getMonth();
                  const isSelected = key === selectedKey;
                  const isCursor = key === toDateKey(cursor);
                  return (
                    <div role="gridcell" key={key} aria-selected={isSelected}>
                      <button
                        type="button"
                        tabIndex={isCursor ? 0 : -1}
                        aria-label={dayFmt.format(d)}
                        aria-current={key === todayKey ? "date" : undefined}
                        data-date={key}
                        onClick={() => selectDay(d)}
                        className={cn(
                          "mx-auto grid h-10 w-10 place-items-center rounded-full text-sm tabular-nums transition-colors",
                          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vi",
                          isSelected
                            ? "bg-pri font-semibold text-white"
                            : key === todayKey
                            ? "border border-vi text-tx hover:bg-s2"
                            : inMonth
                            ? "text-tx hover:bg-s2"
                            : "text-mu/50 hover:bg-s2"
                        )}
                      >
                        {d.getDate()}
                      </button>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>

          {mode === "datetime" && (
            <div className="flex items-center justify-between border-t border-line pt-3">
              <span className="text-sm font-medium text-mu">{t.time}</span>
              <div className="flex items-center gap-1.5">
                {timeField("h")}
                <span className="font-semibold text-mu">:</span>
                {timeField("m")}
              </div>
            </div>
          )}

          <div className="flex items-center justify-between gap-2 border-t border-line pt-3">
            <div className="flex gap-1">
              <button type="button" onClick={setNow} className="min-h-[40px] rounded-md px-3 text-sm font-semibold text-vi hover:bg-vi/10">
                {mode === "date" ? t.today : t.now}
              </button>
              {clearable && value && (
                <button
                  type="button"
                  onClick={() => {
                    onChange("");
                    close();
                  }}
                  className="min-h-[40px] rounded-md px-3 text-sm text-mu hover:bg-s2 hover:text-tx"
                >
                  {t.clear}
                </button>
              )}
            </div>
            <button type="button" onClick={() => close()} className="min-h-[40px] rounded-md bg-pri px-4 text-sm font-semibold text-white hover:bg-[#5d3fa3]">
              {t.done}
            </button>
          </div>
        </div>
      </Popover>
    </Field>
  );
}

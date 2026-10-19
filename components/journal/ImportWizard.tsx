"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, FileUp, History, Loader2, Sparkles, Undo2 } from "lucide-react";
import type { Account, AccountCurrency, AccountType, Strategy, Trade } from "@/lib/journal/types";
import type { ColumnMapping, ImportField, ImportFormatId, ImportPlatformGroup, RawTable, RowError } from "@/lib/journal/import/types";
import { readImportFile, type ReadError } from "@/lib/journal/import/read";
import { IMPORT_PARSERS, PLATFORM_NAMES, detectFormat, getParser, isBetaFormat, tableFor } from "@/lib/journal/import/registry";
import { buildPreview, strategyNameKey, type RMode } from "@/lib/journal/import/normalize";
import { MAPPABLE_FIELDS, REQUIRED_FIELDS, completeMapping, guessHeaderRow, mappedColumnHasNoNumbers, suggestMapping } from "@/lib/journal/import/parsers/universal";
import { COLOR_PALETTE } from "@/components/journal/StrategyModal";
import { addImportBatch, listImportBatches, markImportBatchUndone, newBatchId, type ImportBatch } from "@/lib/journal/import/batches";
import { IMPORT_MAX_FILE_BYTES, IMPORT_MAX_FILE_MB, IMPORT_MAX_TRADES, IMPORT_PREVIEW_ROWS } from "@/lib/journal/import/limits";
import { hashString } from "@/lib/journal/import/util";
import { useJournal } from "@/lib/journal/context";
import { useApp } from "@/lib/context";
import { AppStorage } from "@/lib/storage";
import { formatString } from "@/lib/i18n";
import { Button, Checkbox, Input, Modal, NumberInput, Segmented, Select } from "@/components/ui";
import { cn } from "@/components/ui/cn";
import { ConfirmDialog } from "@/components/ConfirmDialog";

type Step = "source" | "file" | "mapping" | "settings" | "preview" | "done";
const STEPS: Step[] = ["source", "file", "mapping", "settings", "preview", "done"];
const NEW_ACCOUNT = "__new";
const MAPPINGS_KEY = "ayra_import_mappings";
const GROUPS: ImportPlatformGroup[] = ["forex", "futures", "stocks", "crypto", "other"];
const KIND_LABEL: Record<RawTable["kind"], string> = { csv: "CSV", xlsx: "XLSX", html: "HTML", json: "JSON" };

type Props = {
  isOpen: boolean;
  onClose: () => void;
  accounts: Account[];
  trades: Trade[];
  /** The user's time zone (used for file times without a zone). */
  userTimeZone: string;
};

function loadMappings(): Record<string, { headerRow: number; mapping: ColumnMapping }> {
  try {
    return JSON.parse(AppStorage.getItem(MAPPINGS_KEY) ?? "{}");
  } catch {
    return {};
  }
}

function timeZoneOptions(user: string): string[] {
  const offsets: string[] = [];
  for (let h = -12; h <= 14; h++) {
    if (h === 0) continue;
    offsets.push(`UTC${h > 0 ? "+" : "-"}${String(Math.abs(h)).padStart(2, "0")}:00`);
  }
  let iana: string[] = [];
  try {
    iana = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.("timeZone") ?? [];
  } catch {}
  return Array.from(new Set([user, "UTC", ...offsets, ...iana]));
}

/** Trade import wizard: source → file → columns → settings → review → done (with undo). Everything runs locally. */
export function ImportWizard({ isOpen, onClose, accounts, trades, userTimeZone }: Props) {
  const { dict, lang, showToast } = useApp();
  const t = dict.journal.importExport;
  const { importTrades, deleteTradesByBatch, saveAccount, saveStrategy, strategies } = useJournal();

  const [step, setStep] = useState<Step>("source");
  const [format, setFormat] = useState<ImportFormatId | "auto">("auto");
  const [fileName, setFileName] = useState("");
  const [tables, setTables] = useState<RawTable[]>([]);
  const [readError, setReadError] = useState<ReadError | "noTables" | null>(null);
  const [reading, setReading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [tableIndex, setTableIndex] = useState(0);
  const [detectedId, setDetectedId] = useState<ImportFormatId | null>(null);
  const [headerRow, setHeaderRow] = useState(0);
  const [mapping, setMapping] = useState<ColumnMapping>({});
  const [mappingRemembered, setMappingRemembered] = useState(false);
  const activeAccounts = useMemo(() => accounts.filter((a) => !a.archivedAt), [accounts]);
  const [accountChoice, setAccountChoice] = useState<string>(activeAccounts[0]?.id ?? NEW_ACCOUNT);
  const [newAccName, setNewAccName] = useState("");
  const [newAccType, setNewAccType] = useState<AccountType>("personal");
  const [newAccCurrency, setNewAccCurrency] = useState<AccountCurrency>("USD");
  const [timeZone, setTimeZone] = useState(userTimeZone);
  const [rMode, setRMode] = useState<RMode>("stopLoss");
  const [fixedRisk, setFixedRisk] = useState("");
  const [excluded, setExcluded] = useState<Set<number>>(new Set());
  const [result, setResult] = useState<{ batchId: string; imported: number; skipped: number } | null>(null);
  const [undoBatch, setUndoBatch] = useState<ImportBatch | { id: string; tradeCount: number } | null>(null);
  const [history, setHistory] = useState<ImportBatch[]>([]);
  /** Strategy names from the file the user does NOT want created (by name key); everything else is created. */
  const [skipStrategies, setSkipStrategies] = useState<Set<string>>(new Set());
  const plannedStrategyIds = useRef<Record<string, string>>({});
  const batchId = useRef(newBatchId());
  const fileInput = useRef<HTMLInputElement>(null);

  // Fresh wizard every time it opens
  useEffect(() => {
    if (!isOpen) return;
    setStep("source");
    setFormat("auto");
    setFileName("");
    setTables([]);
    setReadError(null);
    setDetectedId(null);
    setExcluded(new Set());
    setSkipStrategies(new Set());
    plannedStrategyIds.current = {};
    setResult(null);
    setTimeZone(userTimeZone);
    setAccountChoice(activeAccounts[0]?.id ?? NEW_ACCOUNT);
    setHistory(listImportBatches().slice(-5).reverse());
    batchId.current = newBatchId();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  const parserId: ImportFormatId = format === "auto" ? detectedId ?? "universal" : format;
  const parser = getParser(parserId);
  const isUniversal = parserId === "universal";
  const table = tables[tableIndex] ?? null;
  const headers = table && isUniversal ? table.rows[headerRow] ?? [] : [];

  const prepareUniversal = useCallback((tb: RawTable) => {
    const remembered = loadMappings();
    const hr = guessHeaderRow(tb.rows);
    const sig = hashString((tb.rows[hr] ?? []).join("|"));
    if (remembered[sig]) {
      const rhr = remembered[sig].headerRow;
      setHeaderRow(rhr);
      // Fields added after this mapping was saved (or left empty then) are guessed again; "not used" (-1) is kept
      setMapping(completeMapping(remembered[sig].mapping, tb.rows[rhr] ?? [], tb.rows.slice(rhr + 1)));
      setMappingRemembered(true);
    } else {
      setHeaderRow(hr);
      setMapping(suggestMapping(tb.rows[hr] ?? [], tb.rows.slice(hr + 1)));
      setMappingRemembered(false);
    }
  }, []);

  const onFile = async (file: File) => {
    setReading(true);
    setReadError(null);
    setFileName(file.name);
    setExcluded(new Set());
    const bytes = new Uint8Array(await file.arrayBuffer());
    const res = await readImportFile(file.name, bytes, IMPORT_MAX_FILE_BYTES);
    setReading(false);
    if (res.error) {
      setTables([]);
      setReadError(res.error);
      return;
    }
    const usable = res.tables.filter((tb) => tb.kind === "json" || tb.rows.length > 0);
    if (!usable.length) {
      setTables([]);
      setReadError("noTables");
      return;
    }
    setTables(usable);
    const det = detectFormat(usable);
    const detId = det && det.parser.id !== "universal" ? det.parser.id : null;
    setDetectedId(detId);
    const chosen = format === "auto" ? det?.parser ?? getParser("universal") : getParser(format);
    const tb = format === "auto" ? det?.table : tableFor(chosen, usable);
    const idx = Math.max(0, usable.indexOf(tb ?? usable[0]));
    setTableIndex(idx);
    if (chosen.id === "universal") prepareUniversal(usable[idx]);
  };

  const parsed = useMemo(() => {
    if (!table) return null;
    try {
      return parser.parse(table, { timeZone, mapping: isUniversal ? mapping : undefined, headerRow: isUniversal ? headerRow : undefined });
    } catch {
      return { trades: [], errors: [] as RowError[] };
    }
  }, [table, parser, timeZone, mapping, headerRow, isUniversal]);

  // Strategy names from the file: matched to the user's strategies by name, the rest offered for creation
  const strategyPlan = useMemo(() => {
    const names = new Map<string, string>();
    for (const tr of parsed?.trades ?? []) {
      if (tr.strategyName && !names.has(strategyNameKey(tr.strategyName))) names.set(strategyNameKey(tr.strategyName), tr.strategyName.trim());
    }
    return [...names].map(([key, name]) => {
      const existing = strategies.find((s) => strategyNameKey(s.name || dict.journal.strategiesTab.defaultName) === key);
      if (!existing && !plannedStrategyIds.current[key]) {
        plannedStrategyIds.current[key] = `str_imp_${batchId.current}_${Object.keys(plannedStrategyIds.current).length}`;
      }
      return { key, name, existing };
    });
  }, [parsed, strategies, dict]);

  const strategyIds = useMemo(() => {
    const ids: Record<string, string> = {};
    for (const p of strategyPlan) {
      if (p.existing) ids[p.key] = p.existing.id;
      else if (!skipStrategies.has(p.key)) ids[p.key] = plannedStrategyIds.current[p.key];
    }
    return ids;
  }, [strategyPlan, skipStrategies]);

  const preview = useMemo(() => {
    if (!parsed) return [];
    return buildPreview(parsed.trades, trades, {
      formatId: parserId,
      accountId: accountChoice,
      batchId: batchId.current,
      rMode,
      fixedRisk: Number(fixedRisk.replace(",", ".")) || undefined,
      strategyIds,
      nowIso: new Date().toISOString(),
    });
  }, [parsed, trades, parserId, accountChoice, rMode, fixedRisk, strategyIds]);

  const newRows = preview.filter((r) => r.status === "new");
  const selected = newRows.filter((r) => !excluded.has(r.index));
  const isMapped = (f: ImportField) => mapping[f] !== undefined && mapping[f]! >= 0;
  const missingRequired = isUniversal ? REQUIRED_FIELDS.filter((f) => !isMapped(f)) : [];
  const stepIndex = STEPS.indexOf(step);

  const canNext =
    (step === "source" && true) ||
    (step === "file" && tables.length > 0 && !readError && !reading) ||
    (step === "mapping" && missingRequired.length === 0) ||
    (step === "settings" && (rMode !== "fixedRisk" || Number(fixedRisk.replace(",", ".")) > 0));

  const goNext = () => setStep(STEPS[Math.min(stepIndex + 1, STEPS.length - 1)]);
  const goBack = () => setStep(STEPS[Math.max(stepIndex - 1, 0)]);

  const doImport = () => {
    let accountId = accountChoice;
    if (accountChoice === NEW_ACCOUNT) {
      const acc: Account = {
        id: `acc_${Date.now()}`,
        name: newAccName.trim() || null,
        type: newAccType,
        currency: newAccCurrency,
        platform: "manual",
        createdAt: new Date().toISOString(),
      };
      saveAccount(acc);
      accountId = acc.id;
    }
    const list = selected.slice(0, IMPORT_MAX_TRADES).map((r) => ({ ...r.trade, accountId }));
    // Strategies from the file the user agreed to create — only those that imported trades actually use
    const usedStrategyIds = new Set(list.map((tr) => tr.strategyId).filter(Boolean));
    strategyPlan
      .filter((p) => !p.existing && !skipStrategies.has(p.key) && usedStrategyIds.has(plannedStrategyIds.current[p.key]))
      .forEach((p, i) => {
        const strategy: Strategy = {
          id: plannedStrategyIds.current[p.key],
          name: p.name,
          description: null,
          color: COLOR_PALETTE[(strategies.length + i) % COLOR_PALETTE.length],
          rules: [],
          tags: [],
          riskLimit: null,
          allowedSessions: null,
          version: 1,
          archivedAt: null,
          createdAt: new Date().toISOString(),
        };
        saveStrategy(strategy);
      });
    const added = importTrades(list);
    addImportBatch({
      id: batchId.current,
      createdAt: new Date().toISOString(),
      formatId: parserId,
      fileName,
      accountId,
      tradeCount: added,
    });
    if (isUniversal && table) {
      const all = loadMappings();
      all[hashString((table.rows[headerRow] ?? []).join("|"))] = { headerRow, mapping };
      try {
        AppStorage.setItem(MAPPINGS_KEY, JSON.stringify(all));
      } catch {}
    }
    setResult({ batchId: batchId.current, imported: added, skipped: preview.length - added });
    showToast(formatString(t.done.importedToast, { count: added }));
    setStep("done");
  };

  const confirmUndo = () => {
    if (!undoBatch) return;
    const removed = deleteTradesByBatch(undoBatch.id);
    markImportBatchUndone(undoBatch.id, new Date().toISOString());
    showToast(formatString(t.done.undoneToast, { count: removed }));
    setUndoBatch(null);
    setHistory(listImportBatches().slice(-5).reverse());
    if (result && result.batchId === undoBatch.id) onClose();
  };

  const fmtNum = (n?: number, digits = 5) => (n === undefined ? "—" : Number(n.toFixed(digits)).toString());
  const fmtDate = (iso: string) =>
    new Intl.DateTimeFormat(lang === "ru" ? "ru-RU" : "en-US", { day: "2-digit", month: "short", year: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
  const reason = (e: RowError) =>
    formatString(t.preview.errorRow, { row: e.row, reason: t.preview.reasons[e.code] }) + (e.field && !(MAPPABLE_FIELDS as string[]).includes(e.field) ? ` (${formatString(t.preview.errorField, { field: e.field })})` : "");

  /* -------------------------------------------------------------- footer */
  const footer =
    step === "done" ? (
      <div className="flex w-full flex-wrap justify-between gap-2">
        {result && result.imported > 0 ? (
          <Button variant="danger" onClick={() => setUndoBatch({ id: result.batchId, tradeCount: result.imported })}>
            <Undo2 size={16} aria-hidden="true" />
            {t.done.undo}
          </Button>
        ) : (
          <span />
        )}
        <Button onClick={onClose}>{t.done.finish}</Button>
      </div>
    ) : (
      <div className="flex w-full justify-between gap-2">
        <Button variant="secondary" onClick={goBack} disabled={stepIndex === 0}>
          {t.back}
        </Button>
        {step === "preview" ? (
          <Button onClick={doImport} disabled={selected.length === 0} data-testid="import-confirm">
            {formatString(t.preview.importBtn, { count: Math.min(selected.length, IMPORT_MAX_TRADES) })}
          </Button>
        ) : (
          <Button onClick={goNext} disabled={!canNext} data-testid="import-next">
            {t.next}
          </Button>
        )}
      </div>
    );

  /* ------------------------------------------------------------- steps */
  const platformCard = (id: ImportFormatId | "auto", name: string, hint: string, kinds?: string) => {
    const active = format === id;
    return (
      <button
        key={id}
        type="button"
        role="radio"
        aria-checked={active}
        onClick={() => {
          setFormat(id);
          if (tables.length) {
            const p = id === "auto" ? detectFormat(tables)?.parser ?? getParser("universal") : getParser(id);
            const tb = tableFor(p, tables) ?? tables[0];
            const idx = Math.max(0, tables.indexOf(tb));
            setTableIndex(idx);
            if (p.id === "universal") prepareUniversal(tables[idx]);
          }
        }}
        className={cn(
          "flex min-h-[64px] flex-col items-start justify-center gap-0.5 rounded-md border px-3 py-2 text-left transition-colors",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vi",
          active ? "border-vi bg-vi/15" : "border-edge bg-field hover:border-mu/60"
        )}
      >
        <span className="flex w-full items-center justify-between gap-2 text-sm font-semibold text-tx">
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="truncate">{name}</span>
            {id !== "auto" && isBetaFormat(id) && (
              <span title={t.betaHint} data-testid="import-beta" className="shrink-0 rounded border border-vi/40 bg-vi/10 px-1 py-px text-[10px] font-semibold uppercase leading-none tracking-wide text-vi">
                {t.beta}
                <span className="sr-only">. {t.betaHint}</span>
              </span>
            )}
          </span>
          {active && <Check size={16} strokeWidth={3} className="shrink-0 text-vi" aria-hidden="true" />}
        </span>
        <span className="text-xs text-mu">{hint || kinds}</span>
      </button>
    );
  };

  const kindsOf = (id: ImportFormatId) => getParser(id).kinds.map((k) => KIND_LABEL[k]).join(", ");

  const body = (() => {
    switch (step) {
      case "source":
        return (
          <div className="space-y-5">
            <p className="text-sm text-mu">{t.source.hint}</p>
            <p className="flex items-center gap-1.5 text-xs text-mu" data-testid="import-no-xp">
              <Sparkles size={14} className="shrink-0 text-vi" aria-hidden="true" />
              {t.noXp}
            </p>
            <div role="radiogroup" aria-label={t.source.title} className="space-y-4">
              <div className="grid grid-cols-1">{platformCard("auto", t.source.auto, t.source.autoHint)}</div>
              {GROUPS.map((g) => {
                const list = IMPORT_PARSERS.filter((p) => p.group === g);
                if (!list.length) return null;
                return (
                  <section key={g} className="space-y-2">
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-mu">{t.source.groups[g]}</h3>
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                      {list.map((p) =>
                        platformCard(
                          p.id,
                          PLATFORM_NAMES[p.id],
                          p.id === "universal" ? t.source.universalHint : p.id === "ayra" ? t.source.ayraHint : "",
                          kindsOf(p.id)
                        )
                      )}
                    </div>
                  </section>
                );
              })}
            </div>
            {history.length > 0 && (
              <section className="space-y-2">
                <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-mu">
                  <History size={14} aria-hidden="true" />
                  {t.source.history}
                </h3>
                <ul className="space-y-1.5">
                  {history.map((b) => (
                    <li key={b.id} className="flex items-center justify-between gap-2 rounded-md bg-s2/60 px-3 py-2 text-sm">
                      <span className="min-w-0 truncate text-tx">
                        {formatString(t.source.historyItem, { date: fmtDate(b.createdAt), platform: PLATFORM_NAMES[b.formatId], count: b.tradeCount })}
                        {b.undoneAt && <span className="ml-1 text-mu">· {t.source.undone}</span>}
                      </span>
                      {!b.undoneAt && b.tradeCount > 0 && (
                        <Button variant="ghost" size="sm" onClick={() => setUndoBatch(b)}>
                          <Undo2 size={14} aria-hidden="true" />
                          {t.done.undo}
                        </Button>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>
        );

      case "file":
        return (
          <div className="space-y-4">
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                const f = e.dataTransfer.files?.[0];
                if (f) onFile(f);
              }}
              className={cn(
                "flex flex-col items-center gap-2 rounded-lg border-2 border-dashed px-4 py-8 text-center transition-colors",
                dragOver ? "border-vi bg-vi/10" : "border-edge bg-field"
              )}
            >
              <FileUp size={28} className="text-vi" aria-hidden="true" />
              <p className="text-sm font-semibold text-tx">{t.file.drop}</p>
              <p className="text-xs text-mu">{t.file.or}</p>
              <Button variant="secondary" onClick={() => fileInput.current?.click()}>
                {t.file.choose}
              </Button>
              <input
                ref={fileInput}
                type="file"
                accept=".csv,.txt,.tsv,.xlsx,.html,.htm,.json"
                className="sr-only"
                data-testid="import-file-input"
                aria-label={t.file.choose}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) onFile(f);
                  e.target.value = "";
                }}
              />
              <p className="text-xs text-mu">{formatString(t.file.types, { max: IMPORT_MAX_FILE_MB })}</p>
            </div>
            <p className="flex items-center gap-1.5 text-xs text-mu">
              <Sparkles size={14} className="shrink-0 text-vi" aria-hidden="true" />
              {t.file.local}
            </p>
            <div aria-live="polite" className="space-y-2">
              {reading && (
                <p className="flex items-center gap-2 text-sm text-mu">
                  <Loader2 size={16} className="animate-spin motion-reduce:animate-none" aria-hidden="true" />
                  {t.file.reading}
                </p>
              )}
              {readError && (
                <p role="alert" className="rounded-md border border-short/40 bg-short/10 p-3 text-sm text-short">
                  {formatString(t.file.errors[readError], { max: IMPORT_MAX_FILE_MB })}
                </p>
              )}
              {fileName && tables.length > 0 && !readError && (
                <div className="space-y-3 rounded-md border border-line bg-s2/40 p-3" data-testid="import-file-summary">
                  <div className="text-sm font-semibold text-tx">{fileName}</div>
                  <div className="text-sm text-tx">
                    {format === "auto"
                      ? detectedId
                        ? formatString(t.file.detected, { platform: PLATFORM_NAMES[detectedId] + (isBetaFormat(detectedId) ? ` (${t.beta})` : "") })
                        : t.file.notDetected
                      : formatString(t.file.detected, { platform: PLATFORM_NAMES[format] + (isBetaFormat(format) ? ` (${t.beta})` : "") })}
                  </div>
                  {format !== "auto" && detectedId && detectedId !== format && (
                    <div className="flex flex-wrap items-center gap-2 text-sm text-amber-200">
                      {formatString(t.file.looksLike, { platform: PLATFORM_NAMES[detectedId] })}
                      <Button variant="secondary" size="sm" onClick={() => setFormat(detectedId)}>
                        {formatString(t.file.useDetected, { platform: PLATFORM_NAMES[detectedId] })}
                      </Button>
                    </div>
                  )}
                  {tables.length > 1 && (
                    <Select
                      label={t.file.sheet}
                      value={String(tableIndex)}
                      onChange={(v) => {
                        setTableIndex(Number(v));
                        if (isUniversal) prepareUniversal(tables[Number(v)]);
                      }}
                      options={tables.map((tb, i) => ({
                        value: String(i),
                        label: tb.name && Number.isNaN(Number(tb.name)) ? tb.name : `${KIND_LABEL[tb.kind]} ${i + 1}`,
                        description: formatString(t.file.rows, { count: tb.rows.length }),
                      }))}
                    />
                  )}
                </div>
              )}
            </div>
          </div>
        );

      case "mapping":
        if (!isUniversal)
          return (
            <p className="flex items-center gap-2 rounded-md border border-long/40 bg-long/10 p-3 text-sm text-tx">
              <Check size={16} className="shrink-0 text-long" aria-hidden="true" />
              {formatString(t.mapping.auto, { platform: PLATFORM_NAMES[parserId] })}
            </p>
          );
        return (
          <div className="space-y-4">
            <p className="text-sm text-mu">{t.mapping.manualHint}</p>
            {mappingRemembered && <p className="text-xs text-long">{t.mapping.remembered}</p>}
            <Select
              label={t.mapping.headerRow}
              value={String(headerRow)}
              onChange={(v) => {
                const hr = Number(v);
                setHeaderRow(hr);
                setMapping(suggestMapping(table?.rows[hr] ?? [], table?.rows.slice(hr + 1)));
              }}
              options={(table?.rows ?? []).slice(0, 15).map((r, i) => ({
                value: String(i),
                label: formatString(t.mapping.headerRowOption, { n: i + 1, preview: r.filter(Boolean).slice(0, 4).join(", ") }),
              }))}
            />
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {MAPPABLE_FIELDS.map((f: ImportField) => {
                const sample = isMapped(f) ? table?.rows[headerRow + 1]?.[mapping[f]!] : undefined;
                return (
                  <Select
                    key={f}
                    label={
                      <>
                        {t.mapping.fields[f]}
                        {REQUIRED_FIELDS.includes(f) && <span className="ml-0.5 text-short">*</span>}
                      </>
                    }
                    data-testid={`map-${f}`}
                    value={isMapped(f) ? String(mapping[f]) : "none"}
                    hint={sample ? formatString(t.mapping.sample, { value: sample }) : undefined}
                    error={
                      missingRequired.includes(f)
                        ? t.mapping.missingRequired.replace("{fields}", t.mapping.fields[f])
                        : mappedColumnHasNoNumbers(f, table?.rows.slice(headerRow + 1) ?? [], mapping[f])
                          ? t.mapping.notNumeric
                          : undefined
                    }
                    // "not used" is stored as -1, so a remembered mapping keeps the choice instead of guessing again
                    onChange={(v) => setMapping((m) => ({ ...m, [f]: v === "none" ? -1 : Number(v) }))}
                    options={[
                      { value: "none", label: t.mapping.notUsed },
                      ...headers.map((h, i) => ({ value: String(i), label: h || `#${i + 1}` })),
                    ]}
                  />
                );
              })}
            </div>
          </div>
        );

      case "settings": {
        const acc = activeAccounts.find((a) => a.id === accountChoice);
        return (
          <div className="space-y-5">
            <Select
              label={t.settings.account}
              value={accountChoice}
              onChange={setAccountChoice}
              data-testid="import-account"
              options={[
                ...activeAccounts.map((a) => ({
                  value: a.id,
                  label: `${a.name || dict.journal.accountsTab.mainAccountDefaultName} (${a.currency})`,
                  description: a.type === "prop" ? dict.journal.accountsTab.typeProp : a.type === "demo" ? dict.journal.accountsTab.typeDemo : dict.journal.accountsTab.typePersonal,
                })),
                { value: NEW_ACCOUNT, label: `+ ${t.settings.newAccount}` },
              ]}
            />
            {accountChoice === NEW_ACCOUNT ? (
              <div className="grid grid-cols-1 gap-3 rounded-md border border-line bg-ink/40 p-3 sm:grid-cols-3">
                <Input label={t.settings.newAccountName} value={newAccName} onChange={(e) => setNewAccName(e.target.value)} placeholder={dict.journal.accountsTab.mainAccountDefaultName} />
                <Select<AccountType>
                  label={dict.journal.accountTypeLabel}
                  value={newAccType}
                  onChange={setNewAccType}
                  options={[
                    { value: "personal", label: dict.journal.accountsTab.typePersonal },
                    { value: "prop", label: dict.journal.accountsTab.typeProp },
                    { value: "demo", label: dict.journal.accountsTab.typeDemo },
                  ]}
                />
                <Select<AccountCurrency>
                  label={t.settings.currency}
                  value={newAccCurrency}
                  onChange={setNewAccCurrency}
                  options={(["USD", "EUR", "GBP", "GEL", "RUB", "UAH", "KZT", "USDT"] as AccountCurrency[]).map((c) => ({ value: c, label: c }))}
                />
              </div>
            ) : (
              acc && <p className="-mt-3 text-xs text-mu">{`${t.settings.currency}: ${acc.currency}`}</p>
            )}
            {parsed?.detectedTimeZone ? (
              <p className="rounded-md border border-line bg-s2/40 p-3 text-sm text-tx">{formatString(t.settings.timeZoneFromFile, { zone: parsed.detectedTimeZone })}</p>
            ) : parserId !== "ayra" ? (
              <Select
                label={t.settings.timeZone}
                hint={formatString(t.settings.timeZoneHint, { zone: userTimeZone })}
                value={timeZone}
                onChange={setTimeZone}
                searchable
                options={timeZoneOptions(userTimeZone).map((z) => ({ value: z, label: z }))}
              />
            ) : null}
            {parserId !== "ayra" && (
              <div className="space-y-2">
                <Segmented<RMode>
                  label={t.settings.rMode}
                  value={rMode}
                  onChange={setRMode}
                  options={(["none", "stopLoss", "fixedRisk"] as RMode[]).map((m) => ({ value: m, label: t.settings.rModes[m], tone: "neutral" }))}
                />
                {rMode === "fixedRisk" && (
                  <NumberInput label={t.settings.fixedRisk} unit="$" value={fixedRisk} onChange={(e) => setFixedRisk(e.target.value)} placeholder="100" />
                )}
                {isUniversal && isMapped("rMultiple") && (
                  <p className="text-xs text-long" data-testid="import-r-from-file">
                    {formatString(t.settings.rFromFile, { column: headers[mapping.rMultiple!] || "R" })}
                  </p>
                )}
                <p className="text-xs text-mu">{t.settings.rHint}</p>
              </div>
            )}
            {strategyPlan.length > 0 && (
              <section className="space-y-2" data-testid="import-strategies">
                <h4 className="text-sm font-semibold text-tx">{t.settings.strategies}</h4>
                <ul className="space-y-1.5">
                  {strategyPlan.map((p) => (
                    <li key={p.key} className="text-sm">
                      {p.existing ? (
                        <span className="text-mu">
                          {formatString(t.settings.strategyMatched, { name: p.name, existing: p.existing.name || dict.journal.strategiesTab.defaultName })}
                        </span>
                      ) : (
                        <Checkbox
                          label={formatString(t.settings.strategyCreate, { name: p.name })}
                          checked={!skipStrategies.has(p.key)}
                          onChange={(c) =>
                            setSkipStrategies((s) => {
                              const n = new Set(s);
                              if (c) n.delete(p.key);
                              else n.add(p.key);
                              return n;
                            })
                          }
                        />
                      )}
                    </li>
                  ))}
                </ul>
                <p className="text-xs text-mu">{t.settings.strategiesHint}</p>
              </section>
            )}
          </div>
        );
      }

      case "preview": {
        const dup = preview.filter((r) => r.status !== "new").length;
        const errs = parsed?.errors ?? [];
        const shown = preview.slice(0, IMPORT_PREVIEW_ROWS);
        return (
          <div className="space-y-4">
            <p className="text-xs text-mu">{t.noXp}</p>
            <dl className="grid grid-cols-3 gap-2" data-testid="import-counters">
              {[
                { key: "new", label: t.preview.new, value: newRows.length, tone: "text-long" },
                { key: "dup", label: t.preview.duplicates, value: dup, tone: "text-mu" },
                { key: "err", label: t.preview.errors, value: errs.length, tone: errs.length ? "text-short" : "text-mu" },
              ].map((c) => (
                <div key={c.key} className="rounded-md bg-s2/60 px-3 py-2" data-counter={c.key}>
                  <dt className="text-xs text-mu">{c.label}</dt>
                  <dd className={cn("text-xl font-semibold tabular-nums", c.tone)}>{c.value}</dd>
                </div>
              ))}
            </dl>
            {newRows.length > IMPORT_MAX_TRADES && <p className="text-sm text-amber-200">{formatString(t.preview.tooMany, { max: IMPORT_MAX_TRADES })}</p>}
            {newRows.some((r) => r.open) && (
              <p className="text-xs text-mu" data-testid="import-open-count">
                {formatString(t.preview.openCount, { count: newRows.filter((r) => r.open).length })}
              </p>
            )}
            {newRows.length === 0 && <p className="rounded-md border border-dashed border-line p-4 text-center text-sm text-mu">{t.preview.nothing}</p>}
            {preview.length > 0 && (
              <div className="overflow-x-auto rounded-md border border-line">
                <table className="w-full min-w-[640px] text-left text-sm">
                  <thead className="border-b border-line text-xs text-mu">
                    <tr>
                      <th className="w-10 px-2 py-2">
                        <span className="sr-only">{t.preview.include}</span>
                      </th>
                      {(["date", "instrument", "direction", "size", "entry", "exit", "pnl", "r", "status"] as const).map((c) => (
                        <th key={c} scope="col" className={cn("px-2 py-2 font-semibold", ["size", "entry", "exit", "pnl", "r"].includes(c) && "text-right")}>
                          {t.preview.cols[c]}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map((r) => {
                      const tr = r.trade;
                      const isNew = r.status === "new";
                      return (
                        <tr key={r.index} className={cn("border-b border-line/60 last:border-0", !isNew && "opacity-60")} data-status={r.status}>
                          <td className="px-2">
                            <Checkbox
                              label={<span className="sr-only">{`${t.preview.include}: ${tr.instrument} ${fmtDate(tr.openedAt)}`}</span>}
                              checked={isNew && !excluded.has(r.index)}
                              disabled={!isNew}
                              onChange={(c) =>
                                setExcluded((s) => {
                                  const n = new Set(s);
                                  if (c) n.delete(r.index);
                                  else n.add(r.index);
                                  return n;
                                })
                              }
                            />
                          </td>
                          <td className="whitespace-nowrap px-2 py-2 tabular-nums text-mu">{fmtDate(tr.openedAt)}</td>
                          <td className="px-2 py-2 font-semibold text-tx">{tr.instrument}</td>
                          <td className={cn("px-2 py-2 text-xs font-semibold", tr.direction === "long" ? "text-long" : "text-short")}>
                            {tr.direction === "long" ? dict.journal.addTradeModal.directionLong : dict.journal.addTradeModal.directionShort}
                          </td>
                          <td className="px-2 py-2 text-right tabular-nums">{fmtNum(tr.size, 4)}</td>
                          <td className="px-2 py-2 text-right tabular-nums">{fmtNum(tr.entryPrice)}</td>
                          <td className="px-2 py-2 text-right tabular-nums">{fmtNum(tr.exitPrice)}</td>
                          <td className={cn("px-2 py-2 text-right font-semibold tabular-nums", (tr.pnlMoney ?? 0) > 0 ? "text-long" : (tr.pnlMoney ?? 0) < 0 ? "text-short" : "text-tx")}>
                            {fmtNum(tr.pnlMoney, 2)}
                          </td>
                          <td className="px-2 py-2 text-right tabular-nums">{fmtNum(tr.rMultiple, 2)}</td>
                          <td className="px-2 py-2 text-xs text-mu" data-testid="import-row-status">
                            <span className="whitespace-nowrap">{t.preview.status[r.status]}</span>
                            {r.reason && <span className="block max-w-[260px] text-[11px] leading-snug">{t.preview.reasonText[r.reason]}</span>}
                            {isNew && r.open && <span className="block max-w-[260px] text-[11px] leading-snug text-amber-200">{t.preview.openTrade}</span>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            {preview.length > shown.length && <p className="text-xs text-mu">{formatString(t.preview.showing, { count: shown.length, total: preview.length })}</p>}
            {errs.length > 0 && (
              <section className="space-y-2" data-testid="import-errors">
                <h3 className="text-sm font-semibold text-tx">{t.preview.errorsTitle}</h3>
                <ul className="max-h-40 space-y-1 overflow-y-auto text-sm text-short">
                  {errs.slice(0, 200).map((e, i) => (
                    <li key={`${e.row}-${i}`}>{reason(e)}</li>
                  ))}
                </ul>
              </section>
            )}
          </div>
        );
      }

      case "done":
        return (
          <div className="space-y-3 py-4 text-center" role="status">
            <div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-long/15 text-long">
              <Check size={24} strokeWidth={3} aria-hidden="true" />
            </div>
            <p className="text-lg font-semibold text-tx">{formatString(t.done.imported, { count: result?.imported ?? 0 })}</p>
            {!!result?.skipped && <p className="text-sm text-mu">{formatString(t.done.skipped, { count: result.skipped })}</p>}
          </div>
        );
    }
  })();

  return (
    <>
      <Modal
        isOpen={isOpen}
        onClose={onClose}
        title={t.wizardTitle}
        subtitle={`${formatString(t.stepOf, { step: stepIndex + 1, total: STEPS.length })} · ${t.steps[step]}`}
        closeLabel={t.close}
        size="xl"
        sheetOnMobile
        footer={footer}
        data-testid="import-wizard"
      >
        <ol className="mb-5 flex gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" aria-label={t.wizardTitle}>
          {STEPS.map((s, i) => (
            <li
              key={s}
              aria-current={s === step ? "step" : undefined}
              className={cn(
                "flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold",
                s === step ? "bg-vi/20 text-tx" : i < stepIndex ? "text-long" : "text-mu"
              )}
            >
              <span className={cn("grid h-5 w-5 place-items-center rounded-full text-[11px]", s === step ? "bg-vi text-ink" : i < stepIndex ? "bg-long/20" : "bg-s2")}>
                {i < stepIndex ? <Check size={12} strokeWidth={3} aria-hidden="true" /> : i + 1}
              </span>
              {t.steps[s]}
            </li>
          ))}
        </ol>
        <h3 className="sr-only">{t.steps[step]}</h3>
        {body}
      </Modal>
      <ConfirmDialog
        isOpen={undoBatch !== null}
        title={t.done.undoTitle}
        description={formatString(t.done.undoDesc, { count: undoBatch?.tradeCount ?? 0 })}
        confirmLabel={t.done.undoConfirm}
        cancelLabel={dict.journal.cancel}
        isDanger
        onConfirm={confirmUndo}
        onCancel={() => setUndoBatch(null)}
      />
    </>
  );
}

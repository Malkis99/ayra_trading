import type { RawTable } from "./types";

/* ------------------------------------------------------------------ text */

/** Decodes bytes as UTF-8 / UTF-16 (by BOM or by zero bytes); MetaTrader reports are often UTF-16LE. */
export function decodeText(bytes: Uint8Array): string {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder("utf-16le").decode(bytes.subarray(2));
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder("utf-16be").decode(bytes.subarray(2));
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return new TextDecoder("utf-8").decode(bytes.subarray(3));
  // UTF-16LE without BOM: every second byte is zero for ASCII text
  let zeros = 0;
  const probe = Math.min(bytes.length, 400);
  for (let i = 1; i < probe; i += 2) if (bytes[i] === 0) zeros++;
  if (probe > 20 && zeros > probe / 4) return new TextDecoder("utf-16le").decode(bytes);
  return new TextDecoder("utf-8").decode(bytes);
}

/* ------------------------------------------------------------------- CSV */

function detectDelimiter(text: string): string {
  const lines = text.split(/\r?\n/).filter((l) => l.trim()).slice(0, 10);
  const candidates = [",", ";", "\t", "|"];
  let best = ",";
  let bestScore = -1;
  for (const d of candidates) {
    const counts = lines.map((l) => {
      let n = 0;
      let quoted = false;
      for (const ch of l) {
        if (ch === '"') quoted = !quoted;
        else if (ch === d && !quoted) n++;
      }
      return n;
    });
    const max = Math.max(0, ...counts);
    // prefer delimiters that appear consistently in most lines
    const consistent = counts.filter((c) => c > 0 && c >= max * 0.5).length;
    const score = consistent * 10 + max;
    if (max > 0 && score > bestScore) {
      bestScore = score;
      best = d;
    }
  }
  return best;
}

/** RFC 4180 CSV parser with quotes, escaped quotes and auto-detected delimiter. */
export function parseCsv(text: string, delimiter?: string): string[][] {
  const src = text.replace(/^﻿/, "");
  const d = delimiter ?? detectDelimiter(src);
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += ch;
      continue;
    }
    if (ch === '"' && cell === "") quoted = true;
    else if (ch === d) {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  if (cell !== "" || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.map((r) => r.map((c) => c.trim())).filter((r) => r.some((c) => c !== ""));
}

/* ------------------------------------------------------------------ HTML */

/** Reads every <table> of an HTML report; colspan cells are expanded so columns line up. */
export function parseHtmlTables(html: string): RawTable[] {
  if (typeof DOMParser === "undefined") return [];
  const doc = new DOMParser().parseFromString(html, "text/html");
  const tables: RawTable[] = [];
  doc.querySelectorAll("table").forEach((table, index) => {
    const rows: string[][] = [];
    table.querySelectorAll("tr").forEach((tr) => {
      const row: string[] = [];
      tr.querySelectorAll("th,td").forEach((cell) => {
        const text = (cell.textContent ?? "").replace(/\s+/g, " ").trim();
        row.push(text);
        const span = Number(cell.getAttribute("colspan") ?? 1);
        for (let i = 1; i < Math.min(span, 30); i++) row.push("");
      });
      if (row.some((c) => c)) rows.push(row);
    });
    if (rows.length) tables.push({ kind: "html", name: String(index), rows });
  });
  return tables;
}

/* ------------------------------------------------------------------ ZIP */

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream === "undefined") throw new Error("xlsx-unsupported");
  const source = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(data);
      controller.close();
    },
  });
  const stream = source.pipeThrough(new DecompressionStream("deflate-raw") as unknown as ReadableWritablePair<Uint8Array, Uint8Array>);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Minimal ZIP reader (stored + deflate) over the central directory. */
export async function readZip(bytes: Uint8Array): Promise<Map<string, Uint8Array>> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("zip-invalid");
  const count = view.getUint16(eocd + 10, true);
  let p = view.getUint32(eocd + 16, true);
  const files = new Map<string, Uint8Array>();
  const decoder = new TextDecoder();
  for (let n = 0; n < count; n++) {
    if (view.getUint32(p, true) !== 0x02014b50) break;
    const method = view.getUint16(p + 10, true);
    const compSize = view.getUint32(p + 20, true);
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    const localOffset = view.getUint32(p + 42, true);
    const name = decoder.decode(bytes.subarray(p + 46, p + 46 + nameLen));
    const lNameLen = view.getUint16(localOffset + 26, true);
    const lExtraLen = view.getUint16(localOffset + 28, true);
    const start = localOffset + 30 + lNameLen + lExtraLen;
    const raw = bytes.subarray(start, start + compSize);
    if (method === 0) files.set(name, raw);
    else if (method === 8) files.set(name, await inflateRaw(raw));
    p += 46 + nameLen + extraLen + commentLen;
  }
  return files;
}

/* ----------------------------------------------------------------- XLSX */

const BUILTIN_DATE_FORMATS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 45, 46, 47]);

function excelSerialToText(serial: number): string {
  const ms = Math.round((serial - 25569) * 86400000); // 1899-12-30 epoch (1900 system)
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}

function colIndex(ref: string): number {
  const letters = /^[A-Z]+/.exec(ref)?.[0] ?? "A";
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function xml(text: string): Document {
  return new DOMParser().parseFromString(text, "application/xml");
}

const byLocalName = (root: Document | Element, name: string): Element[] =>
  Array.from(root.getElementsByTagName("*")).filter((e) => e.localName === name);

/** Reads every worksheet of an .xlsx file into string tables (dates become "YYYY-MM-DD HH:mm:ss"). */
export async function parseXlsx(bytes: Uint8Array): Promise<RawTable[]> {
  const files = await readZip(bytes);
  const text = (name: string) => {
    const f = files.get(name);
    return f ? new TextDecoder().decode(f) : null;
  };
  const shared: string[] = [];
  const sst = text("xl/sharedStrings.xml");
  if (sst) byLocalName(xml(sst), "si").forEach((si) => shared.push(byLocalName(si, "t").map((t) => t.textContent ?? "").join("")));

  const dateStyles = new Set<number>();
  const styles = text("xl/styles.xml");
  if (styles) {
    const doc = xml(styles);
    const custom = new Map<number, string>();
    byLocalName(doc, "numFmt").forEach((f) => custom.set(Number(f.getAttribute("numFmtId")), f.getAttribute("formatCode") ?? ""));
    const cellXfs = byLocalName(doc, "cellXfs")[0];
    if (cellXfs) {
      Array.from(cellXfs.children)
        .filter((e) => e.localName === "xf")
        .forEach((xf, i) => {
          const id = Number(xf.getAttribute("numFmtId") ?? 0);
          const code = custom.get(id) ?? "";
          if (BUILTIN_DATE_FORMATS.has(id) || (/[dmyh]/i.test(code.replace(/"[^"]*"|\[[^\]]*\]/g, "")) && !/^[#0.,%\s]+$/.test(code))) dateStyles.add(i);
        });
    }
  }

  const workbook = text("xl/workbook.xml");
  const rels = text("xl/_rels/workbook.xml.rels");
  const relTargets = new Map<string, string>();
  if (rels) byLocalName(xml(rels), "Relationship").forEach((r) => relTargets.set(r.getAttribute("Id") ?? "", r.getAttribute("Target") ?? ""));
  const sheets: Array<{ name: string; path: string }> = [];
  if (workbook) {
    byLocalName(xml(workbook), "sheet").forEach((s, i) => {
      const rid = s.getAttribute("r:id") ?? Array.from(s.attributes).find((a) => a.localName === "id")?.value ?? "";
      let target = relTargets.get(rid) ?? `worksheets/sheet${i + 1}.xml`;
      target = target.replace(/^\/?xl\//, "").replace(/^\//, "");
      sheets.push({ name: s.getAttribute("name") ?? `Sheet${i + 1}`, path: `xl/${target}` });
    });
  }

  const tables: RawTable[] = [];
  for (const sheet of sheets) {
    const src = text(sheet.path);
    if (!src) continue;
    const rows: string[][] = [];
    byLocalName(xml(src), "row").forEach((rowEl) => {
      const row: string[] = [];
      Array.from(rowEl.children)
        .filter((c) => c.localName === "c")
        .forEach((c) => {
          const idx = colIndex(c.getAttribute("r") ?? "A");
          const type = c.getAttribute("t");
          const v = byLocalName(c, "v")[0]?.textContent ?? "";
          let value = v;
          if (type === "s") value = shared[Number(v)] ?? "";
          else if (type === "inlineStr") value = byLocalName(c, "t").map((t) => t.textContent ?? "").join("");
          else if (type === "b") value = v === "1" ? "TRUE" : "FALSE";
          else if ((!type || type === "n") && v !== "" && dateStyles.has(Number(c.getAttribute("s") ?? -1))) value = excelSerialToText(Number(v));
          while (row.length < idx) row.push("");
          row[idx] = value.trim();
        });
      if (row.some((c) => c)) rows.push(row);
    });
    tables.push({ kind: "xlsx", name: sheet.name, rows });
  }
  return tables;
}

/* ----------------------------------------------------------------- files */

export type ReadError = "tooLarge" | "empty" | "unreadable" | "xlsxUnsupported";

export interface ReadResult {
  tables: RawTable[];
  error?: ReadError;
}

/** Reads a dropped file locally (never uploaded) into tables. */
export async function readImportFile(name: string, bytes: Uint8Array, maxBytes: number): Promise<ReadResult> {
  if (bytes.length === 0) return { tables: [], error: "empty" };
  if (bytes.length > maxBytes) return { tables: [], error: "tooLarge" };
  const lower = name.toLowerCase();
  try {
    if (bytes[0] === 0x50 && bytes[1] === 0x4b) {
      return { tables: await parseXlsx(bytes) };
    }
    const text = decodeText(bytes);
    const head = text.slice(0, 2000).trimStart();
    if (lower.endsWith(".json") || head.startsWith("{") || head.startsWith("[")) {
      return { tables: [{ kind: "json", rows: [], json: JSON.parse(text) }] };
    }
    if (lower.endsWith(".htm") || lower.endsWith(".html") || /<(html|table)\b/i.test(head)) {
      return { tables: parseHtmlTables(text) };
    }
    const rows = parseCsv(text);
    return { tables: rows.length ? [{ kind: "csv", name, rows }] : [], error: rows.length ? undefined : "empty" };
  } catch (e) {
    return { tables: [], error: e instanceof Error && e.message === "xlsx-unsupported" ? "xlsxUnsupported" : "unreadable" };
  }
}

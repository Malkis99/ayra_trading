import { plainText } from "./xml";

/** Expand only semantic table spans. Unknown layouts are rejected by each source's column checks. */
export function htmlTables(html: string): { caption: string; rows: string[][] }[] {
  return Array.from(html.matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/gi), table => {
    const rows: string[][] = [];
    const occupied = new Map<string, string>();
    for (const [ri, row] of Array.from(table[1].matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)).entries()) {
      const cells: string[] = [];
      let col = 0;
      for (const cell of row[1].matchAll(/<(th|td)\b([^>]*)>([\s\S]*?)<\/\1>/gi)) {
        while (occupied.has(`${ri}:${col}`)) { cells[col] = occupied.get(`${ri}:${col}`)!; col++; }
        const span = (name: string) => Number(cell[2].match(new RegExp(`\\b${name}=["']?(\\d+)`, "i"))?.[1] || 1);
        const width = span("colspan"), height = span("rowspan");
        if (width > 40 || height > 40 || col > 40) throw new Error("official table: unsupported spans");
        const text = plainText(cell[3].replace(/<sup\b[^>]*>([\s\S]*?)<\/sup>/gi, (_, body: string) => /^\(?\s*p\s*\)?$/i.test(plainText(body)) ? "(p)" : ""));
        for (let x = 0; x < width; x++) for (let y = 0; y < height; y++) occupied.set(`${ri+y}:${col+x}`, text);
        for (let x = 0; x < width; x++) cells[col+x] = text;
        col += width;
      }
      while (occupied.has(`${ri}:${col}`)) { cells[col] = occupied.get(`${ri}:${col}`)!; col++; }
      rows.push(cells);
    }
    return { caption: plainText(table[1].match(/<caption\b[^>]*>([\s\S]*?)<\/caption>/i)?.[1] || ""), rows };
  });
}

export const BLS_MONTHS = "January February March April May June July August September October November December".split(" ");
export function blsMonth(name: string): number {
  const word = name.toLowerCase().replace(/\.$/, "");
  return BLS_MONTHS.findIndex(m => m.toLowerCase() === word || m.slice(0,3).toLowerCase() === word || (m === "September" && word === "sept")) + 1;
}
export const blsPeriod = (month: string, year: string) => {
  const m = blsMonth(month);
  return m && /^\d{4}$/.test(year) ? `${year}-${String(m).padStart(2,"0")}` : null;
};

import { inflateSync } from "node:zlib";

/**
 * The plain text of a simple PDF (no library): every Flate-compressed content stream is inflated and the strings of
 * its text operators (`(…) Tj`, `[(…) -2 (…)] TJ`) are joined. Enough for a government news release set in a
 * standard font, like DOL's weekly claims; not a general PDF reader. Whitespace is collapsed to single spaces.
 */
export function pdfText(bytes: Uint8Array): string {
  const buf = Buffer.from(bytes);
  const s = buf.toString("latin1");
  const parts: string[] = [];
  const start = /stream\r?\n/g;
  let m: RegExpExecArray | null;
  while ((m = start.exec(s))) {
    const from = m.index + m[0].length;
    const to = s.indexOf("endstream", from);
    if (to < 0) break;
    let content: string;
    try {
      content = inflateSync(buf.subarray(from, to)).toString("latin1");
    } catch {
      continue; // an image or an uncompressed stream
    }
    for (const block of content.match(/BT[\s\S]*?ET/g) ?? []) {
      for (const op of block.match(/\[(?:\\.|[^\]\\])*\]\s*TJ|\((?:\\.|[^)\\])*\)\s*Tj/g) ?? []) {
        for (const str of op.match(/\((?:\\.|[^)\\])*\)/g) ?? []) parts.push(unescape(str.slice(1, -1)));
      }
      parts.push(" ");
    }
  }
  return parts.join("").replace(/\s+/g, " ").trim();
}

const ESCAPES: Record<string, string> = { n: "\n", r: "\r", t: "\t", b: "", f: "" };
const unescape = (s: string) => s.replace(/\\([nrtbf()\\]|[0-7]{1,3})/g, (_, c: string) => (/^[0-7]+$/.test(c) ? String.fromCharCode(parseInt(c, 8)) : ESCAPES[c] ?? c));

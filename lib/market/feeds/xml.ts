/**
 * Just enough XML for the official RSS 2.0 / Atom feeds (Fed, ECB, White House, BEA). No dependency: the feeds are
 * flat and regular; anything we do not recognise is skipped, never guessed.
 */

const NAMED: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "–", mdash: "—", hellip: "…",
  lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”", uuml: "ü", ouml: "ö", auml: "ä", eacute: "é", egrave: "è",
};

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return NAMED[e.toLowerCase()] ?? m;
  });
}

const unCdata = (s: string) => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");

/** Markup out, entities decoded, spaces squeezed. */
export function plainText(s: string): string {
  return decodeEntities(unCdata(s).replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
}

/** The blocks of a repeated element: `<item …>…</item>` or `<entry>…</entry>`. */
export function blocks(xml: string, tag: string): string[] {
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, "g");
  return Array.from(xml.matchAll(re), (m) => m[1]);
}

/** The raw inner text of the first `<tag>` (namespaced tags work: `dc:creator`). */
export function raw(block: string, tag: string): string | null {
  const m = block.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`));
  return m ? unCdata(m[1]) : null;
}

/** The plain text of the first `<tag>`, or null when missing / empty. */
export function text(block: string, tag: string): string | null {
  const r = raw(block, tag);
  if (r === null) return null;
  const t = plainText(r);
  return t || null;
}

/** All values of a repeated element (e.g. `<category>`). */
export function texts(block: string, tag: string): string[] {
  return blocks(block, tag).map((b) => plainText(b)).filter(Boolean);
}

/** Atom `<link href="…"/>` (the alternate one), or RSS `<link>…</link>`. */
export function link(block: string): string | null {
  const atom = block.match(/<link\b[^>]*\bhref="([^"]+)"[^>]*\/?>/);
  if (atom) return decodeEntities(atom[1]);
  return text(block, "link");
}

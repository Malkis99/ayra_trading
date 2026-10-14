/**
 * Time zones for pickers: every IANA zone the browser knows (with a fallback list), localised names with the
 * current UTC offset, grouped by region. Only the IANA id is ever stored.
 */

/** Used when Intl.supportedValuesOf is not available (older browsers). */
const FALLBACK_ZONES = [
  "UTC",
  "Europe/London", "Europe/Lisbon", "Europe/Dublin", "Europe/Madrid", "Europe/Paris", "Europe/Berlin", "Europe/Rome",
  "Europe/Amsterdam", "Europe/Warsaw", "Europe/Prague", "Europe/Vienna", "Europe/Stockholm", "Europe/Helsinki",
  "Europe/Kyiv", "Europe/Riga", "Europe/Vilnius", "Europe/Tallinn", "Europe/Minsk", "Europe/Istanbul", "Europe/Athens",
  "Europe/Bucharest", "Europe/Sofia", "Europe/Moscow", "Europe/Samara",
  "Asia/Tbilisi", "Asia/Yerevan", "Asia/Baku", "Asia/Dubai", "Asia/Tashkent", "Asia/Almaty", "Asia/Bishkek",
  "Asia/Yekaterinburg", "Asia/Omsk", "Asia/Novosibirsk", "Asia/Krasnoyarsk", "Asia/Irkutsk", "Asia/Yakutsk",
  "Asia/Vladivostok", "Asia/Magadan", "Asia/Kamchatka", "Asia/Jerusalem", "Asia/Riyadh", "Asia/Tehran", "Asia/Karachi",
  "Asia/Kolkata", "Asia/Dhaka", "Asia/Bangkok", "Asia/Jakarta", "Asia/Singapore", "Asia/Hong_Kong", "Asia/Shanghai",
  "Asia/Taipei", "Asia/Seoul", "Asia/Tokyo", "Asia/Manila",
  "Africa/Cairo", "Africa/Johannesburg", "Africa/Lagos", "Africa/Nairobi", "Africa/Casablanca",
  "America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles", "America/Anchorage", "America/Toronto",
  "America/Vancouver", "America/Mexico_City", "America/Bogota", "America/Lima", "America/Santiago", "America/Sao_Paulo",
  "America/Argentina/Buenos_Aires", "America/Caracas", "Pacific/Honolulu",
  "Australia/Perth", "Australia/Adelaide", "Australia/Brisbane", "Australia/Sydney", "Pacific/Auckland",
  "Atlantic/Reykjavik", "Atlantic/Azores", "Indian/Maldives", "Indian/Mauritius",
];

export const TZ_REGIONS = ["Europe", "Asia", "America", "Africa", "Australia", "Pacific", "Atlantic", "Indian", "Antarctica", "Arctic", "Other"] as const;
export type TzRegion = (typeof TZ_REGIONS)[number];

/** The browser's own zone (never empty). */
export function browserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

/** All zones: the browser list when available, always including UTC and the current one. */
export function allTimeZones(current?: string): string[] {
  let list: string[] = [];
  try {
    const intl = Intl as unknown as { supportedValuesOf?: (key: string) => string[] };
    list = intl.supportedValuesOf ? intl.supportedValuesOf("timeZone") : [];
  } catch {
    list = [];
  }
  if (list.length === 0) list = [...FALLBACK_ZONES];
  if (!list.includes("UTC")) list = ["UTC", ...list];
  if (current && !list.includes(current)) list = [current, ...list];
  return list;
}

export function tzRegion(zone: string): TzRegion {
  const head = zone.split("/")[0];
  return (TZ_REGIONS as readonly string[]).includes(head) ? (head as TzRegion) : "Other";
}

/** City part of an IANA id: "America/Argentina/Buenos_Aires" -> "Buenos Aires". */
export function tzCity(zone: string): string {
  const parts = zone.split("/");
  return (parts[parts.length - 1] || zone).replace(/_/g, " ");
}

/** UTC offset of a zone at the given moment, e.g. "UTC+4", "UTC−3:30", "UTC+0". */
export function timeZoneOffsetLabel(timeZone: string, date: Date = new Date()): string {
  try {
    const part = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "shortOffset" })
      .formatToParts(date)
      .find((p) => p.type === "timeZoneName")?.value;
    const m = part?.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/);
    if (!m) return "UTC+0";
    return `UTC${m[1] === "-" ? "−" : "+"}${Number(m[2])}${m[3] && m[3] !== "00" ? `:${m[3]}` : ""}`;
  } catch {
    return "UTC";
  }
}

export function offsetMinutes(label: string): number {
  const m = label.match(/UTC([+−-])(\d+)(?::(\d+))?/);
  if (!m) return 0;
  const v = Number(m[2]) * 60 + Number(m[3] ?? 0);
  return m[1] === "+" ? v : -v;
}

/** Localised zone name ("Грузия, стандартное время") with its UTC offset. */
export function timeZoneLabel(timeZone: string, lang: string, date: Date = new Date()): string {
  const offset = timeZoneOffsetLabel(timeZone, date);
  let name = "";
  try {
    name =
      new Intl.DateTimeFormat(lang, { timeZone, timeZoneName: "longGeneric" }).formatToParts(date).find((p) => p.type === "timeZoneName")?.value ?? "";
  } catch {
    name = "";
  }
  // Without a localised name Intl falls back to "GMT+04:00": show the offset only
  if (!name || /^(GMT|UTC)/.test(name)) return offset;
  return `${name} · ${offset}`;
}

export type TimeZoneOption = { value: string; label: string; description: string; region: TzRegion };

/** Every zone with a localised label; the city (from the id) is the description, so search finds "Tbilisi" too. */
export function timeZoneOptions(current: string, lang: string, date: Date = new Date()): TimeZoneOption[] {
  const order = (r: TzRegion) => TZ_REGIONS.indexOf(r);
  return allTimeZones(current)
    .map((z) => {
      const label = timeZoneLabel(z, lang, date);
      return { value: z, label, description: z === "UTC" ? "" : tzCity(z), region: tzRegion(z), offset: offsetMinutes(label) };
    })
    .sort((a, b) => order(a.region) - order(b.region) || a.offset - b.offset || a.description.localeCompare(b.description))
    .map(({ offset: _offset, ...o }) => o);
}

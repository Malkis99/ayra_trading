import { isDeepStrictEqual } from "node:util";

// 0017 stand-in only. The authoritative trigger/RLS are tested separately on real isolated PostgreSQL.
export function metadataWrite(old, data, expected, now) {
  if (old && expected === undefined) return { error: "23505" };
  if (!old && expected !== undefined || old && String(old.revision) !== expected) return { data: null };
  if (!data || data.id !== "watchlist_meta" || data.version !== 1 || old && old.version !== 1 || !Number.isSafeInteger(data.revision)
    || data.revision !== (old?.revision ?? 0) + 1 || !data.entries || typeof data.entries !== "object" || Array.isArray(data.entries)
    || "deletedAt" in data || ["xp", "coins", "xpAwarded", "coinsAwarded", "reward", "rewards"].some(k => k in data)) return { error: "P0001" };
  if (old) {
    for (const key of Object.keys(old).filter(k => !["id", "version", "revision", "updatedAt", "entries"].includes(k))) if (!isDeepStrictEqual(old[key], data[key])) return { error: "P0001" };
    for (const key of Object.keys(old.entries)) if (!(key in data.entries)) return { error: "P0001" };
  }
  let changed = false;const operations = new Set();
  for (const [id, entry] of Object.entries(data.entries)) {
    if (!/^[a-z0-9]{1,32}$/.test(id) || !entry || typeof entry.priority !== "boolean" || !Number.isSafeInteger(entry.revision) || entry.revision < 1
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(entry.operationId) || operations.has(entry.operationId)) return { error: "P0001" };
    operations.add(entry.operationId);const previous = old?.entries[id];
    if (previous) for (const key of Object.keys(previous).filter(k => !["priority", "revision", "operationId"].includes(k))) if (!isDeepStrictEqual(previous[key], entry[key])) return { error: "P0001" };
    if (!isDeepStrictEqual(previous, entry)) { changed = true;if (entry.revision !== (previous?.revision ?? 0) + 1 || previous?.operationId === entry.operationId) return { error: "P0001" }; }
  }
  if (old && !changed) return { error: "P0001" };
  const result = { ...data, updatedAt: now };
  return Buffer.byteLength(JSON.stringify(result), "utf8") > 16384 ? { error: "23514" } : { data: result };
}

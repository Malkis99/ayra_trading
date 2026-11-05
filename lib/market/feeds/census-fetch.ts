import type { Fetcher } from "./collect";

/** Census-only diagnostics. Never persist upstream bodies, URLs, headers or exception messages: they can contain keys. */
export async function fetchCensus(fetcher: Fetcher, url: string, key: string | undefined, code: string): Promise<unknown> {
  const label = `Census API ${code}`;
  if (!key?.trim()) throw new Error(`${label}: CENSUS_API_KEY is not set; no request sent`);
  const target = new URL(url);
  target.searchParams.set("key", key.trim());
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, 15_000);
  try {
    // Do not follow redirects carrying credentials, including redirects to HTML key/error pages.
    const res = await fetcher(target.toString(), {
      redirect: "manual", signal: controller.signal,
      headers: { Accept: "application/json", "User-Agent": "AYRA-Trading-market-feeds/1.0 (+https://github.com/Malkis99/ayra_trading)" },
    });
    const prefix = `${label}: HTTP ${res.status}`;
    if (res.status >= 300 && res.status < 400) throw new CensusError(`${prefix}; redirect refused`);
    const body = await res.text();
    const html = /^\s*(?:<!doctype\s+html|<html|<head|<body)/i.test(body) || /text\/html/i.test(res.headers?.get("content-type") ?? "");
    const kind = html && /Missing Key|valid key must be included/i.test(body) ? "missing API key page"
      : html && /Invalid Key/i.test(body) ? "invalid API key page"
      : html && /Cloudflare|you have been blocked/i.test(body) ? "access blocked HTML"
      : html ? "unexpected HTML" : null;
    if (!res.ok || kind) throw new CensusError(`${prefix}; ${kind ?? (res.status === 429 ? "rate limited; retry at existing cadence" : "request failed")}`);
    let parsed: unknown;
    try { parsed = JSON.parse(body); } catch { throw new CensusError(`${prefix}; invalid JSON`); }
    if (!Array.isArray(parsed) || !Array.isArray(parsed[0]) || !["cell_value", "data_type_code", "category_code", "seasonally_adj", "time"].every((c) => parsed[0].includes(c))) {
      throw new CensusError(`${prefix}; unexpected table schema`);
    }
    return parsed;
  } catch (err) {
    if (err instanceof CensusError) throw err;
    throw new Error(`${label}: ${timedOut ? "timeout" : "network or response read failed"}`);
  } finally {
    clearTimeout(timer);
  }
}

class CensusError extends Error {}

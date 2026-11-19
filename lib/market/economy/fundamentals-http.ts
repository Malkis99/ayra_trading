export class FundamentalFailure extends Error {
  constructor(message: string, readonly retryAt?: number) { super(message); }
}


const paused = new Map<string, number>();

/** Bounded public sources only. POST submits the official read-only DOL report form. */
export async function fetchFundamental(url: string, type: string, body?: string): Promise<string> {
  const origin = new URL(url).origin;
  if ((paused.get(origin) ?? 0) > Date.now()) throw new FundamentalFailure("cooldown");
  const response = await fetch(url, {
    method: body ? "POST" : "GET",
    ...(body ? { body, headers: { "Content-Type": "application/x-www-form-urlencoded" } } : {}),
    redirect: "error", cache: "no-store", signal: AbortSignal.timeout(6_000),
  });
  if (!response.ok) {
    const retry = response.headers.get("retry-after");
    const retryAt = retry ? (/^\d+$/.test(retry) ? Date.now() + Number(retry) * 1000 : Date.parse(retry)) : NaN;
    if ([403, 429, 503].includes(response.status)) paused.set(origin, Math.max(Date.now() + 60_000, Number.isFinite(retryAt) ? retryAt : 0));
    throw new FundamentalFailure("http_" + response.status, Number.isFinite(retryAt) ? retryAt : undefined);
  }
  if (!response.headers.get("content-type")?.toLowerCase().includes(type)) throw new FundamentalFailure("unexpected_media_type");
  const reader = response.body?.getReader();
  if (!reader) throw new FundamentalFailure("empty_response");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 2_000_000) throw new FundamentalFailure("response_too_large");
      chunks.push(value);
    }
  } finally {
    await reader.cancel();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return new TextDecoder().decode(bytes);
}



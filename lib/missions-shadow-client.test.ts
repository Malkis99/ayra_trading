import { beforeEach, describe, expect, it } from "vitest";
import { SHADOW_ENDPOINT, readShadowOutcomes, resetShadowOutcomes, sendMissionShadow } from "./missions-shadow-client";

const sent = [{ id: "m_lesson" as const, day: "2026-11-18", done: true, source: "note:n1" }];
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("Q4.2 shadow check — the app's side", () => {
  beforeEach(() => resetShadowOutcomes());

  it("posts only the app's decisions (no amounts), same-origin, and keeps the answer in this tab", async () => {
    let call: { url: string; init?: RequestInit } | null = null;
    const out = await sendMissionShadow(sent, (async (url: string, init?: RequestInit) => {
      call = { url, init };
      return json(200, { mode: "shadow", authorizedForPayout: false, results: [] });
    }) as typeof fetch);
    expect(out.ok).toBe(true);
    expect(call!.url).toBe(SHADOW_ENDPOINT);
    expect(call!.init?.credentials).toBe("same-origin");
    expect(JSON.parse(String(call!.init?.body))).toEqual({ missions: sent });
    expect(readShadowOutcomes()).toHaveLength(1);
  });

  it("server refusals and network failures never throw and are kept as codes", async () => {
    const refused = await sendMissionShadow(sent, (async () => json(429, { error: "rate_limited" })) as typeof fetch);
    expect(refused).toMatchObject({ ok: false, error: "rate_limited", status: 429 });
    const down = await sendMissionShadow(sent, (async () => { throw new TypeError("Failed to fetch"); }) as typeof fetch);
    expect(down).toMatchObject({ ok: false, error: "network" });
    const odd = await sendMissionShadow(sent, (async () => new Response("<html>", { status: 502 })) as typeof fetch);
    expect(odd).toMatchObject({ ok: false, error: "bad_response", status: 502 });
    expect(readShadowOutcomes().map((o) => o.ok)).toEqual([false, false, false]);
  });

  it("keeps the last ten answers only", async () => {
    for (let i = 0; i < 12; i++) await sendMissionShadow(sent, (async () => json(200, { mode: "shadow", results: [] })) as typeof fetch);
    expect(readShadowOutcomes()).toHaveLength(10);
  });
});

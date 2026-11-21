import { beforeEach, describe, expect, it } from "vitest";
import { AppStorage } from "./storage";
import { INITIAL_GAME_STATE, type GameState } from "./game";
import {
  ECONOMY_MODE_KEY,
  claimOf,
  deviceRewardsAllowed,
  economyBasis,
  laterMode,
  readStickyMode,
  refusesReward,
  rememberMode,
  resolveEconomyMode,
  sessionEconomyOf,
  type EconomyMode,
  type SessionEconomy,
} from "./economy-mode";

// Q4.5-1: the account's session carries the server's economy mark (app_metadata.ayra_economy). The mode in force is
// the latest of the device record, the session and the server — never backwards; no mark is not a proof of «local».

const A = "00000000-0000-0000-0000-00000000e0a1";
const B = "00000000-0000-0000-0000-00000000e0b2";
const NOW = Date.parse("2026-11-20T10:00:00Z");
const session = (claim: EconomyMode | null, over: Partial<SessionEconomy> = {}): SessionEconomy => ({ userId: A, claim, source: "verified", expiresAt: NOW + 3_600_000, ...over });

describe("Q4.5-1 the session's mark", () => {
  it("reads only known modes from app_metadata; anything else is no mark", () => {
    expect(claimOf({ ayra_economy: "cloud_active" })).toBe("cloud_active");
    expect(claimOf({ ayra_economy: "migration_scheduled" })).toBe("migration_scheduled");
    expect(claimOf({ ayra_economy: "CLOUD_ACTIVE" })).toBeNull();
    expect(claimOf({ ayra_economy: 3 })).toBeNull();
    expect(claimOf({ ayra_role: "owner" })).toBeNull();
    expect(claimOf(null)).toBeNull();
  });

  it("keeps the account, the source and the token's expiry", () => {
    expect(sessionEconomyOf({ id: A, app_metadata: { ayra_economy: "migration_pending" } }, "cached", 1_800_000_000)).toEqual({
      userId: A, claim: "migration_pending", source: "cached", expiresAt: 1_800_000_000_000,
    });
    expect(sessionEconomyOf(null, "verified")).toBeNull();
  });
});

describe("Q4.5-1 the mode in force — the latest of every source", () => {
  it("a session mark wins over a device that never saw one (new device, private window, cleared storage)", () => {
    expect(resolveEconomyMode({ known: "local", spaceId: `account:${A}`, session: session("cloud_active") })).toBe("cloud_active");
    expect(resolveEconomyMode({ known: "local", spaceId: `account:${A}`, session: session("migration_scheduled") })).toBe("migration_scheduled");
  });

  it("an older or missing mark never moves the device back (an old token, an error, the feature off)", () => {
    expect(resolveEconomyMode({ known: "cloud_active", spaceId: `account:${A}`, session: session(null) })).toBe("cloud_active");
    expect(resolveEconomyMode({ known: "cloud_active", spaceId: `account:${A}`, session: session("migration_pending") })).toBe("cloud_active");
    expect(resolveEconomyMode({ known: "migration_pending", spaceId: `account:${A}`, session: session("local"), server: "local" })).toBe("migration_pending");
    expect(resolveEconomyMode({ known: "migration_pending", spaceId: `account:${A}`, session: null, server: null })).toBe("migration_pending");
  });

  it("another account's session is never applied to this space (account change)", () => {
    expect(resolveEconomyMode({ known: "local", spaceId: `account:${B}`, session: session("cloud_active") })).toBe("local");
    expect(resolveEconomyMode({ known: "local", spaceId: "guest", session: session("cloud_active") })).toBe("local");
  });

  it("the order: local < scheduled < pending < cloud; local and scheduled give device rewards (owner decision 2026-11-18)", () => {
    expect(laterMode("migration_scheduled", "migration_pending")).toBe("migration_pending");
    expect(laterMode("cloud_active", "migration_scheduled")).toBe("cloud_active");
    expect((["local", "migration_scheduled", "migration_pending", "cloud_active"] as EconomyMode[]).map(deviceRewardsAllowed)).toEqual([true, true, false, false]);
  });
});

describe("Q4.5-1 on what the answer rests", () => {
  it("marked whenever any source marked the account — with a valid or an expired token, online or not", () => {
    expect(economyBasis("cloud_active", session("cloud_active"), NOW)).toBe("marked");
    expect(economyBasis("migration_pending", session(null, { expiresAt: NOW - 1 }), NOW)).toBe("marked");
    expect(economyBasis("migration_pending", null, NOW)).toBe("marked");
  });

  it("no mark: «confirmed» only with a verified session whose token is still valid; otherwise «unconfirmed»", () => {
    expect(economyBasis("local", session(null), NOW)).toBe("confirmed");
    expect(economyBasis("local", session(null, { expiresAt: NOW - 1 }), NOW)).toBe("unconfirmed"); // expired token
    expect(economyBasis("local", session(null, { source: "cached" }), NOW)).toBe("unconfirmed"); // offline: only the stored session
    expect(economyBasis("local", session(null, { expiresAt: null }), NOW)).toBe("unconfirmed");
    expect(economyBasis("local", null, NOW)).toBe("unconfirmed"); // guest or the auth mock
  });
});

describe("Q4.5-1 the device record follows the session", () => {
  beforeEach(() => {
    localStorage.clear();
    AppStorage.setUserId(A);
  });

  it("a mark from the session is written back after storage was cleared, and stays when the session loses it", () => {
    expect(readStickyMode()).toBe("local");
    const mode = resolveEconomyMode({ known: readStickyMode(), spaceId: `account:${A}`, session: session("migration_pending") });
    rememberMode(mode);
    expect(AppStorage.getItem(ECONOMY_MODE_KEY)).toBe("migration_pending");
    expect(resolveEconomyMode({ known: readStickyMode(), spaceId: `account:${A}`, session: session(null) })).toBe("migration_pending");
  });
});

const state = (over: Partial<GameState> = {}): GameState => ({ ...INITIAL_GAME_STATE, lastQuestDate: "2026-11-20", completedQuestsToday: {}, ...over });

describe("Q4.5-1 the reward gate at the moment of the change", () => {
  const reward = [state(), state({ xp: 40, coins: 10, completedQuestsToday: { m_lesson: true } })] as const;
  const noReward = [state(), state({ questAccepted: { day: "2026-11-20", at: { m_lesson: "x" } } })] as const;

  it("scheduled: a reward is given as before; pending and cloud: refused", () => {
    expect(refusesReward(...reward, "migration_scheduled")).toBe(false);
    expect(refusesReward(...reward, "local")).toBe(false);
    expect(refusesReward(...reward, "migration_pending")).toBe(true);
    expect(refusesReward(...reward, "cloud_active")).toBe(true);
  });

  it("the race: this tab still says scheduled, another tab has just saved pending — the reward is refused", () => {
    expect(refusesReward(...reward, "migration_scheduled", "migration_pending")).toBe(true);
    expect(refusesReward(...reward, "migration_pending", "migration_scheduled")).toBe(true); // the order does not matter
    expect(refusesReward(...reward, "local", "cloud_active")).toBe(true);
  });

  it("a change without a reward (an acceptance) is never refused, in any mode", () => {
    for (const m of ["local", "migration_scheduled", "migration_pending", "cloud_active"] as EconomyMode[]) expect(refusesReward(...noReward, m)).toBe(false);
  });
});


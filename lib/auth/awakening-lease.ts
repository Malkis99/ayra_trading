import { AppStorage } from "@/lib/storage";

export interface AwakeningLeaseData {
  ownerTabId: string;
  timestamp: number;
}

const LEASE_KEY = "ayra_awakening_lease";
export const LEASE_TTL_MS = 15000; // 15 seconds expiration
export const HEARTBEAT_INTERVAL_MS = 5000; // 5 seconds renewal

export function getLeaseInfo(): AwakeningLeaseData | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = AppStorage.getItem(LEASE_KEY);
    if (!raw) return null;
    const parsed: AwakeningLeaseData = JSON.parse(raw);
    if (!parsed || !parsed.ownerTabId || typeof parsed.timestamp !== "number") {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function isLeaseExpired(lease: AwakeningLeaseData | null): boolean {
  if (!lease) return true;
  return Date.now() - lease.timestamp > LEASE_TTL_MS;
}

export function isLeaseOwner(tabId: string): boolean {
  const lease = getLeaseInfo();
  if (!lease || isLeaseExpired(lease)) return true;
  return lease.ownerTabId === tabId;
}

export function acquireLease(tabId: string): boolean {
  if (typeof window === "undefined") return false;
  const lease = getLeaseInfo();
  if (!lease || isLeaseExpired(lease) || lease.ownerTabId === tabId) {
    const newLease: AwakeningLeaseData = {
      ownerTabId: tabId,
      timestamp: Date.now(),
    };
    try {
      AppStorage.setItem(LEASE_KEY, JSON.stringify(newLease));
      return true;
    } catch {
      return false;
    }
  }
  return false;
}

export function renewLease(tabId: string): boolean {
  if (typeof window === "undefined") return false;
  const lease = getLeaseInfo();
  if (lease && lease.ownerTabId === tabId) {
    const updated: AwakeningLeaseData = {
      ownerTabId: tabId,
      timestamp: Date.now(),
    };
    try {
      AppStorage.setItem(LEASE_KEY, JSON.stringify(updated));
      return true;
    } catch {
      return false;
    }
  } else {
    return acquireLease(tabId);
  }
}

export function stealLease(tabId: string): void {
  if (typeof window === "undefined") return;
  const newLease: AwakeningLeaseData = {
    ownerTabId: tabId,
    timestamp: Date.now(),
  };
  try {
    AppStorage.setItem(LEASE_KEY, JSON.stringify(newLease));
  } catch {}
}

export function releaseLease(tabId: string): void {
  if (typeof window === "undefined") return;
  const lease = getLeaseInfo();
  if (lease && lease.ownerTabId === tabId) {
    try {
      AppStorage.removeItem(LEASE_KEY);
    } catch {}
  }
}

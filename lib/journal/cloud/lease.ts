import { AppStorage } from "@/lib/storage";
import { SYNC_LEASE_TTL_MS } from "./config";

/**
 * "Leader" tab of one account: only the owner of this lease sends and pulls (T7b-4a).
 * Kept in the account space, so tabs of different accounts never compete. Same rules as the onboarding lease.
 */
const LEASE_KEY = "ayra_sync_lease";

interface LeaseData {
  ownerTabId: string;
  timestamp: number;
}

export class SyncLease {
  constructor(
    readonly userId: string,
    readonly tabId: string,
    private readonly now: () => number = () => Date.now()
  ) {}

  private read(): LeaseData | null {
    try {
      const raw = AppStorage.getItem(LEASE_KEY, this.userId);
      const parsed = raw ? JSON.parse(raw) : null;
      return parsed && typeof parsed.ownerTabId === "string" && typeof parsed.timestamp === "number" ? parsed : null;
    } catch {
      return null;
    }
  }

  /** Takes or renews the lease if it is free, expired or already ours. Returns true when this tab leads. */
  tryAcquire(): boolean {
    const lease = this.read();
    if (lease && lease.ownerTabId !== this.tabId && this.now() - lease.timestamp <= SYNC_LEASE_TTL_MS) return false;
    try {
      AppStorage.setItem(LEASE_KEY, JSON.stringify({ ownerTabId: this.tabId, timestamp: this.now() }), this.userId);
    } catch {
      return false;
    }
    return this.read()?.ownerTabId === this.tabId;
  }

  release(): void {
    if (this.read()?.ownerTabId !== this.tabId) return;
    try {
      AppStorage.removeItem(LEASE_KEY, this.userId);
    } catch {}
  }
}

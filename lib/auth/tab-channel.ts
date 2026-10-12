export type AuthMessageType = "AUTH_SIGNED_IN" | "AUTH_CLAIMED" | "AUTH_SIGNED_OUT";

export interface AuthChannelMessage {
  type: AuthMessageType;
  tabId: string;
  userId?: string;
  email?: string;
  timestamp: number;
}

import { AppStorage } from "@/lib/storage";

const CHANNEL_NAME = "ayra-auth";
const STORAGE_KEY = "ayra_auth_event";

// Unique Tab ID generated once per tab session
export const currentTabId =
  typeof window !== "undefined"
    ? (window as any).__AYRA_TAB_ID__ ||
      ((window as any).__AYRA_TAB_ID__ =
        "tab_" + Math.random().toString(36).slice(2, 10) + "_" + Date.now())
    : "server";

type MessageHandler = (msg: AuthChannelMessage) => void;

export class AuthTabChannel {
  private channel: BroadcastChannel | null = null;
  private listeners: Set<MessageHandler> = new Set();
  private isStorageListening = false;

  constructor() {
    if (typeof window !== "undefined") {
      if (typeof BroadcastChannel !== "undefined") {
        try {
          this.channel = new BroadcastChannel(CHANNEL_NAME);
          this.channel.onmessage = (event) => {
            if (event.data && event.data.tabId !== currentTabId) {
              this.notifyListeners(event.data);
            }
          };
        } catch {
          this.channel = null;
        }
      }

      // Storage event listener fallback
      this.setupStorageListener();
    }
  }

  private setupStorageListener() {
    if (typeof window === "undefined" || this.isStorageListening) return;
    this.isStorageListening = true;

    window.addEventListener("storage", (event) => {
      if (event.key === STORAGE_KEY && event.newValue) {
        try {
          const data: AuthChannelMessage = JSON.parse(event.newValue);
          if (data && data.tabId !== currentTabId) {
            this.notifyListeners(data);
          }
        } catch {}
      }
    });
  }

  public subscribe(handler: MessageHandler): () => void {
    this.listeners.add(handler);
    return () => {
      this.listeners.delete(handler);
    };
  }

  private notifyListeners(msg: AuthChannelMessage) {
    this.listeners.forEach((handler) => {
      try {
        handler(msg);
      } catch {}
    });
  }

  public broadcast(type: AuthMessageType, payload: Partial<AuthChannelMessage> = {}) {
    const msg: AuthChannelMessage = {
      type,
      tabId: currentTabId,
      timestamp: Date.now(),
      ...payload,
    };

    if (this.channel) {
      try {
        this.channel.postMessage(msg);
      } catch {}
    }

    // Always write to storage key for storage event fallback
    if (typeof window !== "undefined") {
      try {
        AppStorage.setItem(STORAGE_KEY, JSON.stringify(msg));
      } catch {}
    }
  }
}

export const authTabChannel = new AuthTabChannel();

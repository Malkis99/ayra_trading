import { AppStorage } from "@/lib/storage";

export interface SpaceChannelMessage {
  type: "SPACE_CHANGED";
  tabId: string;
  fromSpaceId: string;
  toSpaceId: string;
  timestamp: number;
}

const CHANNEL_NAME = "ayra-space";
const STORAGE_KEY = "ayra_space_event";

export const currentTabId =
  typeof window !== "undefined"
    ? (window as any).__AYRA_TAB_ID__ ||
      ((window as any).__AYRA_TAB_ID__ =
        "tab_" + Math.random().toString(36).slice(2, 10) + "_" + Date.now())
    : "server";

type SpaceMessageHandler = (msg: SpaceChannelMessage) => void;

export class SpaceTabChannel {
  private channel: BroadcastChannel | null = null;
  private listeners: Set<SpaceMessageHandler> = new Set();
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

      this.setupStorageListener();
    }
  }

  private setupStorageListener() {
    if (typeof window === "undefined" || this.isStorageListening) return;
    this.isStorageListening = true;

    window.addEventListener("storage", (event) => {
      if (event.key === STORAGE_KEY && event.newValue) {
        try {
          const data: SpaceChannelMessage = JSON.parse(event.newValue);
          if (data && data.tabId !== currentTabId) {
            this.notifyListeners(data);
          }
        } catch {}
      }
    });
  }

  public subscribe(handler: SpaceMessageHandler): () => void {
    this.listeners.add(handler);
    return () => {
      this.listeners.delete(handler);
    };
  }

  private notifyListeners(msg: SpaceChannelMessage) {
    this.listeners.forEach((handler) => {
      try {
        handler(msg);
      } catch {}
    });
  }

  /**
   * Notifies subscribers in this tab only (providers reload data of the now-active space).
   * broadcastSpaceChange reaches other tabs only, so same-tab switches must call this too.
   */
  public notifyLocal(fromSpaceId: string, toSpaceId: string) {
    this.notifyListeners({
      type: "SPACE_CHANGED",
      tabId: currentTabId,
      fromSpaceId,
      toSpaceId,
      timestamp: Date.now(),
    });
  }

  public broadcastSpaceChange(fromSpaceId: string, toSpaceId: string) {
    const msg: SpaceChannelMessage = {
      type: "SPACE_CHANGED",
      tabId: currentTabId,
      fromSpaceId,
      toSpaceId,
      timestamp: Date.now(),
    };

    if (this.channel) {
      try {
        this.channel.postMessage(msg);
      } catch {}
    }

    if (typeof window !== "undefined") {
      try {
        AppStorage.setItem(STORAGE_KEY, JSON.stringify(msg));
      } catch {}
    }
  }
}

export const spaceTabChannel = new SpaceTabChannel();

export type DirtyFormSaver = () => Promise<{ success: boolean; error?: any; textToCopy?: string }>;

class DirtyFormRegistry {
  private dirtyForms: Map<
    string,
    { isDirty: boolean; saveFn?: DirtyFormSaver; getText?: () => string }
  > = new Map();

  public registerForm(
    id: string,
    isDirty: boolean,
    saveFn?: DirtyFormSaver,
    getText?: () => string
  ): () => void {
    this.dirtyForms.set(id, { isDirty, saveFn, getText });
    return () => {
      this.dirtyForms.delete(id);
    };
  }

  public updateForm(
    id: string,
    isDirty: boolean,
    saveFn?: DirtyFormSaver,
    getText?: () => string
  ) {
    if (this.dirtyForms.has(id)) {
      this.dirtyForms.set(id, { isDirty, saveFn, getText });
    } else {
      this.dirtyForms.set(id, { isDirty, saveFn, getText });
    }
  }

  public unregisterForm(id: string) {
    this.dirtyForms.delete(id);
  }

  public isAnyFormDirty(): boolean {
    for (const form of this.dirtyForms.values()) {
      if (form.isDirty) return true;
    }
    return false;
  }

  public async flushAllDirtyForms(): Promise<{ success: boolean; error?: any; textToCopy?: string }> {
    for (const form of this.dirtyForms.values()) {
      if (form.isDirty) {
        if (form.saveFn) {
          try {
            const res = await form.saveFn();
            if (!res.success) {
              return {
                success: false,
                error: res.error || "Save failed",
                textToCopy: res.textToCopy || (form.getText ? form.getText() : undefined),
              };
            }
          } catch (err) {
            return {
              success: false,
              error: err,
              textToCopy: form.getText ? form.getText() : undefined,
            };
          }
        }
      }
    }
    return { success: true };
  }
}

export const dirtyFormRegistry = new DirtyFormRegistry();

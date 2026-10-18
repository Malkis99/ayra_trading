import type { JournalRepository } from "../types";
import { defaultJournalRepository } from "../repository";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { isE2EMockEnabled } from "@/lib/supabase/config";
import { CloudJournalRepository } from "./cloud-repository";
import { SupabaseJournalRemote } from "./remote";

export { CloudJournalRepository } from "./cloud-repository";
export type { JournalCloudStatus, JournalCloudState, PullResult } from "./cloud-repository";
export type { JournalCloudRemote } from "./remote";

/**
 * The journal repository used by the app. In the browser it is the cloud repository over the local one: it uses the
 * cloud only for accounts with cloud sync enabled, otherwise it is exactly the local journal.
 */
export function createJournalRepository(): JournalRepository {
  if (typeof window === "undefined" || isE2EMockEnabled()) return defaultJournalRepository;
  return new CloudJournalRepository(defaultJournalRepository, new SupabaseJournalRemote(createSupabaseBrowserClient));
}

export const journalRepository: JournalRepository = createJournalRepository();

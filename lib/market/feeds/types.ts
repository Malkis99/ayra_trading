/** Rows of the 0009 tables, as the collector writes them (columns the server sets itself are left out). */

/** The sources the tables accept (0009, widened by 0010; the 0010 sources not collected yet are added with their PR). */
export type FeedSource = "fed" | "ecb" | "whitehouse" | "bls" | "bea" | "eia" | "census" | "dol" | "eurostat";
export type Importance = 1 | 2 | 3;

export type EventKind = "release" | "meeting" | "decision" | "press_conference" | "speech" | "testimony" | "minutes" | "statement";
export type NewsKind = "decision" | "statement" | "speech" | "testimony" | "press_conference" | "minutes" | "data" | "presidential_action" | "press_release";

/** A calendar event's schedule (status, actual and previous are not part of it: they are kept when the schedule is refreshed). */
export interface EventRow {
  id: string;
  source: FeedSource;
  kind: EventKind;
  code: string | null;
  country: "us" | "eu";
  title: string;
  importance: Importance;
  /** ISO, UTC */
  starts_at: string;
  time_tbd: boolean;
  url: string | null;
  identity_key?: string | null;
  source_uid?: string | null;
  reference_period?: string | null;
  release_stage?: string | null;
  schedule_meta?: ScheduleMeta;
}

export interface ScheduleMeta {
  sequence?: number;
  modified?: string;
  cancelled?: boolean;
  /** Internal restoration state, never inferred from an upstream missing number. */
  prior_status?: "scheduled" | "released";
}

export interface ResultMeta {
  period: string;
  series: string;
  unit: string;
  adjustment: string;
  source_updated?: string;
}

/** A published figure for an event (from BEA's feed or the BLS API). */
export interface EventResult {
  id: string;
  status: "released";
  actual: string | null;
  previous: string | null;
  summary: string | null;
  reference_period?: string | null;
  release_stage?: string | null;
  result_meta?: ResultMeta;
}

export interface NewsRow {
  id: string;
  source: FeedSource;
  trust: "official";
  kind: NewsKind;
  country: "us" | "eu";
  title: string;
  summary: string | null;
  url: string;
  /** ISO, UTC */
  published_at: string;
  importance: Importance;
  dedupe_key: string;
  event_id: string | null;
  hidden: boolean;
}

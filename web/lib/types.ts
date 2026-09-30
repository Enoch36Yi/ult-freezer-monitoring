/** Mirrors the `readings` table in /supabase/schema.sql. */
export type Reading = {
  id: number;
  freezer_id: number;
  firmware_version: string | null;
  sensor_tier: string;
  temp_c: number;
  rssi: number | null;
  reset_reason: string | null;
  recorded_at: string;
  received_at: string;
};

/** The columns the dashboard actually selects. */
export type LatestReading = Pick<
  Reading,
  "freezer_id" | "firmware_version" | "temp_c" | "rssi" | "reset_reason" | "recorded_at" | "received_at"
>;

export type LatestPrototypeReading = Omit<LatestReading, "freezer_id"> & {
  prototype_id: 22;
};

export type HistoryPoint = Pick<Reading, "temp_c" | "rssi" | "recorded_at">;

export const FREEZER_IDS: number[] = Array.from({ length: 21 }, (_, i) => i + 1);

export const FREEZER_ID_MIN = 1;
export const FREEZER_ID_MAX = 21;

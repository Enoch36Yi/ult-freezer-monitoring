import { CORE_POST_INTERVAL_MS, postIntervalMs } from "./config.ts";

export const PROTOTYPE_ID = 22 as const;

export type MonitoringTarget =
  | { kind: "freezer"; id: number }
  | { kind: "prototype"; id: typeof PROTOTYPE_ID };

/** A prototype is an instrument, not a freezer in the 21-unit study. */
export function storageForTarget(target: MonitoringTarget) {
  if (target.kind === "prototype") {
    return {
      table: "prototype_readings",
      idColumn: "prototype_id",
      historyRpc: "prototype_readings_bucketed",
      label: "Prototype 22",
      intervalMs: CORE_POST_INTERVAL_MS,
    } as const;
  }

  return {
    table: "readings",
    idColumn: "freezer_id",
    historyRpc: "readings_bucketed",
    label: `Freezer ${target.id}`,
    intervalMs: postIntervalMs(target.id),
  } as const;
}

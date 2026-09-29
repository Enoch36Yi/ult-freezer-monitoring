import { postIntervalMs } from "./config.ts";

/** Readings are stored in Celsius; Fahrenheit is derived for display only. */
export function cToF(celsius: number): number {
  return celsius * (9 / 5) + 32;
}

export function formatC(celsius: number, digits = 1): string {
  return `${celsius.toFixed(digits)} °C`;
}

export function formatF(celsius: number, digits = 1): string {
  return `${cToF(celsius).toFixed(digits)} °F`;
}

/** Node liveness, derived from how long ago the last reading was recorded.
 *  The bands are expressed in missed posts — see lib/config.ts. */
export type NodeStatus = "live" | "stale" | "offline" | "no-data";

export function nodeStatus(
  recordedAt: string | null | undefined,
  now: number = Date.now(),
  freezerId: number = 0,
): NodeStatus {
  return nodeStatusAtInterval(recordedAt, now, postIntervalMs(freezerId));
}

export function nodeStatusAtInterval(
  recordedAt: string | null | undefined,
  now: number,
  intervalMs: number,
): NodeStatus {
  if (!recordedAt) return "no-data";
  const age = now - new Date(recordedAt).getTime();
  if (age < 3 * intervalMs) return "live";
  if (age < 12 * intervalMs) return "stale";
  return "offline";
}

/** Label + glyph so state never depends on color alone. */
export const STATUS_META: Record<
  NodeStatus,
  { label: string; glyph: string; varName: string }
> = {
  live: { label: "Live", glyph: "●", varName: "var(--status-good)" },
  stale: { label: "Stale", glyph: "▲", varName: "var(--status-warning)" },
  offline: { label: "Offline", glyph: "■", varName: "var(--status-critical)" },
  "no-data": { label: "No data", glyph: "—", varName: "var(--text-muted)" },
};

/** "42 s ago" / "6 min ago" / "3 h ago" / "2 d ago". */
export function relativeTime(
  isoTimestamp: string | null | undefined,
  now: number = Date.now(),
): string {
  if (!isoTimestamp) return "never";
  const seconds = Math.max(0, Math.round((now - new Date(isoTimestamp).getTime()) / 1000));
  if (seconds < 60) return `${seconds} s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} h ago`;
  return `${Math.round(hours / 24)} d ago`;
}

export function formatTimestamp(isoTimestamp: string): string {
  return new Date(isoTimestamp).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Rough signal quality band for the RSSI readout. */
export function rssiLabel(rssi: number | null | undefined): string {
  if (rssi === null || rssi === undefined) return "—";
  if (rssi >= -60) return `${rssi} dBm · strong`;
  if (rssi >= -70) return `${rssi} dBm · good`;
  if (rssi >= -80) return `${rssi} dBm · weak`;
  return `${rssi} dBm · very weak`;
}

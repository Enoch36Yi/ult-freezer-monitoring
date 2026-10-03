/** Must match firmware/include/sampling_policy.h and M1 YBR cell O8. */
export const CORE_POST_INTERVAL_MS = 60 * 1000;
export const FLEET_POST_INTERVAL_MS = 15 * 60 * 1000;

export function postIntervalMs(freezerId: number): number {
  return freezerId >= 1 && freezerId <= 6
    ? CORE_POST_INTERVAL_MS
    : FLEET_POST_INTERVAL_MS;
}

export function postIntervalLabel(freezerId: number): string {
  return postIntervalMs(freezerId) === CORE_POST_INTERVAL_MS
    ? "1 min"
    : "15 min";
}

/** Poll at the fastest node cadence so the core-six display stays current. */
export const REFRESH_MS = CORE_POST_INTERVAL_MS;
export const REFRESH_INTERVAL_LABEL = "1 min";

/** Liveness bands are expressed in missed posts for each freezer's cadence. */
export function staleAfterMs(freezerId: number): number {
  return 3 * postIntervalMs(freezerId);
}

export function offlineAfterMs(freezerId: number): number {
  return 12 * postIntervalMs(freezerId);
}

/**
 * Sensor tiers. This is a comparison study: the in-house PT1000/MAX31865
 * nodes are measured against two commercial systems in the same freezers, so
 * readings from different tiers must NEVER be aggregated together. The old
 * DS18B20 value remains selectable for historical rows and is never relabeled.
 */
export const IN_HOUSE_SENSOR_TIERS = [
  { value: "esp32_pt1000_max31865", label: "ESP32 / PT1000 + MAX31865" },
  { value: "esp32_ds18b20", label: "Historical ESP32 / DS18B20" },
] as const;

export const SENSOR_TIERS = [
  ...IN_HOUSE_SENSOR_TIERS,
  { value: "traxx", label: "TRAXX" },
  { value: "imonnit", label: "iMonnit" },
] as const;

export type SensorTier = (typeof SENSOR_TIERS)[number]["value"];

export const DEFAULT_SENSOR_TIER: SensorTier = "esp32_pt1000_max31865";

export function sensorTierLabel(tier: SensorTier): string {
  return SENSOR_TIERS.find((option) => option.value === tier)?.label ?? tier;
}

/** Remembered per browser so the choice survives navigation and reload. */
export const TIER_STORAGE_KEY = "ult.sensorTier";

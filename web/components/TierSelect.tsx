"use client";

import { useEffect, useState } from "react";
import {
  DEFAULT_SENSOR_TIER,
  SENSOR_TIERS,
  TIER_STORAGE_KEY,
  type SensorTier,
} from "@/lib/config";

/** Remembers the choice per browser so it survives navigation and reload. */
type SensorTierOption = { value: SensorTier; label: string };

export function useSensorTier(
  availableTiers: readonly SensorTierOption[] = SENSOR_TIERS,
): [SensorTier, (t: SensorTier) => void] {
  const [tier, setTierState] = useState<SensorTier>(DEFAULT_SENSOR_TIER);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(TIER_STORAGE_KEY);
      if (availableTiers.some((t) => t.value === saved)) {
        setTierState(saved as SensorTier);
      }
    } catch {
      // Private browsing or blocked site data — the default is fine.
    }
  }, [availableTiers]);

  const setTier = (next: SensorTier) => {
    setTierState(next);
    try {
      window.localStorage.setItem(TIER_STORAGE_KEY, next);
    } catch {
      // Non-fatal: the selection still applies for this page view.
    }
  };

  return [tier, setTier];
}

export function TierSelect({
  tier,
  onChange,
  options = SENSOR_TIERS,
}: {
  tier: SensorTier;
  onChange: (t: SensorTier) => void;
  options?: readonly SensorTierOption[];
}) {
  return (
    <label className="flex items-center gap-2 text-xs text-ink-muted">
      <span>Sensor</span>
      <select
        value={tier}
        onChange={(e) => onChange(e.target.value as SensorTier)}
        className="min-h-11 rounded-md border border-hairline bg-surface px-2 py-1 text-xs font-medium text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-series"
      >
        {options.map((t) => (
          <option key={t.value} value={t.value}>
            {t.label}
          </option>
        ))}
      </select>
    </label>
  );
}

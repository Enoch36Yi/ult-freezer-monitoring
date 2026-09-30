"use client";

import { useCallback, useEffect, useState } from "react";
import { FreezerCard } from "./FreezerCard";
import { fetchLatestPerFreezer } from "@/lib/readings";
import { nodeStatus, relativeTime } from "@/lib/format";
import { FREEZER_IDS, type LatestReading } from "@/lib/types";
import { REFRESH_INTERVAL_LABEL, REFRESH_MS } from "@/lib/config";
import { TierSelect, useSensorTier } from "./TierSelect";
import { PrototypeCard } from "./PrototypeCard";


export function FreezerGrid() {
  const [readings, setReadings] = useState<Map<number, LatestReading>>(new Map());
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  // Recomputed on every refresh so relative timestamps keep ticking.
  const [now, setNow] = useState(() => Date.now());
  const [tier, setTier] = useSensorTier();

  const refresh = useCallback(async () => {
    try {
      const latest = await fetchLatestPerFreezer(tier);
      setReadings(latest);
      setLastUpdated(Date.now());
      setError(null);
    } catch {
      setError("Could not load readings right now. Try again later.");
    } finally {
      setLoading(false);
      setNow(Date.now());
    }
  }, [tier]);

  useEffect(() => {
    refresh();
    const poll = setInterval(refresh, REFRESH_MS);
    // Tick the clock more often than we poll so "3 min ago" doesn't sit stale
    // between fetches.
    const tick = setInterval(() => setNow(Date.now()), 15_000);
    return () => {
      clearInterval(poll);
      clearInterval(tick);
    };
  }, [refresh]);

  const counts = FREEZER_IDS.reduce(
    (acc, id) => {
      const status = nodeStatus(readings.get(id)?.received_at, now, id);
      acc[status === "live" ? "live" : "attention"] += 1;
      return acc;
    },
    { live: 0, attention: 0 },
  );

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm text-ink-secondary">
        <span>
          {counts.live} of {FREEZER_IDS.length} reporting
          {counts.attention > 0 && (
            <span className="text-ink-muted">
              {" "}
              · {counts.attention} need attention
            </span>
          )}
        </span>
        <div className="flex items-center gap-4">
          <TierSelect tier={tier} onChange={setTier} />
          <span className="text-xs text-ink-muted tabular">
            {loading
              ? "Loading…"
              : `Updated ${relativeTime(
                  lastUpdated ? new Date(lastUpdated).toISOString() : null,
                  now,
                )} · refreshes every ${REFRESH_INTERVAL_LABEL}`}
          </span>
        </div>
      </div>

      {error && (
        <div
          role="alert"
          className="rounded-lg border border-hairline bg-surface p-3 text-sm"
          style={{ color: "var(--status-critical)" }}
        >
          ■ {error}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-7">
        {FREEZER_IDS.map((id) => (
          <FreezerCard
            key={id}
            freezerId={id}
            reading={readings.get(id)}
            now={now}
          />
        ))}
      </div>
      <PrototypeCard />
    </div>
  );
}

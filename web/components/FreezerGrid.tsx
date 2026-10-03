"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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
  const [hasSuccessfulResponse, setHasSuccessfulResponse] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  // Recomputed on every refresh so relative timestamps keep ticking.
  const [now, setNow] = useState(() => Date.now());
  const [tier, setTier] = useSensorTier();
  const requestId = useRef(0);

  const refresh = useCallback(async () => {
    const currentRequest = ++requestId.current;
    setRefreshing(true);
    try {
      const latest = await fetchLatestPerFreezer(tier);
      if (currentRequest !== requestId.current) return;
      setReadings(new Map(latest));
      setHasSuccessfulResponse(true);
      setLastUpdated(Date.now());
      setError(null);
    } catch {
      if (currentRequest !== requestId.current) return;
      setError("Could not load readings right now. Try again later.");
    } finally {
      if (currentRequest !== requestId.current) return;
      setLoading(false);
      setRefreshing(false);
      setNow(Date.now());
    }
  }, [tier]);

  useEffect(() => {
    // A tier switch must not leave values from the previous stream visible
    // while the new stream is loading.
    const emptyReadings = new Map<number, LatestReading>();
    setReadings(emptyReadings);
    setLastUpdated(null);
    setHasSuccessfulResponse(false);
    setError(null);
    setLoading(true);
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
  const dataUnavailable = Boolean(error && !hasSuccessfulResponse);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-3 text-sm text-ink-secondary sm:flex-row sm:items-baseline sm:justify-between">
        <span aria-live="polite">
          {loading && readings.size === 0
            ? `Loading ${FREEZER_IDS.length} freezers…`
            : dataUnavailable
              ? "Freezer status unavailable"
            : `${counts.live} of ${FREEZER_IDS.length} reporting`}
          {!loading && !dataUnavailable && counts.attention > 0 && (
            <span className="text-ink-muted">
              {" "}
              · {counts.attention} need attention
            </span>
          )}
        </span>
        <div className="flex w-full flex-col items-start gap-2 sm:w-auto sm:flex-row sm:items-center sm:gap-4">
          <TierSelect tier={tier} onChange={setTier} />
          <span className="text-xs text-ink-muted tabular">
            {loading
              ? "Loading…"
              : refreshing
                ? "Refreshing…"
              : `Last successful update ${relativeTime(
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
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="flex min-w-0 items-start gap-2">
              <span className="mt-1 shrink-0" aria-hidden="true">■</span>
              <span>{error}</span>
            </span>
            <button
              type="button"
              onClick={() => void refresh()}
              disabled={refreshing}
              className="min-h-11 rounded-md border border-hairline px-3 py-1.5 text-xs font-medium text-ink-secondary transition-colors hover:border-series hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-series disabled:cursor-wait disabled:opacity-60"
            >
              {refreshing ? "Retrying…" : "Try again"}
            </button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-7">
        {FREEZER_IDS.map((id) => (
          <FreezerCard
            key={id}
            freezerId={id}
            reading={readings.get(id)}
            loading={loading && readings.size === 0}
            unavailable={dataUnavailable}
            now={now}
          />
        ))}
      </div>
      <PrototypeCard />
    </div>
  );
}

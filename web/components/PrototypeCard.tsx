"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { StatusBadge } from "./StatusBadge";
import { REFRESH_MS } from "@/lib/config";
import { cToF, nodeStatusAtInterval, relativeTime } from "@/lib/format";
import { fetchPrototypeLatest } from "@/lib/readings";
import { PROTOTYPE_ID, storageForTarget } from "@/lib/target";
import type { LatestPrototypeReading } from "@/lib/types";

const target = storageForTarget({ kind: "prototype", id: PROTOTYPE_ID });

export function PrototypeCard() {
  const [reading, setReading] = useState<LatestPrototypeReading | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const requestId = useRef(0);
  const refresh = useCallback(async () => {
    const currentRequest = ++requestId.current;
    setRefreshing(true);
    try {
      const latest = await fetchPrototypeLatest();
      if (currentRequest !== requestId.current) return;
      setReading(latest);
      setError(null);
    } catch {
      if (currentRequest !== requestId.current) return;
      setError("Could not load prototype readings right now. Try again later.");
    } finally {
      if (currentRequest !== requestId.current) return;
      setLoading(false);
      setRefreshing(false);
    }
    setNow(Date.now());
  }, []);

  useEffect(() => {
    refresh();
    const poll = setInterval(refresh, REFRESH_MS);
    const tick = setInterval(() => setNow(Date.now()), 15_000);
    return () => { clearInterval(poll); clearInterval(tick); };
  }, [refresh]);

  const status = nodeStatusAtInterval(reading?.received_at, now, target.intervalMs);
  return (
    <section className="mt-8 border-t border-hairline pt-6" aria-label="Prototype">
      <h2 className="mb-1 text-lg font-semibold text-ink">Prototype 22</h2>
      <p className="mb-4 text-sm text-ink-secondary">Bench instrument · separate from the 21-freezer study</p>
      {error && (
        <div
          role="alert"
          className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-hairline bg-surface p-3 text-sm"
          style={{ color: "var(--status-critical)" }}
        >
          <span className="flex min-w-0 items-start gap-2">
            <span className="mt-1 shrink-0" aria-hidden="true">■</span>
            <span>{error}</span>
          </span>
          <button
            type="button"
            onClick={() => void refresh()}
            disabled={refreshing}
            className="min-h-11 rounded-md border border-hairline px-3 py-1.5 text-xs font-medium transition-colors hover:border-series hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-series disabled:cursor-wait disabled:opacity-60"
          >
            {refreshing ? "Retrying…" : "Try again"}
          </button>
        </div>
      )}
      <Link href="/prototype/22" className="group flex max-w-[245px] flex-col gap-3 rounded-lg border border-hairline bg-surface p-4 transition-colors hover:border-series focus:outline-none focus-visible:ring-2 focus-visible:ring-series">
        <div className="flex items-baseline justify-between">
          <span className="text-sm font-semibold text-ink-secondary">Prototype 22</span>
          {loading ? (
            <span className="text-xs font-medium text-ink-muted">Loading…</span>
          ) : (
            <StatusBadge status={status} />
          )}
        </div>
        {loading ? (
          <div className="text-sm text-ink-muted">Waiting for first response…</div>
        ) : reading ? (
          <div>
            <div className="text-3xl font-semibold leading-none text-ink">
              {cToF(reading.temp_c).toFixed(1)}<span className="ml-1 text-lg font-normal text-ink-secondary">°F</span>
            </div>
            <div className="mt-1 text-sm text-ink-secondary">{reading.temp_c.toFixed(1)} °C</div>
          </div>
        ) : <div className="text-3xl font-semibold leading-none text-ink-muted">—</div>}
        <div className="mt-auto text-xs text-ink-muted tabular">
          {loading ? "waiting for data" : reading ? relativeTime(reading.received_at, now) : "no readings yet"}
        </div>
        {reading?.firmware_version && (
          <span className="inline-flex w-fit rounded border border-hairline px-1.5 py-0.5 text-[10px] text-ink-muted tabular">
            firmware {reading.firmware_version}
          </span>
        )}
      </Link>
    </section>
  );
}

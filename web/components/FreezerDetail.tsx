"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { TempChart } from "./TempChart";
import { StatusBadge } from "./StatusBadge";
import {
  DEFAULT_RANGE,
  EMPTY_SERIES,
  RANGES,
  RANGE_KEYS,
  bucketLabel,
  fetchLatest,
  fetchPrototypeLatest,
  fetchPrototypeSeries,
  fetchSeries,
  forRender,
  seriesStats,
  type RangeKey,
  type Series,
  type SeriesPoint,
} from "@/lib/readings";
import {
  cToF,
  formatTimestamp,
  nodeStatus,
  nodeStatusAtInterval,
  relativeTime,
  rssiLabel,
} from "@/lib/format";
import type { LatestReading, LatestPrototypeReading } from "@/lib/types";
import { PROTOTYPE_ID, storageForTarget } from "@/lib/target";
import {
  REFRESH_INTERVAL_LABEL,
  REFRESH_MS,
  postIntervalLabel,
} from "@/lib/config";
import { TierSelect, useSensorTier } from "./TierSelect";


export function FreezerDetail({ freezerId, prototype = false }: { freezerId: number; prototype?: boolean }) {
  const [range, setRange] = useState<RangeKey>(DEFAULT_RANGE);
  const [series, setSeries] = useState<Series>(EMPTY_SERIES);
  const [latest, setLatest] = useState<LatestReading | LatestPrototypeReading | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showTable, setShowTable] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [tier, setTier] = useSensorTier();

  const refresh = useCallback(
    async (activeRange: RangeKey) => {
      try {
        // The header reads the true latest reading, not the last point in the
        // chart window, so "Current" and RSSI stay right even on a range that
        // happens to be empty.
        //
        // allSettled, not all: the two are independent, and a failure on the
        // chart range must not blank out a header that loaded fine — otherwise
        // a broken range makes a healthy freezer look like a dead node.
        const [latestRes, seriesRes] = await Promise.allSettled([
          prototype ? fetchPrototypeLatest() : fetchLatest(freezerId, tier),
          prototype ? fetchPrototypeSeries(activeRange) : fetchSeries(freezerId, activeRange, tier),
        ]);

        if (latestRes.status === "fulfilled") setLatest(latestRes.value);
        if (seriesRes.status === "fulfilled") setSeries(seriesRes.value);

        // Report the series failure first — it is the one tied to what the
        // reader just clicked.
        const failed = [seriesRes, latestRes].find(
          (r) => r.status === "rejected",
        ) as PromiseRejectedResult | undefined;

        setError(failed ? "Could not load readings right now. Try again later." : null);
      } catch {
        setError("Could not load readings right now. Try again later.");
      } finally {
        setLoading(false);
        setNow(Date.now());
      }
    },
    [freezerId, tier, prototype],
  );

  useEffect(() => {
    setLoading(true);
    refresh(range);
    const poll = setInterval(() => refresh(range), REFRESH_MS);
    const tick = setInterval(() => setNow(Date.now()), 15_000);
    return () => {
      clearInterval(poll);
      clearInterval(tick);
    };
  }, [range, refresh]);

  const plotted = useMemo(() => forRender(series), [series]);
  const stats = useMemo(() => seriesStats(series.points), [series]);
  const status = prototype
    ? nodeStatusAtInterval(latest?.received_at, now, storageForTarget({ kind: "prototype", id: PROTOTYPE_ID }).intervalMs)
    : nodeStatus(latest?.received_at, now, freezerId);

  const bucketNote = series.bucketSeconds
    ? `${bucketLabel(series.bucketSeconds)} bucket`
    : null;

  const spanNote =
    series.start && series.points.length > 0
      ? `${formatTimestamp(series.start.toISOString())} → ${formatTimestamp(
          series.end.toISOString(),
        )}`
      : null;

  return (
    <main className="mx-auto max-w-[1100px] px-5 py-8">
      <Link
        href="/"
        className="text-sm text-ink-secondary underline-offset-4 hover:underline"
      >
        ← All freezers
      </Link>

      <header className="mt-4 flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="text-xl font-semibold text-ink">{prototype ? "Prototype 22" : `Freezer ${freezerId}`}</h1>
        <div className="flex flex-wrap items-center gap-4">
          {!prototype && <TierSelect tier={tier} onChange={setTier} />}
          <div className="flex items-center gap-3">
            <StatusBadge status={status} />
            <span className="text-xs text-ink-muted tabular">
              last seen {relativeTime(latest?.received_at, now)}
            </span>
          </div>
        </div>
      </header>
      {prototype && <p className="mt-2 text-sm text-ink-secondary">Bench instrument · DS18B20 · excluded from the 21-freezer study</p>}

      {error && (
        <div
          role="alert"
          className="mt-4 rounded-lg border border-hairline bg-surface p-3 text-sm"
          style={{ color: "var(--status-critical)" }}
        >
          ■ {error}
        </div>
      )}

      <section className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat
          label="Current"
          value={latest ? `${cToF(latest.temp_c).toFixed(1)} °F` : "—"}
          sub={latest ? `${latest.temp_c.toFixed(2)} °C` : "no readings"}
          emphasis
        />
        <Stat
          label={`Mean · ${RANGES[range].label}`}
          value={stats ? `${cToF(stats.mean).toFixed(1)} °F` : "—"}
          sub={stats ? `${stats.mean.toFixed(2)} °C` : "—"}
        />
        <Stat
          // "to" rather than an en dash: every value here is negative, and
          // "-114.5 – -86.8" reads as a subtraction.
          label={`Range · ${RANGES[range].label}`}
          value={
            stats
              ? `${cToF(stats.min).toFixed(1)} to ${cToF(stats.max).toFixed(1)} °F`
              : "—"
          }
          sub={stats ? `${stats.min.toFixed(1)} to ${stats.max.toFixed(1)} °C` : "—"}
        />
        <Stat
          label="Signal"
          value={rssiLabel(latest?.rssi).split(" · ")[0]}
          sub={
            latest?.rssi !== null && latest?.rssi !== undefined
              ? rssiLabel(latest.rssi).split(" · ")[1]
              : "—"
          }
        />
      </section>

      {/* Filters sit in one row above the chart */}
      <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1" role="group" aria-label="Time range">
          {RANGE_KEYS.map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => setRange(key)}
              aria-pressed={range === key}
              className={`rounded-md border px-3 py-1.5 text-xs font-medium transition-colors ${
                range === key
                  ? "border-series bg-surface text-ink"
                  : "border-hairline bg-surface text-ink-secondary hover:text-ink"
              }`}
            >
              {RANGES[key].label}
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={() => setShowTable((v) => !v)}
          className="rounded-md border border-hairline bg-surface px-3 py-1.5 text-xs font-medium text-ink-secondary hover:text-ink"
        >
          {showTable ? "Show chart" : "Show table"}
        </button>
      </div>

      <div className="mt-3">
        {loading ? (
          <div className="flex h-[360px] items-center justify-center rounded-lg border border-hairline bg-surface text-sm text-ink-muted">
            Loading history…
          </div>
        ) : showTable ? (
          <SeriesTable points={series.points} banded={series.mode === "bucketed"} />
        ) : (
          <TempChart points={plotted} bucketNote={bucketNote} />
        )}
      </div>

      <p className="mt-3 text-xs text-ink-muted">
        {series.totalReadings.toLocaleString()} readings
        {spanNote && ` · ${spanNote}`}
        {series.mode === "bucketed"
          ? ` · aggregated server-side into ${series.points.length.toLocaleString()} ${bucketLabel(
              series.bucketSeconds ?? 0,
            )} buckets`
          : plotted.length < series.points.length
            ? ` · charted at ${plotted.length.toLocaleString()} points (peaks preserved)`
            : ""}
        {series.truncated && " · window clipped by the page cap"}
        {` · device interval ${prototype ? "1 min" : postIntervalLabel(freezerId)} · refreshes every ${REFRESH_INTERVAL_LABEL}`}
      </p>
    </main>
  );
}

function Stat({
  label,
  value,
  sub,
  emphasis = false,
}: {
  label: string;
  value: string;
  sub: string;
  emphasis?: boolean;
}) {
  return (
    <div className="rounded-lg border border-hairline bg-surface p-4">
      <div className="text-xs text-ink-muted">{label}</div>
      <div
        className={`mt-1 font-semibold text-ink ${
          emphasis ? "text-2xl" : "text-lg"
        }`}
      >
        {value}
      </div>
      <div className="mt-0.5 text-xs text-ink-secondary tabular">{sub}</div>
    </div>
  );
}

/** The chart's table equivalent — newest first, so the numbers are always
 *  reachable without reading a plot. */
function SeriesTable({
  points,
  banded,
}: {
  points: SeriesPoint[];
  banded: boolean;
}) {
  const rows = [...points].reverse().slice(0, 500);

  return (
    <div className="max-h-[360px] overflow-auto rounded-lg border border-hairline bg-surface">
      <table className="w-full text-left text-sm">
        <thead className="sticky top-0 bg-surface text-xs text-ink-muted">
          <tr className="border-b border-hairline">
            <th scope="col" className="px-4 py-2 font-medium">Time</th>
            <th scope="col" className="px-4 py-2 font-medium">
              {banded ? "Mean °F" : "°F"}
            </th>
            <th scope="col" className="px-4 py-2 font-medium">
              {banded ? "Mean °C" : "°C"}
            </th>
            {banded && (
              <>
                <th scope="col" className="px-4 py-2 font-medium">Min °C</th>
                <th scope="col" className="px-4 py-2 font-medium">Max °C</th>
                <th scope="col" className="px-4 py-2 font-medium">n</th>
              </>
            )}
          </tr>
        </thead>
        <tbody className="tabular">
          {rows.map((p) => (
            <tr key={p.t} className="border-b border-hairline last:border-0">
              <td className="px-4 py-1.5 text-ink-secondary">
                {formatTimestamp(new Date(p.t).toISOString())}
              </td>
              <td className="px-4 py-1.5 text-ink">{cToF(p.temp).toFixed(1)}</td>
              <td className="px-4 py-1.5 text-ink-secondary">
                {p.temp.toFixed(2)}
              </td>
              {banded && (
                <>
                  <td className="px-4 py-1.5 text-ink-secondary">
                    {p.min?.toFixed(2) ?? "—"}
                  </td>
                  <td className="px-4 py-1.5 text-ink-secondary">
                    {p.max?.toFixed(2) ?? "—"}
                  </td>
                  <td className="px-4 py-1.5 text-ink-muted">{p.count ?? "—"}</td>
                </>
              )}
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td
                colSpan={banded ? 6 : 3}
                className="px-4 py-6 text-center text-ink-muted"
              >
                No readings in this window.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

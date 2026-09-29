"use client";

import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipProps,
} from "recharts";
import { cToF } from "@/lib/format";
import type { SeriesPoint } from "@/lib/readings";

type Datum = {
  t: number;
  temp: number;
  band?: [number, number];
  min?: number;
  max?: number;
  count?: number;
};

const AXIS_TICK = { fill: "var(--text-muted)", fontSize: 11 };

const DAY_MS = 86_400_000;

/** Tick and tooltip granularity follow the span, not the range preset, so an
 *  open-ended "All time" window labels itself sensibly at any length. */
function axisFormatter(spanMs: number) {
  const opts: Intl.DateTimeFormatOptions =
    spanMs <= 2 * DAY_MS
      ? { hour: "2-digit", minute: "2-digit" }
      : spanMs <= 400 * DAY_MS
        ? { month: "short", day: "numeric" }
        : { month: "short", year: "numeric" };
  return (value: number) => new Date(value).toLocaleString(undefined, opts);
}

function ChartTooltip({ active, payload }: TooltipProps<number, string>) {
  if (!active || !payload?.length) return null;
  const point = payload[0].payload as Datum;
  const banded = point.min !== undefined && point.max !== undefined;

  return (
    <div className="rounded-md border border-hairline bg-surface px-3 py-2 text-xs shadow-sm">
      <div className="text-ink-muted tabular">
        {new Date(point.t).toLocaleString(undefined, {
          month: "short",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        })}
      </div>

      <div className="mt-1 flex items-baseline gap-2">
        <span
          aria-hidden="true"
          className="inline-block h-2 w-2 rounded-full"
          style={{ background: "var(--series-1)" }}
        />
        <span className="font-semibold text-ink tabular">
          {cToF(point.temp).toFixed(1)} °F
        </span>
        <span className="text-ink-secondary tabular">
          {point.temp.toFixed(2)} °C
        </span>
        {banded && <span className="text-ink-muted">mean</span>}
      </div>

      {banded && (
        <div className="mt-1 border-t border-hairline pt-1 text-ink-secondary tabular">
          <div>
            min {cToF(point.min!).toFixed(1)} °F ({point.min!.toFixed(2)} °C)
          </div>
          <div>
            max {cToF(point.max!).toFixed(1)} °F ({point.max!.toFixed(2)} °C)
          </div>
          {point.count !== undefined && (
            <div className="text-ink-muted">
              {point.count.toLocaleString()} readings
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function TempChart({
  points,
  bucketNote,
}: {
  points: SeriesPoint[];
  /** e.g. "hourly buckets" — null for raw series. */
  bucketNote: string | null;
}) {
  const data: Datum[] = points.map((p) => ({
    t: p.t,
    temp: p.temp,
    band:
      p.min !== undefined && p.max !== undefined
        ? ([p.min, p.max] as [number, number])
        : undefined,
    min: p.min,
    max: p.max,
    count: p.count,
  }));

  const hasBand = data.some((d) => d.band !== undefined);
  const spanMs =
    data.length > 1 ? data[data.length - 1].t - data[0].t : DAY_MS;

  if (data.length === 0) {
    return (
      <div className="flex h-[360px] items-center justify-center rounded-lg border border-hairline bg-surface text-sm text-ink-muted">
        No readings in this window.
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-hairline bg-surface p-4">
      {/* One series, so the heading names it instead of a legend box; the band
          is the same series' spread, direct-labeled here rather than in a key. */}
      <div className="mb-3">
        <div className="text-sm font-medium text-ink-secondary">
          Temperature (°C)
        </div>
        {hasBand && bucketNote && (
          <div className="mt-0.5 text-xs text-ink-muted">
            Line: mean per {bucketNote} · Shaded: min–max within each bucket
          </div>
        )}
      </div>

      <div className="h-[360px]">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart
            data={data}
            margin={{ top: 4, right: 8, bottom: 4, left: 0 }}
          >
            <CartesianGrid
              stroke="var(--grid)"
              strokeDasharray="0"
              vertical={false}
            />
            <XAxis
              dataKey="t"
              type="number"
              scale="time"
              domain={["dataMin", "dataMax"]}
              tickFormatter={axisFormatter(spanMs)}
              tick={AXIS_TICK}
              tickLine={false}
              axisLine={{ stroke: "var(--axis)" }}
              minTickGap={48}
            />
            <YAxis
              // Single scale only — °F lives in the tooltip and the readouts
              // above, never as a second axis.
              domain={["auto", "auto"]}
              tick={AXIS_TICK}
              tickLine={false}
              axisLine={false}
              width={52}
              tickFormatter={(v: number) => `${v.toFixed(0)}°`}
            />
            <Tooltip
              content={<ChartTooltip />}
              cursor={{ stroke: "var(--axis)", strokeWidth: 1 }}
            />

            {/* Drawn under the mean line: the spread the average hides. This is
                what keeps a door-open spike visible at coarse bucket widths. */}
            {hasBand && (
              <Area
                dataKey="band"
                stroke="none"
                fill="var(--series-1)"
                fillOpacity={0.18}
                isAnimationActive={false}
                activeDot={false}
                connectNulls
              />
            )}

            <Line
              type="monotone"
              dataKey="temp"
              stroke="var(--series-1)"
              strokeWidth={2}
              dot={false}
              activeDot={{
                r: 4,
                fill: "var(--series-1)",
                stroke: "var(--surface-1)",
                strokeWidth: 2,
              }}
              isAnimationActive={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

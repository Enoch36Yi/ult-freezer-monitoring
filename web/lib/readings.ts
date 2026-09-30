import { supabase } from "./supabase";
import { FREEZER_IDS, type HistoryPoint, type LatestReading, type LatestPrototypeReading } from "./types";
import type { SensorTier } from "./config";
import { PROTOTYPE_ID, storageForTarget, type MonitoringTarget } from "./target";

// PostgREST caps a response at 1000 rows (Supabase's default "Max rows"
// setting), so any window wider than that has to be paged — raw rows and
// bucketed rows alike.
const PAGE_SIZE = 1000;
const PAGE_CONCURRENCY = 8;

/**
 * Latest reading for every freezer, as one small query per node.
 *
 * A single "recent rows" query would silently drop any node that has been
 * offline longer than the window — exactly the node you most need to see — so
 * each freezer gets its own `limit 1`. Twenty-one indexed lookups on
 * (freezer_id, received_at desc) is cheap, and they run in parallel. Receipt
 * time is the server-side liveness signal; recorded_at remains the sensor's
 * measurement time for charts and provenance.
 */
export async function fetchLatestPerFreezer(
  tier: SensorTier,
): Promise<Map<number, LatestReading>> {
  const results = await Promise.all(
    FREEZER_IDS.map((id) => fetchLatest(id, tier)),
  );

  const byId = new Map<number, LatestReading>();
  for (const row of results) {
    if (row) byId.set(row.freezer_id, row);
  }
  return byId;
}

/** Most recent reading for one freezer, independent of any chart range. */
export async function fetchLatest(
  freezerId: number,
  tier: SensorTier,
): Promise<LatestReading | null> {
  const { data, error } = await supabase
    .from("readings")
    .select("freezer_id,firmware_version,temp_c,rssi,reset_reason,recorded_at,received_at")
    .eq("freezer_id", freezerId)
    .eq("sensor_tier", tier)
    .order("received_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;
  return { ...data, temp_c: Number(data.temp_c) } as LatestReading;
}

/** Most recent bench measurement; deliberately separate from the fleet map. */
export async function fetchPrototypeLatest(): Promise<LatestPrototypeReading | null> {
  const { data, error } = await supabase
    .from("prototype_readings")
    .select("prototype_id,firmware_version,temp_c,rssi,reset_reason,recorded_at,received_at")
    .eq("prototype_id", PROTOTYPE_ID)
    .eq("sensor_tier", "esp32_ds18b20")
    .order("received_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return { ...data, temp_c: Number(data.temp_c) } as LatestPrototypeReading;
}

export async function fetchPrototypeSeries(range: RangeKey): Promise<Series> {
  return fetchTargetSeries({ kind: "prototype", id: PROTOTYPE_ID }, range, "esp32_ds18b20");
}

/** Timestamp of the freezer's first-ever reading, for the "All time" range. */
export async function fetchEarliestTimestamp(
  freezerId: number,
  tier: SensorTier,
): Promise<string | null> {
  const { data, error } = await supabase
    .from("readings")
    .select("recorded_at")
    .eq("freezer_id", freezerId)
    .eq("sensor_tier", tier)
    .order("recorded_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data?.recorded_at ?? null;
}

// ---------------------------------------------------------------------------
// Ranges
// ---------------------------------------------------------------------------

/**
 * `raw` pages individual readings and thins them with LTTB; `bucketed` pushes
 * the aggregation into Postgres via readings_bucketed().
 *
 * The split is about row count, not preference: a week of 1-minute core data
 * is ~10k rows, which pages fine. A full study cycle (baseline → maintenance →
 * post-maintenance, ~35–40 days) or an open-ended "All time" has no upper
 * bound at all, so it has to aggregate server-side.
 */
export const RANGES = {
  "24h": { label: "24 hours", days: 1, mode: "raw" },
  "7d": { label: "7 days", days: 7, mode: "raw" },
  "30d": { label: "30 days", days: 30, mode: "bucketed" },
  "90d": { label: "90 days", days: 90, mode: "bucketed" },
  all: { label: "All time", days: null, mode: "bucketed" },
} as const;

export type RangeKey = keyof typeof RANGES;
export const RANGE_KEYS = Object.keys(RANGES) as RangeKey[];
export const DEFAULT_RANGE: RangeKey = "24h";

/**
 * Bucket width by span. Wider spans get coarser buckets so the request stays
 * bounded no matter how long the study runs — nothing clips, at any range.
 *
 * Coarser buckets do not lose the spikes: each bucket carries min and max
 * alongside the mean, and the chart draws that as a band. A door-open
 * excursion inside an hour-wide bucket still shows as a band spike, which is
 * the property the client-side LTTB path was protecting.
 */
// Sized for the mixed 1-minute / 15-minute cadence. Fleet buckets can contain
// a single reading at short spans; core buckets retain min/max bands.
const BUCKET_TIERS: { maxDays: number; seconds: number }[] = [
  { maxDays: 2, seconds: 300 }, //          5-minute buckets
  { maxDays: 31, seconds: 900 }, //         15-minute buckets
  { maxDays: 400, seconds: 3600 }, //       hourly buckets
  { maxDays: Infinity, seconds: 21600 }, //  6-hour buckets
];

export function bucketSecondsFor(spanMs: number): number {
  const days = spanMs / 86_400_000;
  return (
    BUCKET_TIERS.find((tier) => days <= tier.maxDays)?.seconds ??
    BUCKET_TIERS[BUCKET_TIERS.length - 1].seconds
  );
}

export function bucketLabel(seconds: number): string {
  if (seconds < 60) return `${seconds}-second`;
  if (seconds < 3600) return `${seconds / 60}-minute`;
  if (seconds === 3600) return "hourly";
  if (seconds < 86_400) return `${seconds / 3600}-hour`;
  return `${seconds / 86_400}-day`;
}

// ---------------------------------------------------------------------------
// Series
// ---------------------------------------------------------------------------

/** One plotted point. `min`/`max`/`count` are present only for bucketed data. */
export type SeriesPoint = {
  /** epoch ms */
  t: number;
  /** bucket mean, or the raw reading */
  temp: number;
  min?: number;
  max?: number;
  count?: number;
};

export type Series = {
  points: SeriesPoint[];
  mode: "raw" | "bucketed";
  /** null for raw series */
  bucketSeconds: number | null;
  /** Underlying readings represented, not the number of plotted points. */
  totalReadings: number;
  /** True only if the hard page cap was hit. */
  truncated: boolean;
  start: Date | null;
  end: Date;
};

export const EMPTY_SERIES: Series = {
  points: [],
  mode: "raw",
  bucketSeconds: null,
  totalReadings: 0,
  truncated: false,
  start: null,
  end: new Date(),
};

// Raw is only ever used for ≤ 7 days (~10k readings, 11 pages); bucketed tops
// out near 10k buckets by construction. Both sit well inside this cap, which
// exists so a pathological dataset degrades visibly instead of hanging.
const MAX_PAGES = 24;

type PageResult<T> = {
  data: T[] | null;
  count: number | null;
  error: { message: string } | null;
};

/** Fetches page 0 with an exact count, then the rest in parallel waves. */
async function fetchAllPages<T>(
  page: (from: number, to: number, withCount: boolean) => PromiseLike<PageResult<T>>,
): Promise<{ rows: T[]; total: number; truncated: boolean }> {
  const first = await page(0, PAGE_SIZE - 1, true);
  if (first.error) throw new Error(first.error.message);

  const firstRows = first.data ?? [];
  const total = first.count ?? firstRows.length;
  const neededPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const pages = Math.min(neededPages, MAX_PAGES);

  const chunks: T[][] = new Array(pages);
  chunks[0] = firstRows;

  for (let start = 1; start < pages; start += PAGE_CONCURRENCY) {
    const wave: Promise<void>[] = [];
    for (let p = start; p < Math.min(start + PAGE_CONCURRENCY, pages); p++) {
      wave.push(
        (async (index: number) => {
          const res = await page(
            index * PAGE_SIZE,
            index * PAGE_SIZE + PAGE_SIZE - 1,
            false,
          );
          if (res.error) throw new Error(res.error.message);
          chunks[index] = res.data ?? [];
        })(p),
      );
    }
    await Promise.all(wave);
  }

  return {
    rows: chunks.flat().filter(Boolean),
    total,
    truncated: neededPages > MAX_PAGES,
  };
}

/** Temperature series for one freezer over a range, oldest first. */
export async function fetchSeries(
  freezerId: number,
  range: RangeKey,
  tier: SensorTier,
): Promise<Series> {
  return fetchTargetSeries({ kind: "freezer", id: freezerId }, range, tier);
}

async function fetchTargetSeries(
  target: MonitoringTarget,
  range: RangeKey,
  tier: SensorTier,
): Promise<Series> {
  const end = new Date();
  const config = RANGES[range];

  let start: Date;
  if (config.days !== null) {
    start = new Date(end.getTime() - config.days * 86_400_000);
  } else {
    // "All time" — anchor on the freezer's first reading.
    const earliest = target.kind === "freezer"
      ? await fetchEarliestTimestamp(target.id, tier)
      : await fetchPrototypeEarliestTimestamp();
    if (!earliest) return { ...EMPTY_SERIES, end };
    start = new Date(earliest);
  }

  return config.mode === "raw"
    ? fetchRawSeries(target, start, end, tier)
    : fetchBucketedSeries(target, start, end, tier);
}

async function fetchPrototypeEarliestTimestamp(): Promise<string | null> {
  const { data, error } = await supabase
    .from("prototype_readings")
    .select("recorded_at")
    .eq("prototype_id", PROTOTYPE_ID)
    .eq("sensor_tier", "esp32_ds18b20")
    .order("recorded_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data?.recorded_at ?? null;
}

async function fetchRawSeries(
  target: MonitoringTarget,
  start: Date,
  end: Date,
  tier: SensorTier,
): Promise<Series> {
  const storage = storageForTarget(target);
  const { rows, total, truncated } = await fetchAllPages<HistoryPoint>(
    (from, to, withCount) =>
      supabase
        .from(storage.table)
        .select(
          "temp_c,rssi,recorded_at",
          withCount ? { count: "exact" } : undefined,
        )
        .eq(storage.idColumn, target.id)
        .eq("sensor_tier", tier)
        .gte("recorded_at", start.toISOString())
        .lt("recorded_at", end.toISOString())
        .order("recorded_at", { ascending: true })
        .range(from, to) as PromiseLike<PageResult<HistoryPoint>>,
  );

  return {
    points: rows.map((r) => ({
      t: new Date(r.recorded_at).getTime(),
      temp: Number(r.temp_c),
    })),
    mode: "raw",
    bucketSeconds: null,
    totalReadings: total,
    truncated,
    start,
    end,
  };
}

type BucketRow = {
  bucket_time: string;
  avg_temp_c: number | string;
  min_temp_c: number | string;
  max_temp_c: number | string;
  reading_count: number | string;
};

async function fetchBucketedSeries(
  target: MonitoringTarget,
  start: Date,
  end: Date,
  tier: SensorTier,
): Promise<Series> {
  const storage = storageForTarget(target);
  const seconds = bucketSecondsFor(end.getTime() - start.getTime());

  const { rows, truncated } = await fetchAllPages<BucketRow>(
    (from, to, withCount) =>
      supabase
        .rpc(
          storage.historyRpc,
          {
            [target.kind === "prototype" ? "p_prototype_id" : "p_freezer_id"]: target.id,
            p_start: start.toISOString(),
            p_end: end.toISOString(),
            p_bucket_seconds: seconds,
            p_sensor_tier: tier,
          },
          withCount ? { count: "exact" } : {},
        )
        // The function already orders by bucket_time, but paging is only
        // deterministic if the order is stated on the request itself.
        .order("bucket_time", { ascending: true })
        .range(from, to) as PromiseLike<PageResult<BucketRow>>,
  );

  let totalReadings = 0;
  const points: SeriesPoint[] = rows.map((r) => {
    const count = Number(r.reading_count);
    totalReadings += count;
    return {
      // Numeric columns can arrive as strings depending on driver settings;
      // coerce once here so nothing downstream has to care.
      t: new Date(r.bucket_time).getTime(),
      temp: Number(r.avg_temp_c),
      min: Number(r.min_temp_c),
      max: Number(r.max_temp_c),
      count,
    };
  });

  return {
    points,
    mode: "bucketed",
    bucketSeconds: seconds,
    totalReadings,
    truncated,
    start,
    end,
  };
}

// ---------------------------------------------------------------------------
// Render-side thinning
// ---------------------------------------------------------------------------

/** Plotted points beyond this are invisible on any real screen. */
const RENDER_TARGET = 1800;

/**
 * Reduces a series to something a chart can draw smoothly.
 *
 * Bucketed series regroup: merging adjacent buckets keeps min and max *exactly*
 * (the min of mins is the true min) and re-weights the mean by reading count,
 * so thinning costs nothing but horizontal resolution. Raw series have no
 * min/max to preserve, so they fall back to LTTB, which keeps the extreme
 * points that define the curve's shape instead of averaging spikes away.
 */
export function forRender(series: Series): SeriesPoint[] {
  const { points } = series;
  if (points.length <= RENDER_TARGET) return points;
  return series.mode === "bucketed"
    ? regroup(points, RENDER_TARGET)
    : lttb(points, 800);
}

function regroup(points: SeriesPoint[], target: number): SeriesPoint[] {
  const groupSize = Math.ceil(points.length / target);
  const out: SeriesPoint[] = [];

  for (let i = 0; i < points.length; i += groupSize) {
    const group = points.slice(i, i + groupSize);

    let min = Infinity;
    let max = -Infinity;
    let weighted = 0;
    let count = 0;

    for (const p of group) {
      if ((p.min ?? p.temp) < min) min = p.min ?? p.temp;
      if ((p.max ?? p.temp) > max) max = p.max ?? p.temp;
      const n = p.count ?? 1;
      weighted += p.temp * n;
      count += n;
    }

    out.push({
      t: group[0].t,
      temp: count > 0 ? weighted / count : group[0].temp,
      min,
      max,
      count,
    });
  }

  return out;
}

/**
 * Largest-Triangle-Three-Buckets downsampling: keeps the points that define the
 * visual shape of the curve rather than the mean of each bucket, so a brief
 * door-open spike survives into a thinned view.
 */
export function lttb(points: SeriesPoint[], threshold: number): SeriesPoint[] {
  const n = points.length;
  if (threshold >= n || threshold < 3) return points;

  const sampled: SeriesPoint[] = [points[0]];
  const bucketSize = (n - 2) / (threshold - 2);

  let a = 0; // index of the point kept from the previous bucket

  for (let i = 0; i < threshold - 2; i++) {
    // Average of the *next* bucket, used as the third triangle vertex.
    const nextStart = Math.floor((i + 1) * bucketSize) + 1;
    const nextEnd = Math.min(Math.floor((i + 2) * bucketSize) + 1, n);
    const nextLen = Math.max(1, nextEnd - nextStart);

    let avgX = 0;
    let avgY = 0;
    for (let j = nextStart; j < nextEnd; j++) {
      avgX += points[j].t;
      avgY += points[j].temp;
    }
    avgX /= nextLen;
    avgY /= nextLen;

    const rangeStart = Math.floor(i * bucketSize) + 1;
    const rangeEnd = Math.min(Math.floor((i + 1) * bucketSize) + 1, n);

    const ax = points[a].t;
    const ay = points[a].temp;

    let maxArea = -1;
    let chosen = rangeStart;
    for (let j = rangeStart; j < rangeEnd; j++) {
      const area = Math.abs(
        (ax - avgX) * (points[j].temp - ay) - (ax - points[j].t) * (avgY - ay),
      );
      if (area > maxArea) {
        maxArea = area;
        chosen = j;
      }
    }

    sampled.push(points[chosen]);
    a = chosen;
  }

  sampled.push(points[n - 1]);
  return sampled;
}

/** Min / max / mean across a whole series, exact for bucketed data. */
export function seriesStats(
  points: SeriesPoint[],
): { min: number; max: number; mean: number } | null {
  if (points.length === 0) return null;

  let min = Infinity;
  let max = -Infinity;
  let weighted = 0;
  let count = 0;

  for (const p of points) {
    if ((p.min ?? p.temp) < min) min = p.min ?? p.temp;
    if ((p.max ?? p.temp) > max) max = p.max ?? p.temp;
    const n = p.count ?? 1;
    weighted += p.temp * n;
    count += n;
  }

  return { min, max, mean: weighted / count };
}

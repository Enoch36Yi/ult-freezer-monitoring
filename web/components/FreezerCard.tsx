import Link from "next/link";
import { StatusBadge } from "./StatusBadge";
import {
  cToF,
  nodeStatus,
  relativeTime,
  type NodeStatus,
} from "@/lib/format";
import type { LatestReading } from "@/lib/types";

export function FreezerCard({
  freezerId,
  reading,
  loading = false,
  unavailable = false,
  now,
}: {
  freezerId: number;
  reading: LatestReading | undefined;
  loading?: boolean;
  unavailable?: boolean;
  now: number;
}) {
  const status: NodeStatus = nodeStatus(reading?.received_at, now, freezerId);
  const hasReading = reading !== undefined;

  return (
    <Link
      href={`/freezer/${freezerId}`}
      className="group flex flex-col gap-3 rounded-lg border border-hairline bg-surface p-4 transition-colors hover:border-series focus:outline-none focus-visible:ring-2 focus-visible:ring-series"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-1">
        <span className="whitespace-nowrap text-sm font-semibold text-ink-secondary">
          Freezer {freezerId}
        </span>
        {loading ? (
          <span className="whitespace-nowrap text-xs font-medium text-ink-muted">Loading…</span>
        ) : unavailable ? (
          <span className="whitespace-nowrap text-xs font-medium text-ink-muted">Unavailable</span>
        ) : (
          <StatusBadge status={status} />
        )}
      </div>

      {loading ? (
        <div className="text-sm text-ink-muted">Waiting for first response…</div>
      ) : unavailable ? (
        <div className="text-2xl font-semibold leading-none text-ink-muted">Unavailable</div>
      ) : hasReading ? (
        <div>
          <div className="text-3xl font-semibold leading-none text-ink">
            {cToF(reading.temp_c).toFixed(1)}
            <span className="ml-1 text-lg font-normal text-ink-secondary">°F</span>
          </div>
          <div className="mt-1 text-sm text-ink-secondary">
            {reading.temp_c.toFixed(1)} °C
          </div>
        </div>
      ) : (
        <div className="text-3xl font-semibold leading-none text-ink-muted">—</div>
      )}

      <div className="mt-auto text-xs text-ink-muted tabular">
        {loading
          ? "waiting for data"
          : unavailable
            ? "data unavailable"
            : hasReading
              ? relativeTime(reading.received_at, now)
              : "no readings yet"}
      </div>
      {reading?.firmware_version && (
        <span className="inline-flex w-fit rounded border border-hairline px-1.5 py-0.5 text-[10px] text-ink-muted tabular">
          firmware {reading.firmware_version}
        </span>
      )}
    </Link>
  );
}

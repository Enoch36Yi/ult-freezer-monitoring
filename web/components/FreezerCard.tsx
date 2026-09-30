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
  now,
}: {
  freezerId: number;
  reading: LatestReading | undefined;
  now: number;
}) {
  const status: NodeStatus = nodeStatus(reading?.received_at, now, freezerId);
  const hasReading = reading !== undefined;

  return (
    <Link
      href={`/freezer/${freezerId}`}
      className="group flex flex-col gap-3 rounded-lg border border-hairline bg-surface p-4 transition-colors hover:border-series focus:outline-none focus-visible:ring-2 focus-visible:ring-series"
    >
      <div className="flex items-baseline justify-between">
        <span className="text-sm font-semibold text-ink-secondary">
          Freezer {freezerId}
        </span>
        <StatusBadge status={status} />
      </div>

      {hasReading ? (
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
        {hasReading ? relativeTime(reading.received_at, now) : "no readings yet"}
      </div>
    </Link>
  );
}

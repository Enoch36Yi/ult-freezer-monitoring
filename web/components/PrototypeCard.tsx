"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
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
  const refresh = useCallback(async () => {
    try {
      setReading(await fetchPrototypeLatest());
      setError(null);
    } catch {
      setError("Could not load prototype readings right now. Try again later.");
    }
    setNow(Date.now());
  }, []);

  useEffect(() => {
    refresh();
    const poll = setInterval(refresh, REFRESH_MS);
    const tick = setInterval(() => setNow(Date.now()), 15_000);
    return () => { clearInterval(poll); clearInterval(tick); };
  }, [refresh]);

  const status = nodeStatusAtInterval(reading?.recorded_at, now, target.intervalMs);
  return (
    <section className="mt-8 border-t border-hairline pt-6" aria-label="Prototype">
      <h2 className="mb-1 text-lg font-semibold text-ink">Prototype 22</h2>
      <p className="mb-4 text-sm text-ink-secondary">Bench instrument · separate from the 21-freezer study</p>
      {error && <p role="alert" className="mb-3 text-sm text-ink-secondary">Could not load prototype: {error}</p>}
      <Link href="/prototype/22" className="group flex max-w-[245px] flex-col gap-3 rounded-lg border border-hairline bg-surface p-4 transition-colors hover:border-series focus:outline-none focus-visible:ring-2 focus-visible:ring-series">
        <div className="flex items-baseline justify-between">
          <span className="text-sm font-semibold text-ink-secondary">Prototype 22</span>
          <StatusBadge status={status} />
        </div>
        {reading ? (
          <div>
            <div className="text-3xl font-semibold leading-none text-ink">
              {cToF(reading.temp_c).toFixed(1)}<span className="ml-1 text-lg font-normal text-ink-secondary">°F</span>
            </div>
            <div className="mt-1 text-sm text-ink-secondary">{reading.temp_c.toFixed(1)} °C</div>
          </div>
        ) : <div className="text-3xl font-semibold leading-none text-ink-muted">—</div>}
        <div className="mt-auto text-xs text-ink-muted tabular">
          {reading ? relativeTime(reading.recorded_at, now) : "no readings yet"}
        </div>
      </Link>
    </section>
  );
}

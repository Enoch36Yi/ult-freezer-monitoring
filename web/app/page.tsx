import { FreezerGrid } from "@/components/FreezerGrid";

export default function DashboardPage() {
  return (
    <main className="mx-auto max-w-[1400px] px-5 py-8">
      <header className="mb-6">
        <h1 className="text-xl font-semibold text-ink">ULT Freezer Monitoring</h1>
        <p className="mt-1 text-sm text-ink-secondary">
          Ultra-low-temperature freezers 1–21. Select a freezer for its
          temperature history.
        </p>
      </header>

      <FreezerGrid />
    </main>
  );
}

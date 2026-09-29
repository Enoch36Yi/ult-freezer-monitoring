import { STATUS_META, type NodeStatus } from "@/lib/format";

/** Glyph + text label, so node state is never carried by color alone. */
export function StatusBadge({
  status,
  className = "",
}: {
  status: NodeStatus;
  className?: string;
}) {
  const meta = STATUS_META[status];
  return (
    <span
      className={`inline-flex items-center gap-1.5 text-xs font-medium text-ink-secondary ${className}`}
    >
      <span aria-hidden="true" style={{ color: meta.varName }}>
        {meta.glyph}
      </span>
      {meta.label}
    </span>
  );
}

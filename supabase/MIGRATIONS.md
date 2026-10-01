# Supabase migration ledger

This ledger is the source of truth for applying the numbered SQL files to an
existing project. Record the application timestamp, operator, and result in
the operations log after each file. The files are additive or function/permission
replacements; none should be used as a data-deletion mechanism.

## Fresh project

Run [schema.sql](schema.sql), then [prototype22.sql](prototype22.sql), in that
order. The fresh-project definitions already include the current table columns,
indexes, policies, and bounded history functions. Do not run the numbered
migrations afterward on a fresh project unless the ledger is intentionally
being reconstructed in a separate migration tool.

## Existing project

Apply each file exactly once, in numerical order. Confirm the prior step before
continuing:

| File | Purpose | Verification gate |
| --- | --- | --- |
| `001_readings_bucketed.sql` | Initial fleet history RPC | `readings_bucketed` exists |
| `002_bucketed_by_tier.sql` | Tier-aware fleet history RPC and index | Five-argument RPC exists and filters `sensor_tier` |
| `003_authenticated_ingest.sql` | Remove anonymous device writes | `anon`/`authenticated` cannot insert |
| `004_replay_safe_observations.sql` | Add device/observation identity and dedupe indexes | Both unique indexes exist |
| `005_clock_provenance.sql` | Add `clock_valid` provenance column | New rows can retain clock state |
| `006_bound_history_rpc.sql` | Bound fleet and Prototype 22 history RPCs | Invalid widths/ranges are rejected |
| `007_latest_received_index.sql` | Index server receipt time for liveness | Latest queries use receipt-time indexes |
| `008_firmware_version.sql` | Record the producing firmware build | Both tables expose nullable `firmware_version` |
| `009_payload_version.sql` | Record the telemetry payload contract | Both tables expose `payload_version=1` |
| `010_latest_readings_rpc.sql` | Batch fleet latest-reading lookup | `readings_latest(text)` returns at most one row per freezer |

The application/API deployment should follow migration 009. Deploying code
that writes `payload_version` before applying 009 will make authenticated
ingest fail on a project that still has the old table shape.

## Application record

For each production application, copy this row into the private operations
record and fill it in; do not put service credentials or device secrets here.

| Field | Value |
| --- | --- |
| Project / host |  |
| Migration file |  |
| Applied at UTC |  |
| Operator |  |
| Verification report |  |
| Rollback/forward plan |  |

After the full sequence, run the read-only [verification script](verify.ps1)
and preserve its JSON report with the application record. That report proves
the public read/RPC contract, not grants, backups, migration history, or live
device delivery; those require the separate operations checks.

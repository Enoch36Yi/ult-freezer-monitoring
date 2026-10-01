# Data operations runbook

This repository contains the schema and read-only verification tools, but it
does not have authority to change a live Supabase project. An operator must
complete and record the steps below before treating the study data as
protected.

## Data classes

| Data | Location | Default handling |
| --- | --- | --- |
| Fleet raw observations | `public.readings` | Preserve; append-only from devices |
| Prototype observations | `public.prototype_readings` | Preserve separately from the study |
| Aggregated history | RPC result | Recomputable from raw rows; not a backup |
| Raw export | Private operator archive | Immutable snapshot with manifest/checksum |
| Device registry | Private operator record | Keep secrets outside Git and chat |

The repository currently has **no automatic retention deletion**. Do not add a
scheduled delete or partition drop until the study owner approves a retention
period, archive location, legal/IRB requirements, and a tested restore path.

## Before production data collection

The operator records these values in the private operations log:

- Supabase project and region;
- migration files applied, in order through `010_latest_readings_rpc.sql`;
- managed backup/PITR retention and restore owner;
- raw-data retention period and archive location;
- alert recipients and escalation window;
- date of the last restore rehearsal.

Run the read-only check from a clean checkout and preserve its JSON report:

```powershell
powershell -ExecutionPolicy Bypass -File supabase/verify.ps1 \
  -ReportPath .\private-verification-YYYYMMDD.json
```

Reports containing internal identifiers stay outside Git. The verifier proves
public read/RPC behavior only; it does not prove backups, grants, migrations,
or physical sensor provenance.

## Backup and restore rehearsal

1. Enable the managed Supabase backup/PITR feature appropriate for the project.
2. Run [RAW_EXPORT_RUNBOOK.md](RAW_EXPORT_RUNBOOK.md) for a bounded raw snapshot.
3. Record row counts, UTC bounds, the export manifest checksum, and the backup
   timestamp in the private operations log.
4. Restore into an isolated project or disposable database. Never experiment on
   the production tables.
5. Apply the same schema/migration sequence and run the read-only verifier.
6. Compare table counts, earliest/latest timestamps, and representative rows.
   Compare the raw export checksum only when the same snapshot boundary was
   used; a live database will continue receiving rows.
7. Record the restore duration, missing permissions/RPCs, and the named owner
   who would perform an incident restore.

A raw export is a reproducible snapshot, not a backup. A dashboard latest-row
query is neither.

## Retention and growth review

Review monthly while the study is active:

- raw row counts and storage size for both tables;
- index size and query latency for `recorded_at` and `received_at` indexes;
- export completion and checksum records;
- backup/PITR health and restore age;
- whether partitioning or archive storage is now justified.

If retention is approved, implement it as a reviewed migration with a dry-run
count, an export/checksum gate, and a documented rollback/restore procedure.
Do not delete rows from the public SQL editor as an informal cleanup step.

## Ingest and alerting handoff

The authenticated route has a 32 KiB body limit, 50-row batch limit, HMAC
authentication, request IDs, upstream timeout, duplicate counts, and payload
versioning. The deployment owner must still configure a provider-level rate
limit/WAF rule because a leaked valid device secret could otherwise submit
many authenticated requests.

At minimum, monitor and retain alerts for:

- ingest HTTP 401/403, 4xx, 429, 5xx, and 504 rates;
- absence of recent `received_at` rows by freezer and tier;
- firmware versions outside the approved release manifest;
- repeated queue backoff/permanent-rejection messages from serial captures;
- backup/PITR failures and overdue restore rehearsals.

The dashboard is an inspection surface, not an alarm service. A production
notification path and its owner must be chosen separately.

## Device-secret rotation

The current fleet provisioning stores each ingest secret in device NVS; OTA
does not rotate it. To rotate one:

1. Create a new random secret in the approved password manager.
2. Add it to the server map under the exact device ID without committing it.
3. Re-provision the physical node through the documented authorized procedure.
4. Confirm a real authenticated reading with the new secret.
5. Remove the old server-map entry and record the UTC change in the private
   registry.

If a secret may have leaked, stop relying on the old node until rotation is
complete. Never place either secret in this repository, a release manifest,
serial capture, issue, or chat message.

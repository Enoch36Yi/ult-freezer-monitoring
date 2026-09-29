# Supabase operations and verification

## Scope and study rules

Project: `dfxxamgnrimwoumknuxa`.

The study plans 21 ESP32 systems. Freezers 1–6 sample every 60 seconds; 7–21
sample every 900 seconds. Two iMonnit sensors are available. TRAXX/KLATU equipment
has not yet been purchased. Dashboard tier names are not evidence of installed
instruments or active vendor ingestion.

Preserve raw measurements and distinguish bench tests from study observations.
Never insert fabricated temperatures into the research table to make a dashboard
appear live. Do not delete or reclassify existing rows without provenance evidence.

## Automated read-only verification

From the project root, run:

```powershell
./supabase/verify.ps1
```

To retain an audit, supply a new filename:

```powershell
./supabase/verify.ps1 -ReportPath './supabase/verification-run-02.json'
```

The script reads the local dashboard API configuration without printing the key,
checks that the dashboard uses the expected project, validates required reading
columns, checks the latest ESP32 observation for every freezer, and calls the
tier-specific history function separately for ESP32, iMonnit, and TRAXX. It
performs only GET requests. It refuses to overwrite an existing report.
Exit code 1 means an API/configuration contract failed. Fleet status is reported
separately: successful API checks do not mean hardware commissioning has passed.
The snapshot timestamp and limitations are included in the JSON output.

This is an on-demand verification script, not a scheduled monitor or backup.
The retained snapshot contains latest records, not a complete raw-data export.

## Audit on 2026-09-22

Evidence: `verification-2026-09-22.json` (UTC timestamp inside the file).

| Check | Observed result |
| --- | --- |
| Firmware and dashboard project | Same project |
| Public readings API and required columns | Readable; three rows visible to this role |
| Freezer 1 | Latest recorded timestamp 2026-09-15; no current readings |
| Freezers 2–21 | No ESP32 rows visible to the public API role |
| Tier-specific history RPC | Fails for all three tiers with PGRST202 |
| Supabase plugin | Installed and enabled, but SQL/project tools absent from this task's available tools |
| Sensor | Latest serial observation in this task: DS18B20 not detected; firmware skips posting |

The server's error suggests the old four-argument `readings_bucketed` function
exists. The dashboard requires a fifth `p_sensor_tier` argument. The repository
already contains `migrations/002_bucketed_by_tier.sql` for this change; its existence
on disk does not establish that it has been applied. No database changes were made
during this audit. Database policy definitions and write access remain unverified.

## Production change and verification on 2026-09-22

The user authorized continuation of Supabase setup. The project dashboard for
`dfxxamgnrimwoumknuxa` was accessible in Edge. Its SQL editor confirmed the
deployed four-argument function, three existing rows, the expected eight reading
columns, enabled row-level security, anon INSERT and SELECT policies, and no
freezer/tier/time index. The dashboard showed no migration history or backups.

The local `002_bucketed_by_tier.sql` was hardened with an explicit `public`
schema, invoker execution, an empty search path, qualified table reference, and
explicit function execute grants. The same SQL was executed as a single
transaction through the production SQL editor. A first editor attempt failed
with syntax error 42601 because the editor appended text to an existing query;
that attempt made no schema changes. The clean query succeeded. The failed
read-only verification snapshot is retained as
`verification-2026-09-22-post-migration.json`.

The subsequent read-only check is
`verification-2026-09-22-after-fix.json`: firmware and dashboard project agree;
the readings API passes; history RPC calls for ESP32, iMonnit, and TRAXX all
pass. ESP32 returned one historical bucket; the vendor tiers returned zero, as
expected before import. A production SQL query also confirmed row count 3,
anon INSERT and SELECT grants, the five-argument function, and the new index.
No synthetic temperature rows were inserted. Direct SQL editor execution does
not create a Supabase migration-history entry; the local SQL file records the
change, but migration tracking and backups still need to be established.

Device 1 rejoined its stored hotspot at `172.20.10.4` with RSSI -50 dBm and
synced NTP. Its live serial log still reported `no DS18B20 on the bus`. The
user clarified that the small DS18B20 is intentionally unsoldered because a
larger probe is expected soon. The larger probe's manufacturer, model, sensor
element, interface, rated range, and calibration status are not yet documented.
A valid sensor measurement, HTTP POST response, matching database row, and
one-minute cadence have not yet been observed. Do not describe this node as
transmitting temperature data. Before wiring or flashing for the incoming
probe, verify its datasheet and update firmware, wiring, `sensor_tier`, and
methodology if its element is not a DS18B20.

## Remaining work

1. Finish the database metadata audit: inspect constraints, complete role grants,
   database version, function dependencies, and security/performance advisors.
   Reconcile the direct SQL change with a migration tracking workflow.
2. Preserve the verified five-argument function and tier/time index. Recheck
   their definition and execution permissions after any future schema change.
3. Verify allowed and denied writes in a rolled-back transaction or isolated test
   area. Never use made-up study rows as production connectivity tests. Public
   read access does not prove insert permissions or device delivery.
4. Define instrument identity, commissioning state, actual sensor coverage, bench
   versus study status, calibration reference, and placement history. Separate
   device-health messages from valid temperature observations so a missing probe
   can be reported without inventing a temperature.
5. The device now sends a boot/sample observation ID, a clock-valid flag, and a
   real measurement timestamp; the database deduplicates retries and refuses
   timestamp-less ingestion. Still retain source/vendor identifiers and import
   batches
   for commercial sensor data; do not assume vendor imports are already implemented.
7. Verify available backup/restore capabilities and implement a documented raw-data
   export procedure with row counts, UTC boundaries, checksums, and restore tests.
   Do not claim that a latest-reading snapshot is a backup.
8. After the physical probe is detected, match a real serial reading to its database
   record, verify at least two consecutive one-minute intervals for Freezer 1,
   and confirm the dashboard displays the same values and timestamps.

Each completed step should record UTC time, project ID, exact changes or query
artifact, relevant versions, observed result, and unresolved limitations. Preserve
superseded audit reports. Paper drafting is outside this workflow; reproducible
methodology and raw evidence are the priority.

## Connection note

The plugin directory reports Supabase installed and enabled, but this task's tool
inventory still contains no Supabase SQL/project management operations. The
authenticated Supabase dashboard in Edge provided administrative access for the
change above. The public API key used by firmware is sufficient for the permitted
readings INSERT and SELECT operations, but not for schema administration. No
database password or service-role key was used or recorded in this workflow.

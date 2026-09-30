# Raw readings export

This procedure creates a read-only JSONL snapshot and a manifest. It is useful
for audit handoff, migration checks, and reproducible analysis. It is **not a
database backup**: it depends on the public API, RLS, API row limits, and the
selected time window. Use the platform's managed backup/restore facility for
disaster recovery.

## Export

Run from the repository root with Node.js installed. The script reads
`web/.env.local` if the two public settings are not already in the environment.
It never needs the service-role key.

```bash
node scripts/export-readings.mjs \
  --table readings \
  --start 2026-09-01T00:00:00Z \
  --end 2026-10-01T00:00:00Z \
  --output private-export/readings-2026-09.jsonl
```

For the bench table:

```bash
node scripts/export-readings.mjs \
  --table prototype_readings \
  --output private-export/prototype-22-all.jsonl
```

The command also writes a sibling `.manifest.json`. It refuses to overwrite
either file. Keep the JSONL and manifest together in a private archive; the
manifest SHA-256 covers the exact JSONL bytes.

## Verify an archive

Recompute the file hash with the platform tool and compare it with the manifest:

```bash
sha256sum private-export/readings-2026-09.jsonl
```

PowerShell:

```powershell
Get-FileHash .\private-export\readings-2026-09.jsonl -Algorithm SHA256
```

Also compare the manifest row count and UTC bounds with the analysis import.
An empty export can be correct, but it is not evidence that a sensor is
working. Preserve the export command, manifest, source project host, and
verification timestamp in the private operations record.

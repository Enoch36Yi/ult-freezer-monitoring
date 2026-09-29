# Offline fleet completeness audit

`scripts/audit-readings.mjs` calculates raw count completeness for the 21
in-house ESP32 channels on one UTC day. Freezers 1–6 use a one-minute grid;
freezers 7–21 use a fifteen-minute grid. The expected total is 10,080 readings
per complete day. Prototype 22 and commercial sensor tiers are excluded.

Input is a **complete, paginated export** of `public.readings` as a JSON array,
with `freezer_id`, `sensor_tier`, `recorded_at`, and `received_at` on each row.
Keep exports private and immutable. A partial export will look like missing
measurements, so record the export query, UTC coverage, page count, and row
count alongside the file.

```powershell
node scripts/audit-readings.mjs --input C:\private\readings-export.json --date 2026-09-25 --report C:\private\audit-2026-09-25.json
```

The report includes an SHA-256 of the input file, expected and observed unique
grid slots, duplicate rows, missing slots, invalid timestamps and IDs, and
maximum nonnegative upload delay. It never inserts, updates, or deletes rows.
It does not apply research exclusions or establish accuracy, placement, pilot
acceptance, or baseline eligibility. Those require the registry, quality flags,
calibration record, and human review in the methodology.

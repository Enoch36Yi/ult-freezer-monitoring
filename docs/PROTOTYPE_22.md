# Prototype 22: implementation and measurement record

## Boundary

Prototype 22 is a bench instrument, **not Freezer 22** and not a member of the
21-freezer study cohort. It uses the shared ESP32-S3 firmware and one two-wire
PT1000 through an Adafruit MAX31865 #3648 on software SPI GPIO4/5/6/7,
powered by USB. Its readings belong only in `public.prototype_readings`; never
backfill them into `public.readings` or include them in fleet counts, freezer
comparisons, or TRAXX/iMonnit tier comparisons. The fleet remains 21 nodes:
IDs 1–6 at 1 minute and IDs 7–21 at 15 minutes.

## Software and deployment

1. Build the prototype with `python -m platformio run -e prototype-22` from a
   staged firmware copy outside OneDrive. The fleet image uses `-e esp32-s3`.
   The prototype build fixes identity 22 at compile time, sends an HMAC-signed
   payload to `/api/ingest`, and buffers in separate LittleFS paths. It does
   not read or overwrite the Freezer 1 NVS identity or its saved Wi-Fi network.
2. `firmware/include/prototype22_wifi.h` is the local, Git-ignored source for
   the approved hard-coded network. It is compiled into the prototype image,
   **not** the fleet image. Protect the source, build output, and physical
   device accordingly; rotate the Wi-Fi password if the binary is shared.
   The example header shows the required names without credentials.
3. `supabase/prototype22.sql` defines a separate append-only table,
   PT1000/MAX31865 ID22 constraints while preserving historical DS18B20 rows,
   read-only public access, and a tier-filtered
   history RPC. The authenticated ingestion route performs device writes;
   migration 003 removes the historical anon INSERT grant. It does not change
   or erase `public.readings`. Do not insert synthetic readings in production
   as a connectivity test.
4. Run the dashboard from `web/`. Its bottom card reads the prototype table
   independently; `/prototype/22` provides raw and bucketed temperature
   history. Both show **no readings yet** until a real probe reading arrives.
   The 21-freezer summary remains exactly 21.

## Bench verification before calling the instrument live

Day-of sequence: [BENCH_DAY_RUNBOOK.md](BENCH_DAY_RUNBOOK.md).

Use the per-assembly [acceptance record](PROTOTYPE_22_ACCEPTANCE.md) for the
new PT1000-probe build. Verify the probe's own lead identity and rated range;
do not infer lead polarity or bridge wiring from color alone.

Record date/time, operator, board serial/MAC, probe serial (if available),
firmware build timestamp/hash, SQL application time, and physical wiring
photographs. With USB power removed, verify continuity for 3V3/GND and each
software-SPI line to the MAX31865. Verify PT1000 Lead A/B, the RTD+/RTD- pair,
both F+ / F- bridges, and no short between supply rails. Confirm the #3648
reference resistor is the installed 4.3 kΩ part; do not replace it.
Do not infer correct connections from the component-side photo alone.

After the probe is installed, reconnect the board and identify its serial
port. Flash **only** `-e prototype-22`; do not erase NVS or LittleFS. Watch
serial output for MAX31865 readiness, raw/fault diagnostics, Wi-Fi connection,
NTP synchronization, temperature measurement, and an HTTP success. Check that
the resulting `prototype_readings` row has `prototype_id=22`,
`sensor_tier=esp32_pt1000_max31865`, a plausible *measured* temperature,
correct UTC `recorded_at`, and
`received_at`. Then check that the bottom card and `/prototype/22` agree.
Confirm `public.readings` still contains only IDs 1–21 and no new Freezer 1
row from this board. Record any Wi-Fi outage and queue replay separately;
`received_at - recorded_at` measures transport delay, not freezer temperature.

For the paper, retain calibration/reference thermometer information, probe
placement and thermal coupling, ambient conditions, timebase checks, excluded
or failed readings (including disconnected-probe errors), software versions,
power/network interruptions, and every manual intervention. A connected
board without a soldered probe cannot establish a temperature signal.

## Verification history (2026-09-23 onward)

> **Historical audit trail, not current instructions.** Entries such as "not
> yet flashed" were true when written. Current state: see `updates.md`; next
> steps: [BENCH_DAY_RUNBOOK.md](BENCH_DAY_RUNBOOK.md) and [TODO.md](../TODO.md).

- Fleet and prototype firmware images compile.
- Dashboard tests, TypeScript checks, and production build pass.
- The prototype Wi-Fi credential is present in the prototype image and absent
  from the fleet image (checked without exposing its value).
- At 2026-09-23 23:14 UTC, `supabase/prototype22.sql` was applied to the live
  project. The table exists and is empty; RLS is enabled. `anon` has SELECT,
  INSERT, and history-function EXECUTE, but not UPDATE or DELETE. Public GET
  and empty-window bucketed RPC both succeeded. Security Advisor reported no
  findings. The pre-existing fleet row count stayed at three. Performance
  Advisor flagged both the new and existing history indexes as unused because
  there has not yet been a meaningful query workload; do not remove them on
  this evidence.
- Deployment was via direct authenticated SQL execution, not a Supabase CLI
  migration-history entry. The applied SQL file SHA-256 is
  `C2930B02BC463496D9D0BBBA112E9FFDC7D4853709D9ECC86E155C739C1F41CF`.
  The locally built, **not yet flashed** prototype image SHA-256 is
  `F181C6C8A2D8389FDC1BD875FDF1D114206ED6D64C7BA52F4EC9698109C2651B`.
- At 2026-09-23 23:32 UTC, the dashboard was deployed to the **existing**
  Vercel project `rhinoch-group/ult-freezres` as deployment
  `dpl_7CpsL2ViY1v8pfCEctbW1DMGHnjo` and promoted to
  https://ult-freezres.vercel.app. Public HTTP checks returned 200 for the
  homepage, `/prototype/22`, and `/freezer/1`; the first two contain the
  Prototype 22 label. This does not verify ingestion or chart behavior with
  measured data.
- The board was absent during an earlier check, then appeared as Espressif
  COM5. After fresh user authorization on 2026-09-23, `prototype-22` was
  rebuilt and uploaded to COM5; esptool verified the writes and PlatformIO
  reported success. Serial confirmed Prototype 22 at 60-second cadence,
  LittleFS mounted, Wi-Fi connected, and NTP synchronized. It also reported
  **no DS18B20 on the bus**. The probe was previously reported unsoldered;
  present wiring has not been physically verified. At 23:38 UTC, the public
  REST query returned HTTP 200 and an empty `[]` result for
  `prototype_readings`. Thus flashing is verified, but temperature sensing,
  database ingest, and live dashboard values are **not**.
- With an absent queue file, the firmware repeatedly logs a LittleFS open
  error while checking whether `/prototype22-queue.jsonl` exists. This is a
  known logging defect, not evidence of queued measurements. Fix and verify
  it before claiming an operationally clean device.
- On 2026-09-24 at 00:10–00:11 UTC, after the user reported replacing and
  soldering the probe, a fresh board startup still reported no DS18B20 on
  the bus twice. Wi-Fi and NTP succeeded; a fresh prototype-table REST query
  returned HTTP 200 with `[]`. Physical wiring needs inspection before a
  temperature signal or publication can be claimed.
- A 00:21 UTC photo review incorrectly suggested the white lead was on
  GPIO6. A clearer follow-up photo shows it on the ESP32 pad labeled
  **GPIO4**, matching the firmware. The earlier move-the-wire advice was
  retracted; no repair or temperature reading was verified from these
  photos. Retain both images and the correction in the measurement record.
- At 00:34–00:35 UTC after the user cleaned and replugged the board, fresh
  serial startup still twice reported no DS18B20; Wi-Fi and NTP worked.
  A public prototype-table REST query again returned `[]`. This is an
  unsuccessful sensor-channel check, not a temperature observation.
- At 04:56–04:57 UTC, after the user reported repairing an open E25–F25
  jumper, another serial startup still twice reported no DS18B20 and the
  prototype REST query still returned `[]`. A post-repair electrical check
  is needed; the specific jumper repair has not been verified as restoring
  the full sensor circuit.
- At 06:26 UTC the user reported retiring the faulty board and building a
  replacement to take the **same logical Prototype 22 identity**. The retired
  MCU MAC was `28:84:85:66:61:64`; it carried the earlier flashed image but
  never produced a verified reading. A different Espressif USB device was
  observed on COM6 with serial/MAC `28:84:85:6B:2C:58`, consistent with the
  replacement. The new board has **not** been flashed, electrically checked,
  or shown to report; do not transfer the old board's verification status to
  it. Keep the retired board unpowered to avoid duplicate ID22 sources.
- At 06:31–06:32 UTC, following a new direct user flash instruction, the
  replacement MCU (`28:84:85:6B:2C:58`) received the `prototype-22` image
  on COM6. The build and upload passed with verified written hashes. Fresh
  serial confirmed 60-second Prototype 22 operation, Wi-Fi, and NTP, but
  twice reported **no DS18B20 on the bus**. The public prototype-table REST
  query returned `[]`. This verifies the new board's firmware and network,
  **not** its temperature channel or Supabase ingest. The new board's
  physical probe circuit must be checked independently of the old one.
- At 06:35 UTC, the user reported stable DQ, power, and ground paths by
  multimeter on the replacement. Exact voltage values/endpoints were not
  provided. Static inspection found the firmware still enumerates on GPIO4
  and retries after non-detection; it did not establish a software cause.
  Record a powered DQ-to-GND value or a 1-Wire waveform/presence diagnostic
  before assigning blame to hardware or firmware.

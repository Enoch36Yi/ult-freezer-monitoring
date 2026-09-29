# Bench-day runbook: Prototype 22 (software side)

*You pave the runway; I stick the landing.* The circuit is the user's; this
page gets everything else from "wiring passes the meter" to "a genuine row is
on the dashboard". Record the electrical work in
[PROTOTYPE_22_ACCEPTANCE.md](PROTOTYPE_22_ACCEPTANCE.md).

**Hard rules:** no flash without a fresh direct **"elephant"** in chat · no
fake readings · no builds or installs inside OneDrive · never paste the Wi-Fi
password anywhere.

Every command below was run on this laptop (Windows PowerShell 5.1, Store
Python, PlatformIO 6.2.0, no Node, no `pwsh`) on 2026-09-29 unless marked
*untested*. Run them from the project folder.

## At a glance

| When | Command | Touches |
| --- | --- | --- |
| Tonight | `powershell -ExecutionPolicy Bypass -File scripts\prepare-bench-day.ps1` | builds locally |
| Bench, any time | `powershell -ExecutionPolicy Bypass -File scripts\bench-preflight.ps1` | read-only |
| Board plugged in | MAC check (step 2) | read-only, resets board |
| After "elephant" | upload (step 3) | **flashes** |
| After flash | capture (step 4), then check (step 6) | read-only |

## 0. Tonight, at home

1. **Build for the bench network.** Run `prepare-bench-day.ps1`. It prompts for
   the network name and password (hidden). It stages source to
   `%USERPROFILE%\FreezersFirmwareBuilds\<new folder>` (outside OneDrive),
   builds `prototype-22` and `prototype-22-diag`, checks each image carries the
   Prototype 22 identity, and prints hashes. Nothing is uploaded.
   - The network must be **2.4 GHz** with a plain password. iPhone hotspot:
     turn on *Maximize Compatibility*. Android: set the hotspot band to 2.4 GHz.
     No campus sign-in, eduroam, or enterprise login.
   - Names/passwords containing `"` or `\` are refused (they would break the
     compiled header); pick a hotspot password without them.
2. **Run the preflight.** `bench-preflight.ps1` should show no FAIL, and the
   line *"Staged Wi-Fi header differs from the old one"*. If it says
   *identical*, the build still has the old network.
3. **Keep files offline-available.** In File Explorer, right-click the
   *Freezers Firmware* folder → *Always keep on this device*, in case the
   bench has patchy internet.
4. Pack: laptop + charger, a **USB-C data cable** (charge-only cables show no
   COM port), multimeter, the board and probe.
5. When practical, rotate the Wi-Fi password exposed on 2026-09-26.

## 1. Physical gate (yours)

Fill in the electrical table in the acceptance form: continuity with USB
unplugged, then powered 3V3 and idle DQ with the ESP32 GND pad as reference.
Leave failures visible. Continue only when satisfied.

## 2. Identify the board (read-only)

Plug in with the data cable, then run the preflight again (or the one-liner):

```powershell
Get-CimInstance Win32_PnPEntity | Where-Object { $_.DeviceID -match 'VID_303A&PID_1001' } | Select-Object Name
```

Read the MAC (this briefly resets the board into its bootloader and back, but
writes nothing):

```powershell
python "$env:USERPROFILE\.platformio\packages\tool-esptoolpy\esptool.py" --chip esp32s3 --port COMx read_mac
```

*Untested here (no board attached); esptool v4.11.0 is present.* Record the
MAC. `28:84:85:66:61:64` is the **retired** board: stop if you see it.
`28:84:85:6B:2C:58` is the previous replacement; anything else is a new MCU.

## 3. Flash (needs your direct "elephant")

Recommended first image: **`prototype-22-diag`**. Same identity and telemetry
as `prototype-22`, plus a `[1wire-diag]` block at boot and after every failed
probe scan, so if detection fails, the serial output says which side is wrong
without another flash. Once the probe is found, it stays quiet.

Claude runs, from the staged folder printed by the prepare script:

```powershell
python -m platformio run -e prototype-22-diag -t upload --upload-port COMx
```

No erase, no filesystem upload. Record the image hash. If the upload cannot
connect: hold **BOOT**, tap **RESET** (or replug while holding BOOT), release,
retry. After flashing, re-check the COM number; it can change.

## 4. Capture serial (read-only)

```powershell
New-Item -ItemType Directory -Force "$env:USERPROFILE\FreezersBench" | Out-Null
powershell -ExecutionPolicy Bypass -File scripts\capture-prototype-serial.ps1 -Port COMx -OutputPath "$env:USERPROFILE\FreezersBench\capture-1.log" -DurationSeconds 130
```

130 s covers two one-minute cycles. Use a new file name each run (it refuses
to overwrite). Logs stay outside OneDrive because they contain network details.
Opening the port can restart the board; note it.

## 5. Reading the serial output

| Line | Meaning | Next |
| --- | --- | --- |
| `[provision] prototype 22, connecting to compiled WiFi` then `[provision] ip ...` | joined the network | — |
| `[provision] no AP yet; will keep retrying` | wrong name/password, 5 GHz, or hotspot asleep | wake/fix the hotspot first; otherwise rebuild (step 0) and re-flash (new "elephant") |
| `[ntp] 2026-...Z` | clock valid | — |
| `[ntp] sync failed` | network has no internet | check hotspot data; rows would get server time |
| `[sensor] DS18B20 found on GPIO4` | probe enumerated | expect `[reading] {...}` |
| `[sensor] no DS18B20 ...` + `[1wire-diag] VERDICT: ...` | not detected | act on the verdict physically; no re-flash needed |
| `[reading] {"prototype_id":22,...}` then `[reading] posted` | measured and stored | step 6 |
| `[reading] {...}` then `[queue] buffered ...` | measured, not sent | not database proof; it flushes when the network returns |
| `[http] POST failed, status 400/401/403/404` | server refused | 400 payload/constraint, 401/403 key or RLS, 404 table path |
| `[http] POST failed, status -1` (or other negative) | no connection / TLS | network |
| `[sensor] bad reading (-127.00 C)` | probe dropped mid-read | intermittent wiring |
| a flood of LittleFS errors naming `/prototype22-queue.jsonl` | the old log-flood bug | should **not** appear with this build (fixed 2026-09-25); if it does, note it |
| `[queue] recovered queue from temp file ...` | new power-loss recovery ran | normal after a mid-flush power cut |

A room-temperature reading around 18–30 °C is plausible. Exactly `85.000` is the
DS18B20 power-on default: record it, but it is not a measurement.

## 6. Verify end to end (read-only)

```powershell
powershell -ExecutionPolicy Bypass -File scripts\prototype-check.ps1 -SerialLog "$env:USERPROFILE\FreezersBench\capture-1.log" -ReportPath "$env:USERPROFILE\FreezersBench\check-1.json"
powershell -ExecutionPolicy Bypass -File supabase\verify.ps1
```

`prototype-check.ps1` is the no-Node equivalent of `prototype-check.mjs`.
`observation.state` meanings:

- `matched` means the posted serial reading is stored in `prototype_readings`
  (same `recorded_at` and temperature). This is the goal.
- `posted_not_found_in_rows` means the device reported posting, but no matching
  row exists. Tell Claude.
- `no_posted_serial_reading` means nothing was posted in the capture (the probe
  is missing, or the reading was buffered).

Then open <https://ult-freezres.vercel.app> (bottom card) and
<https://ult-freezres.vercel.app/prototype/22> and check that the value and time
match the row. `verify.ps1` should still list freezer 1 as `offline` (old test
rows) and 2–21 as `no_data`, meaning the prototype did not touch the fleet table.

**Acceptance:** ROM found on at least two consecutive cycles, two plausible
readings about a minute apart, `matched`, and the browser agrees.

## 7. Record

Ask Claude to append to `updates.md`: MAC, COM port, image and hash, network
*type* (not its name), probe ROM, capture/report paths, row IDs, browser check,
and any deviations. Then tick the acceptance form and `TODO.md`.

## Out of scope for this page

- **Probe range.** The DS18B20 is rated only to −55 °C. Passing this bench
  test qualifies the chain (sensor to Wi-Fi to database to dashboard), not the
  probe at −70 to −80 °C. See `TODO.md` item S1.
- **The two Supermini hardware quirks** are noted in `firmware/HOW-TO-FLASH.md`
  (charge-only cables, BOOT button).

# Prototype 22 replacement assembly: acceptance record

Use one copy of this form per physical assembly. The logical identity remains
Prototype 22; this bench instrument is excluded from the 21-freezer study.
Keep raw photos and serial logs with the record. Leave failed checks visible.

## Identification

Items marked *(prefilled)* come from earlier records or user reports; confirm
them on the day, and correct them if they are wrong.

- Assembly label and date/time (UTC):
- Operator:
- ESP32 board model and MAC: ESP32-S3 Supermini *(prefilled)*; MAC from `esptool read_mac`:
  (must not be retired `28:84:85:66:61:64`)
- Waterproof probe manufacturer, model, lot/serial, and sensor ROM: HiLetgo
  1 m waterproof DS18B20, Amazon B00M1PM55K, 5-pack *(prefilled, user report)*;
  ROM from serial `[1wire-diag] ROM 28-...` or a found-probe run:
- Probe datasheet and confirmed wire-to-pin mapping (do not rely on color):
  listing says red VCC / yellow DATA / black GND *(unconfirmed; meter it)*
- Probe rated temperature range and calibration/reference evidence: DS18B20
  chip −55 to +125 °C *(datasheet)*; reference check:
- Installed pull-up value (listing suggests 4.7 kΩ, bench plan 6.8 kΩ):
- Firmware environment, build time, SHA-256, and upload time:
- Test network type (2.4 GHz personal/hotspot, or other) and local-only SSID record:

## Physical and electrical checks

Record meter endpoints and values, not only pass/fail. Unplug USB for resistance
and continuity checks. Use the ESP32 GND pad as the common reference for powered
voltage checks.

| Check | Measured value / evidence | Pass / fail / pending |
| --- | --- | --- |
| Component and solder-side photos | | |
| GPIO4 pad to probe DQ conductor/terminal continuity | | |
| ESP32 3V3 pad to probe VDD conductor/terminal continuity | | |
| ESP32 GND pad to probe GND conductor/terminal continuity | | |
| Pull-up from GPIO4/DQ to 3V3 (nominal 6.8 kΩ) | | |
| No unintended 3V3–GND short | | |
| Powered 3V3 at ESP32 and probe | | |
| Powered idle DQ at GPIO4 and probe | | |

## Live acceptance

| Check | UTC time / evidence | Pass / fail / pending |
| --- | --- | --- |
| Observed ESP32 COM port and board identity | | |
| Repeatable DS18B20 ROM detection over at least two sample cycles | | |
| Two plausible measured temperatures, one minute apart | | |
| Wi-Fi, NTP, and HTTP post result in serial log | | |
| Matching genuine `prototype_readings` row (ID, time, temperature) | | |
| Public Prototype 22 card and detail page checked in browser | | |
| Any reset, outage, buffered reading, or rework recorded | | |

Acceptance decision, date, and reviewer:

Notes and deviations:

## Local automation

The full day sequence, with tested commands, is
[BENCH_DAY_RUNBOOK.md](BENCH_DAY_RUNBOOK.md). In short:
`scripts/prepare-bench-day.ps1` stages source to
`%USERPROFILE%\FreezersFirmwareBuilds` (outside OneDrive), writes the bench
network into that copy only, and builds both prototype images without
uploading. `scripts/bench-preflight.ps1` confirms readiness read-only.

The project folder is OneDrive-synced. Do not run `npm ci`,
`scripts/check-local.ps1`, or a PlatformIO build inside that folder. The staged
folder and its images contain the Wi-Fi credential.

The Prototype 22 firmware uses a compiled SSID/password (not the WiFiManager
portal), so an image built for one network cannot join another. Do not put
credentials in chat, logs, screenshots, or this record. Campus sign-in,
enterprise, and 5 GHz-only networks will not work. A successful build is not a
flash, a sensor measurement, or evidence of upload.

The user identified the exact purchased item as
`https://www.amazon.com/dp/B00M1PM55K` and reports actual red, yellow, and
black leads. That listing says red = VCC, yellow = DATA, black = GND. HiLetgo's
separate product page lists conflicting color sets, so inspect the received
probe/packaging and meter the completed connections before applying power. Do
not infer waterproof-probe wiring from a generic DS18B20 TO-92 pin diagram.
The Amazon listing suggests a 4.7 kΩ DATA-to-VCC pull-up; the current bench
plan specifies 6.8 kΩ. Record the installed value and require repeatable ROM
detection rather than assuming either value guarantees bus operation.
The DS18B20 chip is rated only to -55 °C; a room-temperature transport test
does not qualify this probe for a -70 to -80 °C freezer.

On the computer connected to the new assembly, identify its Espressif COM
port, then capture at least two one-minute cycles:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\capture-prototype-serial.ps1 -Port COMx -OutputPath "$env:USERPROFILE\FreezersBench\capture-1.log" -DurationSeconds 130
powershell -ExecutionPolicy Bypass -File scripts\prototype-check.ps1 -SerialLog "$env:USERPROFILE\FreezersBench\capture-1.log" -ReportPath "$env:USERPROFILE\FreezersBench\check-1.json"
powershell -ExecutionPolicy Bypass -File supabase\verify.ps1
```

(`pwsh` is not installed on the laptop; use `powershell`. With Node.js
installed, `node scripts/prototype-check.mjs --serial-log ... --report ...` is
equivalent to `prototype-check.ps1`.)

Replace the example port and paths with observed values. The checker reads the
Prototype 22 API and verifies that the public routes respond; its serial match
uses the posted reading's timestamp and temperature. A dashboard temperature
comparison still needs a browser because the card loads data in the browser.
Opening the USB serial port can restart the board; record any restart seen in
the capture.
Do not upload firmware or create a synthetic database reading as a test. Keep
captures and reports private; serial logs may include network details.

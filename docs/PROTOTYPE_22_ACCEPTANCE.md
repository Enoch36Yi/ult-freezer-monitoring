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
- PT1000 probe manufacturer, model, lot/serial, and lead identity:
- Probe datasheet and confirmed Lead A/B mapping (do not rely on color):
- Probe rated temperature range and calibration/reference evidence:
- MAX31865 board: Adafruit #3648; installed reference resistor: 4.3 kΩ
- Firmware environment, build time, SHA-256, and upload time:
- Test network type (2.4 GHz personal/hotspot, or other) and local-only SSID record:

## Physical and electrical checks

Record meter endpoints and values, not only pass/fail. Unplug USB for resistance
and continuity checks. Use the ESP32 GND pad as the common reference for powered
voltage checks.

| Check | Measured value / evidence | Pass / fail / pending |
| --- | --- | --- |
| Component and solder-side photos | | |
| GPIO4 / CS continuity to MAX31865 | | |
| GPIO5 / MOSI continuity to MAX31865 SDI | | |
| GPIO6 / MISO continuity to MAX31865 SDO | | |
| GPIO7 / SCK continuity to MAX31865 CLK | | |
| ESP32 3V3/GND to MAX31865 VIN/GND | | |
| PT1000 Lead A/B to RTD+/RTD-, F+ bridge, F- bridge | | |
| No unintended 3V3–GND or RTD wiring short | | |
| Powered 3V3 at ESP32 and MAX31865 VIN/GND | | |
| Powered SPI lines idle without unintended short | | |

## Live acceptance

| Check | UTC time / evidence | Pass / fail / pending |
| --- | --- | --- |
| Observed ESP32 COM port and board identity | | |
| MAX31865 SPI readiness and valid raw acquisition over at least two cycles | | |
| Two plausible measured PT1000 temperatures, one minute apart | | |
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
network into that copy only, and builds the shared `prototype-22` image without
uploading. `scripts/bench-preflight.ps1` confirms readiness read-only.

The project folder is OneDrive-synced. Do not run `npm ci`,
`scripts/check-local.ps1`, or a PlatformIO build inside that folder. The staged
folder and its images contain the Wi-Fi credential.

The Prototype 22 firmware uses a compiled SSID/password (not the WiFiManager
portal), so an image built for one network cannot join another. Do not put
credentials in chat, logs, screenshots, or this record. Campus sign-in,
enterprise, and 5 GHz-only networks will not work. A successful build is not a
flash, a sensor measurement, or evidence of upload.

The replacement hardware contract is the Adafruit MAX31865 #3648 with its
installed 4.3 kΩ reference resistor and a two-wire PT1000. Confirm the actual
probe datasheet, lead mapping, rated range, and reference thermometer before
applying power. The ESP32 software-SPI pins are CS/MOSI/MISO/SCK = GPIO4/5/6/7.
A room-temperature transport test does not qualify a probe for a -70 to -80 °C
freezer; cold-range calibration remains a separate acceptance gate.

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

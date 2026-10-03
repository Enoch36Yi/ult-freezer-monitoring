# How to flash a ULT freezer node

Same image on all 21. The freezer number is typed into the setup portal once and
stored in NVS — no per-device build.

---

# Part A — once, before any node

**A1. Confirm the WiFi will work**
- Must be **2.4 GHz** — the ESP32-S3 has no 5 GHz radio
- Must be **plain SSID + passphrase** — no WPA2-Enterprise / 802.1X / eduroam
- If the lab only has enterprise auth, stop here and sort out an IoT VLAN or a
  dedicated AP first

> **This project folder is OneDrive-synced: do not build inside it.** A
> PlatformIO/npm run here creates thousands of sync items (a 2026-09-26 run
> triggered a 21,582-item OneDrive delete prompt). Stage the source to a local
> folder first. For Prototype 22 use `scripts/prepare-bench-day.ps1`; for fleet
> images, stage with `scripts/stage-prototype-firmware.ps1` and run the same
> commands from the printed folder. The `cd firmware` lines below assume you
> are in such a copy.

**A2. Install the toolchain**
```bash
pip install platformio
cd firmware
pio run
```
First run downloads the ESP32-S3 toolchain (~5-10 min). Done once, not per node.

**A2b. Configure device security** — copy
`firmware/include/device_security.example.h` to the ignored
`firmware/include/device_security.h`. Replace the provisioning AP password and
OTA hash. For fleet nodes, use a different 32+ character ingest secret per
freezer and register the same device-to-secret mapping in
`INGEST_DEVICE_SECRETS_JSON` on the server. Prototype 22 uses its compiled
`DEVICE_INGEST_SECRET` from this header.

**A3. Database** — already done. Table and function are live.

**A4. Put the dashboard somewhere you can reach it**
```bash
cd web
npm install
npx vercel --prod
```
Set the two `NEXT_PUBLIC_*` dashboard variables in the Vercel project settings,
plus server-only `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, and
`INGEST_DEVICE_SECRETS_JSON` for the authenticated ingestion route. Never mark
the service key or device-secret map as `NEXT_PUBLIC_*`. Or just `npm run dev`
and use `localhost:3000` while you work with the same local settings.

---

# Part B — per node, repeat 21 times

Do them **one at a time**. Several unprovisioned nodes at once means several
near-identical AP names and no way to tell them apart.

**B1. Wire the node**
- MAX31865 #3648 VIN → ESP32-S3 **3V3**; GND → **GND**
- MAX31865 CS / SDI(MOSI) / SDO(MISO) / CLK(SCK) → **GPIO4 / GPIO5 / GPIO6 / GPIO7**
- Two-wire PT1000 Lead A → RTD+, Lead B → RTD-
- Bridge F+ to RTD+ and F- to RTD-
- Leave RDY and 3Vo unused
- Remove the old DS18B20 and its 6.8 kΩ pull-up; keep the MAX31865 #3648's built-in **4.3 kΩ** reference resistor

Full diagram: [root README](../README.md), section 1.

**B2. Flash it**
```bash
cd firmware
pio run -t upload
pio device monitor
```

**B3. Check the sensor path**

Serial should say `[sensor] MAX31865 ready: PT1000 2-wire, software SPI CS=4 MOSI=5 MISO=6 SCK=7`.
The first valid `[reading]` proves raw acquisition, fault status, conversion,
clock, and the remaining network path. A fault or invalid raw response is
logged and skipped; it never becomes a telemetry value.

**B4. Note the AP name**

Serial prints `[provision] portal AP: ULT-Freezer-Setup-XXXX`. That suffix is
how you identify this specific node.

**B5. Join that password-protected AP on a phone**

Use the provisioning AP password from `device_security.h`. The portal opens by itself — if not, go to
`http://192.168.4.1`.

**B6. Fill in the portal**

**Configure WiFi** → SSID, password, **Freezer number (1-21)**, unique device
ingest secret → **Save**

**B7. Confirm it took**

Serial should show, in order:
```
[provision] freezer 7, ip 10.0.x.x
[reading] posted
```
`[reading] posted` means sensor, WiFi, a valid NTP clock, and the authenticated
ingestion route all work.

**B8. Label the enclosure**

Write the number on it **before you unplug it**. Nothing on the board tells you
its identity by looking.

**B9. Confirm on the dashboard**

The card flips to **Live** after its first post. IDs 1–6 use a 1-minute
cadence; IDs 7–21 use a 15-minute cadence. The first reading after boot is
immediate, so a longer wait indicates a connection or posting problem.

**B10. Tick the row in the checklist below, then next node.**

---

# Part C — after all 21

- All 21 cards Live on the dashboard
- Install the nodes in/on the freezers
- Re-check the dashboard — RSSI drops once a node is behind a metal cabinet.
  Anything under about −80 dBm is likely to drop out; move the node or the AP.

---

# If something goes wrong

- `MAX31865 SPI/acquisition invalid` → check 3V3/GND and all four SPI wires; confirm CS/MOSI/MISO/SCK are GPIO4/5/6/7 and that the board is not loose
- `MAX31865 fault` → inspect the PT1000 two-wire/RTD+/RTD-/F+/F- wiring; open and short faults are intentionally rejected
- `invalid PT1000 reading` → check the PT1000 element, bridge links, reference board, and calibration; no value is uploaded
- No serial port → charge-only cable; or hold BOOT while plugging in
- No setup AP → already provisioned; `pio run -t erase` to wipe
- Portal reopens after saving → wrong password, 5 GHz, or enterprise auth
- `POST failed, status 404` → schema not run
- `POST failed, status 401/403` → device secret or ingestion allowlist wrong
- `[queue] buffered reading` repeatedly → no path to Supabase; data is safe on
  flash and flushes on reconnect (~3.8 days for IDs 1–6; ~58 days for IDs 7–21)
- Reboot loop → brownout; check the 100 µF cap
- Wrong card went Live → wrong number entered; `pio run -t erase` and redo B2-B9

# Re-provisioning

- **Reflashing does NOT clear the number** — a recycled board keeps its old one
- To wipe: `pio run -t erase`, then `pio run -t upload`
- Dead node? Provision the replacement with the same number. Nothing else changes.
- Moving a node to another freezer? Erase and reprovision — don't just relabel it

# Updating firmware later, over the air

The complete canary, hash, rollback, and bad-release procedure is in
[`docs/OTA_RUNBOOK.md`](../docs/OTA_RUNBOOK.md). The short command is:

```bash
pio run -e esp32-s3-ota -t upload --upload-port <exact-node-host-or-ip> \
  --upload-password "$OTA_PASSWORD"
```

OTA stays disabled until the ignored `include/device_security.h` supplies a
64-character SHA-256 `OTA_PASSWORD_HASH`. Keep the matching cleartext password
in a password manager or shell secret; never put either value in Git.
Freezer number, WiFi credentials, NVS, and the LittleFS queue survive an OTA
update. Never rely on a default target: identify the labeled node first. A
node that was USB-flashed with the rollback-enabled firmware can automatically
return to its last-known-good app if the new one fails during its first boot.

---

# Install checklist

| # | MAC | Wired | Flashed | Provisioned | Labeled | Live | Location |
|---|---|---|---|---|---|---|---|
| 1 | | ☐ | ☐ | ☐ | ☐ | ☐ | |
| 2 | | ☐ | ☐ | ☐ | ☐ | ☐ | |
| 3 | | ☐ | ☐ | ☐ | ☐ | ☐ | |
| 4 | | ☐ | ☐ | ☐ | ☐ | ☐ | |
| 5 | | ☐ | ☐ | ☐ | ☐ | ☐ | |
| 6 | | ☐ | ☐ | ☐ | ☐ | ☐ | |
| 7 | | ☐ | ☐ | ☐ | ☐ | ☐ | |
| 8 | | ☐ | ☐ | ☐ | ☐ | ☐ | |
| 9 | | ☐ | ☐ | ☐ | ☐ | ☐ | |
| 10 | | ☐ | ☐ | ☐ | ☐ | ☐ | |
| 11 | | ☐ | ☐ | ☐ | ☐ | ☐ | |
| 12 | | ☐ | ☐ | ☐ | ☐ | ☐ | |
| 13 | | ☐ | ☐ | ☐ | ☐ | ☐ | |
| 14 | | ☐ | ☐ | ☐ | ☐ | ☐ | |
| 15 | | ☐ | ☐ | ☐ | ☐ | ☐ | |
| 16 | | ☐ | ☐ | ☐ | ☐ | ☐ | |
| 17 | | ☐ | ☐ | ☐ | ☐ | ☐ | |
| 18 | | ☐ | ☐ | ☐ | ☐ | ☐ | |
| 19 | | ☐ | ☐ | ☐ | ☐ | ☐ | |
| 20 | | ☐ | ☐ | ☐ | ☐ | ☐ | |
| 21 | | ☐ | ☐ | ☐ | ☐ | ☐ | |

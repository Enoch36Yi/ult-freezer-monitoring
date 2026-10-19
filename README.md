# ULT freezer monitoring

Temperature monitoring for 21 ultra-low-temperature freezers at UW's Eichler Lab. The project received an $18,500 UW CSF-Large Grant. Deployment is in progress, and we are analyzing energy and temperature data to measure preventive-maintenance savings.

I manage the project. My work includes the sensor circuits, node firmware, Supabase backend, and enclosure CAD. The installation and study are a team effort; savings measurements are still in progress.

## How it works

A two-wire PT1000 connects to an Adafruit MAX31865 #3648 and an ESP32-S3. Only the sensor and lead enter the freezer; the electronics and USB power stay outside. Software SPI uses GPIO 4/5/6/7 for CS/MOSI/MISO/SCK, with the board's 4,300-ohm reference retained.

The node sends readings over HTTPS. A Next.js route checks each device's HMAC signature and writes to Supabase/PostgreSQL. A LittleFS queue buffers readings during outages. The dashboard shows temperature and device status.

Freezers 1-6 nominally sample every 60 seconds, and 7-21 every 900 seconds. Prototype 22 is a separate bench device with separate storage.

| Folder | Contents |
| --- | --- |
| `firmware/` | ESP32-S3/PT1000 firmware, PlatformIO configuration, host tests |
| `web/` | Dashboard and authenticated ingest route |
| `supabase/` | Schema and migration files |
| `cad_enclosure/` | CadQuery enclosure builders and geometry checks |
| `scripts/` | Offline data audits, synthetic restore tests, local QA tools |

## Run locally

Build outside OneDrive. The firmware uses PlatformIO; the web application uses Node.js/npm. Dependency versions are recorded in `firmware/platformio.ini` and `web/package-lock.json`.

For the dashboard, copy `web/.env.example` to an ignored local environment file and fill in your own settings. Service credentials belong on the server, never in a `NEXT_PUBLIC_*` variable.

```sh
cd web
npm ci
npm test
npm run typecheck
npm run build
```

For firmware, set the placeholder ingest URL in `firmware/include/config.h`. Use `device_security.example.h` as the template for a private local header; keep real Wi-Fi, ingest, provisioning and OTA credentials out of Git.

```sh
cd firmware
pio test -e native
pio run -e esp32-s3
pio run -e prototype-22
```

These commands compile and test. Follow `firmware/HOW-TO-FLASH.md` and the lab's acceptance procedure before flashing a device.

For the enclosure, install `cad_enclosure/requirements.txt` in a Python virtual environment, then run these from the repository root:

```sh
python cad_enclosure/enclosure_pt1000.py --output cad_enclosure/revision_pt1000_2026-10-17
python cad_enclosure/test_enclosure_geometry.py
python cad_enclosure/test_probe_exit_mesh.py cad_enclosure/revision_pt1000_2026-10-17
python cad_enclosure/verify_enclosure_exports.py cad_enclosure/revision_pt1000_2026-10-17
```

## Where things stand

This is the `portfolio-source-review-20261019` branch. Main is unchanged, and automatic Vercel deployment is disabled for this branch. The ingest-route change needs the matching replay-conflict migration and a production-schema check before release. No migration or deployment was performed for this update.

The publication copy passed 42 offline automation/SQL tests with synthetic fixtures. Matched web source passed 24 tests and TypeScript checking; the enclosure builder passed seven geometry tests. The full PowerShell runner was blocked by local script-execution policy. See `docs/LOCAL_QA_RUNNER.md` for its setup and limits.

Two issues still need work:

- Observation IDs can repeat after NVS erase or an MCU replacement, causing new readings to be dropped as duplicates. The options are recorded in `docs/OBSERVATION_IDENTITY_DECISION.md`.
- Enclosure orientation, measured cable/connector clearances, physical fit, cold accuracy and door-gasket routing still need lab acceptance.

This branch contains source, builders, tests and setup files. Real credentials, environment files, datasets, internal notes, logs and compiled images were excluded from the update. Earlier repository history is preserved.

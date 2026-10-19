# ULT freezer monitoring

An ESP32-S3 sensing node, authenticated telemetry service, dashboard, and enclosure CAD for 21 ultra-low-temperature freezers at UW's Eichler Lab. Deployment is in progress. The project received a UW CSF-Large Grant of $18,500.

## Contributions and scope

Enoch Yi is project manager. He designed sensor circuits, wrote node firmware, built the Supabase backend, and developed enclosure CAD. Energy and temperature analysis aims to measure preventive-maintenance savings; no completed savings figure is claimed here. Broader lab/team work is not represented as Enoch's sole contribution.

This source update preserves the repository history and incorporates selected current builders, tests, dependency files, and migration source. Private device headers, actual environment files, research data, internal coordination notes, logs, compiled images, and transfer archives are excluded from this update. Production endpoint defaults in the newly published firmware configuration are placeholders. Existing historical repository content is preserved, not rewritten.

## Architecture

- **Acquisition:** two-wire PT1000 through Adafruit MAX31865 #3648 (4,300-ohm reference), software SPI GPIO CS/MOSI/MISO/SCK 4/5/6/7; ESP32-S3 firmware.
- **Transport:** HTTPS to the dashboard ingestion route, per-device HMAC validation, observation identity and replay handling, and a bounded LittleFS offline queue.
- **Backend:** Next.js server route and Supabase/PostgreSQL schema. SQL migrations are source files; their presence does not establish application to production.
- **Dashboard:** temperature/status views and study/prototype separation.
- **Enclosure:** editable CadQuery model. Sensor and lead enter the freezer; electronics and USB power remain outside.

Study devices 1-6 nominally acquire every 60 seconds; 7-21 every 900 seconds. Prototype 22 is a separate bench target, not a 22nd study freezer.

## Publication status

This is the `portfolio-source-review-20261019` review branch. The operational `main` branch is unchanged. The branch is disabled for automatic Vercel Git deployment by matching configuration at both the repository and web project roots. Other branches retain their deployment settings. The ingest-route change and replay-conflict migration require coordinated production acceptance before any release. No migration or deployment is performed here.

## Setup

Build outside OneDrive. Use the pinned PlatformIO platform/libraries in `firmware/platformio.ini` and the committed web lockfile. PlatformIO requires Python; the web application uses Node.js/npm.

```sh
cd web
npm ci
npm test
npm run typecheck
npm run build
```

Copy `web/.env.example` to a local ignored environment file and fill in your own settings. Keep service-role/secret keys server-side; never place them in `NEXT_PUBLIC_*` variables. Provision device secrets through the documented flow. `firmware/include/device_security.example.h` is placeholder configuration; a real `device_security.h` must stay ignored. The bench Wi-Fi header, if needed, is also private. Set the firmware's placeholder dashboard URL before building for actual use.

```sh
cd firmware
pio test -e native
pio run -e esp32-s3
pio run -e prototype-22
```

These are test/compile commands, not authorization to flash. No firmware, backend, migration or dashboard deployment is performed by this repository update. Review `firmware/HOW-TO-FLASH.md` and the current lab acceptance procedure before operational use.

## CAD builders

Install `cad_enclosure/requirements.txt` in an isolated Python environment. Build fresh exports before running mesh checks; dated outputs are not added in this source-only update.

```sh
python cad_enclosure/enclosure_pt1000.py --output cad_enclosure/revision_pt1000_2026-10-17
python cad_enclosure/test_enclosure_geometry.py
python cad_enclosure/test_probe_exit_mesh.py cad_enclosure/revision_pt1000_2026-10-17
python cad_enclosure/verify_enclosure_exports.py cad_enclosure/revision_pt1000_2026-10-17
```

Orientation, clearances, actual probe/cable dimensions and physical fit remain open acceptance items. Digital solids/mesh checks do not establish assembly suitability, printer tolerance or cold performance. Older exports in the repository remain historical references.

## Verification and limitations

The source checkout's 42 offline automation/SQL tests passed during this review using synthetic fixtures. The matched web source passed 24 tests and TypeScript typechecking. The selected CAD builder passed 7 geometry tests. The source-only publication copy also passed all 42 automation/SQL tests. Historical local QA also covers firmware compilation and CAD; those prior results are not a claim of new hardware validation. The full PowerShell runner was blocked by the current shell's script execution policy in this review; no security policy was changed.

See `docs/LOCAL_QA_RUNNER.md` for the full local QA command and tool configuration. Some full-suite stages need a separately prepared bench project and generated CAD exports. `scripts/qa-config.example.json` contains placeholder tool paths. Synthetic restore tests are not production restore acceptance.

Important remaining work includes observation-ID reuse after NVS erase or device replacement (`docs/OBSERVATION_IDENTITY_DECISION.md`), production-schema/restore acceptance, enclosure orientation and fit, cold accuracy, excitation compatibility, and approved door-gasket cable routing. User-reported live uploads are not independently verified here. No preventive-maintenance savings result is inferred.

No new license has been added. Existing repository licensing and history are preserved.

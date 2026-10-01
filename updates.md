# ULT freezer project — cross-machine handoff

# 2026-09-30 repository-only reliability and release follow-up — no external state changed

- Added focused local commits: `f4f2138` firmware upload-result classification
  and queue backoff, `5b5b5ed` bounded/correlated ingest responses,
  `a2993bb` payload-version schema, `d78c8a5` batched latest-reading RPC,
  `6ebb454` dashboard use of that RPC, `e7520dc` pinned firmware dependencies
  and release manifests, `370e043` release/data operations handoff,
  `df0b124` dashboard refresh-contract cleanup, `f83cf60` queue I/O backoff,
  and `5eb313c` telemetry/OTA security-boundary documentation.
- Firmware now preserves queued data across permanent HTTP errors while using
  classified retry behavior and exponential backoff; trimming logs the number
  of oldest readings dropped at the flash cap.
- The ingest route now requires JSON, uses request IDs, bounds the upstream
  call, records payload version 1, and reports received/inserted/duplicate
  counts. Provider-level rate limiting is documented but not configured here.
- Existing projects need migrations `009_payload_version.sql` and
  `010_latest_readings_rpc.sql` applied in order before deploying the matching
  code. Fresh-project schema files include both changes.
- Added `STATUS.md`, `docs/RELEASE_CHECKLIST.md`, and
  `docs/DATA_OPERATIONS.md` so operators have explicit migration, backup,
  retention, rate-limit, secret-rotation, OTA, and restore gates.
- Local validation: `git diff --check`, release-manifest syntax/smoke check,
  and the web unit suite passed. TypeScript/build checks could not run in this
  environment because `tsc` is not installed; PlatformIO firmware tests/builds
  were not run because Python has no PlatformIO module here.
- No live Supabase/Vercel change, device flash, OTA upload, credential change,
  or hardware action was performed.

Last updated: 2026-09-30. External state still requires fresh verification.

## 2026-09-29 repository sweep follow-up — pushed, no external state changed

- Pushed the remaining repo-only hardening as separate commits on `main`:
  `5f4deeb` authenticated ingest tests, `a711d06`
  queue/OTA safety-gate tests, `0cb5942` migration ledger, `873219d` Prototype
  22 operations, `029255a` private device-registry format, `485c347` schema/API
  checks, `78ef329` hashed raw-readings export, `eb4e732` nonce-safe
  dynamic rendering, and `08af91c`
  dashboard loading/recovery usability hardening.
- The dashboard now separates loading from no-data, preserves successful values
  during partial fleet refresh failures, clears stale values on sensor-tier
  changes, exposes retry actions, uses accurate outage provenance copy, and
  keeps focus/touch targets usable on mobile. An isolated optimized build was
  checked with empty and outage mock APIs at desktop and mobile sizes; two
  independent final visual reviews passed.
- Checks completed: web tests, type-check and optimized Webpack build in the
  isolated QA copy, and `git diff --check`. PlatformIO, live SQL, Vercel, OTA,
  and hardware were not run here. No device was flashed and no live service
  state was changed.
- Before release, apply the ordered migrations, run the deployment steps in
  `docs/DEPLOYMENT.md`, and verify the deployed commit. The existing external
  deployment was not changed by this session.

## 2026-09-29 post-audit hardening — pushed, no hardware touched

- Pushed isolated fixes on `main`: `c793fe3` OTA rebind after Wi-Fi loss,
  `4aaaa99` interrupted/partial queue recovery,
  `2bd2ab0` receipt-time liveness, `af79e92` receipt-time indexes,
  `5c1dc7c` environment-derived CSP origin, `b70852b` bounded ingest bodies and
  placeholder-secret rejection, `97130d2` duplicate UI error cleanup,
  `5db555f` firmware version in telemetry/schema/dashboard,
  `962aa79` schema and commissioning docs, and `fa8efc9` Prototype 22
  verification coverage. Every commit was pushed to `origin/main` separately.
- Added migrations `007_latest_received_index.sql` and
  `008_firmware_version.sql`. They are committed but **not applied to the live
  Supabase project** from this session; apply them in order before deploying
  the matching dashboard/API version.
- Current checks: repository whitespace check passed and the web unit suite
  passed (3 tests). PlatformIO, TypeScript, PowerShell, live SQL, Vercel, OTA,
  and hardware checks were not run here. No device was flashed and no live
  service state was changed.
- The first pilot still needs the real firmware build, one authorized USB
  rollback-enabled baseline flash, a canary OTA/recovery test, and the genuine
  Prototype 22 bench acceptance described below.

## 2026-09-29 private GitHub release

- Repository: `https://github.com/Enoch36Yi/ult-freezer-monitoring` (**private**).
  Initial `main` commit: `893637cf6af2a6df27322714ecfe320c60d1b292`.
  `v0.1.0` is a GitHub **prerelease** with no binary assets.
- Git working checkout used for publication:
  `C:\Users\yieno\FreezersFirmwareGitRelease-20260929-141116` (outside
  OneDrive). The OneDrive project folder itself is not a Git checkout; future
  edits there do not automatically reach GitHub. Blake Bedford is taking over
  software/firmware fixes and should work from a Git clone/branch.
- Staged 87 source/documentation/CAD files. Private Wi-Fi header,
  `web/.env.local`, generated files, and credential-bearing binaries were not
  committed. The staged files were hash-compared against the source folder
  before the initial commit (zero mismatches). A direct scan found no copy of
  the local prototype Wi-Fi password in staged files.
- Verification from the off-OneDrive checkout: 6 firmware native tests,
  8 automation tests, 9 web tests, TypeScript check, Next.js production
  build, and `esp32-s3`, `prototype-22`, `prototype-22-diag` builds passed.
  No device was flashed and no live ingestion was claimed.
- Remaining gates are in `TODO.md`, especially a genuine Prototype 22
  temperature row and a sensor qualified for ULT conditions.

Last updated: 2026-09-29 21:19 UTC. Read this first in Codex on the desktop or laptop,
and in Claude Code. This is a status snapshot, not proof that external systems
still have the same state; recheck them before changing or claiming anything.
Task list: `TODO.md`. Bench-session sequence: `docs/BENCH_DAY_RUNBOOK.md`.

## 2026-09-29 OTA recovery and usability follow-up — no hardware touched

- Added OTA health validation and bootloader app rollback support. A new image
  stays pending until setup finishes, LittleFS mounts, and the main loop remains
  alive for 30 seconds; the firmware logs its version and OTA progress.
- Removed the hard-coded OTA target from `firmware/platformio.ini`; operators
  must provide the exact hostname or IP. Added `docs/OTA_RUNBOOK.md` covering
  the one-time rollback-enabled USB baseline, release hashes, canary rollout,
  expected serial evidence, and recovery of a bad release.
- Pushed separately, oldest first: `4143aa4` firmware rollback/validation,
  `d673812` health-window timing correction, `aa24570` OTA runbook and docs.
- This checkout has no PlatformIO installation, so the new firmware was not
  built here. No firmware was uploaded or flashed, no hardware was attached,
  and no Supabase or Vercel state was changed. The first pilot still needs a
  real build, a USB baseline on the board, and a canary OTA/recovery test.

## 2026-09-29 runway preparation (laptop, Claude Code) — no hardware touched

- User decision: electrical diagnosis is theirs, expected on the next bench
  day; software/docs are to be made ready beforehand. No flash, build, upload,
  database write, or Vercel change occurred in this session.
- Read-only checks at 01:02 UTC: `prototype_readings` HTTP 200 `[]` (still no
  genuine Prototype 22 reading); `readings` still holds only the 3 manual
  freezer-1 rows (latest id 600); `/` and `/prototype/22` on Vercel return 200.
  This laptop sees only Bluetooth COM3/COM4 (no ESP32 attached).
- Added: `TODO.md` (consolidated list from `9-24-QA_Check.md`, the B01–B14
  register, and this file); `docs/BENCH_DAY_RUNBOOK.md`;
  `scripts/prepare-bench-day.ps1` (interactive; stages outside OneDrive, writes
  the user-typed bench network into the staged header only, builds
  `prototype-22` and `prototype-22-diag`, prints hashes and Espressif ports; no
  upload). The script is only syntax-checked (parses); it has **not** been run,
  so the staged build for the new network does not exist yet.
- Edited: `web/package.json` gained `"typecheck": "tsc --noEmit"` (not run;
  no install here); README "Outstanding" reconciled (deployed; test rows);
  Prototype 22 plan checkboxes and `docs/PROTOTYPE_22.md` history labeled as
  historical; `CLAUDE.md`/`AGENTS.md` point to the new files.
- Found: **Node.js is not on PATH on this laptop**, so `prototype-check.mjs` and
  the JS tests cannot run here until Node LTS is installed. PlatformIO Core
  6.2.0 is available via `python -m platformio`.
- Deliberately not changed: firmware behavior (any change would ship untested to
  the board on bench day) and the flash authorization state (none granted).
  *Superseded by the follow-up below: one small firmware change was made.*

### Runway review follow-up, 2026-09-29 ~01:40–02:10 UTC (laptop, Claude Code)

Actually executed this time, not just syntax-checked. No flash, no upload, no
database/Vercel write; no board was attached.

- **Staging location was broken on this laptop.** The Microsoft Store Python
  virtualizes `%LOCALAPPDATA%`, so PlatformIO reported the staged folder
  `does not exist`. The 2026-09-26 note about staging in
  `%LOCALAPPDATA%\FreezersFirmwareBuilds` must have run under a different
  Python or machine (that folder did not exist here). Staging now uses
  `%USERPROFILE%\FreezersFirmwareBuilds`. The two failed staging folders this
  session created (they held a copy of the Wi-Fi header) were deleted.
- **`prepare-bench-day.ps1` runs end to end** (`-KeepCurrentHeader`, i.e. the
  OLD network): it builds `prototype-22` (982,608 B, SHA-256
  `475386134B7CD2186284B041627A8A4DA379F14B3846804AF268AC6886E61540`) and
  `prototype-22-diag` (995,056 B, `BF3D5753DF65B0856CC25FA974CB0EFEB0B8B96CB84817426A84F14AA40DBB55`),
  in `C:\Users\yieno\FreezersFirmwareBuilds\prototype-22-20260929-014004-e56b0a5e`.
  These images carried the old network, so that test folder was **deleted**
  afterwards; the preflight now correctly reports FAIL "no staged build" until
  the user builds for the bench network. The
  fleet `esp32-s3` image also built (81.8% flash) and contains none of the
  prototype strings or `[1wire-diag]`. Fixed a PowerShell 5.1 issue where a
  Python warning on stderr aborted the build.
- **Firmware change (built, not flashed, not observed):** `mountFilesystem()`
  now does what `flushQueue()`'s comment already claimed. It adopts an orphaned
  queue temp file after a power cut between remove and rename, and discards a
  partial temp file when the original queue still exists. It only fires if a
  temp file exists at boot. Native tests cannot run here (no gcc).
- **`supabase/verify.ps1` failed every check under Windows PowerShell 5.1**
  (missing `-UseBasicParsing`, and the 5.1 single-object JSON array quirk that
  mislabeled freezer 1 as `no_data`). Fixed. It now exits 0: freezer 1 `offline`
  (3 old manual rows), 2–21 `no_data`, all three tier RPCs OK.
- **New `scripts/prototype-check.ps1`** (no-Node twin of `prototype-check.mjs`).
  Tested read-only against the live API with local fixture logs: none →
  `no_readings_yet`; posted → `posted_not_found_in_rows`; buffered and missing
  probe → `no_posted_serial_reading`. `matched` cannot be tested until a genuine
  row exists.
- **New `scripts/bench-preflight.ps1`** (read-only OK/WARN/FAIL). Current run:
  no FAIL; `prototype_readings` 0 rows; WARN "staged header identical to old
  one" (expected until the user builds for the bench network); no board.
- `capture-prototype-serial.ps1` correctly refused Bluetooth COM3 and created no
  file. esptool v4.11.0 is available for a read-only `read_mac`.
- `pwsh` is not installed here; all docs now use `powershell -ExecutionPolicy
  Bypass -File`. `check-local.ps1` used `Encoding.Latin1` (absent in 5.1): fixed.
- Runbook rewritten with tested commands; acceptance form prefilled with the
  known probe and board facts (marked prefilled/unconfirmed); HOW-TO-FLASH warns
  against building inside OneDrive.
- **Next (user):** run `prepare-bench-day.ps1` with the bench network, then the
  preflight; electrical work; then COM port + direct "elephant".

## 2026-09-26 readiness and OneDrive safety follow-up (laptop)

- The earlier `npm ci` inside this OneDrive-synced tree triggered a OneDrive
  prompt about deleting 21,582 items. The user explicitly chose **Keep**.
  Key source files and the existing firmware image were subsequently present;
  do not assume that proves cloud sync is complete. Do not run package installs
  or builds inside this synced folder again.
- `scripts/check-local.ps1` now aborts before work if launched from a OneDrive
  path. Added `scripts/stage-prototype-firmware.ps1` to copy only firmware
  source into a new private `%LOCALAPPDATA%\FreezersFirmwareBuilds` directory.
  A clean `pio run -e prototype-22` there succeeded (no upload). The staged
  image SHA-256 was
  `79CDB1F26CE9568CC7A753CC894D342735FE0F46FEEB1332B7162DE50A519980`.
  The earlier synced-tree image remains present with the hash recorded below.
  The staged directory and image contain private Wi-Fi credentials; do not
  publish them. Staging/build success does not establish electrical or live
  telemetry acceptance.
- The user says tomorrow's assembly location has a multimeter and USB data
  cable, but uses a **different Wi-Fi network**, confirmed to be a 2.4 GHz
  personal network/hotspot. Prototype firmware calls
  `WiFi.begin` with compiled credentials, including on reconnect. The current
  image cannot be assumed to connect tomorrow. Configure the actual network
  in a private *outside-OneDrive* staged copy and rebuild there; identify the
  observed board/port. No upload without a new direct user flash trigger.
- The new probes were identified as HiLetgo 5-pack 1 m waterproof DS18B20,
  exact Amazon item B00M1PM55K. The user reports red/yellow/black leads; that
  specific listing maps red VCC, yellow DATA, black GND. HiLetgo's separate
  product page gives conflicting color sets, so still inspect the received
  item/label and meter the finished connections before powering. DS18B20's
  -55 °C lower rating remains a separate limitation for ULT freezer use.
  `docs/PROTOTYPE_22_ACCEPTANCE.md` records these network and probe gates.
- During source inspection, a command output exposed the current Wi-Fi
  password. It was not repeated in prose. Treat that credential as exposed
  and rotate it when practical; do not print it again. No database, Vercel,
  board, or flash change was made in this follow-up.

## 2026-09-26 automation preparation (laptop)

- Added `scripts/check-local.ps1`: host tests, fleet/prototype/diagnostic
  PlatformIO builds, binary marker isolation checks, web tests, TypeScript,
  production web build, and private prototype image hash. Final full run
  passed: 6 firmware native tests, all 3 firmware builds, 9 web tests,
  8 automation tests, TypeScript, and Next.js build with `/prototype/22`.
  Standard prototype image SHA-256:
  `DC2DBC58D5331BA33D29E8ED78E30A7A9F60391CC98CAFFC557AFE145C37E9CB`.
  `web/node_modules` was incomplete on this machine; restored with `npm ci`
  from the existing lockfile. A stale `.next` cache warning occurred on the
  first production build, which nevertheless passed; the final build passed
  without that warning.
- Added a read-only `scripts/prototype-check.mjs` and five tests. It checks
  the intended project's prototype API and public routes. Given a serial
  capture, it requires a `[reading] posted` payload and a matching stored
  timestamp/temperature before reporting a verified row; buffered readings
  cannot pass. Added `scripts/capture-prototype-serial.ps1`, which requires an
  explicitly named Espressif COM port and an unused output path. Its invalid
  COM999 guard was tested; no file was created. Real serial capture remains
  untested because this laptop does not have the board.
- Added `docs/PROTOTYPE_22_ACCEPTANCE.md` for the new physical assembly,
  including waterproof-probe pinout/rating evidence and measured electrical,
  ROM, temperature, upload, database, and browser checks. Linked it from
  `docs/PROTOTYPE_22.md`.
- Added offline `scripts/audit-readings.mjs` and
  `docs/READINGS_AUDIT.md` for a complete JSON export of the 21 in-house
  freezer channels. It calculates expected/unique/missing UTC grid slots,
  duplicate counts, timestamp/ID issues, maximum upload delay, and an input
  SHA-256. Three tests passed. It does not query or change Supabase and does
  not establish calibration, exclusions, or baseline eligibility.
- Fixed the known absent-queue log flood in source by caching queue presence
  at mount and updating it on buffer/flush rather than probing
  `LittleFS.exists()` on every loop. Queue-state native tests passed and all
  firmware variants built. This revision is **built locally, not flashed**;
  on-device log behavior has not yet been observed. The last locally observed
  replacement board had the diagnostic image; its present state was not
  rechecked this session.
- Fresh read-only checks at 03:08 UTC: the intended project
  `dfxxamgnrimwoumknuxa` prototype API and both public routes are reachable,
  but `prototype_readings` still has no row. `supabase/verify.ps1` passed its
  fleet contract/history checks; the fleet table still reported 3 historical
  rows. No Supabase or Vercel write, no fabricated reading, and no flash.
- Next on the new assembly: verify its physical wiring and probe rating,
  identify its board/port, obtain a new direct user flash trigger if upload is
  needed, capture at least two sample cycles, then run the read-only prototype
  checker and compare the browser display with a genuine stored row. Keep the
  prior board's state separate from the new assembly record.

## 2026-09-25 methodology drafting update (laptop)

Updated `firmware/METHODOLOGY.md` as a prospective deliverable draft. It now
states the intended ESP32-S3/DS18B20 wiring (USB-C power, GPIO4 DQ, external
3V3/DQ pull-up), distinguishes a schematic review from assembled-board
acceptance, and specifies hardware, electrical, ROM-detection, upload, and
stored-record evidence before baseline. Removed a stale device-1 bench-status
sentence from the protocol and corrected completeness to use the 1-minute and
15-minute grids. No firmware, database, web, board, or external service was
changed; no new live temperature measurement was verified. The user will copy
the methodology file to Dropbox after this edit. Recheck external state afresh.

## Where the work lives

- This laptop's project root: `C:\Users\yieno\OneDrive - Seattle Pacific University\Freezers Firmware`.
- On the desktop, find the OneDrive-synced **Freezers Firmware** folder and use
  that machine's actual path. Do not assume the laptop path exists there.
- This folder was **not a Git repository** on 2026-09-23. OneDrive sync is the
  current cross-machine transport. Wait for sync to finish before switching
  machines; check for conflict copies and avoid editing the same files in two
  sessions at once. `.gitignore` does not prevent OneDrive from syncing files.
- Read `README.md` for system overview, `docs/PROTOTYPE_22.md` for the bench
  instrument and measurement record, `firmware/METHODOLOGY.md` and
  `METHODOLOGY_AND_DOCUMENTATION_NEEDED.md` for the study methodology. Treat
  source files and fresh tests as authoritative if prose has gone stale.
- After each work session, update this file with date, machine, verified
  results, blockers, and the next action. Distinguish **built locally** from
  **deployed**, **flashed**, and **observed live**.

## Study boundary and current implementation

- The study has **21 freezers**. Freezers 1–6 report every **1 minute**;
  freezers 7–21 every **15 minutes**. Do not change the count to 22.
- **Prototype 22** is a separate USB-powered ESP32-S3/DS18B20 bench instrument
  at a one-minute cadence. It is not “Freezer 22” and must not enter study
  counts or vendor-tier comparisons. Its data belongs in
  `public.prototype_readings`, not `public.readings`.
- Prototype firmware is `firmware/` PlatformIO environment `prototype-22`.
  It fixes ID 22, posts to the prototype REST endpoint, uses separate LittleFS
  queue paths, and ignores the board's old Freezer 1 NVS identity. Fleet
  environment `esp32-s3` remains for freezers 1–21.
- `web/components/PrototypeCard.tsx` puts the card below the 21-freezer grid;
  `web/app/prototype/22/page.tsx` provides its detail/chart page. The fleet
  reporting count and fleet detail routes remain separate.
- `supabase/prototype22.sql` creates the isolated table, RLS/permissions,
  index, and prototype-only bucketed-history function. Target project ref:
  `dfxxamgnrimwoumknuxa`. The existing fleet table must not be recreated,
  cleared, or used for prototype test data.

## What was verified on 2026-09-23

- Fleet and prototype firmware images both built successfully with PlatformIO.
  Their REST endpoints are distinct. The prototype Wi-Fi credential appears
  in the prototype binary and **not** in the fleet binary.
- Web: 9 tests passed; TypeScript check and Next.js production build passed.
  The production build included `/prototype/22` and all 21 freezer pages.
- The live Supabase prototype endpoint returned HTTP **404 / PGRST205**
  (“table not found”) before deployment. See the later same-day update below:
  this blocker was resolved when database tools became available.
- No ESP32 serial port was present on this laptop; COM3/COM4 were Bluetooth.
  Prototype 22 was **not flashed** and no real reading was verified. The
  DS18B20 was previously reported unsoldered; verify its present condition.
- Native PlatformIO host tests could not run because this Windows machine has
  no `gcc`/`g++`. This is distinct from the two successful ESP32 builds.
- The updated website was built locally, **not confirmed deployed** to a
  public host. Do not describe the dashboard or prototype as live on this
  evidence alone.

### Later same-day interruption

- The user gave the future flash trigger, and the laptop then detected an
  Espressif USB serial device on **COM5** (`VID_303A:PID_1001`). The upload
  had **not started** when the user said “wait” and asked why Prototype 22 was
  absent from Vercel. Flashing is paused pending the user's next direction.
- `web/.vercel/project.json` is absent; no Vercel CLI sign-in or `VERCEL_*`
  environment variable was found on this laptop. The web code was built
  locally but has not been linked to or deployed to the existing Vercel site.
- The Vercel connection identified the existing project as `ult-freezres`
  (`prj_osHBLilmKtG8MS4e6Pl7Xq7XhzkK`) under `rhinoch-group`, with the
  production alias `https://ult-freezres.vercel.app`. On 2026-09-23, `/`
  returned the old dashboard and `/prototype/22` returned HTTP 404. The
  connection can list the project but was denied team-scoped deployment
  access. The user was asked to reconnect Vercel with the `rhinoch-group`
  team authorized. No Vercel deployment has been made from this laptop.
- Rechecked after the user said the connection was present: team-scoped API
  requests still returned HTTP 403 for `rhinoch-group`. The connector's
  advertised deploy action returned `Tool deploy_to_vercel not found` when
  targeted at the existing project as a preview. The public production home
  page still lacked “Prototype 22” and `/prototype/22` was still HTTP 404.
  No preview or production deployment was created by that attempt.
- A CLI fallback was checked on this laptop. The Vercel CLI resolved to
  version 59.25.4, but `whoami` failed before authentication with missing
  package `@vercel/cli-auth` in the temporary pnpm installation. No project
  was linked or deployed. Do not treat plugin installation as CLI login.
- At 23:14 UTC, the separate `public.prototype_readings` table and
  `prototype_readings_bucketed` function were applied to project
  `dfxxamgnrimwoumknuxa`. Historical state at that time: table exists, zero
  prototype rows, RLS on, anon SELECT/INSERT/EXECUTE but no UPDATE/DELETE,
  public GET and RPC return empty results successfully, Security Advisor has
  zero findings, and the fleet still has its original three rows. Migration
  003 later removes the anonymous INSERT grant. No synthetic data inserted.
  This was direct SQL execution, not a CLI migration-history entry. The SQL
  SHA-256 is `C2930B02BC463496D9D0BBBA112E9FFDC7D4853709D9ECC86E155C739C1F41CF`.
  The locally built, still-unflashed prototype firmware SHA-256 is
  `F181C6C8A2D8389FDC1BD875FDF1D114206ED6D64C7BA52F4EC9698109C2651B`.

### Vercel deployment completed at 23:32 UTC

- The user completed Vercel CLI sign-in. This laptop linked `web/` to the
  **existing** `rhinoch-group/ult-freezres` project; no new Vercel project was
  created. The project's production configuration already had both public
  Supabase environment variables. `web/.env.local` remained local and was not
  uploaded. The connector's team-scoped access problem did not block CLI
  deployment once the user authenticated.
- The project was built on Vercel as production deployment
  `dpl_7CpsL2ViY1v8pfCEctbW1DMGHnjo`, then promoted to the existing
  [public site](https://ult-freezres.vercel.app). The build included
  `/prototype/22`. Fresh public HTTP checks returned **200** for `/`,
  `/prototype/22`, and `/freezer/1`; the homepage and prototype route contain
  “Prototype 22.” This verifies deployment and rendering, **not** live device
  ingest or temperature-chart behavior with real data.
- The prototype table still had zero rows at its last direct check. Do not
  create fake rows just to populate the website. Flashing remained paused
  after the user's “wait”; no upload was attempted as part of deployment.

### Prototype 22 flash at 23:36–23:38 UTC

- The user directly resumed the flash with “elephant.” COM5 was freshly
  identified as the only Espressif USB serial device (`VID_303A:PID_1001`,
  device MAC `28:84:85:66:61:64`); COM3/COM4 were Bluetooth. A fresh
  `prototype-22` PlatformIO build passed and the image was uploaded to COM5.
  Esptool reported verified hashes and PlatformIO ended with **SUCCESS**.
  No full-chip erase or LittleFS upload was requested. The built image SHA-256
  was `F181C6C8A2D8389FDC1BD875FDF1D114206ED6D64C7BA52F4EC9698109C2651B`.
- Serial after a reset confirmed `prototype 22`, a 60-second interval,
  LittleFS mounted, Wi-Fi connected at `10.0.0.246` with RSSI −70 dBm,
  NTP synchronized, and OTA advertised as `ult-prototype-22.local`.
  The board reported **“no DS18B20 on the bus”**. The probe was previously
  reported unsoldered; its present physical state could not be verified
  remotely. Do not claim the temperature channel works.
- The board emits repeated LittleFS error logs for the absent
  `/prototype22-queue.jsonl` file (roughly 30 per second). Code inspection
  traces this to polling `LittleFS.exists(QUEUE_PATH)` while the queue has
  not been created. Treat this as a logging defect to fix in a future firmware
  revision; it is not evidence that a reading was buffered.
- A fresh public REST GET of `prototype_readings` returned HTTP 200 and
  `[]` at 23:38 UTC. **No genuine reading has been ingested.** Do not insert
  a fabricated reading. The dashboard should still show “no readings yet.”

### Replacement probe check at 00:10–00:11 UTC on 2026-09-24

- The user reported replacing and soldering a DS18B20, then powering the
  board. COM5 was still the Espressif USB serial device. After a serial-line
  reset, startup reported **“no DS18B20 on the bus”** twice; the board did
  connect to Wi-Fi, synchronize NTP, and advertise OTA. A fresh public REST
  GET returned HTTP 200 with `[]` from `prototype_readings`.
- The replacement probe is **not detected** and no temperature has reached
  Supabase. No wiring photo or multimeter measurement was available at this
  check. With USB disconnected, inspect the probe's pin orientation, 3V3,
  GND, DQ-to-GPIO4 continuity, and the DQ-to-3V3 pull-up. Do not reflash or
  change schema merely to address a missing 1-Wire device.

### Photo review at 00:21 UTC, corrected after clearer photo

- Five board photos were supplied. The first review mistakenly interpreted
  the white lead as attached to ESP32 GPIO6 and suggested moving it. A later,
  clearer image shows the lead on the ESP32 pad labeled **4**, matching the
  firmware's `ONEWIRE_PIN=4`. **Retract the GPIO6 diagnosis and do not move
  that lead on its basis.** The perfboard's nearby row numbers contributed
  to the misread.
- The DS18B20 remained undetected in the last live serial check. Photos
  alone do not establish electrical continuity, pull-up resistance, or
  supply voltage. No physical correction has been verified; retain the
  photos and continue with a single measured/visually confirmed connection
  check before changing hardware. Do not reflash merely for this uncertainty.

### Post-cleanup replug check at 00:34–00:35 UTC

- The user cleaned solder joints and replugged the board. COM5 was present.
  A serial-line reset (no flash) captured startup: LittleFS mounted, Wi-Fi
  connected, NTP synchronized, and **“no DS18B20 on the bus”** twice.
  The missing-queue-file log noise persisted. A fresh public REST GET of
  `prototype_readings` returned HTTP 200 and `[]`. No measured temperature
  or publication has been observed after cleanup.
- The white lead is on ESP32 GPIO4 per the clearer photo; do not relocate it
  based on the earlier, retracted GPIO6 claim. The next useful evidence is a
  continuity/voltage check at the probe when a meter is available, or new
  focused photos of the sensor's three leads and corresponding underside
  rows after cleanup. Do not replace the board or reflash on guesswork.

### E25–F25 repair check at 04:56–04:57 UTC

- The user identified an open brown jumper between E25 and F25, believed to
  bridge the sensor ground path across the perfboard's center gap, and
  reported repairing it. No post-repair meter reading has yet confirmed
  continuity or voltage at the sensor.
- COM5 was present. A fresh serial-line reset (no flash) still reported
  **“no DS18B20 on the bus”** twice while Wi-Fi and NTP worked. A fresh
  public REST GET of `prototype_readings` returned HTTP 200 and `[]`.
  Therefore the reported repair has **not yet** restored probe detection or
  produced a reading. Recheck probe-ground-to-ESP-ground voltage/continuity,
  then power and DQ, one path at a time; do not assume E25–F25 was the only
  open connection.

### Physical board replacement at 06:26 UTC

- The user reports building a **new physical device** and designates it as
  Prototype 22. The previous, faulty MCU/board is retired and is not expected
  to receive power again. Its hardware MAC was `28:84:85:66:61:64`; it is
  the board that received the successful Prototype 22 upload but never
  detected a DS18B20 or produced a database reading. Label/store it so it
  cannot be accidentally powered alongside the replacement with the same
  logical identity.
- PlatformIO device discovery now sees an Espressif USB device on **COM6**
  (`VID_303A:PID_1001`, serial/MAC `28:84:85:6B:2C:58`), distinct from the
  old COM5 board. This is consistent with the replacement, but its wiring,
  firmware contents, sensor detection, Wi-Fi, and Supabase ingest have **not
  yet been verified**. No flash was attempted in this handoff update.
- The logical ID remains 22. The existing `prototype-22` firmware profile,
  separate Supabase table, and Vercel Prototype 22 page do not need a new
  ID or a 22nd freezer entry. The replacement MCU does need the prototype
  firmware uploaded when the user gives a new, direct flash instruction.

### Replacement-board flash at 06:31–06:32 UTC

- The user directly gave the new “elephant” flash instruction. PlatformIO
  freshly identified the replacement as Espressif **COM6**, MAC
  `28:84:85:6B:2C:58`; the retired COM5 board was not present. A fresh
  `prototype-22` build passed, SHA-256
  `F181C6C8A2D8389FDC1BD875FDF1D114206ED6D64C7BA52F4EC9698109C2651B`.
  The image was uploaded to COM6; esptool verified all written hashes and
  PlatformIO reported **SUCCESS**. No full-chip erase or filesystem upload
  was requested.
- Fresh serial startup confirmed Prototype 22, LittleFS mounted, 60-second
  sampling, Wi-Fi IP `10.0.0.17`, NTP synchronization, and OTA listener.
  It reported **“no DS18B20 on the bus”** twice. The new board's sensor
  connection has not been physically verified; do not transfer the old
  board's wiring diagnosis to this board. The known missing-queue-file log
  noise also persists in this unchanged firmware image.
- Fresh public REST GET of `prototype_readings` returned HTTP 200 with `[]`.
  Thus the new board is **flashed and online**, but temperature measurement,
  Supabase ingest, and dashboard values remain **unverified/not working**.
  Do not invent a test reading. Determine whether a DS18B20 is installed on
  the replacement and check its 3V3/GND/DQ/pull-up wiring before changes.

### 1-Wire diagnosis after user's meter checks at 06:35 UTC

- The user states the replacement board's DQ, power, and ground connections
  are stable by multimeter. Exact powered voltage values and measurement
  endpoints have not yet been supplied; do not contradict that report or
  label a specific wire faulty. Fresh serial had twice shown no DS18B20.
- Static firmware review confirmed `ONEWIRE_PIN=4`, a global OneWire instance
  on that pin, `DallasTemperature::begin()` followed by device enumeration,
  and a retry at each sample if no probe was found. The bundled OneWire
  2.3.8 source's known ESP32-S3 output-pin limitation applies above GPIO33,
  not GPIO4. No firmware root cause is established. The next discriminating
  non-invasive check is powered DQ-to-probe-GND DC voltage (idle high vs
  stuck low), followed by a scoped 1-Wire reset/presence diagnostic only if
  the user's authorization permits another firmware upload.

### Replacement-board photo review at 06:51 UTC — correction

- User-reported powered readings, taken at different moments/points, were DQ
  0.972 V, probe VDD 2.71 V, and ESP32 3V3 2.2 V. These are not a consistent
  normal 3.3 V supply; measurement reference points and loading remain
  unverified. The board should remain unplugged while checking the wiring.
- **Retract the prior diagnosis to move the row-20 red jumper.** The user pointed out row 20 is connected to GND. Reinspection of the replacement-board close-up (`E057887C-B5AF-489E-AD82-1E50E57D5B14/2-Photo-2.jpg`) shows the two vertical rails shift horizontally with perspective: the upper of the two lower red jumpers ends on the **outer GND rail**, while the lower ends on the **inner 3V3 rail**. The earlier analysis compared their image x coordinates as though the rails were vertical in the photo and therefore misassigned the upper jumper. **Do not move either red jumper on the basis of that claim.** No wiring fix has been established.
- Analog Devices' DS18B20 datasheet labels TO-92 pins 1/2/3 as GND/DQ/VDD and specifies local VDD 3.0–5.5 V. The sensor's orientation and actual pin-to-MCU continuity remain to be verified on this new assembly before making another hardware change. Earlier user meter checks indicate the conductors may be continuous, but the differing powered voltages need a common reference and repeat measurement. No new flash is authorized.

### Common-reference voltage check reported at 07:34 UTC

- User measured **3.3 V directly between the ESP32's 3V3 and GND pads**, but only **approximately 10 mV between the two right-hand power rails**. The exact rail touch points were not supplied. This is stronger evidence of a break in 3V3 or GND distribution to the sensor than of a firmware fault. It does **not** distinguish which rail has lost its connection; do not infer a specific jumper to move or re-solder yet.
- Next discriminating measurement, with USB powered and meter on DC volts: hold black on the **ESP32 GND pad** for both readings, touch red to the **inner right rail** near the sensor, then the **outer right rail** near the sensor. Expected if wiring is good: approximately 3.3 V on the inner rail and 0 V on the outer. Report both values and avoid bridging adjacent rails with the probe tip. Do not use continuity mode on a powered board. If readings differ, isolate the one failing path with USB unplugged before any soldering.

### After user-reported rail-joint soldering at 07:44 UTC

- The user said the ESP32 GND/3V3 connections to the rails had been incompletely soldered and reported completing that soldering. No **post-repair rail voltage** has yet been supplied; do not claim the rail fault is corrected.
- The replacement Espressif USB serial device was present on **COM6**. A read-only 75-second, 115200-baud serial monitor captured **`[sensor] no DS18B20 on the bus; check DQ wiring and the 6.8k pull-up`**. No successful sensor enumeration or temperature reading was captured. No reset, upload, or flash was performed.
- A fresh read-only SQL query against project `dfxxamgnrimwoumknuxa`, `public.prototype_readings` ordered by newest ID, returned **zero rows**. There is still no evidence of genuine Prototype 22 ingestion.
- Next single physical check: with USB powered and meter on DC volts, measure **between the two right-hand rails at the sensor end** (expected approximately 3.3 V, not 10 mV). If that is correct, measure DQ relative to that same local ground rail at the sensor and check the 6.8 kΩ pull-up. Do not change firmware or guess at more solder joints based solely on the persistent detection failure.

### Post-solder rail voltage reported at 07:45 UTC

- The user measured **3.23 V between the two right-hand rails** after soldering the ESP32 power/ground connections. This supports that the rails now have a normal supply difference; it does **not** by itself establish voltage at the DS18B20 legs or successful 1-Wire communication. The most recent serial observation, after soldering, still said no DS18B20 and the most recent database query was empty.
- Next measurement: on DC volts with USB powered, hold black on the **outer right-hand GND rail near the sensor** and touch red to the **middle DS18B20/DQ row (approximately row 21), or the lower end of its brown data jumper**. Idle DQ should be near the 3.23 V rail through the pull-up, apart from brief communication pulses. Avoid bridging adjacent contacts. Do not use continuity mode powered.

### Post-solder DQ/VDD voltage reported at 07:48 UTC

- The user reports both DS18B20 **DQ and VDD at approximately 3.2 V**. The exact black-probe contact was not specified, so voltage across the sensor's actual VDD/GND legs is not independently established. A high idle DQ is consistent with a pull-up, but does not prove that the MCU GPIO4 can drive the sensor or that the sensor responds.
- The OneWire issue #164 open in the user's browser concerns the library's ESP32-S3 output limitation on **GPIO >33**; this firmware uses **GPIO4**, so that reported issue does not explain this board's failure. Do not change the GPIO or library on that basis.
- Next discriminating no-flash check: USB unplugged, meter in continuity mode, one probe on the **ESP32 pad labeled 4 / gray-wire solder point**, the other on the **actual metal middle DS18B20 leg** (not merely the brown jumper or its PCB pad). A beep would support full DQ continuity; no beep would localize an open. If DQ continuity is verified, similarly verify the sensor's actual GND leg to the MCU GND pad, then consider sensor identity/orientation or a scoped reset/presence diagnostic only with new flash authorization.

### Row-11-to-row-21 continuity corrected at 07:52 UTC

- The user initially reported no continuity between row 11 and row 21, then immediately corrected themselves: **there is continuity**. The earlier open-bridge conclusion is **retracted**. Do **not** reflow or replace the long brown jumper on that basis. No new hardware fault has been established.
- Row-to-row continuity establishes only the board trace/jumper. Next unplugged test should go from the **ESP32's actual GPIO4 metal pad/lead** to the **DS18B20's actual middle metal leg**, not just their neighboring perfboard holes, to include both component-to-board joints. If that beeps, test the sensor's actual GND/VDD legs to the MCU GND/3V3 pads before considering a diagnostic firmware revision; any new flash still needs a fresh direct “elephant.”

### Intermittent DQ continuity reported at 07:53 UTC

- The user clarifies continuity between the relevant points goes **on and off**, apparently associated with the long wire between rows 11 and 21. Thus the prior statement that row-to-row continuity is simply good was incomplete: the DQ route may be intermittent. The exact failure location (wire conductor, top solder joint, bottom solder joint, or meter contact) is not yet proven.
- With USB unplugged, hold meter contacts fixed at row 11 and row 21 and gently move only the long brown jumper. If the reading toggles, reflow both of that jumper's solder joints or replace the jumper alone. Then require stable near-zero resistance/continuous beep while gently moving it, and inspect for shorts to adjacent rows/rails before reconnecting USB. Do not rebuild the entire device or change firmware on this evidence. After stable continuity and repower, verify live sensor enumeration and genuine Supabase ingest.

### Reconnection check at 07:58 UTC

- The user said "everything is beeping now" after continuity troubleshooting but did not specify each pair, whether probes were held steady, or that the long jumper was reworked. With USB unplugged, the user reported **no sustained continuity beep between the ESP32 3V3 and GND pads**. This reduces concern about a direct power short, but does not verify the sensor's actual legs.
- After inviting USB reconnection, the same Espressif **COM6** serial port appeared. A read-only 75-second monitor captured **`[sensor] no DS18B20 on the bus`** and no reading/POST line. Two fresh read-only SQL queries before and after the sampling window found **zero rows** in `public.prototype_readings`. No flash, firmware change, or database write was made. Do not claim this board is measuring or publishing.
- Given 3.23 V across rails and a high idle DQ report, the next focused unpowered test is continuity from the **actual metal GND leg of the DS18B20** to the **actual ESP32 GND pad**, with stable meter contacts. If stable, verify MCU GPIO4 pad to actual middle sensor leg and actual VDD leg to MCU 3V3 pad, recording resistance rather than only a momentary beep. Do not guess another solder change until a failing segment is localized.

### ESP32-to-rail power-path regression reported at 08:03 UTC

- User reports that continuity from ESP32 GND/3V3 to the corresponding board rails, previously believed working and with a measured 3.23 V rail difference, is **not working now**. Exact current voltage/resistance and whether one or both paths fail were not provided. Treat the power path as **intermittent/unreliable**; the earlier 3.23 V was a momentary observation, not a durable acceptance test. Stop DS18B20/firmware/Supabase troubleshooting until power distribution is mechanically stable.
- The replacement-board front photo shows the two short **top-right red jumpers** from MCU GND to outer ground rail and MCU 3V3 to inner 3V3 rail. Because these exact joints were earlier reported incompletely soldered, inspect/rework or replace these two supply links only, with USB unplugged. Verify direct MCU-pin-to-rail continuity and rail-to-rail isolation unpowered; then verify approximately 3.3 V between rails powered, including under gentle board movement. Do not infer a specific failed end without a test, and do not power if there is a sustained short. No new flash is authorized or needed for this hardware problem.

### User-reported unsoldered-joint fix and live check at 08:09 UTC

- The user reported an "unsoldered fix" and asked for a check. They did not identify the exact joint or provide a new post-fix rail voltage. Do not state the supply connection is stable on this report alone.
- The replacement Espressif device appeared on **COM6**. A new read-only 75-second serial monitor again captured **`[sensor] no DS18B20 on the bus; check DQ wiring and the 6.8k pull-up`**, with no measured temperature/POST line. Read-only SQL queries immediately before and after the window returned **zero rows** in `public.prototype_readings`. No flash, code change, or database write occurred.
- Before further DQ work, measure the current DC voltage **across the two right-hand rails at the sensor end** while USB-powered. Only if it is again stable around 3.2–3.3 V should troubleshooting move to the actual DS18B20 leg joints/continuity, ideally with a sharp solder-side photo to avoid another wrong front-photo inference.

### Post-fix rail voltage at 08:11 UTC

- The user measured **3.28 V across the right-hand rails near the sensor** after the most recent unsoldered-joint fix. This is a good momentary powered rail measurement, but does not establish mechanical stability or voltage/continuity at the DS18B20's actual leads. Serial just before this measurement still reported no DS18B20; the database was empty.
- Clarify whether the earlier ~3.2 V measurements of DS18B20 DQ and VDD used the **actual metal GND leg of that sensor** as the black meter reference, versus the outer rail/MCU GND. If actual leg was used, local sensor supply and DQ idle voltage are supported; then focus on end-to-end GPIO4-to-middle-leg continuity or sensor response. If not, verify actual sensor leg connections before further software work. Do not infer a bad chip or firmware solely from rail voltage.

### User confirms sensor power check at 08:13 UTC

- User clarifies the 3.28 V reading was **rail-to-rail** and separately states they checked that the DS18B20 **is getting power**. Record this as a user-reported sensor-power check; exact metal-leg contact points/value were not supplied. Do not ask them to repeat generic rail measurements or assert the sensor is unpowered without new evidence.
- Remaining fault boundary is the **GPIO4-to-sensor-DQ connection or 1-Wire response**. Earlier row-11-to-row-21 continuity was reported intermittent, then “everything beeping”; stable actual MCU-pad-to-sensor-metal-leg resistance under gentle motion has not been documented. That single end-to-end check is more discriminating than another supply reading. If it is stable, a scoped diagnostic firmware image could distinguish no reset pulse from no sensor presence, but any upload requires a new direct “elephant.”

### End-to-end DQ resistance at 08:15 UTC

- With the board presumably unplugged for resistance mode (confirm before any further ohms test), the user measured **approximately 7 kΩ from the actual ESP32 GPIO4 metal pin to the actual DS18B20 middle/DQ metal pin**. A direct copper/jumper path should be near 0 Ω; ~7 kΩ is close to the installed nominal **6.8 kΩ DQ pull-up**. This is evidence that the expected direct DQ route is **not continuously intact at the measurement moment** or that contact/leg identification needs checking. It does **not** identify which specific segment or solder joint has failed. Do not reflash or replace the sensor based solely on this result.
- Isolate sequentially with USB unplugged, actual metal contacts, and ohms rather than just beep: (1) ESP32 GPIO4 pin to the gray wire's row-11 solder point; (2) row-11 data point to row-21 end of long brown jumper; (3) row-21 point to actual sensor middle leg. The first non-near-zero segment localizes repair. Ask for step 1 first to minimize physical work; avoid simultaneous rewiring.

### First DQ segment check at 19:58 UTC

- The user reports **ESP32 physical GPIO4 pin to row 11 is good**. No numeric resistance was given, so record this as user-reported continuity, not a quantified near-zero value. It narrows the previously observed ~7 kΩ end-to-end anomaly away from the gray MCU-to-row-11 segment.
- Next single unpowered ohms test: gray-wire solder point on **row 11** to the lower solder point of the **long brown jumper on row 21**. Keep meter tips fixed and gently move only the jumper. A sound direct link should stay near 0 Ω; intermittent/high resistance identifies this segment. If stable, proceed to row 21 → actual sensor middle metal leg.

### DQ bridge open measured at 20:14 UTC

- The user confirmed the unpowered row-11-to-row-21 measurement reads **18 MΩ** (megohms), not milliohms. With the previously reported good GPIO4-to-row-11 connection and ~7 kΩ GPIO4-to-actual-sensor-DQ reading, this establishes that the intended **row-11-to-row-21 direct DQ bridge is open at the tested solder points**. It is not a working direct jumper. The exact failed spot within this segment (upper joint, brown conductor, lower joint, or meter contact) remains unisolated, but the repair target is the segment, not firmware or Supabase.
- Keep USB unplugged. Reflow both ends of the **long brown row-11-to-row-21 jumper** or, given intermittent previous readings, replace this single jumper with a fresh insulated wire. Do not move the 6.8 kΩ pull-up or sensor power wires. Before repowering, measure row 11 to row 21 **near 0 Ω and stable while gently moving the wire**, and ensure no direct DQ-to-GND short; DQ-to-3V3 should be through the pull-up rather than a near-zero short. No repair or live post-repair reading has yet been reported.

### DQ bridge continuity restored at 20:20 UTC

- The user reports **0.3 Ω between row 11 and row 21**, down from 18 MΩ. This supports that the specific open DQ bridge is now electrically connected at the measurement moment. The user did not describe the physical repair or whether the reading stays stable with movement, so do not claim durable mechanical reliability yet.
- Before reconnecting USB, check **ESP32 physical GPIO4 pin to actual sensor middle/DQ metal leg** end-to-end; it should now be near 0 Ω rather than the earlier ~7 kΩ. Also ensure DQ is not directly shorted to GND after soldering. If good, reconnect without flashing, observe serial enumeration and genuine Supabase publication.

### After user's "works" and live recheck at 20:24 UTC

- In response to the request for end-to-end GPIO4-to-actual-sensor-DQ resistance and a DQ-to-GND short check, the user said **"works"**. Treat that as user-reported pass, but no numeric end-to-end resistance or explicit separate short result was supplied. The user connected the replacement board; **COM6** appeared.
- A read-only 80-second serial monitor captured **`[sensor] no DS18B20 on the bus; check DQ wiring and the 6.8k pull-up`**, with no temperature reading or HTTP POST line. Two fresh read-only SQL queries before and after the sampling window returned **zero rows** in `public.prototype_readings`. No firmware flash, code edit, or database write was performed. The issue is still at or before 1-Wire sensor enumeration, not demonstrated to be Supabase ingestion.
- If actual end-to-end DQ resistance and local sensor supply/GND are stable, the next discriminating step is **instrumented raw 1-Wire reset/presence logging on GPIO4** (and optionally a slow GPIO4 drive test to distinguish MCU pin from passive high pull-up). This needs a new diagnostic firmware build and a **fresh, direct “elephant” before any flash**. Avoid more generic rail probing, synthetic readings, or speculative hardware replacement. A sharp solder-side photo can also help verify the three physical sensor leg joints before flashing.

### Claude Code diagnosis and diagnostic build at 20:30–20:50 UTC (laptop)

- **Fresh external state (verified, read-only).** COM6 = Espressif
  `VID_303A:PID_1001`, MAC `28:84:85:6B:2C:58` (the replacement); COM3/COM4
  Bluetooth. A 75 s serial capture opened with DTR/RTS held low (no reset, no
  write) over ~20:34–20:36 UTC showed one sampling cycle with **`[sensor] no
  DS18B20 on the bus`** and suppressed 2,425 missing-queue-file log lines.
  REST GET at 20:35:31 UTC: `prototype_readings` HTTP 200, `Content-Range */0`,
  `[]`. `/prototype/22` on Vercel: HTTP 200, contains "Prototype 22" (its
  "no readings yet" text is client-rendered, so not in the raw HTML).
- **The three fleet rows are manual test inserts**, not device data:
  identical `received_at`, round `recorded_at`, no RSSI/reset reason. So
  there is no record of this firmware ever reading a real DS18B20; that
  cannot be used to clear the firmware.
- **Static firmware/library facts (verified in source).** `ONEWIRE_PIN=4`,
  OneWire 2.3.8, DallasTemperature 3.11.0, Arduino-ESP32 2.0.17. OneWire's
  ESP32 path uses GPIO register writes (GPIO4 < 32; the >GPIO33 output
  restriction does not apply). Key behaviour: `OneWire::reset()` first waits
  up to 250 us for the line to read HIGH and **returns 0 without driving it**
  if it never does. So a DQ net held LOW (pull-down or short to GND) gives
  exactly "no DS18B20" regardless of sensor health; a line pulled HIGH but
  with no answering sensor gives the same message. The serial message alone
  cannot separate these. No firmware defect was found.
- **Photo review (hypotheses only, not findings).** Only component-side photos
  of the replacement exist (`E057887C…/1-Photo-1.jpg`, `2-Photo-2.jpg`,
  taken ~06:45 UTC, before later repairs). Rails: inner ⊕ = 3V3, outer ⊖ =
  GND (silkscreen confirms the earlier assignment). Right-half row nets:
  row 11 = DQ (gray wire from GPIO4, top of brown bridge, 6.8 kΩ at J11),
  row 20 → ⊖, row 21 = bottom of brown bridge, row 22 → ⊕. One sensor lead
  visibly enters F20; the body hides the other two. The resistor is a
  5-band blue-gray-black-brown-brown (6.80 kΩ 1%). **Its far lead lands at
  rail row 9, but one zoom looks like the ⊖ (GND) hole and another shows the
  ⊕ hole solder-filled; not resolvable from these photos.** If it is on ⊖,
  it is a pull-*down*, which would by itself explain every failed scan.
- **Clue from earlier measurements.** With correct wiring, the 08:15 UTC
  reading of ~7 kΩ from GPIO4 to the sensor's "middle leg" while the
  row 11–21 bridge was open (18 MΩ at 20:14) should be impossible: F21
  would be isolated. ~7 kΩ means the touched leg shared a node with the
  resistor's far (rail) end. Either a different leg was touched (F20 GND
  leg if the resistor is on ⊖, F22 VDD leg if on ⊕), or the middle leg
  sits on a rail net. Unresolved.
- **New diagnostic firmware — built, NOT flashed.** New PlatformIO env
  `prototype-22-diag` (extends `prototype-22`, adds `-DONEWIRE_DIAG`, pins
  OneWire 2.3.8 / DallasTemperature 3.11.0 / WiFiManager 2.0.17 /
  ArduinoJson 7.4.3). New files `include/onewire_diag.h` and
  `src/onewire_diag.cpp` (whole file inside `#ifdef ONEWIRE_DIAG`);
  `main.cpp` gains one guarded include and one guarded call at the end of
  `initSensor()`. The call runs once at boot and on every failed re-scan
  (each 60 s). It prints `[1wire-diag]` lines covering: digital level
  with no pull / internal pull-up / internal pull-down; ADC mV for the same
  three cases (rough kΩ estimate); whether the pad reads LOW while driven
  LOW; a timed reset (idle-high check, rise time, presence start/width,
  level at the library's 70 us sample); the unmodified library's `reset()`
  and ROM search (with CRC and family); and a one-line VERDICT. Identity,
  Wi-Fi, endpoint, queue paths, sampling cadence and posting are unchanged.
  Candidate image: `.pio/build/prototype-22-diag/firmware.bin`, 994,784 B,
  built 20:47:34 UTC, SHA-256
  `C65868FF2C393677970398615329D3E8BABF7EE678E159F3214EACEAED24727E`.
  The build is **not bit-reproducible**: WiFiManager embeds `__DATE__
  __TIME__` and the image embeds the ELF SHA-256. Re-hash at flash time.
- **Fleet and plain prototype images verified unaffected.** Reverting the
  sources and rebuilding, then diffing against builds with the new sources,
  showed `esp32-s3` and `prototype-22` images differing **only** in the
  WiFiManager compile-time string, the app-descriptor ELF SHA and the
  trailing checksum/digest. Code/data are otherwise byte-identical. A
  string scan (presence only, no secret printed) confirmed the diag image
  carries the prototype REST path, OTA name, queue path and Wi-Fi
  credential; neither other image contains `[1wire-diag]`; the fleet image
  still lacks all prototype strings. Note: the earlier "fresh build" hash
  `F181C6…` reproduced only because PlatformIO reused cached objects.
- **Nothing flashed, no hardware changed, no database or Vercel writes.**
  The user's 20:30 prompt explicitly withheld flash authorization.
- **Next discriminating step (either one):** (a) with a new direct
  "elephant", upload `-e prototype-22-diag` to COM6 and read one
  `[1wire-diag]` block (no physical work); or (b) one powered DC reading,
  black on the ESP32 pad labelled **GND**, red on the pad labelled **4**:
  ≈3.2–3.3 V = DQ pulled up (fault at the sensor end, or a DQ–3V3 short);
  ≈0 V = DQ pulled to ground (likely 6.8 kΩ on ⊖, or a DQ–GND short);
  0.3–3.0 V = something loading the line (e.g. a reversed sensor).

### Diagnostic flash and live result at 20:57–21:03 UTC on 2026-09-24 (laptop)

- The user gave a fresh direct “elephant” in Codex for this diagnostic flash.
  Before upload, COM6 was identified as ESP32-S3 (`VID_303A:PID_1001`) and
  `esptool read_mac` returned `28:84:85:6B:2C:58`, the replacement board,
  not the retired board. The diagnostic image was 994,784 bytes with SHA-256
  `C65868FF2C393677970398615329D3E8BABF7EE678E159F3214EACEAED24727E`.
- `python -m platformio run -e prototype-22-diag -t upload --upload-port COM6`
  succeeded; the bootloader, partition table, and application were written
  with verified hashes. No full-chip erase or LittleFS upload was done. The
  direct flash authorization was consumed by this upload. This confirms the
  diagnostic image is on the replacement board, **not** that the sensor works.
- Live COM6 serial on diagnostic run 4, uptime 125 s, reported:

  ```text
  [sensor] no DS18B20 on the bus; check DQ wiring and the 6.8k pull-up
  [1wire-diag] HIGH reads of 8: no-pull 0, int-pullup 8, int-pulldown 0
  [1wire-diag] ADC mV: no-pull 3 , int-pullup >=3160 , int-pulldown 0 (eFuse-calibrated)
  [1wire-diag] bus never read HIGH within 250 us before reset: library reset() returns 0 here without ever driving the line
  [1wire-diag] library reset()=0, ROM search found 0
  [1wire-diag] VERDICT: no external pull visible: the line only follows the ESP32's own weak pulls -> GPIO pad not connected to a pulled-up DQ net
  ```

- Interpretation: GPIO4 responds to its internal pulls but sees no effective
  external 3V3 pull-up. The OneWire library therefore cannot even begin a
  reset/presence transaction; the failure is upstream of sensor conversion,
  networking, and database ingest. This does **not** yet prove whether the
  open is at the GPIO4 solder joint, the row-11-to-row-21 jumper, the resistor
  or its 3V3 connection, or the sensor DQ joint. The ADC diagnostic is an
  indication at the GPIO pad, not a substitute for actual end-to-end meter
  contact on the component leads.
- Read-only Supabase query at 21:02 UTC returned zero rows in
  `public.prototype_readings`. No test row was fabricated or inserted.
- Next physical check, with USB **unplugged**: meter in ohms/continuity, probe
  the **actual ESP32 metal pad labeled 4** and the **actual DQ metal leg of
  the DS18B20** (middle leg of the TO-92 package when facing its flat side).
  Expected near 0 ohms, stable when the board is gently moved; a 7 kΩ or
  megohm reading is not a valid direct DQ connection. Then measure from the
  actual GPIO4 pad to the actual 3V3 metal pad: approximately 6.8 kΩ should
  appear through the external pull-up. If DQ continuity is near zero but this
  pull-up path is open, inspect the resistor and its 3V3 joint. Do not flash
  again unless the user gives a **new direct** trigger.

### User's unpowered meter results at 21:05–21:06 UTC on 2026-09-24

- Following the two requested measurements with USB unplugged, the user
  reported **4.7 Ω** from the ESP32 GPIO4 pad to the DS18B20 DQ leg and
  **6.74 kΩ** from GPIO4 to the ESP32 3V3 pad. The first is consistent with
  DQ continuity (including meter contact/lead resistance); the second with
  a nominal 6.8 kΩ pull-up path in the unpowered state. Neither establishes
  voltage on the powered 3V3 rail or excludes an intermittent joint.
- Fresh port enumeration found no Espressif COM6 device; only COM3/COM4
  appeared. This is consistent with the board being unplugged for the ohms
  checks. No flash or database write was done in this follow-up.
- The **powered** diagnostic had read GPIO4 near zero without internal pull,
  so do not call the hardware fixed based on unpowered resistance alone. Next,
  after reconnecting USB, use DC volts with black probe held on the actual
  ESP32 GND pad: red on the ESP32 3V3 pad, then red on the ESP32 GPIO4 pad.
  Report both values. Avoid touching adjacent pads together. A fresh serial
  diagnostic read can then be compared without another flash.

### User's powered measurements at 21:08 UTC on 2026-09-24

- With the same ESP32 GND reference requested in the prior section, the user
  reported **3.28 V at the ESP32 3V3 pad and 3.28 V at GPIO4**. Thus the DQ
  pad is idle-high at the moment of these meter readings. This differs from
  the earlier serial diagnostic (near 0 V/no external pull); possible
  time-dependent wiring/contact or measurement-state effects are unproven.
  Do not pronounce the 1-Wire path repaired without a fresh sensor ROM scan.
- Fresh serial-port enumeration on this laptop still showed only COM3/COM4,
  not COM6, so no new diagnostic block could be read here. The device may be
  powered by another USB source, but that is not confirmed. Fresh read-only
  Supabase SQL returned **zero** `public.prototype_readings` rows. No flash,
  database write, or firmware change occurred.
- Next: connect the board to this laptop's USB data port (without disturbing
  the sensor wiring) so the already-flashed diagnostic image can be read on
  its newly observed COM port. Compare idle-high/reset/presence/ROM results.

### Fresh laptop serial check at 21:10–21:11 UTC on 2026-09-24

- COM6 reappeared as Espressif `VID_303A:PID_1001`. A 75-second read-only
  serial monitor of the already-flashed diagnostic image captured run 3 at
  uptime 66 seconds. It again reported no DS18B20, no-pull 0/8 HIGH reads,
  internal pull-up 8/8 HIGH, internal pull-down 0/8 HIGH; ADC no-pull **1 mV**,
  internal pull-up **>=3160 mV**, internal pull-down **0 mV**. The bus did not
  reach HIGH before reset; library `reset()` returned 0 and ROM search found
  0 devices. No reading/POST was captured. No flash was performed.
- This directly conflicts with the user's earlier 3.28 V meter reading on
  GPIO4. A time-dependent contact, different physical touch point, or the
  diagnostic's pin-mode interaction are possible but **not established**.
  The next discriminating test is a meter voltage on the exact GPIO4 metal
  solder joint **while the already-flashed serial diagnostic is running**,
  using the ESP32 GND pad as common reference. Do not resolder or replace
  parts based on the discrepancy alone.

### Same-pad live voltage at 21:12–21:13 UTC on 2026-09-24

- With COM6 reconnected, the user repeated the powered DC check at the exact
  ESP32 metal GPIO4 pad (black probe on ESP32 GND) and reported **70 mV**.
  This agrees with the fresh serial diagnostic's near-zero no-pull value.
  The previous 3.28 V reading was not stable across tests; it may reflect a
  changed contact/board state, but the cause is not yet established.
- The unpowered GPIO4→3V3 path had measured 6.74 kΩ. To determine whether
  that nominal pull-up has a live supply at its **resistor end** in the
  failing state, next check the voltage at the physical resistor lead on the
  3V3-rail side, referenced to the ESP32 GND pad, without disturbing the
  wiring. Avoid bridging nearby joints with the meter tip. If it is near
  zero, investigate its supply path; if it is near 3.3 V, investigate the
  resistor/DQ/sensor loading or intermittent contact. No fix is established.

### Intermittent DQ voltage and two more scans at 21:13–21:15 UTC

- The user immediately corrected the same GPIO4 meter reading from **70 mV**
  to **3.3 V**. The voltage was therefore not stable at that point; the exact
  cause (contact, measurement placement, loading, or other) is unknown.
- A new 75-second COM6 monitor captured diagnostic runs 6 and 7 at uptime
  246 s and 306 s. Both still reported **no DS18B20**, 0/8 digital HIGH
  reads with no pull, 8/8 with internal pull-up, 0/8 with internal pull-down;
  ADC no-pull was **300 mV** then **180 mV**; library reset=0, ROM search=0.
  Neither scan saw an idle-high bus. No genuine reading/POST was observed.
- The GPIO4/DQ node may briefly rise, but has not stayed high through a
  sensor scan. Next isolate the pull-up supply with one powered DC reading at
  the **3V3-side physical lead of the blue 6.8 kΩ resistor**, black probe on
  ESP32 GND, while avoiding adjacent solder contacts. Do not declare the
  sensor working, resolder, or replace parts based on a momentary 3.3 V.
  No flash or database write was done.

### Pull-up supply-side voltage at 21:16 UTC

- With the board powered, the user measured **3.3 V at the 3V3-side lead of
  the blue 6.8 kΩ pull-up resistor**, referenced to the ESP32 GND pad as
  requested. This establishes a powered supply at that physical resistor
  lead at the measurement moment; it does not establish voltage at the
  resistor's DQ-side lead or a sustained idle-high bus.
- Next single check: leave the black meter lead on ESP32 GND, put red on the
  **opposite metal lead of that same resistor** (the DQ side, toward the
  perfboard center) with DC volts selected. Avoid shorting the two ends with
  the meter tip. Compare its reading with the supply-side 3.3 V, and if it
  varies, report the range. No firmware or database change is warranted yet.

### Pull-up DQ-side voltage and subsequent scan at 21:17–21:18 UTC

- The user measured **3.288 V at the DQ-side metal lead of the same blue
  6.8 kΩ resistor** with the board powered. Its 3V3-side lead had read 3.3 V
  shortly before. This does not prove a persistent high voltage at the MCU's
  internal GPIO4 input: the physical points/times differ.
- A subsequent read-only COM6 serial monitor reported no sensor, GPIO4
  digital no-pull 0/8 HIGH, ADC no-pull **3 mV**, internal pull-up >=3160 mV,
  library reset=0, ROM search=0. The board's uptime was **70 seconds** at
  run 3, whereas a prior run 7 had uptime 306 seconds; a reset/restart
  occurred between them. Cause of that restart was not established. Do not
  interpret the resistor-end and GPIO4 diagnostics as simultaneous.
- Next controlled test: with USB continuously connected and the same black
  meter reference on ESP32 GND, measure DC volts in quick succession at the
  resistor's DQ-side metal lead and the actual ESP32 GPIO4 metal pad, and
  report both plus whether moving the probe/board changes either reading.
  This tests the physical path between those points in one board state.
  No flash or database write was made.

### Desktop handoff — device left powered, no meter available (21:20 UTC)

- The user says Prototype 22 will remain plugged into the **desktop at home**
  and that desktop Codex/Claude Code can be used remotely. A multimeter will
  **not** be available there. This is a plan/physical-state report from the
  user; this laptop has not verified the desktop COM port or subsequent probe
  state. Do not continue requesting meter checks until one is available.
- The diagnostic firmware is **already flashed** on replacement MCU MAC
  `28:84:85:6B:2C:58`. On the desktop, first wait for OneDrive sync, read
  this file, identify the actual Espressif serial port and board MAC, and
  monitor 115200-baud serial for at least two one-minute sample/diagnostic
  cycles. Capture `[sensor]`, `[1wire-diag]`, `[reading]`, and HTTP/post lines,
  noting timestamp, uptime, restart events, and diagnostic run number. A
  serial read requires **no flash**. If a valid reading appears, verify a
  genuine matching row in `public.prototype_readings` and then the web page.
  If the bus stays low/no-pull and ROM search remains zero, the unresolved
  physical GPIO4-to-pull-up/sensor path cannot be localized confidently
  without new physical evidence; do not claim a software or Supabase fix.
- The earlier requested same-state resistor-DQ-lead versus GPIO4-pad meter
  comparison was **not performed** before the user left the device at home.
  Prior readings were taken at different moments: resistor 3V3 side 3.3 V,
  resistor DQ side 3.288 V, GPIO4 alternately 70 mV and 3.3 V, while serial
  scans often saw 3–300 mV at GPIO4. Do not treat these as simultaneous
  proof of an open, short, or healthy bus.
- **No new flash is authorized.** A fresh direct user “elephant” in the
  desktop task is required before any future upload, including a rollback.
  Do not erase NVS/LittleFS, guess a COM port, or use the fleet environment.

### Remote-state check at 00:29 UTC on 2026-09-25

- The user clarified the board is **still plugged in at home**. From this
  laptop, serial-port enumeration shows only Bluetooth COM3/COM4; the desktop
  USB serial device is not accessible locally. The board's powered state and
  diagnostic output have not been independently observed since it moved.
- A fresh read-only Supabase query of `public.prototype_readings` returned
  **zero rows**. Leaving the board powered has not yet produced an observed
  Prototype 22 temperature upload. Do not infer why from database absence
  alone; the last local serial scans had failed before sensor enumeration.
- Desktop next step remains: read the existing 115200-baud diagnostic output
  on the **observed** ESP32 port, without flashing, then correlate any valid
  temperature/HTTP post with a real Supabase row. No meter is available at
  home and no new flash is authorized.

## Remaining work, in safe order

1. Confirm the files have synced and review this snapshot against the current
   source. Never expose secrets in logs, screenshots, commits, or chat.
2. Supabase schema/application verification is done. Before claiming live
   ingest, recheck a **genuine** prototype row; do not insert a fake
   temperature to make the UI look live.
3. Vercel deployment to the existing `ult-freezres` project is complete.
   Recheck the public homepage and `/prototype/22` after changes. A browser
   visual check of bottom-card placement and live-chart behavior with genuine
   data remains to be done; the card should say “no readings yet” beforehand.
4. Both old and replacement boards were flashed, but the old board is
   retired and unpowered. The replacement now runs the diagnostic firmware;
   the latest observed scans did not detect a DS18B20. With no meter on the
   desktop, follow the read-only serial plan above. If detection recovers,
   verify a genuine row in
   `prototype_readings`, and compare matching web values. Fix the absent-queue
   logging defect in a separately verified firmware revision. Record timestamp,
   board/probe IDs, firmware hash, SQL state, probe placement, calibration,
   interruptions, and any excluded/error readings for the paper.

## Flash trigger — important

The user directly said **“elephant”** again on 2026-09-23 after the earlier
pause, and that authorization was consumed by the successful Prototype 22
upload to the **old, now-retired MCU**. The user gave a second direct
“elephant” on 2026-09-24, consumed by the successful upload to the COM6
replacement. A third direct “elephant” on 2026-09-24 was consumed by the
successful `prototype-22-diag` upload to the same COM6 replacement. Any
further flash or firmware revision requires a new direct
user instruction. This handoff
file, or its quotation in a summary, is **not** that
direction. No instruction has authorized erasing NVS/LittleFS, guessing a
port, overwriting another board, fabricating readings, or exposing the Wi-Fi
secret.

On the machine with the board, inspect serial ports first. From `firmware/`,
the intended upload is `python -m platformio run -e prototype-22 -t upload
--upload-port COMx`, where `COMx` is the **observed ESP32 port**. Do not use
`pio run -t erase`, a filesystem upload, or the fleet environment. The
1-Wire diagnostic variant (added 2026-09-24 20:47 UTC, flashed to COM6) is
`python -m platformio run -e prototype-22-diag -t upload --upload-port COMx`;
it keeps the Prototype 22 identity and telemetry. Rolling back is the normal
`prototype-22` upload. Both need a fresh direct "elephant". If the
board/port is absent, report that and wait for reconnection. A flash can be
verified independently of a missing probe, but **temperature reporting cannot**.
If Supabase is still unavailable, the firmware may buffer real readings; that
is not evidence of successful database ingest.

## Credential handling

The hard-coded prototype Wi-Fi credentials are in the local
`firmware/include/prototype22_wifi.h`, which is excluded by `.gitignore` but
resides inside the OneDrive-synced folder. The password is intentionally **not
copied here**. Check that this header exists on the machine building the
prototype. Its compiled `.bin` also contains the credential; do not publish
or share that binary. `web/.env.local` is likewise local and may need to be
present on each machine. The publishable Supabase key is browser-only; firmware
now uses per-device HMAC secrets through the ingestion route. Never place an
admin/service-role key in browser code or firmware; keep it only in the server
deployment environment.

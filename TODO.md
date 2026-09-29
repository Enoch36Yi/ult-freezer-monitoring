# TODO: single consolidated list

Derived 2026-09-28 from `9-24-QA_Check.md` (full checklist and rationale),
`METHODOLOGY_AND_DOCUMENTATION_NEEDED.md` (B01-B14), and `updates.md` (live
state). When this list and those disagree, the source documents and fresh
external checks win. Update this file whenever an item closes, with the evidence
location. `[x]` means evidence exists; nothing is ticked on "probably".

Standing rules: no flash without a fresh direct "elephant" in chat; no fake
readings; no builds/installs inside OneDrive; never write secrets into files or
chat; the study stays at 21 freezers and Prototype 22 stays outside it.

## Now: Prototype 22 bench day

Runbook: [docs/BENCH_DAY_RUNBOOK.md](docs/BENCH_DAY_RUNBOOK.md) · Form:
[docs/PROTOTYPE_22_ACCEPTANCE.md](docs/PROTOTYPE_22_ACCEPTANCE.md)

- [x] Bench tooling verified on this laptop (2026-09-29): prepare pipeline builds
      both images from a clean stage; `bench-preflight.ps1`, `prototype-check.ps1`
      (no-Node checker), and `supabase/verify.ps1` run under PowerShell 5.1
- [ ] Run `scripts/prepare-bench-day.ps1` with the **bench network** (tonight)
- [ ] `scripts/bench-preflight.ps1` shows no FAIL and "header differs"
- [ ] Electrical diagnosis and repair (owner: user)
- [ ] Identify board, COM port, MAC; record in the acceptance form
- [ ] Flash on a fresh direct "elephant"
- [ ] Serial capture, at least 2 cycles; probe ROM found
- [ ] Genuine `prototype_readings` row matches serial; card and `/prototype/22` agree
- [ ] Log results in `updates.md`
- [ ] Rotate the Wi-Fi password exposed 2026-09-26

## Stop-ship (before building more hardware)

- [ ] S1 ULT probe: DS18B20 is rated to -55 C, freezers run -70 to -80 C. Pick a
      rated probe + reference calibration, or sign a limitation (B09)
- [ ] S2 Energy metering: choose subset vs all 21, meter model, Facilities approval (B11)
- [ ] S3 Signed 21-freezer inventory, device registry, two-person label check (B01, B03)
- [ ] S4 Data integrity: replay-safe observation ID / dedup key, clock-invalid flag,
      TLS validation (currently `setInsecure()`), OTA authentication decision,
      migration ledger, backup + restore test (B13)
- [ ] S5 Reproducibility: put the project under Git or a dated snapshot process
      with firmware hash manifest

## Phase A: three pilot fleet nodes (2 from IDs 1-6, 1 from IDs 7-21)

- [ ] Firmware hardening: strict ID parse tests; queue truncation / partial-line /
      power-loss tests; verify offline retention at both cadences (B06, B07).
      Boot-time recovery of an orphaned queue temp file was added 2026-09-29
      (compiles for all images; not yet observed on a board)
- [ ] Install a host C++ compiler (or run on the desktop) so `pio test -e native`
      can run again; Node LTS if the JS tests are to run on this laptop
- [ ] Final BOM, USB supply, enclosure fit test (CAD in `cad_enclosure/`), probe routing
- [ ] Build 3 nodes; each: ROM enumerates over 10 restarts, reference comparison,
      serial -> Supabase -> dashboard match, 24-72 h run, induced Wi-Fi outage and
      power cut, no duplicates, correct Live/Stale/Offline
- [ ] Freeze hardware + firmware hash before scaling

## Phase B-C: fleet and comparison tiers

- [ ] Order 21 + spares; serialized build travelers; 21-node QA and burn-in
- [ ] Install with placement SOP + photos (B08); 72 h fleet completeness report
      (`scripts/audit-readings.mjs`)
- [ ] TRAXX/KLATU: purchase, access, mapping, ingestion (B02-B05)
- [ ] iMonnit (2 sensors): access, mapping, ingestion
- [ ] Energy meters installed and mapped; separate energy tables

## Phase D-I: study

- [ ] Close B01-B14, freeze data dictionary / exclusions / analysis plan, then
      record per-freezer baseline start (UTC)
- [ ] 28-day baseline -> maintenance -> 24 h stabilization -> 28-day post
- [ ] Data freeze, analysis, independent reproduction
- [ ] CSF report, IEEE PES paper (confirm venue/deadline), archived dataset,
      hardware package, handoff owners
- [ ] Resolve Dropbox governance inconsistency (divergence package blank/unsigned)

## Housekeeping

- [x] `typecheck` script added to `web/package.json` (2026-09-28)
- [x] README "Outstanding" section and fleet-row note reconciled (2026-09-28)
- [x] Prototype plan checkboxes and Prototype 22 history labeling updated (2026-09-28)
- [x] Laptop compatibility fixes (2026-09-29): staging moved off `%LOCALAPPDATA%`
      (invisible to Store Python); `verify.ps1` fixed for PowerShell 5.1;
      `check-local.ps1` Latin-1 fix; docs no longer call the absent `pwsh`
- [ ] Add a Prototype 22 check to `supabase/verify.ps1` (the preflight and
      `prototype-check.ps1` cover it for now)
- [ ] Apply `supabase/migrations` ordering ledger to the direct-SQL changes
- [ ] Add a Prototype 22 entry to `supabase/OPERATIONS.md` (currently fleet-only)
- [ ] Consider excluding `firmware/.pio` and `web/node_modules` from OneDrive sync
      (about 38k files, and the source of the 2026-09-26 deletion prompt); do not
      delete them without checking sync state
- [ ] Decide whether stale fleet test rows (3 manual inserts on freezer 1) are
      removed by SQL editor; needs explicit authorization (anon cannot delete)

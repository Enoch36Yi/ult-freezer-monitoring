# ULT Freezer Project — Comprehensive QA and Execution Checklist

**Report file requested:** `9-24-QA_Check.md`  
**Audit performed:** 2026-09-25/26  
**Scope reviewed:** local firmware, dashboard, Supabase SQL/operations, enclosure, study methodology, handoff log, and the read-only Dropbox project scope.  
**Dropbox handling:** view-only. No Dropbox file was edited, moved, renamed, or deleted.  
**Hardware safety:** no firmware was flashed and no device state was changed during this audit. A new direct user `elephant` instruction is required before any future flash.

## Executive answer: what happens next

The project should proceed through these gates, in this order:

1. Close the design and study blockers that would make data unusable.
2. Finish **three successful production-representative ESP32 nodes**.
3. Run those three continuously for **24–72 hours** and pass end-to-end acceptance.
4. Freeze the hardware revision, firmware hash, commissioning procedure, database schema, and documentation.
5. Build and commission the remaining **18 nodes**, for 21 study freezers total.
6. Commission TRAXX/KLATU, iMonnit, and direct energy meters on the approved comparison subset.
7. Close every baseline blocker and formally start the **28-day pre-maintenance baseline**.
8. Perform and timestamp preventive maintenance without changing undocumented variables.
9. Collect the **28-day post-maintenance period** after stabilization.
10. Freeze and analyze the dataset, quantify uncertainty, compare monitoring tiers, and produce the CSF report, archived dataset, and technical paper.

Do not start the 28-day baseline simply because three or 21 ESP32 boxes are online. Baseline begins only after identity, calibration/limitations, energy measurement, placement, vendor coverage, backups, logs, and the analysis rules are locked.

## Current evidence snapshot

### Automated verification run in this audit

- [x] Fleet firmware build: `pio run -e esp32-s3` passed.
- [x] Fleet image size: 1,071,717 bytes, 81.8% of the configured application partition; RAM 50,732 bytes, 15.5%.
- [x] Prototype 22 firmware build: `pio run -e prototype-22` passed.
- [x] Prototype image size: 982,049 bytes, 74.9%; RAM 50,444 bytes, 15.4%.
- [x] Native firmware tests passed: 6/6 across sampling policy and queue-presence behavior.
- [x] Web unit tests passed: 9/9.
- [x] Next.js production build passed and prerendered the homepage, Prototype 22, and all 21 freezer routes.
- [x] TypeScript validation passed as part of `next build`.
- [ ] `npm run typecheck` is not a valid command because no `typecheck` script exists. This is a tooling/documentation gap, not a TypeScript failure.

### Important current state

- [x] The intended fleet is exactly **21 study freezers**.
- [x] IDs 1–6 use a one-minute cadence; IDs 7–21 use a fifteen-minute cadence.
- [x] Prototype 22 is isolated from fleet tables and counts.
- [x] The web application has been deployed to the existing Vercel project according to the later handoff record; older README text saying it is undeployed is stale.
- [x] Prototype 22 SQL was applied and its isolated table/RPC exist according to the handoff record.
- [ ] No genuine Prototype 22 temperature row has been verified.
- [ ] The replacement Prototype 22 hardware has repeatedly failed to enumerate its DS18B20.
- [ ] No production fleet node has yet passed the full sensor → timestamp → HTTPS → database → dashboard acceptance chain in the current evidence.
- [ ] The authoritative, signed 21-freezer inventory and device mapping are still open.
- [ ] TRAXX/KLATU has not been purchased/commissioned in the available record.
- [ ] Only two iMonnit low-temperature sensors are documented as available; live access, channel identity, cadence, and ingestion are open.
- [ ] Direct electrical energy metering—the measurement needed to support energy-savings claims—is not yet commissioned.
- [ ] This folder is not under Git, leaving a reproducibility and rollback gap.

## Stop-ship issues to resolve before scaling hardware

### 1. Sensor suitability at ULT temperatures — critical scientific risk

The usual DS18B20 specified range ends at approximately **−55 °C**, while these freezers operate near −70 to −80 °C. A waterproof assembly containing a DS18B20 does not become valid at −80 °C merely because it returns a number.

- [ ] Identify the exact sensor/probe manufacturer, model, sensing element, cable, and datasheet.
- [ ] Confirm the purchased part's specified operating range.
- [ ] Compare it at the intended ULT range against a traceable reference.
- [ ] Preserve raw calibration/verification data and stabilization duration.
- [ ] If it cannot be validated at ULT temperatures, obtain a suitable sensor or sign a formal limitation restricting the in-house system to exploratory/repeatability claims.
- [ ] Update `sensor_tier`, firmware conversion logic, wiring, BOM, and methodology if the final element is not actually DS18B20.

**Gate:** do not manufacture 21 identical nodes around an unverified sensing element.

### 2. Energy measurement — critical scope risk

Temperature monitoring cannot by itself prove electrical energy savings.

- [ ] Decide whether all 21 freezers or only a 3–5 freezer subset receives direct energy meters.
- [ ] Select meter make/model, accuracy class, interval, export/API method, and safe installation method.
- [ ] Obtain Facilities/electrical approval.
- [ ] Map each monitored meter/circuit to exactly one freezer for a time-bounded interval.
- [ ] Design separate `energy_devices`, `energy_observations`, and mapping records; do not add watts/kWh to temperature rows.
- [ ] Capture interval energy, demand/power, cumulative value, units, source time, received time, quality, and deduplication identity.
- [ ] Define counter-reset, gap, and completeness handling.
- [ ] If only a subset is metered, label results as subset measurements and fleet estimates as extrapolations with uncertainty.

### 3. Identity and inventory — deployment blocker

- [ ] Obtain a signed/dated authoritative list of all 21 freezer assets and physical labels.
- [ ] Record room, location, make, model, serial/asset number, setpoint, age, and operational owner.
- [ ] Assign study IDs 1–21 only against this inventory.
- [ ] Record which units form the six-freezer comparison core.
- [ ] Create a time-bounded device registry for ESP32 MAC/serial, firmware hash, probe serial, enclosure serial, USB supply, TRAXX channel, iMonnit channel, and energy meter.
- [ ] Require two-person verification of physical label ↔ dashboard label during commissioning.
- [ ] Never overwrite historical mappings when a device moves or is replaced.

### 4. Data integrity and security — production blocker

The current publishable-key model permits anonymous inserts meeting broad table checks. It does not authenticate individual devices. Offline records also need replay-safe identity.

- [ ] Choose and document the accepted threat model for a research pilot.
- [ ] Define a stable observation ID/deduplication key before fleet rollout.
- [ ] Store measurement time separately from database receipt time.
- [ ] Flag unsynchronized clocks rather than silently treating receipt time as measurement time.
- [ ] Separate device-health events from valid temperature observations.
- [ ] Test allowed insert/select and denied update/delete behavior in an isolated or rolled-back test context.
- [ ] Review grants, constraints, function security, dependencies, and Supabase security/performance advisors.
- [ ] Reconcile direct live SQL changes with an ordered migration ledger.
- [ ] Establish raw exports, checksums, retention, access ownership, and a successful restore test.
- [ ] Keep credentials out of Markdown, screenshots, binaries shared outside the team, and source history.
- [ ] Decide whether OTA must be authenticated/disabled on the production network; do not rely on network obscurity.
- [ ] Replace `setInsecure()` TLS behavior with an approved certificate-validation strategy before treating transport integrity as production-grade, or document and accept the limitation explicitly.

### 5. Reproducibility — publication blocker

- [ ] Put the project under Git or create an equivalent immutable snapshot process.
- [ ] For every deployed revision, retain source tree, dependency locks, schema/migration list, firmware binary, firmware SHA-256, build logs, and configuration manifest.
- [ ] Tag/freeze the three-node pilot revision before the 18-node build.
- [ ] Create a deployment manifest mapping every physical node to the exact firmware hash.
- [ ] Create data-freeze identifiers with UTC timestamp, coverage interval, counts, exclusions, and hashes.

## Phase A — finish three successful prototypes

These should be three **production-representative fleet nodes**, not three copies of the isolated Prototype 22 identity. To exercise both policies, select two mapped freezers from IDs 1–6 and one mapped freezer from IDs 7–21. The exact freezer IDs must come from the authoritative inventory, not convenience.

### A1. Freeze the pilot hardware revision

- [ ] Resolve the current Prototype 22 1-Wire fault using read-only serial/electrical diagnosis first.
- [ ] Do not flash until a new direct `elephant` instruction is received.
- [ ] Confirm exact ESP32-S3 board variant and flash size.
- [ ] Confirm GPIO4, external power mode, ground, VDD, DQ, pull-up value, cable length, and connector pinout.
- [ ] Confirm the pull-up value works across the selected cable and ULT environment; the current 6.8 kΩ choice requires validation.
- [ ] Select a listed, appropriately rated USB supply and cable.
- [ ] Confirm the MCU, supply, and mains connection remain outside the freezer.
- [ ] Confirm probe routing uses an approved access route and never pinches the door gasket.
- [ ] Produce a final BOM with part numbers, suppliers, quantities, unit cost, alternates, and lead times.
- [ ] Print and fit-test the enclosure and cable strain relief.
- [ ] Verify ventilation/condensation strategy and that magnet/mounting choices do not create a safety or access problem.
- [ ] Record enclosure revision and print settings.

### A2. Harden the pilot firmware and test coverage

- [ ] Add an explicit `typecheck` script to the web package or correct documentation to use `npx tsc --noEmit`/the production build.
- [ ] Add host tests for strict freezer-ID parsing and invalid IDs.
- [ ] Add tests for queue truncation, malformed/partial lines, failed batch retry, and power-loss recovery.
- [ ] Remove the queue remove-then-rename power-loss window or document/accept the potential data loss.
- [ ] Verify maximum offline retention experimentally at one-minute and fifteen-minute cadences.
- [ ] Verify a full queue drains without starving sampling or OTA.
- [ ] Verify reset-reason handling survives queueing and retransmission.
- [ ] Verify behavior when NTP is unavailable at boot and later recovers.
- [ ] Verify duplicate/replayed buffered observations cannot create duplicate study records.
- [ ] Verify probe disconnect, 85 °C power-on default, −127 °C sentinel, brownout, Wi-Fi loss, API 4xx/5xx, and full filesystem behavior.
- [ ] Verify OTA authentication policy and rollback/recovery procedure.
- [ ] Keep fleet and Prototype 22 credentials/endpoints isolated in compiled artifacts.

### A3. Build each of the three pilot nodes

For each node:

- [ ] Inspect solder joints and continuity unpowered.
- [ ] Verify 3.3 V rail and DQ idle behavior powered.
- [ ] Enumerate and record the probe ROM/serial number.
- [ ] Record ESP32 MAC, USB serial/COM port, enclosure ID, probe ID, USB supply ID, and intended freezer ID.
- [ ] Load the approved fleet image only after fresh flash authorization.
- [ ] Provision Wi-Fi and the assigned freezer ID.
- [ ] Confirm the serial log reports the correct ID and cadence.
- [ ] Confirm NTP synchronization and UTC timestamp plausibility.
- [ ] Confirm a real temperature reading; never use a fake value to make the dashboard look live.
- [ ] Label hardware before disconnecting it.
- [ ] Photograph wiring, enclosure, label, probe placement, and installation.

### A4. Definition of “successful prototype”

Each of the three nodes must independently satisfy every item:

- [ ] Probe enumerates reliably across at least 10 cold and warm restarts.
- [ ] Sensor readings are physically plausible and compared against a reference.
- [ ] Correct freezer ID and cadence are observed: one minute for selected core units, fifteen minutes for selected fleet unit.
- [ ] At least two consecutive normal observations match serial → Supabase → dashboard values and timestamps.
- [ ] 24–72 hours of continuous operation completes with expected counts.
- [ ] Missingness, reporting delay, RSSI, resets, and invalid readings are summarized.
- [ ] Wi-Fi outage is induced safely; readings buffer locally and flush in order after recovery.
- [ ] A power interruption is induced safely; identity and Wi-Fi configuration persist and queued data behavior matches the specification.
- [ ] No duplicate rows appear after retry/reboot.
- [ ] Dashboard Live/Stale/Offline status follows that unit's cadence.
- [ ] The production URL works on desktop and mobile; current value, chart, range controls, tier selection, loading, empty, and error states are checked.
- [ ] Installation does not interfere with freezer alarms, seals, samples, service access, or warranties.
- [ ] Commissioning form, photos, firmware hash, and deviations are archived.

**Pilot exit gate:** all three pass concurrently for 24–72 hours, all critical defects are resolved or formally accepted, and the hardware/firmware revision is frozen. One successful node does not qualify the other two.

## Phase B — then build and deploy all 21

### B1. Procurement and production preparation

- [ ] Order parts for 21 units plus realistic spares for boards, probes, supplies, cables, and enclosures.
- [ ] Confirm lead times and incoming-inspection criteria.
- [ ] Create serialized labels and a build traveler/checklist per unit.
- [ ] Create a known-good test fixture and reference probe.
- [ ] Freeze the production BOM, wiring diagram, enclosure files, firmware hash, and commissioning SOP.
- [ ] Train at least two team members so deployment does not depend on one person.

### B2. Batch assembly QA

For all 21 production nodes:

- [ ] Record every component/device serial and MAC.
- [ ] Inspect polarity, pinout, solder, pull-up, capacitors, strain relief, and enclosure fit.
- [ ] Run continuity and powered voltage checks.
- [ ] Enumerate the real probe.
- [ ] Burn in each node before field installation.
- [ ] Verify identity and cadence against the registry.
- [ ] Verify at least one real end-to-end row and dashboard card.
- [ ] Quarantine failed units; never reassign a failed unit's evidence to a replacement.

### B3. Field installation

- [ ] Coordinate schedule and sample-safety constraints with the lab manager.
- [ ] Use the approved probe placement SOP: defined shelf/drawer, height, depth, attachment, thermal buffer/free-air choice, and spacing from walls/outlets/products.
- [ ] Photograph every final placement.
- [ ] Verify RSSI after the node is in its actual location.
- [ ] Confirm the expected dashboard card and physical label with two people.
- [ ] Confirm existing approved freezer alarms remain active; the research dashboard is supplemental only.
- [ ] Confirm all 21 cards report at their assigned cadence.
- [ ] Run a fleet-level expected-count and missingness report for at least 72 hours.
- [ ] Resolve every swapped ID, clock error, weak-signal node, reset loop, probe fault, and unexplained gap.

**Fleet exit gate:** 21/21 mapped and commissioned, 72-hour fleet QA passed, evidence archived, and no unresolved identity/time/cadence fault remains.

## Phase C — commercial tiers and energy meters

### C1. TRAXX/KLATU

- [ ] Finalize quantity and quote/order.
- [ ] Name the account owner and obtain authorized dashboard/API/export access.
- [ ] Inventory channels/devices and map them to freezers.
- [ ] Document acquisition vs upload interval, timestamp/time zone, units, retention, pagination, rate limits, and quality/error values.
- [ ] Export a representative raw dataset.
- [ ] Implement repeatable API, scheduled export, or documented CSV ingestion.
- [ ] Preserve raw payloads unchanged.
- [ ] Test idempotent re-ingestion, late data, failure/recovery, and reconciliation counts.

### C2. iMonnit

- [ ] Complete the same access, identity, timing, raw archival, ingestion, deduplication, and recovery checks.
- [ ] Document that only actual colocated periods qualify for agreement analysis.
- [ ] Do not infer three-tier coverage from the dashboard selector.

### C3. Cross-tier acceptance

- [ ] Align observations by source measurement time without manufacturing interpolated values.
- [ ] Preserve each source separately; never average instruments into one synthetic line.
- [ ] Verify the dashboard independently displays `esp32_ds18b20`, `traxx`, and `imonnit` where real data exist.
- [ ] Produce reconciliation reports with expected, received, duplicate, rejected, late, and missing records.
- [ ] Define uptime, latency, alarm fidelity, installation effort, operating effort, and cost calculations before reviewing outcomes.

## Phase D — close the baseline gate

Every item below needs an owner, evidence link/path, reviewer, and closure date:

- [ ] B01 authoritative freezer inventory.
- [ ] B02 authorized vendor access.
- [ ] B03 complete device/channel registry.
- [ ] B04 verified vendor cadence/timestamp semantics.
- [ ] B05 validated TRAXX and iMonnit ingestion.
- [ ] B06 bench-tested ID cadence for IDs 1, 6, 7, and 21.
- [ ] B07 verified offline retention at both cadences.
- [ ] B08 approved and executed probe-placement SOP.
- [ ] B09 ULT calibration/verification or signed limitation decision.
- [ ] B10 production tier-aware database/dashboard acceptance across real sources.
- [ ] B11 direct energy-meter plan and approved subset.
- [ ] B12 frozen data dictionary, exclusions, outcomes, and statistical analysis plan.
- [ ] B13 backup, retention, access, and successful restore test.
- [ ] B14 maintenance-event and protocol-deviation logs.
- [ ] Define ambient temperature/humidity, door-opening/use, loading, setpoint, alarms, failures, and maintenance covariate collection.
- [ ] Freeze primary/secondary outcomes and sensitivity analyses before outcome data are examined.
- [ ] Resolve the Dropbox strategic-governance inconsistency: its divergence package is blank/unsigned even though local build work exists. Obtain project-lead approval or explicitly document which governance process now controls this technical work.

**Baseline start gate:** all blockers closed, then record the official UTC start time per freezer. Earlier commissioning data remain commissioning data.

## Phase E — collect the pre-maintenance baseline

- [ ] Collect at least 28 valid calendar days per freezer under normal operation.
- [ ] Monitor daily completeness against 1,440 readings/day for each one-minute ESP32 and 96/day for each fifteen-minute ESP32.
- [ ] Record expected vendor counts from actual configured cadences.
- [ ] Review automated alerts for missingness, timing drift, sensor disagreement, resets, implausible values, and ingestion lag.
- [ ] Log all power/network interruptions, probe moves, freezer alarms, loading changes, setpoint changes, repairs, and access events.
- [ ] Do not silently repair raw data.
- [ ] Extend or exclude windows according to the pre-approved rules.
- [ ] Close a freezer's baseline only after completeness and comparability review.

## Phase F — preventive-maintenance intervention

- [ ] Schedule each freezer with the lab manager and qualified service personnel.
- [ ] Protect samples and maintain operational alarm coverage.
- [ ] Record exact start/end time and personnel.
- [ ] Record each action separately: coil/filter cleaning, gasket work, defrost, setpoint change, repair, or other.
- [ ] Record pre/post setpoint, condition, parts, photographs, and notes.
- [ ] Do not bundle undocumented repairs into “maintenance.”
- [ ] Enter deviations immediately.
- [ ] Mark intervention observations as retained but excluded from baseline/post comparison.
- [ ] Record return to operating setpoint and begin the predefined stabilization interval.

## Phase G — post-maintenance monitoring

- [ ] Apply the default 24-hour stabilization period after return to setpoint unless a longer period is prospectively documented.
- [ ] Collect at least 28 valid post-maintenance calendar days per freezer.
- [ ] Use the same completeness and QA rules as baseline.
- [ ] Document calendar, ambient, loading, user behavior, setpoint, and equipment differences between periods.
- [ ] Do not intentionally change routine use unless it is itself a documented intervention.
- [ ] Close each freezer's post window only after comparability review.

## Phase H — analysis and claims

- [ ] Create an immutable analysis freeze and manifest.
- [ ] Report counts by freezer, source, phase, and exclusion reason.
- [ ] Treat freezer as the experimental unit; time-series rows are repeated observations, not independent replicates.
- [ ] Calculate direct energy change only for directly metered units.
- [ ] Report paired pre/post effects with uncertainty bounds.
- [ ] Model fleet/campus estimates only as labeled extrapolations with assumptions and uncertainty.
- [ ] Compare instruments only during actual concurrent colocated periods.
- [ ] Quantify bias/agreement, uptime, missingness, delay, alarm fidelity, effort, and total cost.
- [ ] Analyze temperature central tendency, variability, excursions, and recovery without claiming temperature is electrical energy.
- [ ] Run pre-specified sensitivity analyses for missingness, window choice, setpoint, season/ambient, and loading/use differences.
- [ ] Preserve scripts, environment/dependency versions, random seeds if any, inputs, outputs, logs, and hashes.
- [ ] Have an independent reviewer reproduce the principal tables and figures.

## Phase I — final deliverables

- [ ] Clean, documented archived dataset with raw/normalized separation and data dictionary.
- [ ] Device registry and deployment manifest with sensitive credentials removed.
- [ ] Complete hardware package: BOM, wiring, enclosure source/exports, assembly, install, calibration, commissioning, troubleshooting, replacement, and decommissioning procedures.
- [ ] System architecture and data-flow diagram.
- [ ] Vendor ingestion runbooks and reconciliation evidence.
- [ ] Database migration and operations record.
- [ ] Dashboard acceptance record with URL, version/hash, screenshots, cases, tester, and date.
- [ ] Backup/disaster-recovery plan and restore evidence.
- [ ] Signed protocol, amendment log, deviations, maintenance log, data-freeze record, and analysis plan.
- [ ] CSF Final Report for UW CSF/Facilities/Sustainability audiences.
- [ ] Technical/IEEE PES paper with venue/deadline confirmed.
- [ ] Funding, conflicts, authorship/roles, and acknowledgments record.
- [ ] Reusable open firmware/hardware package only after secrets and institution-specific identifiers are removed.
- [ ] Final project handoff naming owners for ongoing monitoring, repairs, credentials, data retention, and device decommissioning.

## Documentation consistency cleanup

These do not all block the three-node pilot, but they must be reconciled before release or publication:

- [ ] Update README “Outstanding” text that still says the web app is undeployed; later evidence says it was deployed.
- [ ] Reconcile the README statement about three leftover fleet rows with the later handoff/live state; do not delete data without exact verification and authorization.
- [ ] Update Prototype 22 verification history so old “not yet flashed” text is clearly historical, while preserving the audit trail.
- [ ] Resolve date/time inconsistencies between local time, UTC, file modification times, and audit headings.
- [ ] Ensure every “verified” claim distinguishes compiled, deployed, flashed, observed over serial, inserted into database, and displayed publicly.
- [ ] Add one canonical current-status page and treat historical sections as immutable evidence rather than current instructions.
- [ ] Keep the study count at 21 and Prototype 22 outside all cohort/vendor/fleet analyses.

## Recommended immediate work queue

1. Diagnose and make one probe enumerate reliably without flashing unless newly authorized.
2. Decide and document the final ULT-capable probe and calibration strategy.
3. Obtain the signed 21-freezer inventory and choose the three pilot freezers: two core-cadence, one fleet-cadence.
4. Finalize the production BOM, power supply, enclosure, placement, and commissioning forms.
5. Close replay identity/timestamp/TLS/OTA decisions and expand automated tests.
6. Build and accept three nodes end to end for 24–72 hours.
7. Freeze that revision; then assemble and commission the remaining 18.
8. In parallel, procure/commission TRAXX, iMonnit access, and energy meters.
9. Close B01–B14; only then start the 28-day baseline.
10. Execute maintenance, post period, data freeze, analysis, and final reporting.

## Bottom line

The software compiles and its present automated tests pass, but the project is not yet ready for 21-unit manufacture or for baseline data collection. The immediate success criterion is not “three boxes power on.” It is three mapped, calibrated-or-formally-limited, production-representative nodes that produce genuine, correctly timestamped, deduplicated, recoverable data through the complete chain for 24–72 hours. After that gate passes, scale to 21; after all baseline blockers close, run the study.

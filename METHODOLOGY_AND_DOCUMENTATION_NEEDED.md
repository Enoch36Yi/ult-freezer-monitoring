# Methodology and Documentation Still Needed

**Purpose:** closure register for the 21-freezer study described in [firmware/METHODOLOGY.md](firmware/METHODOLOGY.md).  
**Design now fixed:** all 21 freezers receive the in-house ESP32 system. IDs 1–6 log every minute; IDs 7–21 log every fifteen minutes. Two iMonnit temperature sensors are available; TRAXX/KLATU quantity remains pending purchase.

This file distinguishes software that can be completed in this repository from vendor-dependent work and physical/research decisions. An item is closed only when its evidence is linked or named here; “discussed” or “probably configured” is not closure.

## 1. Direct answers and implementation boundaries

### 1. TRAXX/KLATU and iMonnit integration

This is the highest-priority open work and it can be implemented once both vendor dashboards are accessible. It cannot honestly be called complete “with no holes” before the live accounts reveal the exact device identifiers, export/API capabilities, timestamp semantics, rate limits, and historical-retention behavior.

What can be built without guessing:

- a vendor-neutral ingestion contract and canonical schema;
- device/freezer mapping tables;
- idempotent upsert/deduplication;
- raw-payload archiving and ingestion audit logs;
- adapters with API, scheduled-export, and CSV fallback paths;
- dashboard selection and cross-tier views;
- integration and reconciliation tests using fixtures.

What requires access:

- select and verify the supported ingestion interface for each vendor;
- identify every purchased and deployed device/channel in each platform;
- confirm support for the assigned 1-minute or 15-minute cadence and the distinction between sample time and upload time;
- validate units, time zones, pagination, status/error values, backfill limits, and API quotas;
- run end-to-end tests against real data from every freezer where that vendor is deployed.

**Credential handling:** credentials should be retrieved from the authorized password store when access opens, then placed in deployment secret storage. They must not be copied into Markdown, source code, Git history, screenshots, or analysis exports. The earlier read-only search did not locate a clearly identified TRAXX/KLATU or iMonnit credential document, so the credential location remains unresolved.

### 2. Direct energy measurement

Yes, the software side can be implemented. The correct solution is a separate energy stream rather than adding watts to temperature rows. It needs:

- `energy_observations`, `energy_devices`, and time-bounded freezer/circuit mapping;
- fields for interval energy, demand/power, cumulative meter value, units, source timestamp, receipt timestamp, quality, and deduplication key;
- an energy import/API adapter appropriate to the selected meter;
- daily kWh summaries, completeness checks, counter-reset handling, and baseline/post views;
- a maintenance-events table that supplies intervention timing.

The remaining non-software dependencies are selection/procurement of the 3-5 non-invasive meters, facilities approval, safe installation by qualified personnel, and verified circuit-to-freezer mapping. Until those are known, an adapter cannot be completed without inventing a device protocol. If only 3-5 freezers are metered, direct savings conclusions apply to that subset; fleet savings must be labeled as extrapolation.

### 3. Implement the YBR sampling schedule

M1 YBR cell O8 specifies one minute for IDs 1–6 and fifteen minutes for IDs 7–21. Repository implementation and validation require:

- select the ESP32 interval from its provisioned freezer ID;
- calculate dashboard cadence labels and stale/offline thresholds per freezer;
- revise expected-count and QA calculations;
- update documentation and bench tests;
- retest database/query performance at approximately 10,080 ESP32 temperature rows/day;
- document the current buffer as approximately 3.8 days for IDs 1–6 and 58 days for IDs 7–21.

Vendor logging must match the assigned freezer cadence where supported. If a vendor cannot produce that cadence, retain its native interval and document the mismatch; do not manufacture values by interpolation.

### 4. USB power

Yes: the ESP32-S3 board is powered through its USB-C connector. Use a listed, stable USB supply and a cable intended for continuous service. The MCU, adapter, and mains cable stay outside the freezer. The temperature probe—not the USB power cable—enters through an approved access route. Provide strain relief, label both ends, and do not route a cable through or compress the door gasket.

The final bill of materials must state the supply rating, cable type/length, enclosure, mounting method, and whether the selected ESP32 board's connector is mechanically adequate for the installation.

### 5. Dashboard and tier-aware database support

The previously missing `web/lib/config.ts`, `web/components/TierSelect.tsx`, and `supabase/migrations/002_bucketed_by_tier.sql` are now present. This is not yet equivalent to a verified deployed system. Closure requires:

- clean production build from a fresh dependency install;
- unit/integration tests for all three tier codes;
- migration 002 applied to the live database and verified against mixed-tier test data;
- correct empty, late, stale, and offline states per tier;
- deployment with secrets configured outside source;
- end-to-end display of real TRAXX/KLATU, iMonnit, and ESP32 observations for all 21 freezers;
- export capability for raw and analysis-ready data.

### 6. Tier isolation versus vendor ingestion

They are related but not the same problem. Tier isolation prevents dashboard/database queries from averaging three instruments together. Vendor ingestion obtains and normalizes the two commercial data streams. Migration 002 addresses the first; vendor adapters, device mappings, deduplication, and validation address the second. Both are required.

### 7. Data protection even without expected tampering

If deliberate tampering is out of scope, heavy adversarial security is not the immediate research risk. Accidental duplication, wrong freezer mappings, malformed requests, clock errors, and leaked write credentials are still credible threats to the paper's data integrity.

The minimum defensible controls are:

- keep vendor credentials and server-side keys in secret storage;
- restrict writes to valid source codes and registered devices;
- enforce deterministic uniqueness/deduplication;
- retain append-only raw data and ingestion logs;
- use server-side ingestion for vendor data rather than exposing privileged keys to the browser;
- back up raw exports and database data;
- document who can administer each platform.

The current public insert policy validates only freezer ID. That may be operationally acceptable for a supervised prototype, but it is not sufficient provenance for a three-source research dataset. Device/source validation and deduplication are still needed even if no malicious actor is expected.

### 8. Version control

Proceeding without Git does not prevent deployment, but it leaves a reproducibility hole unless replaced by disciplined snapshots. For a paper, Git is strongly recommended because it records exactly which firmware, schema, ingestion code, dashboard, and analysis produced a result.

If Git is intentionally not used, every field deployment and analysis freeze must include a dated read-only archive, source/config manifest, firmware binary hash, database migration list, dependency lock files, and analysis-output hashes. “The files currently in OneDrive” is not a sufficient reproducibility record because synchronized files can change in place.

## 2. Baseline blockers

These must be closed before the 28-day baseline clock starts.

| ID | Required closure | Evidence required | Status |
|---|---|---|---|
| B01 | Confirm the authoritative 21-freezer asset list and physical labels | Signed/dated inventory | Open |
| B02 | Obtain authorized TRAXX/KLATU and iMonnit access | Successful login and named account owner; no credentials in this file | Open |
| B03 | Inventory all vendor devices/channels and map them to freezers | Time-bounded registry reflecting actual coverage and quantities | Open |
| B04 | Confirm vendor cadence and timestamp behavior | Evidence for assigned 1-minute/15-minute operation plus verification note | Open |
| B05 | Complete and validate both vendor ingestion paths | Re-runnable test with counts, duplicates, errors, and raw archive | Open |
| B06 | Bench-test the ID-based ESP32 cadence | Firmware version/hash and tests for IDs 1, 6, 7, and 21 | In progress |
| B07 | Verify offline buffer duration at both cadences | Tested capacity and documented retention target | Open |
| B08 | Define and execute the common probe-placement protocol | Written SOP plus photo/placement record for every freezer | Open |
| B09 | Verify instruments at ULT temperature or constrain claims | Calibration certificates/report, or signed limitation decision | Open |
| B10 | Deploy and test tier-aware database/dashboard | Migration record, production build, and 21-freezer three-tier acceptance test | Open |
| B11 | Finalize direct energy-meter plan and monitored subset | Meter specification, freezer/circuit list, interval, installer, and schedule | Open |
| B12 | Freeze data dictionary, exclusion rules, and analysis plan | Dated approved documents with version/hash | Open |
| B13 | Establish raw-data backup and recovery check | Backup location, retention, access owner, and successful restore test | Open |
| B14 | Create maintenance and protocol-deviation logs | Templates, controlled vocabularies, owners, and storage location | Open |

## 3. Documentation package still needed

### 3.1 System and data documentation

- **System architecture:** a data-flow diagram from all three sensor platforms and energy meters through ingestion, raw storage, normalized storage, dashboard, QA, export, and analysis.
- **Canonical data dictionary:** field name, type, unit, nullability, allowed values, provenance, transformation, and example for every table.
- **Device registry:** all physical and vendor identifiers, freezer mapping, placement, installation interval, calibration status, and replacement history.
- **Vendor interface records:** API/export documentation version, endpoints or export procedure, rate limits, pagination, authentication owner, timestamp definition, and retention.
- **Ingestion runbook:** normal operation, backfill, retries, deduplication, error quarantine, reconciliation, and credential rotation.
- **Database migration record:** ordered migration list, deployment date, operator, verification query, and rollback/recovery approach.
- **Dashboard acceptance record:** build version, deployment URL, test cases, expected results, screenshots, and tester/date.
- **Backup and disaster recovery plan:** raw/vendor/database/config/code coverage, retention, access, restore procedure, and tested restore date.

### 3.2 Field and hardware documentation

- final bill of materials and serial-number inventory;
- wiring diagram and enclosure/mounting specification;
- USB supply and cable specification;
- installation SOP and safety review;
- exact probe-placement SOP with photographs/diagram;
- per-freezer commissioning checklist;
- calibration/verification SOP and result form;
- troubleshooting, replacement, and re-mapping procedure;
- decommissioning procedure that preserves device history.

### 3.3 Research-method documentation

- signed protocol version and amendment log;
- primary/secondary outcome definitions;
- energy-meter subset rationale and limitations;
- statistical analysis plan with model formulas and sensitivity analyses;
- missing-data and exclusion rules;
- maintenance action taxonomy and event form;
- protocol-deviation form and adjudication rules;
- environmental/use covariate collection plan;
- data-freeze procedure and manifest;
- authorship/roles record and conflict/funding acknowledgments as required by the paper venue.

## 4. Recommended implementation order

1. Obtain both vendor dashboards and immediately export a small representative dataset plus the vendor documentation.
2. Freeze source codes, canonical schema, device registry structure, and deduplication rules.
3. Implement TRAXX/KLATU and iMonnit ingestion with immutable raw archiving and reconciliation reports.
4. Implement the 1–6 one-minute / 7–21 fifteen-minute cadence and verify both buffer cases.
5. Apply and validate the tier-aware database migration; then test the dashboard across all three real sources.
6. Lock probe placement and ULT verification, then commission every freezer.
7. Install and commission energy meters on the approved subset.
8. Run a 24-72 hour pilot, resolve every identity/time/cadence gap, and freeze the protocol/data dictionary/analysis plan.
9. Begin the 28-day baseline only after the baseline-blocker table is closed.

## 5. Definition of complete for vendor integration

TRAXX/KLATU or iMonnit integration is complete only when all of the following are true:

- every purchased/deployed channel is mapped to the correct physical freezer;
- real observations arrive automatically or through a documented repeatable export process;
- raw source material is retained unchanged;
- normalized values preserve source identity, timestamps, units, and quality flags;
- rerunning a time range produces no duplicate observations;
- late/backfilled data retain original measurement time;
- a reconciliation report accounts for expected, received, duplicate, rejected, and missing records;
- one-minute behavior and time-zone handling have been empirically verified;
- failure and recovery have been tested;
- the dashboard shows the correct source separately for every freezer;
- an independent person can repeat the procedure from the runbook without oral instructions.

Anything less can be a useful prototype, but it is not a closed research-data pipeline.

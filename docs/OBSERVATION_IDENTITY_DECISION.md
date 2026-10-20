# Decision needed: observation-ID namespace after NVS reset or MCU replacement

Status: **DECISION REQUIRED (study/firmware owner)**. Recorded 2026-10-18 from
local simulation. No identity architecture was changed.

## What the firmware does now

`observation_id` is `<device_id>-<boot_id>-<sequence>`. `device_id` is the
logical freezer (`freezer-NN`), `boot_id` is a counter in NVS namespace `obs`
incremented once per boot, and `sequence` restarts at 1 every boot. The ingest
route upserts on `(device_id, observation_id)` and **ignores duplicates**; the
device treats that 2xx response as delivered and drops the queued line.

## Demonstrated risk (simulation, not field evidence)

`firmware/test/test_observation_identity` compiles the production
`initObservationIdentity()`, `observationId()` and `sampleAndSend()` against an
NVS fixture:

- erasing NVS (the documented `pio run -t erase` re-provisioning step) restarts
  the counter, so the next lifetime regenerates `freezer-NN-1-1`, `-1-2`, ...;
- a replacement MCU provisioned with the same freezer number does the same.

The restore rehearsal shows the database-level consequence: a reused ID with
different content is a conflict, but the live route would silently discard
it as a replay. The new readings are lost without an error. The pilot report's
lineage section detects the symptom afterwards (boot-counter regression,
cross-day conflicting IDs, sequence gaps); it cannot recover discarded rows.

## Options (not implemented)

1. Add a hardware-unique component (for example the eFuse MAC suffix) to the
   observation ID. Changes the payload contract and validation regexes. This
   distinguishes replacement boards, but alone does **not** solve NVS erase on
   the same board: its hardware component remains the same while the boot
   counter and sequence restart. A complete choice must address both cases.
2. Add a random per-boot or per-provisioning nonce to the ID or as a separate
   column; dedupe on the wider key. Needs a migration and route change.
3. Keep the format but carry a provisioning epoch in NVS that operators set
   above the retired board's last `boot_id`. Procedural; error-prone.
4. Make the route compare content on conflict and reject/alert on mismatched
   duplicates instead of ignoring them. Detects but does not avoid loss on
   the device unless the firmware treats that rejection as retryable.

The changes depend on the chosen option; a new observation-ID string stored
in the existing text column need not itself require a schema migration.
Coordinate any payload/validation, route or database changes with the prepared
replay-index migration and preserve historical-ID and queued-row compatibility.
No option has been selected or implemented by this clarification.

## Interim operating rule until decided

Do not erase NVS or swap an MCU under an existing freezer number in the study
fleet without this decision. If it already happened, run the pilot report on
an export spanning the change and look for boot-counter regressions and
conflicting IDs; record the event in the device registry.

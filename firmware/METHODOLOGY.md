# ULT Freezer Monitoring and Preventive-Maintenance Study Methodology

**Document status:** prospective study protocol  
**Study population:** 21 ultra-low-temperature (ULT) freezers in the Eichler laboratory area  
**Temperature systems:** in-house ESP32 on all 21; TRAXX/KLATU and iMonnit on documented comparison placements  
**Sampling target:** IDs 1–6 at one minute; IDs 7–21 at fifteen minutes  
**Study design:** repeated-measures instrument comparison plus paired baseline/post-maintenance evaluation

This document defines the study before outcome data are analyzed. Departures from it must be entered in the protocol-deviation log; the protocol must not be silently rewritten to fit the results.

## 1. Objectives

### 1.1 Primary objectives

1. Quantify agreement among TRAXX/KLATU, iMonnit, and the in-house temperature system wherever the systems are operated concurrently, with the intended primary comparison on the six-freezer core.
2. Estimate the within-freezer change in energy use following documented preventive-maintenance actions.

### 1.2 Secondary objectives

1. Compare uptime, missingness, reporting delay, installation effort, operating effort, and total cost across the three temperature-monitoring systems.
2. Estimate changes in freezer thermal behavior after maintenance, including central temperature, variability, excursion frequency, and recovery behavior.
3. Determine whether temperature-derived features can help explain energy use without claiming that temperature alone directly measures electrical consumption.
4. Produce an implementation package suitable for expansion to other campus ULT freezers.

### 1.3 Unit of inference

The freezer is the experimental unit. Time-series observations are repeated measurements within a freezer and are not independent replicates. Claims about maintenance effects will therefore be based on freezer-level summaries or models that explicitly account for measurements nested within freezer and time.

## 2. Study design

All 21 freezers receive an in-house ESP32 monitor. The intended comparison core is freezer IDs 1–6 at one-minute cadence; IDs 7–21 form the broader fleet at fifteen-minute cadence. Commercial systems are colocated according to the final device registry. As of this protocol revision, two iMonnit low-temperature sensors are available and TRAXX/KLATU equipment has not yet been purchased, so commercial coverage must not be overstated. Only periods with actual concurrent instrumentation qualify for inter-system agreement analysis.

The planned phases are:

1. **Commissioning and stabilization:** installation, mapping, clock checks, and data-quality verification. These data are not part of the effectiveness analysis.
2. **Baseline:** at least 28 valid calendar days under normal operation before the freezer's first study maintenance action.
3. **Maintenance:** the documented intervention period. These observations are retained but excluded from baseline/post comparisons.
4. **Post-maintenance stabilization:** a prospectively defined recovery interval after each intervention. The default is 24 hours after the freezer returns to its operating setpoint; defrosts, shutdowns, or major repairs may require a longer interval documented before post-period analysis.
5. **Post-maintenance:** at least 28 valid calendar days under normal operation.

Baseline and post-maintenance windows should cover comparable operating conditions. If calendar, laboratory activity, ambient conditions, freezer loading, or setpoint differ materially, those differences must be reported and adjusted for where the data permit.

## 3. Instrumentation

### 3.1 Temperature monitoring

The monitoring roles and currently supportable coverage are:

| System | Canonical data-source code | Role |
|---|---|---|
| TRAXX/KLATU | `traxx` | Commercial comparator; quantity pending purchase |
| iMonnit | `imonnit` | Commercial comparator; two low-temperature sensors available |
| In-house ESP32 system | `esp32_ds18b20` | Low-cost research system; 21-node fleet target |

Neither commercial system is designated the unquestioned ground truth. Agreement will be evaluated pairwise. Calibration documentation and stated operating ranges will determine what claims can be made about absolute accuracy.

The present in-house design uses an ESP32-S3 and a DS18B20 probe. The ESP32 is powered continuously through its USB-C connector using a listed, appropriately rated USB power supply. The MCU, USB supply, and mains connection remain outside the freezer. Only the temperature probe enters the cabinet, through a manufacturer-approved access port or other approved route; wiring must not be pinched through the door gasket.

**In-house wiring reference:** The current DS18B20 bench design powers the ESP32-S3 over USB-C and operates the sensor in externally powered mode: ESP32 3V3 to sensor VDD, ESP32 GND to sensor GND, GPIO4 to sensor DQ, and one external pull-up from DQ to 3V3. The bench revision specifies a nominal 6.8 kΩ pull-up. For a TO-92 DS18B20 viewed from its flat face with leads pointing down, the left, middle, and right leads are GND, DQ, and VDD, respectively. The [manufacturer's datasheet](https://www.analog.com/media/en/technical-documentation/data-sheets/DS18B20.pdf) illustrates an approximately 5 kΩ pull-up; the bench value is recorded explicitly and must be verified under the chosen cable length and probe configuration. This is a circuit description, not a claim that a photographed or assembled board has passed electrical testing. The final fleet probe, resistor value, cable, and board revision must be documented and accepted before deployment. Prototype 22 remains a separate bench unit and is not counted among the 21 study freezers.

The final fleet probe model and sensing element remain to be documented. Before collecting study measurements, its datasheet, rated range, pinout, calibration method, firmware compatibility, and `sensor_tier` assignment must be verified. Bench connectivity or Wi-Fi access alone does not establish a valid temperature measurement.

**Critical limitation:** the usual DS18B20 rated range ends at -55 °C, while ULT freezers operate near -70 to -80 °C. Unless the exact purchased probe assembly is documented as rated and calibrated at the study temperatures, its absolute readings are exploratory. It may still be evaluated for repeatability and relative change, but it must not be presented as a traceable -80 °C thermometer. Section 5 defines the required verification.

### 3.2 Electrical energy monitoring

Direct energy measurement is a separate measurement stream; it is not inferred from temperature. Non-invasive circuit-level meters will be installed on the planned 3-5 freezer circuits by qualified facilities/electrical personnel. The meter make, model, serial number, channel, circuit/freezer mapping, measurement interval, time base, accuracy specification, and commissioning check will be recorded.

If resources permit metering all 21 units, the same requirements apply. If only 3-5 units are directly metered, energy-effect estimates are a monitored-subset result and must not be represented as a direct measurement of savings across all 21 units. Campus-wide or fleet-wide savings may be modeled only as a clearly labeled extrapolation with uncertainty and explicit assumptions.

### 3.3 Contextual measurements

The following attributes and events will be collected because they may affect temperature or energy use:

- freezer identifier, location, manufacturer, model, approximate age, volume, and refrigerant if known;
- setpoint and displayed temperature;
- loaded/empty status and a reproducible load category;
- room temperature and, if available, relative humidity;
- door-opening events or an agreed proxy, when available;
- alarms, power interruptions, relocations, setpoint changes, and changes in use;
- maintenance type, start/end time, technician, observations, parts, and completion status.

## 4. Freezer and device identity

A controlled device registry is the authoritative mapping among:

- freezer ID (1-21) and physical asset/location;
- TRAXX/KLATU device/channel ID;
- iMonnit sensor/gateway ID;
- ESP32 MAC address or device ID;
- probe serial numbers;
- energy-meter and circuit/channel IDs;
- installation and removal timestamps.

Mappings are time-bounded. Replacing or moving a device creates a new registry record; it does not overwrite history. Freezer labels and dashboard labels must be checked against the registry by two people during commissioning.

## 5. Installation, placement, and measurement verification

### 5.1 Probe placement

Where two or three systems are colocated, their probes will be placed in the same defined thermal zone, close enough to experience comparable conditions but not touching one another, a cabinet wall, product, an air outlet, or a heat-generating component. The installation protocol must specify the shelf/drawer, front-to-back position, height, attachment method, and whether probes measure free air or use matched thermal buffers.

Placement will be photographed and recorded for each freezer. Probes will not be moved between baseline and post-maintenance phases. Any disturbance is a protocol deviation and starts a new placement interval in the registry.

### 5.2 Verification and calibration

Before baseline begins:

1. Record manufacturer, model, serial number, accuracy specification, calibration certificate/status, and rated range for every probe.
2. Perform an ambient-temperature reasonableness check and a two-point common-environment comparison where practical.
3. Perform or obtain a comparison at the intended ULT operating range against a traceable reference. The check must be sufficiently long for stabilization and must preserve the raw observations.
4. Estimate per-device bias and repeatability without altering raw measurements.
5. Repeat a check after the study, or whenever a probe is replaced or suspected of drifting.

If a ULT-range reference comparison cannot be completed, absolute-accuracy claims for unverified instruments are prohibited. Analysis may still report raw values, within-probe changes, and agreement conditional on this limitation.

### 5.3 Commissioning acceptance

A schematic-level review does not qualify an assembled in-house monitor. Before its 24-hour pilot period, record the hardware revision, MCU and probe identifiers, the actual pull-up value, component-side and solder-side photographs, and the pin-to-pin wiring map. With USB disconnected, check continuity from the actual MCU pads to the actual sensor leads and check for unintended shorts; with USB powered, verify the rail and idle DQ voltages using a common GND reference. Then require repeatable sensor ROM detection, valid measured temperatures, successful upload, and matching stored records. Record intermittent readings, resets, rework, and failed checks rather than treating a momentary continuity beep or voltage as acceptance. If the probe type differs from the bench TO-92 part, verify its own datasheet and pinout rather than copying that lead order.

A freezer enters its applicable baseline only after its assigned systems:

- are mapped to the correct freezer;
- are reporting in UTC at the assigned interval: one minute for IDs 1–6 and fifteen minutes for IDs 7–21;
- have passed the placement and reasonableness checks;
- show no unexplained clock offset or unit conversion error;
- have at least 24 continuous hours of acceptable pilot data;
- pass a visual comparison of all concurrently assigned temperature-system time series.

Energy-metered freezers additionally require verified circuit mapping and a load/reading reasonableness check.

## 6. Data acquisition and integration

### 6.1 Sampling

M1 YBR cell O8 governs cadence: freezer IDs 1–6 log every minute and IDs 7–21 log every fifteen minutes. The in-house firmware selects the interval from the provisioned freezer ID. Commercial dashboards will be configured to the same cadence for each assigned freezer where supported. The acquisition interval and transmission interval must be recorded separately if a vendor samples locally but uploads in batches.

No smoothing, interpolation, or averaging is applied to the archival raw layer. Dashboard aggregation is a presentation operation and does not replace raw data.

Expected ESP32 volume is 10,080 observations/day: 6 × 1,440 core observations plus 15 × 96 fleet observations. Commercial-system volume depends on actual deployed channel counts and must be calculated from the device registry rather than assumed.

### 6.2 Vendor ingestion

TRAXX/KLATU and iMonnit data will be ingested through the best available documented interface in this order:

1. supported API with incremental time-window retrieval;
2. supported scheduled export or webhook;
3. repeatable manual CSV export used only as a temporary fallback.

The interface selected for each vendor will be recorded with its documentation version, authentication method, timestamp semantics, units, pagination rules, rate limits, and retention limits. Credentials will be stored in environment/secret storage and never committed to this repository or written into study documentation.

Each ingestion run must be idempotent: re-running the same interval cannot create duplicate observations. The ingestion log records source, retrieval time, requested interval, returned count, accepted count, duplicate count, rejected count, and error details. Late-arriving records remain distinguishable from measurements recorded late.

### 6.3 Canonical temperature record

Every normalized temperature observation must retain, at minimum:

- a stable source-event identifier or deterministic deduplication key;
- freezer ID;
- source system and source device/channel ID;
- probe ID when available;
- original timestamp and time zone/offset;
- normalized UTC measurement timestamp;
- server receipt/ingestion timestamp;
- raw value and raw unit;
- normalized temperature in degrees Celsius;
- quality/status flags supplied by the source;
- ingestion batch identifier;
- raw-source reference or payload hash.

Vendor-native raw exports/responses are retained unchanged. Normalization never overwrites the source material.

### 6.4 Time alignment

All analysis uses UTC. Display may use local time with the offset shown. Clock offsets are assessed during commissioning and at least weekly. Daylight-saving changes affect display only, not stored UTC timestamps.

For cross-system comparison, observations are aligned to the assigned UTC grid: one-minute bins for IDs 1–6 and fifteen-minute bins for IDs 7–21. The default matching tolerance is half the assigned interval. A value is not carried forward into a missing bin. Sensitivity analysis will test alternative tolerances if vendor timestamp behavior requires it.

### 6.5 In-house buffering

The ESP32 retains readings locally when upload fails and replays them after reconnection. The approximately 1 MB queue holds roughly 3.8 days for one-minute core nodes and roughly 58 days for fifteen-minute fleet nodes. Measurement time and ingestion time are stored separately.

## 7. Data quality assurance

Automated checks run at ingestion and in a daily audit:

- freezer, device, probe, and source codes exist in the registry for that timestamp;
- units and timestamps parse unambiguously;
- duplicate source events are rejected deterministically;
- impossible values, vendor error codes, and disconnected-probe sentinels are flagged;
- cadence, gaps, reporting delay, and clock offset are calculated per source and freezer;
- sudden flat-lines, jumps, and cross-system disagreements are flagged but not deleted;
- expected-versus-observed counts are reported daily;
- energy data are checked for negative use, counter resets, impossible demand, and channel swaps.

Raw records are append-only. Corrections occur through versioned derived tables or exclusion flags that preserve the original value and document the reason, author, and time. No questionable observation is silently deleted.

A daily completeness report and weekly three-system comparison are reviewed during data collection. Problems are corrected prospectively; prior data remain auditable.

## 8. Preventive-maintenance intervention

Each maintenance event is recorded per freezer using a controlled action list, including as applicable:

- condenser coil/filter cleaning;
- gasket inspection, adjustment, or replacement;
- frost/ice removal or defrost;
- ventilation/clearance correction;
- control, alarm, or component service;
- setpoint change, including any approved -80 °C to -70 °C trial.

The event record includes planned and actual start/end timestamps, pre-condition, action performed, technician, parts, photos where appropriate, and post-condition. Multiple actions on the same visit are recorded separately. A setpoint change is analyzed as a distinct intervention, not pooled invisibly with routine maintenance.

Routine user behavior should not be intentionally changed between comparison periods unless it is itself a documented intervention.

## 9. Outcomes

### 9.1 Instrument-comparison outcomes

- pairwise temperature difference (bias) by system pair;
- 95% limits of agreement, accounting for repeated observations within freezer;
- root-mean-square error and mean absolute difference;
- concordance/correlation reported as secondary descriptors, not substitutes for agreement;
- detection agreement for prospectively defined temperature excursions;
- data completeness, reporting latency, outage duration, and recovery/backfill performance;
- installation time, maintenance effort, and lifecycle cost.

### 9.2 Maintenance outcomes

The primary energy outcome is mean daily electrical energy use in kWh/day for directly metered freezers. Secondary energy outcomes may include peak demand, daily variability, and normalized change.

Thermal secondary outcomes include:

- daily mean or median temperature;
- within-day variability;
- proportion of time above prospectively defined thresholds;
- excursion count, duration, and magnitude;
- recovery time following identifiable disturbances;
- agreement among systems before and after maintenance.

Thresholds must be defined before outcome analysis using the operational requirement for the freezer population; they must not be chosen after viewing which threshold gives a favorable result.

## 10. Statistical analysis

### 10.1 General principles

- Freeze the analysis plan before unblinded outcome analysis.
- Preserve one-minute data, but use freezer-day summaries for the principal maintenance analysis unless a repeated-measures time-series model is pre-specified.
- Report effect estimates with uncertainty intervals, not only p-values.
- Do not treat individual minutes as independent sample size.
- Report results for all 21 freezers and separately for the directly energy-metered subset where relevant.

### 10.2 Instrument agreement

For each pair of systems, compute time-matched differences and visualize difference versus pair mean. Estimate overall bias and limits of agreement using a mixed-effects agreement model or a freezer-cluster bootstrap so repeated minutes within the same freezer do not produce artificially narrow intervals. Report results overall and by freezer. Examine whether disagreement changes with temperature, freezer state, or study phase.

Correlation may be high even when two systems disagree systematically, so correlation alone will not establish interchangeability.

### 10.3 Maintenance effect

For directly metered freezers, calculate matched pre/post freezer-day outcomes. The primary model will estimate post-versus-baseline change with freezer as a repeated unit and will adjust, where available and pre-specified, for ambient temperature, day type, load category, setpoint, and major usage differences. With a small metered subset, emphasize individual-freezer effects and uncertainty; avoid models with more predictors than the data can support.

If maintenance dates are staggered, a segmented or difference-in-differences-style longitudinal analysis may supplement the paired analysis, but only if its assumptions and comparison periods are documented. A simple paired summary remains the transparent primary analysis for a small energy-metered subset.

### 10.4 Missing data and exclusions

Completeness is calculated against each freezer's assigned grid: one minute for IDs 1–6 and fifteen minutes for IDs 7–21. No temperature or energy observation is imputed for the primary analysis. Daily summaries require a prospectively fixed completeness threshold; the default is at least 90% of expected observations from the relevant system that day. Sensitivity analyses will use 80% and 95% thresholds.

Pre-specified exclusions include commissioning data, maintenance windows, post-maintenance stabilization, documented device misassignment, invalid timestamps, source error codes, and periods when a freezer is out of service. All exclusions are retained in an auditable table with reason codes.

## 11. Reproducibility and records

The following are preserved for the study:

- this frozen protocol and dated amendments;
- hardware and device registry;
- installation and placement records with photographs;
- calibration/verification records and certificates;
- vendor API/export documentation and ingestion code version;
- raw vendor exports or immutable payload archive;
- database schema and migration history;
- firmware binary/source version and configuration for every ESP32;
- energy-meter mapping and commissioning records;
- maintenance event and protocol-deviation logs;
- automated QA reports and data-freeze manifest;
- analysis code, dependency versions, random seeds, and output tables/figures;
- a data dictionary and README sufficient for an independent analyst to reproduce the results.

Each analysis dataset receives a unique freeze identifier, creation timestamp, source coverage interval, record counts by freezer/source, exclusion counts, and cryptographic hashes of its files. Credentials and personally identifying access information are excluded from the reproducibility package.

## 12. Safety and scope

The research system supplements but does not replace approved freezer alarms or cold-chain controls. Installation may not compromise door seals, electrical safety, warranties, sample access, or existing monitoring. Only qualified personnel may open electrical panels or install circuit-level energy meters. Freezers with unsafe temperatures, alarms, or product-risk concerns are escalated immediately under laboratory procedures rather than held in study conditions for methodological consistency.

## 13. Items that must be locked before baseline

The implementation and documentation items still requiring closure are maintained in [METHODOLOGY_AND_DOCUMENTATION_NEEDED.md](../METHODOLOGY_AND_DOCUMENTATION_NEEDED.md). Baseline does not begin until every item marked **baseline blocker** there has an owner, evidence, and closure date.

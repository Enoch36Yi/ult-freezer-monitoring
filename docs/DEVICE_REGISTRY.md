# Device registry

Keep the completed registry private. This repository defines the fields and
validation rules, but does not contain the fleet's MAC addresses, serials,
deployment locations, or credentials.

Use [device-registry.example.csv](device-registry.example.csv) as the header
template. One row represents one physical node and its current study mapping;
append a new row or preserve a dated snapshot when a node is replaced rather
than silently rewriting history.

| Field | Required before commissioning | Meaning |
| --- | --- | --- |
| `device_id` | Yes | Stable ingest identity, e.g. `freezer-07` or `prototype-22` |
| `freezer_id` | Fleet only | Integer 1–21; blank for Prototype 22 |
| `prototype_id` | Prototype only | `22`; blank for fleet nodes |
| `sensor_tier` | Yes | Current instrument tier, normally `esp32_ds18b20` |
| `hardware_revision` | Yes | Board/enclosure revision or assembly identifier |
| `board_mac` | Yes | Board MAC observed during commissioning |
| `probe_id` | Yes | Physical probe serial/label, not a secret |
| `firmware_version` | Yes after first telemetry | Version reported by the observation payload |
| `image_sha256` | Yes before deployment | Hash of the exact approved firmware artifact |
| `cadence_seconds` | Yes | 60 for IDs 1–6 and Prototype 22; 900 for IDs 7–21 |
| `commissioning_state` | Yes | `staged`, `canary`, `active`, `held`, or `retired` |
| `provisioned_at_utc` | Yes | When identity and network provisioning completed |
| `last_verified_at_utc` | Yes for active | Latest evidence review time |
| `primary_operator` | Yes | Person responsible for the record |
| `second_checker` | Yes before active | Independent label/mapping checker |
| `notes` | Optional | Placement, repair, or exception reference |

Validation rules:

- `device_id` must be unique and must match the ingest identity used by the
  device and server secret map.
- Exactly one of `freezer_id` and `prototype_id` is populated. Prototype 22 is
  never assigned a fleet freezer number.
- The registry must not contain Wi-Fi passwords, HMAC secrets, OTA passwords,
  service-role keys, or private keys.
- An `active` row needs an image hash, a board MAC, a probe identity, a
  second-checker entry, and a real telemetry verification reference.
- Retain the prior row/state when replacing a board or probe. Do not use a
  registry edit to rewrite historical readings.

The registry is an operational identity record, not proof of temperature
validity. Temperature acceptance still requires the serial/database/dashboard
evidence in [PROTOTYPE_22_ACCEPTANCE.md](PROTOTYPE_22_ACCEPTANCE.md) or the
fleet commissioning runbook.

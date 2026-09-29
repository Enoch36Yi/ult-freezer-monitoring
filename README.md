# ULT Freezer Monitoring System

> **Development status (2026-09-29):** This repository is a research prototype,
> not a validated freezer alarm or a completed energy-savings study. Current
> evidence and open work are in [updates.md](updates.md) and [TODO.md](TODO.md).
> Blake Bedford is taking over software and firmware fixes. A genuine
> end-to-end Prototype 22 temperature reading has not yet been verified.

Temperature monitoring for 21 ultra-low-temperature freezers. Each freezer has an
ESP32-S3 node with a DS18B20 probe that posts a reading over WiFi every 1
minute (freezers 1–6) or 15 minutes (freezers 7–21) to Supabase. A separate
bench instrument, Prototype 22, reports every minute without becoming a 22nd
study freezer. A Next.js dashboard shows all 21 freezer nodes and the separate
prototype card and history.

```
/firmware      PlatformIO project (ESP32-S3, Arduino framework)
/supabase      schema.sql — run once in the Supabase SQL editor
/web           Next.js App Router dashboard
```

Prototype 22's isolated firmware, database, and verification procedure are in
[docs/PROTOTYPE_22.md](docs/PROTOTYPE_22.md). The prototype SQL must be applied
before its dashboard card can fetch from Supabase; this is independent of the
21-freezer `readings` table.

**The dashboard uses a publishable key plus row-level security for public reads.**
Devices use per-device HMAC credentials through the authenticated ingestion route;
the publishable browser key cannot insert observations. There are no MQTT broker
or serial/wired data paths — WiFi and HTTPS are the only device transport.

---

## 1. Hardware & wiring

One node = ESP32-S3 Supermini + one waterproof DS18B20 probe (soldered-pin
version) on a 1-Wire bus.

```
   ESP32-S3 Supermini                          DS18B20 (waterproof probe)
  ┌───────────────────┐                       ┌──────────────────────────┐
  │             3V3 ●─┬──────────────┬────────┤ VDD  (red)               │
  │                   │              │        │                          │
  │                   │             ┌┴┐       │                          │
  │                   │     6.8 kΩ  │ │       │                          │
  │                   │             └┬┘       │                          │
  │          GPIO4  ●─┼──────────────┴────────┤ DQ   (yellow / white)    │
  │                   │                       │                          │
  │             GND ●─┴──────────────┬────────┤ GND  (black)             │
  └───────────────────┘              │        └──────────────────────────┘
                                     │
   100 µF across 3V3 ↔ GND ──────────┤   0.1 µF ceramic across the
   (at the board)                     │   DS18B20's VDD ↔ GND (at the probe)
```

| Item | Value | Why |
|---|---|---|
| DS18B20 DQ | **GPIO4** | Not a strapping pin (0, 3, 45, 46), not input-only |
| Pull-up | **one 6.8 kΩ** between DQ and 3V3 | One per bus — not one per sensor, even though each node has only one probe |
| Bulk cap | **100 µF** across the ESP32's 3V3 / GND | Brownout mitigation during WiFi TX current spikes |
| Decoupling cap | **0.1 µF ceramic** across the DS18B20's VDD / GND | Noise rejection near compressor EMI; place it at the probe end |
| Power | **USB 5 V** into the board; the board regulates to 3.3 V | |
| Sensor supply | **3.3 V — not 5 V** | The DQ line is referenced to the ESP32's 3.3 V logic |

The firmware assumes exactly this wiring. `ONEWIRE_PIN` lives in
[firmware/include/config.h](firmware/include/config.h) if a node ever has to
differ.

---

## 2. Supabase — run the schema

```
supabase/schema.sql                             full schema — for a NEW project
supabase/migrations/001_readings_bucketed.sql   server-side time bucketing
supabase/migrations/002_bucketed_by_tier.sql    tier isolation  ← REQUIRED
supabase/migrations/003_authenticated_ingest.sql authenticated device writes
supabase/migrations/004_replay_safe_observations.sql deduplication
supabase/migrations/005_clock_provenance.sql    timestamp provenance
supabase/migrations/006_bound_history_rpc.sql   bounded history RPC
```

> **002 is not optional.** Three instruments (ESP32/DS18B20, TRAXX, iMonnit)
> write into one table. Without the tier filter, `readings_bucketed()` averages
> across instruments and returns a line that corresponds to no real
> measurement — silently. Run it before trusting any chart.

**New project:** paste [supabase/schema.sql](supabase/schema.sql) into the
Supabase dashboard → **SQL Editor** → **New query** and run it once. It creates
the table, the index, the RLS policies, and the `readings_bucketed()` function.
You can then skip the migration — schema.sql already contains it.

**Project where `readings` already exists:** run the migrations in
[supabase/migrations/](supabase/migrations/) in numerical order instead. **Do not re-run schema.sql** — it opens with `create table readings`,
which errors on an existing table and would leave the function uncreated.

The migrations are ordered and safe for the populated project: they alter only
permissions, columns, indexes, and function definitions; they do not rewrite
or delete existing measurement rows. Apply each numbered file once through the
project's migration workflow.

Here is the table portion, verbatim from schema.sql:

```sql
create table readings (
  id bigint generated always as identity primary key,
  freezer_id smallint not null check (freezer_id between 1 and 21),
  sensor_tier text not null default 'esp32_ds18b20',
  temp_c numeric not null,
  rssi integer,
  reset_reason text,
  recorded_at timestamptz not null default now(),
  received_at timestamptz not null default now()
);

create index on readings (freezer_id, recorded_at desc);

alter table readings enable row level security;

create policy "anon can read readings"
  on readings for select
  to anon
  using (true);
```

And the aggregation function the long history ranges depend on:

```sql
create or replace function readings_bucketed(
  p_freezer_id smallint,
  p_start timestamptz,
  p_end timestamptz,
  p_bucket_seconds integer,
  p_sensor_tier text default 'esp32_ds18b20'
)
returns table (
  bucket_time timestamptz,
  avg_temp_c numeric,
  min_temp_c numeric,
  max_temp_c numeric,
  reading_count bigint
)
language sql
stable
as $$
  select
    to_timestamp(floor(extract(epoch from recorded_at) / p_bucket_seconds) * p_bucket_seconds) as bucket_time,
    avg(temp_c) as avg_temp_c,
    min(temp_c) as min_temp_c,
    max(temp_c) as max_temp_c,
    count(*) as reading_count
  from readings
  where freezer_id = p_freezer_id
    and sensor_tier = p_sensor_tier
    and recorded_at >= p_start
    and recorded_at < p_end
  group by 1
  order by 1;
$$;

grant execute on function readings_bucketed to anon;
```

It returns **min and max per bucket, not just the mean**, which is what lets the
chart stay honest at coarse bucket widths — a door-open spike inside an
hour-wide bucket barely moves the average but still shows as a band excursion.
The function is not `SECURITY DEFINER`, so it runs as the calling role and RLS
on `readings` still applies; anon gains no reach it did not already have.

Notes on the columns:

- **No update or delete policy for anon**, by design — readings are append-only
  from the devices and from the dashboard alike.
- **`sensor_tier`** identifies the instrument: `esp32_ds18b20`, `traxx`,
  `imonnit`. This is a comparison study, so **every query must constrain it** —
  aggregating across tiers averages probes with different placements and
  offsets. The dashboard has a sensor selector and filters on exactly one tier.
  Only the ESP32 tier has firmware here; ingestion for the other two is not
  built, so selecting them shows no data until it is.
- **`recorded_at`** is the NTP-synced device clock and **`clock_valid`** records
  that provenance; **`received_at`** is the database clock. Devices pause
  measurement uploads until NTP succeeds, so buffering preserves measurement
  time instead of replacing it with receipt time.
- **`reset_reason`** is set only on the first reading after a boot, so a node
  that is brownout-looping shows up in the data instead of silently vanishing.

Verify it took:

```bash
curl -s "https://dfxxamgnrimwoumknuxa.supabase.co/rest/v1/readings?select=id&limit=1" \
  -H "apikey: YOUR_PUBLISHABLE_ANON_KEY" \
  -H "Authorization: Bearer YOUR_PUBLISHABLE_ANON_KEY"
```

`[]` means the table is live. `PGRST205 / could not find the table` means the
schema has not been run yet.

---

## 3. Flashing a node

One firmware image flashes all 21 nodes — the freezer number is **not** a build
flag. Identity comes from the provisioning portal and is stored in NVS, so it
survives reboots and reflashes.

```bash
cd firmware
pio run                 # build
pio run -t upload       # build + flash over USB
pio device monitor       # 115200 baud, over the S3's native USB-CDC
```

> **Doing the install?** [firmware/HOW-TO-FLASH.md](firmware/HOW-TO-FLASH.md) is
> the bench guide — per-node walkthrough, a 21-row install checklist, and a
> troubleshooting table keyed to the serial output.

### Provisioning walkthrough (first boot, or any node with no saved config)

Before building, copy `firmware/include/device_security.example.h` to the
ignored `device_security.h`. Set the provisioning AP password and OTA hash
there. For fleet nodes, generate a different 32+ character ingest secret for
each freezer and keep the same device-to-secret mapping in the server's
`INGEST_DEVICE_SECRETS_JSON` environment variable.

1. Power the node. It starts a WiFi access point named **`ULT-Freezer-Setup-XXXX`**
   (the suffix is the last 4 hex of the MAC, so several nodes can be set up in
   the same room without colliding).
2. On a phone or laptop, join that AP. The captive portal opens on its own; if
   it does not, browse to **`http://192.168.4.1`**.
3. Join the AP with the provisioning password configured in `device_security.h`.
4. Tap **Configure WiFi**. The form has the usual SSID and password fields plus
   **"Freezer number (1-21)"** and **"Device ingest secret"** fields.
5. Enter the network credentials, freezer number, and that node's unique ingest
   secret, then **Save**.
6. The node saves the identity and ingest secret to NVS, joins the network, syncs its clock over NTP, and
   starts posting. The serial monitor shows `[provision] freezer N, ip ...`.

A number outside 1–21, or one with stray characters, is rejected and the portal
reopens — the node will not come up without a valid identity. To re-provision a
node later, erase it with `pio run -t erase` and reflash.

### Updating firmware over the network

Once a node is on the network and has a configured OTA password hash, it
advertises itself over mDNS as `ult-freezer-NN.local` (`NN` = its freezer
number) and accepts authenticated ArduinoOTA uploads:

```bash
pio run -e esp32-s3-ota -t upload --upload-port ult-freezer-07.local \
  --upload-password "$OTA_PASSWORD"
```

The `esp32-s3-ota` env in [firmware/platformio.ini](firmware/platformio.ini)
holds the default target; pass `--upload-port` (an IP works too, if mDNS is
blocked on the network) to hit a specific node.

### What the firmware does

- **By freezer ID:** IDs 1–6 read and post every **1 minute**; IDs 7–21
  read and post every **15 minutes**. Each reading contains
  `{freezer_id, device_id, observation_id, temp_c, rssi, sensor_tier, recorded_at}` and is POSTed to the
  authenticated `/api/ingest` route with a per-device HMAC signature.
- **On send failure** — no WiFi, request error, timeout — the reading is
  appended to `/queue.jsonl` on LittleFS instead of being dropped.
- **On every successful WiFi connect** (boot or reconnect) the queue is flushed
  oldest-first before live posting resumes. A flush stops at the first failure
  and keeps the rest of the file intact, so ordering is never scrambled.
  Unattended multi-week logging does not lose data across WiFi dropouts.
- **Buffer capacity:** the `default.csv` partition table leaves ~1.4 MB for
  LittleFS. At ~180 bytes per reading, the 1 MB queue holds roughly **3.8
  days** for core IDs 1–6 or **58 days** for fleet IDs 7–21. Past the cap the
  oldest half is dropped, so the most recent history always survives.
- **Clock:** NTP at boot and a resync every 6 hours. If NTP never lands, the
  node pauses measurement uploads rather than creating a row with an invented
  server-side timestamp.
- **Flash budget:** the image uses ~82% of the 1.25 MB app partition. Two app
  partitions are what make OTA possible, so keep additions modest — or move to a
  larger partition table if the board has 8 MB of flash.

---

## 4. Running the dashboard locally

```bash
cd web
npm install
npm run dev       # http://localhost:3000
```

`web/.env.local` is gitignored; copy `web/.env.example` and fill the values
locally. The example also documents the server-only ingestion variables.

| Variable | Value |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `https://dfxxamgnrimwoumknuxa.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `sb_publishable_…` (publishable/anon — safe client-side) |
| `SUPABASE_URL` | Same project URL, server-only ingestion setting |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only Supabase service credential; never browser-side |
| `INGEST_DEVICE_SECRETS_JSON` | Server-only device-ID → HMAC-secret map |

These two are the only external configuration. There is no login wall in v1:
the dashboard is open to anyone with the link.

**`/`** — a grid of 21 cards. Each shows the latest reading in both °F and °C,
a last-seen timestamp, and a status of Live / Stale / Offline / No data (glyph
plus label, so state never depends on color alone). The grid refetches every
minute; liveness thresholds scale to each freezer's assigned cadence. Each card links to its detail
page.

**`/freezer/[id]`** — the current reading in °F and °C, mean and min/max over
the selected window, last-seen, RSSI, and a temperature history chart over
**24 hours / 7 days / 30 days / 90 days / All time**. A **Show table** toggle
gives the same data as numbers.

The chart has two data paths, split by row count rather than preference:

| Range | Path | How |
|---|---|---|
| 24 h, 7 d | raw | Pages individual readings (≤ ~10k at 1-minute cadence) and thins with LTTB |
| 30 d, 90 d, All time | bucketed | `readings_bucketed()` aggregates in Postgres |

Bucket width scales with the span — 15-minute up to 31 days, hourly up to 400
days, 6-hour beyond — so a request stays bounded no matter how long the study
runs. **There is no upper limit on the range**; "All time" anchors on the
freezer's earliest reading, so a baseline → maintenance → post-maintenance
cycle of any length charts without clipping.

Coarse buckets do not flatten spikes: the chart draws `avg_temp_c` as the line
and shades `min_temp_c`–`max_temp_c` as a band beneath it, with all three plus
the reading count in the tooltip. A door-open excursion that barely moves an
hourly mean still shows as a band spike.

---

## 5. Deploying to Vercel

Either path works; the app is a stock Next.js App Router project with no
Vercel-specific configuration.

**CLI:**

```bash
cd web
npx vercel            # first run links the project
npx vercel --prod
```

**GitHub-connected:** import the repo in the Vercel dashboard and set the
**Root Directory** to `web`. Everything else is detected.

Either way, set the two environment variables above in
**Project → Settings → Environment Variables** (Production, Preview, and
Development). `.env.local` is gitignored, so it does not travel with the repo.

---

## Verified

- `pio run -e esp32-s3` links cleanly (RAM 15.5%, flash 81.7% of the app
  partition).
- `npm run build` in `/web` succeeds; all 21 `/freezer/[id]` routes prerender,
  and out-of-range ids (`/freezer/99`) 404.
- `readings_bucketed()` was executed against Postgres with a 596-reading,
  120-day fixture: the full 119.8-day span returns at 5-minute, hourly, and
  6-hour widths with no clipping; every reading is accounted for in
  `reading_count` at every width; bucket boundaries align to the grid; a
  door-open spike survives a 6-hour bucket as `max_temp_c` −55.2 °C against a
  mean of −70.9 °C; empty windows and freezers with no data return zero rows
  rather than erroring; and the migration is re-runnable.
- `readings` exists in the Supabase project and is empty — no test data left in
  it.

- `readings_bucketed()` is live in the project and verified end-to-end over a
  45-day span: hourly buckets, spike preserved as `min −80.5 / max −55.0`
  against a mean of −67.75 in the same bucket.

### Outstanding

Current status lives in [updates.md](updates.md) and the consolidated list in
[TODO.md](TODO.md); the sections above describe the design, not live state.

**Deployed.** The dashboard is on the existing Vercel project at
<https://ult-freezres.vercel.app> (deployed 2026-09-23; includes `/prototype/22`).
No temperature from a real device has been verified end to end yet.

**Three manual test rows on freezer 1** remain in `readings` (identical
`received_at`, round timestamps, no RSSI; latest checked 2026-09-28). They are
not device data. Do not delete them without confirming provenance and
authorization; if removal is approved, the SQL editor is the only route:

```sql
-- Inspect first; do not run a delete until the rows are confirmed as the test inserts.
select id, freezer_id, recorded_at, received_at, rssi from readings order by id;
```

> Note for future testing: the anon role has no delete policy, by design, so
> anything written to this table cannot be removed by the app or its key — only
> from the SQL editor. Use a throwaway project or a local Postgres for fixtures
> rather than seeding this one.

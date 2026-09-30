# Deployment runbook

This is the deployment path for the authenticated telemetry build. It assumes
the repository is cloned or staged outside OneDrive. Do not build or install
dependencies in the synced project directory.

The deployment has four independent pieces:

1. Supabase tables, grants, indexes, and bounded RPCs.
2. The Next.js dashboard and authenticated `/api/ingest` route.
3. Server-only device-secret configuration.
4. Firmware images and physical node provisioning.

Never put a service-role key, device HMAC secret, Wi-Fi password, OTA password,
or `device_security.h` in Git. Never create synthetic temperature rows to test
connectivity.

## 1. Prepare a clean source revision

```bash
git clone git@github.com:Enoch36Yi/ult-freezer-monitoring.git
cd ult-freezer-monitoring
git status --short --branch
```

The working tree must be clean. Keep local files ignored by Git:

- `web/.env.local`
- `firmware/include/device_security.h`
- `firmware/include/prototype22_wifi.h` for Prototype 22

## 2. Apply the database changes

For a new project, run these in the Supabase SQL editor:

1. `supabase/schema.sql`
2. `supabase/prototype22.sql`

Those are complete fresh-project definitions. Do not run them over populated
tables.

For an existing project, confirm the original tables and the five-argument
fleet history RPC exist, then apply the numbered migrations in order:

```text
supabase/migrations/003_authenticated_ingest.sql
supabase/migrations/004_replay_safe_observations.sql
supabase/migrations/005_clock_provenance.sql
supabase/migrations/006_bound_history_rpc.sql
supabase/migrations/007_latest_received_index.sql
supabase/migrations/008_firmware_version.sql
```

If Prototype 22 has not been created yet, run `supabase/prototype22.sql` first.
Do not apply migration 003 until the tables exist.

Afterward, verify that:

- `anon` has SELECT but not INSERT on `readings` and `prototype_readings`;
- the device/observation unique indexes exist;
- both history functions reject unsupported bucket widths and ranges over ten
  years;
- existing rows remain unchanged.

Record the SQL application time and migration names in the operations log.

## 3. Configure and deploy the dashboard

Create local configuration from the example without committing it:

```bash
cp web/.env.example web/.env.local
```

Set these in the Vercel project settings. The first two are browser-visible;
the last three are server-only:

```text
NEXT_PUBLIC_SUPABASE_URL=https://<project>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<publishable-key>
SUPABASE_URL=https://<project>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<service-role-key>
INGEST_DEVICE_SECRETS_JSON={"prototype-22":"<32+ random characters>"}
```

Add one entry for every commissioned fleet node, using the exact IDs
`freezer-01` through `freezer-21`. The JSON value for each ID must be at least
32 random characters and must match the secret entered on that physical node.

Build and test from the staged copy:

```bash
cd web
npm ci
npm test
npm run typecheck
npm run build
```

Deploy with the existing Vercel project. Do not paste server-only variables into
`NEXT_PUBLIC_*` fields or into a browser bundle. After deployment, check `/`,
`/freezer/1`, and `/prototype/22` with a browser. Public reads are intentional
in v1; there is no dashboard login wall.

## 4. Prepare local firmware security files

Copy the tracked example into the ignored local header:

```bash
cp firmware/include/device_security.example.h firmware/include/device_security.h
```

Replace the placeholders locally:

- `PROVISION_AP_PASSWORD`: a strong password for the setup AP;
- `OTA_PASSWORD_HASH`: the SHA-256 hex digest of the OTA upload password;
- `DEVICE_INGEST_SECRET`: the Prototype 22 secret, matching the server map.

Fleet ingest secrets are entered per node through the provisioning portal and
stored in NVS. The fleet image still needs the AP password and OTA hash in the
ignored header. Generate an OTA hash without putting the password in a file:

```bash
read -r -s OTA_PASSWORD
printf '%s' "$OTA_PASSWORD" | sha256sum
unset OTA_PASSWORD
```

Keep the cleartext OTA password in a password manager. The upload command later
uses that password; the firmware stores only its hash.

For Prototype 22, create the ignored Wi-Fi header through the bench preparation
script so the password stays out of the repository and logs:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/prepare-bench-day.ps1
```

## 5. Stage and build firmware

Use `scripts/stage-prototype-firmware.ps1` or the bench preparation script. The
printed destination must be outside OneDrive. From that staged directory:

```bash
python -m platformio run -e esp32-s3          # fleet image
python -m platformio run -e prototype-22      # Prototype 22 image
```

Record each `firmware.bin` SHA-256 with the node/device ID. The build is not a
flash authorization. Do not erase NVS or LittleFS during normal upgrades.

## 6. Commission fleet nodes

Apply the database migrations and deploy the server route before revoking old
anonymous writes. Then, one node at a time:

1. Obtain a fresh direct `elephant` authorization before flashing; this is a
   project safety gate, not something inferred from this document.
2. Flash the staged `esp32-s3` image over USB.
3. Join the password-protected `ULT-Freezer-Setup-XXXX` AP.
4. Enter Wi-Fi credentials, the freezer number, and that node's unique ingest
   secret.
5. Add the same `freezer-NN` → secret mapping to Vercel if it is not already
   present.
6. Confirm NTP synchronization, `[reading] posted`, and a real row with
   `device_id`, `observation_id`, `clock_valid=true`, and `recorded_at`.
7. Label the enclosure and record the firmware hash, board identity, probe
   identity, and freezer mapping.

If the sensor is absent or NTP is invalid, the node must not create a
temperature observation. It may retain valid queued rows and retry later.

## 7. Prototype 22

Build the `prototype-22` image with the isolated Wi-Fi header and compiled
`DEVICE_INGEST_SECRET`. Add `prototype-22` to the server secret map. After the
same direct flash authorization and USB upload gate, verify a genuine probe
reading in `prototype_readings`; never insert a test row.

## 8. OTA updates

Read [OTA_RUNBOOK.md](OTA_RUNBOOK.md) before the first release. Existing nodes
need one authorized USB baseline flash with the rollback-enabled bootloader;
an app-only OTA cannot replace an already-installed bootloader. After that,
use a one-node canary and preserve the last-known-good binary and SHA-256:

```bash
python -m platformio run -e esp32-s3-ota -t upload \
  --upload-port ult-freezer-07.local \
  --upload-password "$OTA_PASSWORD"
```

Always supply the exact target; `platformio.ini` intentionally has no default
OTA host. The new app is confirmed after a 30-second stable health window. If
it resets before confirmation, the bootloader should select the previous valid
slot. If it has already passed validation but is functionally bad, upload the
preserved last-known-good image explicitly. OTA is disabled if the local
security header is missing or contains a placeholder hash. Keep the device
secret, OTA password, and server map aligned when replacing a node. Rotate a
compromised device secret in Vercel and re-provision that node; do not
re-enable anonymous inserts.

## 9. Read-only verification

From the repository checkout, use the existing read-only checks:

```powershell
powershell -ExecutionPolicy Bypass -File supabase/verify.ps1
node scripts/prototype-check.mjs --serial-log .\serial.log
```

These checks do not prove physical sensor validity. A valid deployment requires
the serial reading, authenticated HTTP success, matching database row, and
dashboard display to agree. Keep reports out of Git if they contain internal
network or hardware identifiers.

## Rollback and incident response

- Roll back the Vercel deployment if the dashboard or ingestion route is bad.
- Do not roll back the database by restoring anonymous INSERT access.
- If a firmware release is bad, stop OTA, retain the last-known-good image and
  hash, and follow [OTA_RUNBOOK.md](OTA_RUNBOOK.md). A failed first boot should
  recover automatically only on nodes with the rollback-enabled bootloader.
- If a service-role key or device secret leaks, rotate it in the deployment
  environment and update affected nodes. Never paste the replacement into a
  commit, issue, log, or chat.

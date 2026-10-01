# Current repository status

This is the short repository-only index. It describes code and documentation
in this checkout; it is not evidence that Supabase, Vercel, an OTA node, or
hardware has been changed.

## Implemented here

- Firmware classifies upload results, backs off queue retries, logs queue
  trimming, and only services OTA when the listener is active.
- Ingest requires JSON, bounds the upstream request, emits correlation IDs,
  records payload version 1, and reports received/accepted/duplicate counts.
- Supabase has migrations for payload versioning and a tier-scoped batched
  latest-reading RPC; the dashboard uses that RPC instead of 21 refresh queries.
- PlatformIO dependencies are pinned and `scripts/create-release-manifest.mjs`
  records artifact size, SHA-256, and Git revision without credentials.
- Operator procedures live in [RELEASE_CHECKLIST.md](docs/RELEASE_CHECKLIST.md)
  and [DATA_OPERATIONS.md](docs/DATA_OPERATIONS.md).

## Still operator-only

- Apply migrations through `010_latest_readings_rpc.sql` to the intended live
  project and deploy the matching application revision.
- Configure provider-level rate limiting/WAF and server secrets.
- Perform backup/PITR and restore rehearsal.
- Qualify the physical probe for the freezer temperature range.
- Complete Prototype 22 bench acceptance.
- Establish the rollback-enabled USB baseline and canary OTA test.

No item above authorizes a flash. A future direct `elephant` message is still
required before any physical flashing operation.

## Local verification

From a clean checkout staged outside OneDrive, run the commands appropriate to
the installed toolchains:

```text
cd web && npm test && npm run typecheck && npm run build
cd ../firmware && python -m platformio test -e native
powershell -ExecutionPolicy Bypass -File supabase/verify.ps1
```

The last command is read-only but requires local dashboard settings and live
API access. Preserve reports outside Git.

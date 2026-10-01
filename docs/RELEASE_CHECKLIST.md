# Repository release checklist

This checklist is the handoff for an operator making a release. It is not
authorization to flash hardware or change a live service.

## Source and local verification

- [ ] Clone outside OneDrive or another sync folder.
- [ ] `git status --short --branch` is clean.
- [ ] No local security headers, `.env.local`, serial logs, or generated images
      are tracked.
- [ ] `web` unit tests pass.
- [ ] `web` typecheck and production build pass.
- [ ] Firmware native tests pass.
- [ ] Fleet, Prototype 22, and diagnostic firmware images build from the exact
      pinned PlatformIO dependencies.
- [ ] Prototype identity markers are absent from the fleet image.
- [ ] Create a release manifest with
      `scripts/create-release-manifest.mjs` for every image handed off.

## Database and application

- [ ] For a new project, apply `supabase/schema.sql` and
      `supabase/prototype22.sql` once.
- [ ] For an existing project, apply migrations `001` through `010` in order
      and record each application in the private operations log.
- [ ] Confirm `payload_version=1` is present and
      `readings_latest(text)` is callable by the dashboard role.
- [ ] Configure browser-visible and server-only environment variables in the
      deployment provider's secret store.
- [ ] Configure provider-level rate limiting/WAF for `/api/ingest`.
- [ ] Deploy the web revision only after the matching schema is present.
- [ ] Run `supabase/verify.ps1` and preserve its report outside Git.
- [ ] Check `/`, `/freezer/1`, and `/prototype/22` in a browser.

## Firmware and OTA

- [ ] Confirm the approved image hash matches the release manifest.
- [ ] Confirm the last-known-good image and rollback notes are available.
- [ ] Confirm the node target by label/MAC/IP; never infer it from a default.
- [ ] Obtain the required fresh direct flash authorization before any USB
      baseline flash. This document cannot grant it.
- [ ] For OTA, update one canary only and capture pending/confirmed health
      validation plus one real authenticated reading.
- [ ] Keep the canary under observation before expanding the rollout.
- [ ] Record failed-release evidence before attempting rollback.

## Data protection and handoff

- [ ] Backup/PITR is enabled and its retention is recorded.
- [ ] A restore rehearsal has a dated result and named owner.
- [ ] Raw export and checksum are stored in the private archive.
- [ ] Device registry and two-person labels are complete.
- [ ] Secret rotation and incident contacts are documented.
- [ ] Hardware/probe qualification limitations are recorded; a successful
      software path does not qualify an out-of-range sensor.

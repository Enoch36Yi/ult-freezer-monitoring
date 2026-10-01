# Firmware OTA runbook

This is the operational path for updating a provisioned node without erasing
its freezer identity, Wi-Fi credentials, NVS, or LittleFS queue.

The firmware uses two application slots. A new image is written to the
inactive slot, then the ESP32 bootloader starts it as **pending verification**.
The application confirms it only after setup has completed, LittleFS mounted,
and the main loop has remained alive for 30 seconds. A panic, watchdog reset,
power loss, or other reset before confirmation returns the node to the previous
valid slot.

This is recovery from a bad application image, not a guarantee against every
hardware failure. A damaged bootloader, erased flash, invalid partition table,
or a board with no network and no serial access still needs USB recovery.

The OTA password hash is upload authentication on the trusted device network;
it is not cryptographic firmware signing. This repository does not enable
secure boot or flash encryption. Treat the release manifest, private network,
and canary procedure as required controls, and do not expose ArduinoOTA to the
public internet. If the hardware security posture requires signed images,
secure boot, or encrypted flash, make that a separately validated hardware and
bootloader release gate before calling the system production-secure.

## One-time baseline for existing nodes

Rollback is a bootloader feature. An OTA upload does not replace the
bootloader, so nodes first flashed before the rollback-enabled firmware was
introduced do not gain this protection from their first OTA update.

Before putting a node into unattended service:

1. Get a fresh direct `elephant` authorization before any flash.
2. USB-flash the current `esp32-s3` image once.
3. Confirm the serial log reaches `[ota] listening as ...` and
   `[reading] posted`.
4. Record the image SHA-256, board MAC, freezer ID, and date in the deployment
   log.

Do not erase flash for this baseline. A normal upload preserves the node's NVS
and LittleFS data. The firmware build uses the checked-in
`firmware/sdkconfig.defaults` and the two-slot `default.csv` partition table;
the build must not be changed to a single-app table.

## Release preparation

Work from a clean checkout staged outside OneDrive or another sync folder.
Increment `FIRMWARE_VERSION` in `firmware/include/config.h` for every image
that may be deployed. Build and hash the exact artifact:

```bash
cd firmware
python -m platformio run -e esp32-s3-ota
sha256sum .pio/build/esp32-s3-ota/firmware.bin
```

On PowerShell, use:

```powershell
Get-FileHash .pio\build\esp32-s3-ota\firmware.bin -Algorithm SHA256
```

Store the binary and its hash in the private release archive, not Git. Record
at least:

| Field | Value |
| --- | --- |
| Firmware version |  |
| Git commit |  |
| Image SHA-256 |  |
| Build environment | `esp32-s3-ota` |
| Rollback baseline installed? | yes / no |
| Canary node |  |
| Validation log / date |  |

The repository helper can produce the hash and source revision together:

```bash
node scripts/create-release-manifest.mjs --output release-manifest.json \
  .pio/build/esp32-s3-ota/firmware.bin
```

Keep the manifest with the binary and compare its SHA-256 to the artifact
selected for the canary. It contains no credentials and should not be treated
as proof that the node accepted the image.

Do not update the whole fleet at once. Use one canary node first, then wait for
its real authenticated reading and health-validation log before proceeding.

## Upload one node

The target is deliberately not hard-coded in `platformio.ini`. Resolve the
exact node first; mDNS is normally `ult-freezer-NN.local`, but an IP address is
also valid when the network blocks mDNS.

```bash
ping -4 ult-freezer-07.local
cd firmware
python -m platformio run -e esp32-s3-ota -t upload \
  --upload-port ult-freezer-07.local \
  --upload-password "$OTA_PASSWORD"
```

Use the equivalent local secret variable on PowerShell. Never put the password
in the repository, a script, a ticket, or a shell history that is retained by
the operator's environment. ArduinoOTA is intended for the trusted device
network; do not expose its port through the public internet.

Before running the upload, verify all of the following:

- the hostname/IP belongs to the labeled node being updated;
- the image hash is the approved release hash;
- the node has recently posted a real reading;
- the last-known-good image is available locally;
- no other OTA is running on that node;
- the direct flash authorization rule is satisfied if this is a physical
  baseline flash (OTA itself is not a reason to erase or USB-flash).

An interrupted upload is not accepted as a new boot slot. The existing image
continues running unless the complete update is accepted.

## What to verify after upload

Capture the node's serial output if possible. The expected sequence is:

```text
[ota] update starting; replacing the inactive slot with firmware 0.2.0
[ota] progress 10%
...
[ota] update complete; rebooting into the new slot
[boot] ULT freezer node, firmware 0.2.0, reset reason: software
[ota] firmware 0.2.0 pending health validation for 30 seconds
[ota] firmware 0.2.0 passed health validation; rollback cancelled
[reading] posted
```

The exact progress percentages and reset reason can vary. The two important
lines are `pending health validation` followed by `passed health validation`,
and then a real authenticated reading. A queued reading is not proof that the
new release reached the server.

Wait for the normal cadence and confirm the dashboard displays the expected
node. For a canary, leave enough time to observe at least one normal reading
after validation before updating another node.

## Bad-release recovery

If the new application crashes, watchdog-resets, or loses power before the
30-second confirmation, the bootloader should select the previous valid slot
on the next boot.

1. Stop the rollout and preserve the bad image, hash, serial log, and node ID.
2. Wait for the node to reboot, then check its same mDNS name or last-known IP.
3. Confirm the previous image is posting again. Its serial boot line identifies
   the version.
4. Do not retry the bad image. Mark the release failed in the release ledger.
5. Upload the last-known-good image to the node with the normal authenticated
   OTA command, or use USB only after the direct authorization gate.

Once a new image has printed `passed health validation`, automatic rollback for
that boot has been cancelled. If it is later found to be functionally wrong,
upload the preserved last-known-good image explicitly; the second slot still
makes that a network update as long as the node is reachable.

If the node never returns to the network, capture serial output if available.
If it is running the old image but cannot resolve mDNS, use its recorded IP.
If it is not booting and the board has the rollback-enabled bootloader, power
cycle once and allow the bootloader to select the previous slot. If it still
does not recover, stop and use the authorized USB recovery procedure. Do not
erase NVS or LittleFS unless data loss is explicitly accepted.

## Release ledger status

The `0.2.0` rollback implementation is committed, but this checkout has not
produced or flashed a new firmware artifact in the current environment. The
first physical pilot must still validate the build, the bootloader setting, a
successful OTA, and a deliberately interrupted/bad-image recovery scenario.

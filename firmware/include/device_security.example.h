#pragma once

// Copy to device_security.h (ignored by version control) and replace every
// placeholder with a deployment-specific value. Never commit the copied file.
// Generate secrets with a password manager or a cryptographically secure tool.

// Prototype builds use this compiled secret. Fleet builds store their secret in
// NVS through the provisioning portal.
#define DEVICE_INGEST_SECRET "replace-with-at-least-32-random-characters"

// Pinned ArduinoOTA/espota expects the password's lowercase MD5 digest.
// Leave the listener disabled until this is replaced with 32 lowercase hex
// characters. MD5 is required by this legacy authentication protocol; it is
// not a firmware signature. Keep the matching password in a password manager.
#define OTA_PASSWORD_HASH "replace-with-32-lowercase-hex-characters"

// The provisioning AP must never be open. Use a separate password from the
// ingest and OTA secrets, at least 12 characters long.
#define PROVISION_AP_PASSWORD "replace-with-a-strong-provisioning-password"

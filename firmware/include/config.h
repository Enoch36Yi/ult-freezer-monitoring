#pragma once

// ---------------------------------------------------------------------------
// Hardware
// ---------------------------------------------------------------------------
// Adafruit MAX31865 #3648, software SPI. These pins are not used by any other
// current firmware peripheral. The board's 4.3 kOhm reference resistor is
// already correct for the PT1000 and must not be replaced.
#define MAX31865_CS_PIN 4
#define MAX31865_MOSI_PIN 5
#define MAX31865_MISO_PIN 6
#define MAX31865_SCK_PIN 7

// ---------------------------------------------------------------------------
// Sampling / reporting
// ---------------------------------------------------------------------------
#define FIRMWARE_VERSION "0.3.0"
#define TELEMETRY_PAYLOAD_VERSION 1
#define SENSOR_TIER "esp32_pt1000_max31865"

#define FREEZER_ID_MIN 1
#define FREEZER_ID_MAX 21

// ---------------------------------------------------------------------------
// Telemetry API
// ---------------------------------------------------------------------------
// Firmware sends through the authenticated server-side ingestion endpoint.
// Keep the Supabase service credentials out of firmware entirely.
#define SUPABASE_URL "https://dfxxamgnrimwoumknuxa.supabase.co"
#define INGEST_URL "https://ult-freezres.vercel.app/api/ingest"
#ifdef PROTOTYPE_22
#define PROTOTYPE_ID 22
#endif

#define HTTP_TIMEOUT_MS 10000

// ---------------------------------------------------------------------------
// Offline buffer (LittleFS)
// ---------------------------------------------------------------------------
#ifdef PROTOTYPE_22
#define QUEUE_PATH "/prototype22-queue.jsonl"
#define QUEUE_TMP_PATH "/prototype22-queue.tmp"
#else
#define QUEUE_PATH "/queue.jsonl"
#define QUEUE_TMP_PATH "/queue.tmp"
#endif
// ~180 bytes/reading. A 1 MB queue holds about 3.8 days for core IDs 1-6
// (1-minute cadence) or about 58 days for fleet IDs 7-21 (15-minute cadence).
#define QUEUE_MAX_BYTES 1000000UL
// Readings per HTTPS request when draining the buffer. PostgREST accepts a
// JSON array insert, so a batch costs one TLS handshake instead of N. At one
// handshake per reading a full buffer would take hours to drain.
#define QUEUE_FLUSH_BATCH 50
// Batches per flush pass, so a huge backlog cannot starve sampling or OTA.
#define QUEUE_FLUSH_MAX_BATCHES 4
// Retry cadence for a backlog that did not clear in one pass.
#define QUEUE_FLUSH_RETRY_MS 60000UL
// A bad credential or payload must not hammer the ingestion endpoint forever.
// The queue remains intact for operator repair, but retries back off to this
// ceiling until a later network reconnect resets the schedule.
#define QUEUE_FLUSH_MAX_RETRY_MS (30UL * 60UL * 1000UL)

// ---------------------------------------------------------------------------
// Network / time
// ---------------------------------------------------------------------------
#define WIFI_PORTAL_AP_PREFIX "ULT-Freezer-Setup"
#define WIFI_RECONNECT_INTERVAL_MS 15000UL
#define NTP_RESYNC_INTERVAL_MS (6UL * 60UL * 60UL * 1000UL)  // every 6 hours
#define NTP_SERVER_1 "pool.ntp.org"
#define NTP_SERVER_2 "time.nist.gov"
// Store UTC. The dashboard renders local time.
#define TZ_SPEC "UTC0"

// A newly uploaded OTA slot must stay alive through this window before the
// bootloader considers it the last-known-good image. This catches boot loops,
// panics, watchdog resets, and power loss without making a node wait for NTP
// or the ingestion service to be available.
#define OTA_HEALTH_WINDOW_MS 30000UL

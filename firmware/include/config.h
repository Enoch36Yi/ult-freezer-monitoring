#pragma once

// ---------------------------------------------------------------------------
// Hardware
// ---------------------------------------------------------------------------
// DS18B20 DQ on GPIO4. Deliberately not a strapping pin (0, 3, 45, 46) and not
// an input-only pin. Single 6.8k pull-up from DQ to 3V3 on the bus.
#define ONEWIRE_PIN 4

// DS18B20 conversion resolution. 12-bit = 0.0625 C, ~750 ms conversion.
#define DS18B20_RESOLUTION 12

// Capture range — deliberately as wide as the sensor can represent.
//
// This is a sensor-comparison study and every real reading matters, so NOTHING
// is filtered on plausibility at capture time. The only rejected value is the
// library's disconnected-probe sentinel (-127 C), which is an error code, not
// a temperature. The bounds below sit just inside the DS18B20's representable
// range and exclude that sentinel; in practice nothing a probe can physically
// report will be dropped.
//
// Values that merely look odd — notably exactly 85.000 C, the DS18B20's
// power-on register default — are recorded and left for analysis-time
// filtering. A dropped reading becomes an unexplained gap, which is worse than
// a flagged outlier you can exclude later.
#define TEMP_VALID_MIN_C -126.0f
#define TEMP_VALID_MAX_C 127.0f

// ---------------------------------------------------------------------------
// Sampling / reporting
// ---------------------------------------------------------------------------
#define FIRMWARE_VERSION "0.2.0"
#define SENSOR_TIER "esp32_ds18b20"

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

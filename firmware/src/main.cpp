// ---------------------------------------------------------------------------
// ULT Freezer Monitoring Node
//
// ESP32-S3 Supermini + one DS18B20 on GPIO4. The fleet image serves the 21
// freezers; the separate prototype-22 image serves an isolated bench sensor.
// Readings are queued in LittleFS while offline and flushed on reconnect.
// ---------------------------------------------------------------------------

#include <Arduino.h>

#include <ArduinoJson.h>
#include <ArduinoOTA.h>
#include <DallasTemperature.h>
#include <HTTPClient.h>
#include <LittleFS.h>
#include <OneWire.h>
#include <Preferences.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <WiFiManager.h>
#include <mbedtls/md.h>
#include <esp_system.h>
#include <time.h>

#include "config.h"
#include "queue_presence.h"
#include "sampling_policy.h"
#include "supabase_root_ca.h"
#if __has_include("device_security.h")
#include "device_security.h"
#define DEVICE_SECURITY_CONFIGURED 1
#else
#define DEVICE_SECURITY_CONFIGURED 0
#endif
#ifdef PROTOTYPE_22
#include "prototype22_wifi.h"
#endif
#ifdef ONEWIRE_DIAG
#include "onewire_diag.h"
#endif

// --- Globals ---------------------------------------------------------------

static OneWire g_oneWire(ONEWIRE_PIN);
static DallasTemperature g_sensors(&g_oneWire);
static DeviceAddress g_probeAddress;
static bool g_probeFound = false;

static Preferences g_prefs;
static int g_freezerId = 0;
static String g_ingestSecret;
static uint64_t g_bootId = 0;
static uint32_t g_sampleSequence = 0;
static bool g_observationIdentityReady = false;

static bool g_wifiWasConnected = false;
static uint32_t g_lastReconnectAttempt = 0;
static uint32_t g_lastSampleAt = 0;
static uint32_t g_sampleIntervalMs = FLEET_SAMPLE_INTERVAL_MS;
static uint32_t g_lastNtpSyncAt = 0;
static bool g_ntpEverSynced = false;

// The reset reason rides along on the first reading produced after boot, so a
// node that is brownout-looping shows up in the data instead of just going
// quiet. Cleared once that reading is either posted or safely queued.
static String g_pendingResetReason;
static QueuePresence g_queuePresence;
static bool g_filesystemReady = false;

// --- Small helpers ---------------------------------------------------------

static const char *resetReasonName(esp_reset_reason_t reason) {
  switch (reason) {
    case ESP_RST_POWERON:   return "poweron";
    case ESP_RST_EXT:       return "external";
    case ESP_RST_SW:        return "software";
    case ESP_RST_PANIC:     return "panic";
    case ESP_RST_INT_WDT:   return "int_wdt";
    case ESP_RST_TASK_WDT:  return "task_wdt";
    case ESP_RST_WDT:       return "other_wdt";
    case ESP_RST_DEEPSLEEP: return "deepsleep";
    case ESP_RST_BROWNOUT:  return "brownout";
    case ESP_RST_SDIO:      return "sdio";
    default:                return "unknown";
  }
}

// True once the clock is past 2023-01-01, i.e. NTP has actually landed and the
// RTC is no longer sitting at the 1970 epoch.
static bool clockIsValid() {
  time_t now = time(nullptr);
  return now > 1672531200;
}

// RFC 3339 / ISO 8601 in UTC, which is what timestamptz wants.
static String isoTimestampUtc() {
  time_t now = time(nullptr);
  struct tm tmUtc;
  gmtime_r(&now, &tmUtc);
  char buf[32];
  strftime(buf, sizeof(buf), "%Y-%m-%dT%H:%M:%SZ", &tmUtc);
  return String(buf);
}

static String apName() {
  uint64_t mac = ESP.getEfuseMac();
  char suffix[8];
  snprintf(suffix, sizeof(suffix), "%04X", (uint16_t)(mac & 0xFFFF));
  return String(WIFI_PORTAL_AP_PREFIX) + "-" + suffix;
}

static String otaHostname() {
#ifdef PROTOTYPE_22
  return "ult-prototype-22";
#else
  char host[32];
  snprintf(host, sizeof(host), "ult-freezer-%02d", g_freezerId);
  return String(host);
#endif
}

static String deviceId() {
#ifdef PROTOTYPE_22
  return "prototype-22";
#else
  char id[16];
  snprintf(id, sizeof(id), "freezer-%02d", g_freezerId);
  return String(id);
#endif
}

static bool initObservationIdentity() {
  g_prefs.begin("obs", false);
  const uint64_t previous = g_prefs.getULong64("boot_id", 0);
  const uint64_t next = previous + 1;
  const size_t written = g_prefs.putULong64("boot_id", next);
  g_prefs.end();
  if (written == 0) {
    Serial.println("[obs] could not persist boot counter; refusing telemetry");
    return false;
  }
  g_bootId = next;
  g_sampleSequence = 0;
  g_observationIdentityReady = true;
  return true;
}

static String observationId(uint32_t sampleSequence) {
  char id[96];
  snprintf(id, sizeof(id), "%s-%llu-%lu", deviceId().c_str(),
           static_cast<unsigned long long>(g_bootId),
           static_cast<unsigned long>(sampleSequence));
  return String(id);
}

static bool ingestSecretIsUsable(const String &secret) {
  return secret.length() >= 32 && !secret.startsWith("replace-");
}

static bool otaPasswordHashIsUsable() {
#if DEVICE_SECURITY_CONFIGURED
  const String hash = OTA_PASSWORD_HASH;
  if (hash.length() != 64 || hash.startsWith("replace-")) return false;
  for (size_t i = 0; i < hash.length(); i++) {
    const char c = hash[i];
    const bool hex = (c >= '0' && c <= '9') ||
                     (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F');
    if (!hex) return false;
  }
  return true;
#else
  return false;
#endif
}

static String ingestSecret() {
#ifdef PROTOTYPE_22
#if DEVICE_SECURITY_CONFIGURED
  return String(DEVICE_INGEST_SECRET);
#else
  return String();
#endif
#else
  return g_ingestSecret;
#endif
}

static bool signBody(const String &body, const String &secret, char output[65]) {
  if (!ingestSecretIsUsable(secret)) return false;
  const mbedtls_md_info_t *info = mbedtls_md_info_from_type(MBEDTLS_MD_SHA256);
  if (info == nullptr) return false;
  unsigned char digest[32];
  const int result = mbedtls_md_hmac(
      info,
      reinterpret_cast<const unsigned char *>(secret.c_str()), secret.length(),
      reinterpret_cast<const unsigned char *>(body.c_str()), body.length(),
      digest);
  if (result != 0) return false;
  for (size_t i = 0; i < sizeof(digest); i++) {
    snprintf(output + (i * 2), 3, "%02x", digest[i]);
  }
  output[64] = '\0';
  return true;
}

// --- Provisioning ----------------------------------------------------------

static WiFiManager g_wm;
static WiFiManagerParameter *g_freezerParam = nullptr;
static WiFiManagerParameter *g_ingestSecretParam = nullptr;

static bool freezerIdIsValid(int id) {
  return id >= FREEZER_ID_MIN && id <= FREEZER_ID_MAX;
}

// Parses the portal field strictly: the whole string must be an integer in
// range, so "12abc" or "" are rejected rather than silently becoming 12 or 0.
static int parseFreezerId(const char *raw) {
  if (raw == nullptr) return 0;
  String s(raw);
  s.trim();
  if (s.isEmpty()) return 0;
  for (size_t i = 0; i < s.length(); i++) {
    if (!isDigit(s[i])) return 0;
  }
  return s.toInt();
}

static void saveFreezerId(int id) {
  g_prefs.begin("ult", false);
  g_prefs.putInt("freezer_id", id);
  g_prefs.end();
  g_freezerId = id;
}

static int loadFreezerId() {
  g_prefs.begin("ult", true);
  int id = g_prefs.getInt("freezer_id", 0);
  g_prefs.end();
  return id;
}

#ifndef PROTOTYPE_22
static String loadIngestSecret() {
  g_prefs.begin("ult", true);
  String secret = g_prefs.getString("ingest_secret", "");
  g_prefs.end();
  return secret;
}

static void saveIngestSecret(const String &secret) {
  g_prefs.begin("ult", false);
  g_prefs.putString("ingest_secret", secret);
  g_prefs.end();
  g_ingestSecret = secret;
}
#endif

static bool provisionApPasswordIsUsable() {
#if DEVICE_SECURITY_CONFIGURED
  const String password = PROVISION_AP_PASSWORD;
  return password.length() >= 12 && !password.startsWith("replace-");
#else
  return false;
#endif
}

static const char *provisionApPassword() {
#if DEVICE_SECURITY_CONFIGURED
  return PROVISION_AP_PASSWORD;
#else
  return nullptr;
#endif
}

static void onPortalParamsSaved() {
  int id = parseFreezerId(g_freezerParam->getValue());
  if (freezerIdIsValid(id)) {
    Serial.printf("[provision] freezer number set to %d\n", id);
    saveFreezerId(id);
  } else {
    Serial.printf("[provision] rejected freezer number '%s' (want %d-%d)\n",
                  g_freezerParam->getValue(), FREEZER_ID_MIN, FREEZER_ID_MAX);
  }
#ifndef PROTOTYPE_22
  const String secret = g_ingestSecretParam->getValue();
  if (ingestSecretIsUsable(secret)) {
    saveIngestSecret(secret);
    Serial.println("[provision] device ingest secret saved");
  } else {
    Serial.println("[provision] rejected device ingest secret; need 32+ random characters");
  }
#endif
}

// Brings up WiFi and guarantees a valid freezer number before returning.
//
// A node that has already been commissioned NEVER opens the blocking portal.
// If it did, any reboot while the AP happened to be down — a router restart, a
// building power event, a brownout — would park the node in the portal
// forever: no sampling, no buffering, no data, until someone physically
// noticed. On an unattended multi-week study across 21 units that is the worst
// failure mode in the system. A commissioned node instead starts connecting
// and drops straight into loop(), where serviceWifi() retries indefinitely and
// readings buffer to flash meanwhile.
//
// To re-provision deliberately, erase NVS: `pio run -t erase`.
static void provision() {
#ifdef PROTOTYPE_22
  // Ignore any Freezer 1 identity and Wi-Fi saved on a previously used board.
  // Keeping Wi-Fi persistence off also preserves those credentials in NVS if
  // the original fleet image is restored later.
  WiFi.persistent(false);
  Serial.println("[provision] prototype 22, connecting to compiled WiFi");
  WiFi.begin(PROTOTYPE22_WIFI_SSID, PROTOTYPE22_WIFI_PASSWORD);
  for (int i = 0; i < 40 && WiFi.status() != WL_CONNECTED; i++) {
    delay(250);
  }
  if (WiFi.status() == WL_CONNECTED) {
    Serial.printf("[provision] ip %s\n", WiFi.localIP().toString().c_str());
  } else {
    Serial.println("[provision] no AP yet; will keep retrying");
  }
  return;
#else
  g_freezerId = loadFreezerId();
  g_ingestSecret = loadIngestSecret();

  if (freezerIdIsValid(g_freezerId) && ingestSecretIsUsable(g_ingestSecret)) {
    Serial.printf("[provision] freezer %d from NVS, connecting\n", g_freezerId);
    WiFi.begin();  // no args: reuses the stored credentials

    // Brief opportunistic wait so the first reading usually goes out live
    // rather than to the buffer. Bounded, and failure here is not fatal.
    for (int i = 0; i < 40 && WiFi.status() != WL_CONNECTED; i++) {
      delay(250);
    }

    if (WiFi.status() == WL_CONNECTED) {
      Serial.printf("[provision] ip %s\n", WiFi.localIP().toString().c_str());
    } else {
      Serial.println(
          "[provision] no AP yet; will keep retrying and buffer meanwhile");
    }
    return;
  }

  if (!provisionApPasswordIsUsable()) {
    Serial.println("[provision] disabled: configure a provisioning AP password");
    ESP.restart();
    return;
  }

  // First boot only. Blocking is correct here — someone is standing at the
  // bench waiting to fill the form in.
  char idBuf[8] = "";
  if (freezerIdIsValid(g_freezerId)) {
    snprintf(idBuf, sizeof(idBuf), "%d", g_freezerId);
  }
  char secretBuf[129] = "";
  g_ingestSecret.toCharArray(secretBuf, sizeof(secretBuf));

  static const char kHint[] =
      "<p style='margin:0 0 6px'>Which freezer is this node on? "
      "Enter a whole number from 1 to 21.</p>";

  g_freezerParam = new WiFiManagerParameter(
      "freezer_id", "Freezer number (1-21)", idBuf, 4,
      "type='number' min='1' max='21' step='1' required");
  g_ingestSecretParam = new WiFiManagerParameter(
      "ingest_secret", "Device ingest secret", secretBuf, 128,
      "type='password' minlength='32' required");
  static WiFiManagerParameter hint(kHint);

  g_wm.addParameter(&hint);
  g_wm.addParameter(g_freezerParam);
  g_wm.addParameter(g_ingestSecretParam);
  g_wm.setSaveParamsCallback(onPortalParamsSaved);
  g_wm.setConfigPortalBlocking(true);
  g_wm.setConfigPortalTimeout(0);  // stay in the portal until provisioned
  g_wm.setBreakAfterConfig(true);
  g_wm.setTitle("ULT Freezer Node");

  const String ap = apName();
  Serial.printf("[provision] portal AP: %s\n", ap.c_str());

  // autoConnect() returns straight away when NVS already holds credentials.
  if (!g_wm.autoConnect(ap.c_str(), provisionApPassword())) {
    Serial.println("[provision] portal exited without a connection, restarting");
    ESP.restart();
  }

  // Credentials can be saved from a previous life while the freezer number
  // never was (or was entered out of range). Force the portal until it is set.
  while (!freezerIdIsValid(g_freezerId) || !ingestSecretIsUsable(g_ingestSecret)) {
    Serial.println("[provision] identity or device secret missing, reopening portal");
    if (!g_wm.startConfigPortal(ap.c_str(), provisionApPassword())) {
      Serial.println("[provision] portal exited, restarting");
      ESP.restart();
    }
    g_freezerId = loadFreezerId();
    g_ingestSecret = loadIngestSecret();
  }

  Serial.printf("[provision] freezer %d, ip %s\n", g_freezerId,
                WiFi.localIP().toString().c_str());
#endif
}

// --- Time ------------------------------------------------------------------

static void syncNtp(bool blocking) {
  configTzTime(TZ_SPEC, NTP_SERVER_1, NTP_SERVER_2);
  g_lastNtpSyncAt = millis();

  if (!blocking) return;

  Serial.print("[ntp] syncing");
  for (int i = 0; i < 30 && !clockIsValid(); i++) {
    delay(500);
    Serial.print('.');
  }
  Serial.println();

  if (clockIsValid()) {
    g_ntpEverSynced = true;
    Serial.printf("[ntp] %s\n", isoTimestampUtc().c_str());
  } else {
    Serial.println("[ntp] sync failed; timestamped readings remain paused");
  }
}

// --- Offline queue ---------------------------------------------------------

// Recover a fully-written replacement file after a power cut or a failed
// remove/rename sequence. If the original queue still exists it wins because
// it is the last known complete copy.
static bool recoverQueueTemp() {
  if (!g_filesystemReady) return false;
  const bool hasQueue = LittleFS.exists(QUEUE_PATH);
  if (!LittleFS.exists(QUEUE_TMP_PATH)) return true;
  if (hasQueue) {
    if (!LittleFS.remove(QUEUE_TMP_PATH)) {
      Serial.println("[queue] could not discard stale temp file; preserving queue");
      return false;
    }
    Serial.println("[queue] discarded partial temp file from interrupted write");
    return true;
  }
  if (!LittleFS.rename(QUEUE_TMP_PATH, QUEUE_PATH)) {
    Serial.println("[queue] could not recover temp queue file");
    return false;
  }
  Serial.println("[queue] recovered queue from temp file after interrupted write");
  return true;
}

static void mountFilesystem() {
  if (!LittleFS.begin(false)) {
    Serial.println("[fs] mount failed; refusing to format so buffered data is preserved");
    return;
  }
  g_filesystemReady = true;
  Serial.printf("[fs] mounted, %u bytes free\n",
                (unsigned)(LittleFS.totalBytes() - LittleFS.usedBytes()));

  recoverQueueTemp();
  g_queuePresence.onMount(LittleFS.exists(QUEUE_PATH));
}

// Drops the oldest half of the queue when it hits the cap. Losing the oldest
// readings is the right trade when a node has been offline long enough to fill
// flash: the recent history is what anyone will look at first.
static bool trimQueueIfNeeded() {
  if (!g_filesystemReady) return false;
  if (!g_queuePresence.hasData()) return true;
  if (!recoverQueueTemp()) return false;
  File f = LittleFS.open(QUEUE_PATH, FILE_READ);
  if (!f) return false;
  const size_t size = f.size();
  if (size < QUEUE_MAX_BYTES) {
    f.close();
    return true;
  }

  Serial.printf("[queue] %u bytes, trimming oldest half\n", (unsigned)size);
  f.seek(size / 2);
  f.readStringUntil('\n');  // discard the partial line we landed in

  File out = LittleFS.open(QUEUE_TMP_PATH, FILE_WRITE);
  if (!out) {
    f.close();
    return false;
  }
  bool complete = true;
  while (f.available()) {
    String line = f.readStringUntil('\n');
    line.trim();
    if (!line.isEmpty()) {
      if (out.println(line) == 0) {
        complete = false;
        break;
      }
    }
  }
  out.close();
  f.close();

  if (!complete) {
    Serial.println("[queue] trim write failed; original queue preserved");
    return false;
  }
  if (!LittleFS.remove(QUEUE_PATH)) {
    Serial.println("[queue] trim could not remove original queue; preserving both copies");
    return false;
  }
  if (!LittleFS.rename(QUEUE_TMP_PATH, QUEUE_PATH)) {
    Serial.println("[queue] trim could not install replacement queue");
    return recoverQueueTemp();
  }
  return true;
}

static bool enqueueReading(const String &json) {
  if (!g_filesystemReady || !trimQueueIfNeeded() || !recoverQueueTemp()) {
    Serial.println("[queue] filesystem unavailable; reading not acknowledged");
    return false;
  }
  File f = LittleFS.open(QUEUE_PATH, FILE_APPEND);
  if (!f) {
    Serial.println("[queue] could not open queue file; reading not acknowledged");
    return false;
  }
  const size_t written = f.println(json);
  f.close();
  if (written != json.length() + 1) {
    Serial.println("[queue] incomplete write; reading not acknowledged");
    return false;
  }
  g_queuePresence.onBuffered();
  Serial.println("[queue] buffered reading to LittleFS");
  return true;
}

static size_t queuedCount() {
  if (!g_filesystemReady || !recoverQueueTemp()) return 0;
  File f = LittleFS.open(QUEUE_PATH, FILE_READ);
  if (!f) return 0;
  size_t n = 0;
  while (f.available()) {
    String line = f.readStringUntil('\n');
    line.trim();
    if (!line.isEmpty()) n++;
  }
  f.close();
  return n;
}

// --- Posting ---------------------------------------------------------------

// Posts one already-serialized JSON object to the readings table.
static bool postJson(const String &body) {
  if (WiFi.status() != WL_CONNECTED) return false;

  const String secret = ingestSecret();
  char signature[65];
  if (!signBody(body, secret, signature)) {
    Serial.println("[auth] device secret is not configured; refusing telemetry");
    return false;
  }

  WiFiClientSecure client;
  client.setCACert(SUPABASE_ROOT_CA);

  HTTPClient http;
  http.setTimeout(HTTP_TIMEOUT_MS);
  http.setConnectTimeout(HTTP_TIMEOUT_MS);

  if (!http.begin(client, INGEST_URL)) {
    Serial.println("[http] begin failed");
    return false;
  }

  http.addHeader("Content-Type", "application/json");
  http.addHeader("X-Device-Id", deviceId());
  http.addHeader("X-Device-Signature", signature);
  http.addHeader("Prefer", "return=minimal");

  const int status = http.POST(body);
  const bool ok = (status >= 200 && status < 300);

  if (!ok) {
    Serial.printf("[http] POST failed, status %d: %s\n", status,
                  http.errorToString(status).c_str());
  }

  http.end();
  return ok;
}

// Pushes queued readings oldest-first, in batches. Stops at the first failed
// batch and keeps it plus everything after it, so ordering is never scrambled
// and nothing is acknowledged that the server did not accept.
//
// Batching matters: a full buffer can hold thousands of readings, and at one
// TLS handshake per reading it would take hours to drain. One array
// insert per 50 readings turns that into minutes.
static void flushQueue() {
  if (!g_filesystemReady || !g_queuePresence.hasData()) return;
  if (WiFi.status() != WL_CONNECTED) return;
  if (!recoverQueueTemp()) return;

  const size_t pending = queuedCount();
  if (pending == 0) {
    if (LittleFS.remove(QUEUE_PATH)) {
      g_queuePresence.onFlushRemaining(0);
    } else {
      Serial.println("[queue] could not remove empty queue file");
    }
    return;
  }
  Serial.printf("[queue] flushing %u buffered readings\n", (unsigned)pending);

  File in = LittleFS.open(QUEUE_PATH, FILE_READ);
  if (!in) return;

  size_t sent = 0;
  size_t batches = 0;
  bool stalled = false;
  // File offset of the first reading in the batch being built. On failure we
  // rewind here so the whole batch is preserved, not half-acknowledged.
  size_t batchStart = in.position();

  while (in.available() && !stalled) {
    String body = "[";
    size_t inBatch = 0;
    batchStart = in.position();

    while (in.available() && inBatch < QUEUE_FLUSH_BATCH) {
      String line = in.readStringUntil('\n');
      line.trim();
      if (line.isEmpty()) continue;
      if (inBatch > 0) body += ',';
      body += line;
      inBatch++;
    }

    if (inBatch == 0) break;
    body += ']';

    if (postJson(body)) {
      sent += inBatch;
      batches++;
      ArduinoOTA.handle();
      if (batches >= QUEUE_FLUSH_MAX_BATCHES) {
        // Yield to loop() so sampling and OTA are not starved; the rest goes
        // out on the next retry, which serviceQueue() schedules.
        stalled = true;
      }
    } else {
      in.seek(batchStart);  // nothing in this batch was accepted
      stalled = true;
    }
  }

  // Copy whatever is left, verbatim and in order, into the replacement file.
  size_t kept = 0;
  File out = LittleFS.open(QUEUE_TMP_PATH, FILE_WRITE);
  if (!out) {
    in.close();
    Serial.println("[queue] could not open temp file; queue left intact");
    return;
  }
  bool complete = true;
  while (in.available()) {
    String line = in.readStringUntil('\n');
    line.trim();
    if (line.isEmpty()) continue;
    if (out.println(line) == 0) {
      complete = false;
      break;
    }
    kept++;
  }
  out.close();
  in.close();

  if (!complete) {
    Serial.println("[queue] flush copy failed; original queue preserved");
    return;
  }

  // Remove-then-rename leaves a window where only the temp file exists;
  // mountFilesystem() adopts it on the next boot.
  if (!LittleFS.remove(QUEUE_PATH)) {
    Serial.println("[queue] flush could not remove original queue; preserving both copies");
    return;
  }
  if (kept > 0) {
    if (!LittleFS.rename(QUEUE_TMP_PATH, QUEUE_PATH)) {
      Serial.println("[queue] flush could not install replacement queue");
      recoverQueueTemp();
      return;
    }
  } else {
    if (!LittleFS.remove(QUEUE_TMP_PATH)) {
      Serial.println("[queue] flushed queue but could not remove empty temp file");
      return;
    }
  }
  g_queuePresence.onFlushRemaining(kept);

  Serial.printf("[queue] flushed %u, %u still buffered\n", (unsigned)sent,
                (unsigned)kept);
}

// Retries a backlog that did not clear in one pass. Without this a flush that
// hit its batch cap would sit untouched until the next WiFi reconnect, which
// on a stable network may never come.
static void serviceQueue() {
  static uint32_t lastAttempt = 0;
  if (WiFi.status() != WL_CONNECTED) return;
  if (!g_queuePresence.hasData()) return;
  const uint32_t now = millis();
  if (now - lastAttempt < QUEUE_FLUSH_RETRY_MS) return;
  lastAttempt = now;
  flushQueue();
}

// --- Sampling --------------------------------------------------------------

static void initSensor() {
  g_sensors.begin();
  g_sensors.setResolution(DS18B20_RESOLUTION);
  g_sensors.setWaitForConversion(true);

  if (g_sensors.getDeviceCount() > 0 && g_sensors.getAddress(g_probeAddress, 0)) {
    g_probeFound = true;
    Serial.printf("[sensor] DS18B20 found on GPIO%d\n", ONEWIRE_PIN);
  } else {
    Serial.println("[sensor] no DS18B20 on the bus; check DQ wiring and the 6.8k pull-up");
  }
#ifdef ONEWIRE_DIAG
  // Once at boot as a baseline, then on every failed re-scan (each sample).
  oneWireDiagnose(g_oneWire, ONEWIRE_PIN);
#endif
}

static String buildReading(float tempC) {
  JsonDocument doc;
#ifdef PROTOTYPE_22
  doc["prototype_id"] = PROTOTYPE_ID;
#else
  doc["freezer_id"] = g_freezerId;
#endif
  doc["device_id"] = deviceId();
  doc["observation_id"] = observationId(g_sampleSequence);
  doc["sensor_tier"] = SENSOR_TIER;
  // Fixed 3 decimals, well inside the DS18B20's 0.0625 C step, and avoids
  // float round-trip noise in the JSON.
  doc["temp_c"] = serialized(String(tempC, 3));
  doc["rssi"] = WiFi.RSSI();
  doc["recorded_at"] = isoTimestampUtc();
  doc["clock_valid"] = true;

  if (!g_pendingResetReason.isEmpty()) {
    doc["reset_reason"] = g_pendingResetReason;
  }

  String out;
  serializeJson(doc, out);
  return out;
}

static void sampleAndSend() {
  if (!g_observationIdentityReady) {
    Serial.println("[obs] observation identity unavailable; skipping reading");
    return;
  }
  if (!clockIsValid()) {
    Serial.println("[reading] clock invalid; waiting for NTP before sampling");
    return;
  }
  if (!g_probeFound) {
    // Recovery path: re-scan in case the probe was reseated.
    initSensor();
    if (!g_probeFound) return;
  }

  g_sensors.requestTemperatures();
  const float tempC = g_sensors.getTempC(g_probeAddress);

  if (tempC == DEVICE_DISCONNECTED_C || tempC < TEMP_VALID_MIN_C ||
      tempC > TEMP_VALID_MAX_C) {
    Serial.printf("[sensor] bad reading (%.2f C), skipping\n", tempC);
    g_probeFound = false;
    return;
  }

  ++g_sampleSequence;
  const String payload = buildReading(tempC);
  Serial.printf("[reading] %s\n", payload.c_str());

  if (WiFi.status() == WL_CONNECTED && postJson(payload)) {
    Serial.println("[reading] posted");
    g_pendingResetReason = "";
  } else if (enqueueReading(payload)) {
    // The reset reason is cleared only after the line is durably appended.
    g_pendingResetReason = "";
  } else {
    Serial.println("[reading] not delivered or buffered; retaining reset reason");
  }
}

// --- WiFi lifecycle --------------------------------------------------------

static bool g_otaStarted = false;
static bool initOta();

static void onWifiConnected() {
  Serial.printf("[wifi] connected, ip %s, rssi %d\n",
                WiFi.localIP().toString().c_str(), WiFi.RSSI());
  if (!g_ntpEverSynced) {
    syncNtp(true);
  }
  // mDNS and the OTA listener need a live network, so they start here rather
  // than unconditionally in setup() — a node that booted while the AP was down
  // still picks up OTA the moment the network returns.
  if (!g_otaStarted) {
    g_otaStarted = initOta();
  }
  flushQueue();
}

static void serviceWifi() {
  const bool connected = (WiFi.status() == WL_CONNECTED);

  if (connected && !g_wifiWasConnected) {
    g_wifiWasConnected = true;
    onWifiConnected();
    return;
  }

  if (!connected) {
    if (g_wifiWasConnected) {
      Serial.println("[wifi] link lost, buffering to LittleFS");
      g_wifiWasConnected = false;
    }
    const uint32_t now = millis();
    if (now - g_lastReconnectAttempt >= WIFI_RECONNECT_INTERVAL_MS) {
      g_lastReconnectAttempt = now;
      Serial.println("[wifi] reconnecting");
      // begin() not reconnect(): after a boot with the AP down there is no
      // prior connection to re-establish, and reconnect() is a no-op there.
#ifdef PROTOTYPE_22
      WiFi.begin(PROTOTYPE22_WIFI_SSID, PROTOTYPE22_WIFI_PASSWORD);
#else
      WiFi.begin();
#endif
    }
  }
}

static void serviceNtp() {
  if (WiFi.status() != WL_CONNECTED) return;
  if (!clockIsValid()) {
    if (millis() - g_lastNtpSyncAt >= 60000UL) {
      Serial.println("[ntp] retrying before allowing measurements");
      syncNtp(false);
    }
    return;
  }
  if (millis() - g_lastNtpSyncAt < NTP_RESYNC_INTERVAL_MS) return;
  Serial.println("[ntp] periodic resync");
  syncNtp(false);
  if (clockIsValid()) g_ntpEverSynced = true;
}

static bool initOta() {  // NOLINT — forward-declared above
  if (!otaPasswordHashIsUsable()) {
    Serial.println("[ota] disabled: configure a valid OTA_PASSWORD_HASH");
    return false;
  }
  ArduinoOTA.setHostname(otaHostname().c_str());
  ArduinoOTA.setPasswordHash(OTA_PASSWORD_HASH);
  ArduinoOTA.onStart([]() { Serial.println("[ota] update starting"); });
  ArduinoOTA.onEnd([]() { Serial.println("[ota] update complete"); });
  ArduinoOTA.onError([](ota_error_t error) {
    Serial.printf("[ota] error %u\n", error);
  });
  ArduinoOTA.begin();
  Serial.printf("[ota] listening as %s.local\n", otaHostname().c_str());
  return true;
}

// --- Arduino entry points --------------------------------------------------

void setup() {
  Serial.begin(115200);
  delay(300);

  const esp_reset_reason_t reason = esp_reset_reason();
  g_pendingResetReason = resetReasonName(reason);
  Serial.printf("\n[boot] ULT freezer node, reset reason: %s\n",
                g_pendingResetReason.c_str());

  mountFilesystem();
  g_observationIdentityReady = initObservationIdentity();
  initSensor();

  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  WiFi.setSleep(false);  // steadier latency and RSSI for a mains-powered node

  provision();
#ifdef PROTOTYPE_22
  g_sampleIntervalMs = CORE_SAMPLE_INTERVAL_MS;
  Serial.printf("[sampling] prototype %d interval %lu seconds\n",
                PROTOTYPE_ID,
                static_cast<unsigned long>(g_sampleIntervalMs / 1000UL));
#else
  g_sampleIntervalMs = sampleIntervalMs(g_freezerId);
  Serial.printf("[sampling] freezer %d interval %lu seconds\n", g_freezerId,
                static_cast<unsigned long>(g_sampleIntervalMs / 1000UL));
#endif

  g_wifiWasConnected = (WiFi.status() == WL_CONNECTED);
  if (g_wifiWasConnected) {
    syncNtp(true);
    g_otaStarted = initOta();
    flushQueue();
  }
  // If there is no network yet, onWifiConnected() does all of the above the
  // moment one appears. Sampling starts either way.

  // Take the first reading immediately rather than waiting a full interval.
  g_lastSampleAt = millis() - g_sampleIntervalMs;
}

void loop() {
  ArduinoOTA.handle();
  serviceWifi();
  serviceNtp();
  serviceQueue();

  const uint32_t now = millis();
  if (now - g_lastSampleAt >= g_sampleIntervalMs) {
    g_lastSampleAt = now;
    sampleAndSend();
  }

  delay(20);
}

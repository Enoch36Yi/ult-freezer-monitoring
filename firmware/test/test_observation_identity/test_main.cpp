#include <unity.h>

#include <cstdint>
#include <cstdio>
#include <ctime>
#include <map>
#include <set>
#include <string>
#include <vector>

#include "config.h"
#include "post_policy.h"

// The production clock gate, logical device ID, persistent boot counter and
// sampling decision are compiled from main.cpp. Only NVS, the wall clock, the
// sensor, JSON serialization, transport and the queue are fixtures here.
class String {
 public:
  String(const char *value = "") : value_(value) {}
  String(const std::string &value) : value_(value) {}
  bool isEmpty() const { return value_.empty(); }
  size_t length() const { return value_.size(); }
  const char *c_str() const { return value_.c_str(); }
  bool operator==(const char *other) const { return value_ == other; }
 private:
  std::string value_;
};

// Each simulated board owns one NVS partition. Erasing it or swapping boards
// is modelled by pointing the fixture at a different store.
struct NvsStore {
  std::map<std::string, std::map<std::string, uint64_t>> namespaces;
  bool failWrites = false;
};
static NvsStore *g_nvs = nullptr;
class Preferences {
 public:
  bool begin(const char *name, bool readOnly) {
    namespace_ = name;
    readOnly_ = readOnly;
    return true;
  }
  void end() { namespace_.clear(); }
  uint64_t getULong64(const char *key, uint64_t fallback) {
    const auto &values = g_nvs->namespaces[namespace_];
    const auto found = values.find(key);
    return found == values.end() ? fallback : found->second;
  }
  size_t putULong64(const char *key, uint64_t value) {
    if (readOnly_ || g_nvs->failWrites) return 0;
    g_nvs->namespaces[namespace_][key] = value;
    return sizeof(value);
  }
 private:
  std::string namespace_;
  bool readOnly_ = true;
};

static std::time_t fakeEpoch = 0;
static std::time_t fakeTime(std::time_t *out) {
  if (out != nullptr) *out = fakeEpoch;
  return fakeEpoch;
}
static struct tm *fakeGmtime(const std::time_t *value, struct tm *out) {
  const struct tm *result = std::gmtime(value);
  if (result == nullptr) return nullptr;
  *out = *result;
  return out;
}
#define time(arg) fakeTime(arg)
#undef gmtime_r
#define gmtime_r(value, out) fakeGmtime(value, out)

struct QuietSerial {
  void println(const char * = "") {}
  template <typename... Args> void printf(const char *, Args...) {}
} Serial;
constexpr int WL_CONNECTED = 3;
static bool wifiConnected = true;
struct FakeWifi { int status() const { return wifiConnected ? WL_CONNECTED : 0; } } WiFi;

static Preferences g_prefs;
static int g_freezerId = 3;
static uint64_t g_bootId = 0;
static uint32_t g_sampleSequence = 0;
static bool g_observationIdentityReady = false;
static String g_pendingResetReason;

static bool sensorOk = true;
static size_t sensorReads = 0;
static bool readTemperature(float &tempC) {
  ++sensorReads;
  tempC = -80.0f;
  return sensorOk;
}

struct Emitted {
  std::string observationId;
  std::string recordedAt;
  std::string resetReason;
};
static std::vector<Emitted> built;
static String observationId(uint32_t sampleSequence);
static String isoTimestampUtc();
static String buildReading(float) {
  built.push_back({observationId(g_sampleSequence).c_str(), isoTimestampUtc().c_str(),
                   g_pendingResetReason.c_str()});
  return String("{\"observation_id\":\"" + built.back().observationId + "\"}");
}

static PostResult nextPostResult = PostResult::kDelivered;
static size_t posts = 0;
static PostResult postJson(const String &) {
  ++posts;
  return nextPostResult;
}
static bool enqueueOk = true;
static std::vector<std::string> enqueued;
static bool enqueueReading(const String &json) {
  if (!enqueueOk) return false;
  enqueued.emplace_back(json.c_str());
  return true;
}

#include "identity_under_test.h"

// 2026-10-01T00:00:00Z, a conspicuous synthetic test instant.
constexpr std::time_t kValidEpoch = 1790812800;
static NvsStore boardA;
static NvsStore boardB;

void setUp() {
  boardA = NvsStore();
  boardB = NvsStore();
  g_nvs = &boardA;
  g_freezerId = 3;
  g_bootId = 0;
  g_sampleSequence = 0;
  g_observationIdentityReady = false;
  g_pendingResetReason = "";
  fakeEpoch = kValidEpoch;
  wifiConnected = true;
  sensorOk = true;
  sensorReads = 0;
  built.clear();
  nextPostResult = PostResult::kDelivered;
  posts = 0;
  enqueueOk = true;
  enqueued.clear();
}
void tearDown() {}

// One power cycle: setup() calls initObservationIdentity() once, then loop()
// samples. Returns every observation ID the boot produced.
static std::vector<std::string> bootAndSample(size_t samples) {
  g_observationIdentityReady = initObservationIdentity();
  std::vector<std::string> ids;
  const size_t before = built.size();
  for (size_t index = 0; index < samples; ++index) sampleAndSend();
  for (size_t index = before; index < built.size(); ++index) {
    ids.push_back(built[index].observationId);
  }
  return ids;
}

static size_t sharedIds(const std::vector<std::string> &a,
                        const std::vector<std::string> &b) {
  const std::set<std::string> left(a.begin(), a.end());
  size_t shared = 0;
  for (const std::string &id : b) shared += left.count(id);
  return shared;
}

void test_each_boot_persists_a_new_counter_and_restarts_sequence() {
  const std::vector<std::string> first = bootAndSample(2);
  const std::vector<std::string> second = bootAndSample(1);
  TEST_ASSERT_EQUAL_STRING("freezer-03-1-1", first[0].c_str());
  TEST_ASSERT_EQUAL_STRING("freezer-03-1-2", first[1].c_str());
  TEST_ASSERT_EQUAL_STRING("freezer-03-2-1", second[0].c_str());
  TEST_ASSERT_EQUAL_UINT64(2, boardA.namespaces["obs"]["boot_id"]);
  TEST_ASSERT_EQUAL_UINT(0, sharedIds(first, second));
}

void test_unpersisted_boot_counter_refuses_telemetry_without_reading_sensor() {
  boardA.failWrites = true;
  TEST_ASSERT_FALSE(initObservationIdentity());
  g_observationIdentityReady = false;
  sampleAndSend();
  TEST_ASSERT_EQUAL_UINT(0, sensorReads);
  TEST_ASSERT_EQUAL_UINT(0, built.size());
  TEST_ASSERT_EQUAL_UINT(0, posts + enqueued.size());
}

// KNOWN RISK, simulated rather than fixed: provision() documents
// `pio run -t erase` for deliberate re-provisioning. Erasing NVS restarts the
// boot counter, so the next lifetime regenerates earlier observation IDs. The
// ingest route's (device_id, observation_id) conflict target then treats those
// new measurements as replays. Changing the identity namespace is a recorded
// design decision, not something this test or local fix silently introduces.
void test_known_risk_nvs_erase_reuses_observation_ids_of_previous_lifetime() {
  std::vector<std::string> lifetime1;
  for (int boot = 0; boot < 3; ++boot) {
    const std::vector<std::string> ids = bootAndSample(2);
    lifetime1.insert(lifetime1.end(), ids.begin(), ids.end());
  }
  boardA = NvsStore();  // full NVS erase on the same board
  const std::vector<std::string> lifetime2 = bootAndSample(2);
  TEST_ASSERT_EQUAL_STRING("freezer-03-1-1", lifetime2[0].c_str());
  TEST_ASSERT_EQUAL_UINT(2, sharedIds(lifetime1, lifetime2));
}

// KNOWN RISK, simulated: a replacement MCU provisioned with the same freezer
// number starts its own counter at 1, colliding with the retired board's IDs.
void test_known_risk_replacement_mcu_with_same_freezer_number_reuses_ids() {
  g_nvs = &boardA;
  const std::vector<std::string> retired = bootAndSample(3);
  g_nvs = &boardB;
  const std::vector<std::string> replacement = bootAndSample(3);
  TEST_ASSERT_EQUAL_UINT(3, sharedIds(retired, replacement));
}

void test_distinct_freezer_numbers_never_share_observation_ids() {
  const std::vector<std::string> freezer3 = bootAndSample(2);
  g_nvs = &boardB;
  g_freezerId = 4;
  const std::vector<std::string> freezer4 = bootAndSample(2);
  TEST_ASSERT_EQUAL_STRING("freezer-04-1-1", freezer4[0].c_str());
  TEST_ASSERT_EQUAL_UINT(0, sharedIds(freezer3, freezer4));
}

void test_invalid_clock_pauses_sampling_without_consuming_sequence_numbers() {
  fakeEpoch = 0;
  g_observationIdentityReady = initObservationIdentity();
  g_pendingResetReason = "poweron";
  sampleAndSend();
  sampleAndSend();
  TEST_ASSERT_EQUAL_UINT(0, sensorReads);
  TEST_ASSERT_EQUAL_UINT32(0, g_sampleSequence);
  TEST_ASSERT_TRUE(g_pendingResetReason == "poweron");

  fakeEpoch = kValidEpoch;  // NTP lands
  sampleAndSend();
  TEST_ASSERT_EQUAL_UINT(1, built.size());
  TEST_ASSERT_EQUAL_STRING("freezer-03-1-1", built[0].observationId.c_str());
  TEST_ASSERT_EQUAL_STRING("2026-10-01T00:00:00Z", built[0].recordedAt.c_str());
  TEST_ASSERT_EQUAL_STRING("poweron", built[0].resetReason.c_str());
  TEST_ASSERT_TRUE(g_pendingResetReason.isEmpty());
}

void test_clock_validity_threshold_is_strictly_after_2023_01_01() {
  fakeEpoch = 1672531200;
  TEST_ASSERT_FALSE(clockIsValid());
  fakeEpoch = 1672531201;
  TEST_ASSERT_TRUE(clockIsValid());
}

void test_clock_falling_back_before_threshold_pauses_sampling_again() {
  g_observationIdentityReady = initObservationIdentity();
  sampleAndSend();
  fakeEpoch = 86400;  // RTC/NTP regression to 1970
  sampleAndSend();
  TEST_ASSERT_EQUAL_UINT(1, built.size());
  TEST_ASSERT_EQUAL_UINT(1, sensorReads);
  fakeEpoch = kValidEpoch + 120;
  sampleAndSend();
  TEST_ASSERT_EQUAL_STRING("freezer-03-1-2", built[1].observationId.c_str());
}

// A valid-but-stepped clock is not detected on the device. Sequence order
// keeps IDs unique, so downstream lineage checks can still see the step.
void test_backward_clock_step_keeps_ids_unique_while_timestamp_decreases() {
  g_observationIdentityReady = initObservationIdentity();
  sampleAndSend();
  fakeEpoch = kValidEpoch - 3600;
  sampleAndSend();
  TEST_ASSERT_EQUAL_STRING("freezer-03-1-1", built[0].observationId.c_str());
  TEST_ASSERT_EQUAL_STRING("freezer-03-1-2", built[1].observationId.c_str());
  TEST_ASSERT_EQUAL_STRING("2026-10-01T00:00:00Z", built[0].recordedAt.c_str());
  TEST_ASSERT_EQUAL_STRING("2026-09-30T23:00:00Z", built[1].recordedAt.c_str());
}

void test_failed_sensor_read_does_not_consume_a_sequence_number() {
  g_observationIdentityReady = initObservationIdentity();
  sensorOk = false;
  sampleAndSend();
  sensorOk = true;
  sampleAndSend();
  TEST_ASSERT_EQUAL_UINT(2, sensorReads);
  TEST_ASSERT_EQUAL_STRING("freezer-03-1-1", built[0].observationId.c_str());
}

// A reading that is neither posted nor buffered is lost, but its sequence
// number stays consumed. That gap is the downstream evidence of the loss.
void test_undeliverable_unbuffered_reading_leaves_sequence_gap_and_keeps_reset_reason() {
  g_observationIdentityReady = initObservationIdentity();
  g_pendingResetReason = "brownout";
  nextPostResult = PostResult::kRetryableFailure;
  enqueueOk = false;
  sampleAndSend();
  TEST_ASSERT_TRUE(g_pendingResetReason == "brownout");
  enqueueOk = true;
  sampleAndSend();
  TEST_ASSERT_EQUAL_UINT(1, enqueued.size());
  TEST_ASSERT_EQUAL_STRING("{\"observation_id\":\"freezer-03-1-2\"}", enqueued[0].c_str());
  TEST_ASSERT_EQUAL_STRING("brownout", built[1].resetReason.c_str());
  TEST_ASSERT_TRUE(g_pendingResetReason.isEmpty());
}

void test_offline_reading_is_buffered_without_a_post_attempt() {
  g_observationIdentityReady = initObservationIdentity();
  wifiConnected = false;
  sampleAndSend();
  TEST_ASSERT_EQUAL_UINT(0, posts);
  TEST_ASSERT_EQUAL_UINT(1, enqueued.size());
}

int main(int, char **) {
  UNITY_BEGIN();
  RUN_TEST(test_each_boot_persists_a_new_counter_and_restarts_sequence);
  RUN_TEST(test_unpersisted_boot_counter_refuses_telemetry_without_reading_sensor);
  RUN_TEST(test_known_risk_nvs_erase_reuses_observation_ids_of_previous_lifetime);
  RUN_TEST(test_known_risk_replacement_mcu_with_same_freezer_number_reuses_ids);
  RUN_TEST(test_distinct_freezer_numbers_never_share_observation_ids);
  RUN_TEST(test_invalid_clock_pauses_sampling_without_consuming_sequence_numbers);
  RUN_TEST(test_clock_validity_threshold_is_strictly_after_2023_01_01);
  RUN_TEST(test_clock_falling_back_before_threshold_pauses_sampling_again);
  RUN_TEST(test_backward_clock_step_keeps_ids_unique_while_timestamp_decreases);
  RUN_TEST(test_failed_sensor_read_does_not_consume_a_sequence_number);
  RUN_TEST(test_undeliverable_unbuffered_reading_leaves_sequence_gap_and_keeps_reset_reason);
  RUN_TEST(test_offline_reading_is_buffered_without_a_post_attempt);
  return UNITY_END();
}

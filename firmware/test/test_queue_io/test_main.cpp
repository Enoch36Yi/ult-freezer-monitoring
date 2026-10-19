#include <unity.h>

#include <algorithm>
#include <cctype>
#include <cstdint>
#include <limits>
#include <map>
#include <memory>
#include <string>
#include <vector>

#include "config.h"
#include "post_policy.h"
#include "queue_presence.h"
#include "queue_recovery.h"

// Model only the slow platform boundaries. The production queue code below
// performs every read, write, remove, rename, schedule and acknowledgment.
class String {
 public:
  String(const char *value = "") : value_(value) {}
  String(const std::string &value) : value_(value) {}
  void trim() {
    const size_t first = value_.find_first_not_of(" \t\r\n");
    if (first == std::string::npos) { value_.clear(); return; }
    value_ = value_.substr(first, value_.find_last_not_of(" \t\r\n") - first + 1);
  }
  bool isEmpty() const { return value_.empty(); }
  size_t length() const { return value_.size(); }
  const char *c_str() const { return value_.c_str(); }
  String &operator+=(char value) { value_ += value; return *this; }
  String &operator+=(const String &value) { value_ += value.value_; return *this; }
 private:
  std::string value_;
};

struct MemoryFile { std::string bytes; };
class File {
 public:
  File() = default;
  File(std::shared_ptr<MemoryFile> data, size_t position, size_t budget)
      : data_(data), position_(position), budget_(budget) {}
  explicit operator bool() const { return static_cast<bool>(data_); }
  size_t size() const { return data_->bytes.size(); }
  size_t position() const { return position_; }
  bool available() const { return data_ && position_ < size(); }
  bool seek(size_t position) {
    if (position > size()) return false;
    position_ = position;
    return true;
  }
  int read() { return available() ? static_cast<unsigned char>(data_->bytes[position_++]) : -1; }
  String readStringUntil(char delimiter) {
    std::string result;
    while (available()) {
      const char next = static_cast<char>(read());
      if (next == delimiter) break;
      result += next;
    }
    return String(result);
  }
  size_t print(const String &value) { return append(value.c_str(), value.length()); }
  size_t write(uint8_t value) { const char byte = static_cast<char>(value); return append(&byte, 1); }
  size_t println(const String &value) { return print(value) + append("\r\n", 2); }
  void close() { data_.reset(); }
 private:
  size_t append(const char *bytes, size_t count) {
    const size_t written = std::min(count, budget_);
    data_->bytes.append(bytes, written);
    position_ += written;
    budget_ -= written;
    return written;
  }
  std::shared_ptr<MemoryFile> data_;
  size_t position_ = 0;
  size_t budget_ = 0;
};

enum { FILE_READ, FILE_WRITE, FILE_APPEND };
class MemoryFilesystem {
 public:
  std::map<std::string, std::shared_ptr<MemoryFile>> files;
  size_t tempWriteBudget = std::numeric_limits<size_t>::max();
  size_t queueWriteBudget = std::numeric_limits<size_t>::max();
  // Fault injection for the remove/rename window and write accounting.
  std::map<std::string, int> removeFailures;
  std::map<std::string, int> renameFailures;
  std::map<std::string, int> removeAttempts;
  size_t tempWriteOpens = 0;
  bool begin(bool) { return true; }
  size_t totalBytes() const { return 2000000; }
  size_t usedBytes() const { return 0; }
  bool exists(const char *path) const { return files.count(path) != 0; }
  File open(const char *path, int mode) {
    if (mode == FILE_READ && !exists(path)) return File();
    if (mode == FILE_WRITE && std::string(path) == QUEUE_TMP_PATH) ++tempWriteOpens;
    if (mode == FILE_WRITE || !exists(path)) files[path] = std::make_shared<MemoryFile>();
    const size_t position = mode == FILE_APPEND ? files[path]->bytes.size() : 0;
    return File(files[path], position,
                std::string(path) == QUEUE_TMP_PATH ? tempWriteBudget
                                                    : queueWriteBudget);
  }
  bool remove(const char *path) {
    ++removeAttempts[path];
    if (removeFailures[path] > 0) { --removeFailures[path]; return false; }
    return files.erase(path) > 0;
  }
  bool rename(const char *from, const char *to) {
    if (renameFailures[from] > 0) { --renameFailures[from]; return false; }
    if (!exists(from) || exists(to)) return false;
    files[to] = files[from];
    files.erase(from);
    return true;
  }
  void put(const char *path, const std::string &bytes) {
    files[path] = std::make_shared<MemoryFile>();
    files[path]->bytes = bytes;
  }
  const std::string &get(const char *path) const { return files.at(path)->bytes; }
};

static MemoryFilesystem LittleFS;
struct QuietSerial {
  void println(const char * = "") {}
  template <typename... Args> void printf(const char *, Args...) {}
} Serial;
constexpr int WL_CONNECTED = 3;
struct FakeWifi { int status() const { return WL_CONNECTED; } } WiFi;
struct FakeOta { void handle() {} } ArduinoOTA;
static bool g_otaStarted = false;
static bool g_filesystemReady = true;
static QueuePresence g_queuePresence;
static uint32_t g_queueRetryAt = 0;
static uint32_t g_queueRetryDelayMs = QUEUE_FLUSH_RETRY_MS;
static bool g_queueRetryScheduled = false;
static uint32_t fakeNow = 0;
static uint32_t millis() { return fakeNow; }
static std::vector<std::string> postedBodies;
static PostResult nextPostResult = PostResult::kRetryableFailure;
// Consumed first, one result per POST, before falling back to nextPostResult.
static std::vector<PostResult> scriptedPostResults;
static PostResult postJson(const String &body) {
  postedBodies.emplace_back(body.c_str());
  if (!scriptedPostResults.empty()) {
    const PostResult result = scriptedPostResults.front();
    scriptedPostResults.erase(scriptedPostResults.begin());
    return result;
  }
  return nextPostResult;
}

#include "queue_under_test.h"

void setUp() {
  LittleFS = MemoryFilesystem();
  g_queuePresence.onMount(false);
  g_filesystemReady = true;
  resetQueueRetry();
  fakeNow = 0;
  postedBodies.clear();
  nextPostResult = PostResult::kRetryableFailure;
  scriptedPostResults.clear();
}
void tearDown() {}

static void queue(const std::string &bytes) {
  LittleFS.put(QUEUE_PATH, bytes);
  g_queuePresence.onMount(true);
}

// Synthetic queue lines with an explicit sequence, oldest first.
static std::string records(size_t first, size_t count) {
  std::string bytes;
  for (size_t seq = first; seq < first + count; ++seq) {
    bytes += "{\"seq\":" + std::to_string(seq) + "}\n";
  }
  return bytes;
}

void test_repeated_failed_flushes_back_off_instead_of_retrying_every_minute() {
  queue("{\"temp_c\":-80}\n");
  serviceQueue();
  TEST_ASSERT_EQUAL_UINT(1, postedBodies.size());
  fakeNow = 60000;
  serviceQueue();
  TEST_ASSERT_EQUAL_UINT(2, postedBodies.size());
  fakeNow = 120000;
  serviceQueue();
  TEST_ASSERT_EQUAL_UINT(2, postedBodies.size());
  fakeNow = 180000;
  serviceQueue();
  TEST_ASSERT_EQUAL_UINT(3, postedBodies.size());
}

void test_failed_batch_is_retained_in_order_and_not_acknowledged() {
  const char *original = "{\"temp_c\":-80}\n{\"temp_c\":-79}\n";
  queue(original);
  serviceQueue();
  TEST_ASSERT_EQUAL_STRING("[{\"temp_c\":-80},{\"temp_c\":-79}]", postedBodies[0].c_str());
  TEST_ASSERT_EQUAL_STRING(original, LittleFS.get(QUEUE_PATH).c_str());
  TEST_ASSERT_TRUE(g_queuePresence.hasData());
}

void test_retry_delay_is_capped_at_thirty_minutes() {
  queue("{\"temp_c\":-80}\n");
  const uint32_t attempts[] = {0, 60000, 180000, 420000, 900000,
                               1860000, 3660000, 5460000};
  for (size_t index = 0; index < sizeof(attempts) / sizeof(attempts[0]); ++index) {
    if (index > 0) {
      fakeNow = attempts[index] - 1;
      serviceQueue();
      TEST_ASSERT_EQUAL_UINT(index, postedBodies.size());
    }
    fakeNow = attempts[index];
    serviceQueue();
    TEST_ASSERT_EQUAL_UINT(index + 1, postedBodies.size());
  }
}

void test_retry_deadline_survives_millis_rollover() {
  queue("{\"temp_c\":-80}\n");
  fakeNow = UINT32_MAX - 30000;
  serviceQueue();
  fakeNow = 29998;
  serviceQueue();
  TEST_ASSERT_EQUAL_UINT(1, postedBodies.size());
  fakeNow = 29999;
  serviceQueue();
  TEST_ASSERT_EQUAL_UINT(2, postedBodies.size());
}

void test_batch_limit_yields_then_continues_after_one_minute() {
  std::string original;
  for (size_t index = 0; index < 201; ++index) original += "{\"temp_c\":-80}\n";
  queue(original);
  nextPostResult = PostResult::kDelivered;
  serviceQueue();
  TEST_ASSERT_EQUAL_UINT(4, postedBodies.size());
  TEST_ASSERT_TRUE(g_queuePresence.hasData());
  fakeNow = 59999;
  serviceQueue();
  TEST_ASSERT_EQUAL_UINT(4, postedBodies.size());
  fakeNow = 60000;
  serviceQueue();
  TEST_ASSERT_EQUAL_UINT(5, postedBodies.size());
  TEST_ASSERT_FALSE(g_queuePresence.hasData());
}

void test_flush_copy_short_write_preserves_original_queue() {
  // One accepted batch forces the remainder to be copied to the temp file.
  const std::string original = records(1, 51);
  queue(original);
  scriptedPostResults = {PostResult::kDelivered, PostResult::kRetryableFailure};
  LittleFS.tempWriteBudget = 5;
  flushQueue();
  TEST_ASSERT_EQUAL_UINT(1, LittleFS.tempWriteOpens);
  TEST_ASSERT_EQUAL_STRING(original.c_str(), LittleFS.get(QUEUE_PATH).c_str());
  TEST_ASSERT_TRUE(g_queuePresence.hasData());
}

void test_tail_repair_short_write_preserves_complete_original_records() {
  const char *original = "{\"temp_c\":-80}\n{\"temp_c\":";
  queue(original);
  LittleFS.tempWriteBudget = 5;
  TEST_ASSERT_FALSE(repairQueueTail());
  TEST_ASSERT_EQUAL_STRING(original, LittleFS.get(QUEUE_PATH).c_str());
}

void test_failed_rewrite_temp_is_discarded_before_successful_retry() {
  queue(records(1, 51));
  scriptedPostResults = {PostResult::kDelivered, PostResult::kRetryableFailure};
  LittleFS.tempWriteBudget = 5;
  flushQueue();
  TEST_ASSERT_TRUE(LittleFS.exists(QUEUE_TMP_PATH));
  LittleFS.tempWriteBudget = std::numeric_limits<size_t>::max();
  nextPostResult = PostResult::kDelivered;
  fakeNow = 60000;
  serviceQueue();
  // The preserved original is replayed whole; the server dedupes batch one.
  TEST_ASSERT_EQUAL_UINT(4, postedBodies.size());
  TEST_ASSERT_EQUAL_STRING("[{\"seq\":51}]", postedBodies[3].c_str());
  TEST_ASSERT_FALSE(g_queuePresence.hasData());
  TEST_ASSERT_FALSE(LittleFS.exists(QUEUE_PATH));
  TEST_ASSERT_FALSE(LittleFS.exists(QUEUE_TMP_PATH));
}

void test_trim_short_write_preserves_original_queue() {
  // Put the trim boundary inside the first record, leaving exactly one
  // complete record to copy. A short final write must not be mistaken for a
  // complete replacement just because there is no subsequent write to fail.
  const std::string original = "{\"padding\":\"" + std::string(QUEUE_MAX_BYTES, 'x') +
                               "\"}\n{\"temp_c\":-80}\n";
  queue(original);
  LittleFS.tempWriteBudget = 5;
  TEST_ASSERT_FALSE(trimQueueIfNeeded());
  TEST_ASSERT_EQUAL_UINT(original.size(), LittleFS.get(QUEUE_PATH).size());
  TEST_ASSERT_EQUAL_STRING(original.c_str(), LittleFS.get(QUEUE_PATH).c_str());
}

void test_successful_drain_clears_presence_and_removes_queue() {
  queue("{\"temp_c\":-80}\n");
  nextPostResult = PostResult::kDelivered;
  flushQueue();
  TEST_ASSERT_EQUAL_UINT(1, postedBodies.size());
  TEST_ASSERT_FALSE(g_queuePresence.hasData());
  TEST_ASSERT_FALSE(LittleFS.exists(QUEUE_PATH));
  TEST_ASSERT_FALSE(LittleFS.exists(QUEUE_TMP_PATH));
  TEST_ASSERT_FALSE(g_queueRetryScheduled);
}

void test_append_uses_one_lf_and_acknowledges_complete_record() {
  TEST_ASSERT_TRUE(enqueueReading("{\"temp_c\":-80}"));
  TEST_ASSERT_EQUAL_STRING("{\"temp_c\":-80}\n", LittleFS.get(QUEUE_PATH).c_str());
  TEST_ASSERT_TRUE(g_queuePresence.hasData());
}

void test_failed_first_append_is_repaired_before_next_reading() {
  LittleFS.queueWriteBudget = 5;
  TEST_ASSERT_FALSE(enqueueReading("{\"temp_c\":-80}"));
  LittleFS.queueWriteBudget = std::numeric_limits<size_t>::max();
  TEST_ASSERT_TRUE(enqueueReading("{\"temp_c\":-79}"));
  TEST_ASSERT_EQUAL_STRING("{\"temp_c\":-79}\n", LittleFS.get(QUEUE_PATH).c_str());
}

// --- 2026-10-18 recovery-gap regressions -----------------------------------

// A rejected batch with no accepted rows leaves the original bytes valid.
// Rewriting them anyway adds flash wear and a remove/rename window on every
// retry of a prolonged server-side rejection.
void test_failed_flush_without_progress_does_not_rewrite_queue() {
  const std::string original = records(1, 3);
  queue(original);
  flushQueue();
  TEST_ASSERT_EQUAL_UINT(1, postedBodies.size());
  TEST_ASSERT_EQUAL_UINT(0, LittleFS.tempWriteOpens);
  TEST_ASSERT_EQUAL_INT(0, LittleFS.removeAttempts[QUEUE_PATH]);
  TEST_ASSERT_EQUAL_STRING(original.c_str(), LittleFS.get(QUEUE_PATH).c_str());
  TEST_ASSERT_TRUE(g_queuePresence.hasData());
  TEST_ASSERT_TRUE(g_queueRetryScheduled);
}

// An empty queue file that cannot be removed must use the bounded retry
// schedule, not re-run on every 20 ms loop() pass.
void test_failed_empty_queue_removal_schedules_bounded_retry() {
  queue("\n\n");
  LittleFS.removeFailures[QUEUE_PATH] = 2;
  serviceQueue();
  TEST_ASSERT_EQUAL_INT(1, LittleFS.removeAttempts[QUEUE_PATH]);
  fakeNow = 20;
  serviceQueue();
  TEST_ASSERT_EQUAL_INT(1, LittleFS.removeAttempts[QUEUE_PATH]);
  fakeNow = 60000;
  serviceQueue();
  TEST_ASSERT_EQUAL_INT(2, LittleFS.removeAttempts[QUEUE_PATH]);
  fakeNow = 180000;
  serviceQueue();
  TEST_ASSERT_EQUAL_INT(3, LittleFS.removeAttempts[QUEUE_PATH]);
  TEST_ASSERT_FALSE(LittleFS.exists(QUEUE_PATH));
  TEST_ASSERT_FALSE(g_queuePresence.hasData());
  TEST_ASSERT_EQUAL_UINT(0, postedBodies.size());
}

void test_recovery_after_repeated_rejections_drains_in_order_and_resets_backoff() {
  const std::string original = records(1, 3);
  queue(original);
  nextPostResult = PostResult::kPermanentFailure;
  const uint32_t attempts[] = {0, 60000, 180000, 420000, 900000, 1860000, 3660000};
  for (uint32_t at : attempts) {
    fakeNow = at;
    serviceQueue();
  }
  TEST_ASSERT_EQUAL_UINT(7, postedBodies.size());
  TEST_ASSERT_EQUAL_STRING(original.c_str(), LittleFS.get(QUEUE_PATH).c_str());

  // Endpoint repaired: the next due attempt drains everything, oldest first.
  nextPostResult = PostResult::kDelivered;
  fakeNow = 3660000 + QUEUE_FLUSH_MAX_RETRY_MS;
  serviceQueue();
  TEST_ASSERT_EQUAL_UINT(8, postedBodies.size());
  TEST_ASSERT_EQUAL_STRING("[{\"seq\":1},{\"seq\":2},{\"seq\":3}]", postedBodies[7].c_str());
  TEST_ASSERT_FALSE(LittleFS.exists(QUEUE_PATH));
  TEST_ASSERT_FALSE(g_queueRetryScheduled);

  // A later outage restarts at the one-minute delay rather than the old cap.
  TEST_ASSERT_TRUE(enqueueReading("{\"seq\":4}"));
  nextPostResult = PostResult::kRetryableFailure;
  serviceQueue();
  TEST_ASSERT_EQUAL_UINT(9, postedBodies.size());
  fakeNow += QUEUE_FLUSH_RETRY_MS - 1;
  serviceQueue();
  TEST_ASSERT_EQUAL_UINT(9, postedBodies.size());
  fakeNow += 1;
  serviceQueue();
  TEST_ASSERT_EQUAL_UINT(10, postedBodies.size());
}

void test_partial_progress_then_failure_keeps_unsent_tail_in_order() {
  queue(records(1, 120));
  scriptedPostResults = {PostResult::kDelivered, PostResult::kRetryableFailure};
  flushQueue();
  TEST_ASSERT_EQUAL_UINT(2, postedBodies.size());
  TEST_ASSERT_EQUAL_UINT(0, postedBodies[1].rfind("[{\"seq\":51},", 0));
  TEST_ASSERT_EQUAL_STRING(records(51, 70).c_str(), LittleFS.get(QUEUE_PATH).c_str());
  TEST_ASSERT_FALSE(LittleFS.exists(QUEUE_TMP_PATH));
  TEST_ASSERT_TRUE(g_queuePresence.hasData());
}

void test_capped_backoff_schedule_survives_millis_rollover() {
  queue(records(1, 1));
  const uint32_t start = UINT32_MAX - 7200000UL;
  uint32_t due = start;
  uint32_t delay = QUEUE_FLUSH_RETRY_MS;
  for (size_t attempt = 0; attempt < 10; ++attempt) {
    if (attempt > 0) {
      fakeNow = due - 1;
      serviceQueue();
      TEST_ASSERT_EQUAL_UINT(attempt, postedBodies.size());
    }
    fakeNow = due;
    serviceQueue();
    TEST_ASSERT_EQUAL_UINT(attempt + 1, postedBodies.size());
    due += delay;  // unsigned wrap, exactly like millis()
    delay = delay < QUEUE_FLUSH_MAX_RETRY_MS / 2UL ? delay * 2UL : QUEUE_FLUSH_MAX_RETRY_MS;
  }
  TEST_ASSERT_TRUE(due < start);  // the schedule really crossed the rollover
  TEST_ASSERT_EQUAL_STRING(records(1, 1).c_str(), LittleFS.get(QUEUE_PATH).c_str());
}

void test_prolonged_outage_trim_keeps_newest_complete_records_in_order() {
  std::string original;
  const std::string padding(90, 'x');
  size_t count = 0;
  while (original.size() < QUEUE_MAX_BYTES) {
    ++count;
    original += "{\"seq\":" + std::to_string(count) + ",\"pad\":\"" + padding + "\"}\n";
  }
  queue(original);
  TEST_ASSERT_TRUE(enqueueReading("{\"seq\":999999}"));
  const std::string kept = LittleFS.get(QUEUE_PATH);
  TEST_ASSERT_TRUE(kept.size() < QUEUE_MAX_BYTES);
  TEST_ASSERT_EQUAL_INT('\n', kept.back());
  size_t previous = 0;
  size_t lines = 0;
  for (size_t begin = 0; begin < kept.size();) {
    const size_t end = kept.find('\n', begin);
    const std::string line = kept.substr(begin, end - begin);
    TEST_ASSERT_EQUAL_UINT(0, line.rfind("{\"seq\":", 0));
    const size_t seq = std::stoul(line.substr(7));
    if (lines > 0 && seq != 999999) TEST_ASSERT_EQUAL_UINT(previous + 1, seq);
    previous = seq;
    ++lines;
    begin = end + 1;
  }
  TEST_ASSERT_EQUAL_UINT(999999, previous);
  TEST_ASSERT_TRUE(lines > count / 3 && lines < count);
}

void test_rename_failure_after_remove_is_recovered_by_next_flush() {
  queue(records(1, 51));
  scriptedPostResults = {PostResult::kDelivered, PostResult::kRetryableFailure};
  LittleFS.renameFailures[QUEUE_TMP_PATH] = 2;  // install and immediate recovery fail
  flushQueue();
  TEST_ASSERT_FALSE(LittleFS.exists(QUEUE_PATH));
  TEST_ASSERT_EQUAL_STRING(records(51, 1).c_str(), LittleFS.get(QUEUE_TMP_PATH).c_str());
  TEST_ASSERT_TRUE(g_queuePresence.hasData());
  nextPostResult = PostResult::kDelivered;
  fakeNow = 60000;
  serviceQueue();
  TEST_ASSERT_EQUAL_STRING("[{\"seq\":51}]", postedBodies.back().c_str());
  TEST_ASSERT_FALSE(LittleFS.exists(QUEUE_PATH));
  TEST_ASSERT_FALSE(LittleFS.exists(QUEUE_TMP_PATH));
  TEST_ASSERT_FALSE(g_queuePresence.hasData());
}

void test_power_cut_between_remove_and_rename_is_adopted_at_mount() {
  LittleFS.put(QUEUE_TMP_PATH, records(5, 2));
  g_filesystemReady = false;
  g_queuePresence.onMount(false);
  mountFilesystem();
  TEST_ASSERT_TRUE(g_filesystemReady);
  TEST_ASSERT_FALSE(LittleFS.exists(QUEUE_TMP_PATH));
  TEST_ASSERT_EQUAL_STRING(records(5, 2).c_str(), LittleFS.get(QUEUE_PATH).c_str());
  TEST_ASSERT_TRUE(g_queuePresence.hasData());
}

void test_mount_prefers_original_queue_over_interrupted_temp_copy() {
  LittleFS.put(QUEUE_PATH, records(1, 3));
  LittleFS.put(QUEUE_TMP_PATH, "{\"seq\":2}\n{\"se");
  g_filesystemReady = false;
  g_queuePresence.onMount(false);
  mountFilesystem();
  TEST_ASSERT_EQUAL_STRING(records(1, 3).c_str(), LittleFS.get(QUEUE_PATH).c_str());
  TEST_ASSERT_FALSE(LittleFS.exists(QUEUE_TMP_PATH));
  TEST_ASSERT_TRUE(g_queuePresence.hasData());
}

void test_interrupted_append_after_existing_records_is_repaired_at_next_boot() {
  queue(records(1, 2));
  LittleFS.queueWriteBudget = 5;
  TEST_ASSERT_FALSE(enqueueReading("{\"seq\":3}"));
  LittleFS.queueWriteBudget = std::numeric_limits<size_t>::max();
  g_filesystemReady = false;  // reboot after the short write
  g_queuePresence.onMount(false);
  mountFilesystem();
  TEST_ASSERT_EQUAL_STRING(records(1, 2).c_str(), LittleFS.get(QUEUE_PATH).c_str());
  TEST_ASSERT_TRUE(enqueueReading("{\"seq\":4}"));
  TEST_ASSERT_EQUAL_STRING((records(1, 2) + "{\"seq\":4}\n").c_str(),
                           LittleFS.get(QUEUE_PATH).c_str());
}

int main(int, char **) {
  UNITY_BEGIN();
  RUN_TEST(test_repeated_failed_flushes_back_off_instead_of_retrying_every_minute);
  RUN_TEST(test_failed_batch_is_retained_in_order_and_not_acknowledged);
  RUN_TEST(test_retry_delay_is_capped_at_thirty_minutes);
  RUN_TEST(test_retry_deadline_survives_millis_rollover);
  RUN_TEST(test_batch_limit_yields_then_continues_after_one_minute);
  RUN_TEST(test_flush_copy_short_write_preserves_original_queue);
  RUN_TEST(test_tail_repair_short_write_preserves_complete_original_records);
  RUN_TEST(test_failed_rewrite_temp_is_discarded_before_successful_retry);
  RUN_TEST(test_trim_short_write_preserves_original_queue);
  RUN_TEST(test_successful_drain_clears_presence_and_removes_queue);
  RUN_TEST(test_append_uses_one_lf_and_acknowledges_complete_record);
  RUN_TEST(test_failed_first_append_is_repaired_before_next_reading);
  RUN_TEST(test_failed_flush_without_progress_does_not_rewrite_queue);
  RUN_TEST(test_failed_empty_queue_removal_schedules_bounded_retry);
  RUN_TEST(test_recovery_after_repeated_rejections_drains_in_order_and_resets_backoff);
  RUN_TEST(test_partial_progress_then_failure_keeps_unsent_tail_in_order);
  RUN_TEST(test_capped_backoff_schedule_survives_millis_rollover);
  RUN_TEST(test_prolonged_outage_trim_keeps_newest_complete_records_in_order);
  RUN_TEST(test_rename_failure_after_remove_is_recovered_by_next_flush);
  RUN_TEST(test_power_cut_between_remove_and_rename_is_adopted_at_mount);
  RUN_TEST(test_mount_prefers_original_queue_over_interrupted_temp_copy);
  RUN_TEST(test_interrupted_append_after_existing_records_is_repaired_at_next_boot);
  return UNITY_END();
}

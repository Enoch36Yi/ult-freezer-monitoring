#include <unity.h>
#include <cstdint>
#include <string>

#include "config.h"
#include "post_policy.h"
#include "supabase_root_ca.h"

// The real postJson configures the transport boundaries below. The fixture
// starts with the cached Arduino library's 120-second TLS handshake default.
class String {
 public:
  String(const char *value) : value_(value) {}
  const char *c_str() const { return value_.c_str(); }
 private:
  std::string value_;
};
static unsigned long handshakeSeconds = 120;
static int httpTimeoutMs = 0;
static int connectTimeoutMs = 0;
static bool connected = true;
static bool signingAllowed = true;
static size_t tlsClientsCreated = 0;
constexpr int WL_CONNECTED = 3;
struct FakeWifi { int status() const { return connected ? WL_CONNECTED : 0; } } WiFi;
struct QuietSerial {
  void println(const char *) {}
  template <typename... Args> void printf(const char *, Args...) {}
} Serial;

class WiFiClientSecure {
 public:
  WiFiClientSecure() { ++tlsClientsCreated; }
  void setCACert(const char *) {}
  // This API takes seconds, unlike HTTPClient's millisecond timers.
  void setHandshakeTimeout(unsigned long seconds) { handshakeSeconds = seconds; }
};
class HTTPClient {
 public:
  void setTimeout(int milliseconds) { httpTimeoutMs = milliseconds; }
  void setConnectTimeout(int milliseconds) { connectTimeoutMs = milliseconds; }
  bool begin(WiFiClientSecure &, const char *) { return true; }
  template <typename T> void addHeader(const char *, const T &) {}
  int POST(const String &) { return 204; }
  String errorToString(int) { return String("fixture"); }
  void end() {}
};
static String ingestSecret() { return String("compile-only-fake-signing-fixture"); }
static String deviceId() { return String("freezer-01"); }
static bool signBody(const String &, const String &, char *) { return signingAllowed; }

#include "post_under_test.h"

void setUp() {
  handshakeSeconds = 120;
  httpTimeoutMs = 0;
  connectTimeoutMs = 0;
  connected = true;
  signingAllowed = true;
  tlsClientsCreated = 0;
}
void tearDown() {}

void test_post_bounds_tls_handshake_as_well_as_http_timers() {
  TEST_ASSERT_EQUAL_INT(static_cast<int>(PostResult::kDelivered),
                        static_cast<int>(postJson("{}")));
  TEST_ASSERT_EQUAL_UINT(10, handshakeSeconds);
  TEST_ASSERT_EQUAL_INT(10000, httpTimeoutMs);
  TEST_ASSERT_EQUAL_INT(10000, connectTimeoutMs);
}

void test_disconnected_post_returns_without_opening_tls() {
  connected = false;
  TEST_ASSERT_EQUAL_INT(static_cast<int>(PostResult::kRetryableFailure),
                        static_cast<int>(postJson("{}")));
  TEST_ASSERT_EQUAL_UINT(0, tlsClientsCreated);
}

void test_unconfigured_secret_returns_without_opening_tls() {
  signingAllowed = false;
  TEST_ASSERT_EQUAL_INT(static_cast<int>(PostResult::kPermanentFailure),
                        static_cast<int>(postJson("{}")));
  TEST_ASSERT_EQUAL_UINT(0, tlsClientsCreated);
}

int main(int, char **) {
  UNITY_BEGIN();
  RUN_TEST(test_post_bounds_tls_handshake_as_well_as_http_timers);
  RUN_TEST(test_disconnected_post_returns_without_opening_tls);
  RUN_TEST(test_unconfigured_secret_returns_without_opening_tls);
  return UNITY_END();
}

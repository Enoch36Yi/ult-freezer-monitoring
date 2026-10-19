#include <unity.h>
#include <string>

class String {
 public:
  String(const char *value) : value_(value) {}
  size_t length() const { return value_.length(); }
  bool startsWith(const char *prefix) const { return value_.find(prefix) == 0; }
  char operator[](size_t index) const { return value_[index]; }
 private:
  std::string value_;
};

static const char *fixtureHash = "";
#define OTA_PASSWORD_HASH fixtureHash
#define DEVICE_SECURITY_CONFIGURED 1
namespace configured {
#include "ota_security_under_test.h"
}
#undef DEVICE_SECURITY_CONFIGURED
#define DEVICE_SECURITY_CONFIGURED 0
namespace unconfigured {
#include "ota_security_under_test.h"
}
#undef DEVICE_SECURITY_CONFIGURED
#undef OTA_PASSWORD_HASH

void setUp() { fixtureHash = ""; }
void tearDown() {}

void test_ota_accepts_canonical_32_hex_md5_password_digest() {
  // Public test fixture, never a real password or deployment digest.
  fixtureHash = "0123456789abcdef0123456789abcdef";
  TEST_ASSERT_TRUE(configured::otaPasswordHashIsUsable());
}

void test_ota_rejects_sha256_digest_that_espota_cannot_authenticate() {
  fixtureHash = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
  TEST_ASSERT_FALSE(configured::otaPasswordHashIsUsable());
}

void test_ota_rejects_malformed_or_noncanonical_password_digests() {
  const char *invalid[] = {
      "", "replace-with-32-lowercase-hex-characters",
      "0123456789abcdef0123456789abcde",
      "0123456789abcdef0123456789abcdef0",
      "0123456789abcdef0123456789abcdeg",
      "0123456789ABCDEF0123456789ABCDEF",
  };
  for (const char *hash : invalid) {
    fixtureHash = hash;
    TEST_ASSERT_FALSE(configured::otaPasswordHashIsUsable());
  }
}

void test_ota_stays_disabled_without_security_header() {
  fixtureHash = "0123456789abcdef0123456789abcdef";
  TEST_ASSERT_FALSE(unconfigured::otaPasswordHashIsUsable());
}

int main(int, char **) {
  UNITY_BEGIN();
  RUN_TEST(test_ota_accepts_canonical_32_hex_md5_password_digest);
  RUN_TEST(test_ota_rejects_sha256_digest_that_espota_cannot_authenticate);
  RUN_TEST(test_ota_rejects_malformed_or_noncanonical_password_digests);
  RUN_TEST(test_ota_stays_disabled_without_security_header);
  return UNITY_END();
}

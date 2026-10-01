#include <unity.h>

#include "post_policy.h"

void setUp() {}
void tearDown() {}

void test_success_statuses_are_delivered() {
  TEST_ASSERT_EQUAL_INT(static_cast<int>(PostResult::kDelivered),
                        static_cast<int>(classifyPostStatus(200)));
  TEST_ASSERT_EQUAL_INT(static_cast<int>(PostResult::kDelivered),
                        static_cast<int>(classifyPostStatus(201)));
  TEST_ASSERT_EQUAL_INT(static_cast<int>(PostResult::kDelivered),
                        static_cast<int>(classifyPostStatus(204)));
}

void test_transport_throttle_and_server_failures_are_retryable() {
  TEST_ASSERT_EQUAL_INT(static_cast<int>(PostResult::kRetryableFailure),
                        static_cast<int>(classifyPostStatus(-1)));
  TEST_ASSERT_EQUAL_INT(static_cast<int>(PostResult::kRetryableFailure),
                        static_cast<int>(classifyPostStatus(408)));
  TEST_ASSERT_EQUAL_INT(static_cast<int>(PostResult::kRetryableFailure),
                        static_cast<int>(classifyPostStatus(429)));
  TEST_ASSERT_EQUAL_INT(static_cast<int>(PostResult::kRetryableFailure),
                        static_cast<int>(classifyPostStatus(503)));
}

void test_other_client_failures_are_permanent() {
  TEST_ASSERT_EQUAL_INT(static_cast<int>(PostResult::kPermanentFailure),
                        static_cast<int>(classifyPostStatus(400)));
  TEST_ASSERT_EQUAL_INT(static_cast<int>(PostResult::kPermanentFailure),
                        static_cast<int>(classifyPostStatus(401)));
  TEST_ASSERT_EQUAL_INT(static_cast<int>(PostResult::kPermanentFailure),
                        static_cast<int>(classifyPostStatus(403)));
  TEST_ASSERT_EQUAL_INT(static_cast<int>(PostResult::kPermanentFailure),
                        static_cast<int>(classifyPostStatus(404)));
}

int main(int, char **) {
  UNITY_BEGIN();
  RUN_TEST(test_success_statuses_are_delivered);
  RUN_TEST(test_transport_throttle_and_server_failures_are_retryable);
  RUN_TEST(test_other_client_failures_are_permanent);
  return UNITY_END();
}

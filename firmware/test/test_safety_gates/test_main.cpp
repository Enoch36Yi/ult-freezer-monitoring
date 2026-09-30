#include <unity.h>

#include "ota_health.h"
#include "queue_recovery.h"

void setUp() {}
void tearDown() {}

void test_temp_file_is_adopted_only_when_original_queue_is_absent() {
  TEST_ASSERT_EQUAL_INT(static_cast<int>(QueueTempAction::kAdoptTemp),
                        static_cast<int>(queueTempAction(false, true)));
  TEST_ASSERT_EQUAL_INT(static_cast<int>(QueueTempAction::kDiscardTemp),
                        static_cast<int>(queueTempAction(true, true)));
  TEST_ASSERT_EQUAL_INT(static_cast<int>(QueueTempAction::kNone),
                        static_cast<int>(queueTempAction(true, false)));
}

void test_partial_queue_tail_keeps_only_complete_lines() {
  const char complete[] = "{\"temp_c\":-70}\n";
  const char mixed[] = "{\"temp_c\":-70}\n{\"temp_c\":-71}";
  const char partialOnly[] = "{\"temp_c\":-70}";
  TEST_ASSERT_EQUAL_UINT(sizeof(complete) - 1,
                         completeQueueBytes(complete, sizeof(complete) - 1));
  TEST_ASSERT_EQUAL_UINT(sizeof(complete) - 1,
                         completeQueueBytes(mixed, sizeof(mixed) - 1));
  TEST_ASSERT_EQUAL_UINT(0, completeQueueBytes(partialOnly, sizeof(partialOnly) - 1));
  TEST_ASSERT_TRUE(queueFinalByteCompletesLine('\n'));
  TEST_ASSERT_FALSE(queueFinalByteCompletesLine('}'));
}

void test_ota_health_requires_every_runtime_gate() {
  TEST_ASSERT_TRUE(ota_health::canConfirm(true, true, true, true, true, false));
  TEST_ASSERT_FALSE(ota_health::canConfirm(false, true, true, true, true, false));
  TEST_ASSERT_FALSE(ota_health::canConfirm(true, false, true, true, true, false));
  TEST_ASSERT_FALSE(ota_health::canConfirm(true, true, false, true, true, false));
  TEST_ASSERT_FALSE(ota_health::canConfirm(true, true, true, false, true, false));
  TEST_ASSERT_FALSE(ota_health::canConfirm(true, true, true, true, false, false));
  TEST_ASSERT_FALSE(ota_health::canConfirm(true, true, true, true, true, true));
}

void test_ota_rebind_happens_only_after_a_real_link_loss() {
  TEST_ASSERT_TRUE(ota_health::linkLost(true, false, true, false));
  TEST_ASSERT_FALSE(ota_health::linkLost(false, false, true, false));
  TEST_ASSERT_FALSE(ota_health::linkLost(true, true, true, false));
  TEST_ASSERT_FALSE(ota_health::linkLost(true, false, false, false));
  TEST_ASSERT_FALSE(ota_health::linkLost(true, false, true, true));
}

int main(int, char **) {
  UNITY_BEGIN();
  RUN_TEST(test_temp_file_is_adopted_only_when_original_queue_is_absent);
  RUN_TEST(test_partial_queue_tail_keeps_only_complete_lines);
  RUN_TEST(test_ota_health_requires_every_runtime_gate);
  RUN_TEST(test_ota_rebind_happens_only_after_a_real_link_loss);
  return UNITY_END();
}

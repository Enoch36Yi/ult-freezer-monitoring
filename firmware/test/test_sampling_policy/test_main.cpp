#include <unity.h>

#include "sampling_policy.h"

void setUp() {}
void tearDown() {}

void test_core_freezers_sample_every_minute() {
  TEST_ASSERT_EQUAL_UINT32(60000UL, sampleIntervalMs(1));
  TEST_ASSERT_EQUAL_UINT32(60000UL, sampleIntervalMs(6));
}

void test_fleet_freezers_sample_every_fifteen_minutes() {
  TEST_ASSERT_EQUAL_UINT32(900000UL, sampleIntervalMs(7));
  TEST_ASSERT_EQUAL_UINT32(900000UL, sampleIntervalMs(21));
}

void test_unprovisioned_id_uses_safe_fleet_interval() {
  TEST_ASSERT_EQUAL_UINT32(900000UL, sampleIntervalMs(0));
  TEST_ASSERT_EQUAL_UINT32(900000UL, sampleIntervalMs(22));
}

int main(int, char **) {
  UNITY_BEGIN();
  RUN_TEST(test_core_freezers_sample_every_minute);
  RUN_TEST(test_fleet_freezers_sample_every_fifteen_minutes);
  RUN_TEST(test_unprovisioned_id_uses_safe_fleet_interval);
  return UNITY_END();
}

#include <unity.h>

#include "queue_presence.h"

void setUp() {}
void tearDown() {}

void test_absent_queue_stays_idle_until_a_reading_is_buffered() {
  QueuePresence queue;
  queue.onMount(false);
  TEST_ASSERT_FALSE(queue.hasData());
  queue.onBuffered();
  TEST_ASSERT_TRUE(queue.hasData());
}

void test_flushing_last_reading_clears_queue_presence() {
  QueuePresence queue;
  queue.onMount(true);
  TEST_ASSERT_TRUE(queue.hasData());
  queue.onFlushRemaining(0);
  TEST_ASSERT_FALSE(queue.hasData());
}

void test_partial_flush_keeps_queue_presence() {
  QueuePresence queue;
  queue.onMount(true);
  queue.onFlushRemaining(2);
  TEST_ASSERT_TRUE(queue.hasData());
}

int main(int, char **) {
  UNITY_BEGIN();
  RUN_TEST(test_absent_queue_stays_idle_until_a_reading_is_buffered);
  RUN_TEST(test_flushing_last_reading_clears_queue_presence);
  RUN_TEST(test_partial_flush_keeps_queue_presence);
  return UNITY_END();
}

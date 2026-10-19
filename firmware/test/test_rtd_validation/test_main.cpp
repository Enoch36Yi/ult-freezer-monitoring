#include <unity.h>
#include <initializer_list>

#include "rtd_validation.h"

void setUp() {}
void tearDown() {}

void test_pt1000_conversion_preserves_negative_temperature() {
  // About 684 ohms is a PT1000 at -80 C with a 4300 ohm reference. The
  // corresponding MAX31865 code is approximately 5208.
  const float temperature = rtd_validation::temperatureCFromRaw(5208);
  TEST_ASSERT_FLOAT_WITHIN(1.0f, -80.0f, temperature);
  TEST_ASSERT_TRUE(temperature < 0.0f);
}

void test_valid_room_temperature_code_is_accepted() {
  const auto status = rtd_validation::classifySample(7620, 0);
  TEST_ASSERT_EQUAL_INT(static_cast<int>(rtd_validation::SampleStatus::kValid),
                        static_cast<int>(status));
  TEST_ASSERT_TRUE(rtd_validation::temperatureIsValid(
      rtd_validation::temperatureCFromRaw(7620)));
}

void test_cryogenic_conversion_uses_negative_temperature_polynomial() {
  // Independent IEC 60751 Callendar-Van Dusen point for a PT1000 at -196 C:
  // R = 1000 * (1 + A*T + B*T^2 + C*(T-100)*T^3), using
  // A=3.9083e-3, B=-5.775e-7, C=-4.183e-12.
  TEST_ASSERT_FLOAT_WITHIN(0.1f, -196.0f,
      rtd_validation::temperatureCFromResistance(202.46512947f));
}

void test_positive_conversion_keeps_quadratic_branch() {
  TEST_ASSERT_FLOAT_WITHIN(0.02f, 100.0f,
      rtd_validation::temperatureCFromResistance(1385.055f));
}

void test_open_circuit_and_short_faults_never_become_readings() {
  const auto openStatus = rtd_validation::classifySample(0x7FFF, 0x10);
  TEST_ASSERT_EQUAL_INT(
      static_cast<int>(rtd_validation::SampleStatus::kSpiCommunication),
      static_cast<int>(openStatus));

  const auto shortStatus = rtd_validation::classifySample(100, 0x08);
  TEST_ASSERT_EQUAL_INT(
      static_cast<int>(rtd_validation::SampleStatus::kHardwareFault),
      static_cast<int>(shortStatus));
}

void test_invalid_raw_acquisition_is_rejected() {
  const auto zeroStatus = rtd_validation::classifySample(0, 0);
  TEST_ASSERT_EQUAL_INT(
      static_cast<int>(rtd_validation::SampleStatus::kSpiCommunication),
      static_cast<int>(zeroStatus));

  const auto impossibleTemperature = rtd_validation::classifySample(32700, 0);
  TEST_ASSERT_EQUAL_INT(
      static_cast<int>(rtd_validation::SampleStatus::kInvalidReading),
      static_cast<int>(impossibleTemperature));
}

void test_max31865_fault_bits_are_rejected() {
  for (const uint8_t fault : {0x80, 0x40, 0x20, 0x10, 0x08, 0x04}) {
    const auto status = rtd_validation::classifySample(7620, fault);
    TEST_ASSERT_EQUAL_INT(
        static_cast<int>(rtd_validation::SampleStatus::kHardwareFault),
        static_cast<int>(status));
  }
}

int main(int, char **) {
  UNITY_BEGIN();
  RUN_TEST(test_pt1000_conversion_preserves_negative_temperature);
  RUN_TEST(test_valid_room_temperature_code_is_accepted);
  RUN_TEST(test_cryogenic_conversion_uses_negative_temperature_polynomial);
  RUN_TEST(test_positive_conversion_keeps_quadratic_branch);
  RUN_TEST(test_open_circuit_and_short_faults_never_become_readings);
  RUN_TEST(test_invalid_raw_acquisition_is_rejected);
  RUN_TEST(test_max31865_fault_bits_are_rejected);
  return UNITY_END();
}

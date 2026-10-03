#pragma once

#include <cmath>
#include <cstdint>

// Hardware-independent MAX31865/PT1000 validation and conversion helpers.
// The conversion follows the Callendar–Van Dusen calculation used by the
// Adafruit_MAX31865 library, with the board's 4300 ohm reference resistor and
// a nominal 1000 ohm platinum RTD.
namespace rtd_validation {

constexpr float kNominalOhms = 1000.0f;
constexpr float kReferenceOhms = 4300.0f;
constexpr float kMinimumTemperatureC = -200.0f;
constexpr float kMaximumTemperatureC = 850.0f;
constexpr uint16_t kAllOnesRaw = 0x7FFF;
constexpr uint8_t kFaultMask = 0xFC;
constexpr uint8_t kReservedFaultMask = 0x03;

enum class SampleStatus {
  kValid,
  kSpiCommunication,
  kHardwareFault,
  kInvalidReading,
};

inline float resistanceOhms(uint16_t raw) {
  return (static_cast<float>(raw) * kReferenceOhms) / 32768.0f;
}

inline float temperatureCFromResistance(float resistance) {
  constexpr float rtdA = 3.9083e-3f;
  constexpr float rtdB = -5.775e-7f;

  const float z1 = -rtdA;
  const float z2 = rtdA * rtdA - (4.0f * rtdB);
  const float z3 = (4.0f * rtdB) / kNominalOhms;
  const float z4 = 2.0f * rtdB;

  float value = z2 + (z3 * resistance);
  if (value >= 0.0f) {
    return (std::sqrt(value) + z1) / z4;
  }

  // Polynomial branch required for negative Celsius temperatures.
  float normalized = resistance / kNominalOhms;
  normalized *= 100.0f;
  float polynomial = normalized;
  float temperature = -242.02f + (2.2228f * polynomial);
  polynomial *= normalized;
  temperature += 2.5859e-3f * polynomial;
  polynomial *= normalized;
  temperature -= 4.8260e-6f * polynomial;
  polynomial *= normalized;
  temperature -= 2.8183e-8f * polynomial;
  polynomial *= normalized;
  temperature += 1.5243e-10f * polynomial;
  return temperature;
}

inline float temperatureCFromRaw(uint16_t raw) {
  return temperatureCFromResistance(resistanceOhms(raw));
}

inline bool temperatureIsValid(float temperatureC) {
  return std::isfinite(temperatureC) &&
         temperatureC >= kMinimumTemperatureC &&
         temperatureC <= kMaximumTemperatureC;
}

inline SampleStatus classifySample(uint16_t raw, uint8_t fault) {
  // An unconnected/floating SPI bus commonly reads all zeroes or all ones.
  // The two reserved low fault bits also make an all-ones register response
  // distinguishable from a real MAX31865 fault report.
  if (raw == 0 || raw == kAllOnesRaw || (fault & kReservedFaultMask) != 0) {
    return SampleStatus::kSpiCommunication;
  }
  if ((fault & kFaultMask) != 0) return SampleStatus::kHardwareFault;
  return temperatureIsValid(temperatureCFromRaw(raw))
             ? SampleStatus::kValid
             : SampleStatus::kInvalidReading;
}

}  // namespace rtd_validation

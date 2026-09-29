#pragma once

#include <stdint.h>

constexpr uint32_t CORE_SAMPLE_INTERVAL_MS = 60UL * 1000UL;
constexpr uint32_t FLEET_SAMPLE_INTERVAL_MS = 15UL * 60UL * 1000UL;

// M1 YBR O8: the six-unit comparison core logs every minute; the other
// fifteen freezers log every fifteen minutes. Invalid/unprovisioned IDs use
// the conservative fleet cadence until provisioning is complete.
constexpr uint32_t sampleIntervalMs(int freezerId) {
  return freezerId >= 1 && freezerId <= 6 ? CORE_SAMPLE_INTERVAL_MS
                                         : FLEET_SAMPLE_INTERVAL_MS;
}

static_assert(sampleIntervalMs(1) == 60000UL,
              "Freezer 1 must sample every minute");
static_assert(sampleIntervalMs(6) == 60000UL,
              "Freezer 6 must sample every minute");
static_assert(sampleIntervalMs(7) == 900000UL,
              "Freezer 7 must sample every 15 minutes");
static_assert(sampleIntervalMs(21) == 900000UL,
              "Freezer 21 must sample every 15 minutes");
static_assert(sampleIntervalMs(0) == 900000UL &&
                  sampleIntervalMs(22) == 900000UL,
              "Invalid freezer IDs must use the safe fleet cadence");

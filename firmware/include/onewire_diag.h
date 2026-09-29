#pragma once

// ---------------------------------------------------------------------------
// Prototype 22 bench diagnostic for the 1-Wire line (build flag ONEWIRE_DIAG,
// PlatformIO env prototype-22-diag only).
//
// Characterises the DQ net from the ESP32 side without any meter work:
//   - digital level with no pull, internal pull-up, internal pull-down
//   - ADC voltage for the same three cases (rough external-resistor estimate)
//   - whether GPIO reads LOW while driving LOW (hard short to 3V3 check)
//   - a timed reset: bus-high-before-reset, rise after release, and any
//     presence pulse (start and width in microseconds)
//   - the unmodified OneWire library's own reset() and ROM search result
// Prints one "[1wire-diag]" block and leaves the pin released (INPUT) with the
// OneWire object re-initialised, so normal sampling continues unchanged.
// ---------------------------------------------------------------------------

#include <OneWire.h>
#include <stdint.h>

void oneWireDiagnose(OneWire &bus, uint8_t pin);

// ---------------------------------------------------------------------------
// Prototype 22 1-Wire line diagnostic. See include/onewire_diag.h.
//
// Compiled only with ONEWIRE_DIAG (env prototype-22-diag), so the fleet and
// plain prototype-22 images contain none of this code.
// ---------------------------------------------------------------------------

#ifdef ONEWIRE_DIAG

#include "onewire_diag.h"

#include <Arduino.h>
#include <driver/adc.h>
#include <driver/rtc_io.h>
#include <esp_adc_cal.h>

// The library's own register helpers, so the timed reset below drives and
// samples the pad exactly as OneWire::reset() does.
#include "util/OneWire_direct_gpio.h"

namespace {

// ESP32-S3 weak pulls are ~45 kOhm typical but not trimmed, so resistor
// estimates derived from them are rough (tens of percent), not measurements.
constexpr float kInternalPullOhms = 45000.0f;
constexpr float kAssumedRailMv = 3300.0f;
constexpr uint32_t kAdcSaturatedRaw = 4080;

constexpr uint32_t kResetLowUs = 480;
constexpr uint32_t kCaptureUs = 600;       // presence ends by 60 + 240 us
constexpr uint32_t kLibrarySampleUs = 70;  // where OneWire::reset() samples
constexpr int kMaxEdges = 16;

portMUX_TYPE s_mux = portMUX_INITIALIZER_UNLOCKED;
uint32_t s_runs = 0;

struct Capture {
  bool highBeforeReset = false;
  bool readsLowWhileDriven = false;
  bool overflow = false;
  int edgeCount = 0;
  uint32_t edgeCycles[kMaxEdges];
  uint8_t edgeLevel[kMaxEdges];
};

struct AdcReading {
  bool ok = false;
  bool saturated = false;
  uint32_t raw = 0;
  uint32_t mv = 0;
};

enum class Pull { None, Up, Down };

// HIGH reads out of 8 after settling in `mode`: 8 = solid high, 0 = solid
// low, anything between means the line is floating or noisy.
int highCount(uint8_t pin, uint8_t mode) {
  pinMode(pin, mode);
  delay(2);
  int highs = 0;
  for (int i = 0; i < 8; i++) {
    highs += digitalRead(pin) ? 1 : 0;
    delayMicroseconds(50);
  }
  return highs;
}

AdcReading adcRead(adc1_channel_t ch, gpio_num_t gpio, Pull pull,
                   bool calibrated, const esp_adc_cal_characteristics_t &cal) {
  rtc_gpio_pullup_dis(gpio);
  rtc_gpio_pulldown_dis(gpio);
  if (pull == Pull::Up) rtc_gpio_pullup_en(gpio);
  if (pull == Pull::Down) rtc_gpio_pulldown_en(gpio);
  delay(3);

  AdcReading r;
  uint32_t sum = 0;
  for (int i = 0; i < 16; i++) {
    const int raw = adc1_get_raw(ch);
    if (raw < 0) return r;
    sum += static_cast<uint32_t>(raw);
  }
  r.ok = true;
  r.raw = sum / 16;
  r.saturated = r.raw >= kAdcSaturatedRaw;
  // Uncalibrated fallback: nominal 0-3100 mV span at 12 dB.
  r.mv = calibrated ? esp_adc_cal_raw_to_voltage(r.raw, &cal)
                    : r.raw * 3100UL / 4095UL;
  return r;
}

void printAdc(const char *label, const AdcReading &r) {
  if (!r.ok) {
    Serial.printf(" %s n/a", label);
  } else {
    Serial.printf(" %s %s%lu", label, r.saturated ? ">=" : "",
                  static_cast<unsigned long>(r.mv));
  }
}

// Mirrors OneWire::reset(): wait up to 250 us for an idle-high bus, drive LOW
// for 480 us, release, then (unlike the library, which samples once at 70 us)
// record every level change for 600 us with interrupts off on this core.
void IRAM_ATTR timedReset(uint8_t pin, uint32_t cyclesPerUs, Capture &cap) {
  directModeInput(pin);
  for (int i = 0; i < 125; i++) {
    if (directRead(pin)) {
      cap.highBeforeReset = true;
      break;
    }
    delayMicroseconds(2);
  }
  if (!cap.highBeforeReset) return;

  directWriteLow(pin);
  directModeOutput(pin);
  delayMicroseconds(5);
  cap.readsLowWhileDriven = !directRead(pin);
  delayMicroseconds(kResetLowUs - 5);

  const uint32_t window = kCaptureUs * cyclesPerUs;
  uint8_t last = 0;
  portENTER_CRITICAL(&s_mux);
  const uint32_t t0 = ESP.getCycleCount();
  directModeInput(pin);
  for (;;) {
    const uint32_t dt = ESP.getCycleCount() - t0;
    if (dt >= window) break;
    const uint8_t level = directRead(pin) ? 1 : 0;
    if (level == last) continue;
    if (cap.edgeCount == kMaxEdges) {
      cap.overflow = true;
      break;
    }
    cap.edgeCycles[cap.edgeCount] = dt;
    cap.edgeLevel[cap.edgeCount] = level;
    cap.edgeCount++;
    last = level;
  }
  portEXIT_CRITICAL(&s_mux);
}

}  // namespace

void oneWireDiagnose(OneWire &bus, uint8_t pin) {
  s_runs++;
  Serial.printf("[1wire-diag] run %lu on GPIO%u, uptime %lu s\n",
                static_cast<unsigned long>(s_runs), pin,
                static_cast<unsigned long>(millis() / 1000UL));

  // 1. Static digital level against the ESP32's own weak pulls.
  const int hiNone = highCount(pin, INPUT);
  const int hiUp = highCount(pin, INPUT_PULLUP);
  const int hiDown = highCount(pin, INPUT_PULLDOWN);
  Serial.printf(
      "[1wire-diag] HIGH reads of 8: no-pull %d, int-pullup %d, "
      "int-pulldown %d\n",
      hiNone, hiUp, hiDown);

  // 2. The same three cases as voltages (GPIO4 is ADC1, usable with Wi-Fi).
  // Clear the digital pull left by step 1 so only the RTC pulls act below.
  pinMode(pin, INPUT);
  AdcReading mvNone, mvUp, mvDown;
  const int8_t chan = digitalPinToAnalogChannel(pin);
  if (chan >= 0 && chan < 10) {
    const adc1_channel_t ch = static_cast<adc1_channel_t>(chan);
    const gpio_num_t gpio = static_cast<gpio_num_t>(pin);
    esp_adc_cal_characteristics_t cal;
    adc1_config_width(ADC_WIDTH_BIT_12);
    adc1_config_channel_atten(ch, ADC_ATTEN_DB_12);
    const bool calibrated =
        esp_adc_cal_characterize(ADC_UNIT_1, ADC_ATTEN_DB_12, ADC_WIDTH_BIT_12,
                                 1100, &cal) != ESP_ADC_CAL_VAL_NOT_SUPPORTED;
    mvNone = adcRead(ch, gpio, Pull::None, calibrated, cal);
    mvUp = adcRead(ch, gpio, Pull::Up, calibrated, cal);
    mvDown = adcRead(ch, gpio, Pull::Down, calibrated, cal);
    rtc_gpio_pullup_dis(gpio);
    rtc_gpio_pulldown_dis(gpio);
    rtc_gpio_deinit(gpio);
    Serial.print("[1wire-diag] ADC mV:");
    printAdc("no-pull", mvNone);
    printAdc(", int-pullup", mvUp);
    printAdc(", int-pulldown", mvDown);
    Serial.println(calibrated ? " (eFuse-calibrated)" : " (uncalibrated)");
  }
  // Back to a plain digital input before touching the bus again.
  pinMode(pin, INPUT);

  // 3. Timed reset/presence, using the library's pad access.
  Capture cap;
  const uint32_t cyclesPerUs = ESP.getCpuFreqMHz();
  timedReset(pin, cyclesPerUs, cap);

  int riseUs = -1, presStartUs = -1, presEndUs = -1;
  int levelAtLibSample = 0;
  if (!cap.highBeforeReset) {
    Serial.println(
        "[1wire-diag] bus never read HIGH within 250 us before reset: "
        "library reset() returns 0 here without ever driving the line");
  } else {
    Serial.printf("[1wire-diag] while driving LOW the pad reads %s\n",
                  cap.readsLowWhileDriven ? "LOW (driver wins)"
                                          : "HIGH (cannot pull line low)");
    Serial.print("[1wire-diag] edges after release (us:level):");
    if (cap.edgeCount == 0) Serial.print(" none (stayed LOW)");
    for (int i = 0; i < cap.edgeCount; i++) {
      const int us = static_cast<int>(cap.edgeCycles[i] / cyclesPerUs);
      const uint8_t lvl = cap.edgeLevel[i];
      Serial.printf(" %d:%u", us, lvl);
      if (static_cast<uint32_t>(us) <= kLibrarySampleUs) levelAtLibSample = lvl;
      if (lvl == 1 && riseUs < 0) riseUs = us;
      if (lvl == 0 && riseUs >= 0 && presStartUs < 0) presStartUs = us;
      if (lvl == 1 && presStartUs >= 0 && presEndUs < 0) presEndUs = us;
    }
    Serial.println(cap.overflow ? " ...(more)" : "");
    if (riseUs < 0) {
      Serial.printf("[1wire-diag] line stayed LOW for %lu us after release\n",
                    static_cast<unsigned long>(kCaptureUs));
    } else if (presStartUs < 0) {
      Serial.printf("[1wire-diag] rose in %d us; NO presence pulse in %lu us\n",
                    riseUs, static_cast<unsigned long>(kCaptureUs));
    } else {
      Serial.printf(
          "[1wire-diag] rose in %d us; presence LOW from %d us, width %s%d us "
          "(spec: starts 15-60 us after rise, 60-240 us wide)\n",
          riseUs, presStartUs, presEndUs < 0 ? ">" : "",
          (presEndUs < 0 ? static_cast<int>(kCaptureUs) : presEndUs) -
              presStartUs);
    }
    Serial.printf("[1wire-diag] level at library's %lu us sample: %s\n",
                  static_cast<unsigned long>(kLibrarySampleUs),
                  levelAtLibSample ? "HIGH (no presence)" : "LOW (presence)");
  }

  // 4. Cross-check with the unmodified library path.
  bus.begin(pin);
  const uint8_t libReset = bus.reset();
  int found = 0;
  uint8_t rom[8];
  bus.reset_search();
  while (found < 4 && bus.search(rom)) {
    found++;
    Serial.printf(
        "[1wire-diag] ROM %02X-%02X%02X%02X%02X%02X%02X-%02X crc %s%s\n", rom[0],
        rom[6], rom[5], rom[4], rom[3], rom[2], rom[1], rom[7],
        OneWire::crc8(rom, 7) == rom[7] ? "ok" : "BAD",
        rom[0] == 0x28 ? " (DS18B20 family)" : "");
  }
  bus.reset_search();
  Serial.printf("[1wire-diag] library reset()=%u, ROM search found %d\n",
                libReset, found);

  // 5. One-line reading of the above. Hints, not proof; raw values rule.
  const bool extPullDown = hiUp == 0;
  const bool noExtPull = hiUp == 8 && hiDown == 0;
  Serial.print("[1wire-diag] VERDICT: ");
  if (found > 0) {
    Serial.println("device answers; 1-Wire path works");
  } else if (extPullDown) {
    Serial.print(
        "DQ held LOW even against the internal pull-up -> GPIO net is pulled "
        "to GND (pull-down or short); reset can never see an idle bus");
    if (mvUp.ok && !mvUp.saturated && mvUp.mv > 60 &&
        mvUp.mv < kAssumedRailMv) {
      const float kOhm = kInternalPullOhms * mvUp.mv /
                         (kAssumedRailMv - mvUp.mv) / 1000.0f;
      Serial.printf(". ~%.1f kOhm to GND (rough): a resistor, not a hard short",
                    kOhm);
    } else if (mvUp.ok && mvUp.mv <= 60) {
      Serial.print(". ~0 V with pull-up: looks like a hard short to GND");
    }
    Serial.println();
  } else if (noExtPull) {
    Serial.println(
        "no external pull visible: the line only follows the ESP32's own weak "
        "pulls -> GPIO pad not connected to a pulled-up DQ net");
  } else if (hiDown == 8 && cap.highBeforeReset && !cap.readsLowWhileDriven) {
    Serial.print("line pulled HIGH but GPIO cannot drive it LOW");
    if (mvDown.ok && mvDown.saturated) {
      Serial.println(" and it sits at the ADC ceiling with the internal "
                     "pull-down -> likely hard tie of DQ to 3V3");
    } else {
      Serial.println(" although the pull-up looks resistive -> suspect the GPIO "
                     "output stage");
    }
  } else if (hiDown == 8 && cap.readsLowWhileDriven && riseUs >= 0 &&
             presStartUs < 0) {
    Serial.print("line electrically normal from the ESP32 (external pull-up");
    if (mvDown.ok && !mvDown.saturated && mvDown.mv > 60 &&
        mvDown.mv < kAssumedRailMv) {
      const float kOhm = kInternalPullOhms * (kAssumedRailMv - mvDown.mv) /
                         mvDown.mv / 1000.0f;
      Serial.printf(" ~%.1f kOhm rough", kOhm);
    }
    Serial.printf(", drives LOW, recovers in %d us) but NO device answers -> "
                  "fault is at the sensor: DQ/GND leg joint, orientation, or "
                  "the part\n",
                  riseUs);
  } else if (presStartUs >= 0) {
    Serial.println("presence seen but ROM search failed -> marginal timing, "
                   "noise, or a damaged part");
  } else {
    Serial.println("inconclusive; use the raw values above");
  }

  pinMode(pin, INPUT);
  bus.begin(pin);
}

#endif  // ONEWIRE_DIAG

import test from 'node:test';
import assert from 'node:assert/strict';
import { parseOptions, parseSerial, evaluateObservation } from './prototype-check.mjs';

test('a posted serial reading matches a genuine stored row by time and temperature', () => {
  const serial = parseSerial([
    '[sensor] MAX31865 ready: PT1000 2-wire, software SPI CS=4 MOSI=5 MISO=6 SCK=7',
    '[reading] {"prototype_id":22,"sensor_tier":"esp32_pt1000_max31865","temp_c":-22.5,"recorded_at":"2026-09-25T12:00:00Z"}',
    '[reading] posted',
  ].join('\n'));
  const rows = [{ id: 7, prototype_id: 22, sensor_tier: 'esp32_pt1000_max31865', temp_c: -22.5,
    recorded_at: '2026-09-25T12:00:00+00:00', received_at: '2026-09-25T12:00:02+00:00' }];
  assert.equal(evaluateObservation(serial, rows).state, 'matched');
});

test('a buffered reading is not reported as delivered', () => {
  const serial = parseSerial([
    '[reading] {"prototype_id":22,"sensor_tier":"esp32_pt1000_max31865","temp_c":-22.5,"recorded_at":"2026-09-25T12:00:00Z"}',
    '[queue] buffered reading to LittleFS',
  ].join('\n'));
  assert.equal(evaluateObservation(serial, []).state, 'no_posted_serial_reading');
});

test('an unmatched posted reading is not reported as database verified', () => {
  const serial = parseSerial([
    '[reading] {"prototype_id":22,"sensor_tier":"esp32_pt1000_max31865","temp_c":-22.5,"recorded_at":"2026-09-25T12:00:00Z"}',
    '[reading] posted',
  ].join('\n'));
  assert.equal(evaluateObservation(serial, [{ id: 8, prototype_id: 22, sensor_tier: 'esp32_pt1000_max31865',
    temp_c: -21, recorded_at: '2026-09-25T12:00:00Z' }]).state, 'posted_not_found_in_rows');
});

test('a row alone cannot establish device provenance', () => {
  assert.equal(evaluateObservation(parseSerial(''), [{ id: 9, prototype_id: 22,
    sensor_tier: 'esp32_pt1000_max31865', temp_c: 20, recorded_at: '2026-09-25T12:00:00Z' }]).state,
  'no_posted_serial_reading');
});

test('a missing option value fails before any network request', () => {
  assert.throws(() => parseOptions(['--serial-log']), /Usage: node scripts\/prototype-check\.mjs/);
});

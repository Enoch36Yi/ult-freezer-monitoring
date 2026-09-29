import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseSerial, evaluateObservation } from './prototype-check.mjs';

test('a posted serial reading matches a genuine stored row by time and temperature', () => {
  const serial = parseSerial([
    '[sensor] DS18B20 found on GPIO4',
    '[reading] {"prototype_id":22,"sensor_tier":"esp32_ds18b20","temp_c":-22.5,"recorded_at":"2026-09-25T12:00:00Z"}',
    '[reading] posted',
  ].join('\n'));
  const rows = [{ id: 7, prototype_id: 22, sensor_tier: 'esp32_ds18b20', temp_c: -22.5,
    recorded_at: '2026-09-25T12:00:00+00:00', received_at: '2026-09-25T12:00:02+00:00' }];
  assert.equal(evaluateObservation(serial, rows).state, 'matched');
});

test('a buffered reading is not reported as delivered', () => {
  const serial = parseSerial([
    '[reading] {"prototype_id":22,"sensor_tier":"esp32_ds18b20","temp_c":-22.5,"recorded_at":"2026-09-25T12:00:00Z"}',
    '[queue] buffered reading to LittleFS',
  ].join('\n'));
  assert.equal(evaluateObservation(serial, []).state, 'no_posted_serial_reading');
});

test('an unmatched posted reading is not reported as database verified', () => {
  const serial = parseSerial([
    '[reading] {"prototype_id":22,"sensor_tier":"esp32_ds18b20","temp_c":-22.5,"recorded_at":"2026-09-25T12:00:00Z"}',
    '[reading] posted',
  ].join('\n'));
  assert.equal(evaluateObservation(serial, [{ id: 8, prototype_id: 22, sensor_tier: 'esp32_ds18b20',
    temp_c: -21, recorded_at: '2026-09-25T12:00:00Z' }]).state, 'posted_not_found_in_rows');
});

test('a row alone cannot establish device provenance', () => {
  assert.equal(evaluateObservation(parseSerial(''), [{ id: 9, prototype_id: 22,
    sensor_tier: 'esp32_ds18b20', temp_c: 20, recorded_at: '2026-09-25T12:00:00Z' }]).state,
  'no_posted_serial_reading');
});

test('a missing option value fails before any network request', () => {
  const script = fileURLToPath(new URL('./prototype-check.mjs', import.meta.url));
  const result = spawnSync(process.execPath, [script, '--serial-log'], { encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Usage: node scripts\/prototype-check\.mjs/);
});

// Temporary synthetic source/artifact fixtures; never a deployable firmware image.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

test('release manifest fingerprints dirty source and excludes ignored private configuration', (t) => {
  const root = mkdtempSync(resolve(tmpdir(), 'freezer-release-fixture-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(resolve(root, 'scripts'));
  mkdirSync(resolve(root, 'firmware/include'), { recursive: true });
  writeFileSync(resolve(root, 'scripts/create-release-manifest.mjs'), readFileSync(new URL('./create-release-manifest.mjs', import.meta.url)));
  writeFileSync(resolve(root, '.gitignore'), 'firmware/include/device_security.h\n');
  writeFileSync(resolve(root, 'firmware/include/config.h'), '#define FIRMWARE_VERSION "0.3.0"\n#define SENSOR_TIER "esp32_pt1000_max31865"\n');
  writeFileSync(resolve(root, 'firmware/include/device_security.h'), 'SYNTHETIC_PRIVATE_FIXTURE');
  const artifact = resolve(root, 'fixture.bin');
  writeFileSync(artifact, 'SYNTHETIC_NOT_FIRMWARE');
  execFileSync('git', ['init', '--quiet'], { cwd: root });
  execFileSync('git', ['add', '.gitignore', 'scripts', 'firmware/include/config.h'], { cwd: root });
  const run = () => JSON.parse(execFileSync(process.execPath,
    [resolve(root, 'scripts/create-release-manifest.mjs'), artifact], { encoding: 'utf8' }));
  const before = run();
  assert.equal(before.git_dirty, true);
  assert.equal(before.firmware_defaults.firmware_version, '0.3.0');
  assert.equal(before.artifacts[0].sha256, createHash('sha256').update('SYNTHETIC_NOT_FIRMWARE').digest('hex'));
  assert.match(before.source_sha256, /^[a-f0-9]{64}$/);
  assert.ok(!JSON.stringify(before).includes('device_security.h'));
  assert.ok(!JSON.stringify(before).includes('SYNTHETIC_PRIVATE_FIXTURE'));
  writeFileSync(resolve(root, 'firmware/include/device_security.h'), 'OTHER_PRIVATE_FIXTURE');
  assert.equal(run().source_sha256, before.source_sha256);
  writeFileSync(resolve(root, 'firmware/include/config.h'), '#define FIRMWARE_VERSION "0.3.1"\n');
  assert.notEqual(run().source_sha256, before.source_sha256);
});

test('release manifest includes PowerShell runner modules and detects their changes', (t) => {
  const root = mkdtempSync(resolve(tmpdir(), 'freezer-release-module-fixture-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(resolve(root, 'scripts'));
  writeFileSync(resolve(root, 'scripts/create-release-manifest.mjs'), readFileSync(new URL('./create-release-manifest.mjs', import.meta.url)));
  const modulePath = resolve(root, 'scripts/qa-runner.psm1');
  writeFileSync(modulePath, '# SYNTHETIC RUNNER FIXTURE\nfunction Test-Fixture { return 0 }\n');
  const artifact = resolve(root, 'fixture.bin');
  writeFileSync(artifact, 'SYNTHETIC_NOT_FIRMWARE');
  execFileSync('git', ['init', '--quiet'], { cwd: root });
  const run = () => JSON.parse(execFileSync(process.execPath,
    [resolve(root, 'scripts/create-release-manifest.mjs'), artifact], { encoding: 'utf8' }));
  const before = run();
  const expectedHash = createHash('sha256').update(readFileSync(modulePath)).digest('hex');
  assert.equal(before.source_files.find((file) => file.name === 'scripts/qa-runner.psm1')?.sha256,
    expectedHash, 'the runner engine must be fingerprinted even before it is committed');
  writeFileSync(modulePath, '# SYNTHETIC MODIFIED RUNNER FIXTURE\nfunction Test-Fixture { return 1 }\n');
  assert.notEqual(run().source_sha256, before.source_sha256,
    'changing the QA engine must change the source fingerprint');
});

// Exercises the QA runner itself with fixture stages and deliberately missing
// prerequisites. No firmware is built and no stage that runs this suite is
// executed (missing prerequisites block it first), so there is no recursion.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const skip = process.platform === 'win32' ? false : 'The local QA runner targets Windows PowerShell';
const scripts = fileURLToPath(new URL('.', import.meta.url));
const missing = 'Z:\\definitely-missing-freezer-qa-tool';

function powershell(args, env = {}) {
  const childEnv = { ...process.env, ...env };
  delete childEnv.FREEZER_QA_CONFIG;
  return spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', ...args],
    { encoding: 'utf8', env: childEnv, timeout: 300_000 });
}

function tempDir(t) {
  const dir = mkdtempSync(resolve(tmpdir(), 'freezer-qa-runner-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

const results = (dir) => JSON.parse(readFileSync(resolve(dir, 'results.json'), 'utf8'));
const stage = (report, name) => report.stages.find((item) => item.name === name);

const driver = `
$ErrorActionPreference = 'Stop'
Import-Module $env:QA_MODULE -Force
$node = $env:QA_NODE
function Run-Node($Log, [string]$Code) {
  Invoke-QaProcess -FilePath $node -ArgumentList @('-e', $Code) -WorkingDirectory $env:QA_OUT -LogPath $Log
}
$all = @(
  (New-QaStage -Name 'pass' -Description 'node test summary, exit 0' -Run { param($c, $log)
    $p = Run-Node $log 'console.log("\\u2139 tests 2\\n\\u2139 pass 2\\n\\u2139 fail 0\\n\\u2139 skipped 0")'
    Get-QaOutcome $p (Get-QaNodeTestCounts $p.Output) -ExpectCounts }),
  (New-QaStage -Name 'fail' -Description 'exit 3' -Run { param($c, $log)
    Get-QaOutcome (Run-Node $log 'console.error("fixture failure"); process.exit(3)') }),
  (New-QaStage -Name 'skipped-tests' -Description 'exit 0 with a skipped test' -Run { param($c, $log)
    $p = Run-Node $log 'console.log("\\u2139 tests 2\\n\\u2139 pass 1\\n\\u2139 fail 0\\n\\u2139 skipped 1")'
    Get-QaOutcome $p (Get-QaNodeTestCounts $p.Output) -ExpectCounts }),
  (New-QaStage -Name 'no-summary' -Description 'exit 0 without a test summary' -Run { param($c, $log)
    $p = Run-Node $log 'console.log("nothing to see")'
    Get-QaOutcome $p (Get-QaNodeTestCounts $p.Output) -ExpectCounts }),
  (New-QaStage -Name 'blocked-dependency' -Description 'needs fail to pass' -Prerequisite { param($c)
    if ((Get-QaStageStatus $c 'fail') -ne 'passed') { 'depends on fail' } } -Run { throw 'must not run' }),
  (New-QaStage -Name 'throws' -Description 'runner exception' -Run { throw 'fixture exception' }),
  (New-QaStage -Name 'optional' -Description 'optional' -Required $false -OptionalSkipReason 'optional: not configured' -Run { throw 'must not run' }),
  (New-QaStage -Name 'app-control' -Description 'OS policy refuses a built test binary' -Run { param($c, $log)
    $p = Run-Node $log 'console.error("[WinError 4551] An Application Control policy has blocked this file"); process.exit(1)'
    Get-QaOutcome $p (Get-QaPlatformIoTestCounts $p.Output) -ExpectCounts }),
  (New-QaStage -Name 'app-control-and-failure' -Description 'policy text does not hide a real failure' -Run { param($c, $log)
    $p = Run-Node $log 'console.log("\\u2139 tests 2\\n\\u2139 pass 1\\n\\u2139 fail 1\\n\\u2139 skipped 0"); console.error("WinError 4551"); process.exit(1)'
    Get-QaOutcome $p (Get-QaNodeTestCounts $p.Output) -ExpectCounts }),
  (New-QaStage -Name 'pio-errored-suite' -Description 'a PlatformIO suite errored before reporting' -Run { param($c, $log)
    $p = Run-Node $log 'console.log("native  test_a  ERRORED   00:00:06.740\\nnative  test_b  PASSED    00:00:05.632\\n===== 3 test cases: 3 succeeded in 00:00:12.000 =====")'
    Get-QaOutcome $p (Get-QaPlatformIoTestCounts $p.Output) -ExpectCounts })
)
$selected = @($env:QA_SELECTED -split ',')
$stages = @($all | Where-Object { $env:QA_DEFINED -split ',' -contains $_.Name })
$context = New-QaContext -OutputDir $env:QA_OUT -Selected $selected -Suite 'fixture' -FullRun ($env:QA_FULL -eq '1')
$results = Invoke-QaRun -Stages $stages -Context $context
exit $results.overall.exit_code
`;

function runDriver(t, { defined, selected, full }) {
  const dir = tempDir(t);
  const script = resolve(dir, 'driver.ps1');
  writeFileSync(script, driver);
  const out = resolve(dir, 'out');
  const run = powershell(['-File', script], { QA_MODULE: resolve(scripts, 'qa-runner.psm1'), QA_NODE: process.execPath,
    QA_OUT: out, QA_DEFINED: defined.join(','), QA_SELECTED: selected.join(','), QA_FULL: full ? '1' : '0' });
  return { run, report: results(out), out };
}

test('stage failures, skipped tests, missing summaries and exceptions propagate distinctly', { skip }, (t) => {
  const names = ['pass', 'fail', 'skipped-tests', 'no-summary', 'blocked-dependency', 'throws', 'optional'];
  const { run, report, out } = runDriver(t, { defined: names, selected: names.filter((name) => name !== 'optional'), full: true });
  assert.equal(run.status, 1, run.stderr);
  assert.equal(report.overall.status, 'failed');
  assert.equal(stage(report, 'pass').status, 'passed');
  assert.deepEqual(stage(report, 'pass').counts, { total: 2, passed: 2, failed: 0, skipped: 0 });
  assert.equal(stage(report, 'fail').status, 'failed');
  assert.equal(stage(report, 'fail').exit_code, 3);
  assert.match(readFileSync(resolve(out, stage(report, 'fail').log), 'utf8'), /fixture failure[\s\S]*exit code: 3/);
  assert.equal(stage(report, 'skipped-tests').status, 'failed');
  assert.match(stage(report, 'skipped-tests').reason, /incomplete: 1 test\(s\) skipped/);
  assert.equal(stage(report, 'no-summary').status, 'failed');
  assert.match(stage(report, 'no-summary').reason, /no test summary/);
  assert.equal(stage(report, 'blocked-dependency').status, 'blocked');
  assert.equal(stage(report, 'throws').status, 'failed');
  assert.match(stage(report, 'throws').reason, /fixture exception/);
  assert.equal(stage(report, 'optional').status, 'skipped');
  assert.deepEqual(report.summary, { passed: 1, failed: 4, blocked: 1, skipped: 1 });
  assert.match(stage(report, 'pass').log_sha256, /^[0-9a-f]{64}$/);
  assert.ok(readFileSync(resolve(out, 'results.md'), 'utf8').includes('| fail | True | failed |'));
});

test('an OS application-control refusal is blocked, never passed, and never hides real failures', { skip }, (t) => {
  const names = ['app-control', 'app-control-and-failure', 'pio-errored-suite'];
  const { run, report } = runDriver(t, { defined: names, selected: names, full: true });
  assert.equal(run.status, 1, run.stderr);
  assert.equal(stage(report, 'app-control').status, 'blocked');
  assert.match(stage(report, 'app-control').reason, /WinError 4551/);
  assert.equal(stage(report, 'app-control-and-failure').status, 'failed');
  assert.equal(stage(report, 'pio-errored-suite').status, 'failed');
  assert.match(stage(report, 'pio-errored-suite').reason, /1 test suite\(s\) errored/);
});

test('a full run with a blocked required stage is not reported as success', { skip }, (t) => {
  const { run, report } = runDriver(t, { defined: ['pass', 'blocked-dependency', 'optional'],
    selected: ['pass', 'blocked-dependency'], full: true });
  assert.equal(run.status, 2);
  assert.equal(report.overall.status, 'blocked');
  assert.deepEqual(report.overall.required_not_passed, ['blocked-dependency']);
});

test('a requested subset that passes is labeled partial, never full', { skip }, (t) => {
  const { run, report } = runDriver(t, { defined: ['pass', 'fail'], selected: ['pass'], full: false });
  assert.equal(run.status, 0);
  assert.equal(report.overall.status, 'partial-passed');
  assert.deepEqual(report.overall.required_not_requested, ['fail']);
  assert.equal(stage(report, 'fail').status, 'skipped');
});

const cli = resolve(scripts, 'check-local.ps1');
function emptyConfig(dir) {
  const path = resolve(dir, 'qa-config.json');
  writeFileSync(path, '{}');
  return path;
}

test('check-local blocks stages whose configured prerequisites are missing', { skip }, (t) => {
  const dir = tempDir(t);
  const out = resolve(dir, 'run');
  const run = powershell(['-File', cli, '-ConfigFile', emptyConfig(dir), '-Stages', 'automation-tests,firmware-native-tests',
    '-PgliteModule', `${missing}\\index.js`, '-PythonExecutable', `${missing}\\python.exe`, '-OutputDir', out]);
  assert.equal(run.status, 2, run.stdout + run.stderr);
  const report = results(out);
  assert.equal(report.overall.status, 'blocked');
  assert.equal(stage(report, 'automation-tests').status, 'blocked');
  assert.match(stage(report, 'automation-tests').reason, /PGlite module was not found/);
  assert.equal(stage(report, 'firmware-native-tests').status, 'blocked');
  assert.match(stage(report, 'firmware-native-tests').reason, /configured python was not found/);
  assert.equal(stage(report, 'web-build').status, 'skipped');
  assert.equal(report.full_run, false);
});

test('a full check-local run with missing tools exits 2 and lists every unmet required check', { skip }, (t) => {
  const dir = tempDir(t);
  const out = resolve(dir, 'run');
  const run = powershell(['-File', cli, '-ConfigFile', emptyConfig(dir), '-NodeExecutable', `${missing}\\node.exe`,
    '-GitExecutable', `${missing}\\git.exe`, '-PythonExecutable', `${missing}\\python.exe`, '-CadPython', `${missing}\\python.exe`,
    '-PgliteModule', `${missing}\\index.js`, '-OutputDir', out]);
  assert.equal(run.status, 2, run.stdout + run.stderr);
  const report = results(out);
  assert.equal(report.full_run, true);
  assert.equal(report.overall.status, 'blocked');
  assert.equal(stage(report, 'preservation-check').status, 'passed');
  assert.equal(stage(report, 'firmware-bench-build').status, 'skipped');
  assert.equal(stage(report, 'firmware-image-isolation').status, 'blocked');
  assert.match(stage(report, 'firmware-image-isolation').reason, /depends on firmware-build-fleet \(blocked\)/);
  assert.ok(report.overall.required_not_passed.length >= 12);
  assert.ok(report.overall.required_not_passed.includes('web-build'));
  assert.match(run.stdout, /QA BLOCKED/);
});

test('check-local refuses OneDrive output, unknown stages and reused output directories', { skip }, (t) => {
  const dir = tempDir(t);
  const oneDrive = resolve(dir, 'OneDrive - Synthetic Fixture', 'qa');
  const refused = powershell(['-File', cli, '-ConfigFile', emptyConfig(dir), '-Stages', 'preservation-check', '-OutputDir', oneDrive]);
  assert.equal(refused.status, 1);
  assert.match(refused.stderr + refused.stdout, /outside OneDrive/);
  assert.equal(existsSync(oneDrive), false);

  const unknown = powershell(['-File', cli, '-ConfigFile', emptyConfig(dir), '-Stages', 'flash-device', '-OutputDir', resolve(dir, 'u')]);
  assert.equal(unknown.status, 1);
  assert.match(unknown.stderr + unknown.stdout, /Unknown stage/);

  const out = resolve(dir, 'partial');
  const partial = powershell(['-File', cli, '-ConfigFile', emptyConfig(dir), '-Stages', 'preservation-check', '-OutputDir', out]);
  assert.equal(partial.status, 0, partial.stdout + partial.stderr);
  assert.equal(results(out).overall.status, 'partial-passed');
  const reused = powershell(['-File', cli, '-ConfigFile', emptyConfig(dir), '-Stages', 'preservation-check', '-OutputDir', out]);
  assert.equal(reused.status, 1);
  assert.match(reused.stderr + reused.stdout, /already contains files/);
});

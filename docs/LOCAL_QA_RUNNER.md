# Local QA runner

`scripts/check-local.ps1` is the single local QA command. It runs every check
as a child process, writes one log per stage plus `results.json` and
`results.md`, and records tool versions, checkout state and artifact hashes.
It never flashes, deploys, contacts Supabase or starts an HTTP server.

```powershell
powershell -ExecutionPolicy Bypass -File scripts\check-local.ps1 -ConfigFile C:\path\outside\OneDrive\qa-config.json
```

Run it from a checkout outside OneDrive; it refuses a OneDrive checkout or
output directory and never reuses a non-empty output directory. The default
output is `..\qa-runs\<checkout>-<timestamp>` beside the checkout.

## Configuration

The engine explicitly loads the standard Utility module from the current
PowerShell host's `$PSHOME`. This avoids a demonstrated startup failure when
Windows PowerShell 5.1 inherits a bundled PowerShell 7 module search path and
cannot discover `Get-FileHash`. The import affects the current process only;
it does not change machine module paths or execution/security policy.

Tools are taken from parameters, then the JSON config (`-ConfigFile` or
`FREEZER_QA_CONFIG`), then `PATH`. Copy
[`scripts/qa-config.example.json`](../scripts/qa-config.example.json); keys are
`node`, `git`, `python` (with PlatformIO), `compilerBin` (native gcc for host
tests), `cadPython` (CadQuery/trimesh), `pgliteModule` and optional
`benchProject`. Keep the config, tools and outputs outside OneDrive. The
runner removes server-credential variables from every child process and gives
`next build` synthetic public configuration only. It blocks firmware builds
when a private `device_security.h` exists or `prototype22_wifi.h` is not the
`COMPILE_ONLY` fixture, and blocks the web build when local `.env*` files exist.

## Stages

| Stage | Check |
| --- | --- |
| `firmware-native-tests` | PlatformIO host tests; production queue, identity, clock and transport code against fixtures |
| `firmware-build-fleet`, `firmware-build-prototype` | Compile-only images |
| `firmware-image-isolation` | Prototype markers only in the prototype image |
| `firmware-bench-build` | Optional configured sensor-only bench build, compiled from a copy |
| `web-tests`, `web-typecheck`, `web-build` | Dashboard/API tests (the `npm test` script), `tsc --noEmit`, Next build |
| `automation-tests` | All `scripts/*.test.mjs`, including PostgreSQL, restore, pilot-report and runner tests |
| `restore-rehearsal-report` | Synthetic export/import rehearsal report in isolated PGlite |
| `cad-tests` | CAD solid/mesh regressions of the chosen geometry |
| `cad-export-verification` | Re-verifies dated STEP/STL exports on a copy and matches the recorded results |
| `release-manifest` | Existing manifest tool: commit, dirty state, source fingerprint, image hashes |
| `preservation-check` | Every file under `cad_enclosure/` is byte-identical before and after the run |

`-Stages a,b` runs a subset (reported as partial); `-FirmwareOnly` keeps the
previous firmware-only behavior; `-ListStages` prints the list.

## Status and exit codes

Each stage is exactly one of **passed**, **failed** (it ran and did not meet
its check: non-zero exit, timeout, failed or skipped tests, a missing test
summary, a missing artifact), **blocked** (a prerequisite tool, file or upstream
stage is missing) or **skipped** (not requested, or optional and unconfigured).
A required test stage that reports any skipped test fails as incomplete.

Windows Application Control (Smart App Control/WDAC, `WinError 4551`) has
refused to execute freshly built PlatformIO host-test binaries on this machine.
The runner retries the native-test stage once, logs both attempts, and reports
**blocked** (an environment policy, not a test result) if the refusal repeats.
Real test failures in the same output still make the stage **failed**. The
runner never changes security settings; the machine owner decides on policy.

| Exit | Meaning |
| --- | --- |
| 0 | Every requested required stage passed (`passed` for a full run, `partial-passed` for a subset) |
| 1 | A stage failed, or the run could not start (bad parameters, OneDrive path) |
| 2 | Nothing failed, but a required stage was blocked or not run |

A full run reports success only when every required stage passed.

## Limits

Passing local QA is local preparation only. It does not establish flashing,
deployment, live ingest, production schema or grants, browser behavior,
hardware queue durability, cold accuracy, CAD orientation (F02) or physical fit
(F01). Images are compile-only with synthetic configuration; never flash them.

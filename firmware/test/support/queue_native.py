"""Compile actual queue, transport and security routines against host fixtures.

Only platform boundaries are replaced by the native suites; production functions
are copied verbatim from main.cpp at build time. This avoids maintaining a second
version of the safety-critical queue, retry, timeout or credential validation logic.
"""
from pathlib import Path

Import("env")

source = (Path(env.subst("$PROJECT_DIR")) / "src/main.cpp").read_text(encoding="utf-8")
sections = [
    ("static bool recoverQueueTemp()", "// --- Posting"),
    ("static void scheduleQueueRetry()", "// Posts one already-serialized"),
    ("static void flushQueue()", "// --- Sampling"),
]
parts = []
for start, end in sections:
    begin = source.index(start)
    finish = source.index(end, begin)
    line = source[:begin].count("\n") + 1
    parts.append(f'#line {line} "src/main.cpp"\n' + source[begin:finish])

generated = Path(env.subst("$BUILD_DIR")) / "generated"
generated.mkdir(parents=True, exist_ok=True)
(generated / "queue_under_test.h").write_text("\n".join(parts), encoding="utf-8")
begin = source.index("static PostResult postJson(")
finish = source.index("// Pushes queued readings", begin)
line = source[:begin].count("\n") + 1
(generated / "post_under_test.h").write_text(
    f'#line {line} "src/main.cpp"\n' + source[begin:finish], encoding="utf-8")
begin = source.index("static bool otaPasswordHashIsUsable()")
finish = source.index("static String ingestSecret()", begin)
line = source[:begin].count("\n") + 1
(generated / "ota_security_under_test.h").write_text(
    f'#line {line} "src/main.cpp"\n' + source[begin:finish], encoding="utf-8")
# Clock gate, logical device ID, persistent boot counter and the sampling
# decision. Sensor, JSON, transport and queue boundaries are test fixtures.
identity_sections = [
    ("static bool clockIsValid()", "static String apName()"),
    ("static String deviceId()", "// With bootloader rollback"),
    ("static bool initObservationIdentity()", "static bool ingestSecretIsUsable("),
    ("static void sampleAndSend()", "// --- WiFi lifecycle"),
]
parts = []
for start, end in identity_sections:
    begin = source.index(start)
    finish = source.index(end, begin)
    line = source[:begin].count("\n") + 1
    parts.append(f'#line {line} "src/main.cpp"\n' + source[begin:finish])
(generated / "identity_under_test.h").write_text("\n".join(parts), encoding="utf-8")
env.Append(CPPPATH=[str(generated)])

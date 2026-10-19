import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import { POST } from "./route.ts";

const DEVICE_ID = "freezer-01";
const SECRET = "test-secret-that-is-long-enough-for-ingest-auth-1234";

const reading = {
  freezer_id: 1,
  device_id: DEVICE_ID,
  firmware_version: "0.3.0",
  observation_id: `${DEVICE_ID}-123-1`,
  payload_version: 1,
  sensor_tier: "esp32_pt1000_max31865",
  temp_c: -72.125,
  rssi: -48,
  recorded_at: "2026-09-29T12:00:00Z",
  clock_valid: true,
};

function configure() {
  process.env.INGEST_DEVICE_SECRETS_JSON = JSON.stringify({ [DEVICE_ID]: SECRET });
  process.env.SUPABASE_URL = "https://db.example.test/";
  delete process.env.SUPABASE_SECRET_KEY;
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-test-key";
}

function signedRequest(body: string, extraHeaders: Record<string, string> = {}) {
  const signature = createHmac("sha256", SECRET).update(body).digest("hex");
  return new Request("https://dashboard.example.test/api/ingest", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-device-id": DEVICE_ID,
      "x-device-signature": signature,
      ...extraHeaders,
    },
    body,
  });
}

test("ingest route enforces authentication and payload boundaries", async (t) => {
  const originalFetch = globalThis.fetch;
  const originalEnv = {
    INGEST_DEVICE_SECRETS_JSON: process.env.INGEST_DEVICE_SECRETS_JSON,
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_SECRET_KEY: process.env.SUPABASE_SECRET_KEY,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  };
  const upstreamCalls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];

  globalThis.fetch = async (input, init) => {
    upstreamCalls.push({ input, init });
    return Response.json([reading], { status: 201 });
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  await t.test("accepts a signed reading and normalizes clock validity", async () => {
    configure();
    upstreamCalls.length = 0;
    const body = JSON.stringify(reading);
    const response = await POST(signedRequest(body));

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      received: 1,
      accepted: 1,
      duplicates: 0,
      request_id: response.headers.get("x-request-id"),
    });
    assert.match(response.headers.get("x-request-id") ?? "", /^[0-9a-f-]{36}$/);
    assert.equal(upstreamCalls.length, 1);
    assert.equal(String(upstreamCalls[0].input), "https://db.example.test/rest/v1/readings?on_conflict=device_id,observation_id");
    assert.deepEqual(JSON.parse(String(upstreamCalls[0].init?.body)), [{ ...reading, reset_reason: null }]);
    assert.equal((upstreamCalls[0].init?.signal as AbortSignal).aborted, false);
    assert.match(String(new Headers(upstreamCalls[0].init?.headers).get("Prefer")), /return=representation/);
  });

  await t.test("accepts a legacy queued DS18B20 row without relabeling it", async () => {
    configure();
    upstreamCalls.length = 0;
    const legacy = {
      ...reading,
      sensor_tier: "esp32_ds18b20",
      observation_id: `${DEVICE_ID}-123-2`,
    };
    const response = await POST(signedRequest(JSON.stringify(legacy)));

    assert.equal(response.status, 200);
    assert.deepEqual(JSON.parse(String(upstreamCalls[0].init?.body)), [{ ...legacy, reset_reason: null }]);
  });

  await t.test("accepts the PT1000 operating range below the DS18B20 limit", async () => {
    configure();
    upstreamCalls.length = 0;
    const rtdReading = {
      ...reading,
      temp_c: -150,
      observation_id: `${DEVICE_ID}-123-3`,
    };
    const response = await POST(signedRequest(JSON.stringify(rtdReading)));

    assert.equal(response.status, 200);
    assert.deepEqual(JSON.parse(String(upstreamCalls[0].init?.body)), [{ ...rtdReading, reset_reason: null }]);
  });

  await t.test("rejects a bad signature before contacting Supabase", async () => {
    configure();
    upstreamCalls.length = 0;
    const response = await POST(signedRequest(JSON.stringify(reading), {
      "x-device-signature": "00".repeat(32),
    }));

    assert.equal(response.status, 401);
    assert.equal(upstreamCalls.length, 0);
  });

  await t.test("normalizes mixed optional fields before a PostgREST bulk insert", async () => {
    configure();
    upstreamCalls.length = 0;
    const response = await POST(signedRequest(JSON.stringify([
      { ...reading, reset_reason: "poweron" },
      { ...reading, observation_id: `${DEVICE_ID}-123-4` },
    ])));
    assert.equal(response.status, 200);
    const forwarded = JSON.parse(String(upstreamCalls[0].init?.body));
    assert.deepEqual(Object.keys(forwarded[0]).sort(), Object.keys(forwarded[1]).sort());
    assert.equal(forwarded[0].reset_reason, "poweron");
    assert.equal(forwarded[1].reset_reason, null);
  });

  await t.test("sends an opaque server key only in apikey", async () => {
    configure();
    process.env.SUPABASE_SECRET_KEY = "sb_secret_SYNTHETIC_FIXTURE_NOT_A_CREDENTIAL";
    upstreamCalls.length = 0;
    assert.equal((await POST(signedRequest(JSON.stringify(reading)))).status, 200);
    const headers = new Headers(upstreamCalls[0].init?.headers);
    assert.equal(headers.get("apikey"), "sb_secret_SYNTHETIC_FIXTURE_NOT_A_CREDENTIAL");
    assert.equal(headers.has("authorization"), false);
  });

  await t.test("targets the observation replay key in fleet and isolated prototype storage", async () => {
    configure();
    process.env.INGEST_DEVICE_SECRETS_JSON = JSON.stringify({ [DEVICE_ID]: SECRET, "prototype-22": SECRET });
    const { freezer_id: unused, ...prototypeFields } = reading;
    for (const [id, payload, table] of [
      [DEVICE_ID, reading, "readings"],
      ["prototype-22", { ...prototypeFields, prototype_id: 22, device_id: "prototype-22", observation_id: "prototype-22-123-1" }, "prototype_readings"],
    ] as const) {
      upstreamCalls.length = 0;
      assert.equal((await POST(signedRequest(JSON.stringify(payload), { "x-device-id": id }))).status, 200);
      const url = new URL(String(upstreamCalls[0].input));
      assert.equal(url.pathname, `/rest/v1/${table}`);
      assert.equal(url.searchParams.get("on_conflict"), "device_id,observation_id");
    }
  });

  await t.test("rejects local/date-only/normalized invalid dates before forwarding", async () => {
    configure();
    for (const recorded_at of ["2026-09-29", "2026-09-29T12:00:00", "2026-02-30T12:00:00Z"]) {
      upstreamCalls.length = 0;
      assert.equal((await POST(signedRequest(JSON.stringify({ ...reading, recorded_at })))).status, 400);
      assert.equal(upstreamCalls.length, 0);
    }
  });

  await t.test("accepts explicit offsets and fractional database timestamp seconds", async () => {
    configure();
    assert.equal((await POST(signedRequest(JSON.stringify({ ...reading,
      recorded_at: "2026-09-29T05:00:00.123456-07:00" })))).status, 200);
  });

  await t.test("rejects placeholder secrets", async () => {
    process.env.INGEST_DEVICE_SECRETS_JSON = JSON.stringify({
      [DEVICE_ID]: "replace-this-secret-before-deploying-1234567890",
    });
    const response = await POST(signedRequest(JSON.stringify(reading)));

    assert.equal(response.status, 401);
  });

  await t.test("rejects a declared body over the limit", async () => {
    configure();
    const response = await POST(signedRequest("{}", { "content-length": String(32 * 1024 + 1) }));

    assert.equal(response.status, 413);
  });

  await t.test("rejects malformed JSON and invalid firmware versions", async () => {
    configure();
    const malformed = "not-json";
    assert.equal((await POST(signedRequest(malformed))).status, 400);

    const invalid = JSON.stringify({ ...reading, firmware_version: "release/0.2.0" });
    assert.equal((await POST(signedRequest(invalid))).status, 400);
  });

  await t.test("rejects non-JSON bodies before reading or forwarding them", async () => {
    configure();
    upstreamCalls.length = 0;
    const response = await POST(signedRequest(JSON.stringify(reading), {
      "content-type": "text/plain",
    }));

    assert.equal(response.status, 415);
    assert.equal(upstreamCalls.length, 0);
  });

  await t.test("turns an upstream timeout into a bounded gateway response", async () => {
    configure();
    upstreamCalls.length = 0;
    const previousFetch = globalThis.fetch;
    globalThis.fetch = async () => {
      throw new DOMException("aborted", "AbortError");
    };
    try {
      const response = await POST(signedRequest(JSON.stringify(reading)));
      assert.equal(response.status, 504);
      assert.match(response.headers.get("x-request-id") ?? "", /^[0-9a-f-]{36}$/);
    } finally {
      globalThis.fetch = previousFetch;
    }
  });
});

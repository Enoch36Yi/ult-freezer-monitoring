import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { Buffer } from "node:buffer";

export const runtime = "nodejs";

const MAX_BODY_BYTES = 32 * 1024;
const MAX_BATCH_SIZE = 50;
const UPSTREAM_TIMEOUT_MS = 5_000;
const PAYLOAD_VERSION = 1;
const SENSOR_TIER = "esp32_ds18b20";

type Reading = {
  freezer_id?: number;
  prototype_id?: number;
  device_id?: string;
  firmware_version?: string;
  payload_version?: number;
  observation_id?: string;
  clock_valid?: boolean;
  sensor_tier?: string;
  temp_c?: number;
  rssi?: number;
  reset_reason?: string;
  recorded_at?: string;
};

function jsonError(status: number, requestId: string) {
  return Response.json(
    { error: "Telemetry request rejected", request_id: requestId },
    { status, headers: { "x-request-id": requestId, "cache-control": "no-store" } },
  );
}

function requestIdFor(request: Request) {
  const supplied = request.headers.get("x-request-id")?.trim();
  return supplied && /^[A-Za-z0-9._-]{1,100}$/.test(supplied)
    ? supplied
    : randomUUID();
}

function configuredSecrets(): Record<string, string> | null {
  const raw = process.env.INGEST_DEVICE_SECRETS_JSON;
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const entries = Object.entries(parsed as Record<string, unknown>);
    if (entries.some(([id, secret]) =>
      !/^(?:freezer-(?:0[1-9]|1[0-9]|2[01])|prototype-22)$/.test(id) ||
      typeof secret !== "string" || secret.length < 32 || secret.startsWith("replace-"),
    )) return null;
    return Object.fromEntries(entries) as Record<string, string>;
  } catch {
    return null;
  }
}

function signatureMatches(body: string, secret: string, supplied: string) {
  if (!/^[a-f0-9]{64}$/i.test(supplied)) return false;
  const expected = createHmac("sha256", secret).update(body).digest();
  const actual = Buffer.from(supplied, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

async function readBodyLimited(request: Request): Promise<string | null> {
  if (!request.body) return null;

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      totalBytes += value.byteLength;
      if (totalBytes > MAX_BODY_BYTES) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } catch {
    return null;
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)), totalBytes).toString("utf8");
}

function validReading(reading: Reading, deviceId: string) {
  const allowed = new Set([
    "freezer_id", "prototype_id", "sensor_tier", "temp_c", "rssi",
    "reset_reason", "recorded_at", "device_id", "firmware_version",
    "observation_id", "clock_valid", "payload_version",
  ]);
  if (Object.keys(reading).some((key) => !allowed.has(key))) return false;
  if (reading.sensor_tier !== SENSOR_TIER ||
      typeof reading.temp_c !== "number" || !Number.isFinite(reading.temp_c) ||
      reading.temp_c < -126 || reading.temp_c > 127) return false;
  if (reading.rssi !== undefined &&
      (!Number.isInteger(reading.rssi) || reading.rssi < -150 || reading.rssi > 0)) return false;
  if (reading.reset_reason !== undefined &&
      (typeof reading.reset_reason !== "string" || reading.reset_reason.length > 32)) return false;
  if (reading.firmware_version !== undefined &&
      (typeof reading.firmware_version !== "string" ||
       !/^[0-9A-Za-z._+-]{1,32}$/.test(reading.firmware_version))) return false;
  if (reading.payload_version !== undefined && reading.payload_version !== PAYLOAD_VERSION) return false;
  if (reading.recorded_at !== undefined &&
      (typeof reading.recorded_at !== "string" || Number.isNaN(Date.parse(reading.recorded_at)))) return false;
  if (reading.clock_valid !== undefined && reading.clock_valid !== true) return false;
  // A legacy queued row may omit clock_valid, but it must still carry the
  // device's actual measurement timestamp. Never let the server invent one.
  if (reading.recorded_at === undefined) return false;
  const escapedDeviceId = deviceId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (reading.device_id !== deviceId ||
      typeof reading.observation_id !== "string" ||
      reading.observation_id.length > 96 ||
      !new RegExp(`^${escapedDeviceId}-[0-9]+-[0-9]+$`).test(reading.observation_id)) {
    return false;
  }

  if (deviceId === "prototype-22") {
    return reading.prototype_id === 22 && reading.freezer_id === undefined;
  }
  const freezerId = Number(deviceId.slice("freezer-".length));
  return reading.freezer_id === freezerId && reading.prototype_id === undefined;
}

export async function POST(request: Request) {
  const requestId = requestIdFor(request);
  const deviceId = request.headers.get("x-device-id") ?? "";
  const signature = request.headers.get("x-device-signature") ?? "";
  const secrets = configuredSecrets();
  const secret = secrets?.[deviceId];
  if (!secret) return jsonError(401, requestId);

  const contentType = request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
  if (contentType !== "application/json") return jsonError(415, requestId);

  const length = request.headers.get("content-length");
  if (length && (!/^\d+$/.test(length) || Number(length) > MAX_BODY_BYTES)) {
    return jsonError(413, requestId);
  }
  const body = await readBodyLimited(request);
  if (!body) return jsonError(413, requestId);
  if (!signatureMatches(body, secret, signature)) return jsonError(401, requestId);

  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return jsonError(400, requestId);
  }
  const rows = Array.isArray(parsed) ? parsed : [parsed];
  if (rows.length === 0 || rows.length > MAX_BATCH_SIZE ||
      rows.some((row) => !row || typeof row !== "object" || Array.isArray(row) ||
        !validReading(row as Reading, deviceId))) {
    return jsonError(400, requestId);
  }

  const supabaseUrl = process.env.SUPABASE_URL?.replace(/\/$/, "");
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) return jsonError(503, requestId);

  const table = deviceId === "prototype-22" ? "prototype_readings" : "readings";
  const normalizedRows = rows.map((row) => ({
    ...(row as Reading),
    clock_valid: true,
    payload_version: (row as Reading).payload_version ?? PAYLOAD_VERSION,
  }));
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  let upstream: Response;
  let inserted: unknown = null;
  try {
    upstream = await fetch(`${supabaseUrl}/rest/v1/${table}`, {
      method: "POST",
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
        "Content-Type": "application/json",
        // Representation lets us distinguish inserts from rows ignored by
        // the replay-safe unique constraint.
        Prefer: "resolution=ignore-duplicates,return=representation",
      },
      body: JSON.stringify(normalizedRows),
      cache: "no-store",
      signal: controller.signal,
    });
    if (upstream.ok) {
      try {
        inserted = await upstream.json();
      } catch {
        inserted = null;
      }
    }
  } catch (error) {
    const reason = error instanceof Error ? error.name : "unknown";
    console.error(`[ingest] upstream request failed request_id=${requestId} device_id=${deviceId} reason=${reason}`);
    return jsonError(504, requestId);
  } finally {
    clearTimeout(timeout);
  }
  if (!upstream.ok) {
    console.error(`[ingest] Supabase returned HTTP ${upstream.status} request_id=${requestId} device_id=${deviceId}`);
    return jsonError(502, requestId);
  }
  if (!Array.isArray(inserted)) {
    console.error(`[ingest] Supabase returned a non-array body request_id=${requestId} device_id=${deviceId}`);
    return jsonError(502, requestId);
  }

  const insertedCount = inserted.length;
  return Response.json(
    {
      received: rows.length,
      accepted: insertedCount,
      duplicates: rows.length - insertedCount,
      request_id: requestId,
    },
    { headers: { "x-request-id": requestId, "cache-control": "no-store" } },
  );
}

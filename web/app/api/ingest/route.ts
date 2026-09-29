import { createHmac, timingSafeEqual } from "node:crypto";

export const runtime = "nodejs";

const MAX_BODY_BYTES = 32 * 1024;
const MAX_BATCH_SIZE = 50;
const SENSOR_TIER = "esp32_ds18b20";

type Reading = {
  freezer_id?: number;
  prototype_id?: number;
  sensor_tier?: string;
  temp_c?: number;
  rssi?: number;
  reset_reason?: string;
  recorded_at?: string;
};

function jsonError(status: number) {
  return Response.json({ error: "Telemetry request rejected" }, { status });
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
      typeof secret !== "string" || secret.length < 32,
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

function validReading(reading: Reading, deviceId: string) {
  const allowed = new Set([
    "freezer_id", "prototype_id", "sensor_tier", "temp_c", "rssi",
    "reset_reason", "recorded_at",
  ]);
  if (Object.keys(reading).some((key) => !allowed.has(key))) return false;
  if (reading.sensor_tier !== SENSOR_TIER ||
      typeof reading.temp_c !== "number" || !Number.isFinite(reading.temp_c) ||
      reading.temp_c < -126 || reading.temp_c > 127) return false;
  if (reading.rssi !== undefined &&
      (!Number.isInteger(reading.rssi) || reading.rssi < -150 || reading.rssi > 0)) return false;
  if (reading.reset_reason !== undefined &&
      (typeof reading.reset_reason !== "string" || reading.reset_reason.length > 32)) return false;
  if (reading.recorded_at !== undefined &&
      (typeof reading.recorded_at !== "string" || Number.isNaN(Date.parse(reading.recorded_at)))) return false;

  if (deviceId === "prototype-22") {
    return reading.prototype_id === 22 && reading.freezer_id === undefined;
  }
  const freezerId = Number(deviceId.slice("freezer-".length));
  return reading.freezer_id === freezerId && reading.prototype_id === undefined;
}

export async function POST(request: Request) {
  const deviceId = request.headers.get("x-device-id") ?? "";
  const signature = request.headers.get("x-device-signature") ?? "";
  const secrets = configuredSecrets();
  const secret = secrets?.[deviceId];
  if (!secret) return jsonError(401);

  const length = request.headers.get("content-length");
  if (length && (!/^\d+$/.test(length) || Number(length) > MAX_BODY_BYTES)) {
    return jsonError(413);
  }
  const body = await request.text();
  if (!body || new TextEncoder().encode(body).byteLength > MAX_BODY_BYTES) {
    return jsonError(413);
  }
  if (!signatureMatches(body, secret, signature)) return jsonError(401);

  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return jsonError(400);
  }
  const rows = Array.isArray(parsed) ? parsed : [parsed];
  if (rows.length === 0 || rows.length > MAX_BATCH_SIZE ||
      rows.some((row) => !row || typeof row !== "object" || Array.isArray(row) ||
        !validReading(row as Reading, deviceId))) {
    return jsonError(400);
  }

  const supabaseUrl = process.env.SUPABASE_URL?.replace(/\/$/, "");
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) return jsonError(503);

  const table = deviceId === "prototype-22" ? "prototype_readings" : "readings";
  const upstream = await fetch(`${supabaseUrl}/rest/v1/${table}`, {
    method: "POST",
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify(rows),
    cache: "no-store",
  });
  if (!upstream.ok) {
    console.error(`[ingest] Supabase returned HTTP ${upstream.status}`);
    return jsonError(502);
  }
  return Response.json({ accepted: rows.length });
}

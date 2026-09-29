import assert from "node:assert/strict";
import test from "node:test";
import { FREEZER_IDS } from "./types.ts";
import { storageForTarget } from "./target.ts";

test("Prototype 22 uses isolated storage and one-minute reporting", () => {
  assert.deepEqual(storageForTarget({ kind: "prototype", id: 22 }), {
    table: "prototype_readings",
    idColumn: "prototype_id",
    historyRpc: "prototype_readings_bucketed",
    label: "Prototype 22",
    intervalMs: 60_000,
  });
  assert.equal(FREEZER_IDS.length, 21);
  assert.equal(FREEZER_IDS.includes(22), false);
});

test("Freezer targets retain the study table and their own cadence", () => {
  assert.deepEqual(storageForTarget({ kind: "freezer", id: 1 }), {
    table: "readings",
    idColumn: "freezer_id",
    historyRpc: "readings_bucketed",
    label: "Freezer 1",
    intervalMs: 60_000,
  });
  assert.equal(storageForTarget({ kind: "freezer", id: 7 }).intervalMs, 900_000);
});

import assert from "node:assert/strict";
import test from "node:test";

import { postIntervalMs } from "./config.ts";

test("core freezer IDs 1 through 6 report every minute", () => {
  assert.equal(postIntervalMs(1), 60_000);
  assert.equal(postIntervalMs(6), 60_000);
});

test("fleet freezer IDs 7 through 21 report every fifteen minutes", () => {
  assert.equal(postIntervalMs(7), 900_000);
  assert.equal(postIntervalMs(21), 900_000);
});

test("an invalid freezer ID uses the conservative fleet interval", () => {
  assert.equal(postIntervalMs(0), 900_000);
  assert.equal(postIntervalMs(22), 900_000);
});

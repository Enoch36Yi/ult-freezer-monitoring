import assert from "node:assert/strict";
import test from "node:test";

import { nodeStatus, nodeStatusAtInterval } from "./format.ts";

const NOW = Date.parse("2026-09-22T12:00:00Z");

test("a four-minute-old core reading is stale", () => {
  assert.equal(nodeStatus("2026-09-22T11:56:00Z", NOW, 1), "stale");
});

test("a four-minute-old fleet reading is live", () => {
  assert.equal(nodeStatus("2026-09-22T11:56:00Z", NOW, 7), "live");
});

test("liveness thresholds scale with each freezer cadence", () => {
  assert.equal(nodeStatus("2026-09-22T11:39:00Z", NOW, 1), "offline");
  assert.equal(nodeStatus("2026-09-22T11:39:00Z", NOW, 7), "live");
});

test("a prototype uses its one-minute cadence without entering the freezer range", () => {
  assert.equal(nodeStatusAtInterval("2026-09-22T11:56:00Z", NOW, 60_000), "stale");
  assert.equal(nodeStatusAtInterval("2026-09-22T11:40:00Z", NOW, 60_000), "offline");
});

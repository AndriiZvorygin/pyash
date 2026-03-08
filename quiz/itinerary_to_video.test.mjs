import test from "node:test";
import assert from "node:assert/strict";

import { buildTimelineItems } from "../command/itinerary_to_video.mjs";

test("buildTimelineItems preserves leading silence in first cut duration", () => {
  const cuts = [
    { index: 1, since: 7.2, until: 20.0, obText: "first" },
    { index: 2, since: 20.0, until: 30.0, obText: "second" }
  ];
  const timeline = buildTimelineItems(cuts, 30.0);
  assert.equal(timeline.length, 2);
  assert.ok(Math.abs(timeline[0].duration - 20.0) < 1e-6, `first duration=${timeline[0].duration}`);
  assert.ok(Math.abs(timeline[1].duration - 10.0) < 1e-6, `second duration=${timeline[1].duration}`);
});

import test from "node:test";
import assert from "node:assert/strict";

import { buildTimelineItems } from "../command/itinerary_to_video.mjs";

test("buildTimelineItems evenly distributes unit-step text cuts across audio duration", () => {
  const cuts = [
    { index: 1, since: 0, until: 1, obText: "line 1" },
    { index: 2, since: 1, until: 2, obText: "line 2" },
    { index: 3, since: 2, until: 3, obText: "line 3" },
    { index: 4, since: 3, until: 4, obText: "line 4" }
  ];
  const timeline = buildTimelineItems(cuts, 20);
  assert.equal(timeline.length, 4);
  assert.equal(Number(timeline[0]?.duration?.toFixed(3)), 5);
  assert.equal(Number(timeline[1]?.duration?.toFixed(3)), 5);
  assert.equal(Number(timeline[2]?.duration?.toFixed(3)), 5);
  assert.equal(Number(timeline[3]?.duration?.toFixed(3)), 5);
});

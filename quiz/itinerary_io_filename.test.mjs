import test from "node:test";
import assert from "node:assert/strict";

import { parseItineraryPya, renderItineraryPya } from "../command/itinerary_io.mjs";

test("itinerary io supports filename rows", () => {
  const text = renderItineraryPya({
    itineraryName: "section clips",
    cuts: [
      {
        index: 1,
        name: "cut 001",
        since: 0,
        until: 1,
        obFilename: "artifacts/run/sections/paragraph-1/section-footnote.mp4"
      },
      {
        index: 2,
        name: "cut 002",
        since: 1,
        until: 2,
        obFilename: "artifacts/run/sections/paragraph-2/section-footnote.mp4"
      }
    ]
  });

  assert.match(text, /ob filename "artifacts\/run\/sections\/paragraph-1\/section-footnote\.mp4"/u);
  const parsed = parseItineraryPya(text);
  assert.equal(parsed.itineraryName, "section clips");
  assert.equal(parsed.cuts.length, 2);
  assert.equal(parsed.cuts[0]?.obFilename, "artifacts/run/sections/paragraph-1/section-footnote.mp4");
  assert.equal(parsed.cuts[1]?.obFilename, "artifacts/run/sections/paragraph-2/section-footnote.mp4");
});

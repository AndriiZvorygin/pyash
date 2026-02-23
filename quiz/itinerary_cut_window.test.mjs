import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

import { cutFromFilenameToNameItinerary } from "../program/verbs/itinerary_media.mjs";

test("cut groups rapid subtitle rows into target window cuts", async () => {
  const dir = path.resolve("quiz/sandpit");
  await fs.mkdir(dir, { recursive: true });
  const source = path.join(dir, "windowed-cuts.srt");
  await fs.writeFile(
    source,
    [
      "1",
      "00:00:00,000 --> 00:00:01,900",
      "first line",
      "",
      "2",
      "00:00:02,000 --> 00:00:03,900",
      "second line",
      "",
      "3",
      "00:00:04,000 --> 00:00:05,900",
      "third line",
      "",
      "4",
      "00:00:06,000 --> 00:00:07,900",
      "fourth line"
    ].join("\n"),
    "utf8"
  );

  const out = await cutFromFilenameToNameItinerary({
    mood: "do",
    be: "cut",
    from: { filename: source },
    during: { num: 6 },
    to: { name: "teaching cuts", nameTypeWords: ["itinerary"] }
  });

  const series = Array.isArray(out?.ob?.series) ? out.ob.series : [];
  assert.equal(series.length, 2);
  assert.equal(series[0]?.since?.num, 0);
  assert.equal(series[0]?.until?.num, 5.9);
  assert.match(String(series[0]?.ob?.text ?? ""), /first line/);
  assert.match(String(series[0]?.ob?.text ?? ""), /second line/);
  assert.match(String(series[0]?.ob?.text ?? ""), /third line/);
  assert.equal(series[1]?.since?.num, 6);
  assert.equal(series[1]?.until?.num, 7.9);
});

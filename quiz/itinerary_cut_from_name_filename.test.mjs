import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget, remember, doRemember } from "../program/remember/index.mjs";

test("cut accepts from name filename to name itinerary", async () => {
  forget();
  const dir = await fs.mkdtemp(path.join(process.cwd(), "artifacts", "cut-name-"));
  const srtPath = path.join(dir, "sample.srt");
  await fs.writeFile(
    srtPath,
    [
      "1",
      "00:00:00,000 --> 00:00:03,000",
      "Love God with your whole heart.",
      "",
      "2",
      "00:00:03,000 --> 00:00:06,000",
      "Pray, obey, and give thanks each day.",
      ""
    ].join("\n"),
    "utf8"
  );

  doRemember({ mood: "ya", su: { name: "hear stage" }, ob: { filename: srtPath }, be: "hear" });
  await interpret(parse("su name cut stage from name hear stage during num 6 to name itinerary teaching cuts be cut do"));

  const itinerary = remember("teaching cuts");
  assert.equal(itinerary?.be, "itinerary");
  assert.ok(Array.isArray(itinerary?.ob?.series));
  assert.ok(itinerary.ob.series.length >= 1);
});

test("cut splits long single srt segment into multiple windows", async () => {
  forget();
  const dir = await fs.mkdtemp(path.join(process.cwd(), "artifacts", "cut-window-"));
  const srtPath = path.join(dir, "long.srt");
  await fs.writeFile(
    srtPath,
    [
      "1",
      "00:00:00,000 --> 00:00:25,000",
      "Love is daily action.",
      ""
    ].join("\n"),
    "utf8"
  );

  doRemember({ mood: "ya", su: { name: "hear stage" }, ob: { filename: srtPath }, be: "hear" });
  await interpret(parse("su name cut stage from name hear stage during num 6 to name itinerary teaching cuts be cut do"));

  const itinerary = remember("teaching cuts");
  assert.equal(itinerary?.be, "itinerary");
  const series = Array.isArray(itinerary?.ob?.series) ? itinerary.ob.series : [];
  assert.equal(series.length, 5);
  assert.equal(series[0]?.since?.num, 0);
  assert.equal(series[0]?.until?.num, 6);
  assert.equal(series[4]?.since?.num, 24);
  assert.equal(series[4]?.until?.num, 25);
});

test("cut from text sentence mode keeps scripture refs within sentence", async () => {
  forget();
  const source = "God is love 1st John 4.8. The true light gives light to everyone John 1.9.";
  doRemember({ mood: "ya", su: { name: "script source" }, ob: { text: source }, be: "text" });

  await interpret(
    parse('su name cut stage from name script source as text "sentence" to name itinerary scripture cuts be cut do')
  );

  const itinerary = remember("scripture cuts");
  assert.equal(itinerary?.be, "itinerary");
  const series = Array.isArray(itinerary?.ob?.series) ? itinerary.ob.series : [];
  assert.equal(series.length, 2);
  assert.match(String(series[0]?.ob?.text ?? ""), /4\.8/u);
  assert.match(String(series[1]?.ob?.text ?? ""), /1\.9/u);
  assert.equal(/^\d+[.,]?$/.test(String(series[0]?.ob?.text ?? "").trim()), false);
});

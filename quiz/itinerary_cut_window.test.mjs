import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

import { cutFromFilenameToNameItinerary, cutFromTextToNameItinerary } from "../program/verbs/itinerary_media.mjs";

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

test("cut from text splits manuscript paragraphs into itinerary rows", async () => {
  const out = await cutFromTextToNameItinerary({
    mood: "do",
    be: "cut",
    from: {
      text: [
        "Solon canceled debt bondage and reset land power.",
        "",
        "He forced political accountability through law and participation.",
        "",
        "Today, ownership concentration still predicts instability."
      ].join("\n")
    },
    to: { name: "teaching sections", nameTypeWords: ["itinerary"] }
  });

  const series = Array.isArray(out?.ob?.series) ? out.ob.series : [];
  assert.equal(series.length, 3);
  assert.equal(series[0]?.since?.num, 0);
  assert.equal(series[2]?.until?.num, 3);
  assert.match(String(series[0]?.ob?.text ?? ""), /debt bondage/u);
  assert.match(String(series[1]?.ob?.text ?? ""), /political accountability/u);
  assert.match(String(series[2]?.ob?.text ?? ""), /ownership concentration/u);
});

test("cut from text as sentence splits manuscript into sentence itinerary rows", async () => {
  const out = await cutFromTextToNameItinerary({
    mood: "do",
    be: "cut",
    from: {
      text: "Solon canceled debt bondage. He widened ownership rights? Athens changed."
    },
    as: { text: "sentence" },
    to: { name: "teaching sentences", nameTypeWords: ["itinerary"] }
  });

  const series = Array.isArray(out?.ob?.series) ? out.ob.series : [];
  assert.equal(series.length, 3);
  assert.match(String(series[0]?.ob?.text ?? ""), /debt bondage/u);
  assert.match(String(series[1]?.ob?.text ?? ""), /ownership rights/u);
  assert.match(String(series[2]?.ob?.text ?? ""), /Athens changed/u);
});

test("cut from text as sentence keeps closing quote with sentence and avoids orphan quote cut", async () => {
  const out = await cutFromTextToNameItinerary({
    mood: "do",
    be: "cut",
    from: {
      text: "Instead of restoring land and dignity, they claimed “Canadians won’t enlist.”"
    },
    as: { text: "sentence" },
    to: { name: "quoted sentence", nameTypeWords: ["itinerary"] }
  });

  const series = Array.isArray(out?.ob?.series) ? out.ob.series : [];
  assert.equal(series.length, 1);
  assert.match(String(series[0]?.ob?.text ?? ""), /won.t enlist/u);
  assert.doesNotMatch(String(series[0]?.ob?.text ?? ""), /^["'“”’]+$/u);
});

test("cut from text as sentence fails fast for unspeakable sentence content", async () => {
  await assert.rejects(
    async () => cutFromTextToNameItinerary({
      mood: "do",
      be: "cut",
      from: { text: "”" },
      as: { text: "sentence" },
      to: { name: "bad sentences", nameTypeWords: ["itinerary"] }
    }),
    /cut defective: sentence source has no speakable content/u
  );
});

test("cut from text as sentence keeps initialism periods and avoids micro sentence fragments", async () => {
  const out = await cutFromTextToNameItinerary({
    mood: "do",
    be: "cut",
    from: {
      text: "In 46 A.D. the last emperor was deposed."
    },
    as: { text: "sentence" },
    to: { name: "initialism sentence", nameTypeWords: ["itinerary"] }
  });
  const series = Array.isArray(out?.ob?.series) ? out.ob.series : [];
  assert.equal(series.length, 1);
  assert.match(String(series[0]?.ob?.text ?? ""), /In 46 A\.D\./u);
  assert.doesNotMatch(String(series[0]?.ob?.text ?? ""), /^D\.$/u);
});

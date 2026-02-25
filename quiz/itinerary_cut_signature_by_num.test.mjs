import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

import { interpret } from "../program/bridge/index.mjs";
import { forget, remember } from "../program/remember/index.mjs";
import { setExchangeRunId } from "../program/bridge/exchange.mjs";

test("cut accepts by num with from filename itinerary signature", async () => {
  forget();
  setExchangeRunId("quiz-cut-signature-by-num");
  const dir = path.resolve("quiz/sandpit");
  await fs.mkdir(dir, { recursive: true });
  const source = path.join(dir, "cut-by-num.srt");
  await fs.writeFile(
    source,
    [
      "1",
      "00:00:00,000 --> 00:00:01,900",
      "first line",
      "",
      "2",
      "00:00:02,000 --> 00:00:03,900",
      "second line"
    ].join("\n"),
    "utf8"
  );

  await interpret({
    mood: "do",
    su: { name: "section cut stage" },
    be: "cut",
    by: { num: 2 },
    from: { filename: source },
    during: { num: 6 },
    to: { name: "section cuts", nameTypeWords: ["itinerary"] }
  });

  const fact = remember("section cuts");
  const series = Array.isArray(fact?.ob?.series) ? fact.ob.series : [];
  assert.equal(fact?.be, "itinerary");
  assert.equal(series.length, 1);
  assert.match(String(series[0]?.ob?.text ?? ""), /first line/u);
  assert.match(String(series[0]?.ob?.text ?? ""), /second line/u);

  setExchangeRunId(null);
});

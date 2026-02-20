import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs/promises";

import { drawFromNameItinerary } from "../program/verbs/itinerary_media.mjs";
import { forget, doRemember } from "../program/remember/index.mjs";
import { setExchangeRecorder, clearExchangeRecorder } from "../program/bridge/exchange.mjs";

test("draw from name itinerary emits draw request/result exchange lines", async () => {
  forget();
  await fs.mkdir("quiz/sandpit", { recursive: true });
  doRemember({
    mood: "ya",
    su: { name: "teaching cuts" },
    be: "itinerary",
    ob: {
      series: [
        {
          mood: "ya",
          su: { name: "cut 001" },
          since: { num: 0.1 },
          until: { num: 2.9 },
          ob: { text: "first cut idea" },
          be: "cut"
        }
      ]
    }
  });
  doRemember({ mood: "ya", su: { name: "draw workflow default" }, ob: { text: "Z-Image-TSV" }, be: "default" });
  doRemember({ mood: "ya", su: { name: "draw host" }, ob: { text: "http://localhost:8188" }, be: "default" });

  const exchange = [];
  setExchangeRecorder({ record: (s) => exchange.push(s), runRoot: process.cwd() });
  const prevFixture = process.env.PYA_DRAW_FIXTURE_FILE;
  process.env.PYA_DRAW_FIXTURE_FILE = path.resolve("quiz/fixtures/pyash_raven.png");
  try {
    await drawFromNameItinerary({
      mood: "do",
      be: "draw",
      from: { name: "teaching cuts" },
      fromstate: { wo: "text" },
      become: { wo: "photograph" },
      ob: { text: "Custom prompter: depict scripture and prayer." },
      to: { filename: "quiz/sandpit/itinerary-draw-out" },
      as: { text: "teaching" }
    });
  } finally {
    if (prevFixture === undefined) delete process.env.PYA_DRAW_FIXTURE_FILE;
    else process.env.PYA_DRAW_FIXTURE_FILE = prevFixture;
    clearExchangeRecorder();
  }

  assert.ok(exchange.some((s) => s?.be === "draw" && String(s?.su?.name || "").startsWith("draw request ")));
  assert.ok(exchange.some((s) => s?.be === "draw" && String(s?.su?.name || "").startsWith("draw result ")));
  assert.ok(exchange.some((s) => s?.be === "artifact" && s?.from?.name === "draw"));
  const request = exchange.find((s) => s?.be === "draw" && String(s?.su?.name || "").startsWith("draw request "));
  assert.match(String(request?.ob?.text ?? ""), /Custom prompter: depict scripture and prayer\./);
  assert.match(String(request?.ob?.text ?? ""), /first cut idea/);
});

test("draw from name itinerary without output writes under artifacts draw run folder", async () => {
  forget();
  doRemember({
    mood: "ya",
    su: { name: "teaching cuts" },
    be: "itinerary",
    ob: {
      series: [
        {
          mood: "ya",
          su: { name: "cut 001" },
          since: { num: 0.1 },
          until: { num: 2.9 },
          ob: { text: "first cut idea" },
          be: "cut"
        }
      ]
    }
  });
  doRemember({ mood: "ya", su: { name: "draw workflow default" }, ob: { text: "Z-Image-TSV" }, be: "default" });
  doRemember({ mood: "ya", su: { name: "draw host" }, ob: { text: "http://localhost:8188" }, be: "default" });

  const exchange = [];
  setExchangeRecorder({ record: (s) => exchange.push(s), runRoot: process.cwd() });
  const prevFixture = process.env.PYA_DRAW_FIXTURE_FILE;
  process.env.PYA_DRAW_FIXTURE_FILE = path.resolve("quiz/fixtures/pyash_raven.png");
  try {
    const out = await drawFromNameItinerary({
      mood: "do",
      be: "draw",
      from: { name: "teaching cuts" },
      fromstate: { wo: "text" },
      become: { wo: "photograph" },
      ob: { text: "Generate one illustration per cut." }
    });
    const folder = String(out?.ob?.filename ?? "");
    assert.match(folder, /artifacts[\/\\]draw[\/\\]\d{14}-[0-9a-f]{6}$/);
  } finally {
    if (prevFixture === undefined) delete process.env.PYA_DRAW_FIXTURE_FILE;
    else process.env.PYA_DRAW_FIXTURE_FILE = prevFixture;
    clearExchangeRecorder();
  }

  assert.ok(exchange.some((s) => s?.be === "draw" && s?.su?.name === "draw output directory"));
});

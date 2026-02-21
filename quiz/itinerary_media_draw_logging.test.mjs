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
  doRemember({
    mood: "ya",
    su: { name: "draw size shorts" },
    be: "map",
    ob: {
      map: {
        width: { ob: { num: 720 } },
        height: { ob: { num: 1280 } },
        "negative prompt": { ob: { text: "no text, no subtitles" } }
      }
    }
  });

  const exchange = [];
  setExchangeRecorder({ record: (s) => exchange.push(s), runRoot: process.cwd() });
  const prevFixture = process.env.PYA_DRAW_FIXTURE_FILE;
  process.env.PYA_DRAW_FIXTURE_FILE = path.resolve("quiz/fixtures/pyash_raven.png");
  try {
    await drawFromNameItinerary({
      mood: "do",
      su: { name: "draw platform" },
      be: "draw",
      from: { name: "teaching cuts" },
      fromstate: { wo: "text" },
      fromtext: { text: "System style: devotional realism." },
      become: { wo: "photograph" },
      ob: { text: "Custom prompter: depict scripture and prayer." },
      to: { filename: "quiz/sandpit/itinerary-draw-out" },
      with: { name: "draw size shorts" }
    });
  } finally {
    if (prevFixture === undefined) delete process.env.PYA_DRAW_FIXTURE_FILE;
    else process.env.PYA_DRAW_FIXTURE_FILE = prevFixture;
    clearExchangeRecorder();
  }

  assert.ok(exchange.some((s) => s?.be === "draw" && String(s?.su?.name || "").startsWith("draw request ")));
  assert.ok(exchange.some((s) => s?.be === "draw" && String(s?.su?.name || "").startsWith("draw result ")));
  assert.ok(exchange.some((s) => s?.be === "artifact" && String(s?.from?.name || "").startsWith("draw")));
  const drawResult = exchange.find((s) => s?.be === "draw" && String(s?.su?.name || "").startsWith("draw result "));
  assert.match(String(drawResult?.ob?.filename ?? ""), /draw-platform-cut-001\.png$/u);
  const request = exchange.find((s) => s?.be === "draw" && String(s?.su?.name || "").startsWith("draw request "));
  assert.match(String(request?.ob?.text ?? ""), /System style: devotional realism\./);
  assert.match(String(request?.ob?.text ?? ""), /Custom prompter: depict scripture and prayer\./);
  assert.match(String(request?.ob?.text ?? ""), /first cut idea/);
  assert.match(String(request?.fromtext?.text ?? ""), /negative prompt: no text, no subtitles/u);
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

test("draw to name photographs returns typed series and emits manifest artifact", async () => {
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
          since: { num: 0.0 },
          until: { num: 2.0 },
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
      su: { name: "draw platform" },
      be: "draw",
      from: { name: "teaching cuts" },
      fromstate: { wo: "text" },
      become: { wo: "photograph" },
      ob: { text: "Generate one illustration per cut." },
      to: { name: "photos", nameTypeWords: ["photographs"] }
    });
    assert.equal(out?.be, "photographs");
    assert.ok(Array.isArray(out?.ob?.series));
    assert.equal(out?.ob?.series?.length, 1);
    assert.match(String(out?.ob?.series?.[0]?.ob?.filename ?? ""), /\.png$/u);
  } finally {
    if (prevFixture === undefined) delete process.env.PYA_DRAW_FIXTURE_FILE;
    else process.env.PYA_DRAW_FIXTURE_FILE = prevFixture;
    clearExchangeRecorder();
  }

  assert.ok(exchange.some((s) => s?.be === "artifact" && s?.su?.name === "draw photographs manifest"));
});

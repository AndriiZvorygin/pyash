import test from "node:test";
import assert from "node:assert/strict";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget, doRemember } from "../program/remember/index.mjs";
import { setExchangeRecorder, clearExchangeRecorder } from "../program/bridge/exchange.mjs";
import { jsonObjectFromMapName } from "../program/verbs/exchange/json_map_export.mjs";

function buildMapIndex(records) {
  const index = new Map();
  for (let i = 0; i < records.length; i += 1) {
    const sentence = records[i];
    if (sentence?.mood !== "def" || sentence?.be !== "json map" || !sentence?.su?.name) continue;
    const name = sentence.su.name;
    const map = {};
    i += 1;
    for (; i < records.length; i += 1) {
      const entry = records[i];
      if (entry?.mood === "prah" && entry?.su?.name === name) break;
      if (entry?.mood === "ya" && entry?.su?.name) {
        map[entry.su.name] = entry.ob ?? {};
      }
    }
    index.set(name, { mood: "ya", su: { name }, be: "json map", ob: { map } });
  }
  return index;
}

function decodeMindPayload(records, name, label = "request") {
  const index = buildMapIndex(records);
  const mapName = [...index.keys()].reverse().find(key => key.startsWith(`${name} ${label} `));
  if (!mapName) return {};
  const remember = (map) => index.get(map);
  return jsonObjectFromMapName(mapName, { remember, seen: new Set(), sourceName: "mind tuning test", allowHollowVector: true });
}

test("mind auto-loads model tuning file and strips think block for qwq-32b", async () => {
  forget();
  doRemember({ mood: "ya", su: { name: "mind model" }, ob: { text: "qwq-32b" }, be: "default" });
  doRemember({ mood: "ya", su: { name: "provider auto discharge" }, ob: { boolean: false }, be: "default" });
  doRemember({
    mood: "ya",
    su: { name: "mind response" },
    ob: { text: "<think>step by step</think>\nFinal answer." },
    be: "default"
  });
  const out = await interpret(parse('su name answer ob text "2+2?" for name mind to name text out be write do'));
  const text = String(out?.ob?.text ?? out?.value?.text ?? out?.result?.text ?? "");
  assert.equal(text, "Final answer.");
});

test("mind auto-loads glm tuning and sets think false on request payload", async () => {
  forget();
  doRemember({ mood: "ya", su: { name: "mind model" }, ob: { text: "glm-4.7-flash:latest" }, be: "default" });
  doRemember({ mood: "ya", su: { name: "provider auto discharge" }, ob: { boolean: false }, be: "default" });
  doRemember({ mood: "ya", su: { name: "mind response" }, ob: { text: "ok" }, be: "default" });
  const records = [];
  setExchangeRecorder({ record: (sentence) => records.push(sentence) });
  try {
    await interpret(parse('su name answer ob text "hello" for name mind to name text out be write do'));
    const payload = decodeMindPayload(records, "mind");
    assert.equal(payload.model, "glm-4.7-flash:latest");
    assert.equal(payload.think, false);
  } finally {
    clearExchangeRecorder();
  }
});

test("mind configure map think overrides model tuning think", async () => {
  forget();
  doRemember({ mood: "ya", su: { name: "mind model" }, ob: { text: "glm-4.7-flash:latest" }, be: "default" });
  doRemember({ mood: "ya", su: { name: "provider auto discharge" }, ob: { boolean: false }, be: "default" });
  doRemember({ mood: "ya", su: { name: "mind response" }, ob: { text: "ok" }, be: "default" });
  doRemember({
    mood: "ya",
    su: { name: "mind configure" },
    be: "map",
    ob: {
      map: {
        think: { mood: "ya", su: { name: "think" }, ob: { boolean: true } }
      }
    }
  });
  const records = [];
  setExchangeRecorder({ record: (sentence) => records.push(sentence) });
  try {
    await interpret(parse('su name answer ob text "hello" for name mind to name text out be write do'));
    const payload = decodeMindPayload(records, "mind");
    assert.equal(payload.model, "glm-4.7-flash:latest");
    assert.equal(payload.think, true);
  } finally {
    clearExchangeRecorder();
  }
});

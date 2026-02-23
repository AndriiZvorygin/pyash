import test from "node:test";
import assert from "node:assert/strict";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget } from "../program/remember/index.mjs";
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

function decodeMindRequest(records, { mindName, requestNum }) {
  const mapIndex = buildMapIndex(records);
  const mapName = `${mindName} request ${requestNum}`;
  if (!mapIndex.has(mapName)) return null;
  const remember = (name) => mapIndex.get(name);
  return jsonObjectFromMapName(mapName, {
    remember,
    seen: new Set(),
    sourceName: "brief video compare prompt test",
    allowHollowVector: true
  });
}

async function run(line) {
  return interpret(parse(line));
}

test("brief video manuscript improve uses transcript text instead of object coercion", async () => {
  const original = process.env.PYA_MIND_RESPONSE;
  process.env.PYA_MIND_RESPONSE = "A";
  const records = [];
  setExchangeRecorder({ record: (sentence) => records.push(sentence) });
  try {
    forget();
    await run('from filename "./module/brief_video.pya" to name brief video be import do');
    try {
      await run('su name run from text "Solon restored land rights for citizens." to name text manuscript out be brief video manuscript improve do');
    } catch {
      // This test only validates prompt composition for the first mind request.
      // Downstream manuscript guarantees may fail with deterministic short fixtures.
    }

    const payload = decodeMindRequest(records, {
      mindName: "brief manuscript internal brief video script mind",
      requestNum: 1
    });
    assert.ok(payload?.prompt, "expected first brief-manuscript mind request payload");
    assert.match(payload.prompt, /Solon restored land rights for citizens\./);
    assert.doesNotMatch(payload.prompt, /\[object Object\]/);
  } finally {
    clearExchangeRecorder();
    if (original === undefined) delete process.env.PYA_MIND_RESPONSE;
    else process.env.PYA_MIND_RESPONSE = original;
  }
});

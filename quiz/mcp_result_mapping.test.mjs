import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget, doRemember, remember } from "../program/remember/index.mjs";
import { mapSentenceToPyash } from "../program/verbs/exchange/json_map.mjs";
import { closeMcpServers } from "../program/motor/mcp.mjs";

test("mcp object result maps to json map with stable ordering", async () => {
  forget();
  const serverPath = path.resolve("quiz/fixtures/mcp_mock_server.json");
  doRemember({
    mood: "ya",
    su: { name: "mock" },
    be: "mcp",
    ob: { text: "inline" },
    by: { ve: { type: "text", values: [serverPath] } }
  });

  await interpret(parse("from name mcp mock to name mcp mock be import do"));
  await interpret(parse("be mcp mock return_object do"));

  const result = remember("result");
  assert.equal(result?.be, "json map");
  const mapFact = remember(result?.ob?.name);
  assert.ok(mapFact, "json map should be stored for result");
  const pyash = mapSentenceToPyash(mapFact);
  const lines = pyash.split(/\r?\n/);
  const aIndex = lines.findIndex(line => line.startsWith("su name a "));
  const bIndex = lines.findIndex(line => line.startsWith("su name b "));
  assert.ok(aIndex !== -1 && bIndex !== -1, "map should contain a and b keys");
  assert.ok(aIndex < bIndex, "keys should be ordered a then b");
  closeMcpServers();
});

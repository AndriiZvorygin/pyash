import test from "node:test";
import assert from "node:assert/strict";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget } from "../program/remember/index.mjs";
import { buildToolSchemas } from "../program/verbs/mind/tooling.mjs";
import { deriveSignatureFromCall, joinSignatureWords } from "../program/bridge/signature.mjs";

test("saddle tools map exposes coding signatures", async () => {
  forget();
  await interpret(parse('from filename "./module/saddle_tools.pya" ob name saddle tools to name saddle tools be import do'));

  const { toolMap } = buildToolSchemas("saddle tools");
  const capabilityLines = [
    "su name command be command ob text input to name text out can",
    "su name repair be repair ob text input to name map outcome can",
    "su name repair check be repair as wo check ob text input to name map outcome can"
  ];

  for (const line of capabilityLines) {
    const signature = joinSignatureWords(deriveSignatureFromCall(parse(line)));
    assert.ok(toolMap.has(signature), `missing signature: ${signature}`);
  }
});

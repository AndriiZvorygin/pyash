import test from "node:test";
import assert from "node:assert/strict";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget } from "../program/remember/index.mjs";
import { buildToolSchemas } from "../program/verbs/mind/tooling.mjs";
import { deriveSignatureFromCall, joinSignatureWords } from "../program/bridge/signature.mjs";

async function defineToolMap(sentences) {
  for (const line of sentences) {
    await interpret(parse(line));
  }
}

test("agent tools map exposes standard tool signatures", async () => {
  forget();
  const toolSentences = [
    "su name agent tools be map def",
    "su name agent ob bool truth ya",
    "su name read be read from filename input become wo text to name text out can",
    "su name read markdown be read from filename input fromstate wo html become wo markdown to name text out can",
    "su name write be write ob text input to filename input can",
    "su name list files be list from filename input can",
    "su name search be search ob text input fromstate wo web by num 3 can",
    "su name download be download from filename input as wo web to filename input can",
    "su name command be command ob text input to name text out can",
    "su name exists be exists ob filename input can",
    "prah"
  ];
  await defineToolMap(toolSentences);

  const { toolMap } = buildToolSchemas("agent tools");
  const sentences = toolSentences
    .filter((line) => line.includes(" be ") && line.includes(" can"))
    .map((line) => parse(line));

  for (const sentence of sentences) {
    const sigWords = deriveSignatureFromCall(sentence);
    const sigKey = joinSignatureWords(sigWords);
    assert.ok(toolMap.has(sigKey), `missing signature: ${sigKey}`);
  }
});

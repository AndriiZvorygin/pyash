import test from "node:test";
import assert from "node:assert/strict";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget } from "../program/remember/index.mjs";

async function run(line) {
  const sentence = parse(line);
  return interpret(sentence);
}

test("espeak say streams with punctuation buffering", async () => {
  forget();
  process.env.PYA_ESPEAK_BIN = "true";
  process.env.PYA_SAY_SILENT = "1";
  try {
    await run("exists su name words ob ve text Hello world. Next sentence! be stream ya");
    const result = await run("su name speak from name words be espeak say vyah stream do");
    assert.equal(result?.value?.text, "Hello world. Next sentence!");
  } finally {
    delete process.env.PYA_ESPEAK_BIN;
    delete process.env.PYA_SAY_SILENT;
  }
});

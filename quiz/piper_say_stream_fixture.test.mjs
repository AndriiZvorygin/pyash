import test from "node:test";
import assert from "node:assert/strict";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget } from "../program/remember/index.mjs";

async function run(line) {
  const sentence = parse(line);
  return interpret(sentence);
}

test("piper say streams with punctuation buffering", async () => {
  forget();
  process.env.PYA_PIPER_FIXTURE = "fixture";
  try {
    await run("exists su name words ob ve text Hello world. Next sentence! be stream ya");
    const result = await run("su name speak from name words be piper say vyah stream do");
    assert.equal(result?.value?.text, "Hello world. Next sentence!");
  } finally {
    delete process.env.PYA_PIPER_FIXTURE;
  }
});

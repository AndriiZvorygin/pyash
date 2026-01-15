import test from "node:test";
import assert from "node:assert/strict";

import { interpret } from "../program/bridge/index.mjs";
import { parse } from "../program/understand/index.mjs";
import { forget, remember } from "../program/remember/index.mjs";

async function run(lines) {
  for (const line of lines) {
    const sentence = parse(line);
    if (sentence) await interpret(sentence);
  }
}

test("wo literal values participate in ceremony signatures", async () => {
  forget();

  await run([
    "su name listen from wo microphone to name text output be ceremony def",
    "exists su name out ob text \"ok\" be text ya",
    "su name out ret",
    "su name listen be ceremony prah"
  ]);

  await interpret(parse("su name result from wo microphone to name text result be listen do"));
  assert.equal(remember("result")?.ob?.text, "ok");

  let err;
  try {
    await interpret(parse("su name result from name microphone to name text result be listen do"));
  } catch (e) {
    err = e;
  }
  assert.ok(err, "expected signature error for non-wo literal");
  assert.match(err?.sentence?.ob?.text ?? "", /signature inconsistency/i);
});

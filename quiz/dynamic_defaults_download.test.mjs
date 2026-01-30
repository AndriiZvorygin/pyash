import test from "node:test";
import assert from "node:assert/strict";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget } from "../program/remember/index.mjs";

async function run(line) {
  const sentence = parse(line);
  return interpret(sentence);
}

test("download adapter attaches with name for video/audio", async () => {
  forget();

  await run("exists su name download extra ob ve text \"--cookies-from-browser\" \"firefox\" ya");
  await run("exists su name download extra default ob la be download as wo video ko with name download extra be default ya");

  let error;
  try {
    await run("from filename \"ftp://example.com/a\" as wo video be download do");
  } catch (err) {
    error = err;
  }

  assert.ok(error?.sentence, "expected download error");
  const raw = error.sentence?.ob?.raw?.sentence;
  assert.equal(raw?.with?.name, "download extra");
});

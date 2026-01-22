import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget } from "../program/remember/index.mjs";

async function run(line) {
  const sentence = parse(line);
  return interpret(sentence);
}

test("here returns current working directory", async () => {
  forget();
  const res = await run("be here do");
  assert.equal(res?.value?.filename, path.resolve(process.cwd()));
});

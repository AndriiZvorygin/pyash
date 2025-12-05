import test from "node:test";
import assert from "node:assert/strict";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget } from "../program/remember/index.mjs";

async function run(line) {
  const s = parse(line);
  return interpret(s);
}

test("mismatched signature for verb with handlers throws instead of falling back", async () => {
  forget();

  await assert.rejects(
    () => run('obj text "hello" by num 2 be multiply do'),
    /No handler for signature: be multiply by num obj text/
  );
});

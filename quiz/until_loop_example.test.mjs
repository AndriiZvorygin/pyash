import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget, remember } from "../program/remember/index.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function runFile(relativePath) {
  const text = await fs.promises.readFile(path.join(repoRoot, relativePath), "utf8");
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    await interpret(parse(trimmed));
  }
}

// Exit codes are not enough: an example can run cleanly and still produce the
// wrong value. These quizzes assert on the resulting facts.

test("until-loop example climbs fromindex to toindex and lands on the documented counter", async () => {
  forget();

  await runFile("examples/pyash/until-loop.pya");

  assert.equal(remember("counter")?.ob?.num, 2, "counter should be incremented twice");
  assert.equal(remember("result")?.ob?.num, 2, "result should carry the final count");
});

test("until-loop example stops with matching registers on the evoker", async () => {
  forget();

  await runFile("examples/pyash/until-loop.pya");

  assert.equal(remember("fromindex"), undefined, "registers must not leak into separate facts");
  assert.equal(remember("toindex"), undefined, "registers must not leak into separate facts");
});

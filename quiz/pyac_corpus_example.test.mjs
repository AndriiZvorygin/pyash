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

// The corpus example exercises the arithmetic verbs. It used to call four
// signatures that did not exist and to assign to names that were never
// created, so the quiz asserts on the resulting values rather than on the
// exit status.

test("pyac-corpus example computes the arithmetic results", async () => {
  forget();

  await runFile("examples/pyash/pyac-corpus.pya");

  assert.equal(remember("result")?.ob?.num, 1, "remains should finish the corpus");
});

test("pyac-corpus example accumulates text into the collector", async () => {
  forget();

  await runFile("examples/pyash/pyac-corpus.pya");

  assert.equal(remember("collector")?.ob?.text, "Aopaque");
});

test("pyac-corpus example creates the named records it uses", async () => {
  forget();

  await runFile("examples/pyash/pyac-corpus.pya");

  assert.deepEqual(remember("values")?.ob?.ve?.values, [1, 2, 3]);
  assert.equal(remember("start")?.ob?.date, "2025-05-01");
});

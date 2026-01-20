import test from "node:test";
import assert from "node:assert/strict";
import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget, remember } from "../program/remember/index.mjs";

async function run(line) {
  const sentence = parse(line);
  return interpret(sentence);
}

test("mind module exposes discharge", async () => {
  forget();
  await run('from filename "./module/mind_ollama.pya" ob name mind to name ollama command mind be import do');
  await run("to name text out be mind ollama discharge do");
  const out = remember("out");
  assert.equal(out?.ob?.text, "ollama mind discharged");
});

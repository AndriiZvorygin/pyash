import test from "node:test";
import assert from "node:assert/strict";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget, remember } from "../program/remember/index.mjs";
import { deriveSignatureFromCall, joinSignatureWords } from "../program/bridge/signature.mjs";

async function run(line) {
  return interpret(parse(line));
}

test("ceremony keeps target be when returning a map-shaped result", async () => {
  forget();

  await run("su name wrap to name map output be ceremony def");
  await run("su name output be json map def");
  await run('su name candidate ob text "alpha" ya');
  await run('su name score ob num 0.84 ya');
  await run("prah");
  await run("su name output ret");
  await run("prah");

  await run("su name demo to name map out be wrap do");

  const out = remember("out");
  assert.equal(out?.be, "map");
  assert.equal(out?.ob?.map?.candidate?.ob?.text ?? out?.ob?.map?.candidate?.text, "alpha");
  assert.equal(out?.ob?.map?.score?.ob?.num ?? out?.ob?.map?.score?.num, 0.84);

  const signature = joinSignatureWords(
    deriveSignatureFromCall(parse('ob name out to state json to filename "out.json" be write do'), { remember })
  );
  assert.equal(signature, "be write become name json ob name map to filename");
});

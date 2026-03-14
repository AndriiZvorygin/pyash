import test from "node:test";
import assert from "node:assert/strict";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget, remember } from "../program/remember/index.mjs";

async function run(line) {
  return interpret(parse(line));
}

test("ceremony body keeps for and among bindings distinct across successive calls", async () => {
  await forget();

  await run('su name alpha ob text request to name text output be ceremony def');
  await run('  ob text quoted.text.alpha line one\nalpha line two\nalpha line three\nalpha line four.text.quoted to name text output be text do');
  await run('  su name output ret');
  await run('prah');

  await run('su name beta ob text request to name text output be ceremony def');
  await run('  ob text quoted.text.beta line one\nbeta line two\nbeta line three\nbeta line four.text.quoted to name text output be text do');
  await run('  su name output ret');
  await run('prah');

  await run('su name pass verifier ob text packet to name text verdict be ceremony def');
  await run('  ob text PASS to name text verdict be text do');
  await run('prah');

  await run('su name checks be series def');
  await run('  su name line_count_min ob num 4 ya');
  await run('  su name line_count_max ob num 4 ya');
  await run('prah');

  await run('su name helper ob text request for name platform accordingto name checks series to name text output be ceremony def');
  await run('  su name inner ob text of ob of this for name of for of this among name pass verifier accordingto name of accordingto of this fromindex num 1 toindex num 1 to name text output be verify platform do');
  await run('  su name output ret');
  await run('prah');

  await run('su name first ob text "x" for name alpha accordingto name checks to name text out one be helper do');
  assert.match(String(remember("out one")?.ob?.text ?? ""), /^alpha line one/m);

  await run('su name second ob text "x" for name beta accordingto name checks to name text out two be helper do');
  assert.match(String(remember("out two")?.ob?.text ?? ""), /^beta line one/m);

});

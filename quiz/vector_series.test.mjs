import test from "node:test";
import assert from "node:assert/strict";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget, remember } from "../program/remember/index.mjs";

async function run(line) {
  const sentence = parse(line);
  return interpret(sentence);
}

test("series from name vec converts text vector into series rows", async () => {
  forget();
  await run('exists su name hooks ob ve text "alpha" "beta" be vector ya');
  await run("from name hooks to name series hook rows be series do");

  const out = remember("hook rows");
  assert.ok(out);
  assert.equal(out.be, "series");
  const rows = Array.isArray(out.ob?.series) ? out.ob.series : [];
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map(row => row?.ob?.text ?? ""), ["alpha", "beta"]);
  assert.deepEqual(rows.map(row => row?.from?.num), [1, 2]);
});

test("series from name vec preserves map-typed vector elements", async () => {
  forget();
  await run('exists su name hooks ob ve text "a" "b" be vector ya');
  await run("su name make row be ceremony def");
  await run("su name line stage ob text of ob of this to name text line be text do");
  await run("su name row stage be map def");
  await run("su name hook ob name text line ya");
  await run('su name lyrics ob text "lyric" ya');
  await run("prah");
  await run("su name row stage ret");
  await run("prah");
  await run("ob name hooks at name all be make row do");
  await run("from name hooks to name series hymn rows be series do");

  const out = remember("hymn rows");
  assert.ok(out);
  assert.equal(out.be, "series");
  const rows = Array.isArray(out.ob?.series) ? out.ob.series : [];
  assert.equal(rows.length, 2);
  assert.equal(rows[0]?.be, "map");
  assert.equal(rows[1]?.be, "map");
  assert.equal(typeof rows[0]?.ob?.map, "object");
  assert.equal(typeof rows[1]?.ob?.map, "object");
});

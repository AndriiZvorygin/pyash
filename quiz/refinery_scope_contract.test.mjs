import test from "node:test";
import assert from "node:assert/strict";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget, remember } from "../program/remember/index.mjs";

async function run(line) {
  return interpret(parse(line));
}

test("refinery platform writes are local by default and only declared output is exported", async () => {
  forget();

  await run("su name helper make ob text input to name text out be ceremony def");
  await run('su name helper temp ob text "secret" be text do');
  await run('ob text "hello" to name text out be text do');
  await run("su name out ret");
  await run("prah");

  await run("su name demo be refinery def");
  await run('su name seed ob text "go" to name text out be helper make do');
  await run("prah");

  await run("from name demo be refinery do");

  assert.equal(remember("out")?.ob?.text, "hello");
  assert.equal(remember("helper temp"), undefined);
});

test("refinery enforces platform output contract types", async () => {
  forget();

  await run("su name demo be refinery def");
  await run("su name bad ob num 7 to name text out be plus do");
  await run("prah");

  const res = await run("from name demo be refinery do");
  assert.equal(res?.be, "error");
  assert.equal(res?.su?.name, "platform produce defective");
});

test("export requires active refinery platform scope", async () => {
  forget();

  await assert.rejects(
    () => run("su name item be export do"),
    (err) => err?.sentence?.su?.name === "refinery produce defective"
  );
});

test("export accepts ob name selector inside refinery platform scope", async () => {
  forget();

  await run('exists su name cargo ob text "ok" be text ya');
  await run("su name demo be refinery def");
  await run("su name mark ob name cargo be export do");
  await run("prah");

  const res = await run("from name demo be refinery do");
  assert.notEqual(res?.be, "error");
  assert.equal(remember("cargo")?.ob?.text, "ok");
});

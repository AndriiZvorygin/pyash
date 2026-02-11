import test from "node:test";
import assert from "node:assert/strict";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget, remember } from "../program/remember/index.mjs";

async function run(line) {
  return interpret(parse(line));
}

test("router input returns normalized payload with payload id", async () => {
  forget();
  const result = await run(
    'su name router as wo input from name channel matrix room pyash to name agent pyash-agent ob text "hi" be router do'
  );
  assert.equal(result?.be, "input");
  assert.match(String(result?.su?.name ?? ""), /^news-\d{8}-\d{4}$/);
  assert.equal(result?.from?.name, "channel matrix room pyash");
  assert.equal(result?.to?.name, "agent pyash-agent");
  assert.equal(result?.for?.text, "pyash-agent");
  assert.match(String(result?.fromtext?.text ?? ""), /channel matrix room pyash -> agent pyash-agent/);
  assert.equal(result?.ob?.text, "hi");
  assert.equal(remember("result")?.be, "input");
  assert.equal(remember("result")?.ob?.text, "hi");
});

test("router produce returns delivery ack sentence", async () => {
  forget();
  const result = await run(
    'su name router as wo produce from name agent pyash-agent to name channel matrix room pyash accordingto text "news-20260211-0001" ob text "mind is not configured yet" be router do'
  );
  assert.equal(result?.be, "produce");
  assert.match(String(result?.su?.name ?? ""), /^matrix-event-\d{8}-\d{4}$/);
  assert.deepEqual(result?.vyah?.ve?.values, ["success"]);
  assert.equal(result?.from?.name, "agent pyash-agent");
  assert.equal(result?.to?.name, "channel matrix room pyash");
  assert.equal(result?.accordingto?.text, "news-20260211-0001");
});

test("router health returns ready sentence", async () => {
  forget();
  const result = await run("su name router as wo health be router do");
  assert.equal(result?.be, "health");
  assert.equal(result?.su?.name, "router");
  assert.equal(result?.ob?.text, "ready");
  assert.equal(result?.as?.boolean, true);
  assert.match(String(result?.since?.date ?? ""), /^\d{4}-\d{2}-\d{2}T/);
});

test("router input without destination raises router route defective", async () => {
  forget();
  await assert.rejects(
    () => run('su name router as wo input from name channel matrix room pyash ob text "hi" be router do'),
    (err) => err?.sentence?.su?.name === "router route defective"
  );
});

test("router produce without payload id raises router produce defective", async () => {
  forget();
  await assert.rejects(
    () => run(
      'su name router as wo produce from name agent pyash-agent to name channel matrix room pyash ob text "ok" be router do'
    ),
    (err) => err?.sentence?.su?.name === "router produce defective"
  );
});

test("router call without operation raises router input defective", async () => {
  forget();
  await assert.rejects(
    () => run("be router do"),
    (err) => err?.sentence?.su?.name === "router input defective"
  );
});

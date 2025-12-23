import test from "node:test";
import assert from "node:assert/strict";

import { interpret } from "../program/bridge/index.mjs";
import { parse } from "../program/understand/index.mjs";
import { forget, remember } from "../program/remember/index.mjs";

function run(lines) {
  return Promise.all(
    lines.map(async line => {
      const s = parse(line);
      if (s) return interpret(s);
    })
  );
}

test("evoker can supply sequence registers even if def omits them", async () => {
  forget();

  const defLines = [
    "exists su name counter ob num 0 be number ya",
    "su name climb to name num counter be ceremony def",
    "ob num 1 to name counter be add do",
    "su name climb be ceremony prah"
  ];
  await run(defLines);

  const evoker = parse("to name counter fromindex num 1 toindex num 3 be climb do");
  await interpret(evoker);

  const counter = remember("counter");
  assert.ok(counter, "counter should be remembered");
  assert.equal(counter.ob.num, 2);
});

test("ceremony must declare sequence registers it reads via this", async () => {
  forget();

  const defLines = [
    "su name peek be ceremony def",
    "ob this fromindex be number ya",
    "su name peek be ceremony prah"
  ];

  await assert.rejects(
    async () => {
      await run(defLines);
    },
    (err) => {
      assert.equal(err?.sentence?.su?.name, "sequence register missing");
      assert.match(err?.sentence?.ob?.text ?? "", /fromindex/);
      return true;
    }
  );
});

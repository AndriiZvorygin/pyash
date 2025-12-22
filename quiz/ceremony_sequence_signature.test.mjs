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
    "exists subj name counter obj num 0 be number ya",
    "subj name climb to name num counter be ceremony def",
    "obj num 1 to name counter be add do",
    "subj name climb be ceremony prah"
  ];
  await run(defLines);

  const evoker = parse("to name counter fromindex num 1 toindex num 3 be climb do");
  await interpret(evoker);

  const counter = remember("counter");
  assert.ok(counter, "counter should be remembered");
  assert.equal(counter.obj.num, 2);
});

test("ceremony must declare sequence registers it reads via this", async () => {
  forget();

  const defLines = [
    "subj name peek be ceremony def",
    "obj this fromindex be number ya",
    "subj name peek be ceremony prah"
  ];

  await assert.rejects(
    async () => {
      await run(defLines);
    },
    (err) => {
      assert.equal(err?.sentence?.subj?.name, "sequence register missing");
      assert.match(err?.sentence?.obj?.text ?? "", /fromindex/);
      return true;
    }
  );
});

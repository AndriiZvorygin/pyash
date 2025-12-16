import test from "node:test";
import assert from "node:assert/strict";

import { interpret } from "../program/bridge/index.mjs";
import { parse } from "../program/understand/index.mjs";
import { remember, forget } from "../program/remember/index.mjs";

test("remains reads obj num ti obj ti this and from num ti fromindex ti this", async () => {
  forget();

  const lines = [
    "exists subj name counter obj num 7 be number ya",
    "subj name modceremony be ceremony def",
    "obj num ti obj ti this from num ti fromindex ti this to name mod be remains do",
    "subj name modceremony be ceremony prah",
    "subj name evoker obj name counter fromindex num 3 be modceremony do"
  ];

  for (const line of lines) {
    const s = parse(line);
    if (s) await interpret(s);
  }

  const mod = remember("mod");
  assert.equal(mod?.obj?.num, 1); // 7 % 3 = 1
});


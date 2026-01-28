import test from "node:test";
import assert from "node:assert/strict";

import { parse } from "../program/understand/index.mjs";

test("inline then with ret parses as conditional with ret consequence", () => {
  const s = parse("ob num 1 be equally from num 1 then this fromindex num 0 ret");
  assert.equal(s.mood, "do");
  assert.equal(s.be, "equally");
  assert.ok(s.consequence, "expected consequence");
  assert.equal(s.consequence.mood, "ret");
  assert.equal(s.consequence.ret?.role, "fromindex");
});

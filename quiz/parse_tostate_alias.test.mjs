import test from "node:test";
import assert from "node:assert/strict";

import { parse } from "../program/understand/index.mjs";

test("tostate aliases to become", () => {
  const sentence = parse("fromstate name markdown tostate name html be compile do");
  assert.equal(sentence?.fromstate?.name, "markdown");
  assert.equal(sentence?.become?.name, "html");
});

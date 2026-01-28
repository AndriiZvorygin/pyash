import test from "node:test";
import assert from "node:assert/strict";

import { splitSentences } from "../program/library/sentenceSplitter.mjs";

test("splitSentences treats then as delimiter in interpreter mode", () => {
  const text = "ob num 1 be equally from num 1 then this fromindex num 0 ret";
  const out = splitSentences(text, { includeThen: true });
  assert.deepEqual(out, [
    "ob num 1 be equally from num 1 then",
    "this fromindex num 0 ret"
  ]);
});

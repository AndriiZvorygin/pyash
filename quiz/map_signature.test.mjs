import test from "node:test";
import assert from "node:assert/strict";
import { deriveSignatureFromCall } from "../program/bridge/signature.mjs";

test("deriveSignatureFromCall includes at all for plus", () => {
  const sentence = {
    mood: "do",
    be: "plus",
    ob: { name: "vec" },
    from: { num: 1 },
    to: { name: "out" },
    at: { name: "all" }
  };
  const sig = deriveSignatureFromCall(sentence, { remember: () => ({ ob: { ve: { values: [1] } } }) });
  assert.deepEqual(sig, ["be", "plus", "at", "name", "vec", "num", "from", "num", "ob", "name", "vec", "num", "to", "name", "vec", "num"]);
});

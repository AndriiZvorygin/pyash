import test from "node:test";
import assert from "node:assert/strict";
import { deriveSignatureFromCall } from "../program/bridge/signature.mjs";

test("deriveSignatureFromCall includes at all for add", () => {
  const sentence = {
    mood: "do",
    be: "add",
    obj: { name: "vec" },
    from: { num: 1 },
    to: { name: "out" },
    at: { name: "all" }
  };
  const sig = deriveSignatureFromCall(sentence, { remember: () => ({ obj: { ve: { values: [1] } } }) });
  assert.deepEqual(sig, ["be", "add", "at", "name", "num", "from", "num", "obj", "name", "num", "to", "name", "num"]);
});

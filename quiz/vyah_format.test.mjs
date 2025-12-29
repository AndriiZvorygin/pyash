import test from "node:test";
import assert from "node:assert/strict";

import { sentenceToPyash } from "../program/beautiful.mjs";

test("vyah emits modifiers in official order", () => {
  const sentence = {
    mood: "do",
    be: "hear",
    ob: { name: "mic" },
    vyah: { ve: { type: "name", values: ["sloh", "past", "cancel", "satisfied"] } }
  };
  const text = sentenceToPyash(sentence);
  assert.match(text, /vyah cancel past sloh satisfied/);
});

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

test("vyah emits canonical habit for cron alias", () => {
  const sentence = {
    mood: "do",
    be: "hear",
    ob: { name: "mic" },
    vyah: { ve: { type: "name", values: ["cron"] } }
  };
  const text = sentenceToPyash(sentence);
  assert.match(text, /vyah habit/);
});

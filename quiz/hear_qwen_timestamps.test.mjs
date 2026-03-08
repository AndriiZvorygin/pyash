import test from "node:test";
import assert from "node:assert/strict";

import { parseQwenTimestampSegments } from "../program/verbs/hear/qwen_comfyui.mjs";

test("qwen timestamp parser keeps zero-length token fixes tiny not +1s", () => {
  const raw = [
    "7.20-7.28: We",
    "7.28-8.00: call",
    "17.84-17.84: creators",
    "17.84-17.84: We",
    "17.84-18.48: call"
  ].join("\n");

  const segments = parseQwenTimestampSegments(raw, "");
  assert.equal(segments.length, 5);

  const zeroFixed = segments.filter((s) => Math.abs(s.start - 17.84) < 1e-6 && s.text !== "call");
  assert.ok(zeroFixed.length >= 2);
  for (const seg of zeroFixed) {
    const dur = seg.end - seg.start;
    assert.ok(dur >= 0.039 && dur <= 0.06, `unexpected fixed duration ${dur}`);
  }

  const long = segments.find((s) => s.text === "call" && Math.abs(s.start - 17.84) < 1e-6);
  assert.ok(long);
  assert.ok(Math.abs(long.end - 18.48) < 1e-6);
});

import test from "node:test";
import assert from "node:assert/strict";

import { resolveFilenameFromCase } from "../program/verbs/itinerary_media.mjs";
import { doRemember, forget, remember } from "../program/remember/index.mjs";
import { state } from "../program/bridge/state.mjs";

test("resolveFilenameFromCase accepts direct filename strings", () => {
  const out = resolveFilenameFromCase({ filename: "artifacts/video/out.mp4" }, remember);
  assert.equal(out, "artifacts/video/out.mp4");
});

test("resolveFilenameFromCase resolves filename from remembered name", () => {
  forget();
  doRemember({
    mood: "ya",
    su: { name: "video out" },
    ob: { filename: "artifacts/video/out.mp4" },
    be: "concatenate"
  });
  const out = resolveFilenameFromCase({ name: "video out" }, remember);
  assert.equal(out, "artifacts/video/out.mp4");
});

test("resolveFilenameFromCase resolves filename genitive without object coercion", () => {
  const prevEvokeRef = state.currentEvokeRef;
  const prevEvoke = state.currentEvoke;
  state.currentEvokeRef = { to: { filename: "artifacts/video/final.mp4" } };
  state.currentEvoke = state.currentEvokeRef;
  try {
    const out = resolveFilenameFromCase(
      { filename: { genitive: { chain: ["this", "to", "filename"] } } },
      remember
    );
    assert.equal(out, "artifacts/video/final.mp4");
  } finally {
    state.currentEvokeRef = prevEvokeRef;
    state.currentEvoke = prevEvoke;
  }
});

test("resolveFilenameFromCase unwraps nested filename objects", () => {
  const out = resolveFilenameFromCase(
    { filename: { filename: "artifacts/video/nested.mp4" } },
    remember
  );
  assert.equal(out, "artifacts/video/nested.mp4");
});

test("resolveFilenameFromCase rejects object-marker filename strings", () => {
  const out = resolveFilenameFromCase({ filename: "[object Object]" }, remember);
  assert.equal(out, "");
});

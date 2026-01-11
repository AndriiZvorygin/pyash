import test from "node:test";
import assert from "node:assert/strict";

import { resolveHearInputPath } from "../program/verbs/hear.mjs";

test("hear resolves from name filename to a path", () => {
  const sentence = { from: { name: "audio" } };
  const remember = (name) => (name === "audio" ? { ob: { filename: "/tmp/audio.wav" } } : null);
  assert.equal(resolveHearInputPath(sentence, { rememberFn: remember }), "/tmp/audio.wav");
});

test("hear resolves from name text to a path", () => {
  const sentence = { from: { name: "audio" } };
  const remember = (name) => (name === "audio" ? { ob: { text: "/tmp/audio.wav" } } : null);
  assert.equal(resolveHearInputPath(sentence, { rememberFn: remember }), "/tmp/audio.wav");
});

test("hear uses from filename directly when provided", () => {
  const sentence = { from: { filename: "/tmp/direct.wav", name: "audio" } };
  const remember = () => ({ ob: { filename: "/tmp/ignored.wav" } });
  assert.equal(resolveHearInputPath(sentence, { rememberFn: remember }), "/tmp/direct.wav");
});

test("hear uses from text directly when provided", () => {
  const sentence = { from: { text: "/tmp/direct.wav", name: "audio" } };
  const remember = () => ({ ob: { text: "/tmp/ignored.wav" } });
  assert.equal(resolveHearInputPath(sentence, { rememberFn: remember }), "/tmp/direct.wav");
});

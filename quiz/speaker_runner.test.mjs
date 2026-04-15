import test from "node:test";
import assert from "node:assert/strict";

import { SpeakerRunner } from "../command/speaker_runner.mjs";

test("speaker runner enrol forwards clip_seconds when provided", async () => {
  const runner = new SpeakerRunner();
  let captured = null;
  runner.request = async (command, payload) => {
    captured = { command, payload };
    return { ok: true };
  };

  await runner.enrol({
    audio: "/tmp/a.wav",
    name: "Andrii",
    voicesDir: "./world/voices",
    clipSeconds: 7.5
  });

  assert.equal(captured?.command, "enrol");
  assert.equal(captured?.payload?.audio, "/tmp/a.wav");
  assert.equal(captured?.payload?.name, "Andrii");
  assert.equal(captured?.payload?.voices_dir, "./world/voices");
  assert.equal(captured?.payload?.clip_seconds, 7.5);
});

test("speaker runner enrol omits clip_seconds when absent", async () => {
  const runner = new SpeakerRunner();
  let captured = null;
  runner.request = async (command, payload) => {
    captured = { command, payload };
    return { ok: true };
  };

  await runner.enrol({
    audio: "/tmp/a.wav",
    name: "Andrii",
    voicesDir: "./world/voices"
  });

  assert.equal(captured?.command, "enrol");
  assert.equal(Object.prototype.hasOwnProperty.call(captured?.payload ?? {}, "clip_seconds"), false);
});

test("speaker runner identify forwards edge guard options when provided", async () => {
  const runner = new SpeakerRunner();
  let captured = null;
  runner.request = async (command, payload) => {
    captured = { command, payload };
    return { ok: true };
  };

  await runner.identify({
    audio: "/tmp/a.wav",
    voicesDir: "./world/voices",
    edgeCheckSeconds: 2.5,
    edgeMinDurationSeconds: 5.5,
    edgeMinSimilarity: 0.61,
  });

  assert.equal(captured?.command, "identify");
  assert.equal(captured?.payload?.edge_check_seconds, 2.5);
  assert.equal(captured?.payload?.edge_min_duration_seconds, 5.5);
  assert.equal(captured?.payload?.edge_min_similarity, 0.61);
});

test("speaker runner enrol forwards edge guard options when provided", async () => {
  const runner = new SpeakerRunner();
  let captured = null;
  runner.request = async (command, payload) => {
    captured = { command, payload };
    return { ok: true };
  };

  await runner.enrol({
    audio: "/tmp/a.wav",
    name: "Andrii",
    voicesDir: "./world/voices",
    edgeCheckSeconds: 2,
    edgeMinDurationSeconds: 7,
    edgeMinSimilarity: 0.64,
  });

  assert.equal(captured?.command, "enrol");
  assert.equal(captured?.payload?.edge_check_seconds, 2);
  assert.equal(captured?.payload?.edge_min_duration_seconds, 7);
  assert.equal(captured?.payload?.edge_min_similarity, 0.64);
});

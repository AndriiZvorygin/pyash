import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { isDefaultSpeakerLabel, speakerArtifactUsesDefaultLabels } from "../program/library/reporter_shared/speaker-diarization-policy.mjs";

test("numbered anonymous labels remain default after the three-digit range", () => {
  assert.equal(isDefaultSpeakerLabel("SPEAKER_999"), true);
  assert.equal(isDefaultSpeakerLabel("SPEAKER_10757"), true);
  assert.equal(isDefaultSpeakerLabel("Councillor Example"), false);
});

test("speaker artifacts with extended numbered labels remain checkpoint-valid", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "speaker-policy-"));
  const jsonPath = path.join(dir, "speakers.json");
  const srtPath = path.join(dir, "speakers.srt");
  fs.writeFileSync(jsonPath, JSON.stringify({ rows: [{ display: "SPEAKER_10757" }, { display: "SPEAKER_UNKNOWN" }] }));
  fs.writeFileSync(srtPath, "1\n00:00:00,000 --> 00:00:01,000\nSPEAKER_10757: test\n\n");
  assert.equal(speakerArtifactUsesDefaultLabels(jsonPath), true);
  assert.equal(speakerArtifactUsesDefaultLabels(srtPath), true);
  fs.rmSync(dir, { recursive: true, force: true });
});

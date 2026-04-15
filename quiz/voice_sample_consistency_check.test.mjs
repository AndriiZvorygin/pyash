import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { listSpeakerWavs, parseArgs } from "../command/voice_sample_consistency_check.mjs";

test("voice sample consistency parseArgs supports overrides", () => {
  const parsed = parseArgs(["world/voices", "--speaker", "speaker_688", "--clip", "5", "--head-offset", "1.2", "--limit", "10"]);
  assert.equal(parsed.voicesDir, "world/voices");
  assert.equal(parsed.speaker, "speaker_688");
  assert.equal(parsed.clipSeconds, 5);
  assert.equal(parsed.headOffsetSeconds, 1.2);
  assert.equal(parsed.limit, 10);
});

test("voice sample consistency listSpeakerWavs filters speaker wavs", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "voice-sample-consistency-"));
  await fs.writeFile(path.join(dir, "speaker_001.wav"), "");
  await fs.writeFile(path.join(dir, "speaker_010.wav"), "");
  await fs.writeFile(path.join(dir, "speaker_010.npy"), "");
  await fs.writeFile(path.join(dir, "noise.wav"), "");
  const all = listSpeakerWavs(dir, "");
  assert.deepEqual(all.map((x) => x.key), ["speaker_001", "speaker_010"]);
  const one = listSpeakerWavs(dir, "speaker_010");
  assert.deepEqual(one.map((x) => x.key), ["speaker_010"]);
});


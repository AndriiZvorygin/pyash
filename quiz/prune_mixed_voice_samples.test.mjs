import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  isAutoIdentifyMeta,
  listSpeakerWavs,
  parseArgs,
  parseSpeakerMetaFile,
  shouldPruneCandidate,
} from "../command/prune_mixed_voice_samples.mjs";

test("prune mixed parseArgs supports apply and thresholds", () => {
  const parsed = parseArgs(["world/voices", "--apply", "--speaker", "speaker_688", "--clip", "5", "--head-offset", "1.2", "--min-sim", "0.7", "--limit", "12"]);
  assert.equal(parsed.voicesDir, "world/voices");
  assert.equal(parsed.apply, true);
  assert.equal(parsed.speaker, "speaker_688");
  assert.equal(parsed.clipSeconds, 5);
  assert.equal(parsed.headOffsetSeconds, 1.2);
  assert.equal(parsed.minSimilarity, 0.7);
  assert.equal(parsed.limit, 12);
});

test("prune mixed meta parser and auto-identify classifier", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "prune-mixed-meta-"));
  const file = path.join(dir, "speaker_999.pya");
  await fs.writeFile(file, [
    "su name speaker metadata be map def",
    "su name origin ob text \"identify\" ya",
    "su name name ob text \"speaker_999\" ya",
    "su name speaker ob text \"speaker_999\" ya",
    "prah",
    ""
  ].join("\n"), "utf8");
  const meta = parseSpeakerMetaFile(file);
  assert.equal(meta.origin, "identify");
  assert.equal(isAutoIdentifyMeta(meta), true);
});

test("prune mixed decision flags self-vs-known tail contamination", () => {
  const prune = shouldPruneCandidate({
    key: "speaker_688",
    meta: { origin: "identify", name: "speaker_688", speaker: "speaker_688" },
    head: { speaker: "speaker_688", matched: "known", similarity: 0.91 },
    tail: { speaker: "speaker_001", matched: "known", similarity: 0.76 },
    minSimilarity: 0.72,
  });
  assert.equal(prune, true);
});

test("prune mixed listSpeakerWavs only returns speaker wav files", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "prune-mixed-list-"));
  await fs.writeFile(path.join(dir, "speaker_001.wav"), "");
  await fs.writeFile(path.join(dir, "speaker_010.wav"), "");
  await fs.writeFile(path.join(dir, "speaker_010.pya"), "");
  await fs.writeFile(path.join(dir, "noise.wav"), "");
  const all = listSpeakerWavs(dir, "");
  assert.deepEqual(all.map((x) => x.key), ["speaker_001", "speaker_010"]);
});


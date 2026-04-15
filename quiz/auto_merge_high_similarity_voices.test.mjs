import test from "node:test";
import assert from "node:assert/strict";
import { buildComponents, buildPairs, chooseCanonical } from "../command/auto_merge_high_similarity_voices.mjs";

test("auto merge builds similarity edges above threshold", () => {
  const vectors = [
    { key: "speaker_001", vec: new Float64Array([1, 0]) },
    { key: "speaker_002", vec: new Float64Array([0.95, 0.05]) },
    { key: "speaker_003", vec: new Float64Array([0, 1]) },
  ];
  const pairs = buildPairs(vectors, 0.8);
  assert.equal(pairs.length, 1);
  assert.equal(pairs[0].a, "speaker_001");
  assert.equal(pairs[0].b, "speaker_002");
});

test("auto merge finds connected components for transitive merges", () => {
  const keys = ["speaker_001", "speaker_002", "speaker_003", "speaker_004"];
  const pairs = [
    { a: "speaker_001", b: "speaker_002", sim: 0.9 },
    { a: "speaker_002", b: "speaker_003", sim: 0.85 },
  ];
  const components = buildComponents(keys, pairs)
    .map((arr) => [...arr].sort())
    .sort((a, b) => a[0].localeCompare(b[0]));
  assert.deepEqual(components, [["speaker_001", "speaker_002", "speaker_003"]]);
});

test("auto merge canonical selection prefers named then sample count then lowest id", () => {
  const component = [
    { key: "speaker_009", display: "", sampleCount: 2 },
    { key: "speaker_004", display: "Jon Farmer", sampleCount: 1 },
    { key: "speaker_001", display: "", sampleCount: 8 },
  ];
  const target = chooseCanonical(component);
  assert.equal(target.key, "speaker_004");
});


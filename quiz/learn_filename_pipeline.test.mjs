import test from "node:test";
import assert from "node:assert/strict";
import { parseLearningPipelineRequest, splitIntoOverlappingChunks, runLearnFilenamePipeline, DEFAULT_CHUNK_SIZE } from "../command/learn_from_filename_pipeline.mjs";

test("parseLearningPipelineRequest reads labeled stdin payload", () => {
  const parsed = parseLearningPipelineRequest("SOURCE_FILENAME:\nknow/input/source.txt\n\nLEARNING_FOCUS:\nhumility");
  assert.deepEqual(parsed, {
    sourceFilename: "know/input/source.txt",
    learningFocus: "humility"
  });
});

test("splitIntoOverlappingChunks keeps small text in one chunk", () => {
  const chunks = splitIntoOverlappingChunks("short text");
  assert.deepEqual(chunks, ["short text"]);
});

test("splitIntoOverlappingChunks creates two overlapping chunks for just-over-limit text", () => {
  const paragraph = "This is a paragraph about humility and shared practice. ".repeat(90);
  const source = `${paragraph}\n\n${paragraph}\n\n${paragraph}\n\n${paragraph}\n\n${paragraph}`;
  const chunks = splitIntoOverlappingChunks(source, 16 * 1024, 1800);
  assert.equal(chunks.length, 2);
  assert.ok(chunks[0].length <= (16 * 1024) + 2200);
  assert.ok(chunks[1].length <= (16 * 1024) + 2200);
  const overlapNeedle = chunks[0].slice(-300);
  assert.ok(chunks[1].includes(overlapNeedle.slice(0, 120)), "expected overlapping carryover between neighbouring chunks");
});

test("runLearnFilenamePipeline uses direct path for small sources", async () => {
  const calls = [];
  const output = await runLearnFilenamePipeline({
    sourceFilename: "small.txt",
    learningFocus: "humility",
    readFileFn: async () => "short source",
    runDirectFn: async ({ sourceFilename, learningFocus }) => {
      calls.push(["direct", sourceFilename, learningFocus]);
      return "FINAL CARD";
    },
    runExtractFn: async () => {
      calls.push(["extract"]);
      return "unused";
    },
    runMergeRefineFn: async () => {
      calls.push(["merge-refine"]);
      return "unused";
    }
  });
  assert.equal(output, "FINAL CARD");
  assert.deepEqual(calls, [["direct", "small.txt", "humility"]]);
});

test("runLearnFilenamePipeline uses chunk extract then merge-refine for large sources", async () => {
  const writes = new Map();
  const calls = [];
  const largeSource = ("Paragraph about love and wisdom. ".repeat(500)) + "\n\n" + ("Another paragraph. ".repeat(500));
  assert.ok(largeSource.length > DEFAULT_CHUNK_SIZE, "fixture should exceed chunk threshold");
  const output = await runLearnFilenamePipeline({
    sourceFilename: "large.txt",
    learningFocus: "love and wisdom",
    readFileFn: async (file) => {
      if (file === "large.txt") return largeSource;
      return writes.get(file) ?? "";
    },
    mkdtempFn: async () => "/tmp/learn-test",
    writeFileFn: async (file, text) => {
      writes.set(file, text);
    },
    runDirectFn: async () => {
      calls.push(["direct"]);
      return "unused";
    },
    runExtractFn: async ({ sourceFilename, learningFocus }) => {
      calls.push(["extract", sourceFilename, learningFocus]);
      return `CARD from ${sourceFilename}`;
    },
    runMergeRefineFn: async ({ sourceFilename, cardsFilename, learningFocus }) => {
      calls.push(["merge-refine", sourceFilename, cardsFilename, learningFocus]);
      const cardsText = writes.get(cardsFilename) ?? "";
      assert.match(cardsText, /CHUNK CARD 1/u);
      assert.match(cardsText, /CHUNK CARD 2/u);
      return "FINAL MERGED CARD";
    }
  });

  assert.equal(output, "FINAL MERGED CARD");
  assert.equal(calls[0][0], "extract");
  assert.equal(calls[1][0], "extract");
  assert.deepEqual(calls.at(-1), ["merge-refine", "large.txt", "/tmp/learn-test/chunk-cards.txt", "love and wisdom"]);
});

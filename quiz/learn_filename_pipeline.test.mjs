import test from "node:test";
import assert from "node:assert/strict";
import {
  parseLearningPipelineRequest,
  splitIntoOverlappingChunks,
  runLearnFilenamePipeline,
  DEFAULT_CHUNK_SIZE,
  resolveRunProgramPath,
  resolvePyashExampleResult,
  extractChildDefect,
  buildChildRunId,
  resolveChildArtifactProduceFilename,
  resolveChildArtifactResult
} from "../command/learn_from_filename_pipeline.mjs";

test("parseLearningPipelineRequest reads labeled stdin payload", () => {
  const parsed = parseLearningPipelineRequest("SOURCE_FILENAME:\nknow/input/source.txt\n\nLEARNING_FOCUS:\nhumility");
  assert.deepEqual(parsed, {
    sourceFilename: "know/input/source.txt",
    learningFocus: "humility"
  });
});

test("parseLearningPipelineRequest rejects empty learning focus clearly", () => {
  assert.throws(
    () => parseLearningPipelineRequest("SOURCE_FILENAME:\nknow/input/source.txt\n\nLEARNING_FOCUS:\n"),
    /learn filename pipeline defective: missing learning focus/u
  );
});

test("splitIntoOverlappingChunks keeps small text in one chunk", () => {
  const chunks = splitIntoOverlappingChunks("short text");
  assert.deepEqual(chunks, ["short text"]);
});

test("splitIntoOverlappingChunks creates two overlapping chunks for just-over-limit text", () => {
  const paragraph = "This is a paragraph about humility and shared practice. ".repeat(90);
  const source = `${paragraph}\n\n${paragraph}\n\n${paragraph}\n\n${paragraph}\n\n${paragraph}`;
  const chunks = splitIntoOverlappingChunks(source, DEFAULT_CHUNK_SIZE, 1800);
  assert.ok(chunks.length >= 2);
  assert.ok(chunks[0].length <= DEFAULT_CHUNK_SIZE + 2200);
  assert.ok(chunks.at(-1).length <= DEFAULT_CHUNK_SIZE + 2200);
  const overlapNeedle = chunks[0].slice(-300);
  assert.ok(chunks[1].includes(overlapNeedle.slice(0, 120)), "expected overlapping carryover between neighbouring chunks");
});

test("resolveRunProgramPath follows the current checkout root", () => {
  assert.equal(resolveRunProgramPath("/tmp/example-repo"), "/tmp/example-repo/run");
});

test("buildChildRunId derives child stages from parent run id", () => {
  assert.equal(buildChildRunId("20260319-053-refinery", "chunk-001"), "20260319-053-refinery/learn-pipeline/chunk-001");
  assert.equal(buildChildRunId("", "merge-refine", "pyash-learn-chunks-abc"), "pyash-learn-chunks-abc-merge-refine");
});

test("resolveChildArtifactProduceFilename follows the runner artifact convention", () => {
  assert.equal(
    resolveChildArtifactProduceFilename({ cwd: "/tmp/repo", runId: "run-123" }),
    "/tmp/repo/artifacts/run-123/produce.txt"
  );
});

test("resolveChildArtifactResult reads the child run produce artifact", async () => {
  const result = await resolveChildArtifactResult({
    cwd: "/tmp/repo",
    runId: "run-123",
    readFileFn: async (file) => {
      assert.equal(file, "/tmp/repo/artifacts/run-123/produce.txt");
      return "SEED CONCEPT\nPower lives within.\n";
    }
  });
  assert.equal(result, "SEED CONCEPT\nPower lives within.");
});

test("runLearnFilenamePipeline uses direct path for small sources", async () => {
  const calls = [];
  const original = process.env.PYA_MIND_RESPONSE;
  process.env.PYA_MIND_RESPONSE = JSON.stringify([
    { message: { content: "first" } },
    { message: { content: "second" } }
  ]);
  try {
    const output = await runLearnFilenamePipeline({
      sourceFilename: "small.txt",
      learningFocus: "humility",
      readFileFn: async () => "short source",
      runDirectFn: async ({ sourceFilename, learningFocus, envOverrides }) => {
        calls.push(["direct", sourceFilename, learningFocus, envOverrides?.PYA_MIND_RESPONSE]);
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
    assert.deepEqual(calls, [[
      "direct",
      "small.txt",
      "humility",
      JSON.stringify([
        { message: { content: "first" } },
        { message: { content: "second" } },
        { message: { content: "second" } },
        { message: { content: "second" } }
      ])
    ]]);
  } finally {
    if (original === undefined) delete process.env.PYA_MIND_RESPONSE;
    else process.env.PYA_MIND_RESPONSE = original;
  }
});

test("runLearnFilenamePipeline rejects empty learning focus clearly", async () => {
  await assert.rejects(
    () => runLearnFilenamePipeline({
      sourceFilename: "small.txt",
      learningFocus: "",
      readFileFn: async () => "short source"
    }),
    /learn filename pipeline defective: missing learning focus/u
  );
});

test("runLearnFilenamePipeline uses chunk extract then merge-refine for large sources", async () => {
  const writes = new Map();
  const calls = [];
  const largeSource = ("Paragraph about love and wisdom. ".repeat(500)) + "\n\n" + ("Another paragraph. ".repeat(500));
  assert.ok(largeSource.length > DEFAULT_CHUNK_SIZE, "fixture should exceed chunk threshold");
  const original = process.env.PYA_MIND_RESPONSE;
  process.env.PYA_MIND_RESPONSE = JSON.stringify([
    { message: { content: "chunk one" } },
    { message: { content: "chunk two" } },
    { message: { content: "merge" } },
    { message: { content: "refine" } },
    { message: { content: "verify" } },
    { message: { content: "PASS" } }
  ]);
  try {
    const expectedChunks = splitIntoOverlappingChunks(largeSource, DEFAULT_CHUNK_SIZE, 1800);
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
      runExtractFn: async ({ sourceFilename, learningFocus, envOverrides }) => {
        calls.push(["extract", sourceFilename, learningFocus, envOverrides?.PYA_MIND_RESPONSE]);
        return `CARD from ${sourceFilename}`;
      },
      runMergeRefineFn: async ({ sourceFilename, cardsFilename, learningFocus, envOverrides }) => {
        calls.push(["merge-refine", sourceFilename, cardsFilename, learningFocus, envOverrides?.PYA_MIND_RESPONSE]);
        const cardsText = writes.get(cardsFilename) ?? "";
        assert.match(cardsText, /CHUNK CARD 1/u);
        assert.match(cardsText, /CHUNK CARD 2/u);
        return "FINAL MERGED CARD";
      }
    });

    assert.equal(output, "FINAL MERGED CARD");
    const extractCalls = calls.filter(call => call[0] === "extract");
    assert.equal(extractCalls.length, expectedChunks.length);
    assert.equal(extractCalls[0][3], JSON.stringify([{ message: { content: "chunk one" } }]));
    assert.equal(extractCalls[1][3], JSON.stringify([{ message: { content: "chunk two" } }]));
    if (extractCalls.length >= 3) {
      assert.equal(extractCalls[2][3], JSON.stringify([{ message: { content: "merge" } }]));
    }
    assert.equal(calls.at(-1)[0], "merge-refine");
    assert.equal(calls.at(-1)[1], "large.txt");
    assert.equal(calls.at(-1)[2], "/tmp/learn-test/chunk-cards.txt");
    assert.equal(calls.at(-1)[3], "love and wisdom");
    const mergeFixture = JSON.parse(calls.at(-1)[4]);
    assert.equal(mergeFixture.length, 4);
    assert.equal(mergeFixture.at(-1)?.message?.content, "PASS");
  } finally {
    if (original === undefined) delete process.env.PYA_MIND_RESPONSE;
    else process.env.PYA_MIND_RESPONSE = original;
  }
});

test("resolvePyashExampleResult prefers stdout card over verbose produce trace", async () => {
  const card = [
    "SEED CONCEPT",
    "Power is intelligent energy within consciousness.",
    "",
    "CARDINAL TRAINING SENTENCE",
    "True power flows through aligned love and wisdom."
  ].join("\n");
  const stderr = [
    "produce file: /tmp/fake-produce.txt",
    "run start: 2026-03-19T00:00:00Z"
  ].join("\n");
  const result = await resolvePyashExampleResult({
    stdoutText: card,
    stderrText: stderr,
    readFileFn: async () => "exists su name trace ob text \"garbage\" ya"
  });
  assert.equal(result, card);
});

test("resolvePyashExampleResult can still recover a card from verbose chatter as fallback", async () => {
  const stderr = [
    "produce file: /tmp/fake-produce.txt",
    "run start: 2026-03-19T00:00:00Z",
    "artifacts folder: /tmp/repo/artifacts/run-123"
  ].join("\n");
  const result = await resolvePyashExampleResult({
    stdoutText: "",
    stderrText: stderr,
    readFileFn: async () => [
      "SEED CONCEPT",
      "Power is inner light.",
      "",
      "CARDINAL TRAINING SENTENCE",
      "Power becomes visible through loving action."
    ].join("\n")
  });
  assert.match(result, /^SEED CONCEPT$/mu);
});

test("extractChildDefect detects guarantee failures in child traces", () => {
  assert.equal(
    extractChildDefect('su name guarantee defective ob text "learning source support defective" ya'),
    "learning source support defective"
  );
});

test("extractChildDefect ignores traced source text that only mentions a defect string", () => {
  const trace = [
    "exists su name evoke-10 ob la ob bool lie fromtext text \"learning source support defective\" be guarantee do ko be evoke ya",
    "su name result ob text \"PASS\" be answer ya",
    "SEED CONCEPT",
    "True humility is balanced service."
  ].join("\n");
  assert.equal(extractChildDefect(trace), "");
});

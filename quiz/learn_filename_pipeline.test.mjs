import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import {
  parseLearningPipelineRequest,
  splitIntoOverlappingChunks,
  runLearnFilenamePipeline,
  DEFAULT_CHUNK_SIZE,
  DEFAULT_MERGE_GROUP_SIZE,
  resolveRunProgramPath,
  resolvePyashExampleResult,
  extractChildDefect,
  buildChildRunId,
  resolveChildArtifactProduceFilename,
  resolveChildArtifactResult,
  planMergeLayers,
  recoverLearnCardFromChildArtifacts
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

test("planMergeLayers builds bounded merge tree for many cards", () => {
  const plan = planMergeLayers(new Array(9).fill("card"), DEFAULT_MERGE_GROUP_SIZE);
  assert.deepEqual(plan, [
    {
      index: 1,
      groups: [
        { index: 1, size: 4 },
        { index: 2, size: 4 },
        { index: 3, size: 1 }
      ]
    },
    {
      index: 2,
      groups: [
        { index: 1, size: 3 }
      ]
    }
  ]);
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

test("recoverLearnCardFromChildArtifacts falls back to latest newspaper card", async () => {
  const files = new Map();
  files.set("/tmp/repo/artifacts/run-abc/newspaper/text-000001.txt", "not a card");
  files.set(
    "/tmp/repo/artifacts/run-abc/newspaper/text-000002.txt",
    ["SEED CONCEPT", "Recovered card", "", "CARDINAL TRAINING SENTENCE", "Recovered line"].join("\n")
  );
  const card = await recoverLearnCardFromChildArtifacts({
    cwd: "/tmp/repo",
    runId: "run-abc",
    readFileFn: async (file) => {
      if (!files.has(file)) throw Object.assign(new Error("missing"), { code: "ENOENT" });
      return files.get(file);
    },
    readdirFn: async (dir) => {
      assert.equal(dir, "/tmp/repo/artifacts/run-abc/newspaper");
      return ["text-000001.txt", "text-000002.txt"];
    }
  });
  assert.match(card, /^SEED CONCEPT$/mu);
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
    assert.equal(calls.at(-1)[2], "/tmp/learn-test/merge-layer-01/group-001/chunk-cards.txt");
    assert.equal(calls.at(-1)[3], "love and wisdom");
    const mergeFixture = JSON.parse(calls.at(-1)[4]);
    assert.equal(mergeFixture.length, 4);
    assert.equal(mergeFixture.at(-1)?.message?.content, "PASS");
  } finally {
    if (original === undefined) delete process.env.PYA_MIND_RESPONSE;
    else process.env.PYA_MIND_RESPONSE = original;
  }
});

test("runLearnFilenamePipeline retries chunk extraction when learn card schema validation fails", async () => {
  const writes = new Map();
  const calls = [];
  const attemptsByChunk = new Map();
  const largeSource = ("Paragraph about forgiveness and catalyst. ".repeat(500)) + "\n\n" + ("Another paragraph. ".repeat(500));
  const expectedChunks = splitIntoOverlappingChunks(largeSource, DEFAULT_CHUNK_SIZE, 1800);
  assert.ok(expectedChunks.length >= 2, "fixture should produce multiple chunks");

  const output = await runLearnFilenamePipeline({
    sourceFilename: "retry-large.txt",
    learningFocus: "forgiveness",
    readFileFn: async (file) => {
      if (file === "retry-large.txt") return largeSource;
      return writes.get(file) ?? "";
    },
    mkdtempFn: async () => "/tmp/learn-retry-test",
    writeFileFn: async (file, text) => {
      writes.set(file, text);
    },
    runExtractFn: async ({ sourceFilename }) => {
      const prev = attemptsByChunk.get(sourceFilename) ?? 0;
      const next = prev + 1;
      attemptsByChunk.set(sourceFilename, next);
      calls.push(["extract", sourceFilename, next]);
      if (sourceFilename.endsWith("chunk-001.txt") && next === 1) {
        throw new Error("learn filename pipeline defective: child stage failed: learn card defective: missing heading ORTHOGONAL FEATURES");
      }
      return `CARD from ${path.basename(sourceFilename)} attempt ${next}`;
    },
    runMergeRefineFn: async ({ cardsFilename }) => {
      calls.push(["merge-refine", cardsFilename]);
      return "FINAL AFTER RETRY";
    }
  });

  assert.equal(output, "FINAL AFTER RETRY");
  const firstChunkCalls = calls.filter((call) => call[0] === "extract" && String(call[1]).endsWith("chunk-001.txt"));
  assert.equal(firstChunkCalls.length, 2, "first chunk should be retried once");
  const extractCalls = calls.filter((call) => call[0] === "extract");
  assert.equal(extractCalls.length, expectedChunks.length + 1, "one extra extract call expected due to retry");
});

test("runLearnFilenamePipeline keeps highest scored fallback when support checks never pass", async () => {
  const writes = new Map();
  const calls = [];
  const source = ("Paragraph about forgiveness and catalyst. ".repeat(500)) + "\n\n" + ("Another paragraph. ".repeat(500));
  const expectedChunks = splitIntoOverlappingChunks(source, DEFAULT_CHUNK_SIZE, 1800);
  assert.ok(expectedChunks.length >= 2, "fixture should produce multiple chunks");

  const output = await runLearnFilenamePipeline({
    sourceFilename: "fallback-large.txt",
    learningFocus: "forgiveness",
    readFileFn: async (file) => {
      if (file === "fallback-large.txt") return source;
      return writes.get(file) ?? "";
    },
    mkdtempFn: async () => "/tmp/learn-fallback-test",
    writeFileFn: async (file, text) => {
      writes.set(file, text);
    },
    runExtractFn: async ({ sourceFilename }) => {
      calls.push(["extract", sourceFilename]);
      if (sourceFilename.endsWith("chunk-001.txt")) {
        const e1 = new Error("learn filename pipeline defective: child stage failed: learning source support defective: score=0.31");
        e1.resultText = [
          "SEED CONCEPT",
          "Low score card",
          "",
          "CARDINAL TRAINING SENTENCE",
          "Low score line",
          "",
          "TEACHING PROGRESSION",
          "- one",
          "",
          "ORTHOGONAL FEATURES",
          "- one",
          "",
          "SURPRISES AND MISUNDERSTANDINGS",
          "- one",
          "",
          "AFFAIRS OR ACTIVITIES",
          "- one",
          "",
          "CAUSATIVE AND CONSEQUENCE",
          "- one",
          "",
          "CARDINAL SCENES AND IDIOMS",
          "- one",
          "",
          "BRIEF MEMORY PHRASES",
          "- one",
          "",
          "CONCEPT RELATIONS",
          "- one"
        ].join("\n");
        throw e1;
      }
      return `CARD from ${path.basename(sourceFilename)}`;
    },
    runMergeRefineFn: async ({ cardsFilename }) => {
      calls.push(["merge-refine", cardsFilename]);
      return "FINAL FROM BEST FALLBACK";
    }
  });

  assert.equal(output, "FINAL FROM BEST FALLBACK");
  const extractCalls = calls.filter(call => call[0] === "extract");
  assert.equal(extractCalls.length, expectedChunks.length + 2, "first chunk should exhaust retries then continue");
});

test("runLearnFilenamePipeline keeps scored fallback when a later retry times out", async () => {
  const writes = new Map();
  const calls = [];
  const attemptsByChunk = new Map();
  const source = ("Paragraph about forgiveness and catalyst. ".repeat(500)) + "\n\n" + ("Another paragraph. ".repeat(500));
  const expectedChunks = splitIntoOverlappingChunks(source, DEFAULT_CHUNK_SIZE, 1800);
  assert.ok(expectedChunks.length >= 2, "fixture should produce multiple chunks");

  const output = await runLearnFilenamePipeline({
    sourceFilename: "fallback-timeout-large.txt",
    learningFocus: "forgiveness",
    readFileFn: async (file) => {
      if (file === "fallback-timeout-large.txt") return source;
      return writes.get(file) ?? "";
    },
    mkdtempFn: async () => "/tmp/learn-fallback-timeout-test",
    writeFileFn: async (file, text) => {
      writes.set(file, text);
    },
    runExtractFn: async ({ sourceFilename }) => {
      const prev = attemptsByChunk.get(sourceFilename) ?? 0;
      const next = prev + 1;
      attemptsByChunk.set(sourceFilename, next);
      calls.push(["extract", sourceFilename, next]);
      if (sourceFilename.endsWith("chunk-001.txt") && next === 1) {
        const e1 = new Error("learn filename pipeline defective: child stage failed: learning source support defective: score=0.31");
        e1.resultText = [
          "SEED CONCEPT",
          "Fallback seed card",
          "",
          "CARDINAL TRAINING SENTENCE",
          "Fallback line",
          "",
          "TEACHING PROGRESSION",
          "- one",
          "",
          "ORTHOGONAL FEATURES",
          "- one",
          "",
          "SURPRISES AND MISUNDERSTANDINGS",
          "- one",
          "",
          "AFFAIRS OR ACTIVITIES",
          "- one",
          "",
          "CAUSATIVE AND CONSEQUENCE",
          "- one",
          "",
          "CARDINAL SCENES AND IDIOMS",
          "- one",
          "",
          "BRIEF MEMORY PHRASES",
          "- one",
          "",
          "CONCEPT RELATIONS",
          "- one"
        ].join("\n");
        throw e1;
      }
      if (sourceFilename.endsWith("chunk-001.txt") && next === 2) {
        throw new Error("child run defective: status=1 signal= timeout after 900000ms");
      }
      return `CARD from ${path.basename(sourceFilename)}`;
    },
    runMergeRefineFn: async ({ cardsFilename }) => {
      calls.push(["merge-refine", cardsFilename]);
      return "FINAL FROM TIMEOUT FALLBACK";
    }
  });

  assert.equal(output, "FINAL FROM TIMEOUT FALLBACK");
  const firstChunkCalls = calls.filter((call) => call[0] === "extract" && String(call[1]).endsWith("chunk-001.txt"));
  assert.equal(firstChunkCalls.length, 2, "first chunk should stop retrying after timeout and keep fallback");
});

test("runLearnFilenamePipeline captures source-support fallback when defect appears in stderr", async () => {
  const writes = new Map();
  const calls = [];
  const source = ("Paragraph about forgiveness and catalyst. ".repeat(500)) + "\n\n" + ("Another paragraph. ".repeat(500));
  const expectedChunks = splitIntoOverlappingChunks(source, DEFAULT_CHUNK_SIZE, 1800);
  assert.ok(expectedChunks.length >= 2, "fixture should produce multiple chunks");

  const output = await runLearnFilenamePipeline({
    sourceFilename: "fallback-stderr-large.txt",
    learningFocus: "forgiveness",
    readFileFn: async (file) => {
      if (file === "fallback-stderr-large.txt") return source;
      return writes.get(file) ?? "";
    },
    mkdtempFn: async () => "/tmp/learn-fallback-stderr-test",
    writeFileFn: async (file, text) => {
      writes.set(file, text);
    },
    runExtractFn: async ({ sourceFilename }) => {
      calls.push(["extract", sourceFilename]);
      if (sourceFilename.endsWith("chunk-001.txt")) {
        const e1 = new Error("child run defective: status=1 signal=");
        e1.stderr = "su name guarantee defective ob text \"learning source support defective: score=0.42\"";
        e1.resultText = [
          "SEED CONCEPT",
          "Recovered from stderr-scored failure",
          "",
          "CARDINAL TRAINING SENTENCE",
          "Recovered line",
          "",
          "TEACHING PROGRESSION",
          "- one",
          "",
          "ORTHOGONAL FEATURES",
          "- one",
          "",
          "SURPRISES AND MISUNDERSTANDINGS",
          "- one",
          "",
          "AFFAIRS OR ACTIVITIES",
          "- one",
          "",
          "CAUSATIVE AND CONSEQUENCE",
          "- one",
          "",
          "CARDINAL SCENES AND IDIOMS",
          "- one",
          "",
          "BRIEF MEMORY PHRASES",
          "- one",
          "",
          "CONCEPT RELATIONS",
          "- one"
        ].join("\n");
        throw e1;
      }
      return `CARD from ${path.basename(sourceFilename)}`;
    },
    runMergeRefineFn: async ({ cardsFilename }) => {
      calls.push(["merge-refine", cardsFilename]);
      return "FINAL FROM STDERR FALLBACK";
    }
  });

  assert.equal(output, "FINAL FROM STDERR FALLBACK");
  const extractCalls = calls.filter(call => call[0] === "extract");
  assert.equal(extractCalls.length, expectedChunks.length + 2, "first chunk should exhaust retries with fallback captured from stderr defects");
});

test("runLearnFilenamePipeline progressively merges very large sources in bounded groups", async () => {
  const writes = new Map();
  const calls = [];
  const paragraph = "Paragraph about humility and hidden teachings. ".repeat(220);
  const largeSource = new Array(9).fill(`${paragraph}\n\n`).join("");
  const expectedChunks = splitIntoOverlappingChunks(largeSource, DEFAULT_CHUNK_SIZE, 1800);
  assert.ok(expectedChunks.length > DEFAULT_MERGE_GROUP_SIZE, "fixture should require progressive merge layers");
  const mergePlan = planMergeLayers(new Array(expectedChunks.length).fill("card"), DEFAULT_MERGE_GROUP_SIZE);
  const expectedMergeCalls = mergePlan.reduce((sum, layer) => sum + layer.groups.length, 0);

  const output = await runLearnFilenamePipeline({
    sourceFilename: "huge.txt",
    learningFocus: "humility",
    readFileFn: async (file) => {
      if (file === "huge.txt") return largeSource;
      return writes.get(file) ?? "";
    },
    mkdtempFn: async () => "/tmp/learn-huge-test",
    writeFileFn: async (file, text) => {
      writes.set(file, text);
    },
    runExtractFn: async ({ sourceFilename }) => {
      calls.push(["extract", sourceFilename]);
      return `CARD from ${path.basename(sourceFilename)}`;
    },
    runMergeRefineFn: async ({ cardsFilename, traceDir, traceLabel, childRunId }) => {
      calls.push(["merge-refine", cardsFilename, traceDir, traceLabel, childRunId]);
      return `MERGED from ${path.basename(path.dirname(cardsFilename))}`;
    }
  });

  const mergeCalls = calls.filter(call => call[0] === "merge-refine");
  assert.equal(mergeCalls.length, expectedMergeCalls);
  assert.match(String(mergeCalls[0][1]), /merge-layer-01[\\/]group-001[\\/]chunk-cards\.txt/u);
  assert.match(String(mergeCalls[0][4]), /merge-layer-01\/group-001/u);
  assert.match(String(mergeCalls.at(-1)?.[1] ?? ""), /merge-layer-02[\\/]group-001[\\/]chunk-cards\.txt/u);
  assert.equal(output, "MERGED from group-001");
});

test("runLearnFilenamePipeline forwards child run ids to all default stage wrappers", async () => {
  const calls = [];
  await runLearnFilenamePipeline({
    sourceFilename: "small.txt",
    learningFocus: "humility",
    readFileFn: async () => "short source",
    runDirectFn: async ({ childRunId }) => {
      calls.push(childRunId);
      return "FINAL CARD";
    }
  });
  assert.equal(calls.length, 1);
  assert.match(String(calls[0] ?? ""), /direct/u);
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

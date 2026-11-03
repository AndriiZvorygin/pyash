import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  appendEnglishWordNetAtomSenseLinks,
  buildEnglishWordNetAtomSensePrompt,
  buildEnglishWordNetAtomSenseWorklist,
  ENGLISH_WORDNET_ATOM_SENSE_CONFIG_URL,
  filterEnglishWordNetAtomSenseWorklist,
  loadEnglishWordNetAtomSenseConfig,
  parseEnglishWordNetAtomSenseBatchPya,
  parseEnglishWordNetAtomSenseResponse,
  renderEnglishWordNetAtomSenseBatchPya,
  runEnglishWordNetAtomSenseSweep
} from "../program/library/translation/english_wordnet_atom_sense_sweep.mjs";
import { renderEnglishWordNetSenseLinksPya } from "../program/library/translation/english_wordnet_linker.mjs";
import { parseEnglishWordNetBridgeCatalog } from "../program/library/translation/english_wordnet_bridges.mjs";

function atom(id, pyac, labels, rank, candidates) {
  return {
    id,
    targetId: id,
    pyac,
    labels,
    english30kRank: rank,
    status: "direct-candidates-unlinked",
    directCandidates: candidates
  };
}

function candidate(source, definition, fields = {}) {
  const [pos, synset] = source.split(":");
  return {
    source,
    pos,
    synset,
    lemmas: [fields.lemma ?? "sample"],
    definition,
    matchedLemma: fields.lemma ?? "sample",
    english30kRank: fields.rank ?? 10,
    tagCount: fields.tagCount ?? 1,
    activeTargetIds: fields.activeTargetIds ?? []
  };
}

function responseFor(prompt) {
  const rows = JSON.parse(prompt.split("\n").find((line) => line.startsWith("[[")));
  return JSON.stringify({
    decisions: rows.map((row) => ({
      id: row[0],
      status: "select",
      source: row[5][0][0],
      rationale: "The supplied definition matches the atom label."
    }))
  });
}

test("atom sense sweep config uses a bounded Qwen batch and one retry", async () => {
  const config = await loadEnglishWordNetAtomSenseConfig({ configUrl: ENGLISH_WORDNET_ATOM_SENSE_CONFIG_URL });
  assert.equal(config.model, "qwen3.5:9b");
  assert.equal(config["batch-max-items"], 24);
  assert.equal(config["max-attempts"], 2);
  assert.equal(config.parallelism, 8);
});

test("atom worklist keeps only unlinked direct senses and presents definition text only", () => {
  const rows = buildEnglishWordNetAtomSenseWorklist([
    atom("atom:hban", "hban", ["bank"], 20, [
      candidate("n:00000001-n", "a financial institution; an example bank", { lemma: "bank" }),
      candidate("n:00000002-n", "sloping land beside a body of water", { lemma: "bank", rank: 40 }),
      candidate("n:00000003-n", "a sense already in use", { activeTargetIds: ["atom:hoth"] })
    ]),
    atom("atom:hcat", "hcat", ["cat"], 10, [candidate("n:00000004-n", "a small domesticated feline", { lemma: "cat" })]),
    { ...atom("atom:hgra", "hgra", ["the"], 1, [candidate("n:00000005-n", "article")]), status: "grammar-no-lexical-sense" }
  ]);

  assert.deepEqual(rows.map((row) => row.id), ["atom:hcat:n", "atom:hban:n"]);
  assert.equal(rows[1].candidates.length, 2);
  const prompt = buildEnglishWordNetAtomSensePrompt([{ item: rows[1], candidates: rows[1].candidates }]);
  assert.match(prompt, /a financial institution/u);
  assert.doesNotMatch(prompt, /an example bank/u);
  assert.match(prompt, /Choose the supplied WordNet sense/u);
});

test("atom worklist creates an independent decision slot for each uncovered part of speech", () => {
  const rows = buildEnglishWordNetAtomSenseWorklist([
    atom("atom:cyuk", "cyuk", ["draw"], 20, [
      candidate("n:00000041-n", "a mark made with a pencil", { lemma: "draw" }),
      candidate("v:00000042-v", "produce a picture", { lemma: "draw" }),
      candidate("a:00000043-a", "a drawn or elongated shape", { lemma: "draw" }),
      candidate("s:00000044-s", "stretched in one direction", { lemma: "draw" })
    ])
  ]);

  assert.deepEqual(rows.map((row) => [row.id, row.partOfSpeech, row.targetId, row.candidates.length]), [
    ["atom:cyuk:a", "a", "atom:cyuk:a", 1],
    ["atom:cyuk:n", "n", "atom:cyuk:n", 1],
    ["atom:cyuk:s", "s", "atom:cyuk:s", 1],
    ["atom:cyuk:v", "v", "atom:cyuk:v", 1]
  ]);
});

test("atom sense prompts give each POS slot an opaque response id and restore its canonical target identity", () => {
  const [item] = buildEnglishWordNetAtomSenseWorklist([
    atom("atom:htun", "htun", ["only"], 74, [
      candidate("s:00000001-s", "exclusive of anyone or anything else", { lemma: "only" })
    ])
  ]);
  const prompt = buildEnglishWordNetAtomSensePrompt([{ item, candidates: item.candidates }]);
  const inputRows = JSON.parse(prompt.split("\n").at(-1));
  const responseId = inputRows[0][0];
  assert.match(responseId, /^slot-[a-f0-9]{16}$/u);
  assert.equal(inputRows[0][1], "s");
  assert.doesNotMatch(prompt, /\[\["atom:htun:s"/u);
  assert.match(prompt, /Copy each response slot id exactly/u);

  const parsed = parseEnglishWordNetAtomSenseResponse(JSON.stringify({
    decisions: [{
      id: responseId,
      status: "select",
      source: "s:00000001-s",
      rationale: "The supplied satellite definition matches the English label."
    }]
  }), [{ item, candidates: item.candidates }]);
  assert.equal(parsed.valid, true);
  assert.equal(parsed.decisions[0].id, "atom:htun:s");
  assert.equal(parsed.decisions[0].targetId, "atom:htun:s");

  const repeatedPos = parseEnglishWordNetAtomSenseResponse(JSON.stringify({
    decisions: [{
      id: `${responseId}:s`,
      status: "select",
      source: "s:00000001-s",
      rationale: "The response appended a second POS marker."
    }]
  }), [{ item, candidates: item.candidates }]);
  assert.equal(repeatedPos.valid, false);
  assert.match(repeatedPos.reason, /unknown atom id/u);
});

test("atom worklist rejects alias-only senses and allows only recorded lemma mappings", () => {
  const rows = buildEnglishWordNetAtomSenseWorklist([
    atom("atom:kyan", "kyan", ["how"], 10, [
      candidate("v:00000001-v", "talk profusely", { lemma: "yak" })
    ]),
    atom("atom:mrat", "mrat", ["mixed"], 20, [
      candidate("v:00000002-v", "combine elements", { lemma: "mix" })
    ])
  ], {
    lemmaEntries: [{
      surface: "mixed", lemma: "mix", canonicalEnglish: "mixed", kind: "inflectional", status: "accepted-curated"
    }],
    resolveTarget: (word) => word === "mixed" ? { pyashSequence: ["mrat"] } : null
  });
  assert.equal(rows.find((row) => row.pyac === "kyan").candidates.length, 0);
  assert.equal(rows.find((row) => row.pyac === "kyan").excludedCandidates[0].matchedLemmas[0], "yak");
  assert.deepEqual(rows.find((row) => row.pyac === "mrat").lemmaMappings, [
    { surface: "mixed", lemma: "mix", kind: "inflectional" }
  ]);
  assert.equal(rows.find((row) => row.pyac === "mrat").candidates[0].source, "v:00000002-v");
});

test("atom worklist filtering selects only newly exposed ids and rejects unknown ids", () => {
  const worklist = [
    { id: "atom:hcat", pyac: "hcat" },
    { id: "atom:hbat", pyac: "hbat" },
    { id: "atom:hfish", pyac: "hfish" }
  ];
  assert.deepEqual(filterEnglishWordNetAtomSenseWorklist(worklist, ["atom:hbat", "atom:hfish"]), [
    { id: "atom:hbat", pyac: "hbat" },
    { id: "atom:hfish", pyac: "hfish" }
  ]);
  assert.throws(
    () => filterEnglishWordNetAtomSenseWorklist(worklist, ["atom:missing"]),
    /unknown atom id/u
  );
});

test("atom sense response accepts only supplied ids and complete unique decisions", () => {
  const worklist = buildEnglishWordNetAtomSenseWorklist([
    atom("atom:hban", "hban", ["bank"], 1, [candidate("n:00000001-n", "a financial institution", { lemma: "bank" })])
  ]);
  const items = [{ item: worklist[0], candidates: worklist[0].candidates }];
  const valid = `Model result:\n\`\`\`json\n${responseFor(buildEnglishWordNetAtomSensePrompt(items))}\n\`\`\``;
  assert.equal(parseEnglishWordNetAtomSenseResponse(valid, items).valid, true);
  assert.equal(parseEnglishWordNetAtomSenseResponse(JSON.stringify({ response: valid }), items).valid, true);
  const envelope = JSON.stringify({ response: responseFor(buildEnglishWordNetAtomSensePrompt(items)), context: Array(5000).fill(12) });
  assert.equal(parseEnglishWordNetAtomSenseResponse(envelope, items).valid, true);
  assert.equal(parseEnglishWordNetAtomSenseResponse("answer: {broken json}", items).valid, false);
  assert.equal(parseEnglishWordNetAtomSenseResponse("x".repeat(1_000_001), items).reason, "provider envelope exceeds the bounded character limit");
  assert.equal(parseEnglishWordNetAtomSenseResponse('{"decisions":[]}', items).reason, "response omitted one or more atom ids");
  assert.equal(parseEnglishWordNetAtomSenseResponse(JSON.stringify({ decisions: [{
    id: items[0].item.responseId, status: "select", source: "n:invented-n", rationale: "invented"
  }] }), items).reason, "selected source is outside the supplied candidates");
});

test("atom sense sweep preserves valid choices when Qwen mislabels another atom id", async () => {
  const worklist = buildEnglishWordNetAtomSenseWorklist([
    atom("atom:hcat", "hcat", ["cat"], 1, [candidate("n:00000021-n", "a feline", { lemma: "cat" })]),
    atom("atom:hbat", "hbat", ["bat"], 2, [candidate("n:00000022-n", "a flying mammal", { lemma: "bat" })])
  ]);
  const artifactDirectory = await mkdtemp(join(tmpdir(), "pyash-atom-sense-partial-"));
  let attempt = 0;
  try {
    const result = await runEnglishWordNetAtomSenseSweep({
      worklist,
      sourceHash: "source-partial",
      coverageHash: "coverage-partial",
      model: "qwen3.5:9b",
      artifactDirectory,
      config: { "batch-max-items": 24, "batch-max-chars": 3000, "max-output-tokens": 512, "max-attempts": 2, parallelism: 1 },
      submit: async ({ handleId }) => ({ handleId }),
      awaitHandle: async () => {
        attempt += 1;
        return JSON.stringify({ decisions: [
          { id: worklist[0].responseId, status: "select", source: "n:00000021-n", rationale: "The supplied feline definition matches cat." },
          { id: "atom:invented", status: "select", source: "n:00000022-n", rationale: "The supplied mammal definition matches bat." }
        ] });
      }
    });
    assert.equal(attempt, 2);
    assert.equal(result.selected, 1);
    assert.equal(result.uncertain, 1);
    assert.equal(result.records.find((row) => row.id === "atom:hcat:n").source, "n:00000021-n");
    assert.match(result.records.find((row) => row.id === "atom:hbat:n").rationale, /unknown atom id/u);
  } finally {
    await rm(artifactDirectory, { recursive: true, force: true });
  }
});

test("atom sense sweep merges valid decisions across bounded retries", async () => {
  const worklist = buildEnglishWordNetAtomSenseWorklist([
    atom("atom:hcat", "hcat", ["cat"], 1, [candidate("n:00000031-n", "a feline", { lemma: "cat" })]),
    atom("atom:hbat", "hbat", ["bat"], 2, [candidate("n:00000032-n", "a flying mammal", { lemma: "bat" })])
  ]);
  const artifactDirectory = await mkdtemp(join(tmpdir(), "pyash-atom-sense-merge-"));
  const replies = [
    JSON.stringify({ decisions: [
      { id: worklist[0].responseId, status: "select", source: "n:00000031-n", rationale: "The supplied feline definition matches cat." },
      { id: "atom:unknown", status: "uncertain", source: null, rationale: "Unexpected row." }
    ] }),
    JSON.stringify({ decisions: [
      { id: worklist[1].responseId, status: "select", source: "n:00000032-n", rationale: "The supplied mammal definition matches bat." },
      { id: "atom:unknown", status: "uncertain", source: null, rationale: "Unexpected row." }
    ] })
  ];
  try {
    const result = await runEnglishWordNetAtomSenseSweep({
      worklist,
      sourceHash: "source-merge",
      coverageHash: "coverage-merge",
      model: "qwen3.5:9b",
      artifactDirectory,
      config: { "batch-max-items": 24, "batch-max-chars": 3000, "max-output-tokens": 512, "max-attempts": 2, parallelism: 1 },
      submit: async ({ handleId }) => ({ handleId }),
      awaitHandle: async () => replies.shift()
    });
    assert.equal(result.status, "complete");
    assert.equal(result.selected, 2);
    assert.deepEqual(result.records.map((row) => row.source), ["n:00000031-n", "n:00000032-n"]);
  } finally {
    await rm(artifactDirectory, { recursive: true, force: true });
  }
});

test("atom sense batch artifact round-trips Pyash-quoted prompt, response, and checkpoint identities", () => {
  const source = renderEnglishWordNetAtomSenseBatchPya({
    runId: "wordnet-atom-sense-fixture",
    sourceHash: "source-hash",
    coverageHash: "coverage-hash",
    candidateHash: "candidate-hash",
    batchIndex: 1,
    model: "qwen3.5:9b",
    prompt: "choose one\nfrom these",
    records: [{ id: "atom:hban", status: "uncertain", source: "", rationale: "tie" }],
    attempts: [{ attempt: 1, handleId: "handle-1", response: "noisy {json}" }]
  });
  const parsed = parseEnglishWordNetAtomSenseBatchPya(source);
  assert.equal(parsed.runId, "wordnet-atom-sense-fixture");
  assert.equal(parsed.prompt, "choose one\nfrom these");
  assert.equal(parsed.records[0].id, "atom:hban");
  assert.equal(parsed.attempts[0].response, "noisy {json}");
});

test("selected atom senses append through the shared bridge renderer and pass target validation", () => {
  const base = renderEnglishWordNetSenseLinksPya({ records: [], source: "fixture" });
  const decision = {
    id: "atom:hban:n",
    targetId: "atom:hban:n",
    partOfSpeech: "n",
    pyac: "hban",
    labels: ["bank"],
    status: "select",
    source: "n:00000001-n",
    candidate: {
      source: "n:00000001-n", pos: "n", lemmas: ["bank"],
      definition: "a financial institution", matchedLemmas: ["bank"]
    },
    rationale: "Definition matches bank."
  };
  const appended = appendEnglishWordNetAtomSenseLinks({
    catalogSource: base,
    decisions: [decision],
    model: "qwen3.5:9b",
    runId: "fixture-run",
    resolveTarget: (word) => word === "bank"
      ? { coverageType: "atomic", canonicalEnglish: "bank", pyashSequence: ["hban"] }
      : null
  });
  assert.deepEqual(appended.added, ["n:00000001-n"]);
  assert.deepEqual(appended.withheld, []);
  assert.match(appended.catalogSource, /atom-target sense selection; model qwen3\.5:9b/u);
});

test("one atom can accept separate noun and verb senses in one activation", () => {
  const base = renderEnglishWordNetSenseLinksPya({ records: [], source: "fixture" });
  const slot = (pos, source) => ({
    id: `atom:cyuk:${pos}`,
    targetId: `atom:cyuk:${pos}`,
    pyac: "cyuk",
    labels: ["draw"],
    partOfSpeech: pos,
    status: "select",
    source,
    candidate: {
      source,
      pos,
      lemmas: ["draw"],
      definition: pos === "n" ? "make a picture with a pencil" : "produce a picture",
      matchedLemmas: ["draw"]
    },
    rationale: `The supplied ${pos} definition fits draw.`
  });
  const appended = appendEnglishWordNetAtomSenseLinks({
    catalogSource: base,
    decisions: [slot("n", "n:00000051-n"), slot("v", "v:00000052-v")],
    model: "qwen3.5:9b",
    runId: "fixture-run",
    resolveTarget: (word) => word === "draw"
      ? { coverageType: "atomic", canonicalEnglish: "draw", pyashSequence: ["cyuk"] }
      : null
  });

  assert.deepEqual(appended.added, ["n:00000051-n", "v:00000052-v"]);
  assert.deepEqual(appended.withheld, []);
  const links = parseEnglishWordNetBridgeCatalog(appended.catalogSource).entries;
  assert.deepEqual(links.map((link) => [link.source, link.targetPartOfSpeech]), [
    ["n:00000051-n", "n"],
    ["v:00000052-v", "v"]
  ]);
});

test("atom sense activation withholds a selection that collides with an active atom sense", () => {
  const base = renderEnglishWordNetSenseLinksPya({
    source: "fixture",
    records: [{
      source: "n:00000002-n",
      pos: "n",
      gloss: "a financial institution",
      lemmas: ["bank"],
      status: "accepted-deterministic",
      link: {
        target: "bank",
        pyashSequence: ["hban"],
        targetPartOfSpeech: "n",
        evidence: "curated active bridge"
      }
    }]
  });
  const appended = appendEnglishWordNetAtomSenseLinks({
    catalogSource: base,
    decisions: [{
      id: "atom:hban:n",
      targetId: "atom:hban:n",
      partOfSpeech: "n",
      pyac: "hban",
      labels: ["bank"],
      status: "select",
      source: "n:00000001-n",
      candidate: {
        source: "n:00000001-n", pos: "n", lemmas: ["bank"],
        definition: "the land alongside a river", matchedLemmas: ["bank"]
      },
      rationale: "The selected definition matches the supplied candidate."
    }],
    model: "qwen3.5:9b",
    runId: "fixture-run",
    resolveTarget: (word) => word === "bank"
      ? { coverageType: "atomic", canonicalEnglish: "bank", pyashSequence: ["hban"] }
      : null
  });
  assert.deepEqual(appended.added, []);
  assert.deepEqual(appended.withheld, [{
    source: "n:00000001-n",
    target: "bank",
    reason: "target-already-linked-or-ambiguous",
    conflictingSources: ["n:00000002-n"]
  }]);
  assert.equal(appended.catalogSource, base);
});

test("atom sense sweep checkpoints batches, resumes, and retries malformed output once", async () => {
  const worklist = buildEnglishWordNetAtomSenseWorklist([
    atom("atom:hcat", "hcat", ["cat"], 1, [candidate("n:00000001-n", "a feline", { lemma: "cat" })]),
    atom("atom:hbat", "hbat", ["bat"], 2, [candidate("n:00000002-n", "a flying mammal", { lemma: "bat" })])
  ]);
  const artifactDirectory = await mkdtemp(join(tmpdir(), "pyash-atom-sense-"));
  const submissions = [];
  const responses = [];
  const config = { "batch-max-items": 1, "batch-max-chars": 3000, "max-output-tokens": 512, "max-attempts": 2 };
  const submit = async (request) => {
    submissions.push(request);
    return { handleId: request.handleId };
  };
  const awaitHandle = async (handleId) => {
    const response = responses.shift();
    return typeof response === "function" ? response(submissions.at(-1).prompt) : response ?? responseFor(submissions.at(-1).prompt);
  };
  try {
    responses.push("not json", (prompt) => responseFor(prompt));
    const pilot = await runEnglishWordNetAtomSenseSweep({
      worklist,
      sourceHash: "source",
      coverageHash: "coverage",
      model: "qwen3.5:9b",
      artifactDirectory,
      config,
      submit,
      awaitHandle,
      maxBatches: 1
    });
    assert.equal(pilot.status, "paused");
    assert.equal(pilot.completedCount, 1);
    assert.equal(submissions.length, 2);

    const resumed = await runEnglishWordNetAtomSenseSweep({
      worklist,
      sourceHash: "source",
      coverageHash: "coverage",
      model: "qwen3.5:9b",
      artifactDirectory,
      config,
      submit,
      awaitHandle
    });
    assert.equal(resumed.status, "complete");
    assert.equal(resumed.resumedCount, 1);
    assert.equal(resumed.selected, 2);
    assert.equal(submissions.length, 3);
    const files = (await readdir(artifactDirectory)).filter((name) => /^batch-[0-9]{5}\.pya$/u.test(name));
    assert.equal(files.length, 2);
    const first = parseEnglishWordNetAtomSenseBatchPya(await readFile(join(artifactDirectory, files[0]), "utf8"));
    assert.equal(first.attempts.length, 2);
    assert.ok(first.attempts[0].response.includes("not json"));
  } finally {
    await rm(artifactDirectory, { recursive: true, force: true });
  }
});

test("atom sense sweep dispatches a bounded parallel wave and checkpoints in stable order", async () => {
  const worklist = buildEnglishWordNetAtomSenseWorklist([
    atom("atom:hcat", "hcat", ["cat"], 1, [candidate("n:00000011-n", "a feline", { lemma: "cat" })]),
    atom("atom:hbat", "hbat", ["bat"], 2, [candidate("n:00000012-n", "a flying mammal", { lemma: "bat" })]),
    atom("atom:hfox", "hfox", ["fox"], 3, [candidate("n:00000013-n", "a wild canine", { lemma: "fox" })]),
    atom("atom:hdog", "hdog", ["dog"], 4, [candidate("n:00000014-n", "a domesticated canine", { lemma: "dog" })])
  ]);
  const artifactDirectory = await mkdtemp(join(tmpdir(), "pyash-atom-sense-parallel-"));
  const submissions = [];
  const awaitOrder = [];
  let firstWaveSize = 0;
  const config = {
    "batch-max-items": 1,
    "batch-max-chars": 3000,
    "max-output-tokens": 512,
    "max-attempts": 2,
    parallelism: 2
  };
  try {
    const result = await runEnglishWordNetAtomSenseSweep({
      worklist,
      sourceHash: "source-parallel",
      coverageHash: "coverage-parallel",
      model: "qwen3.5:9b",
      artifactDirectory,
      config,
      submit: async (request) => {
        submissions.push(request);
        return { handleId: request.handleId };
      },
      awaitHandle: async (handleId) => {
        if (awaitOrder.length === 0) firstWaveSize = submissions.length;
        awaitOrder.push(handleId);
        const request = submissions.find((row) => row.handleId === handleId);
        return responseFor(request.prompt);
      }
    });

    assert.equal(result.status, "complete");
    assert.equal(result.selected, 4);
    assert.equal(submissions.length, 4);
    assert.equal(firstWaveSize, 2, "the entire dispatch wave is submitted before waiting on Housekeeper");
    assert.equal(awaitOrder.length, 4);
    const files = (await readdir(artifactDirectory)).filter((name) => /^batch-[0-9]{5}\.pya$/u.test(name));
    assert.deepEqual(files, ["batch-00001.pya", "batch-00002.pya", "batch-00003.pya", "batch-00004.pya"]);
    const records = await Promise.all(files.map(async (filename) => parseEnglishWordNetAtomSenseBatchPya(
      await readFile(join(artifactDirectory, filename), "utf8")
    )));
    assert.deepEqual(records.map((batch) => batch.records[0].id), worklist.map((item) => item.id));
  } finally {
    await rm(artifactDirectory, { recursive: true, force: true });
  }
});

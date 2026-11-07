import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { getExchangeRunId, getExchangeStrict } from "../program/bridge/exchange.mjs";
import { parse } from "../program/understand/index.mjs";
import { recordMindJson } from "../program/verbs/mind/logging.mjs";
import {
  createQueuedMindSenseCompoundChoiceTransport,
  createQueuedMindWordNetSenseTranslationTransport
} from "../program/library/translation/english_wordnet_sense_compounds.mjs";
import {
  runWordNetSenseCompoundRefineryCommand,
  runWordNetSenseCompoundRefinerySweepCommand
} from "../command/wordnet_sense_compound_refinery.mjs";

test("direct sense compound runs save mind prompts and responses as linked artifacts", async () => {
  const repositoryRoot = await mkdtemp(path.join(os.tmpdir(), "pyash-sense-newspaper-"));
  const artifactRoot = path.join(repositoryRoot, "artifacts");
  const runId = "sense-compound-newspaper-test";
  const oldFixture = process.env.PYA_MIND_RESPONSE;
  delete process.env.PYA_MIND_RESPONSE;

  try {
    await runWordNetSenseCompoundRefineryCommand({
      repositoryRoot,
      artifactRoot,
      runId,
      report: () => {},
      dependencies: {
        prepareAllocation: async () => ({ sourceHash: "test-source" }),
        runRefinery: async ({ onEvoke, onStage, onCheckpoint }) => {
          onEvoke({ mood: "do", be: "mind", su: { name: "mind" } });
          recordMindJson({
            targetName: "qwen",
            label: "request",
            payload: { model: "test-model", messages: [{ role: "user", content: "Choose the matching sense." }] }
          });
          recordMindJson({
            targetName: "qwen",
            label: "response",
            payload: { response: "{\"choice\":\"sense-a\"}", model: "test-model" }
          });
          const interpret = async line => {
            if (String(line).includes("start future")) return { mood: "ya", ob: { text: "queued" } };
            return {
              mood: "ya",
              ob: { text: "success" },
              result: { text: String(line).includes("translation-handle") ? "translation answer" : "{\"atoms\":[\"friend\",\"relationship\"]}", metadata: { host: "test-host" } }
            };
          };
          const translate = createQueuedMindWordNetSenseTranslationTransport({ interpret, parse: value => value, model: "test-model" });
          const queued = await translate.submit({
            sense: { senseId: "n:test-sense", pos: "n", lemma: "friendship", gloss: "a close relation of friends" },
            languages: ["chinese"],
            handleId: "translation-handle"
          });
          await translate.await(queued.handleId);
          const choose = createQueuedMindSenseCompoundChoiceTransport({ interpret, parse: value => value, model: "test-model" });
          await choose({
            input: { prompt: "Choose two or more atoms for this exact sense.", responseFormat: { type: "object" } },
            handleId: "choice-handle"
          });
          const stageResult = { mood: "ya", be: "map", su: { name: "sense result" }, ob: { map: {} } };
          onStage(stageResult);
          onCheckpoint({
            mood: "ya",
            be: "checkpoint",
            su: { name: "stage" },
            ob: { text: "stable-stage-hash" },
            fromtext: { text: "checkpoint payload" }
          });
          return {
            runId,
            artifactDirectory: path.join(artifactRoot, runId),
            selectedSenseCount: 1,
            remainingSenseCount: 0,
            candidateCount: 0,
            result: {}
          };
        }
      }
    });

    const newspaper = await readFile(path.join(repositoryRoot, "newspaper", `${runId}.pya`), "utf8");
    assert.match(newspaper, /be evoke/u);
    assert.match(newspaper, /be checkpoint/u);
    assert.equal((newspaper.match(/be artifact/gu) ?? []).length, 6);
    assert.match(newspaper, /qwen-1-request-[a-f0-9]{64}\.json/u);
    assert.match(newspaper, /qwen-2-response-[a-f0-9]{64}\.json/u);

    const evidenceDirectory = path.join(artifactRoot, runId, "mind");
    const files = await readdir(evidenceDirectory);
    assert.equal(files.length, 6);
    const artifactEvents = newspaper.split("\n").filter(line => line.includes("be artifact")).map(parse);
    assert.equal(artifactEvents.length, 6);
    assert.ok(artifactEvents.every(event => event.ob?.name === "evoke-0"));
    const payloads = await Promise.all(files.map(async filename => JSON.parse(
      await readFile(path.join(evidenceDirectory, filename), "utf8")
    )));
    assert.ok(payloads.some(payload => payload.messages?.[0]?.content === "Choose the matching sense."));
    assert.ok(payloads.some(payload => payload.response === "{\"choice\":\"sense-a\"}"));
    assert.ok(payloads.some(payload => payload.job?.prompt?.includes("a close relation of friends")));
    assert.ok(payloads.some(payload => payload.job?.prompt === "Choose two or more atoms for this exact sense."));
    assert.ok(payloads.some(payload => payload.result?.text === "translation answer"));
    assert.ok(payloads.some(payload => payload.result?.text === "{\"atoms\":[\"friend\",\"relationship\"]}"));
    assert.equal(getExchangeStrict(), false);
    assert.equal(getExchangeRunId(), null);

    await assert.rejects(runWordNetSenseCompoundRefineryCommand({
      repositoryRoot,
      artifactRoot,
      runId: `${runId}-failure`,
      report: () => {},
      dependencies: {
        prepareAllocation: async () => ({ sourceHash: "test-source" }),
        runRefinery: async ({ onEvoke }) => {
          onEvoke({ mood: "do", be: "mind", su: { name: "mind" } });
          recordMindJson({ targetName: "qwen", label: "request", payload: { prompt: "failure cleanup" } });
          throw new Error("expected refinery failure");
        }
      }
    }), /expected refinery failure/u);
    assert.equal(getExchangeStrict(), false);
    assert.equal(getExchangeRunId(), null);
  } finally {
    if (oldFixture === undefined) delete process.env.PYA_MIND_RESPONSE;
    else process.env.PYA_MIND_RESPONSE = oldFixture;
    await rm(repositoryRoot, { recursive: true, force: true });
  }
});

test("resumed sense compound runs continue newspaper evoke identities", async () => {
  const repositoryRoot = await mkdtemp(path.join(os.tmpdir(), "pyash-sense-resume-newspaper-"));
  const artifactRoot = path.join(repositoryRoot, "artifacts");
  const runId = "sense-compound-resume-newspaper-test";
  const oldFixture = process.env.PYA_MIND_RESPONSE;
  delete process.env.PYA_MIND_RESPONSE;

  try {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await runWordNetSenseCompoundRefineryCommand({
        repositoryRoot,
        artifactRoot,
        runId,
        report: () => {},
        dependencies: {
          prepareAllocation: async () => ({ sourceHash: "test-source" }),
          runRefinery: async ({ onEvoke }) => {
            onEvoke({ mood: "do", be: "mind", su: { name: "mind" } });
            return {
              runId,
              artifactDirectory: path.join(artifactRoot, runId),
              selectedSenseCount: 1,
              remainingSenseCount: 0,
              candidateCount: 0,
              result: {}
            };
          }
        }
      });
    }

    const newspaper = await readFile(path.join(repositoryRoot, "newspaper", `${runId}.pya`), "utf8");
    const evokeIds = [...newspaper.matchAll(/(?:^|\s)su name evoke-(\d+)(?=\s)/gu)].map(match => match[1]);
    assert.deepEqual(evokeIds, ["0", "1"]);
  } finally {
    if (oldFixture === undefined) delete process.env.PYA_MIND_RESPONSE;
    else process.env.PYA_MIND_RESPONSE = oldFixture;
    await rm(repositoryRoot, { recursive: true, force: true });
  }
});

test("compound sweep continues across inventory rechecks until the backlog completes", async () => {
  const repositoryRoot = await mkdtemp(path.join(os.tmpdir(), "pyash-sense-sweep-"));
  const oldFixture = process.env.PYA_MIND_RESPONSE;
  delete process.env.PYA_MIND_RESPONSE;
  const remainingCounts = [10, 15, 0];
  const signatures = ["before", "after-one", "after-one", "after-two", "after-two"];
  let chunks = 0;
  let allocationReads = 0;

  try {
    const result = await runWordNetSenseCompoundRefinerySweepCommand({
      repositoryRoot,
      artifactRoot: path.join(repositoryRoot, "artifacts"),
      runId: "sense-compound-sweep-test",
      report: () => {},
      dependencies: {
        prepareAllocation: async () => ({ sourceHash: `test-source-${++allocationReads}` }),
        progressSignature: async () => signatures.shift(),
        runChunk: async () => {
          const remainingSenseCount = remainingCounts[chunks];
          chunks += 1;
          return {
            selectedSenseCount: remainingSenseCount === 0 ? 0 : 64,
            remainingSenseCount,
            candidateCount: 0,
            translationFailureCount: 0,
            result: { "promoted-sense-count": remainingSenseCount === 15 ? 2 : 0 }
          };
        }
      }
    });

    assert.equal(result.sweepComplete, true);
    assert.equal(result.batchCount, 3);
    assert.equal(chunks, 3);
    assert.equal(allocationReads, 3);
  } finally {
    if (oldFixture === undefined) delete process.env.PYA_MIND_RESPONSE;
    else process.env.PYA_MIND_RESPONSE = oldFixture;
    await rm(repositoryRoot, { recursive: true, force: true });
  }
});

test("compound sweep fails clearly when a bounded chunk makes no durable progress", async () => {
  const repositoryRoot = await mkdtemp(path.join(os.tmpdir(), "pyash-sense-sweep-stall-"));
  const oldFixture = process.env.PYA_MIND_RESPONSE;
  delete process.env.PYA_MIND_RESPONSE;

  try {
    await assert.rejects(runWordNetSenseCompoundRefinerySweepCommand({
      repositoryRoot,
      artifactRoot: path.join(repositoryRoot, "artifacts"),
      runId: "sense-compound-sweep-stall-test",
      report: () => {},
      dependencies: {
        prepareAllocation: async () => ({ sourceHash: "test-source" }),
        progressSignature: async () => "unchanged",
        runChunk: async () => ({
          selectedSenseCount: 1,
          remainingSenseCount: 1,
          candidateCount: 0,
          translationFailureCount: 1,
          result: {}
        })
      }
    }), /made no durable progress/u);
  } finally {
    if (oldFixture === undefined) delete process.env.PYA_MIND_RESPONSE;
    else process.env.PYA_MIND_RESPONSE = oldFixture;
    await rm(repositoryRoot, { recursive: true, force: true });
  }
});

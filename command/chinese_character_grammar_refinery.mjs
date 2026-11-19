#!/usr/bin/env node

import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { doRemember, forget, remember } from "../program/remember/index.mjs";
import { builtInSignatures } from "../program/verbs/index.mjs";
import { registerSignatureHandler, clearSignatureHandlers } from "../program/bridge/signature.mjs";
import { getRefinery, runRefinery } from "../program/bridge/refinery.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { resolveConfigText } from "../program/configure/env.mjs";
import { createGpuHousekeeperAdapter } from "../program/runtime/gpu/housekeeper_adapter.mjs";
import { buildProgram } from "../program/program.mjs";
import { loadDefaultConfig } from "./run_pya_helpers.mjs";
import {
  CHINESE_CHARACTER_ATOM_MATCH_RESPONSE_FORMAT,
  parseChineseCharacterAtomCheckpointPya,
  renderChineseCharacterAtomCheckpointPya
} from "../program/library/translation/chinese_character_atom_refinery.mjs";
import { parseEnglishGrammarCatalog } from "../program/library/translation/english_grammar.mjs";
import {
  CHINESE_CHARACTER_GRAMMAR_REFINERY_CONFIG_URL,
  CHINESE_CHARACTER_GRAMMAR_REFINERY_NAME,
  buildChineseCharacterGrammarReviewPrompt,
  buildChineseCharacterGrammarWorklist,
  highConfidenceChineseCharacterGrammarLinks,
  loadChineseCharacterGrammarRefineryInputs,
  parseChineseCharacterGrammarReviewResponse,
  renderChineseCharacterGrammarReviewPya,
  createChineseCharacterGrammarLinkSource
} from "../program/library/translation/chinese_character_grammar_refinery.mjs";
import { createDefaultQueuedMindTranslationVocabularySubmitter } from "../program/library/translation/translation_vocabulary_queue.mjs";
import { awaitTranslationGpuDuty } from "../program/library/translation/translation_to_vliw_job.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ARTIFACT_ROOT = path.join(ROOT, "artifacts", "chinese-character-grammar-refinery");
const ENGLISH_GRAMMAR_PATH = fileURLToPath(new URL("../program/library/translation/english_grammar.pya", import.meta.url));

function sha256(value) {
  return createHash("sha256").update(String(value ?? "")).digest("hex");
}

function normalizeEnglish(value) {
  return String(value ?? "").normalize("NFC").trim().toLowerCase()
    .replace(/[_-]+/gu, " ")
    .replace(/[^\p{L}\p{N}\s']/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function readConfig(source) {
  const values = new Map();
  for (const sentence of buildProgram(source).sentences) {
    if (sentence?.mood !== "ya" || typeof sentence.su?.text !== "string") continue;
    if (typeof sentence.ob?.text === "string") values.set(sentence.su.text, sentence.ob.text);
    else if (Number.isSafeInteger(sentence.ob?.num)) values.set(sentence.su.text, sentence.ob.num);
  }
  return {
    model: String(values.get("model") ?? "").trim(),
    promptRevision: String(values.get("prompt-revision") ?? "").trim(),
    generationLimit: Math.max(1, Math.min(512, Math.trunc(Number(values.get("generation-limit") ?? 64)))),
    dutiesPerPass: Math.max(0, Math.min(64, Math.trunc(Number(values.get("housekeeper-duties-per-pass") ?? 64)))),
    parallelism: Math.max(1, Math.trunc(Number(values.get("housekeeper-parallelism") ?? 4))),
    maxOutputTokens: Math.max(256, Math.trunc(Number(values.get("max-output-tokens") ?? 2048)))
  };
}

function queueCounts(queue) {
  const rows = Array.isArray(queue?.jobs) ? queue.jobs : Array.isArray(queue?.items) ? queue.items : [];
  return {
    queued: Number(queue?.queueDepth ?? queue?.depth ?? rows.length) || 0,
    running: Number(queue?.runningCount ?? queue?.activeCount ?? queue?.runningJobs?.length ?? 0) || 0
  };
}

function modelName(row) {
  return String(typeof row === "string" ? row : row?.name ?? row?.model ?? "").trim();
}

function taskKey(record, promptRevision) {
  const fingerprint = sha256(JSON.stringify({
    character: record.character,
    targets: record.grammarTargets.map((target) => target.id),
    sources: record.sources,
    promptRevision
  })).slice(0, 16);
  return `${record.id}:grammar-match:${fingerprint}`;
}

function taskHandle(runId, key) {
  return `chinese-character-grammar-${runId.slice(-12)}-${sha256(key).slice(0, 16)}`;
}

export function nextChineseGrammarDutyWave(pending, cursor, { parallelism = 1, dutiesRemaining = 0 } = {}) {
  const dutyCapacity = Math.max(0, Math.trunc(Number(dutiesRemaining) || 0));
  const waveCapacity = Math.min(Math.max(1, Math.trunc(Number(parallelism) || 1)), dutyCapacity);
  return pending.slice(cursor, cursor + waveCapacity);
}

export function buildChineseCharacterGrammarMatchTasks(records, checkpointTasks, promptRevision) {
  return records.map((record) => {
    const key = taskKey(record, promptRevision);
    if (checkpointTasks.get(key)?.result) return null;
    return {
      key,
      recordId: record.id,
      kind: "grammar-match",
      record,
      prompt: buildChineseCharacterGrammarReviewPrompt(record)
    };
  }).filter(Boolean);
}

function outputHandle(sentence) {
  const name = String(sentence?.to?.name ?? "").trim();
  if (!name) throw new Error("Chinese grammar character stage requires a named map output");
  return name;
}

function mapValue(name) {
  return remember(name)?.ob?.map ?? {};
}

function mapFact(name, map, filename = "") {
  return {
    mood: "ya",
    su: { name },
    be: "map",
    ob: { map, ...(filename ? { filename } : {}) }
  };
}

async function atomicWrite(filename, contents) {
  await fs.mkdir(path.dirname(filename), { recursive: true });
  const temporary = `${filename}.${process.pid}.tmp`;
  await fs.writeFile(temporary, contents, "utf8");
  await fs.rename(temporary, filename);
}

async function initializePyashRuntime() {
  forget();
  clearSignatureHandlers();
  for (const signature of builtInSignatures) registerSignatureHandler(signature);
  await loadDefaultConfig({ cwd: ROOT, interpretFn: interpret, entryPath: ROOT });
}

async function createHousekeeperSubmitter(config) {
  if (process.env.PYA_MIND_RESPONSE) {
    throw new Error("Chinese grammar character refinery requires PYA_MIND_RESPONSE to be unset");
  }
  const housekeeperUrl = String(
    process.env.PYA_GPU_HOUSEKEEPER_URL
      ?? resolveConfigText("gpu housekeeper url", { rememberFn: remember })
      ?? ""
  ).trim();
  if (!housekeeperUrl) throw new Error("Chinese grammar character refinery requires the configured GPU Housekeeper URL");
  const housekeeper = createGpuHousekeeperAdapter({ baseUrl: housekeeperUrl });
  process.stderr.write(`[chinese-character-grammar] checking Housekeeper ${new URL(housekeeperUrl).host}\n`);
  const [queue, availableModels] = await Promise.all([housekeeper.getQueue(), housekeeper.getOllamaModels()]);
  const models = Array.isArray(availableModels) ? availableModels : availableModels?.models ?? [];
  if (!models.map(modelName).includes(config.model)) {
    throw new Error(`configured Housekeeper does not advertise model ${config.model}`);
  }
  return {
    submit: await createDefaultQueuedMindTranslationVocabularySubmitter({
      model: config.model,
      maxOutputTokens: config.maxOutputTokens
    }),
    queue: queueCounts(queue),
    housekeeperHost: new URL(housekeeperUrl).host
  };
}

function responseFor(task, response) {
  try {
    return parseChineseCharacterGrammarReviewResponse(response, task.record);
  } catch (error) {
    return {
      verdict: "uncertain",
      confidence: "low",
      matches: [],
      rationale: "Housekeeper response did not meet the grammar-link review contract.",
      responseError: String(error?.message ?? error).slice(0, 500),
      rawResponse: String(response ?? "").slice(0, 2000)
    };
  }
}

async function persistCheckpoint(context) {
  await atomicWrite(context.checkpointPath, renderChineseCharacterAtomCheckpointPya({
    runId: context.runId,
    sourceHash: context.inputs.sourceHash,
    tasks: [...context.checkpoint.tasks.values()]
  }));
}

async function dispatchTasks(tasks, context) {
  const pending = tasks.filter((task) => !context.checkpoint.tasks.get(task.key)?.result);
  process.stderr.write(`[chinese-character-grammar] ${pending.length} model duties pending\n`);
  let cursor = 0;
  while (cursor < pending.length && context.dutiesRemaining > 0) {
    const wave = nextChineseGrammarDutyWave(pending, cursor, context);
    if (wave.length === 0) throw new Error("Chinese grammar refinery duty wave made no progress");
    cursor += wave.length;
    context.housekeeper ??= await createHousekeeperSubmitter(context.config);
    const submissions = await Promise.allSettled(wave.map(async (task) => {
      const existing = context.checkpoint.tasks.get(task.key);
      const handleId = existing?.handleId ?? taskHandle(context.runId, task.key);
      if (existing?.status === "queued") return { task, handleId };
      const queued = await context.housekeeper.submit({
        handleId,
        prompt: task.prompt,
        responseFormat: CHINESE_CHARACTER_ATOM_MATCH_RESPONSE_FORMAT
      });
      if (String(queued?.status ?? queued?.ob?.text ?? "").trim().toLowerCase() !== "queued") {
        throw new Error(`Housekeeper did not queue ${task.key}: ${String(queued?.status ?? queued?.ob?.text ?? "unknown")}`);
      }
      return { task, handleId };
    }));
    const submissionErrors = [];
    const awaiting = [];
    for (const submission of submissions) {
      if (submission.status === "rejected") {
        submissionErrors.push(submission.reason);
        continue;
      }
      const { task, handleId } = submission.value;
      context.checkpoint.tasks.set(task.key, {
        ...task,
        record: undefined,
        handleId,
        status: "queued"
      });
      awaiting.push({ task, handleId });
    }
    await persistCheckpoint(context);
    if (submissionErrors.length > 0) throw submissionErrors[0];
    const completions = await Promise.allSettled(awaiting.map(async ({ task, handleId }) => ({
      task,
      handleId,
      result: responseFor(task, await awaitTranslationGpuDuty(handleId))
    })));
    const completionErrors = [];
    for (const completion of completions) {
      if (completion.status === "rejected") {
        completionErrors.push(completion.reason);
        continue;
      }
      const { task, handleId, result } = completion.value;
      context.checkpoint.tasks.set(task.key, {
        ...task,
        record: undefined,
        handleId,
        status: "completed",
        result
      });
    }
    context.dutiesRemaining -= wave.length;
    context.dutiesThisPass += wave.length;
    await persistCheckpoint(context);
    if (completionErrors.length > 0) throw completionErrors[0];
  }
}

async function ensureRefinery() {
  if (getRefinery(CHINESE_CHARACTER_GRAMMAR_REFINERY_NAME)) return;
  const source = await fs.readFile(CHINESE_CHARACTER_GRAMMAR_REFINERY_CONFIG_URL, "utf8");
  for (const sentence of buildProgram(source).sentences) await interpret(sentence);
  if (!getRefinery(CHINESE_CHARACTER_GRAMMAR_REFINERY_NAME)) {
    throw new Error(`Chinese character grammar refinery definition was not registered: ${CHINESE_CHARACTER_GRAMMAR_REFINERY_NAME}`);
  }
}

function currentTask(record, promptRevision, tasks) {
  return tasks.get(taskKey(record, promptRevision));
}

function attachDecisions(records, tasks, promptRevision) {
  return records.map((record) => {
    const task = currentTask(record, promptRevision, tasks);
    return task?.result ? { ...record, grammarMatch: task.result } : record;
  });
}

async function writeStageArtifact(context, filename, records) {
  const outputPath = path.join(context.artifactDirectory, filename);
  await atomicWrite(outputPath, renderChineseCharacterGrammarReviewPya(records, {
    sourceHash: context.inputs.sourceHash,
    sourceHashes: context.inputs.sourceHashes,
    runId: context.runId
  }));
  return outputPath;
}

async function runStage(sentence, context) {
  const stage = String(sentence?.su?.name ?? "").trim();
  const output = outputHandle(sentence);
  let result;
  let artifactPath;
  process.stderr.write(`[chinese-character-grammar] stage ${stage}\n`);
  if (stage === "build ranked grammar character worklist") {
    context.worklist = buildChineseCharacterGrammarWorklist(context.inputs);
    artifactPath = await writeStageArtifact(context, "worklist.pya", context.worklist);
    result = { sourceHash: context.inputs.sourceHash, count: context.worklist.length, records: context.worklist };
  } else if (stage === "prepare grammar target matches") {
    const worklist = mapValue("character worklist").records ?? context.worklist;
    const records = worklist.slice(0, context.config.generationLimit);
    const candidates = records.map((record) => ({
      id: record.id,
      character: record.character,
      classicalSeed: record.classicalSeed,
      sources: record.sources,
      frequency: record.frequency,
      grammarTargets: record.grammarTargets.map(({ id, pya, components, english, aliases }) => ({
        id, pya, components, english, aliases
      }))
    }));
    artifactPath = await writeStageArtifact(context, "grammar-match-candidates.pya", candidates);
    result = { sourceHash: context.inputs.sourceHash, count: candidates.length, records: candidates };
  } else if (stage === "review grammar target matches") {
    const worklist = mapValue("character worklist").records ?? context.worklist;
    const candidates = mapValue("grammar match candidates").records ?? [];
    const candidateById = new Map(candidates.map((record) => [record.id, record]));
    const records = worklist.slice(0, context.config.generationLimit).map((record) => {
      const candidate = candidateById.get(record.id);
      if (!candidate) return record;
      return { ...record, grammarTargets: candidate.grammarTargets };
    }).filter((record) => record.grammarTargets.length > 0);
    const tasks = buildChineseCharacterGrammarMatchTasks(records, context.checkpoint.tasks, context.config.promptRevision);
    await dispatchTasks(tasks, context);
    const decisions = attachDecisions(records, context.checkpoint.tasks, context.config.promptRevision);
    artifactPath = await writeStageArtifact(context, "grammar-match-decisions.pya", decisions);
    result = { sourceHash: context.inputs.sourceHash, count: decisions.length, records: decisions };
  } else if (stage === "record grammar character links") {
    const decisions = mapValue("grammar match decisions").records ?? [];
    const expectedDecisionCount = (mapValue("character worklist").records ?? context.worklist)
      .slice(0, context.config.generationLimit)
      .filter((record) => record.grammarTargets.length > 0).length;
    const completedDecisionCount = decisions.filter((record) => record.grammarMatch).length;
    const assignmentComplete = completedDecisionCount === expectedDecisionCount;
    const promotedLinks = assignmentComplete
      ? highConfidenceChineseCharacterGrammarLinks(decisions, context.inputs.grammarCatalog.chineseCharacterLinks)
      : [];
    if (promotedLinks.length > 0) {
      const source = await fs.readFile(ENGLISH_GRAMMAR_PATH, "utf8");
      const updated = createChineseCharacterGrammarLinkSource(source, promotedLinks);
      if (updated !== source) await atomicWrite(ENGLISH_GRAMMAR_PATH, updated);
      context.inputs.grammarCatalog = parseEnglishGrammarCatalog(updated);
    }
    const assignmentByCharacter = new Map(promotedLinks.map((link) => [link.character, link]));
    const reviewed = decisions.map((record) => {
      const assignment = assignmentByCharacter.get(record.character);
      return {
        ...record,
        linkAssignment: assignment
          ? {
            status: "accepted",
            targetId: assignment.targetId,
            pya: assignment.pya,
            candidateRank: assignment.candidateRank,
            relevantUseFrequency: assignment.relevantUseFrequency
          }
          : {
            status: assignmentComplete ? "unassigned" : "pending",
            reason: assignmentComplete
              ? record.grammarMatch?.verdict === "select" && record.grammarMatch?.confidence === "high"
                ? "no-unique-atom-after-frequency-allocation"
                : "no-high-confidence-unmarked-target"
              : "waiting-for-all-character-reviews-before-global-allocation"
          },
        promotions: assignment
          ? [{ targetId: assignment.targetId, status: "accepted", confidence: "high" }]
          : []
      };
    });
    artifactPath = await writeStageArtifact(context, "review.pya", reviewed);
    const statusCounts = reviewed.reduce((counts, record) => {
      const status = record.linkAssignment.status === "accepted"
        ? "accepted"
        : record.linkAssignment.status === "pending"
          ? "pending"
          : record.grammarMatch?.verdict === "select"
            ? `select/${record.grammarMatch.confidence}/unassigned`
            : record.grammarMatch?.verdict ?? "unreviewed";
      counts[status] = (counts[status] ?? 0) + 1;
      return counts;
    }, {});
    result = {
      runId: context.runId,
      sourceHash: context.inputs.sourceHash,
      classicalSeedCount: context.inputs.classicalCandidates.characters.length,
      worklistCount: context.worklist.length,
      processedCount: completedDecisionCount,
      assignmentComplete,
      rootTargetCount: 0,
      promotedLinkCount: promotedLinks.length,
      acceptedGrammarLinksPath: ENGLISH_GRAMMAR_PATH,
      reviewPath: artifactPath,
      statusCounts,
      records: reviewed
    };
  } else {
    throw new Error(`unknown Chinese character grammar refinery stage: ${stage}`);
  }
  doRemember({
    mood: "ya",
    su: { name: output },
    be: "map",
    ob: { map: result, ...(artifactPath ? { filename: artifactPath } : {}) }
  });
  return remember(output);
}

export async function runChineseCharacterGrammarRefinery() {
  const configSource = await fs.readFile(CHINESE_CHARACTER_GRAMMAR_REFINERY_CONFIG_URL, "utf8");
  const config = readConfig(configSource);
  if (!config.model || !config.promptRevision) throw new Error("Chinese grammar character refinery config must name a model and prompt revision");
  if (process.env.PYA_MIND_RESPONSE) throw new Error("Chinese grammar character refinery requires PYA_MIND_RESPONSE to be unset");
  await initializePyashRuntime();
  const inputs = await loadChineseCharacterGrammarRefineryInputs();
  const configHash = sha256(JSON.stringify({
    model: config.model,
    promptRevision: config.promptRevision,
    maxOutputTokens: config.maxOutputTokens
  })).slice(0, 10);
  const runId = `chinese-character-grammar-${inputs.sourceHash.slice(0, 16)}-${config.promptRevision}-${configHash}`;
  const artifactDirectory = path.join(ARTIFACT_ROOT, runId);
  const checkpointPath = path.join(artifactDirectory, "checkpoint.pya");
  let checkpoint = { runId, sourceHash: inputs.sourceHash, tasks: new Map() };
  try {
    checkpoint = parseChineseCharacterAtomCheckpointPya(await fs.readFile(checkpointPath, "utf8"));
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  if (checkpoint.sourceHash && checkpoint.sourceHash !== inputs.sourceHash) {
    throw new Error(`checkpoint source hash mismatch at ${checkpointPath}`);
  }
  if (checkpoint.runId && checkpoint.runId !== runId) throw new Error(`checkpoint run id mismatch at ${checkpointPath}`);
  const context = {
    config,
    inputs,
    runId,
    artifactDirectory,
    checkpointPath,
    checkpoint,
    dutiesRemaining: config.dutiesPerPass,
    dutiesThisPass: 0,
    parallelism: config.parallelism,
    housekeeper: null,
    worklist: []
  };
  await ensureRefinery();
  const refineryResult = await runRefinery({
    name: CHINESE_CHARACTER_GRAMMAR_REFINERY_NAME,
    interpret: (sentence) => runStage(sentence, context),
    runId,
    checkpointEnabled: false
  });
  if (refineryResult?.mood === "ya" && refineryResult?.be === "error") {
    throw new Error(refineryResult.ob?.text || "Chinese character grammar refinery failed");
  }
  const review = remember("grammar character links")?.ob?.map;
  if (!review?.reviewPath) throw new Error("Chinese character grammar refinery completed without its review artifact");
  const records = review.records ?? [];
  const modelStatuses = records.reduce((counts, record) => {
    const status = record.promotions?.length > 0
      ? "accepted"
      : record.grammarMatch?.verdict
        ? `${record.grammarMatch.verdict}/${record.grammarMatch.confidence}`
        : "unreviewed";
    counts[status] = (counts[status] ?? 0) + 1;
    return counts;
  }, {});
  process.stdout.write([
    `source hash: ${inputs.sourceHash}`,
    `run id: ${runId}`,
    `Classical candidate characters: ${inputs.classicalCandidates.characters.length}`,
    `grammar characters needing work: ${review.worklistCount}`,
    `processed this pass: ${review.processedCount}`,
    `global one-to-one allocation complete: ${review.assignmentComplete ? "yes" : "no"}`,
    `root targets submitted: ${review.rootTargetCount}`,
    `Housekeeper duties this pass: ${context.dutiesThisPass}/${config.dutiesPerPass}`,
    `promoted grammar links: ${review.promotedLinkCount}`,
    ...(context.housekeeper ? [`Housekeeper: ${context.housekeeper.housekeeperHost}; queue before pass: ${context.housekeeper.queue.queued} queued, ${context.housekeeper.queue.running} running`] : []),
    `review artifact: ${review.reviewPath}`,
    `checkpoint: ${checkpointPath}`,
    ...Object.entries(modelStatuses).map(([status, count]) => `${status}: ${count}`)
  ].join("\n") + "\n");
  return { runId, reviewPath: review.reviewPath, checkpointPath, records, dutiesThisPass: context.dutiesThisPass };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  runChineseCharacterGrammarRefinery().catch((error) => {
    console.error(error?.message || String(error));
    process.exitCode = 1;
  });
}

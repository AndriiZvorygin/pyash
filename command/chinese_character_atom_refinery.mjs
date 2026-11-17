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
  buildChineseCharacterAtomProposals,
  buildChineseCharacterAtomWorklist,
  buildChineseCharacterAtomReviewPrompt,
  buildChineseCharacterPhoneticEvidencePrompt,
  buildChineseCharacterTranslationPrompt,
  CHINESE_CHARACTER_ATOM_MATCH_RESPONSE_FORMAT,
  CHINESE_CHARACTER_ATOM_REFINERY_CONFIG_URL,
  CHINESE_CHARACTER_ATOM_REFINERY_NAME,
  CHINESE_CHARACTER_PHONETIC_RESPONSE_FORMAT,
  CHINESE_CHARACTER_TRANSLATION_RESPONSE_FORMAT,
  DEFAULT_CHINESE_CHARACTER_ATOM_ARTIFACT_ROOT,
  loadChineseCharacterAtomRefineryInputs,
  parseChineseCharacterAtomCheckpointPya,
  parseChineseCharacterAtomReviewResponse,
  parseChineseCharacterPhoneticResponse,
  parseChineseCharacterTranslationResponse,
  renderChineseCharacterAtomCheckpointPya,
  renderChineseCharacterAtomRefineryPya
} from "../program/library/translation/chinese_character_atom_refinery.mjs";
import { createDefaultQueuedMindTranslationVocabularySubmitter } from "../program/library/translation/translation_vocabulary_queue.mjs";
import { awaitTranslationGpuDuty } from "../program/library/translation/translation_to_vliw_job.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

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
    generationLimit: Math.max(1, Math.trunc(Number(values.get("generation-limit") ?? 128))),
    dutiesPerPass: Math.max(0, Math.trunc(Number(values.get("housekeeper-duties-per-pass") ?? 4))),
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

function taskKey(recordId, kind, concept = "") {
  if (kind === "phonetic" && concept) return `phonetic:${sha256(normalizeEnglish(concept)).slice(0, 16)}`;
  return `${recordId}:${kind}${concept ? `:${sha256(normalizeEnglish(concept)).slice(0, 10)}` : ""}`;
}

function matchFingerprint(record) {
  return sha256(JSON.stringify({
    candidates: (record.existingAtomCandidates ?? []).map((target) => `${target.kind}:${target.pya}`),
    mappings: record.existingMappings ?? [],
    english: record.englishCandidates ?? [],
    specificityConflict: Boolean(record.specificityConflict)
  })).slice(0, 12);
}

function matchTaskKey(record) {
  return `${record.id}:match:${matchFingerprint(record)}`;
}

function latestMatchTask(recordId, tasks) {
  return [...tasks.values()].filter((task) => task.recordId === recordId && task.kind === "match").at(-1);
}

function currentMatchTask(record, tasks) {
  return tasks.get(matchTaskKey(record));
}

function taskHandle(runId, key) {
  return `chinese-character-atom-${runId.slice(-12)}-${sha256(key).slice(0, 16)}`;
}

function promptTask(record, kind, concept = "") {
  const key = kind === "match" ? matchTaskKey(record) : taskKey(record.id, kind, concept);
  if (kind === "match") return {
    key,
    recordId: record.id,
    kind,
    candidateFingerprint: matchFingerprint(record),
    prompt: buildChineseCharacterAtomReviewPrompt(record)
  };
  if (kind === "translation") return { key, recordId: record.id, kind, prompt: buildChineseCharacterTranslationPrompt(record) };
  return {
    key,
    recordId: record.id,
    kind,
    concept,
    prompt: buildChineseCharacterPhoneticEvidencePrompt(concept, record)
  };
}

function matchTasksFor(records, checkpointTasks) {
  const tasks = [];
  for (const proposal of records) {
    const record = proposal;
    const matchTask = currentMatchTask(record, checkpointTasks);
    const candidateCount = proposal.existingAtomCandidates?.length ?? 0;
    const exactCount = proposal.exactAtomCandidates?.length ?? 0;
    const needsChoice = !matchTask?.result && (proposal.specificityConflict
      || (candidateCount > 0 && (exactCount !== 1 || candidateCount > 1)));
    if (needsChoice) tasks.push(promptTask(proposal, "match"));
  }
  return tasks;
}

function translationTasksFor(records, checkpointTasks) {
  const tasks = [];
  for (const record of records) {
    const translation = checkpointTasks.get(taskKey(record.id, "translation"))?.result;
    const match = latestMatchTask(record.id, checkpointTasks)?.result;
    const translationRequiredAfterReview = record.specificityConflict && match && match.verdict !== "select";
    if ((record.englishCandidates.length === 0 || translationRequiredAfterReview) && !translation) {
      tasks.push(promptTask(record, "translation"));
    }
  }
  return tasks;
}

function phoneticTasksFor(records, checkpointTasks) {
  const tasks = [];
  const seen = new Set();
  for (const proposal of records) {
    for (const request of proposal.phoneticEvidenceRequests ?? []) {
      const key = taskKey(proposal.id, "phonetic", request.concept);
      if (!seen.has(key) && !checkpointTasks.get(key)?.result) tasks.push(promptTask(proposal, "phonetic", request.concept));
      seen.add(key);
    }
  }
  return tasks;
}

function translationsByCharacter(tasks) {
  return new Map([...tasks.values()]
    .filter((task) => task.kind === "translation" && task.status === "completed" && task.result)
    .map((task) => [task.recordId, task.result]));
}

function noFitCharacterIds(tasks) {
  const latest = new Map();
  for (const task of tasks.values()) if (task.kind === "match") latest.set(task.recordId, task);
  return new Set([...latest.values()]
    .filter((task) => task.status === "completed" && task.result?.verdict === "no-fit")
    .map((task) => task.recordId));
}

function specificityReassignmentIds(records, tasks) {
  return new Set(records.filter((record) => {
    if (!record.specificityConflict) return false;
    const translations = tasks.get(taskKey(record.id, "translation"))?.result?.translations ?? [];
    if (translations.length === 0) return false;
    return [...tasks.values()].some((task) => task.recordId === record.id
      && task.kind === "match" && task.status === "completed" && task.result?.verdict !== "select");
  }).map((record) => record.id));
}

function phoneticsByConcept(tasks) {
  const result = new Map();
  for (const task of tasks.values()) {
    if (task.kind !== "phonetic" || task.status !== "completed" || !task.result) continue;
    const key = normalizeEnglish(task.concept);
    const existing = result.get(key) ?? [];
    result.set(key, [...existing, ...task.result.entries]);
  }
  return result;
}

function attachCheckpointResults(proposals, tasks) {
  return proposals.map((proposal) => {
    const match = latestMatchTask(proposal.id, tasks);
    const translation = tasks.get(taskKey(proposal.id, "translation"));
    const concepts = new Set([
      ...(proposal.atomWordProposals ?? []).map((row) => normalizeEnglish(row.concept)),
      ...(proposal.phoneticEvidenceRequests ?? []).map((row) => normalizeEnglish(row.concept))
    ]);
    const phonetic = [...tasks.values()].filter((task) => task.kind === "phonetic"
      && task.status === "completed" && concepts.has(normalizeEnglish(task.concept)));
    return {
      ...proposal,
      ...(match?.result ? { modelMatch: match.result } : {}),
      ...(translation?.result ? { translationReview: translation.result } : {}),
      ...(phonetic.length ? { phoneticEvidenceReview: phonetic.map((task) => ({ concept: task.concept, ...task.result })) } : {})
    };
  });
}

function hydrateMatchCandidates(records, candidates) {
  const indexed = new Map(candidates.map((record) => [record.id, record]));
  return records.map((record) => {
    const candidate = indexed.get(record.id);
    return candidate ? {
      ...record,
      exactAtomCandidates: candidate.exactAtomCandidates,
      existingAtomCandidates: candidate.rankedAtomCandidates,
      existingMappings: candidate.existingMappings,
      specificityConflict: candidate.specificityConflict
    } : record;
  });
}

function translationResultsFromRows(records) {
  return new Map(records.filter((record) => record.translationReview)
    .map((record) => [record.id, record.translationReview]));
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
    throw new Error("Chinese character atom refinery requires PYA_MIND_RESPONSE to be unset");
  }
  const housekeeperUrl = String(
    process.env.PYA_GPU_HOUSEKEEPER_URL
      ?? resolveConfigText("gpu housekeeper url", { rememberFn: remember })
      ?? ""
  ).trim();
  if (!housekeeperUrl) throw new Error("Chinese character atom refinery requires the configured GPU Housekeeper URL");
  const housekeeper = createGpuHousekeeperAdapter({ baseUrl: housekeeperUrl });
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
    if (task.kind === "match") return parseChineseCharacterAtomReviewResponse(response, task.record);
    if (task.kind === "translation") return parseChineseCharacterTranslationResponse(response, task.record);
    return parseChineseCharacterPhoneticResponse(response, task.record);
  } catch (error) {
    const responseError = String(error?.message ?? error).slice(0, 500);
    const rawResponse = String(response ?? "").slice(0, 2000);
    if (task.kind === "match") {
      return { verdict: "uncertain", matches: [], rationale: "Housekeeper response did not meet the review contract.", responseError, rawResponse };
    }
    if (task.kind === "translation") {
      return { verdict: "uncertain", translations: [], responseError, rawResponse };
    }
    return { entries: [], responseError, rawResponse };
  }
}

function outputHandle(sentence) {
  const name = String(sentence?.to?.name ?? "").trim();
  if (!name) throw new Error("Chinese character atom stage requires a named map output");
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

async function writeStageArtifact(context, filename, name, records) {
  const outputPath = path.join(context.artifactDirectory, filename);
  await atomicWrite(outputPath, renderChineseCharacterAtomRefineryPya(records, {
    name,
    sourceHash: context.inputs.sourceHash,
    sourceHashes: context.inputs.sourceHashes,
    runId: context.runId
  }));
  return outputPath;
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
  let cursor = 0;
  while (cursor < pending.length && context.dutiesRemaining > 0) {
    const wave = pending.slice(cursor, cursor + Math.min(context.parallelism, context.dutiesRemaining));
    cursor += wave.length;
    context.housekeeper ??= await createHousekeeperSubmitter(context.config);
    const submissions = await Promise.allSettled(wave.map(async (task) => {
      const existing = context.checkpoint.tasks.get(task.key);
      const handleId = existing?.handleId ?? taskHandle(context.runId, task.key);
      if (existing?.status === "queued") return { task, handleId, submitted: false };
      const responseFormat = task.kind === "match"
        ? CHINESE_CHARACTER_ATOM_MATCH_RESPONSE_FORMAT
        : task.kind === "translation"
          ? CHINESE_CHARACTER_TRANSLATION_RESPONSE_FORMAT
          : CHINESE_CHARACTER_PHONETIC_RESPONSE_FORMAT;
      const queued = await context.housekeeper.submit({ handleId, prompt: task.prompt, responseFormat });
      if (String(queued?.status ?? queued?.ob?.text ?? "").trim().toLowerCase() !== "queued") {
        throw new Error(`Housekeeper did not queue ${task.key}: ${String(queued?.status ?? queued?.ob?.text ?? "unknown")}`);
      }
      return { task, handleId, submitted: true };
    }));
    const submissionErrors = [];
    const awaiting = [];
    submissions.forEach((submission, index) => {
      if (submission.status === "rejected") {
        submissionErrors.push(submission.reason);
        return;
      }
      const { task, handleId } = submission.value;
      context.checkpoint.tasks.set(task.key, {
        ...task,
        record: undefined,
        handleId,
        status: "queued"
      });
      awaiting.push({ task, handleId, index });
    });
    await persistCheckpoint(context);
    if (submissionErrors.length > 0) throw submissionErrors[0];

    const completions = await Promise.allSettled(awaiting.map(async ({ task, handleId }) => {
      const response = await awaitTranslationGpuDuty(handleId);
      return { task, handleId, result: responseFor(task, response) };
    }));
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
  if (getRefinery(CHINESE_CHARACTER_ATOM_REFINERY_NAME)) return;
  const source = await fs.readFile(CHINESE_CHARACTER_ATOM_REFINERY_CONFIG_URL, "utf8");
  for (const sentence of buildProgram(source).sentences) await interpret(sentence);
  if (!getRefinery(CHINESE_CHARACTER_ATOM_REFINERY_NAME)) {
    throw new Error("Chinese character atom refinery definition was not registered");
  }
}

async function runStage(sentence, context) {
  const stage = String(sentence?.su?.name ?? "").trim();
  const output = outputHandle(sentence);
  let result;
  let artifactPath;
  process.stderr.write(`[chinese-character-atom] stage ${stage}\n`);
  if (stage === "build ranked character worklist") {
    context.worklist = buildChineseCharacterAtomWorklist(context.inputs);
    artifactPath = await writeStageArtifact(context, "worklist.pya", "translation_chinese_character_atom_worklist", context.worklist);
    result = { sourceHash: context.inputs.sourceHash, count: context.worklist.length, records: context.worklist };
  } else if (stage === "prepare existing atom matches") {
    const records = mapValue("character worklist").records ?? context.worklist;
    const matches = records.map((record) => ({
      id: record.id,
      character: record.character,
      englishCandidates: record.englishCandidates,
      exactAtomCandidates: record.exactAtomCandidates,
      rankedAtomCandidates: record.existingAtomCandidates,
      existingMappings: record.existingMappings,
      specificityConflict: record.specificityConflict,
      frequency: record.frequency
    }));
    artifactPath = await writeStageArtifact(context, "atom-match-candidates.pya", "translation_chinese_character_atom_match_candidates", matches);
    result = { sourceHash: context.inputs.sourceHash, count: matches.length, records: matches };
  } else if (stage === "review ambiguous atom matches") {
    const worklist = mapValue("character worklist").records ?? context.worklist;
    const candidateRows = mapValue("atom match candidates").records ?? [];
    const records = hydrateMatchCandidates(worklist, candidateRows);
    const proposals = await buildChineseCharacterAtomProposals(records, context.inputs, {
      generationLimit: context.config.generationLimit,
      translationsByCharacter: translationsByCharacter(context.checkpoint.tasks),
      phoneticsByConcept: phoneticsByConcept(context.checkpoint.tasks),
      noFitCharacters: noFitCharacterIds(context.checkpoint.tasks),
      specificityReassignments: specificityReassignmentIds(records, context.checkpoint.tasks)
    });
    await dispatchTasks(matchTasksFor(proposals, context.checkpoint.tasks), context);
    const decisions = attachCheckpointResults(proposals, context.checkpoint.tasks);
    artifactPath = await writeStageArtifact(context, "atom-match-decisions.pya", "translation_chinese_character_atom_match_decisions", decisions);
    result = { sourceHash: context.inputs.sourceHash, count: decisions.length, records: decisions };
  } else if (stage === "prepare translations for missing meanings") {
    const records = mapValue("atom match decisions").records ?? context.worklist;
    await dispatchTasks(translationTasksFor(records, context.checkpoint.tasks), context);
    const translations = attachCheckpointResults(records, context.checkpoint.tasks)
      .filter((record) => record.translationReview);
    artifactPath = await writeStageArtifact(context, "translation-candidates.pya", "translation_chinese_character_atom_translation_candidates", translations);
    result = { sourceHash: context.inputs.sourceHash, count: translations.length, records: translations };
  } else if (stage === "generate atom proposals") {
    const records = mapValue("atom match decisions").records ?? context.worklist;
    const translationRows = mapValue("translation candidates").records ?? [];
    const completedTranslations = translationResultsFromRows(translationRows);
    let proposals = await buildChineseCharacterAtomProposals(records, context.inputs, {
      generationLimit: context.config.generationLimit,
      translationsByCharacter: completedTranslations,
      phoneticsByConcept: phoneticsByConcept(context.checkpoint.tasks),
      noFitCharacters: noFitCharacterIds(context.checkpoint.tasks),
      specificityReassignments: specificityReassignmentIds(records, context.checkpoint.tasks)
    });
    await dispatchTasks(matchTasksFor(proposals, context.checkpoint.tasks), context);
    proposals = await buildChineseCharacterAtomProposals(records, context.inputs, {
      generationLimit: context.config.generationLimit,
      translationsByCharacter: completedTranslations,
      phoneticsByConcept: phoneticsByConcept(context.checkpoint.tasks),
      noFitCharacters: noFitCharacterIds(context.checkpoint.tasks),
      specificityReassignments: specificityReassignmentIds(records, context.checkpoint.tasks)
    });
    await dispatchTasks(phoneticTasksFor(proposals, context.checkpoint.tasks), context);
    proposals = await buildChineseCharacterAtomProposals(records, context.inputs, {
      generationLimit: context.config.generationLimit,
      translationsByCharacter: completedTranslations,
      phoneticsByConcept: phoneticsByConcept(context.checkpoint.tasks),
      noFitCharacters: noFitCharacterIds(context.checkpoint.tasks),
      specificityReassignments: specificityReassignmentIds(records, context.checkpoint.tasks)
    });
    const reviewed = attachCheckpointResults(proposals, context.checkpoint.tasks);
    artifactPath = await writeStageArtifact(context, "atom-proposals.pya", "translation_chinese_character_atom_proposals", reviewed);
    result = { sourceHash: context.inputs.sourceHash, count: reviewed.length, records: reviewed };
  } else if (stage === "record character link review") {
    const proposalRows = mapValue("atom proposals").records ?? [];
    const matchRows = mapValue("atom match decisions").records ?? [];
    const translationRows = mapValue("translation candidates").records ?? [];
    const matchById = new Map(matchRows.map((record) => [record.id, record]));
    const translationById = new Map(translationRows.map((record) => [record.id, record.translationReview]));
    const proposals = proposalRows.map((record) => ({
      ...record,
      ...(!record.modelMatch && matchById.get(record.id)?.modelMatch
        ? { modelMatch: matchById.get(record.id).modelMatch }
        : {}),
      ...(!record.translationReview && translationById.get(record.id)
        ? { translationReview: translationById.get(record.id) }
        : {})
    }));
    artifactPath = path.join(context.artifactDirectory, "review.pya");
    await atomicWrite(artifactPath, renderChineseCharacterAtomRefineryPya(proposals, {
      sourceHash: context.inputs.sourceHash,
      sourceHashes: context.inputs.sourceHashes,
      runId: context.runId
    }));
    result = {
      runId: context.runId,
      sourceHash: context.inputs.sourceHash,
      standardCharacterCount: context.inputs.unihan.size,
      worklistCount: context.worklist.length,
      processedCount: proposals.length,
      reviewPath: artifactPath,
      records: proposals
    };
  } else {
    throw new Error(`unknown Chinese character atom refinery stage: ${stage}`);
  }
  doRemember(mapFact(output, result, artifactPath));
  return remember(output);
}

export async function runChineseCharacterAtomRefinery() {
  const configSource = await fs.readFile(CHINESE_CHARACTER_ATOM_REFINERY_CONFIG_URL, "utf8");
  const config = readConfig(configSource);
  if (!config.model || !config.promptRevision) throw new Error("Chinese character atom refinery config must name a model and prompt revision");
  await initializePyashRuntime();
  const inputs = await loadChineseCharacterAtomRefineryInputs();
  const configHash = sha256(JSON.stringify({
    model: config.model,
    promptRevision: config.promptRevision,
    maxOutputTokens: config.maxOutputTokens
  })).slice(0, 10);
  const runId = `chinese-character-atom-${inputs.sourceHash.slice(0, 16)}-${config.promptRevision}-${configHash}`;
  const artifactDirectory = path.join(DEFAULT_CHINESE_CHARACTER_ATOM_ARTIFACT_ROOT, runId);
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
  if (checkpoint.runId && checkpoint.runId !== runId) {
    throw new Error(`checkpoint run id mismatch at ${checkpointPath}`);
  }
  const context = {
    config,
    inputs,
    runId,
    artifactDirectory,
    checkpointPath,
    checkpoint,
    dutiesRemaining: config.dutiesPerPass,
    dutiesThisPass: 0,
    housekeeper: null,
    worklist: []
  };
  await ensureRefinery();
  const refineryResult = await runRefinery({
    name: CHINESE_CHARACTER_ATOM_REFINERY_NAME,
    interpret: (sentence) => runStage(sentence, context),
    runId,
    checkpointEnabled: false
  });
  if (refineryResult?.mood === "ya" && refineryResult?.be === "error") {
    throw new Error(refineryResult.ob?.text || "Chinese character atom refinery failed");
  }
  const review = remember("character review")?.ob?.map;
  if (!review?.reviewPath) throw new Error("Chinese character atom refinery completed without its review artifact");
  const proposals = review.records ?? [];
  process.stdout.write([
    `source hash: ${inputs.sourceHash}`,
    `run id: ${runId}`,
    `standard characters: ${inputs.unihan.size}`,
    `characters needing work: ${review.worklistCount}`,
    `prepared this pass: ${proposals.length}`,
    `Housekeeper duties this pass: ${context.dutiesThisPass}/${config.dutiesPerPass}`,
    ...(context.housekeeper ? [`Housekeeper: ${context.housekeeper.housekeeperHost}; queue before pass: ${context.housekeeper.queue.queued} queued, ${context.housekeeper.queue.running} running`] : []),
    `review artifact: ${review.reviewPath}`,
    `checkpoint: ${checkpointPath}`,
    ...Object.entries(proposals.reduce((counts, row) => {
      counts[row.stageStatus] = (counts[row.stageStatus] ?? 0) + 1;
      return counts;
    }, {})).map(([status, count]) => `${status}: ${count}`)
  ].join("\n") + "\n");
  return { runId, reviewPath: review.reviewPath, checkpointPath, proposals, dutiesThisPass: context.dutiesThisPass };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  runChineseCharacterAtomRefinery().catch((error) => {
    console.error(error?.message || String(error));
    process.exitCode = 1;
  });
}

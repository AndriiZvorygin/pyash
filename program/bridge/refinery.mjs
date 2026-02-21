import { buildErrorSentence, surfaceErrorSentence, throwErrorSentence } from "../error.mjs";
import { remember, doRemember, allRemember, pushMemoryContext, popMemoryContext } from "../remember/index.mjs";
import { sentenceToPyash } from "../beautiful.mjs";
import { state } from "./state.mjs";

const refineryRegistry = new Map();
const refineryStack = [];
const REFINERY_LOCAL_SLOT_NAMES = ["trying", "sketch", "reaction", "decision"];

function cloneValue(value) {
  if (globalThis.structuredClone) return globalThis.structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

function compareUtf8(a, b) {
  if (a === b) return 0;
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  const len = Math.min(bufA.length, bufB.length);
  for (let i = 0; i < len; i += 1) {
    if (bufA[i] !== bufB[i]) return bufA[i] < bufB[i] ? -1 : 1;
  }
  return bufA.length < bufB.length ? -1 : 1;
}

function fnv1aHex(text) {
  const bytes = Buffer.from(String(text ?? ""), "utf8");
  let hash = 0x811c9dc5;
  for (const byte of bytes) {
    hash ^= byte;
    hash = (hash * 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

function buildCheckpointHash(actionLine, depNames, depResults, extraParts = []) {
  const parts = [`action:${actionLine}`];
  for (let i = 0; i < depNames.length; i += 1) {
    const name = depNames[i];
    const result = depResults[i] ?? "";
    parts.push(`dep:${name}:${result}`);
  }
  for (const extra of extraParts) {
    parts.push(`extra:${String(extra ?? "")}`);
  }
  return fnv1aHex(parts.join("\n"));
}

function readRetryNumber(name) {
  const fact = remember(name);
  const value = fact?.ob?.num ?? fact?.ob?.text;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function readRetryConfig() {
  const delay = readRetryNumber("reiterate delay");
  const backoff = readRetryNumber("reiterate backoff");
  const attempts = readRetryNumber("reiterate attempts");
  const cap = readRetryNumber("reiterate cap");
  return {
    initialDelayMs: delay ?? 250,
    backoff: backoff ?? 2,
    maxAttempts: attempts ?? 5,
    maxDelayMs: cap ?? 8000
  };
}

function normalizeRetryConfig(config = {}) {
  const initialDelayMs = Math.max(0, Number(config.initialDelayMs) || 0);
  const backoff = Math.max(1, Number(config.backoff) || 1);
  const maxAttempts = Math.max(1, Math.floor(Number(config.maxAttempts) || 1));
  const maxDelayMs = Math.max(0, Number(config.maxDelayMs) || 0);
  return { initialDelayMs, backoff, maxAttempts, maxDelayMs };
}

function buildCheckpointSentence({ refineryName, platformName, hash, resultSentence, resultLine, exportFacts = [], scopeSlots = {} }) {
  let payloadText = "";
  try {
    payloadText = JSON.stringify({
      result: resultSentence ?? {},
      exports: exportFacts,
      scope: scopeSlots
    });
  } catch {
    payloadText = "";
  }
  return {
    mood: "ya",
    be: "checkpoint",
    su: { name: platformName },
    ob: { text: hash },
    from: { name: refineryName },
    to: { la: resultSentence },
    fromtext: { text: payloadText },
    totext: { text: String(resultLine ?? "") }
  };
}

function buildRetrySentence({ refineryName, platformName, attempt, message }) {
  return {
    mood: "ya",
    be: "reiterate",
    su: { name: platformName },
    by: { num: attempt },
    ob: { text: message },
    from: { name: refineryName }
  };
}

function normalizeNameTypeWord(word) {
  const raw = String(word ?? "").trim().toLowerCase();
  if (raw === "number") return "num";
  if (raw === "boolean") return "bool";
  return raw;
}

function rememberInLocalWrites(localWrites, name) {
  for (let i = localWrites.length - 1; i >= 0; i -= 1) {
    const entry = localWrites[i];
    if (entry?.su?.name === name) return entry;
  }
  return undefined;
}

function collectExportFacts({ localWrites, autoExportNames, explicitExportNames }) {
  const names = new Set();
  for (const name of autoExportNames ?? []) names.add(name);
  for (const name of explicitExportNames ?? []) names.add(name);
  const exportFacts = [];
  for (const name of names) {
    const fact = rememberInLocalWrites(localWrites, name);
    if (fact?.mood) exportFacts.push(cloneValue(fact));
  }
  return exportFacts;
}

function factMatchesTypeWord(fact, expectedWord) {
  const word = normalizeNameTypeWord(expectedWord);
  const ob = fact?.ob ?? {};
  if (word === "text") return typeof ob.text === "string";
  if (word === "num") return typeof ob.num === "number" && Number.isFinite(ob.num);
  if (word === "bool") return typeof ob.boolean === "boolean";
  if (word === "filename") return typeof ob.filename === "string";
  if (word === "itinerary") return fact?.be === "itinerary" || Array.isArray(ob.series);
  if (word === "photographs") return fact?.be === "photographs" && Array.isArray(ob.series);
  if (word === "series") return Array.isArray(ob.series);
  if (word === "map") return fact?.be === "map" || (ob.map && typeof ob.map === "object" && !Array.isArray(ob.map));
  if (word === "json map") return fact?.be === "json map";
  if (word === "csv map") return fact?.be === "csv map";
  return true;
}

function validateOutputContract({ outputContract, localWrites, refineryName, platformName }) {
  if (!outputContract) return;
  const fact = rememberInLocalWrites(localWrites, outputContract.name);
  if (!fact) {
    throwErrorSentence({
      name: "platform produce defective",
      message: `platform produce defective: missing ${outputContract.name}`,
      from: { name: refineryName },
      raw: { platform: platformName, output: outputContract }
    });
  }
  const normalizedWords = outputContract.typeWords.map(normalizeNameTypeWord);
  const compositeType = normalizedWords.join(" ");
  if (compositeType === "json map" && fact?.be !== "json map") {
    throwErrorSentence({
      name: "platform produce defective",
      message: `platform produce defective: ${outputContract.name} not json map`,
      from: { name: refineryName },
      raw: { platform: platformName, output: outputContract, got: fact }
    });
  }
  if (compositeType === "csv map" && fact?.be !== "csv map") {
    throwErrorSentence({
      name: "platform produce defective",
      message: `platform produce defective: ${outputContract.name} not csv map`,
      from: { name: refineryName },
      raw: { platform: platformName, output: outputContract, got: fact }
    });
  }
  for (const word of outputContract.typeWords) {
    if (!factMatchesTypeWord(fact, word)) {
      throwErrorSentence({
        name: "platform produce defective",
        message: `platform produce defective: ${outputContract.name} not ${word}`,
        from: { name: refineryName },
        raw: { platform: platformName, output: outputContract, got: fact }
      });
    }
  }
}

function shouldSkipOutputContract({ outputContract, actionSentence }) {
  if (!outputContract || !actionSentence) return false;
  const joinedType = outputContract.typeWords.map(normalizeNameTypeWord).join(" ");
  // Legacy mapper signatures historically used `to name text <target>` even when
  // mapped output is a series sentence. Keep backward compatibility.
  if (joinedType === "text" && actionSentence.be === "series map") return true;
  return false;
}

function readLocalSlotFacts(localWrites) {
  const slots = {};
  for (const slotName of REFINERY_LOCAL_SLOT_NAMES) {
    const fact = rememberInLocalWrites(localWrites, slotName);
    if (!fact) continue;
    slots[slotName] = cloneValue(fact);
  }
  return slots;
}

function normalizeRefineryError(errorLike, { refineryName, platformName, actionSentence } = {}) {
  const surfaced = surfaceErrorSentence(errorLike?.sentence ?? errorLike);
  if (surfaced?.mood && surfaced?.be) return surfaced;
  const message = String(errorLike?.message ?? surfaced?.message ?? "platform execution failed");
  return surfaceErrorSentence(buildErrorSentence({
    name: "platform defective",
    message: `platform defective: ${message}`,
    from: { name: refineryName || "refinery" },
    raw: { platform: platformName, action: actionSentence }
  }));
}

function restoreExportFacts(exportFacts = []) {
  for (const fact of exportFacts) {
    if (fact?.mood === "ya") doRemember(fact);
  }
}

function applyScopeSnapshotToHashParts(scopeSlots = {}) {
  const parts = [];
  for (const slotName of REFINERY_LOCAL_SLOT_NAMES) {
    if (!scopeSlots[slotName]) continue;
    try {
      parts.push(`${slotName}:${JSON.stringify(scopeSlots[slotName].ob ?? null)}`);
    } catch {
      parts.push(`${slotName}:unserializable`);
    }
  }
  return parts;
}

async function sleepMs(delayMs) {
  if (!delayMs || delayMs <= 0) return;
  await new Promise(resolve => setTimeout(resolve, delayMs));
}

function assertNameVector(value) {
  if (!value?.ve || value.ve.type !== "name" || !Array.isArray(value.ve.values)) {
    throwErrorSentence({
      name: "depend defective",
      message: "depend list must be from ve name ...",
      from: { name: "interpret" },
      raw: value
    });
  }
  return value.ve.values.map((entry) => String(entry));
}

function normalizeDependencyVector(values = []) {
  const deps = [];
  for (let i = 0; i < values.length; i += 1) {
    const token = String(values[i] ?? "");
    if (!token) continue;
    if (token === "name") {
      const next = String(values[i + 1] ?? "");
      if (next) {
        deps.push(next);
        i += 1;
      }
      continue;
    }
    deps.push(token);
  }
  return deps;
}

function dependencyTokensFromVector(values = []) {
  const raw = Array.isArray(values) ? values.map(v => String(v ?? "")).filter(Boolean) : [];
  if (!raw.length) return [];
  const hasNameDelimiter = raw.includes("name");
  const hasTypedHead = raw.some((token, idx) => {
    const head = normalizeNameTypeWord(token);
    if (head === "json" || head === "csv") return normalizeNameTypeWord(raw[idx + 1]) === "map";
    return HANDLE_TYPE_WORDS.has(head);
  });
  if (!hasNameDelimiter && !hasTypedHead) {
    return normalizeDependencyVector(raw);
  }

  const out = [];
  let i = 0;
  while (i < raw.length) {
    if (raw[i] === "name") {
      i += 1;
      continue;
    }
    const head = raw[i];
    const lower = normalizeNameTypeWord(head);
    let typeWords = [];
    if ((lower === "json" || lower === "csv") && normalizeNameTypeWord(raw[i + 1]) === "map") {
      typeWords = [head, raw[i + 1]];
      i += 2;
    } else if (HANDLE_TYPE_WORDS.has(lower)) {
      typeWords = [head];
      i += 1;
    }
    const handleWords = [];
    while (i < raw.length && raw[i] !== "name") {
      handleWords.push(raw[i]);
      i += 1;
    }
    if (!handleWords.length) continue;
    if (typeWords.length) out.push(`${typeWords.join(" ")} ${handleWords.join(" ")}`.trim());
    else out.push(handleWords.join(" ").trim());
  }
  return normalizeDependencyVector(out);
}

function dependencyHandleNameFromTypedToken(token) {
  const parts = String(token ?? "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "";
  const first = normalizeNameTypeWord(parts[0]);
  if ((first === "json" || first === "csv") && normalizeNameTypeWord(parts[1]) === "map") {
    return parts.slice(2).join(" ").trim();
  }
  if (HANDLE_TYPE_WORDS.has(first)) {
    return parts.slice(1).join(" ").trim();
  }
  return "";
}

function normalizeTypeWords(words = []) {
  return words.map(normalizeNameTypeWord).filter(Boolean);
}

const HANDLE_TYPE_WORDS = new Set([
  "text",
  "num",
  "bool",
  "filename",
  "map",
  "series",
  "itinerary",
  "photographs",
  "stream",
  "duty",
  "mind",
  "refinery",
  "date",
  "month",
  "second",
  "minute",
  "hour",
  "day",
  "week",
  "line",
  "byte"
]);

function expectedTypeWordsFromDependencyToken(token) {
  const words = String(token ?? "").trim().split(/\s+/).map(normalizeNameTypeWord).filter(Boolean);
  if (words.length < 2) return [];
  if ((words[0] === "json" || words[0] === "csv") && words[1] === "map") {
    return [words[0], "map"];
  }
  if (HANDLE_TYPE_WORDS.has(words[0])) return [words[0]];
  return [];
}

function outputContractByHandle(frame, handleName) {
  const matches = [];
  for (const platformName of frame.order) {
    const platform = frame.platforms.get(platformName);
    if (!platform?.outputContract?.name) continue;
    if (platform.outputContract.name === handleName) {
      matches.push({ platformName, outputContract: platform.outputContract });
    }
  }
  return matches;
}

function resolveDependencyToken(frame, token) {
  const name = String(token ?? "").trim();
  if (!name) return null;
  if (frame.platforms.has(name)) {
    const platform = frame.platforms.get(name);
    return {
      dep: name,
      outputContract: platform?.outputContract ?? null
    };
  }
  const matches = outputContractByHandle(frame, name);
  if (matches.length > 1) {
    throwErrorSentence({
      name: "depend defective",
      message: `depend defective: ambiguous dependency handle ${name}`,
      from: { name: "interpret" },
      raw: { name, matches: matches.map(entry => entry.platformName) }
    });
  }
  if (matches.length === 1) {
    return {
      dep: matches[0].platformName,
      outputContract: matches[0].outputContract
    };
  }
  return null;
}

function assertDependencyTypeMatch({ dependencyToken, expectedTypeWords, resolved }) {
  const expected = normalizeTypeWords(expectedTypeWords);
  if (!expected.length) return;
  const output = resolved?.outputContract;
  if (!output) {
    throwErrorSentence({
      name: "depend defective",
      message: `depend defective: ${dependencyToken} missing typed output contract`,
      from: { name: "interpret" },
      raw: { dependency: dependencyToken, expected }
    });
  }
  const actual = normalizeTypeWords(output.typeWords);
  const expectedJoined = expected.join(" ");
  const actualJoined = actual.join(" ");
  if (expectedJoined !== actualJoined) {
    throwErrorSentence({
      name: "depend defective",
      message: `depend defective: ${dependencyToken} type mismatch (${expectedJoined} != ${actualJoined || "unknown"})`,
      from: { name: "interpret" },
      raw: { dependency: dependencyToken, expected, actual }
    });
  }
}

function assertPlatformAction(ob) {
  if (!ob || typeof ob !== "object") {
    throwErrorSentence({
      name: "platform defective",
      message: "platform activity must be ob la ... ko",
      from: { name: "interpret" },
      raw: ob
    });
  }
  if (!("la" in ob)) {
    throwErrorSentence({
      name: "platform defective",
      message: "platform activity must be ob la ... ko",
      from: { name: "interpret" },
      raw: ob
    });
  }
  const extraKeys = Object.keys(ob).filter((key) => key !== "la");
  if (extraKeys.length > 0) {
    throwErrorSentence({
      name: "platform defective",
      message: "platform activity must contain exactly one embedded sentence",
      from: { name: "interpret" },
      raw: { extra: extraKeys }
    });
  }
  const clause = ob.la;
  if (!clause || typeof clause !== "object") {
    throwErrorSentence({
      name: "platform defective",
      message: "platform activity must be ob la ... ko",
      from: { name: "interpret" },
      raw: clause
    });
  }
  return clause;
}

export function startRefinery(name) {
  if (!name) {
    throwErrorSentence({
      name: "refinery defective",
      message: "refinery name required",
      from: { name: "interpret" }
    });
  }
  if (refineryStack.length > 0) {
    throwErrorSentence({
      name: "refinery defective",
      message: "nested refinery definitions are not supported",
      from: { name: "interpret" }
    });
  }
  const frame = { name, platforms: new Map(), order: [] };
  refineryStack.push(frame);
  return frame;
}

export function isInsideRefinery() {
  return refineryStack.length > 0;
}

export function recordPlatform(sentence) {
  const frame = refineryStack[refineryStack.length - 1];
  if (!frame) {
    throwErrorSentence({
      name: "refinery defective",
      message: "platform outside refinery",
      from: { name: "interpret" }
    });
  }
  const isPlatformDecl = sentence?.mood === "ya" && sentence?.be === "platform";
  if (isPlatformDecl) {
    throwErrorSentence({
      name: "platform defective",
      message: "platform declarations are deprecated; use series entries",
      from: { name: "interpret" },
      raw: sentence
    });
  }
  if (!isPlatformDecl && (sentence?.mood === "def" || sentence?.mood === "prah")) {
    throwErrorSentence({
      name: "platform defective",
      message: "refinery entries must be series sentences (su name ...)",
      from: { name: "interpret" },
      raw: sentence
    });
  }
  const name = sentence?.su?.name;
  if (!name) {
    throwErrorSentence({
      name: "platform defective",
      message: "platform name required",
      from: { name: "interpret" },
      raw: sentence
    });
  }
  if (frame.platforms.has(name)) {
    throwErrorSentence({
      name: "platform defective",
      message: `platform name duplicated: ${name}`,
      from: { name: "interpret" },
      raw: sentence
    });
  }
  let deps = [];
  let hasExplicitDependency = false;
  let primaryFromCase = null;
  let actionSentence = null;
  if (sentence.from?.ve?.type === "name" && Array.isArray(sentence.from.ve.values)) {
    const tokens = dependencyTokensFromVector(sentence.from.ve.values);
    for (const token of tokens) {
      let resolved = resolveDependencyToken(frame, token);
      const expectedTypeWords = expectedTypeWordsFromDependencyToken(token);
      if (!resolved && expectedTypeWords.length) {
        const typedHandleName = dependencyHandleNameFromTypedToken(token);
        if (typedHandleName) resolved = resolveDependencyToken(frame, typedHandleName);
      }
      if (!resolved) {
        throwErrorSentence({
          name: "depend defective",
          message: `depend defective: missing dependency ${token}`,
          from: { name: "interpret" },
          raw: { token }
        });
      }
      hasExplicitDependency = true;
      assertDependencyTypeMatch({
        dependencyToken: token,
        expectedTypeWords,
        resolved
      });
      if (!primaryFromCase) {
        const typedHandleName = dependencyHandleNameFromTypedToken(token);
        const handleName = String(typedHandleName || token).trim();
        if (handleName) {
          primaryFromCase = { name: handleName };
          if (expectedTypeWords.length) primaryFromCase.nameTypeWords = [...expectedTypeWords];
        }
      }
      if (!deps.includes(resolved.dep)) deps.push(resolved.dep);
    }
  } else if (typeof sentence.from?.name === "string" && sentence.from.name) {
    const fromName = String(sentence.from.name);
    const resolved = resolveDependencyToken(frame, fromName);
    if (resolved) {
      assertDependencyTypeMatch({
        dependencyToken: fromName,
        expectedTypeWords: sentence.from?.nameTypeWords ?? [],
        resolved
      });
      hasExplicitDependency = true;
      deps = [resolved.dep];
    }
  } else if (sentence.from && (sentence.from.filename || sentence.from.text || sentence.from.name || sentence.from.genitive)) {
    // allow non-depend "from" cases (e.g. from filename) to pass through as part of the action
  } else if (sentence.from) {
    throwErrorSentence({
      name: "depend defective",
      message: "depend list must be from ve name ...",
      from: { name: "interpret" },
      raw: sentence.from
    });
  }
  const priorName = frame.order.length > 0 ? frame.order[frame.order.length - 1] : null;
  if (!hasExplicitDependency && priorName && !deps.includes(priorName)) deps = [...deps, priorName];
  const outputContract = (() => {
    const targetName = sentence?.to?.name;
    const targetTypeWords = Array.isArray(sentence?.to?.nameTypeWords)
      ? sentence.to.nameTypeWords
      : [];
    if (!targetName || targetTypeWords.length === 0) return null;
    return { name: String(targetName), typeWords: targetTypeWords.map(w => String(w)) };
  })();
  actionSentence = { ...sentence };
  if (actionSentence.from?.ve?.type === "name" || (typeof actionSentence.from?.name === "string" && actionSentence.from.name)) {
    const { ve, ...fromRest } = actionSentence.from;
    if (ve?.type === "name") fromRest.ve = undefined;
    const cleaned = Object.fromEntries(Object.entries(fromRest).filter(([, v]) => v !== undefined));
    if (Object.keys(cleaned).length > 0) actionSentence.from = cleaned;
    else if (primaryFromCase) actionSentence.from = { ...primaryFromCase };
    else delete actionSentence.from;
  }
  frame.platforms.set(name, { deps, actionSentence, outputContract });
  frame.order.push(name);
  return { recorded: true };
}

export function endRefinery(name) {
  const frame = refineryStack.pop();
  if (!frame) {
    throwErrorSentence({
      name: "refinery defective",
      message: "refinery prah without refinery def",
      from: { name: "interpret" }
    });
  }
  if (name && name !== frame.name) {
    throwErrorSentence({
      name: "refinery defective",
      message: `refinery prah mismatch: ${name}`,
      from: { name: "interpret" },
      raw: { expected: frame.name, got: name }
    });
  }
  refineryRegistry.set(frame.name, {
    name: frame.name,
    platforms: frame.platforms,
    order: frame.order
  });
  return frame.name;
}

export function getRefinery(name) {
  return refineryRegistry.get(name);
}

export function removeRefinery(name) {
  return refineryRegistry.delete(name);
}

export function listRefineries() {
  return [...refineryRegistry.keys()];
}

function resolveProposePrompt(sentence) {
  if (!sentence || typeof sentence !== "object") return "";
  if (typeof sentence.ob?.text === "string") return sentence.ob.text;
  if (typeof sentence.ob?.name === "string") {
    const fact = remember(sentence.ob.name);
    if (typeof fact?.ob?.text === "string") return fact.ob.text;
  }
  return sentenceToPyash(sentence);
}

function buildResumeToken({ runId, refineryName, platformName, index, decisionName } = {}) {
  const payload = {
    runId: runId ?? "",
    refinery: refineryName ?? "",
    step: platformName ?? "",
    index: typeof index === "number" ? index : -1,
    decision: decisionName ?? ""
  };
  return JSON.stringify(payload);
}

function buildProposeSentence({ refineryName, platformName, actionSentence, resumeToken, decisionName } = {}) {
  const prompt = resolveProposePrompt(actionSentence);
  const sentence = {
    mood: "do",
    be: "ratify",
    su: { name: platformName },
    ob: { text: prompt },
    from: { name: refineryName },
    accordingto: { name: "resume token" },
    fromtext: { text: resumeToken }
  };
  if (decisionName) sentence.to = { name: decisionName };
  return sentence;
}

export async function runRefinery({
  name,
  interpret,
  onEvoke,
  onResult,
  onCheckpoint,
  onRetry,
  checkpointIndex,
  checkpointEnabled = true,
  retryConfig,
  runId,
  resume
} = {}) {
  if (!name) {
    throwErrorSentence({
      name: "refinery defective",
      message: "refinery name required",
      from: { name: "interpret" }
    });
  }
  const refinery = refineryRegistry.get(name);
  if (!refinery) {
    throwErrorSentence({
      name: "refinery defective",
      message: `refinery missing: ${name}`,
      from: { name: "interpret" }
    });
  }
  const completed = new Set();
  const pending = new Set(refinery.platforms.keys());
  const results = new Map();
  const retrySettings = normalizeRetryConfig(retryConfig ?? readRetryConfig());
  let lastResult = null;
  let resumeGate = null;
  if (resume) {
    const rawToken = typeof resume === "string" ? resume : resume.token ?? resume.fromtext ?? null;
    let parsed = null;
    if (rawToken) {
      try {
        parsed = JSON.parse(rawToken);
      } catch (err) {
        throwErrorSentence({
          name: "resume defective",
          message: "resume token must be valid JSON",
          from: { name: "interpret" },
          raw: { token: rawToken }
        });
      }
    }
    if (!parsed || typeof parsed !== "object") {
      throwErrorSentence({
        name: "resume defective",
        message: "resume token missing",
        from: { name: "interpret" },
        raw: { token: rawToken }
      });
    }
    let decision = "";
    let decisionRaw = "";
    if (typeof resume.decision === "boolean") {
      decision = resume.decision ? "truth" : "lie";
      decisionRaw = decision;
    } else if (typeof resume.decision === "string") {
      decisionRaw = resume.decision;
      decision = resume.decision.toLowerCase();
    }
    if (typeof resume.raw === "string") {
      decisionRaw = resume.raw;
    }
    if (decision !== "truth" && decision !== "lie") {
      throwErrorSentence({
        name: "resume defective",
        message: "resume decision must be truth or lie",
        from: { name: "interpret" },
        raw: { decision }
      });
    }
    if (runId && parsed.runId && parsed.runId !== runId) {
      throwErrorSentence({
        name: "resume defective",
        message: "resume run id mismatch",
        from: { name: "interpret" },
        raw: { expected: runId, got: parsed.runId }
      });
    }
    if (parsed.refinery && parsed.refinery !== name) {
      throwErrorSentence({
        name: "resume defective",
        message: "resume refinery mismatch",
        from: { name: "interpret" },
        raw: { expected: name, got: parsed.refinery }
      });
    }
    resumeGate = {
      platformName: parsed.step || null,
      index: typeof parsed.index === "number" ? parsed.index : -1,
      decision,
      decisionRaw,
      decisionName: parsed.decision || null,
      token: rawToken ?? null
    };
    if (resumeGate.index >= 0) {
      for (let i = 0; i < resumeGate.index; i += 1) {
        const priorName = refinery.order[i];
        if (!priorName) continue;
        completed.add(priorName);
        pending.delete(priorName);
        if (!results.has(priorName)) results.set(priorName, "");
      }
    }
  }
  const resolveResultSentence = (value, fallbackSentence) => {
    if (value?.mood && value?.be) return value;
    if (value?.be && value?.ob !== undefined) {
      return { ...value, mood: "ya" };
    }
    if (value?.sentence?.mood && value?.sentence?.be) return value.sentence;
    if (value?.result?.mood && value?.result?.be) return value.result;
    if (value?.result !== undefined && fallbackSentence?.be) {
      const ob = typeof value.result === "object" ? value.result : { num: value.result };
      return { ...fallbackSentence, mood: "ya", ob };
    }
    const remembered = remember("result");
    if (remembered?.mood && remembered?.be) return remembered;
    if (fallbackSentence?.mood) return fallbackSentence;
    return null;
  };

  const resolveDependencyFact = (depName) => {
    const depPlatform = depName ? refinery.platforms.get(depName) : null;
    const handle = String(depPlatform?.outputContract?.name ?? "").trim();
    if (handle) {
      const byHandle = remember(handle);
      if (byHandle?.mood) return byHandle;
    }
    const direct = depName ? remember(depName) : null;
    return direct?.mood ? direct : direct;
  };

  while (pending.size > 0) {
    const ready = [];
    for (const platformName of pending) {
      const platform = refinery.platforms.get(platformName);
      const deps = platform?.deps ?? [];
      if (deps.every((dep) => completed.has(dep))) ready.push(platformName);
    }
    if (ready.length === 0) {
      throwErrorSentence({
        name: "depend defective",
        message: "depend cycle or missing platform",
        from: { name: "interpret" },
        raw: { refinery: name }
      });
    }
    ready.sort(compareUtf8);
    const nextName = ready[0];
    const platform = refinery.platforms.get(nextName);
    if (!platform) {
      throwErrorSentence({
        name: "platform defective",
        message: `platform missing: ${nextName}`,
        from: { name: "interpret" }
      });
    }
    if (onEvoke) onEvoke(platform.actionSentence);
    if (platform.actionSentence?.mood === "propose") {
      if (resumeGate) {
        const matchesName = resumeGate.platformName && resumeGate.platformName === nextName;
        const matchesIndex = resumeGate.index >= 0 && resumeGate.index === refinery.order.indexOf(nextName);
        if (matchesName || matchesIndex) {
          const decisionSentence = {
            mood: "ya",
            be: "ratify",
            su: { name: nextName },
            ob: { boolean: resumeGate.decision === "truth" }
          };
          if (resumeGate.decisionRaw) {
            decisionSentence.totext = { text: resumeGate.decisionRaw };
          }
          if (resumeGate.token) {
            decisionSentence.accordingto = { name: "resume token" };
            decisionSentence.fromtext = { text: resumeGate.token };
          }
          if (resumeGate.decisionName) {
            decisionSentence.to = { name: resumeGate.decisionName };
          }
          if (onResult) onResult(decisionSentence);
          lastResult = decisionSentence;
          results.set(nextName, sentenceToPyash(decisionSentence));
          completed.add(nextName);
          pending.delete(nextName);
          resumeGate = null;
          continue;
        }
      }
      const decisionName = platform.actionSentence?.to?.name ?? null;
      const resumeToken = buildResumeToken({
        runId,
        refineryName: name,
        platformName: nextName,
        index: refinery.order.indexOf(nextName),
        decisionName
      });
      const proposeSentence = buildProposeSentence({
        refineryName: name,
        platformName: nextName,
        actionSentence: platform.actionSentence,
        resumeToken,
        decisionName
      });
      if (onResult) onResult(proposeSentence);
      return proposeSentence;
    }
    const deps = platform.deps ?? [];
    const sortedDeps = [...deps].sort(compareUtf8);
    const depResults = sortedDeps.map(dep => results.get(dep) ?? "");
    const actionLine = sentenceToPyash(platform.actionSentence);
    const loopCursorParts = [];
    if (platform.actionSentence?.fromindex !== undefined) {
      loopCursorParts.push(`fromindex:${JSON.stringify(platform.actionSentence.fromindex)}`);
    }
    if (platform.actionSentence?.toindex !== undefined) {
      loopCursorParts.push(`toindex:${JSON.stringify(platform.actionSentence.toindex)}`);
    }
    const localScopeSnapshot = {};
    for (const slotName of REFINERY_LOCAL_SLOT_NAMES) {
      const slotFact = remember(slotName);
      if (!slotFact) continue;
      localScopeSnapshot[slotName] = slotFact;
    }
    const localSlotParts = applyScopeSnapshotToHashParts(localScopeSnapshot);
    const checkpointHash = buildCheckpointHash(
      actionLine,
      sortedDeps,
      depResults,
      [...loopCursorParts, ...localSlotParts]
    );
    const checkpointMap = checkpointIndex?.get(name);
    const checkpointRecord = checkpointEnabled ? checkpointMap?.get(nextName) : null;
    if (checkpointEnabled && checkpointRecord?.hash === checkpointHash) {
      const resultSentence = checkpointRecord.resultSentence;
      const resultLine = checkpointRecord.resultLine ?? sentenceToPyash(resultSentence);
      restoreExportFacts(checkpointRecord.exportFacts ?? []);
      results.set(nextName, resultLine);
      const checkpointSentence = buildCheckpointSentence({
        refineryName: name,
        platformName: nextName,
        hash: checkpointHash,
        resultSentence,
        resultLine,
        exportFacts: checkpointRecord.exportFacts ?? [],
        scopeSlots: checkpointRecord.scopeSlots ?? {}
      });
      if (onCheckpoint) onCheckpoint(checkpointSentence);
      if (onResult) onResult(resultSentence);
      lastResult = resultSentence;
      completed.add(nextName);
      pending.delete(nextName);
      continue;
    }
    let attempt = 0;
    let delayMs = retrySettings.initialDelayMs;
    let result;
    let lastExportFacts = [];
    let lastScopeSlots = {};
    while (attempt < retrySettings.maxAttempts) {
      attempt += 1;
      let surfaced = null;
      let exportFacts = [];
      let scopeSlots = {};
      pushMemoryContext({ seedFromCurrent: true });
      const localStart = allRemember().length;
      const outputHandleName = String(platform.actionSentence?.to?.name ?? nextName).trim() || nextName;
      const scopeFrame = {
        exports: new Set(),
        autoExport: new Set([
          nextName,
          outputHandleName,
          ...(platform.outputContract?.name ? [platform.outputContract.name] : [])
        ])
      };
      state.refineryScopeStack.push(scopeFrame);
      const prevEvoke = state.currentEvoke;
      const prevEvokeRef = state.currentEvokeRef;
      try {
        const depRefName = platform.deps.length ? platform.deps[platform.deps.length - 1] : null;
        const depRefFact = depRefName ? resolveDependencyFact(depRefName) : null;
        if (depRefFact) {
          state.currentEvoke = depRefFact;
          state.currentEvokeRef = depRefFact;
        }
        try {
          result = await interpret(platform.actionSentence);
        } catch (err) {
          result = normalizeRefineryError(err, {
            refineryName: name,
            platformName: nextName,
            actionSentence: platform.actionSentence
          });
        }
        const resultSentence = resolveResultSentence(result, platform.actionSentence);
        surfaced = surfaceErrorSentence(resultSentence);
        const localWrites = allRemember().slice(localStart);
        if (
          !(surfaced?.be === "error" && surfaced?.mood === "ya")
          && !rememberInLocalWrites(localWrites, outputHandleName)
          && surfaced?.ob !== undefined
        ) {
          localWrites.push({
            mood: "ya",
            su: { name: outputHandleName },
            be: surfaced?.be ?? platform.actionSentence?.be ?? "result",
            ob: cloneValue(surfaced.ob)
          });
        }
        if (!(surfaced?.be === "error" && surfaced?.mood === "ya")) {
          if (!shouldSkipOutputContract({ outputContract: platform.outputContract, actionSentence: platform.actionSentence })) {
            validateOutputContract({
              outputContract: platform.outputContract,
              localWrites,
              refineryName: name,
              platformName: nextName
            });
          }
        }
        exportFacts = collectExportFacts({
          localWrites,
          autoExportNames: scopeFrame.autoExport,
          explicitExportNames: scopeFrame.exports
        });
        scopeSlots = readLocalSlotFacts(localWrites);
      } catch (err) {
        surfaced = normalizeRefineryError(err, {
          refineryName: name,
          platformName: nextName,
          actionSentence: platform.actionSentence
        });
      } finally {
        state.currentEvoke = prevEvoke;
        state.currentEvokeRef = prevEvokeRef;
        state.refineryScopeStack.pop();
        popMemoryContext();
      }
      if (surfaced?.be === "error" && surfaced?.mood === "ya") {
        if (attempt < retrySettings.maxAttempts) {
          const retrySentence = buildRetrySentence({
            refineryName: name,
            platformName: nextName,
            attempt: attempt + 1,
            message: surfaced?.ob?.text ?? "reiterate"
          });
          if (onRetry) onRetry(retrySentence);
          await sleepMs(delayMs);
          delayMs = Math.min(Math.trunc(delayMs * retrySettings.backoff), retrySettings.maxDelayMs);
          continue;
        }
        if (onResult) onResult(surfaced);
        return surfaced;
      }
      restoreExportFacts(exportFacts);
      lastExportFacts = exportFacts;
      lastScopeSlots = scopeSlots;
      if (surfaced?.mood) {
        if (onResult) onResult(surfaced);
        lastResult = surfaced;
      }
      const resultLine = sentenceToPyash(surfaced ?? platform.actionSentence);
      results.set(nextName, resultLine);
      const checkpointSentence = buildCheckpointSentence({
        refineryName: name,
        platformName: nextName,
        hash: checkpointHash,
        resultSentence: surfaced ?? platform.actionSentence,
        resultLine,
        exportFacts: lastExportFacts,
        scopeSlots: lastScopeSlots
      });
      if (checkpointEnabled && onCheckpoint) onCheckpoint(checkpointSentence);
      break;
    }
    completed.add(nextName);
    pending.delete(nextName);
  }
  return lastResult;
}

export function clearRefineries() {
  refineryRegistry.clear();
  refineryStack.length = 0;
}

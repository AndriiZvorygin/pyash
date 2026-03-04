import { remember, doRemember } from "../remember/index.mjs";
import { throwErrorSentence } from "../error.mjs";

async function resolveInterpret() {
  const mod = await import("../bridge/index.mjs");
  return mod.interpret;
}

async function resolveIsRefinery(name) {
  const mod = await import("../bridge/refinery.mjs");
  return Boolean(mod.getRefinery(name));
}

async function resolveRefineryTarget(name) {
  const mod = await import("../bridge/refinery.mjs");
  const fact = remember(name);
  const candidate =
    fact?.as?.name ??
    fact?.from?.name ??
    (fact?.be === "refinery" ? name : null) ??
    name;
  if (!candidate) return null;
  return mod.getRefinery(candidate) ? candidate : null;
}

function resolveTextFromValue(value) {
  if (!value || typeof value !== "object") return "";
  if (typeof value.text === "string") return value.text;
  if (value.name) {
    const fact = remember(value.name);
    return String(fact?.ob?.text ?? "");
  }
  return "";
}

function resolveFactText(name) {
  const fact = remember(name);
  return String(fact?.ob?.text ?? "");
}

function rememberText(name, text) {
  doRemember({
    mood: "ya",
    su: { name },
    ob: { text: String(text ?? "") },
    be: "text"
  });
}

function rememberNum(name, value) {
  doRemember({
    mood: "ya",
    su: { name },
    ob: { num: Number(value ?? 0) },
    be: "number"
  });
}

function rememberMap(name, map) {
  doRemember({
    mood: "ya",
    su: { name },
    ob: { map: map ?? {} },
    be: "map"
  });
}

function extractLastNonEmptyLine(text) {
  const lines = String(text ?? "")
    .split(/\r?\n/u)
    .map(line => line.trim())
    .filter(Boolean);
  return lines.length ? lines[lines.length - 1] : "";
}

function extractScore(line) {
  const matches = [...String(line ?? "").matchAll(/(?:^|[^0-9.])([01](?:\.\d+)?)(?![0-9.])/gu)];
  if (!matches.length) return null;
  const raw = matches[matches.length - 1][1];
  const score = Number(raw);
  if (!Number.isFinite(score)) return null;
  if (score < 0 || score > 1) return null;
  return score;
}

function parseVerdictFromLastLine(verifyText, minScore, maxScore) {
  const lastLine = extractLastNonEmptyLine(verifyText);
  const upper = lastLine.toUpperCase();
  if (/^PASS\b/u.test(upper)) {
    const score = 1;
    const passByScore =
      score >= minScore &&
      (maxScore === null || score <= maxScore);
    return { pass: passByScore, score, lastLine };
  }
  if (/^FAIL\b/u.test(upper)) return { pass: false, score: 0, lastLine };
  const score = extractScore(lastLine);
  if (score !== null) {
    const passByScore =
      score >= minScore &&
      (maxScore === null || score <= maxScore);
    return { pass: passByScore, score, lastLine };
  }
  return { pass: false, score: null, lastLine };
}

function countWords(text) {
  const matches = String(text ?? "").trim().match(/\S+/gu);
  return matches ? matches.length : 0;
}

const sentenceEndingConnector = /\b(?:and|or|but|so|because|if|when|while|than|that|which|who|whom|whose|a|an|the)\s*[.!?]*\s*$/iu;

function isSentenceComplete(text) {
  const trimmed = String(text ?? "").trim();
  const words = countWords(trimmed);
  const hasTerminalPunctuation = /[.!?]\s*$/u.test(trimmed);
  const hasContinuationPunctuation = /[,;:]\s*$/u.test(trimmed);
  const endsWithConnector = sentenceEndingConnector.test(trimmed);
  return (
    trimmed.length > 0 &&
    words > 0 &&
    !hasContinuationPunctuation &&
    !endsWithConnector &&
    hasTerminalPunctuation
  );
}

async function invokeMind({ mindName, prompt, outputName }) {
  const interpret = await resolveInterpret();
  const call = {
    mood: "do",
    be: "write",
    for: { name: mindName },
    ob: { text: String(prompt ?? "") },
    to: { name: outputName, nameTypeWords: ["text"] },
    by: { num: 0 }
  };
  await interpret(call);
  return resolveFactText(outputName);
}

async function invokeRefinery({ refineryName, prompt, outputName }) {
  const interpret = await resolveInterpret();
  await interpret({
    mood: "do",
    be: "refinery",
    from: { name: refineryName },
    ob: { text: String(prompt ?? "") },
    to: { name: outputName, nameTypeWords: ["text"] }
  });
  return resolveFactText(outputName);
}

async function invokeCeremony({ ceremonyName, prompt, outputName }) {
  const interpret = await resolveInterpret();
  await interpret({
    mood: "do",
    be: ceremonyName,
    ob: { text: String(prompt ?? "") },
    to: { name: outputName, nameTypeWords: ["text"] }
  });
  return resolveFactText(outputName);
}

async function invokePlatform({ platformName, prompt, outputName }) {
  const fact = remember(platformName);
  const isMind = fact?.be === "mind";
  if (isMind) {
    return invokeMind({ mindName: platformName, prompt, outputName });
  }
  const refineryTarget = await resolveRefineryTarget(platformName);
  const isRefinery = Boolean(refineryTarget ?? await resolveIsRefinery(platformName));
  if (isRefinery) {
    return invokeRefinery({
      refineryName: refineryTarget ?? platformName,
      prompt,
      outputName
    });
  }
  return invokeCeremony({ ceremonyName: platformName, prompt, outputName });
}

function buildVerifierPrompt({ task, candidate, verifierName }) {
  return [
    `Verifier: ${verifierName}`,
    "Evaluate whether CANDIDATE satisfies TASK.",
    "Output concise reasoning and make final non-empty line exactly PASS, FAIL, or a 0..1 score.",
    "",
    "TASK:",
    task,
    "",
    "CANDIDATE:",
    candidate
  ].join("\n");
}

function buildRetryPrompt({ task, candidate, verifierFeedback, checkFeedback }) {
  const verifierLines = (verifierFeedback ?? [])
    .map((row) => `${row.name}: ${row.lastLine || "FAIL"}`)
    .join("\n");
  const checkLines = (checkFeedback ?? [])
    .map((row) => `${row.name}: ${row.detail}`)
    .join("\n");
  return [
    "Revise candidate so every verifier and deterministic check passes.",
    "",
    "TASK:",
    task,
    "",
    "LAST CANDIDATE:",
    candidate,
    "",
    "VERIFIER RESULTS:",
    verifierLines || "none",
    "",
    "CHECK RESULTS:",
    checkLines || "none"
  ].join("\n");
}

function throwVerifyPlatformError(message, sentence) {
  throwErrorSentence({
    name: "verify platform defective",
    message,
    from: { name: "verify platform" },
    raw: { sentence }
  });
}

function resolveSeriesEntryName(entry) {
  if (!entry) return "";
  if (typeof entry === "string") return entry.trim();
  if (typeof entry?.ob?.name === "string" && entry.ob.name.trim()) return entry.ob.name.trim();
  if (typeof entry?.su?.name === "string" && entry.su.name.trim()) return entry.su.name.trim();
  if (typeof entry?.name === "string" && entry.name.trim()) return entry.name.trim();
  if (typeof entry?.ob?.text === "string" && entry.ob.text.trim()) return entry.ob.text.trim();
  return "";
}

function resolveVerifierNames(sentence) {
  const fromVector = Array.isArray(sentence?.among?.ve?.values)
    ? sentence.among.ve.values.map(value => String(value ?? "").trim()).filter(Boolean)
    : [];
  if (fromVector.length) return fromVector;

  const amongName = String(sentence?.among?.name ?? sentence?.among?.text ?? "").trim();
  if (!amongName) return [];
  const fact = remember(amongName);
  if (fact?.be === "series" && Array.isArray(fact?.ob?.series)) {
    return fact.ob.series
      .map(resolveSeriesEntryName)
      .filter(Boolean);
  }
  return [amongName];
}

function resolveCheckSeries(sentence) {
  const checksName = String(sentence?.accordingto?.name ?? "").trim();
  if (!checksName) return [];
  const fact = remember(checksName);
  if (!fact || fact.be !== "series" || !Array.isArray(fact?.ob?.series)) {
    throwVerifyPlatformError("verify platform defective: checks series missing", sentence);
  }
  return fact.ob.series;
}

function resolveCheckBool(value, sentence) {
  if (typeof value?.boolean === "boolean") return value.boolean;
  if (typeof value?.bool === "boolean") return value.bool;
  const text = String(value?.text ?? "").trim().toLowerCase();
  if (text === "truth") return true;
  if (text === "lie") return false;
  throwVerifyPlatformError("verify platform defective: sentence_complete check expects bool", sentence);
}

function resolveCheckNum(value, sentence, fieldName) {
  const raw = value?.num ?? Number(value?.text);
  const num = Number(raw);
  if (!Number.isFinite(num)) {
    throwVerifyPlatformError(`verify platform defective: ${fieldName} check expects num`, sentence);
  }
  return num;
}

function resolveCheckText(value, sentence, fieldName) {
  if (typeof value?.text === "string") return value.text;
  throwVerifyPlatformError(`verify platform defective: ${fieldName} check expects text`, sentence);
}

function evaluateDeterministicChecks(candidate, checks, sentence) {
  const rows = [];
  for (let index = 0; index < checks.length; index += 1) {
    const entry = checks[index] ?? {};
    const name = String(entry?.su?.name ?? "").trim().toLowerCase();
    let pass = false;
    let detail = "unknown";

    if (name === "word_min") {
      const min = resolveCheckNum(entry?.ob, sentence, "word_min");
      const words = countWords(candidate);
      pass = words >= min;
      detail = `words=${words} min=${min}`;
    } else if (name === "word_max") {
      const max = resolveCheckNum(entry?.ob, sentence, "word_max");
      const words = countWords(candidate);
      pass = words <= max;
      detail = `words=${words} max=${max}`;
    } else if (name === "sentence_complete") {
      const expected = resolveCheckBool(entry?.ob, sentence);
      const actual = isSentenceComplete(candidate);
      pass = expected ? actual : !actual;
      detail = `expected=${expected ? "truth" : "lie"} actual=${actual ? "truth" : "lie"}`;
    } else if (name === "distinct_from") {
      const line = resolveCheckText(entry?.ob, sentence, "distinct_from");
      pass = String(candidate ?? "").trim() !== String(line ?? "").trim();
      detail = "distinct check";
    } else if (name === "must_match_pattern") {
      const pattern = resolveCheckText(entry?.ob, sentence, "must_match_pattern");
      try {
        pass = new RegExp(pattern, "u").test(String(candidate ?? ""));
        detail = `pattern=${pattern}`;
      } catch {
        pass = false;
        detail = `pattern invalid=${pattern}`;
      }
    } else if (name === "must_not_match_pattern") {
      const pattern = resolveCheckText(entry?.ob, sentence, "must_not_match_pattern");
      try {
        pass = !new RegExp(pattern, "u").test(String(candidate ?? ""));
        detail = `pattern=${pattern}`;
      } catch {
        pass = false;
        detail = `pattern invalid=${pattern}`;
      }
    } else {
      throwVerifyPlatformError("verify platform defective: unknown deterministic check", sentence);
    }

    rows.push({
      index: index + 1,
      name,
      pass,
      detail
    });
  }
  return rows;
}

export async function verifyPlatform(sentence) {
  const task = resolveTextFromValue(sentence?.ob);
  const generatorName = String(sentence?.for?.name ?? sentence?.for?.text ?? "").trim();
  const outputName = String(sentence?.to?.name ?? "").trim();
  const verifierNames = resolveVerifierNames(sentence);
  const checkSeries = resolveCheckSeries(sentence);

  const minScore = Number.isFinite(Number(sentence?.atleast?.num))
    ? Number(sentence.atleast.num)
    : 0.8;
  const rawMaxScore = sentence?.atmost?.num;
  const maxScore = Number.isFinite(Number(rawMaxScore)) ? Number(rawMaxScore) : null;

  const fromIndex = Number.isFinite(Number(sentence?.fromindex?.num))
    ? Math.max(1, Math.trunc(Number(sentence.fromindex.num)))
    : 1;
  const toIndex = Number.isFinite(Number(sentence?.toindex?.num))
    ? Math.max(1, Math.trunc(Number(sentence.toindex.num)))
    : (sentence?.fromindex?.num !== undefined ? fromIndex : 3);

  if (!task) {
    throwVerifyPlatformError("verify platform defective: missing input text", sentence);
  }
  if (!generatorName) {
    throwVerifyPlatformError("verify platform defective: missing generator name", sentence);
  }
  if (!verifierNames.length) {
    throwVerifyPlatformError("verify platform defective: missing verifier selector", sentence);
  }
  if (toIndex < fromIndex) {
    throwVerifyPlatformError("verify platform defective: retry window invalid", sentence);
  }

  let latestPrompt = task;
  let finalDraft = "";
  let stopReason = "max retries";
  let attemptsUsed = 0;
  let lastVerifierFeedback = [];
  let lastCheckFeedback = [];

  for (let attempt = fromIndex; attempt <= toIndex; attempt += 1) {
    attemptsUsed += 1;
    const draftName = `verify platform draft ${attempt}`;
    finalDraft = await invokePlatform({
      platformName: generatorName,
      prompt: latestPrompt,
      outputName: draftName
    });

    let allVerifierPass = true;
    const verifierRows = [];
    for (let idx = 0; idx < verifierNames.length; idx += 1) {
      const verifierName = verifierNames[idx];
      const reviewPrompt = buildVerifierPrompt({
        task,
        candidate: finalDraft,
        verifierName
      });
      const reviewName = `verify platform verifier ${attempt} ${idx + 1}`;
      const verifyText = await invokePlatform({
        platformName: verifierName,
        prompt: reviewPrompt,
        outputName: reviewName
      });
      const verdict = parseVerdictFromLastLine(verifyText, minScore, maxScore);
      const row = {
        index: idx + 1,
        name: verifierName,
        pass: Boolean(verdict.pass),
        score: verdict.score,
        lastLine: verdict.lastLine,
        text: verifyText
      };
      verifierRows.push(row);
      if (!row.pass) allVerifierPass = false;
    }
    lastVerifierFeedback = verifierRows;

    let checkRows = [];
    let checksPass = true;
    if (allVerifierPass && checkSeries.length) {
      checkRows = evaluateDeterministicChecks(finalDraft, checkSeries, sentence);
      checksPass = checkRows.every(row => row.pass);
    }
    lastCheckFeedback = checkRows;

    if (allVerifierPass && checksPass) {
      stopReason = "pass";
      break;
    }

    latestPrompt = buildRetryPrompt({
      task,
      candidate: finalDraft,
      verifierFeedback: verifierRows,
      checkFeedback: checkRows
    });
    stopReason = attempt >= toIndex ? "max retries" : "retry";
  }

  const pass = stopReason === "pass";
  rememberNum("verify platform attempts used", attemptsUsed);
  rememberText("verify platform stop reason", stopReason);
  rememberMap("verify platform last verifier", { rows: lastVerifierFeedback });
  if (lastCheckFeedback.length) rememberMap("verify platform last checks", { rows: lastCheckFeedback });

  if (!pass) {
    throwVerifyPlatformError("verify platform defective: retries exhausted", sentence);
  }

  if (outputName) rememberText(outputName, finalDraft);
  return { ob: { text: finalDraft }, be: "text" };
}

const OB_TYPES = [
  ["text"],
  ["name", "text"]
];

const FOR_TYPES = [
  ["name", "mind"],
  ["name", "refinery"],
  ["name", "num"],
  ["text"]
];

const AMONG_TYPES = [
  ["name", "series"],
  ["name", "mind"],
  ["name", "refinery"],
  ["name", "num"],
  ["text"],
  ["vec", "name"]
];

const CHECK_TYPES = [
  null,
  ["name", "series"],
  ["name", "num"],
  ["text"]
];

function buildVerifyPlatformSignature({
  obType,
  forType,
  amongType,
  scoreMode,
  includeRetryRange,
  checkType
}) {
  const words = ["be", "verify", "platform"];
  if (checkType) words.push("accordingto", ...checkType);
  words.push("among", ...amongType);
  if (scoreMode === "atleast") words.push("atleast", "num");
  if (scoreMode === "atmost") words.push("atmost", "num");
  if (scoreMode === "both") words.push("atleast", "num", "atmost", "num");
  words.push("for", ...forType);
  if (includeRetryRange) words.push("fromindex", "num");
  words.push("ob", ...obType);
  words.push("to", "name", "text");
  if (includeRetryRange) words.push("toindex", "num");
  return words;
}

const signatureSet = new Set();
const signatureEntries = [];

for (const obType of OB_TYPES) {
  for (const forType of FOR_TYPES) {
    for (const amongType of AMONG_TYPES) {
      for (const scoreMode of ["none", "atleast", "atmost", "both"]) {
        for (const includeRetryRange of [false, true]) {
          for (const checkType of CHECK_TYPES) {
            const words = buildVerifyPlatformSignature({
              obType,
              forType,
              amongType,
              scoreMode,
              includeRetryRange,
              checkType
            });
            const key = words.join(" ");
            if (signatureSet.has(key)) continue;
            signatureSet.add(key);
            signatureEntries.push({ signatureWords: words, handler: verifyPlatform });
          }
        }
      }
    }
  }
}

export const signatures = signatureEntries;

export default verifyPlatform;

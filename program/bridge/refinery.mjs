import { surfaceErrorSentence, throwErrorSentence } from "../error.mjs";
import { remember } from "../remember/index.mjs";
import { sentenceToPyash } from "../beautiful.mjs";

const refineryRegistry = new Map();
const refineryStack = [];

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

function buildCheckpointHash(actionLine, depNames, depResults) {
  const parts = [`action:${actionLine}`];
  for (let i = 0; i < depNames.length; i += 1) {
    const name = depNames[i];
    const result = depResults[i] ?? "";
    parts.push(`dep:${name}:${result}`);
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

function buildCheckpointSentence({ refineryName, platformName, hash, resultSentence }) {
  return {
    mood: "ya",
    be: "checkpoint",
    su: { name: platformName },
    ob: { text: hash },
    from: { name: refineryName },
    to: { la: resultSentence }
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
  let actionSentence = null;
  if (sentence.from?.ve?.type === "name" && Array.isArray(sentence.from.ve.values)) {
    deps = sentence.from.ve.values.map((entry) => String(entry));
  } else if (sentence.from && (sentence.from.filename || sentence.from.text || sentence.from.name)) {
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
  if (priorName && !deps.includes(priorName)) deps = [...deps, priorName];
  actionSentence = { ...sentence };
  if (actionSentence.from?.ve?.type === "name") delete actionSentence.from;
  frame.platforms.set(name, { deps, actionSentence });
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
    if (typeof resume.decision === "boolean") {
      decision = resume.decision ? "truth" : "lie";
    } else if (typeof resume.decision === "string") {
      decision = resume.decision.toLowerCase();
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
      decisionName: parsed.decision || null
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
    const checkpointHash = buildCheckpointHash(actionLine, sortedDeps, depResults);
    const checkpointMap = checkpointIndex?.get(name);
    const checkpointRecord = checkpointEnabled ? checkpointMap?.get(nextName) : null;
    if (checkpointEnabled && checkpointRecord?.hash === checkpointHash) {
      const resultSentence = checkpointRecord.resultSentence;
      const resultLine = checkpointRecord.resultLine ?? sentenceToPyash(resultSentence);
      results.set(nextName, resultLine);
      const checkpointSentence = buildCheckpointSentence({
        refineryName: name,
        platformName: nextName,
        hash: checkpointHash,
        resultSentence
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
    while (attempt < retrySettings.maxAttempts) {
      attempt += 1;
      try {
        result = await interpret(platform.actionSentence);
      } catch (err) {
        result = surfaceErrorSentence(err?.sentence ?? err);
      }
      const resultSentence = resolveResultSentence(result, platform.actionSentence);
      const surfaced = surfaceErrorSentence(resultSentence);
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
        resultSentence: surfaced ?? platform.actionSentence
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

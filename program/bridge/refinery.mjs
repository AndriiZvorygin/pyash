import { surfaceErrorSentence, throwErrorSentence } from "../error.mjs";

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
  if (sentence?.mood !== "ya" || sentence?.be !== "platform") {
    throwErrorSentence({
      name: "platform defective",
      message: "platform declaration must be be platform ya",
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
  const deps = sentence.from ? assertNameVector(sentence.from) : [];
  const actionSentence = assertPlatformAction(sentence.ob);
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

export async function runRefinery({ name, interpret, onEvoke, onResult } = {}) {
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
  let lastResult = null;

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
    let result;
    try {
      result = await interpret(platform.actionSentence);
    } catch (err) {
      const sentence = surfaceErrorSentence(err?.sentence ?? err);
      if (onResult) onResult(sentence);
      return sentence;
    }
    const surfaced = surfaceErrorSentence(result);
    if (onResult) onResult(surfaced);
    lastResult = surfaced;
    if (surfaced?.be === "error" && surfaced?.mood === "ya") {
      return surfaced;
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

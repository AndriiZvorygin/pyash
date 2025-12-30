import { throwErrorSentence } from "../error.mjs";

const refineryRegistry = new Map();
const refineryStack = [];

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

export function clearRefineries() {
  refineryRegistry.clear();
  refineryStack.length = 0;
}

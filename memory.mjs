// memory.mjs

// global state store (facts / variables)
const memory = [];

// global log of every sentence interpreted
const history = [];

export function setMemory(sentence) {
  const existing = memory.find(
    s => s.subj?.name === sentence.subj?.name && s.be === sentence.be
  );
  if (existing) Object.assign(existing, sentence);
  else memory.push(sentence);
}

export function getMemory(name) {
  return memory.find(s => s.subj?.name === name);
}

export function dumpMemory() {
  return memory;
}

// --- NEW: history / log ---

export function logSentence(sentence) {
  history.push(sentence);
}

export function dumpHistory() {
  return history;
}

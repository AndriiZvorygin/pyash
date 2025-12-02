// memory.mjs
import { clearSignatureDefinitions } from "../bridge/signature.mjs";

let memory = [];
let history = []; // optional, for debugging / REPL
const definitionIndex = [];
const contextStack = [];

let sandpits = [];

function findDefinitionSlot(name) {
  let low = 0;
  let high = definitionIndex.length;

  while (low < high) {
    const mid = (low + high) >> 1;
    const cmp = definitionIndex[mid].name.localeCompare(name);
    if (cmp === 0) return mid;
    if (cmp < 0) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }

  return low; // insertion point
}

function upsertDefinition(name, index, end = undefined) {
  const slot = findDefinitionSlot(name);
  if (definitionIndex[slot]?.name === name) {
    const prevEnd = definitionIndex[slot].end;
    definitionIndex[slot] = { name, index, end: end ?? prevEnd };
  } else {
    definitionIndex.splice(slot, 0, { name, index, end });
  }
}

function isInsideDefinition(idx) {
  for (const entry of definitionIndex) {
    if (typeof entry.end === "number" && idx >= entry.index && idx <= entry.end) {
      return true;
    }
  }
  return false;
}

function adjustDefinitionIndices(removedIdx) {
  for (const entry of definitionIndex) {
    if (entry.index > removedIdx) entry.index -= 1;
    if (typeof entry.end === "number" && entry.end > removedIdx) entry.end -= 1;
  }
}

export function doRemember(sentence) {
  if (!sentence) return;

  const subjName = sentence.subj?.name;
  const isDef = sentence.mood === "def";
  const isPrah = sentence.mood === "prah";

  // For non-def/prah sentences with a subject, replace the most recent
  // non-def/prah entry for that subject instead of appending, to keep
  // last-write wins without pruning def/prah blocks. Removed entries
  // shift definition indexes accordingly. New fact is appended to
  // preserve chronological order after the triggering command.
  if (subjName && !isDef && !isPrah && sentence.mood !== "then") {
    for (let i = memory.length - 1; i >= 0; i--) {
      const existing = memory[i];
      if (existing.subj?.name !== subjName) continue;
      if (existing.mood === "def" || existing.mood === "prah") break;
      if (isInsideDefinition(i)) continue; // protect entries recorded inside def/prah blocks
      memory.splice(i, 1);
      adjustDefinitionIndices(i);
      break;
    }
  }

  const idx = memory.length;
  memory.push(sentence);
  if (isDef && subjName) {
    upsertDefinition(subjName, idx);
  }
  if (isPrah && subjName) {
    const slot = findDefinitionSlot(subjName);
    if (definitionIndex[slot]?.name === subjName) {
      definitionIndex[slot] = { ...definitionIndex[slot], end: idx };
    }
  }

  history.push(sentence);

}

export function remember(name) {
  if (!name) return undefined;
  for (let i = memory.length - 1; i >= 0; i--) {
    const s = memory[i];
    if (s.subj?.name === name) return s;
  }
  return undefined;
}

export function allRemember() {
  return memory;
}

export function dumpHistory() {
  return history;
}

export function getDefinition(name) {
  if (!name) return undefined;
  const slot = findDefinitionSlot(name);
  const entry = definitionIndex[slot];
  if (!entry || entry.name !== name) return undefined;
  return memory[entry.index];
}

export function getDefinitionEntry(name) {
  if (!name) return undefined;
  const slot = findDefinitionSlot(name);
  const entry = definitionIndex[slot];
  if (!entry || entry.name !== name) return undefined;
  return entry;
}

export function dumpDefinitionIndex() {
  return definitionIndex;
}

export function forget() {
  memory = [];
  history = [];
  definitionIndex.length = 0;
  contextStack.length = 0;
  sandpits = [];
  clearSignatureDefinitions();
}

export function pushMemoryContext({ seedFromCurrent = false } = {}) {
  contextStack.push({ memory, history });
  memory = seedFromCurrent ? [...memory] : [];
  history = [];
}

export function popMemoryContext() {
  const ctx = contextStack.pop();
  if (ctx) {
    memory = ctx.memory;
    history = ctx.history;
  }
}

export function recordSandpitTrace(trace) {
  sandpits.push(trace);
}

export function dumpSandpits() {
  return sandpits;
}

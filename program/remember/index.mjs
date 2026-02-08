// memory.mjs
import { clearSignatureDefinitions, joinSignatureWords } from "../bridge/signature.mjs";
import { state } from "../bridge/state.mjs";
import { clearModuleCache } from "../bridge/modules.mjs";
import { clearRefineries } from "../bridge/refinery.mjs";

let memory = [];
let history = []; // optional, for debugging / REPL
const definitionIndex = new Map(); // name -> [{ name, index, end, signatureKey }]
const contextStack = [];
const defaults = new Map();

let sandpits = [];

function upsertDefinition(name, index, end = undefined, signatureWords = null) {
  const entries = definitionIndex.get(name) ?? [];
  const signatureKey = Array.isArray(signatureWords) && signatureWords.length
    ? joinSignatureWords(signatureWords)
    : undefined;
  entries.push({ name, index, end, signatureKey });
  definitionIndex.set(name, entries);
}

function closeDefinition(name, endIdx) {
  const entries = definitionIndex.get(name);
  if (!entries) return;
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    if (typeof entries[i].end !== "number") {
      entries[i].end = endIdx;
      break;
    }
  }
}

function isInsideDefinition(idx) {
  for (const entries of definitionIndex.values()) {
    for (const entry of entries) {
      if (typeof entry.end === "number" && idx >= entry.index && idx <= entry.end) {
        return true;
      }
    }
  }
  return false;
}

function adjustDefinitionIndices(removedIdx) {
  for (const entries of definitionIndex.values()) {
    for (const entry of entries) {
      if (entry.index > removedIdx) entry.index -= 1;
      if (typeof entry.end === "number" && entry.end > removedIdx) entry.end -= 1;
    }
  }
}

export function doRemember(sentence) {
  if (!sentence) return;

  const subjName = sentence.su?.name;
  const isDef = sentence.mood === "def";
  const isPrah = sentence.mood === "prah";

  // Sandpits run in a temporary memory context (see `pushMemoryContext`). In that mode we must not
  // splice the shared memory array because doing so would corrupt the global `definitionIndex`
  // (which is not context-scoped today). Sandpit semantics can rely on `remember()` scanning from
  // the end for last-write-wins, so appending is sufficient.
  const isSandpit = contextStack.length > 0;

  // For non-def/prah sentences with a subject, replace the most recent
  // non-def/prah entry for that subject instead of appending, to keep
  // last-write wins without pruning def/prah blocks. Removed entries
  // shift definition indexes accordingly. New fact is appended to
  // preserve chronological order after the triggering command.
  const isDefinitionRecording = state.definitionStack.length > 0 && !state.executingBody;
  if (!isSandpit && !isDefinitionRecording && subjName && !isDef && !isPrah && sentence.mood !== "then" && sentence.mood !== "do") {
    for (let i = memory.length - 1; i >= 0; i--) {
      const existing = memory[i];
      if (existing.su?.name !== subjName) continue;
      if (existing.mood === "def" || existing.mood === "prah") break;
      if (existing.mood === "do") continue;
      if (isInsideDefinition(i)) continue; // protect entries recorded inside def/prah blocks
      memory.splice(i, 1);
      adjustDefinitionIndices(i);
      break;
    }
  }

  const idx = memory.length;
  memory.push(sentence);
  if (isDef && subjName) {
    upsertDefinition(subjName, idx, undefined, sentence.signatureWords ?? null);
  }
  if (isPrah && subjName) {
    closeDefinition(subjName, idx);
  }

  history.push(sentence);

}

export function remember(name) {
  if (!name) return undefined;
  for (let i = memory.length - 1; i >= 0; i--) {
    const s = memory[i];
    if (isInsideDefinition(i) && s.mood !== "def" && s.mood !== "prah") continue;
    if (s.mood === "do") continue;
    if (s.su?.name === name) return s;
  }
  return defaults.get(name);
}

export function allRemember() {
  return memory;
}

export function dumpHistory() {
  return history;
}

export function getDefinition(name) {
  if (!name) return undefined;
  const entry = getDefinitionEntry(name);
  if (!entry) return undefined;
  return memory[entry.index];
}

export function getDefinitionEntry(name) {
  if (!name) return undefined;
  const entries = definitionIndex.get(name);
  if (!entries || entries.length === 0) return undefined;
  return entries[entries.length - 1];
}

export function getDefinitionEntries(name) {
  if (!name) return [];
  return definitionIndex.get(name) ?? [];
}

export function getDefinitionEntryBySignature(name, signatureWordsOrKey) {
  if (!name || !signatureWordsOrKey) return undefined;
  const entries = definitionIndex.get(name);
  if (!entries || entries.length === 0) return undefined;
  const key = Array.isArray(signatureWordsOrKey)
    ? joinSignatureWords(signatureWordsOrKey)
    : String(signatureWordsOrKey);
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    if (entries[i].signatureKey === key) return entries[i];
  }
  return undefined;
}

export function getDefinitionBody(name) {
  if (!name) return [];
  const entry = getDefinitionEntry(name);
  if (!entry) return [];
  const start = entry.index + 1;
  const end = typeof entry.end === "number" ? entry.end : memory.length;
  if (end <= start) return [];
  return memory.slice(start, end);
}

export function dumpDefinitionIndex() {
  const list = [];
  for (const [name, entries] of definitionIndex.entries()) {
    const entry = entries[entries.length - 1];
    if (entry) list.push(entry);
  }
  return list.sort((a, b) => a.name.localeCompare(b.name));
}

export function forget() {
  memory = [];
  history = [];
  definitionIndex.clear();
  contextStack.length = 0;
  sandpits = [];
  defaults.clear();
  clearSignatureDefinitions();
  clearModuleCache();
  clearRefineries();
  state.lastCondition = true;
  state.definitionStack.length = 0;
  state.mapStack.length = 0;
  state.currentEvoke = null;
  state.currentEvokeRef = null;
  state.executingBody = false;
  state.refineryScopeStack.length = 0;
}

export function setDefault(name, sentence) {
  if (!name || !sentence) return;
  defaults.set(name, sentence);
}

export function clearDefaults() {
  defaults.clear();
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

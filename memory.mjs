// memory.mjs
const memory = [];
const history = []; // optional, for debugging / REPL
const definitionIndex = [];

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

export function setMemory(sentence) {
  const idx = memory.length;
  memory.push(sentence);
  history.push(sentence);

  if (sentence?.mood === "def" && sentence.subj?.name) {
    upsertDefinition(sentence.subj.name, idx);
  }

  if (sentence?.mood === "prah" && sentence.subj?.name) {
    const slot = findDefinitionSlot(sentence.subj.name);
    if (definitionIndex[slot]?.name === sentence.subj.name) {
      definitionIndex[slot] = { ...definitionIndex[slot], end: idx };
    }
  }
}

export function getMemory(name) {
  if (!name) return undefined;
  for (let i = memory.length - 1; i >= 0; i--) {
    const s = memory[i];
    if (s.subj?.name === name) return s;
  }
  return undefined;
}

export function dumpMemory() {
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

export function resetMemory() {
  memory.length = 0;
  // you can also clear history here if you want a “hard reset”
  // history.length = 0;
  definitionIndex.length = 0;
}

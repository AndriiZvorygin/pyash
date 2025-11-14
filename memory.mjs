// memory.mjs
const memory = [];
const history = []; // optional, for debugging / REPL

export function setMemory(sentence) {
  memory.push(sentence);
  history.push(sentence);
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

export function resetMemory() {
  memory.length = 0;
  // you can also clear history here if you want a “hard reset”
  // history.length = 0;
}

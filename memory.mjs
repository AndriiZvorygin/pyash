// memory.mjs
const memory = [];

export function setMemory(sentence) {
  // append-only: keep all versions, like a log
  memory.push(sentence);
}

// search from the end so the last matching fact wins
export function getMemory(name) {
  for (let i = memory.length - 1; i >= 0; i--) {
    if (memory[i].subj?.name === name) {
      return memory[i];
    }
  }
  return undefined;
}

export function dumpMemory() {
  return memory;
}

// handy for tests / REPL reset
export function resetMemory() {
  memory.length = 0;
}


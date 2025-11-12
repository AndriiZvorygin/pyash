// global memory store
const memory = [];

export function setMemory(sentence) {
  const existing = memory.find(s => s.subj?.name === sentence.subj?.name && s.be === sentence.be);
  if (existing) Object.assign(existing, sentence);
  else memory.push(sentence);
}

export function getMemory(name) {
  return memory.find(s => s.subj?.name === name);
}

export function dumpMemory() {
  return memory;
}

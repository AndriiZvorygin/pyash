const CASE_FIELDS = ["ob", "to", "from", "with", "by", "at", "as", "accordingto"];

function addName(set, value) {
  if (typeof value?.name === "string" && value.name.trim()) set.add(value.name.trim());
}

export function deriveSentenceEffects(sentence) {
  const reads = new Set();
  const writes = new Set();
  addName(writes, sentence?.su);

  for (const field of CASE_FIELDS) {
    const value = sentence?.[field];
    if (!value || typeof value !== "object") continue;
    if (field === "to" && sentence?.be !== "remains") {
      addName(writes, value);
      if (["plus", "subtract", "multiply", "divide", "invert"].includes(sentence?.be)) {
        addName(reads, value);
      }
      continue;
    }
    if (field === "from" && ["subtract", "plus", "multiply", "divide"].includes(sentence?.be)) {
      addName(writes, value);
      addName(reads, value);
      continue;
    }
    addName(reads, value);
  }

  return {
    reads: [...reads].sort(),
    writes: [...writes].sort(),
    sideEffect: ["command", "read", "write", "repair", "interpret"].includes(sentence?.be)
  };
}

export function analyzeCodeletDependencies(instructions) {
  if (!Array.isArray(instructions)) {
    throw new TypeError("codelet dependency analysis requires an array");
  }
  const fulfilled = new Set();
  return instructions.map((instruction, index) => {
    const effects = instruction?.effects ?? deriveSentenceEffects(instruction?.sentence ?? instruction);
    const dependencies = effects.reads.filter((name) => !fulfilled.has(name));
    effects.writes.forEach((name) => fulfilled.add(name));
    return {
      index,
      reads: effects.reads,
      writes: effects.writes,
      dependencies,
      ready: dependencies.length === 0,
      sideEffect: effects.sideEffect
    };
  });
}

const CASE_FIELDS = ["ob", "to", "from", "with", "by", "at", "as", "accordingto"];

function addName(set, value) {
  if (typeof value?.name === "string" && value.name.trim()) set.add(value.name.trim());
}

function dependencyError(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  return error;
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

export function scheduleCodeletDependencies(instructions) {
  if (!Array.isArray(instructions)) {
    throw new TypeError("codelet dependency scheduling requires an array");
  }

  const analysis = instructions.map((instruction, index) => {
    const effects = instruction?.effects ?? deriveSentenceEffects(instruction?.sentence ?? instruction);
    return {
      index,
      instruction,
      reads: effects.reads,
      writes: effects.writes,
      sideEffect: effects.sideEffect,
      dependencies: new Set()
    };
  });
  const writers = new Map();
  for (const entry of analysis) {
    for (const name of entry.writes) {
      if (writers.has(name)) {
        throw dependencyError("duplicate-writer", "multiple codelets write " + name, {
          name,
          first: writers.get(name),
          second: entry.index
        });
      }
      writers.set(name, entry.index);
    }
  }

  for (const entry of analysis) {
    for (const name of entry.reads) {
      const writer = writers.get(name);
      if (writer === undefined) {
        throw dependencyError("unfulfilled-dependency", "codelet reads unfulfilled reference " + name, {
          name,
          index: entry.index
        });
      }
      if (writer !== entry.index) entry.dependencies.add(writer);
    }
  }

  let previousSideEffect = null;
  for (const entry of analysis) {
    if (entry.sideEffect && previousSideEffect !== null) {
      entry.dependencies.add(previousSideEffect);
    }
    if (entry.sideEffect) previousSideEffect = entry.index;
  }
  const pending = new Set(analysis.map((entry) => entry.index));
  const order = [];
  while (pending.size) {
    const ready = [...pending].find((index) => (
      [...analysis[index].dependencies].every((dependency) => !pending.has(dependency))
    ));
    if (ready === undefined) {
      throw dependencyError("cyclic-dependency", "codelet dependencies contain a cycle", {
        pending: [...pending]
      });
    }
    pending.delete(ready);
    order.push(analysis[ready]);
  }

  return order.map((entry, scheduleIndex) => ({
    index: entry.index,
    scheduleIndex,
    instruction: entry.instruction,
    reads: entry.reads,
    writes: entry.writes,
    dependencies: [...entry.dependencies].sort((left, right) => left - right),
    sideEffect: entry.sideEffect
  }));
}

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
  const orderedWrites = new Set();
  if (sentence?.mood === "que") addName(reads, sentence?.su);
  else addName(writes, sentence?.su);

  for (const field of CASE_FIELDS) {
    const value = sentence?.[field];
    if (!value || typeof value !== "object") continue;
    if (sentence?.mood === "que" && field === "ob" && value.name === "what") continue;
    if (field === "to" && sentence?.be !== "remains") {
      addName(writes, value);
      if (["plus", "subtract", "multiply", "divide", "invert"].includes(sentence?.be)) {
        addName(reads, value);
        addName(orderedWrites, value);
      }
      continue;
    }
    if (field === "from" && ["subtract", "plus", "multiply", "divide"].includes(sentence?.be)) {
      addName(writes, value);
      addName(reads, value);
      addName(orderedWrites, value);
      continue;
    }
    addName(reads, value);
  }

  const effects = {
    reads: [...reads].sort(),
    writes: [...writes].sort(),
    sideEffect: ["command", "read", "write", "repair", "interpret"].includes(sentence?.be)
  };
  if (orderedWrites.size) effects.orderedWrites = [...orderedWrites].sort();
  return effects;
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
      orderedWrites: effects.orderedWrites ?? [],
      sideEffect: effects.sideEffect,
      dependencies: new Set()
    };
  });
  const writers = new Map();
  for (const entry of analysis) {
    for (const name of entry.writes) {
      if (!writers.has(name)) writers.set(name, []);
      writers.get(name).push(entry);
    }
  }

  for (const [name, entries] of writers) {
    for (let index = 1; index < entries.length; index += 1) {
      const previous = entries[index - 1];
      const current = entries[index];
      if (!current.orderedWrites.includes(name)) {
        throw dependencyError("duplicate-writer", "multiple codelets write " + name, {
          name,
          first: previous.index,
          second: current.index
        });
      }
      current.dependencies.add(previous.index);
    }
  }

  for (const entry of analysis) {
    for (const name of entry.reads) {
      const candidates = (writers.get(name) ?? []).filter((writer) => writer.index !== entry.index);
      const prior = candidates.filter((writer) => writer.index < entry.index);
      const producer = prior.at(-1) ?? candidates[0];
      if (!producer) {
        throw dependencyError("unfulfilled-dependency", "codelet reads unfulfilled reference " + name, {
          name,
          index: entry.index
        });
      }
      entry.dependencies.add(producer.index);
      for (const writer of candidates) {
        if (writer.index > Math.max(entry.index, producer.index)) {
          writer.dependencies.add(entry.index);
        }
      }
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
    orderedWrites: entry.orderedWrites,
    dependencies: [...entry.dependencies].sort((left, right) => left - right),
    sideEffect: entry.sideEffect
  }));
}

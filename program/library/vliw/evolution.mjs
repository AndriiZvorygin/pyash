import {
  MAX_FUNCTION_INSTRUCTIONS,
  compareVliwFitness,
  normalizeVliwFunction,
  scoreVliwFunction
} from "./functions.mjs";
import { createHousekeeperVliwBatchEvaluator } from "./housekeeper.mjs";
import { parseVliwFunctionSource, renderVliwFunctionSource } from "./source.mjs";

export const MAX_VLIW_POPULATION = 256;
export const MAX_VLIW_GENERATIONS = 31;

function makeRandom(seed) {
  let state = Number(seed) >>> 0;
  if (state === 0) state = 0x9e3779b9;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0x100000000;
  };
}

function choose(random, values) {
  return values[Math.floor(random() * values.length)];
}

function candidateId(generation, index) {
  return `candidate-${String(generation).padStart(3, "0")}-${String(index).padStart(4, "0")}`;
}

function candidateFrom(template, id, instructions) {
  return {
    id,
    schemaVersion: 1,
    name: template.name,
    slots: [...template.slots],
    inputSlots: [...template.inputSlots],
    outputSlot: template.outputSlot,
    instructions: instructions.map((instruction) => ({ ...instruction }))
  };
}

function initialPopulation(template, populationSize, random) {
  const [left, right] = template.inputSlots;
  const firstOps = ["plus", "subtract", "xor"];
  const population = firstOps.slice(0, populationSize).map((op, index) => candidateFrom(
    template,
    candidateId(0, index),
    [{ op, target: template.outputSlot, left, right }]
  ));
  while (population.length < populationSize) {
    const count = 1 + Math.floor(random() * Math.min(5, MAX_FUNCTION_INSTRUCTIONS));
    const instructions = Array.from({ length: count }, () => ({
      op: choose(random, firstOps),
      target: choose(random, template.slots),
      left: choose(random, template.slots),
      right: choose(random, template.slots)
    }));
    population.push(candidateFrom(template, candidateId(0, population.length), instructions));
  }
  return population;
}

function mutate(parent, template, id, random) {
  const instructions = parent.instructions.map((instruction) => ({ ...instruction }));
  const mutation = random();
  if (mutation < 0.18 && instructions.length < MAX_FUNCTION_INSTRUCTIONS) {
    instructions.splice(Math.floor(random() * (instructions.length + 1)), 0, {
      op: choose(random, ["plus", "subtract", "xor"]),
      target: choose(random, template.slots),
      left: choose(random, template.slots),
      right: choose(random, template.slots)
    });
  } else if (mutation < 0.32 && instructions.length > 1) {
    instructions.splice(Math.floor(random() * instructions.length), 1);
  } else {
    const instruction = instructions[Math.floor(random() * instructions.length)];
    const field = choose(random, ["op", "target", "left", "right"]);
    instruction[field] = field === "op"
      ? choose(random, ["plus", "subtract", "xor"])
      : choose(random, template.slots);
  }
  return candidateFrom(template, id, instructions);
}

function normalizeBatchScores(candidates, scores) {
  if (!Array.isArray(scores)) throw new Error("VLIW batch evaluator must return a score array");
  const byId = new Map(scores.map((score) => [String(score?.id ?? ""), score]));
  return candidates.map((candidate) => {
    const score = byId.get(candidate.id);
    if (!score) throw new Error(`VLIW batch evaluator omitted ${candidate.id}`);
    const values = [score.incorrectCount, score.totalAbsoluteError, score.instructionCount].map(Number);
    if (values.some((value) => !Number.isInteger(value) || value < 0)) {
      throw new Error(`VLIW batch evaluator returned an invalid fitness for ${candidate.id}`);
    }
    let outputs = null;
    if (Array.isArray(score.outputs)) {
      outputs = score.outputs.map(Number);
      if (outputs.some((value) => !Number.isInteger(value) || value < 0 || value > 0xffff)) {
        throw new Error(`VLIW batch evaluator returned invalid outputs for ${candidate.id}`);
      }
    }
    return {
      candidate,
      outputs,
      fitness: {
        incorrectCount: values[0],
        totalAbsoluteError: values[1],
        instructionCount: values[2]
      }
    };
  }).sort((left, right) => compareVliwFitness(left.fitness, right.fitness)
    || left.candidate.id.localeCompare(right.candidate.id));
}

function generationPopulation(ranked, template, populationSize, generation, random) {
  const eliteCount = Math.max(1, Math.ceil(populationSize * 0.2));
  const elites = ranked.slice(0, eliteCount);
  const next = elites.map((entry, index) => candidateFrom(
    template,
    candidateId(generation, index),
    entry.candidate.instructions
  ));
  while (next.length < populationSize) {
    const parent = choose(random, elites).candidate;
    next.push(mutate(parent, template, candidateId(generation, next.length), random));
  }
  return next;
}

function batchPayload(template, cases, candidates) {
  return {
    schemaVersion: 1,
    slots: template.slots,
    inputSlots: template.inputSlots,
    outputSlot: template.outputSlot,
    cases,
    candidates: candidates.map((candidate) => ({ id: candidate.id, instructions: candidate.instructions }))
  };
}

/**
 * Run bounded semantic mutation/search. `evaluateBatch` is the platform seam:
 * production callers submit this batch through Pyash's durable Housekeeper queue.
 */
export async function evolveVliwFunction({
  template: rawTemplate,
  trainingCases,
  heldoutCases,
  evaluateBatch,
  populationSize = 64,
  generations = 16,
  seed = 1
} = {}) {
  if (typeof evaluateBatch !== "function") {
    throw new Error("VLIW evolution requires a Housekeeper-backed evaluateBatch callback");
  }
  const template = normalizeVliwFunction({ ...rawTemplate, instructions: rawTemplate?.instructions ?? [{
    op: "plus",
    target: rawTemplate?.outputSlot,
    left: rawTemplate?.inputSlots?.[0],
    right: rawTemplate?.inputSlots?.[1]
  }] });
  if (!Array.isArray(trainingCases) || trainingCases.length === 0) {
    throw new Error("VLIW evolution requires training cases");
  }
  if (!Array.isArray(heldoutCases) || heldoutCases.length === 0) {
    throw new Error("VLIW evolution requires deterministic held-out cases");
  }
  const size = Math.trunc(Number(populationSize));
  const count = Math.trunc(Number(generations));
  if (size < 3 || size > MAX_VLIW_POPULATION) {
    throw new Error(`VLIW population size must be 3 through ${MAX_VLIW_POPULATION}`);
  }
  if (count < 1 || count > MAX_VLIW_GENERATIONS) {
    throw new Error(`VLIW generation count must be 1 through ${MAX_VLIW_GENERATIONS}`);
  }

  const random = makeRandom(seed);
  let population = initialPopulation(template, size, random);
  const history = [];
  let champion = null;
  for (let generation = 0; generation < count; generation += 1) {
    const scores = await evaluateBatch(batchPayload(template, trainingCases, population));
    const ranked = normalizeBatchScores(population, scores);
    champion = ranked[0];
    history.push({
      generation,
      best: { ...champion.fitness, candidateId: champion.candidate.id }
    });
    if (champion.fitness.incorrectCount === 0) break;
    population = generationPopulation(ranked, template, size, generation + 1, random);
  }

  const heldoutScores = await evaluateBatch(batchPayload(template, heldoutCases, [champion.candidate]));
  const heldout = normalizeBatchScores([champion.candidate], heldoutScores)[0];
  return {
    schemaVersion: 1,
    seed: Number(seed) >>> 0,
    generationsCompleted: history.length,
    history,
    candidate: champion.candidate,
    trainingFitness: champion.fitness,
    heldoutFitness: heldout.fitness,
    trainingOutputs: champion.outputs,
    heldoutOutputs: heldout.outputs,
    validated: heldout.fitness.incorrectCount === 0
  };
}

export async function evolveVliwFunctionThroughHousekeeper({
  housekeeper = {},
  ...options
} = {}) {
  return evolveVliwFunction({
    ...options,
    evaluateBatch: createHousekeeperVliwBatchEvaluator(housekeeper)
  });
}

function verifyReferenceOutputs(candidate, cases, expectedFitness, actualOutputs, label) {
  const reference = scoreVliwFunction(candidate, cases);
  const referenceOutputs = reference.results.map(({ actual }) => actual);
  if (!Array.isArray(actualOutputs) || actualOutputs.length !== referenceOutputs.length
    || actualOutputs.some((value, index) => value !== referenceOutputs[index])) {
    throw new Error(`Housekeeper ${label} outputs disagree with the CPU reference`);
  }
  const referenceFitness = {
    incorrectCount: reference.incorrectCount,
    totalAbsoluteError: reference.totalAbsoluteError,
    instructionCount: reference.instructionCount
  };
  if (compareVliwFitness(referenceFitness, expectedFitness) !== 0) {
    throw new Error(`Housekeeper ${label} fitness disagrees with the CPU reference`);
  }
  return { fitness: referenceFitness, outputs: referenceOutputs };
}

/** Parse, evolve through Housekeeper, and compare exact per-case outputs with the CPU reference. */
export async function evolveVliwFunctionSourceThroughHousekeeper({
  sourceText,
  functionName = "",
  housekeeper = {},
  ...options
} = {}) {
  const source = parseVliwFunctionSource(sourceText, { functionName });
  const result = await evolveVliwFunctionThroughHousekeeper({
    ...options,
    housekeeper,
    template: source.definition,
    trainingCases: source.trainingCases,
    heldoutCases: source.heldoutCases
  });
  const cpuTraining = verifyReferenceOutputs(
    result.candidate,
    source.trainingCases,
    result.trainingFitness,
    result.trainingOutputs,
    "training"
  );
  const cpuHeldout = verifyReferenceOutputs(
    result.candidate,
    source.heldoutCases,
    result.heldoutFitness,
    result.heldoutOutputs,
    "held-out"
  );
  return {
    ...result,
    validated: result.validated
      && cpuTraining.fitness.incorrectCount === 0
      && cpuHeldout.fitness.incorrectCount === 0,
    cpuReference: {
      trainingFitness: cpuTraining.fitness,
      trainingOutputs: cpuTraining.outputs,
      heldoutFitness: cpuHeldout.fitness,
      heldoutOutputs: cpuHeldout.outputs
    },
    candidateSourcePya: renderVliwFunctionSource({
      definition: result.candidate,
      trainingCases: source.trainingCases,
      heldoutCases: source.heldoutCases
    })
  };
}

import { splitSentences, splitSentencesWithLines } from "../sentenceSplitter.mjs";
import { parse } from "../../understand/index.mjs";
import { allRemember, doRemember, forget, remember } from "../../remember/index.mjs";
import { decodePyashProgram, lowerPyashProgram } from "./sentence.mjs";
import { decodePyacPack, encodePyacPack } from "./database.mjs";
import { lookupLegacyWordSequence } from "./quotes.mjs";
import { state as bridgeState } from "../../bridge/state.mjs";
import {
  isNamedNumericSlotDeclaration,
  namedNumericSlotKind
} from "../named_numeric_slot.mjs";

export const DEFAULT_PYASH_PROGRAMLET_STEP_BUDGET = 65_536;
export const MAX_PYASH_PROGRAMLET_STEP_BUDGET = 10_000_000;
const MAX_PYASH_PROGRAMLET_CODELETS = 64;
const MAX_PYASH_PROGRAM_SECTIONS = 64;
const MAX_PYASH_SECTION_NAME_WORDS = 8;
const SECTION_VERBS = new Set(["myocpfun", "myoc pfun", "module partially"]);

const PURE_BUILTIN_VERBS = new Set([
  "remains",
  "boolean",
  "equally",
  "tiny",
  "giant",
  "plus",
  "subtract",
  "multiply",
  "divide",
  "exponential",
  "invert",
  "xor"
]);

function fail(message, details = {}) {
  const error = new Error(message);
  error.name = "PyashProgramletError";
  error.details = details;
  throw error;
}

function clone(value) {
  if (Array.isArray(value)) return value.map(clone);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clone(item)]));
}

function parseSource(sourceText) {
  if (typeof sourceText !== "string" || !sourceText.trim()) fail("Pyash programlet source must be non-empty text");
  const sourceSentences = [];
  for (const source of splitSentences(sourceText)) {
    const previous = sourceSentences.at(-1);
    if (previous && previous.split(/\s+/u).includes("then") && /^else(?:\s|$)/u.test(source.trim())) {
      sourceSentences[sourceSentences.length - 1] = `${previous} ${source}`;
    } else {
      sourceSentences.push(source);
    }
  }
  const sentences = sourceSentences.map((source, index) => {
    try {
      return parse(source);
    } catch (error) {
      fail(`cannot parse Pyash programlet sentence ${index + 1}: ${error.message}`, { source });
    }
    return null;
  }).filter(Boolean);
  if (!sentences.length) fail("Pyash programlet contains no sentences");
  return sentences;
}

function visitSentence(sentence, visit) {
  if (!sentence || typeof sentence !== "object") return;
  visit(sentence);
  visitSentence(sentence.consequence, visit);
  visitSentence(sentence.alternative, visit);
}

function programComplexity(sentences) {
  let decisions = 0;
  for (const sentence of sentences) {
    visitSentence(sentence, (entry) => {
      if (entry.consequence || entry.alternative) decisions += 1;
    });
  }
  return decisions + 1;
}

function outputType(sentence) {
  const types = sentence?.to?.nameTypeWords ?? [];
  if (!sentence?.to?.name || types.length !== 1) return null;
  if (["bool", "boolean"].includes(types[0])) return "bool";
  if (["num", "number"].includes(types[0])) return "num";
  return null;
}

function programletLocalDeclaration(sentence) {
  if (isNamedNumericSlotDeclaration(sentence)) {
    return { type: "num", kind: namedNumericSlotKind(sentence) };
  }
  const chain = sentence?.ob?.genitive?.chain;
  const inherited = Array.isArray(chain)
    && chain.length === 3
    && chain[0] === "this"
    && ["ob", "fromindex"].includes(chain[1]);
  const inheritedType = inherited ? chain[2] : null;
  const isNumber = sentence?.be === "number" || sentence?.be === "num";
  const isBoolean = sentence?.be === "boolean" || sentence?.be === "bool";
  const marker = namedNumericSlotKind(sentence)
    ?? (sentence?.as?.name === "permanently boolean" ? "constant" : null);
  const initializedByType = isNumber
    ? Number.isInteger(sentence?.ob?.num) && sentence.ob.num >= 0 && sentence.ob.num <= 0xffff
      || inheritedType === "num"
    : isBoolean
      ? typeof sentence?.ob?.boolean === "boolean" || inheritedType === "bool"
      : false;
  if (!(
    sentence?.mood === "ya"
    && sentence?.su?.name
    && initializedByType
    && marker
  )) return null;
  return { type: isBoolean ? "bool" : "num", kind: marker };
}

function validatePureProgram(sentences, { invocationIndex = -1 } = {}) {
  const definitionNames = sentences
    .filter((sentence) => sentence?.mood === "def" && sentence.be === "ceremony")
    .map((sentence) => sentence.su?.name)
    .filter(Boolean);
  const definitions = new Set(definitionNames);
  if (definitions.size === 0) fail("Pyash programlet must define at least one ceremony");
  if (definitions.size !== definitionNames.length) fail("Pyash programlet ceremony names must be unique");
  const signatures = new Map();
  for (const sentence of sentences) {
    if (sentence?.mood !== "def" || sentence.be !== "ceremony") continue;
    const type = outputType(sentence);
    if (!type) {
      fail(`Pyash programlet ceremony ${sentence.su.name} must declare one bool or num output name`);
    }
    signatures.set(sentence.su.name, type);
  }

  const calls = new Map([...definitions].map((name) => [name, new Set()]));
  let activeDefinition = null;
  let activeDefinitionReturns = false;
  let activeDefinitionHasAction = false;
  let activeSlots = new Map();
  for (const [index, sentence] of sentences.entries()) {
    if (sentence.mood === "def") {
      if (activeDefinition) fail("Pyash programlet ceremony definitions cannot be nested", { sentence: index + 1 });
      if (sentence.be !== "ceremony" || !sentence.su?.name) {
        fail("Pyash programlet admits named ceremony definitions only", { sentence: index + 1, be: sentence.be });
      }
      activeDefinition = sentence.su.name;
      activeDefinitionReturns = false;
      activeDefinitionHasAction = false;
      activeSlots = new Map();
      continue;
    }
    if (sentence.mood === "prah") {
      if (
        !activeDefinition
        || (sentence.su?.name && sentence.su.name !== activeDefinition)
        || (sentence.be && sentence.be !== "ceremony")
      ) {
        fail("Pyash programlet paragraph must close the active ceremony definition", { sentence: index + 1 });
      }
      if (!activeDefinitionReturns) {
        fail(`Pyash programlet ceremony ${activeDefinition} must return a value`, { sentence: index + 1 });
      }
      activeDefinition = null;
      activeDefinitionHasAction = false;
      activeSlots = new Map();
      continue;
    }
    if (activeDefinition) {
      activeDefinitionReturns = false;
      if (sentence.mood === "ya") {
        if (activeDefinitionHasAction) {
          fail("Pyash programlet local numeric slots must be declared before actions", { sentence: index + 1 });
        }
        const localDeclaration = programletLocalDeclaration(sentence);
        if (!localDeclaration) {
          fail("Pyash programlet body only admits initialized numeric or boolean local declarations", {
            sentence: index + 1
          });
        }
        const slotName = sentence.su.name;
        if (activeSlots.has(slotName)) {
          fail(`Pyash programlet redeclares local slot: ${slotName}`, { sentence: index + 1 });
        }
        activeSlots.set(slotName, localDeclaration);
      } else if (sentence.mood === "do") {
        activeDefinitionHasAction = true;
        visitSentence(sentence, (action) => {
          if (action.mood === "ret") {
            const registerValue = action.fromindex ?? (
              action.ret?.role === "fromindex"
                ? action.ret
                : undefined
            );
            const hasRegisterValue = registerValue === undefined
              || Number.isInteger(registerValue.num)
              || Array.isArray(registerValue.genitive?.chain);
            if (!hasRegisterValue) {
              fail("Pyash programlet conditional return only supports an explicit fromindex update", {
                sentence: index + 1
              });
            }
            return;
          }
          if (action.mood !== "do") {
            fail("Pyash programlet conditional branches must be do sentences", { sentence: index + 1 });
          }
          const isCall = definitions.has(action.be);
          const isBooleanPredicate = (action.consequence || action.alternative)
            && ["not", "and", "or"].includes(action.be);
          if (!PURE_BUILTIN_VERBS.has(action.be) && !isCall && !isBooleanPredicate) {
            fail(`Pyash programlet rejects effectful or unknown verb: ${action.be}`, { sentence: index + 1 });
          }
          const targetSlot = action.to?.name ? activeSlots.get(action.to.name) : null;
          if (targetSlot?.kind === "constant") {
            fail(`constant quantity is read-only: ${action.to.name}`, { sentence: index + 1 });
          }
          if (targetSlot?.kind === "variable" && outputType(action) !== targetSlot.type) {
            const message = targetSlot.type === "num"
              ? `numeric variable slot requires a typed num destination: ${action.to.name}`
              : `boolean variable slot requires a typed bool destination: ${action.to.name}`;
            fail(message, {
              sentence: index + 1
            });
          }
          if (isCall) {
            if (!action.to?.name || outputType(action) !== signatures.get(action.be)
              || (targetSlot?.type && targetSlot.type !== outputType(action))) {
              fail(`Pyash programlet call to ${action.be} has an incompatible output signature`, {
                sentence: index + 1
              });
            }
            calls.get(activeDefinition).add(action.be);
          }
        });
        if (sentence.consequence?.mood === "ret" && sentence.alternative?.mood === "ret") {
          activeDefinitionReturns = true;
        }
      } else if (sentence.mood === "ret") {
        activeDefinitionReturns = sentence.consequence && sentence.alternative
          ? sentence.consequence.mood === "ret" && sentence.alternative.mood === "ret"
          : !sentence.consequence && !sentence.alternative;
      } else {
        fail(`Pyash programlet ceremony body does not admit ${sentence.mood} sentences`, { sentence: index + 1 });
      }
      continue;
    }
    if (index === invocationIndex && sentence.mood === "do" && definitions.has(sentence.be)) continue;
    fail("top-level programlet content must be a ceremony or one final invocation", {
      sentence: index + 1,
      mood: sentence.mood
    });
  }
  if (activeDefinition) {
    fail(`Pyash programlet ceremony ${activeDefinition} is missing its prah terminator`);
  }
  if (invocationIndex >= 0 && invocationIndex !== sentences.length - 1) {
    fail("Pyash programlet invocation must be the final sentence");
  }
  if (invocationIndex >= 0 && sentences[invocationIndex]?.mood !== "do") {
    fail("Pyash programlet final invocation must be a do sentence");
  }
  if (invocationIndex < 0 && sentences.at(-1)?.mood === "do") {
    fail("top-level programlet actions are not allowed; provide a final ceremony invocation");
  }
  if (invocationIndex >= 0) {
    const invocation = sentences[invocationIndex];
    if (!definitions.has(invocation.be)) {
      fail("Pyash programlet final invocation must call a defined ceremony", { be: invocation.be });
    }
    if (!outputType(invocation) || outputType(invocation) !== signatures.get(invocation.be)) {
      fail("Pyash programlet invocation requires one typed bool or num output name");
    }
  }
  const visiting = new Set();
  const visited = new Set();
  const visitCall = (name) => {
    if (visiting.has(name)) {
      fail("Pyash programlet does not admit recursive ceremony calls", { ceremony: name });
    }
    if (visited.has(name)) return;
    visiting.add(name);
    for (const called of calls.get(name) ?? []) visitCall(called);
    visiting.delete(name);
    visited.add(name);
  };
  for (const name of definitions) visitCall(name);

  const complexity = programComplexity(sentences);
  return { definitions, complexity };
}

function isSectionSentence(sentence) {
  return SECTION_VERBS.has(sentence?.be);
}

function sectionNameWords(sentence) {
  const name = sentence?.su?.name;
  if (typeof name !== "string" || !name.trim()) {
    fail("PyAC packet section requires a Pyash name in su");
  }
  const words = [];
  for (const token of name.trim().split(/\s+/u)) {
    const sequence = lookupLegacyWordSequence(token);
    if (!sequence) {
      fail(`PyAC packet section name is not HNUC-encodable: ${token}`, { name });
    }
    words.push(...sequence.map((entry) => Number.parseInt(entry.hnuc, 16)));
    if (words.length > MAX_PYASH_SECTION_NAME_WORDS) {
      fail(`PyAC packet section name exceeds ${MAX_PYASH_SECTION_NAME_WORDS} HNUC words`, { name });
    }
  }
  return words;
}

function sectionLabelKey(words) {
  return words.map((word) => word.toString(16).padStart(4, "0")).join(":");
}

function splitProgramSections(sentences) {
  const hasSectionMarker = sentences.some(isSectionSentence);
  if (!hasSectionMarker) return null;

  const sections = [];
  const names = new Set();
  let index = 0;
  while (index < sentences.length) {
    const header = sentences[index];
    if (header?.mood !== "def" || !isSectionSentence(header)) {
      fail("PyAC sectioned packet must begin each top-level block with a myocpfun def sentence", {
        sentence: index + 1
      });
    }
    const nameWords = sectionNameWords(header);
    const nameKey = sectionLabelKey(nameWords);
    if (names.has(nameKey)) fail("PyAC packet section names must be unique", { name: header.su.name });
    names.add(nameKey);

    let closeIndex = index + 1;
    while (closeIndex < sentences.length && !isSectionSentence(sentences[closeIndex])) closeIndex += 1;
    if (closeIndex >= sentences.length) {
      fail(`PyAC packet section ${header.su.name} is missing its matching paragraph terminator`);
    }
    const closer = sentences[closeIndex];
    if (closer.mood !== "prah") {
      fail("PyAC packet sections cannot be nested", { sentence: closeIndex + 1 });
    }
    const closingNameWords = sectionNameWords(closer);
    if (sectionLabelKey(closingNameWords) !== nameKey) {
      fail(`PyAC packet section ${header.su.name} closes with a different Pyash name`, {
        closingName: closer.su?.name
      });
    }

    const body = sentences.slice(index + 1, closeIndex);
    if (!body.length) fail(`PyAC packet section ${header.su.name} must contain a programlet`);
    if (sections.length >= MAX_PYASH_PROGRAM_SECTIONS) {
      fail(`PyAC packet exceeds ${MAX_PYASH_PROGRAM_SECTIONS} independent sections`);
    }
    const validation = validatePureProgram(body, { invocationIndex: body.length - 1 });
    sections.push({
      index: sections.length,
      name: header.su.name,
      nameWords,
      startSentence: index,
      endSentence: closeIndex,
      body,
      complexity: validation.complexity
    });
    index = closeIndex + 1;
  }
  return sections;
}

function sectionCodeletRanges(sections, loweredSentences) {
  const starts = [];
  let cursor = 0;
  for (const sentence of loweredSentences) {
    starts.push(cursor);
    cursor += sentence.vectors.length;
  }
  return sections.map((section) => {
    const bodyStart = section.startSentence + 1;
    const bodyEnd = section.endSentence;
    const startCodelet = starts[bodyStart];
    const endCodelet = starts[bodyEnd];
    const codeletCount = endCodelet - startCodelet;
    if (codeletCount > MAX_PYASH_PROGRAMLET_CODELETS) {
      fail(`PyAC packet section ${section.name} exceeds ${MAX_PYASH_PROGRAMLET_CODELETS} codelets`, {
        codeletCount
      });
    }
    return {
      index: section.index,
      name: section.name,
      nameWords: section.nameWords,
      codeletStart: startCodelet,
      codeletCount
    };
  });
}

function normalizeStepBudget(value = DEFAULT_PYASH_PROGRAMLET_STEP_BUDGET) {
  const budget = Number(value);
  if (!Number.isSafeInteger(budget) || budget < 1 || budget > MAX_PYASH_PROGRAMLET_STEP_BUDGET) {
    fail(`Pyash programlet stepBudget must be an integer from 1 through ${MAX_PYASH_PROGRAMLET_STEP_BUDGET}`, {
      stepBudget: value
    });
  }
  return budget;
}

function parseInvocation(invocation) {
  if (typeof invocation !== "string" || !invocation.trim()) {
    fail("Pyash programlet compilation requires a final Pyash invocation sentence");
  }
  const sentences = parseSource(invocation);
  if (sentences.length !== 1 || sentences[0].mood !== "do") {
    fail("Pyash programlet invocation must be one do sentence");
  }
  return sentences[0];
}

export function compilePyashProgramSource(sourceText, { invocation = "" } = {}) {
  const sentences = parseSource(sourceText);
  const sections = splitProgramSections(sentences);
  if (sections) {
    if (String(invocation ?? "").trim()) {
      fail("sectioned PyAC packets carry one invocation inside each section; do not append an invocation");
    }
    const lowered = lowerPyashProgram(sentences);
    const pack = encodePyacPack(lowered.vectors);
    return {
      pack,
      sentences,
      sections: sectionCodeletRanges(sections, lowered.sentences),
      vectorCount: lowered.vectors.length,
      byteLength: pack.byteLength,
      complexity: sections.reduce((total, section) => total + section.complexity, 0),
      invocationIndex: -1
    };
  }
  const call = String(invocation ?? "").trim() ? parseInvocation(invocation) : null;
  const program = call ? [...sentences, call] : sentences;
  const invocationIndex = call ? program.length - 1 : -1;
  const validation = validatePureProgram(program, { invocationIndex });
  const lowered = lowerPyashProgram(program);
  const pack = encodePyacPack(lowered.vectors);
  return {
    pack,
    sentences: program,
    vectorCount: lowered.vectors.length,
    byteLength: pack.byteLength,
    complexity: validation.complexity,
    invocationIndex
  };
}

export function decodePyashProgramPack(pack) {
  const decodedPack = decodePyacPack(pack);
  const sentences = decodePyashProgram(decodedPack.codelets);
  const sections = splitProgramSections(sentences);
  if (!sections) {
    const invocationIndex = sentences.at(-1)?.mood === "do" ? sentences.length - 1 : -1;
    validatePureProgram(sentences, { invocationIndex });
  }
  for (const sentence of sentences) {
    if (programletLocalDeclaration(sentence)) sentence.exists = true;
  }
  return sentences;
}

export function decodePyashProgramSections(pack) {
  const sentences = decodePyashProgramPack(pack);
  const sections = splitProgramSections(sentences);
  if (!sections) fail("PyAC packet does not contain named myocpfun sections");
  return sections.map(({ index, name, nameWords, body, complexity }) => ({
    index,
    name,
    nameWords,
    sentences: body,
    complexity
  }));
}

function defaultOutputFact(invocation) {
  const typeNames = invocation.to?.nameTypeWords ?? [];
  if (typeNames.includes("bool") || typeNames.includes("boolean")) {
    return { be: "bool", ob: { boolean: false } };
  }
  if (typeNames.includes("num") || typeNames.includes("number")) {
    return { be: "number", ob: { num: 0 } };
  }
  fail("Pyash programlet output requires a typed to name (for example `to name bool answer`)");
}

async function executeProgramletSentences(sentences, { outputName = "", stepBudget } = {}) {
  if (allRemember().length > 0) {
    fail("Pyash programlet reference execution requires an empty interpreter memory");
  }
  forget();
  const previousBudget = bridgeState.programStepBudget;
  bridgeState.programStepBudget = { limit: stepBudget, remaining: stepBudget };
  try {
    const invocation = sentences.at(-1);
    if (invocation?.mood !== "do") fail("Pyash programlet pack must end with an invocation");
    const destination = String(outputName || invocation.to?.name || "").trim();
    if (!destination || destination !== invocation.to?.name) {
      fail("Pyash programlet invocation must write to its declared output name");
    }

    // Compile loads VLIW while the bridge is registering built-in signatures.
    // Load the bridge only when reference execution begins to avoid that cycle.
    const { interpret } = await import("../../bridge/index.mjs");
    for (const sentence of sentences.slice(0, -1)) await interpret(clone(sentence));
    const initial = defaultOutputFact(invocation);
    doRemember({ mood: "ya", su: { name: destination }, ...initial });
    const execution = await interpret(clone(invocation));
    const output = remember(destination)?.ob;
    return { output, execution, complexity: programComplexity(sentences.slice(0, -1)) };
  } finally {
    bridgeState.programStepBudget = previousBudget;
    forget();
  }
}

/** Execute a self-contained .pyac program in a clean reference-interpreter scope. */
export async function executePyashProgramPack(pack, {
  outputName = "",
  stepBudget = DEFAULT_PYASH_PROGRAMLET_STEP_BUDGET
} = {}) {
  const limit = normalizeStepBudget(stepBudget);
  const sentences = decodePyashProgramPack(pack);
  const sections = splitProgramSections(sentences);
  if (sections) {
    if (outputName) fail("outputName cannot override outputs in a sectioned PyAC packet");
    const results = [];
    for (const section of sections) {
      const result = await executeProgramletSentences(section.body, { stepBudget: limit });
      results.push({
        index: section.index,
        name: section.name,
        nameWords: section.nameWords,
        completionOrder: results.length,
        output: result.output,
        execution: result.execution
      });
    }
    return {
      sections: results,
      completionOrder: results.map(({ index }) => index),
      complexity: sections.reduce((total, section) => total + section.complexity, 0)
    };
  }
  return executeProgramletSentences(sentences, { outputName, stepBudget: limit });
}

function makeRandom(seed) {
  let state = Number(seed) >>> 0;
  if (!state) state = 0x9e3779b9;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0x100000000;
  };
}

function isInsideQuotedText(sourceText, offset) {
  let quoted = false;
  for (let index = 0; index < offset; index += 1) {
    if (sourceText[index] === "\\") {
      index += 1;
      continue;
    }
    if (sourceText[index] === '"') quoted = !quoted;
  }
  return quoted;
}

function collectNumericMutations(sourceText) {
  const targets = [];
  const actionLines = new Set(splitSentencesWithLines(sourceText)
    .filter(({ text }) => parse(text).mood === "do")
    .map(({ line }) => line));
  const lineStarts = [0];
  for (let index = 0; index < sourceText.length; index += 1) {
    if (sourceText[index] === "\n") lineStarts.push(index + 1);
  }
  let currentLine = 0;
  const numericCase = /\b(?:ob|from|by)\s+num\s+(\d+)\b/gu;
  for (const match of sourceText.matchAll(numericCase)) {
    const valueStart = match.index + match[0].lastIndexOf(match[1]);
    const value = Number(match[1]);
    while (currentLine + 1 < lineStarts.length && lineStarts[currentLine + 1] <= match.index) currentLine += 1;
    if (
      !isInsideQuotedText(sourceText, match.index)
      && actionLines.has(currentLine + 1)
      && Number.isInteger(value)
      && value >= 0
      && value <= 0xffff
    ) {
      targets.push({ start: valueStart, end: valueStart + match[1].length, value });
    }
  }
  return targets;
}

export function mutatePyashProgramSource(sourceText, { seed = 1 } = {}) {
  parseSource(sourceText);
  const targets = collectNumericMutations(sourceText);
  if (!targets.length) fail("Pyash programlet has no numeric literals eligible for mutation");
  const random = makeRandom(seed);
  const target = targets[Math.floor(random() * targets.length)];
  const previous = target.value;
  let next = Math.floor(random() * 17);
  if (next === previous) next = (next + 1) % 17;
  return `${sourceText.slice(0, target.start)}${next}${sourceText.slice(target.end)}`;
}

function compareFitness(left, right) {
  return left.incorrectCount - right.incorrectCount
    || left.vectorCount - right.vectorCount
    || left.complexity - right.complexity
    || left.sourceText.localeCompare(right.sourceText);
}

async function scoreSource(sourceText, { functionName, cases, outputName, stepBudget }) {
  const results = [];
  let vectorCount = 0;
  let complexity = 0;
  for (const testCase of cases) {
    const input = Number(testCase.input);
    if (!Number.isInteger(input) || input < 0 || input > 0xffff || typeof testCase.expected !== "boolean") {
      fail("Pyash programlet cases require U16 input and boolean expected values", { testCase });
    }
    const invocation = `ob num ${input} to name bool ${outputName} be ${functionName} do`;
    const compiled = compilePyashProgramSource(sourceText, { invocation });
    vectorCount = compiled.vectorCount;
    complexity = compiled.complexity;
    const actual = await executePyashProgramPack(compiled.pack, { outputName, stepBudget });
    const value = actual.output?.boolean;
    results.push({ input, expected: testCase.expected, actual: typeof value === "boolean" ? value : null });
  }
  return {
    incorrectCount: results.filter((result) => result.actual !== result.expected).length,
    vectorCount,
    complexity,
    results,
    sourceText
  };
}

export async function evolvePyashProgramSource({
  sourceText,
  functionName,
  trainingCases,
  heldoutCases,
  populationSize = 24,
  generations = 8,
  seed = 1,
  outputName = "answer",
  stepBudget = DEFAULT_PYASH_PROGRAMLET_STEP_BUDGET
} = {}) {
  if (!Array.isArray(trainingCases) || !trainingCases.length) fail("Pyash programlet evolution requires training cases");
  if (!Array.isArray(heldoutCases) || !heldoutCases.length) fail("Pyash programlet evolution requires held-out cases");
  if (!Number.isInteger(populationSize) || populationSize < 2 || populationSize > 128) {
    fail("Pyash programlet population size must be 2 through 128");
  }
  if (!Number.isInteger(generations) || generations < 1 || generations > 31) {
    fail("Pyash programlet generations must be 1 through 31");
  }

  const random = makeRandom(seed);
  let population = [String(sourceText)];
  while (population.length < populationSize) {
    population.push(mutatePyashProgramSource(sourceText, { seed: Math.floor(random() * 0xffffffff) }));
  }
  const history = [];
  let champion = null;
  for (let generation = 0; generation < generations; generation += 1) {
    const ranked = [];
    for (const candidate of population) {
      ranked.push(await scoreSource(candidate, { functionName, cases: trainingCases, outputName, stepBudget }));
    }
    ranked.sort(compareFitness);
    champion = ranked[0];
    history.push({ generation, incorrectCount: champion.incorrectCount, vectorCount: champion.vectorCount });
    if (champion.incorrectCount === 0) break;
    const elites = ranked.slice(0, Math.max(1, Math.ceil(populationSize * 0.2)));
    population = elites.map((candidate) => candidate.sourceText);
    while (population.length < populationSize) {
      const parent = elites[Math.floor(random() * elites.length)].sourceText;
      population.push(mutatePyashProgramSource(parent, { seed: Math.floor(random() * 0xffffffff) }));
    }
  }

  const trainingFitness = await scoreSource(champion.sourceText, {
    functionName,
    cases: trainingCases,
    outputName,
    stepBudget
  });
  const heldoutFitness = await scoreSource(champion.sourceText, {
    functionName,
    cases: heldoutCases,
    outputName,
    stepBudget
  });
  const compiled = compilePyashProgramSource(champion.sourceText);
  return {
    seed: Number(seed) >>> 0,
    generationsCompleted: history.length,
    history,
    candidateSourcePya: champion.sourceText,
    candidatePack: compiled.pack,
    trainingFitness,
    heldoutFitness,
    validated: trainingFitness.incorrectCount === 0 && heldoutFitness.incorrectCount === 0
  };
}

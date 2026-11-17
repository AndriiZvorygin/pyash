import { splitSentences } from "../sentenceSplitter.mjs";
import { parse } from "../../understand/index.mjs";
import { sentenceToPyash } from "../../beautiful.mjs";
import { normalizeVliwFunction, scoreVliwFunction } from "./functions.mjs";

export class VliwFunctionSourceError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "VliwFunctionSourceError";
    this.details = details;
  }
}

function fail(message, details) {
  throw new VliwFunctionSourceError(message, details);
}

function exactKeys(value, expected, role) {
  const keys = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  if (keys.length !== sortedExpected.length || keys.some((key, index) => key !== sortedExpected[index])) {
    fail(`${role} has an unsupported Pyash sentence shape`, { keys, expected: sortedExpected });
  }
}

function sourceBlocks(sourceText) {
  if (typeof sourceText !== "string" || !sourceText.trim()) {
    fail("VLIW Pyash source must be non-empty text");
  }

  const blocks = new Map();
  let active = null;
  for (const [index, sourceSentence] of splitSentences(sourceText).entries()) {
    let sentence;
    try {
      sentence = parse(sourceSentence);
    } catch (error) {
      fail(`cannot parse VLIW Pyash sentence ${index + 1}: ${error.message}`, { sentence: sourceSentence });
    }

    if (sentence?.mood === "def") {
      if (active) fail(`nested definition is not supported inside ${active.name}`, { sentence: sourceSentence });
      if (!(["map", "series"].includes(sentence.be) && sentence.su?.name)) {
        fail("VLIW source definitions must be named map or series blocks", { sentence });
      }
      const name = sentence.su.name;
      if (blocks.has(name)) fail(`duplicate VLIW source block: ${name}`, { name });
      active = { name, kind: sentence.be, entries: [] };
      continue;
    }

    if (sentence?.mood === "prah") {
      if (!active) fail("unmatched prah in VLIW Pyash source", { sentence: sourceSentence });
      blocks.set(active.name, active);
      active = null;
      continue;
    }

    if (!active) fail(`VLIW source sentence ${index + 1} is outside a named block`, { sentence });
    active.entries.push(sentence);
  }
  if (active) fail(`VLIW source block ${active.name} is missing prah`, { name: active.name });
  return blocks;
}

function mapFields(block) {
  if (block.kind !== "map") fail(`VLIW source block ${block.name} must be a map`, { name: block.name });
  const fields = new Map();
  for (const sentence of block.entries) {
    exactKeys(sentence, ["mood", "ob", "su"], `field in ${block.name}`);
    if (sentence.mood !== "ya" || typeof sentence.su?.name !== "string" || !sentence.ob) {
      fail(`map ${block.name} contains a non-fact field sentence`, { sentence });
    }
    if (fields.has(sentence.su.name)) {
      fail(`map ${block.name} repeats field ${sentence.su.name}`, { field: sentence.su.name });
    }
    fields.set(sentence.su.name, sentence.ob);
  }
  return fields;
}

function seriesReferences(block) {
  if (block.kind !== "series") fail(`VLIW source block ${block.name} must be a series`, { name: block.name });
  if (block.entries.length === 0) fail(`VLIW source series ${block.name} must not be empty`, { name: block.name });
  return block.entries.map((sentence) => {
    if (sentence?.mood !== "ya" || typeof sentence.su?.name !== "string") {
      fail(`series entries must reference named maps in ${block.name}`, { sentence });
    }
    exactKeys(sentence, ["mood", "su"], `entry in ${block.name}`);
    return sentence.su.name;
  });
}

function requiredField(fields, name, blockName) {
  if (!fields.has(name)) fail(`map ${blockName} is missing required field ${name}`, { name: blockName, field: name });
  return fields.get(name);
}

function textValue(value, role) {
  if (typeof value?.text !== "string" || !value.text.trim()) fail(`${role} must be non-empty text`, { value });
  return value.text.trim();
}

function nameValue(value, role) {
  if (typeof value?.name !== "string" || !value.name.trim()) fail(`${role} must be a named reference`, { value });
  return value.name.trim();
}

function textVector(value, role) {
  const vector = value?.ve;
  if (vector?.type !== "text" || !Array.isArray(vector.values) || vector.values.length === 0) {
    fail(`${role} must be a non-empty text vector`, { value });
  }
  if (vector.values.some((item) => typeof item !== "string" || !item.trim())) {
    fail(`${role} contains an empty or non-text item`, { value });
  }
  return vector.values.map((item) => item.trim());
}

function resolveMap(blocks, name, role) {
  const block = blocks.get(name);
  if (!block) fail(`unknown ${role} map reference: ${name}`, { name, role });
  if (block.kind !== "map") fail(`${role} reference ${name} is not a map`, { name, role, kind: block.kind });
  return mapFields(block);
}

function resolveSeries(blocks, name, role) {
  const block = blocks.get(name);
  if (!block) fail(`unknown ${role} series reference: ${name}`, { name, role });
  return seriesReferences(block);
}

function requireFields(fields, expected, role) {
  const keys = [...fields.keys()].sort();
  const sortedExpected = [...expected].sort();
  if (keys.length !== sortedExpected.length || keys.some((key, index) => key !== sortedExpected[index])) {
    fail(`${role} fields do not match the VLIW source contract`, { fields: keys, expected: sortedExpected });
  }
}

function loadInstruction(blocks, name) {
  const fields = resolveMap(blocks, name, "instruction");
  requireFields(fields, ["op", "target", "left", "right"], `instruction ${name}`);
  return {
    op: textValue(requiredField(fields, "op", name), `instruction ${name} op`),
    target: nameValue(requiredField(fields, "target", name), `instruction ${name} target`),
    left: nameValue(requiredField(fields, "left", name), `instruction ${name} left`),
    right: nameValue(requiredField(fields, "right", name), `instruction ${name} right`)
  };
}

function loadCase(blocks, name, inputSlots) {
  const fields = resolveMap(blocks, name, "case");
  requireFields(fields, [...inputSlots, "expected"], `case ${name}`);
  const values = {};
  for (const inputSlot of inputSlots) {
    const value = requiredField(fields, inputSlot, name)?.num;
    if (!Number.isInteger(value) || value < 0 || value > 0xffff) {
      fail(`case ${name} input ${inputSlot} must be an unsigned 16-bit integer`, { name, inputSlot, value });
    }
    values[inputSlot] = value;
  }
  const expected = requiredField(fields, "expected", name)?.num;
  if (!Number.isInteger(expected) || expected < 0 || expected > 0xffff) {
    fail(`case ${name} expected field must be an unsigned 16-bit integer`, { name, expected });
  }
  return { values, expected };
}

function functionBlocks(blocks) {
  return [...blocks.values()].filter((block) => block.kind === "map")
    .map((block) => ({ block, fields: mapFields(block) }))
    .filter(({ fields }) => fields.has("function name"));
}

/** Parse a declarative, map-and-series Pyash source into the current VLIW function contract. */
export function parseVliwFunctionSource(sourceText, { functionName = "" } = {}) {
  const blocks = sourceBlocks(sourceText);
  const candidates = functionBlocks(blocks);
  if (candidates.length === 0) fail("VLIW Pyash source contains no function map");

  const requestedName = String(functionName ?? "").trim();
  if (!requestedName && candidates.length !== 1) {
    fail("VLIW Pyash source contains multiple functions; select one by function name", {
      functions: candidates.map(({ fields }) => fields.get("function name")?.text ?? "")
    });
  }
  const selected = requestedName
    ? candidates.find(({ fields }) => fields.get("function name")?.text === requestedName)
    : candidates[0];
  if (!selected) fail(`VLIW function not found: ${requestedName}`, { functionName: requestedName });

  const { block, fields } = selected;
  requireFields(fields, [
    "function name",
    "slots",
    "input slots",
    "output slot",
    "instruction series",
    "training case series",
    "heldout case series"
  ], `function map ${block.name}`);

  const name = textValue(requiredField(fields, "function name", block.name), "function name");
  const slots = textVector(requiredField(fields, "slots", block.name), "function slots");
  const inputSlots = textVector(requiredField(fields, "input slots", block.name), "function input slots");
  const outputSlot = nameValue(requiredField(fields, "output slot", block.name), "function output slot");
  const instructionSeriesName = nameValue(requiredField(fields, "instruction series", block.name), "instruction series");
  const trainingSeriesName = nameValue(requiredField(fields, "training case series", block.name), "training case series");
  const heldoutSeriesName = nameValue(requiredField(fields, "heldout case series", block.name), "heldout case series");

  const definition = normalizeVliwFunction({
    schemaVersion: 1,
    name,
    slots,
    inputSlots,
    outputSlot,
    instructions: resolveSeries(blocks, instructionSeriesName, "instruction")
      .map((instructionName) => loadInstruction(blocks, instructionName))
  });
  const trainingCases = resolveSeries(blocks, trainingSeriesName, "training case")
    .map((caseName) => loadCase(blocks, caseName, definition.inputSlots));
  const heldoutCases = resolveSeries(blocks, heldoutSeriesName, "held-out case")
    .map((caseName) => loadCase(blocks, caseName, definition.inputSlots));
  return { definition, trainingCases, heldoutCases };
}

function renderFact(name, ob) {
  return sentenceToPyash({ mood: "ya", su: { name }, ob });
}

function renderMap(name, entries) {
  return [
    `su name ${name} be map def`,
    ...entries.map(([key, ob]) => `  ${renderFact(key, ob)}`),
    "prah"
  ];
}

function renderSeries(name, references) {
  return [
    `su name ${name} be series def`,
    ...references.map((reference) => `  ${sentenceToPyash({ mood: "ya", su: { name: reference } })}`),
    "prah"
  ];
}

/** Render a normalized function and its cases into the same parseable Pyash source surface. */
export function renderVliwFunctionSource({ definition: rawDefinition, trainingCases, heldoutCases } = {}) {
  const definition = normalizeVliwFunction(rawDefinition);
  if (!Array.isArray(trainingCases) || trainingCases.length === 0) {
    fail("rendering VLIW source requires training cases");
  }
  if (!Array.isArray(heldoutCases) || heldoutCases.length === 0) {
    fail("rendering VLIW source requires held-out cases");
  }
  scoreVliwFunction(definition, trainingCases);
  scoreVliwFunction(definition, heldoutCases);

  const instructionNames = definition.instructions.map((_, index) => (
    `vliw instruction ${String(index + 1).padStart(3, "0")}`
  ));
  const trainingNames = trainingCases.map((_, index) => `vliw training case ${String(index + 1).padStart(3, "0")}`);
  const heldoutNames = heldoutCases.map((_, index) => `vliw heldout case ${String(index + 1).padStart(3, "0")}`);
  const lines = [
    ...renderMap("vliw function source", [
      ["function name", { text: definition.name }],
      ["slots", { ve: { type: "text", values: definition.slots } }],
      ["input slots", { ve: { type: "text", values: definition.inputSlots } }],
      ["output slot", { name: definition.outputSlot }],
      ["instruction series", { name: "vliw function instructions" }],
      ["training case series", { name: "vliw function training" }],
      ["heldout case series", { name: "vliw function heldout" }]
    ]),
    ...renderSeries("vliw function instructions", instructionNames),
    ...definition.instructions.flatMap((instruction, index) => renderMap(instructionNames[index], [
      ["op", { text: instruction.op }],
      ["target", { name: instruction.target }],
      ["left", { name: instruction.left }],
      ["right", { name: instruction.right }]
    ])),
    ...renderSeries("vliw function training", trainingNames),
    ...trainingCases.flatMap((testCase, index) => renderMap(trainingNames[index], [
      ...definition.inputSlots.map((slot) => [slot, { num: testCase.values[slot] }]),
      ["expected", { num: testCase.expected }]
    ])),
    ...renderSeries("vliw function heldout", heldoutNames),
    ...heldoutCases.flatMap((testCase, index) => renderMap(heldoutNames[index], [
      ...definition.inputSlots.map((slot) => [slot, { num: testCase.values[slot] }]),
      ["expected", { num: testCase.expected }]
    ]))
  ];
  return `${lines.join("\n")}\n`;
}

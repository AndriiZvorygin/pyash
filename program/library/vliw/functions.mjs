const MAX_SLOTS = 16;
export const MAX_FUNCTION_INSTRUCTIONS = 31;
const OPERATIONS = new Set(["plus", "subtract", "xor"]);

export class VliwFunctionError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "VliwFunctionError";
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details) {
  throw new VliwFunctionError(code, message, details);
}

function normalizeName(value, role) {
  const name = String(value ?? "").trim();
  if (!name) fail("invalid-name", `${role} must be a non-empty name`, { role, value });
  return name;
}

function uint16(value, role) {
  if (!Number.isInteger(value) || value < 0 || value > 0xffff) {
    fail("numeric-range", `${role} must be an unsigned 16-bit integer`, { role, value });
  }
  return value;
}

export function normalizeVliwFunction(definition = {}) {
  if (!definition || typeof definition !== "object" || Array.isArray(definition)) {
    fail("invalid-function", "VLIW function definition must be a map");
  }
  if (definition.schemaVersion !== 1) {
    fail("unsupported-function-version", "VLIW function schemaVersion must be 1", {
      schemaVersion: definition.schemaVersion
    });
  }
  const name = normalizeName(definition.name, "function name");
  const slots = definition.slots;
  if (!Array.isArray(slots) || slots.length < 2 || slots.length > MAX_SLOTS) {
    fail("slot-limit", `function slots must contain 2 through ${MAX_SLOTS} names`);
  }
  const normalizedSlots = slots.map((slot) => normalizeName(slot, "slot name"));
  if (new Set(normalizedSlots).size !== normalizedSlots.length) {
    fail("duplicate-slot", "function slot names must be unique");
  }
  const slotSet = new Set(normalizedSlots);
  const inputSlots = definition.inputSlots;
  if (!Array.isArray(inputSlots) || inputSlots.length !== 2) {
    fail("signature-shape", "this VLIW function profile requires exactly two input slots");
  }
  const normalizedInputs = inputSlots.map((slot) => normalizeName(slot, "input slot"));
  if (normalizedInputs[0] === normalizedInputs[1] || normalizedInputs.some((slot) => !slotSet.has(slot))) {
    fail("signature-slot", "input slots must be distinct declared slots");
  }
  const outputSlot = normalizeName(definition.outputSlot, "output slot");
  if (!slotSet.has(outputSlot)) fail("signature-slot", "output slot must be declared", { outputSlot });

  const instructions = definition.instructions;
  if (!Array.isArray(instructions) || instructions.length < 1 || instructions.length > MAX_FUNCTION_INSTRUCTIONS) {
    fail("instruction-limit", `function must contain 1 through ${MAX_FUNCTION_INSTRUCTIONS} instructions`);
  }
  const normalizedInstructions = instructions.map((instruction, index) => {
    if (!instruction || typeof instruction !== "object" || Array.isArray(instruction)) {
      fail("invalid-instruction", `instruction ${index + 1} must be a map`);
    }
    const op = String(instruction.op ?? "").trim().toLowerCase();
    if (!OPERATIONS.has(op)) fail("unsupported-operation", `unsupported VLIW operation: ${op || "<empty>"}`, { index });
    const target = normalizeName(instruction.target, "instruction target");
    const left = normalizeName(instruction.left, "left operand");
    const right = normalizeName(instruction.right, "right operand");
    for (const slot of [target, left, right]) {
      if (!slotSet.has(slot)) fail("unknown-slot", `instruction ${index + 1} references unknown slot ${slot}`, { slot });
    }
    return { op, target, left, right };
  });

  return {
    schemaVersion: 1,
    name,
    slots: normalizedSlots,
    inputSlots: normalizedInputs,
    outputSlot,
    instructions: normalizedInstructions
  };
}

function applyOperation(op, left, right) {
  if (op === "plus") return Math.min(0xffff, left + right);
  if (op === "subtract") return Math.max(0, left - right);
  return (left ^ right) & 0xffff;
}

export function executeVliwFunction(definition, inputValues = {}) {
  const fn = normalizeVliwFunction(definition);
  if (!inputValues || typeof inputValues !== "object" || Array.isArray(inputValues)) {
    fail("invalid-inputs", "function input values must be a map");
  }
  const slots = Object.fromEntries(fn.slots.map((slot) => [slot, 0]));
  for (const inputSlot of fn.inputSlots) {
    if (!Object.hasOwn(inputValues, inputSlot)) {
      fail("missing-input", `missing function input ${inputSlot}`, { inputSlot });
    }
    slots[inputSlot] = uint16(inputValues[inputSlot], `input ${inputSlot}`);
  }
  for (const [index, instruction] of fn.instructions.entries()) {
    const left = slots[instruction.left];
    const right = slots[instruction.right];
    if (left === undefined || right === undefined) {
      fail("uninitialized-slot", `instruction ${index + 1} reads an unavailable slot`);
    }
    slots[instruction.target] = applyOperation(instruction.op, left, right);
  }
  return slots[fn.outputSlot];
}

export function scoreVliwFunction(definition, cases = []) {
  const fn = normalizeVliwFunction(definition);
  if (!Array.isArray(cases) || cases.length === 0) {
    fail("empty-cases", "function scoring requires at least one case");
  }
  const results = cases.map((testCase, index) => {
    if (!testCase || typeof testCase !== "object" || Array.isArray(testCase)) {
      fail("invalid-case", `case ${index + 1} must be a map`);
    }
    const expected = uint16(testCase.expected, `case ${index + 1} expected`);
    const actual = executeVliwFunction(fn, testCase.values);
    return { actual, expected, absoluteError: Math.abs(actual - expected) };
  });
  return {
    incorrectCount: results.filter((result) => result.absoluteError !== 0).length,
    totalAbsoluteError: results.reduce((total, result) => total + result.absoluteError, 0),
    instructionCount: fn.instructions.length,
    results
  };
}

export function compareVliwFitness(left, right) {
  for (const field of ["incorrectCount", "totalAbsoluteError", "instructionCount"]) {
    const delta = Number(left?.[field] ?? 0) - Number(right?.[field] ?? 0);
    if (delta !== 0) return delta;
  }
  return 0;
}

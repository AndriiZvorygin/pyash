export const DEFAULT_VLIW_FUNCTION_STEP_BUDGET = 65_536;
export const MAX_VLIW_FUNCTION_STEP_BUDGET = 10_000_000;
export const MAX_VLIW_FUNCTION_BYTES = 1_048_576;
const OPERATIONS = new Set([
  "plus", "subtract", "xor", "multiply", "divide", "remains", "exponential",
  "equally", "tiny", "giant"
]);

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

function uint32(value, role) {
  if (!Number.isSafeInteger(value) || value < 0 || value > 0xffffffff) {
    fail("numeric-range", `${role} must be an unsigned 32-bit integer`, { role, value });
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
  if (!Array.isArray(slots) || slots.length < 2) {
    fail("slot-limit", "function must declare at least two named slots");
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

  const stepBudget = Number(definition.stepBudget ?? DEFAULT_VLIW_FUNCTION_STEP_BUDGET);
  if (!Number.isSafeInteger(stepBudget) || stepBudget < 1 || stepBudget > MAX_VLIW_FUNCTION_STEP_BUDGET) {
    fail("step-budget", `stepBudget must be an integer from 1 through ${MAX_VLIW_FUNCTION_STEP_BUDGET}`);
  }
  const instructions = definition.instructions;
  if (!Array.isArray(instructions) || instructions.length < 1) {
    fail("instruction-limit", "function must contain at least one instruction");
  }
  if (instructions.length > stepBudget) {
    fail("step-budget", `function requires ${instructions.length} steps but stepBudget is ${stepBudget}`);
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

  const normalized = {
    schemaVersion: 1,
    name,
    slots: normalizedSlots,
    inputSlots: normalizedInputs,
    outputSlot,
    stepBudget,
    instructions: normalizedInstructions
  };
  const serializedBytes = new TextEncoder().encode(JSON.stringify(normalized)).byteLength;
  if (serializedBytes > MAX_VLIW_FUNCTION_BYTES) {
    fail("function-size", `function exceeds the ${MAX_VLIW_FUNCTION_BYTES}-byte safety limit`, {
      serializedBytes
    });
  }
  return normalized;
}

function applyOperation(op, left, right) {
  if (!Number.isInteger(left) || left < 0 || left > 0xffff
    || !Number.isInteger(right) || right < 0 || right > 0xffff) {
    fail("numeric-range", `${op} requires unsigned 16-bit operands`, { left, right });
  }
  if (op === "plus") return Math.min(0xffff, left + right);
  if (op === "subtract") return Math.max(0, left - right);
  if (op === "xor") return (left ^ right) & 0xffff;
  if (op === "multiply") return left * right;
  if (op === "divide" || op === "remains") {
    if (right === 0) fail("division-by-zero", `${op} failed: division by zero`);
    return op === "divide" ? Math.floor(left / right) : left % right;
  }
  if (op === "exponential") {
    let result = 1;
    let factor = left;
    let exponent = right;
    while (exponent > 0) {
      if (exponent & 1) result = Math.min(0xffff, result * factor);
      exponent >>>= 1;
      if (exponent > 0) factor = Math.min(0xffff, factor * factor);
    }
    return result;
  }
  if (op === "equally") return Number(left === right);
  if (op === "tiny") return Number(left < right);
  if (op === "giant") return Number(left > right);
  fail("unsupported-operation", `unsupported VLIW operation: ${op}`);
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
    const expected = uint32(testCase.expected, `case ${index + 1} expected`);
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

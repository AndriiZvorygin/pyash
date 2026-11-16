import { decodeNumericArithmeticCodelet, executeNumericArithmeticCodelet } from "./arithmetic.mjs";
import { decodePyacPack } from "./database.mjs";
import { createHousekeeperVliwBatchEvaluator } from "./housekeeper.mjs";

const OPERAND_CASES = ["from", "to", "with", "by"];

function fail(message, details = {}) {
  const error = new Error(message);
  error.name = "VliwCudaBatchError";
  error.details = details;
  throw error;
}

function decodeScalarArithmetic(words, codeletIndex) {
  let sentence;
  try {
    sentence = decodeNumericArithmeticCodelet(words);
  } catch (cause) {
    fail("Housekeeper CUDA PyAC path only supports scalar numeric arithmetic codelets", {
      codeletIndex,
      cause: cause?.message ?? String(cause)
    });
  }
  const roles = OPERAND_CASES.filter((role) => sentence[role] !== undefined);
  if (
    !Number.isInteger(sentence.ob?.num)
    || roles.length !== 1
    || !Number.isInteger(sentence[roles[0]]?.num)
  ) {
    fail("Housekeeper CUDA PyAC path only supports scalar numeric arithmetic codelets", {
      codeletIndex,
      sentence
    });
  }
  return {
    sentence,
    left: sentence.ob.num,
    right: sentence[roles[0]].num
  };
}

/** Execute decoded scalar-arithmetic codelets through the durable CUDA Housekeeper. */
export async function executeNumericPyacPackThroughHousekeeper(pack, {
  evaluateBatch = createHousekeeperVliwBatchEvaluator()
} = {}) {
  if (typeof evaluateBatch !== "function") fail("VLIW CUDA batch requires an evaluateBatch function");
  const decoded = decodePyacPack(pack);
  if (decoded.codelets.length === 0) fail("VLIW CUDA batch requires a non-empty PyAC pack");

  const grouped = new Map();
  const values = new Array(decoded.codelets.length);
  for (const [index, words] of decoded.codelets.entries()) {
    const { sentence, left, right } = decodeScalarArithmetic(words, index + 1);
    const reference = await executeNumericArithmeticCodelet(words);
    const entry = { index, left, right, expected: reference.ob.num, reference };
    if (!grouped.has(sentence.be)) grouped.set(sentence.be, []);
    grouped.get(sentence.be).push(entry);
  }

  await Promise.all([...grouped.entries()].map(async ([operation, entries]) => {
    const candidateId = `pyac-${operation}`;
    const batch = {
      schemaVersion: 1,
      slots: ["left", "right", "result"],
      inputSlots: ["left", "right"],
      outputSlot: "result",
      cases: entries.map((entry) => ({
        values: { left: entry.left, right: entry.right },
        expected: entry.expected
      })),
      candidates: [{
        id: candidateId,
        instructions: [{ op: operation, target: "result", left: "left", right: "right" }]
      }]
    };
    const scores = await evaluateBatch(batch);
    const score = Array.isArray(scores) ? scores.find((item) => item?.id === candidateId) : null;
    if (!score || !Array.isArray(score.outputs) || score.outputs.length !== entries.length) {
      fail(`Housekeeper omitted scalar ${operation} PyAC outputs`, { candidateId });
    }
    for (const [entryIndex, entry] of entries.entries()) {
      const actual = Number(score.outputs[entryIndex]);
      if (!Number.isSafeInteger(actual) || actual !== entry.expected) {
        fail(`Housekeeper CUDA result disagrees with Pyash arithmetic at codelet ${entry.index + 1}`, {
          operation,
          expected: entry.expected,
          actual: score.outputs[entryIndex]
        });
      }
      values[entry.index] = { ...entry.reference, ob: { num: actual } };
    }
  }));

  return {
    backend: "housekeeper-cuda",
    codeletCount: decoded.codelets.length,
    values
  };
}

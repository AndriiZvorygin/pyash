import { VliwEncodingError } from "./plus.mjs";

const OPERATION = "kl6m psas";
const MAX_LANES = 16;

function invalid(code, message, details = {}) {
  return new VliwEncodingError(code, message, details);
}

export function isScalarProductSentence(sentence) {
  return sentence?.mood === "do" && sentence?.be === OPERATION;
}

export function normalizeScalarProductSentence(sentence) {
  if (!isScalarProductSentence(sentence)) {
    throw invalid("unsupported-sentence", "scalar product requires mood do and verb kl6m psas");
  }
  const keys = Object.keys(sentence).sort();
  if (keys.join(",") !== "be,by,mood,ob") {
    throw invalid("unsupported-sentence", "scalar product requires exactly mood, ob, by, and be", {
      keys
    });
  }
  const left = normalizeOperand(sentence.ob, "ob");
  const right = normalizeOperand(sentence.by, "by");
  if (left.type !== right.type) {
    throw invalid("unsupported-vector-type", "scalar product operands must use the same float type", {
      left: left.type,
      right: right.type
    });
  }
  if (left.values.length !== right.values.length) {
    throw invalid("unsupported-vector-width", "scalar product operands must have equal lengths", {
      left: left.values.length,
      right: right.values.length
    });
  }
  return { mood: "do", ob: { ve: left }, by: { ve: right }, be: OPERATION };
}

function normalizeOperand(value, role) {
  const vector = value?.ve;
  if (!vector || !["float32", "float64"].includes(vector.type) || !Array.isArray(vector.values)) {
    throw invalid("unsupported-vector-type", `scalar product ${role} requires a float32 or float64 vector`);
  }
  if (vector.values.length < 1 || vector.values.length > MAX_LANES) {
    throw invalid("unsupported-vector-width", `scalar product ${role} vector must have 1 to ${MAX_LANES} lanes`, {
      count: vector.values.length
    });
  }
  const values = vector.values.map((value) => {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw invalid("non-finite-float", `scalar product ${role} values must be finite numbers`, { value });
    }
    const normalized = vector.type === "float32" ? Math.fround(value) : value;
    if (!Number.isFinite(normalized)) {
      throw invalid("non-finite-float", `scalar product ${role} value is outside ${vector.type} range`, { value });
    }
    return normalized;
  });
  return { type: vector.type, values };
}

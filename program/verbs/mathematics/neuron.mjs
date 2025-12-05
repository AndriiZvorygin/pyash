function resolveVector(name, remember) {
  const fact = name?.ve ? name : remember(name?.name || name);
  const vector = fact?.obj?.ve ?? fact?.ve ?? fact?.obj;
  if (!vector?.values || !Array.isArray(vector.values)) {
    throw new Error("neuron: weights/inputs must be vectors");
  }
  const nums = vector.values.map(v => (typeof v === "number" ? v : Number(v)));
  if (nums.some(n => Number.isNaN(n))) throw new Error("neuron: vector elements must be numeric");
  return nums;
}

function resolveScalar(ref, remember, label) {
  if (ref == null) throw new Error(`neuron: ${label} is required`);
  if (typeof ref === "number") return ref;
  if (typeof ref.num === "number") return ref.num;
  if (typeof ref.name === "string") {
    const fact = remember(ref.name);
    if (typeof fact?.obj?.num === "number") return fact.obj.num;
    if (typeof fact?.obj === "number") return fact.obj;
  }
  throw new Error(`neuron: ${label} is required`);
}

function sigmoid(z) {
  return 1 / (1 + Math.exp(-z));
}

export async function neuron_by_name_vec_num_from_name_vec_num_fromstate_num_to_name_num(sentence, { remember }) {
  const weights = resolveVector(sentence.from, remember);
  const inputs = resolveVector(sentence.by, remember);
  if (weights.length !== inputs.length) throw new Error("neuron: weights and inputs length mismatch");

  const bias = resolveScalar(sentence.fromstate, remember, "bias");

  const dot = weights.reduce((acc, w, idx) => acc + w * inputs[idx], 0);
  const activated = sigmoid(dot + bias);

  return { obj: activated, be: sentence?.be ?? "number" };
}

export const neuron = neuron_by_name_vec_num_from_name_vec_num_fromstate_num_to_name_num;

export const signatures = [
  {
    signatureWords: [
      "be", "neuron",
      "by", "name", "vec", "num",
      "from", "name", "vec", "num",
      "fromstate", "name", "num",
      "to", "name", "num"
    ],
    handler: neuron_by_name_vec_num_from_name_vec_num_fromstate_num_to_name_num
  },
  {
    signatureWords: [
      "be", "neuron",
      "by", "name", "vec", "num",
      "from", "name", "vec", "num",
      "to", "name", "num"
    ],
    handler: neuron_by_name_vec_num_from_name_vec_num_fromstate_num_to_name_num
  },
  {
    signatureWords: [
      "be", "neuron",
      "by", "name", "vec", "num",
      "from", "name", "vec", "letter",
      "fromstate", "name", "num",
      "to", "name", "num"
    ],
    handler: neuron_by_name_vec_num_from_name_vec_num_fromstate_num_to_name_num
  }
];

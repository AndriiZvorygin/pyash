function resolveVector(v, remember) {
  if (!v) return undefined;
  if (v.ve?.values) return v.ve;
  if (v.values && v.type) return v;
  if (typeof v.name === "string") {
    const found = remember(v.name);
    if (found?.obj?.ve?.values) return found.obj.ve;
    if (found?.obj?.values && found.obj?.type) return found.obj;
  }
  return undefined;
}

function toNumeric(values) {
  const nums = values.map(val => (typeof val === "number" ? val : Number(val)));
  if (nums.some(n => Number.isNaN(n))) throw new Error("produce: vectors must contain numeric values");
  return nums;
}

export async function produce(sentence, { remember }) {
  const leftVec =
    resolveVector(sentence.obj, remember) ||
    resolveVector(sentence.from, remember);
  const rightVec = resolveVector(sentence.by, remember);

  if (!leftVec || !rightVec) throw new Error("produce: both obj/from and by vectors are required");
  const left = toNumeric(leftVec.values);
  const right = toNumeric(rightVec.values);
  if (left.length !== right.length) throw new Error("produce: vectors must be the same length");

  const sum = left.reduce((acc, v, idx) => acc + v * right[idx], 0);
  return { obj: sum, be: sentence?.be ?? "number" };
}

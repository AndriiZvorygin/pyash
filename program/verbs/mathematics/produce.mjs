function resolveVector(v, remember) {
  if (!v) return undefined;
  if (v.ve?.values) return v.ve;
  if (v.values && v.type) return v;
  if (typeof v.name === "string") {
    const found = remember(v.name);
    if (found?.ob?.ve?.values) return found.ob.ve;
    if (found?.ob?.values && found.ob?.type) return found.ob;
  }
  return undefined;
}

function toNumeric(values) {
  const nums = values.map(val => (typeof val === "number" ? val : Number(val)));
  if (nums.some(n => Number.isNaN(n))) throw new Error("produce: vectors must contain numeric values");
  return nums;
}

export async function produce_by_name_vec_num_from_name_vec_num_to_name_num(sentence, { remember }) {
  const leftVec = resolveVector(sentence.ob ?? sentence.from, remember);
  const rightVec = resolveVector(sentence.by, remember);

  if (!leftVec || !rightVec) throw new Error("produce: both ob/from and by vectors are required");
  const left = toNumeric(leftVec.values);
  const right = toNumeric(rightVec.values);
  if (left.length !== right.length) throw new Error("produce: vectors must be the same length");

  const sum = left.reduce((acc, v, idx) => acc + v * right[idx], 0);
  return { ob: sum, be: sentence?.be ?? "number" };
}

export const produce = produce_by_name_vec_num_from_name_vec_num_to_name_num;

export const signatures = [
  {
    signatureWords: ["be", "produce", "by", "vec", "num", "ob", "vec", "num", "to", "name", "num"],
    handler: produce_by_name_vec_num_from_name_vec_num_to_name_num
  },
  {
    signatureWords: ["be", "produce", "by", "name", "vec", "num", "from", "name", "vec", "num", "to", "name", "num"],
    handler: produce_by_name_vec_num_from_name_vec_num_to_name_num
  },
  {
    signatureWords: ["be", "produce", "by", "name", "vec", "num", "from", "name", "vec", "num"],
    handler: produce_by_name_vec_num_from_name_vec_num_to_name_num
  },
  {
    signatureWords: ["be", "produce", "by", "vec", "num", "ob", "vec", "letter", "to", "name", "num"],
    handler: produce_by_name_vec_num_from_name_vec_num_to_name_num
  }
];

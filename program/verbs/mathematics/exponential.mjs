function resolveNumber(v, remember) {
  if (v == null) return undefined;
  if (typeof v === "number") return v;
  if (typeof v.num === "number") return v.num;
  if (typeof v.name === "string") {
    const found = remember(v.name);
    if (typeof found?.obj?.num === "number") return found.obj.num;
    if (typeof found?.obj === "number") return found.obj;
  }
  return undefined;
}

export async function exponential_obj_num_to_name_num(sentence, { remember }) {
  const value = resolveNumber(sentence.obj, remember);
  if (value === undefined) throw new Error("exponential: obj is required");

  return { obj: Math.exp(value), be: sentence?.be ?? "number" };
}

export const exponential = exponential_obj_num_to_name_num;

export const signatures = [
  { signatureWords: ["be", "exponential", "obj", "num", "to", "name", "num"], handler: exponential_obj_num_to_name_num },
  { signatureWords: ["be", "exponential", "obj", "name", "num", "to", "name", "num"], handler: exponential_obj_num_to_name_num }
];

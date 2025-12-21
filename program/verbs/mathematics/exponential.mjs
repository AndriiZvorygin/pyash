function resolveNumber(v, remember) {
  if (v == null) return undefined;
  if (typeof v === "number") return v;
  if (typeof v.num === "number") return v.num;
  if (typeof v.name === "string") {
    if (v.name === "eulers_number") return Math.E;
    const found = remember(v.name);
    if (typeof found?.obj?.num === "number") return found.obj.num;
    if (typeof found?.obj === "number") return found.obj;
  }
  return undefined;
}

export async function exponential_obj_num_to_name_num(sentence, { remember }) {
  const base = resolveNumber(sentence.obj, remember);
  if (base === undefined) throw new Error("exponential: obj is required");
  const exponent = resolveNumber(sentence.from ?? sentence.by, remember);
  if (exponent === undefined) throw new Error("exponential: from/by is required");

  return { obj: Math.pow(base, exponent), be: sentence?.be ?? "number" };
}

export const exponential = exponential_obj_num_to_name_num;

export const signatures = [
  { signatureWords: ["be", "exponential", "from", "num", "obj", "num", "to", "name", "num"], handler: exponential_obj_num_to_name_num },
  { signatureWords: ["be", "exponential", "from", "num", "obj", "name", "num", "to", "name", "num"], handler: exponential_obj_num_to_name_num },
  { signatureWords: ["be", "exponential", "from", "name", "num", "obj", "num", "to", "name", "num"], handler: exponential_obj_num_to_name_num },
  { signatureWords: ["be", "exponential", "from", "name", "num", "obj", "name", "num", "to", "name", "num"], handler: exponential_obj_num_to_name_num },
  { signatureWords: ["be", "exponential", "from", "num", "obj", "num"], handler: exponential_obj_num_to_name_num },
  { signatureWords: ["be", "exponential", "from", "num", "obj", "name", "num"], handler: exponential_obj_num_to_name_num },
  { signatureWords: ["be", "exponential", "from", "name", "num", "obj", "num"], handler: exponential_obj_num_to_name_num },
  { signatureWords: ["be", "exponential", "from", "name", "num", "obj", "name", "num"], handler: exponential_obj_num_to_name_num }
];

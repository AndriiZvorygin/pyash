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

export async function invert_obj_num_to_name_num(sentence, { remember }) {
  const value = resolveNumber(sentence.obj, remember);
  if (value === undefined) throw new Error("invert: obj is required");

  return { obj: -value, be: sentence?.be ?? "number" };
}

export const invert = invert_obj_num_to_name_num;

export const signatures = [
  { signatureWords: ["be", "invert", "obj", "num", "to", "name", "num"], handler: invert_obj_num_to_name_num },
  { signatureWords: ["be", "invert", "obj", "name", "num", "to", "name", "num"], handler: invert_obj_num_to_name_num },
  { signatureWords: ["be", "invert", "obj", "num"], handler: invert_obj_num_to_name_num },
  { signatureWords: ["be", "invert", "obj", "name", "num"], handler: invert_obj_num_to_name_num },
  { signatureWords: ["be", "invert", "at", "num", "obj", "num"], handler: invert_obj_num_to_name_num },
  { signatureWords: ["be", "invert", "obj", "num", "at", "num"], handler: invert_obj_num_to_name_num },
  { signatureWords: ["be", "invert", "at", "num", "obj", "num", "to", "name", "num"], handler: invert_obj_num_to_name_num },
  { signatureWords: ["be", "invert", "obj", "num", "at", "num", "to", "name", "num"], handler: invert_obj_num_to_name_num }
];

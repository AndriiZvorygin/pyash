function detectValue(v, remember) {
  if (v == null) return 0;
  if (typeof v === "number") return v;
  if (typeof v.num === "number") return v.num;
  if (typeof v.name === "string") {
    const found = remember(v.name);
    if (found?.obj?.num !== undefined) return found.obj.num;
    if (typeof found?.obj === "number") return found.obj;
  }
  return 0;
}

export async function subtract_by_num_from_name_num_to_name_num(sentence, { remember }) {
  const targetName = sentence?.to?.name || sentence?.from?.name;
  if (!targetName) throw new Error("subtract: target name required (to name ... or from name ...)");

  const target = remember(targetName);
  const targetVal = detectValue(target?.obj ?? sentence.to, remember);
  const subtrahend = detectValue(sentence.obj, remember);
  const result = targetVal - subtrahend;

  return { obj: result, be: sentence?.be ?? "number" };
}

// Vector element subtract: be subtract obj num X from name vec at num idx
export async function subtract_obj_num_from_name_vec_at_num(sentence, { remember }) {
  const vecName = sentence.from?.name ?? sentence.obj?.name;
  const idx = sentence.at?.num;
  const delta = Number(sentence.obj?.num ?? 0);
  if (!vecName || idx == null) throw new Error("subtract: vector name, obj num, and at index are required");

  const fact = remember ? remember(vecName) : null;
  if (!fact?.obj?.ve?.values) throw new Error("subtract: target is not a vector");
  const i = Number(idx) - 1;
  if (!Number.isInteger(i) || i < 0 || i >= fact.obj.ve.values.length) throw new Error("subtract: index out of range");

  const curr = Number(fact.obj.ve.values[i] ?? 0);
  fact.obj.ve.values[i] = curr - delta;
  return { obj: fact.obj };
}

export const subtract = subtract_by_num_from_name_num_to_name_num;

export const signatures = [
  {
    signatureWords: ["be", "subtract", "by", "num", "from", "name", "num", "to", "name", "num"],
    handler: subtract_by_num_from_name_num_to_name_num
  },
  {
    signatureWords: ["be", "subtract", "from", "name", "num", "obj", "num"],
    handler: subtract_by_num_from_name_num_to_name_num
  },
  {
    signatureWords: ["be", "subtract", "from", "name", "num", "obj", "name", "num"],
    handler: subtract_by_num_from_name_num_to_name_num
  },
  {
    signatureWords: ["be", "subtract", "from", "name", "num", "obj", "name", "num", "to", "name", "num"],
    handler: subtract_by_num_from_name_num_to_name_num
  },
  {
    signatureWords: ["be", "subtract", "from", "name", "num", "obj", "num", "to", "name", "num"],
    handler: subtract_by_num_from_name_num_to_name_num
  },
  {
    signatureWords: ["be", "subtract", "from", "name", "num", "to", "name", "num"],
    handler: subtract_by_num_from_name_num_to_name_num
  },
  {
    signatureWords: ["be", "subtract", "obj", "num"],
    handler: subtract_by_num_from_name_num_to_name_num
  },
  {
    signatureWords: ["be", "subtract", "obj", "name", "num"],
    handler: subtract_by_num_from_name_num_to_name_num
  },
  {
    signatureWords: ["be", "subtract", "obj", "num", "from", "name", "vec", "at", "num"],
    handler: subtract_obj_num_from_name_vec_at_num
  },
  {
    signatureWords: ["be", "subtract", "at", "num", "from", "name", "vec", "obj", "num"],
    handler: subtract_obj_num_from_name_vec_at_num
  },
  {
    signatureWords: ["be", "subtract", "at", "num", "from", "name", "num", "obj", "num"],
    handler: subtract_obj_num_from_name_vec_at_num
  },
  {
    signatureWords: ["be", "subtract", "at", "num", "from", "name", "vec", "num", "obj", "num"],
    handler: subtract_obj_num_from_name_vec_at_num
  }
];

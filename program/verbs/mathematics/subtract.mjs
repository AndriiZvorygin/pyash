function detectValue(v, remember) {
  if (v == null) return 0;
  if (typeof v === "number") return v;
  if (typeof v.num === "number") return v.num;
  if (typeof v.name === "string") {
    const found = remember(v.name);
    if (found?.ob?.num !== undefined) return found.ob.num;
    if (typeof found?.ob === "number") return found.ob;
  }
  return 0;
}

export async function subtract_by_num_from_name_num_to_name_num(sentence, { remember }) {
  const targetName = sentence?.to?.name || sentence?.from?.name;
  if (!targetName) throw new Error("subtract: target name required (to name ... or from name ...)");

  const target = remember(targetName);
  const targetVal = detectValue(target?.ob ?? sentence.to, remember);
  const subtrahend = detectValue(sentence.ob, remember);
  const result = targetVal - subtrahend;

  return { ob: result, be: sentence?.be ?? "number" };
}

// Vector element subtract: be subtract ob num X from name vec at num idx
export async function subtract_obj_num_from_name_vec_at_num(sentence, { remember }) {
  const vecName = sentence.from?.name ?? sentence.ob?.name;
  const idx = sentence.at?.num;
  const delta = Number(sentence.ob?.num ?? 0);
  if (!vecName || idx == null) throw new Error("subtract: vector name, ob num, and at index are required");

  const fact = remember ? remember(vecName) : null;
  if (!fact?.ob?.ve?.values) throw new Error("subtract: target is not a vector");
  const i = Number(idx) - 1;
  if (!Number.isInteger(i) || i < 0 || i >= fact.ob.ve.values.length) throw new Error("subtract: index out of range");

  const curr = Number(fact.ob.ve.values[i] ?? 0);
  fact.ob.ve.values[i] = curr - delta;
  return { ob: fact.ob };
}

export const subtract = subtract_by_num_from_name_num_to_name_num;

export const signatures = [
  {
    signatureWords: ["be", "subtract", "by", "num", "from", "name", "num", "to", "name", "num"],
    handler: subtract_by_num_from_name_num_to_name_num
  },
  {
    signatureWords: ["be", "subtract", "from", "name", "num", "ob", "num"],
    handler: subtract_by_num_from_name_num_to_name_num
  },
  {
    signatureWords: ["be", "subtract", "from", "name", "num", "ob", "name", "num"],
    handler: subtract_by_num_from_name_num_to_name_num
  },
  {
    signatureWords: ["be", "subtract", "from", "name", "num", "ob", "name", "num", "to", "name", "num"],
    handler: subtract_by_num_from_name_num_to_name_num
  },
  {
    signatureWords: ["be", "subtract", "from", "name", "num", "ob", "num", "to", "name", "num"],
    handler: subtract_by_num_from_name_num_to_name_num
  },
  {
    signatureWords: ["be", "subtract", "from", "name", "num", "to", "name", "num"],
    handler: subtract_by_num_from_name_num_to_name_num
  },
  {
    signatureWords: ["be", "subtract", "ob", "num"],
    handler: subtract_by_num_from_name_num_to_name_num
  },
  {
    signatureWords: ["be", "subtract", "ob", "name", "num"],
    handler: subtract_by_num_from_name_num_to_name_num
  },
  {
    signatureWords: ["be", "subtract", "ob", "num", "from", "name", "vec", "at", "num"],
    handler: subtract_obj_num_from_name_vec_at_num
  },
  {
    signatureWords: ["be", "subtract", "at", "num", "from", "name", "vec", "ob", "num"],
    handler: subtract_obj_num_from_name_vec_at_num
  },
  {
    signatureWords: ["be", "subtract", "at", "num", "from", "name", "num", "ob", "num"],
    handler: subtract_obj_num_from_name_vec_at_num
  },
  {
    signatureWords: ["be", "subtract", "at", "num", "from", "name", "vec", "num", "ob", "num"],
    handler: subtract_obj_num_from_name_vec_at_num
  }
];

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
  }
];

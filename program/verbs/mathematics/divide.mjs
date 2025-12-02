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

function getOperand(v, label, remember) {
  const n = resolveNumber(v, remember);
  if (n === undefined) throw new Error(`divide: ${label} is required`);
  return n;
}

export async function divide_by_num_from_name_num_to_name_num(sentence, { remember }) {
  const numerator = getOperand(sentence.obj ?? sentence.from, "obj", remember);
  const denominator = getOperand(sentence.by, "by", remember);
  if (denominator === 0) throw new Error("divide: by cannot be zero");

  return { obj: numerator / denominator, be: sentence?.be ?? "number" };
}

// Backwards-compatible export until dispatch switches to signature names.
export const divide = divide_by_num_from_name_num_to_name_num;

export const signatures = [
  {
    signatureWords: ["be", "divide", "by", "num", "from", "name", "num", "to", "name", "num"],
    handler: divide_by_num_from_name_num_to_name_num
  }
];

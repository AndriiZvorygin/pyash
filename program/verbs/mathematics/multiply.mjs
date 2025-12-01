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
  if (n === undefined) throw new Error(`multiply: ${label} is required`);
  return n;
}

export async function multiply(sentence, { remember }) {
  if (!sentence.obj && !sentence.from) throw new Error("multiply: obj or from is required");
  if (!sentence.by) throw new Error("multiply: by is required");
  const lhs = getOperand(sentence.obj ?? sentence.from, "obj", remember);
  const rhs = getOperand(sentence.by, "by", remember);
  const product = lhs * rhs;

  return { obj: product, be: sentence?.be ?? "number" };
}

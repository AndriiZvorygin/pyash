import { remember } from "../../remember/index.mjs";

function resolveNumber(v) {
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

function getOperand(v, label) {
  const n = resolveNumber(v);
  if (n === undefined) throw new Error(`divide: ${label} is required`);
  return n;
}

export async function divide({ obj, sentence }) {
  const numerator = getOperand(obj ?? sentence?.from, "obj");
  const denominator = getOperand(sentence?.by, "by");
  if (denominator === 0) throw new Error("divide: by cannot be zero");

  return { obj: numerator / denominator, be: sentence?.be ?? "number" };
}

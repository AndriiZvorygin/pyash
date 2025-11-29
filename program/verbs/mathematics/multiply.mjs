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
  if (n === undefined) throw new Error(`multiply: ${label} is required`);
  return n;
}

export async function multiply({ obj, sentence }) {
  const lhs = getOperand(obj, "obj");
  const rhs = getOperand(sentence?.by, "by");
  const product = lhs * rhs;

  return { obj: product, be: sentence?.be ?? "number" };
}

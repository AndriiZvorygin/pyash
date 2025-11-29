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

export async function exponential(sentence) {
  const value = resolveNumber(sentence.resolved?.obj ?? sentence.obj);
  if (value === undefined) throw new Error("exponential: obj is required");

  return { obj: Math.exp(value), be: sentence?.be ?? "number" };
}

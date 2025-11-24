import { getMemory } from "../memory/index.mjs";

function detectValue(v) {
  if (v == null) return 0;
  if (typeof v === "number") return v;
  if (typeof v.num === "number") return v.num;
  if (typeof v.name === "string") {
    const found = getMemory(v.name);
    if (found?.obj?.num !== undefined) return found.obj.num;
    if (typeof found?.obj === "number") return found.obj;
  }
  return 0;
}

export async function subtract({ obj, to, from, sentence }) {
  const targetName = sentence?.to?.name || sentence?.from?.name;
  if (!targetName) throw new Error("subtract: target name required (to name ... or from name ...)");

  const target = getMemory(targetName);
  const targetVal = detectValue(target?.obj ?? to);
  const subtrahend = detectValue(obj);
  const result = targetVal - subtrahend;

  return { obj: result, be: sentence?.be ?? "number" };
}

// Simplified add: only supports numeric addition for now.
function toNumber(v) {
  if (v == null) return 0;
  if (typeof v === "number") return v;
  if (typeof v.num === "number") return v.num;
  return 0;
}

export async function add(sentence, { remember }) {
  const a = toNumber(sentence.obj);
  const b = toNumber(sentence.to);
  return { obj: a + b, be: "number" };
}

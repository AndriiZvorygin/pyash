// Simplified add: only supports numeric addition for now.
function toNumber(v) {
  if (v == null) return 0;
  if (typeof v === "number") return v;
  if (typeof v.num === "number") return v.num;
  return 0;
}

export async function add_obj_num_to_name_num(sentence, { remember }) {
  if (sentence.obj == null) throw new Error("add: obj is required");
  if (sentence.to == null) throw new Error("add: to is required");
  const a = toNumber(sentence.obj);
  const b = toNumber(sentence.to);
  return { obj: a + b, be: "number" };
}

// Backwards-compatible export until dispatch switches to signature names.
export const add = add_obj_num_to_name_num;

export const signatures = [
  { signatureWords: ["be", "add", "obj", "num", "to", "name", "num"], handler: add_obj_num_to_name_num }
];

// Exclusive or: the ob operand and the secondary operand are compared bit by
// bit, and a bit is set when exactly one of them carries it.
//
// The operand order follows the other mathematics verbs: the ob operand is the
// left-hand side and the secondary role (to, from, with) is the right-hand
// side.

function resolveNumber(v, remember) {
  if (v == null) return undefined;
  if (typeof v === "number") return v;
  if (typeof v.num === "number") return v.num;
  if (typeof v.name === "string") {
    const found = remember(v.name);
    if (typeof found?.ob?.num === "number") return found.ob.num;
    if (typeof found?.ob === "number") return found.ob;
  }
  return undefined;
}

export async function xor_obj_num_to_num(sentence, { remember }) {
  const left = resolveNumber(sentence.ob, remember);
  if (left === undefined) throw new Error("xor: ob is required");
  const right = resolveNumber(sentence.to ?? sentence.from ?? sentence.with, remember);
  if (right === undefined) throw new Error("xor: to/from/with is required");

  return { ob: left ^ right, be: sentence?.be ?? "number" };
}

export const xor = xor_obj_num_to_num;

export const signatures = [
  { signatureWords: ["be", "xor", "ob", "num", "to", "num"], handler: xor_obj_num_to_num },
  { signatureWords: ["be", "xor", "ob", "num", "from", "num"], handler: xor_obj_num_to_num },
  { signatureWords: ["be", "xor", "ob", "num", "with", "num"], handler: xor_obj_num_to_num },
  { signatureWords: ["be", "xor", "ob", "name", "num", "to", "num"], handler: xor_obj_num_to_num },
  { signatureWords: ["be", "xor", "ob", "name", "num", "from", "num"], handler: xor_obj_num_to_num },
  { signatureWords: ["be", "xor", "ob", "name", "num", "with", "num"], handler: xor_obj_num_to_num },
  { signatureWords: ["be", "xor", "ob", "num", "to", "name", "num"], handler: xor_obj_num_to_num },
  { signatureWords: ["be", "xor", "ob", "num", "from", "name", "num"], handler: xor_obj_num_to_num },
  { signatureWords: ["be", "xor", "ob", "num", "with", "name", "num"], handler: xor_obj_num_to_num }
];

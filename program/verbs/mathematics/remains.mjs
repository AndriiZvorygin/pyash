import { state } from "../../bridge/state.mjs";

function resolveNumber(v, remember) {
  if (v == null) return undefined;
  if (typeof v === "number") return v;
  if (typeof v.num === "number") return v.num;
  if (v.genitive) {
    const chainArr = Array.isArray(v.genitive.chain) ? v.genitive.chain : [];
    if (chainArr.length > 0) {
      const [root, ...rest] = chainArr;
      let curr;
      if (root === "this") {
        curr = state.currentEvoke;
      } else if (typeof root === "string") {
        const fact = remember(root);
        curr = fact;
      }
      for (const part of rest) {
        if (curr == null) break;
        curr = curr[part];
      }
      if (typeof curr === "number") return curr;
      if (typeof curr?.num === "number") return curr.num;
    }
  }
  if (v.thisRef) {
    const ev = state.currentEvoke;
    const reg = ev?.[v.thisRef];
    if (typeof reg === "number") return reg;
    if (typeof reg?.num === "number") return reg.num;
  }
  if (typeof v.name === "string") {
    const found = remember(v.name);
    if (typeof found?.obj?.num === "number") return found.obj.num;
    if (typeof found?.obj === "number") return found.obj;
  }
  return undefined;
}

function getOperand(v, label, remember) {
  const n = resolveNumber(v, remember);
  if (n === undefined) throw new Error(`remains: ${label} is required`);
  return n;
}

export async function remains_from_num_obj_num_to_name_num(sentence, { remember }) {
  const dividend = getOperand(sentence.obj, "obj", remember);
  const divisor = getOperand(sentence.from ?? sentence.by, "from", remember);
  if (divisor === 0) throw new Error("remains: from cannot be zero");

  return { obj: dividend % divisor, be: sentence?.be ?? "number" };
}

export const remains = remains_from_num_obj_num_to_name_num;

export const signatures = [
  { signatureWords: ["be", "remains", "obj", "num"], handler: remains_from_num_obj_num_to_name_num },
  { signatureWords: ["be", "remains", "obj", "name", "num"], handler: remains_from_num_obj_num_to_name_num },
  { signatureWords: ["be", "remains", "from", "num", "obj", "num"], handler: remains_from_num_obj_num_to_name_num },
  { signatureWords: ["be", "remains", "from", "name", "num", "obj", "num"], handler: remains_from_num_obj_num_to_name_num },
  { signatureWords: ["be", "remains", "from", "num", "obj", "name", "num"], handler: remains_from_num_obj_num_to_name_num },
  { signatureWords: ["be", "remains", "from", "name", "num", "obj", "name", "num"], handler: remains_from_num_obj_num_to_name_num },
  { signatureWords: ["be", "remains", "from", "num", "obj", "num", "to", "name", "num"], handler: remains_from_num_obj_num_to_name_num },
  { signatureWords: ["be", "remains", "from", "name", "num", "obj", "num", "to", "name", "num"], handler: remains_from_num_obj_num_to_name_num },
  { signatureWords: ["be", "remains", "from", "num", "obj", "name", "num", "to", "name", "num"], handler: remains_from_num_obj_num_to_name_num },
  { signatureWords: ["be", "remains", "from", "name", "num", "obj", "name", "num", "to", "name", "num"], handler: remains_from_num_obj_num_to_name_num },
  { signatureWords: ["be", "remains", "from", "num", "to", "name", "num", "obj", "num"], handler: remains_from_num_obj_num_to_name_num },
  { signatureWords: ["be", "remains", "from", "name", "num", "to", "name", "num", "obj", "num"], handler: remains_from_num_obj_num_to_name_num },
  { signatureWords: ["be", "remains", "from", "num", "to", "name", "num", "obj", "name", "num"], handler: remains_from_num_obj_num_to_name_num },
  { signatureWords: ["be", "remains", "from", "name", "num", "to", "name", "num", "obj", "name", "num"], handler: remains_from_num_obj_num_to_name_num },
  { signatureWords: ["be", "remains", "obj", "num", "from", "num", "to", "name", "num"], handler: remains_from_num_obj_num_to_name_num },
  { signatureWords: ["be", "remains", "obj", "name", "num", "from", "num", "to", "name", "num"], handler: remains_from_num_obj_num_to_name_num },
  { signatureWords: ["be", "remains", "obj", "num", "from", "name", "num", "to", "name", "num"], handler: remains_from_num_obj_num_to_name_num },
  { signatureWords: ["be", "remains", "obj", "name", "num", "from", "name", "num", "to", "name", "num"], handler: remains_from_num_obj_num_to_name_num }
];

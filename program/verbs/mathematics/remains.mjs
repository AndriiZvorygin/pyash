import { state } from "../../bridge/state.mjs";

function resolveNumber(v, remember) {
  if (v == null) return undefined;
  if (typeof v === "number") return v;
  if (typeof v.num === "number") return v.num;
  if (v.genitive) {
    const chainArr = Array.isArray(v.genitive.chain) ? v.genitive.chain : [];
    if (chainArr[0] === "this" && !state.currentEvokeRef && !state.currentEvoke) {
      return 0;
    }
    if (chainArr.length > 0) {
      const [root, ...rest] = chainArr;
      let curr =
        root === "this"
          ? state.currentEvokeRef || state.currentEvoke
          : (typeof root === "string" && remember ? remember(root) : null);
      // If we ended up pointing at the current remains sentence, fall back to the original evoker
      if (curr && curr.be === "remains" && state.currentEvoke && state.currentEvoke !== curr) {
        curr = state.currentEvoke;
      }

      for (let i = 0; i < rest.length; i++) {
        const part = rest[i];
        if (typeof curr === "number") {
          if (part === "num") {
            curr = curr;
            continue;
          }
          curr = undefined;
          break;
        }
        if (curr && typeof curr === "object" && curr.name && remember) {
          const fact = remember(curr.name);
          // If the chain explicitly asks for `.obj`, resolve names to the full fact so `.obj` works.
          // Otherwise, resolve to the fact's payload (`.obj`) for convenience.
          if (fact) curr = part === "obj" ? fact : (fact.obj ?? fact);
        }
        if (curr == null) break;
        if (curr && typeof curr === "object") {
          if (curr.obj?.map && Object.prototype.hasOwnProperty.call(curr.obj.map, part)) {
            curr = curr.obj.map[part];
          } else if (curr.obj && curr.obj[part] !== undefined) {
            curr = curr.obj[part];
          } else {
            curr = curr[part];
          }
        } else {
          curr = curr?.[part];
        }
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
    if (found?.obj?.thisRef) {
      const reg = state.currentEvokeRef?.[found.obj.thisRef] ?? state.currentEvoke?.[found.obj.thisRef];
      if (typeof reg === "number") return reg;
      if (typeof reg?.num === "number") return reg.num;
    }
  }
  return undefined;
}

function getOperand(v, label, remember) {
  const n = resolveNumber(v, remember);
  if (n === undefined) {
    if (label === "from") {
      const alt = state.currentEvokeRef?.from?.num ?? state.currentEvoke?.from?.num;
      if (alt !== undefined) return alt;
    }
    throw new Error(`remains: ${label} is required`);
  }
  return n;
}

export async function remains_from_num_obj_num_to_name_num(sentence, { remember }) {
  const dividend = getOperand(sentence.obj, "obj", remember);
  const divisorSource = sentence.from ?? sentence.by ?? state.currentEvokeRef?.from ?? state.currentEvokeRef?.by ?? state.currentEvoke?.from ?? state.currentEvoke?.by;
  const divisor = getOperand(divisorSource, "from", remember);
  if (divisor === 0) throw new Error("remains: from cannot be zero");

  return { obj: dividend % divisor, be: sentence?.be ?? "number" };
}

export const remains = remains_from_num_obj_num_to_name_num;

export const signatures = [
  { signatureWords: ["be", "remains", "obj", "num"], handler: remains_from_num_obj_num_to_name_num },
  { signatureWords: ["be", "remains", "obj", "name", "num"], handler: remains_from_num_obj_num_to_name_num },
  { signatureWords: ["be", "remains", "obj", "num", "to", "num"], handler: remains_from_num_obj_num_to_name_num },
  { signatureWords: ["be", "remains", "obj", "name", "num", "to", "num"], handler: remains_from_num_obj_num_to_name_num },
  { signatureWords: ["be", "remains", "by", "num", "obj", "name", "num", "to", "name", "num"], handler: remains_from_num_obj_num_to_name_num },
  { signatureWords: ["be", "remains", "by", "num", "obj", "num", "to", "name", "num"], handler: remains_from_num_obj_num_to_name_num },
  { signatureWords: ["be", "remains", "by", "num", "obj", "num", "to", "num"], handler: remains_from_num_obj_num_to_name_num },
  { signatureWords: ["be", "remains", "by", "num", "obj", "name", "num", "to", "num"], handler: remains_from_num_obj_num_to_name_num },
  { signatureWords: ["be", "remains", "from", "num", "obj", "num"], handler: remains_from_num_obj_num_to_name_num },
  { signatureWords: ["be", "remains", "from", "name", "num", "obj", "num"], handler: remains_from_num_obj_num_to_name_num },
  { signatureWords: ["be", "remains", "from", "num", "obj", "name", "num"], handler: remains_from_num_obj_num_to_name_num },
  { signatureWords: ["be", "remains", "from", "name", "num", "obj", "name", "num"], handler: remains_from_num_obj_num_to_name_num },
  { signatureWords: ["be", "remains", "from", "num", "obj", "num", "to", "num"], handler: remains_from_num_obj_num_to_name_num },
  { signatureWords: ["be", "remains", "from", "name", "num", "obj", "num", "to", "num"], handler: remains_from_num_obj_num_to_name_num },
  { signatureWords: ["be", "remains", "from", "num", "obj", "name", "num", "to", "num"], handler: remains_from_num_obj_num_to_name_num },
  { signatureWords: ["be", "remains", "from", "name", "num", "obj", "name", "num", "to", "num"], handler: remains_from_num_obj_num_to_name_num },
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

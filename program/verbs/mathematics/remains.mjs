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
          // If the chain explicitly asks for `.ob`, resolve names to the full fact so `.ob` works.
          // Otherwise, resolve to the fact's payload (`.ob`) for convenience.
          if (fact) curr = part === "ob" ? fact : (fact.ob ?? fact);
        }
        if (curr == null) break;
        if (curr && typeof curr === "object") {
          if (curr.ob?.map && Object.prototype.hasOwnProperty.call(curr.ob.map, part)) {
            curr = curr.ob.map[part];
          } else if (curr.ob && curr.ob[part] !== undefined) {
            curr = curr.ob[part];
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
    if (typeof found?.ob?.num === "number") return found.ob.num;
    if (typeof found?.ob === "number") return found.ob;
    if (found?.ob?.thisRef) {
      const reg = state.currentEvokeRef?.[found.ob.thisRef] ?? state.currentEvoke?.[found.ob.thisRef];
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
  const dividend = getOperand(sentence.ob, "ob", remember);
  const divisorSource = sentence.from ?? sentence.by ?? state.currentEvokeRef?.from ?? state.currentEvokeRef?.by ?? state.currentEvoke?.from ?? state.currentEvoke?.by;
  const divisor = getOperand(divisorSource, "from", remember);
  if (divisor === 0) throw new Error("remains: from cannot be zero");

  return { ob: dividend % divisor, be: sentence?.be ?? "number" };
}

export const remains = remains_from_num_obj_num_to_name_num;

export const signatures = [
  { signatureWords: ["be", "remains", "ob", "num"], handler: remains_from_num_obj_num_to_name_num },
  { signatureWords: ["be", "remains", "ob", "name", "num"], handler: remains_from_num_obj_num_to_name_num },
  { signatureWords: ["be", "remains", "ob", "num", "to", "num"], handler: remains_from_num_obj_num_to_name_num },
  { signatureWords: ["be", "remains", "ob", "name", "num", "to", "num"], handler: remains_from_num_obj_num_to_name_num },
  { signatureWords: ["be", "remains", "by", "num", "ob", "name", "num", "to", "name", "num"], handler: remains_from_num_obj_num_to_name_num },
  { signatureWords: ["be", "remains", "by", "num", "ob", "num", "to", "name", "num"], handler: remains_from_num_obj_num_to_name_num },
  { signatureWords: ["be", "remains", "by", "num", "ob", "num", "to", "num"], handler: remains_from_num_obj_num_to_name_num },
  { signatureWords: ["be", "remains", "by", "num", "ob", "name", "num", "to", "num"], handler: remains_from_num_obj_num_to_name_num },
  { signatureWords: ["be", "remains", "from", "num", "ob", "num"], handler: remains_from_num_obj_num_to_name_num },
  { signatureWords: ["be", "remains", "from", "name", "num", "ob", "num"], handler: remains_from_num_obj_num_to_name_num },
  { signatureWords: ["be", "remains", "from", "num", "ob", "name", "num"], handler: remains_from_num_obj_num_to_name_num },
  { signatureWords: ["be", "remains", "from", "name", "num", "ob", "name", "num"], handler: remains_from_num_obj_num_to_name_num },
  { signatureWords: ["be", "remains", "from", "num", "ob", "num", "to", "num"], handler: remains_from_num_obj_num_to_name_num },
  { signatureWords: ["be", "remains", "from", "name", "num", "ob", "num", "to", "num"], handler: remains_from_num_obj_num_to_name_num },
  { signatureWords: ["be", "remains", "from", "num", "ob", "name", "num", "to", "num"], handler: remains_from_num_obj_num_to_name_num },
  { signatureWords: ["be", "remains", "from", "name", "num", "ob", "name", "num", "to", "num"], handler: remains_from_num_obj_num_to_name_num },
  { signatureWords: ["be", "remains", "from", "num", "ob", "num", "to", "name", "num"], handler: remains_from_num_obj_num_to_name_num },
  { signatureWords: ["be", "remains", "from", "name", "num", "ob", "num", "to", "name", "num"], handler: remains_from_num_obj_num_to_name_num },
  { signatureWords: ["be", "remains", "from", "num", "ob", "name", "num", "to", "name", "num"], handler: remains_from_num_obj_num_to_name_num },
  { signatureWords: ["be", "remains", "from", "name", "num", "ob", "name", "num", "to", "name", "num"], handler: remains_from_num_obj_num_to_name_num },
  { signatureWords: ["be", "remains", "from", "num", "to", "name", "num", "ob", "num"], handler: remains_from_num_obj_num_to_name_num },
  { signatureWords: ["be", "remains", "from", "name", "num", "to", "name", "num", "ob", "num"], handler: remains_from_num_obj_num_to_name_num },
  { signatureWords: ["be", "remains", "from", "num", "to", "name", "num", "ob", "name", "num"], handler: remains_from_num_obj_num_to_name_num },
  { signatureWords: ["be", "remains", "from", "name", "num", "to", "name", "num", "ob", "name", "num"], handler: remains_from_num_obj_num_to_name_num },
  { signatureWords: ["be", "remains", "ob", "num", "from", "num", "to", "name", "num"], handler: remains_from_num_obj_num_to_name_num },
  { signatureWords: ["be", "remains", "ob", "name", "num", "from", "num", "to", "name", "num"], handler: remains_from_num_obj_num_to_name_num },
  { signatureWords: ["be", "remains", "ob", "num", "from", "name", "num", "to", "name", "num"], handler: remains_from_num_obj_num_to_name_num },
  { signatureWords: ["be", "remains", "ob", "name", "num", "from", "name", "num", "to", "name", "num"], handler: remains_from_num_obj_num_to_name_num }
];

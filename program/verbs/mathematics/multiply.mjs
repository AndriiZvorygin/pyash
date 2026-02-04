import { state } from "../../bridge/state.mjs";

function resolveNumber(v, remember) {
  if (v == null) return undefined;
  if (typeof v === "number") return v;
  if (typeof v.num === "number") return v.num;
  if (v.genitive) {
    const chainArr = Array.isArray(v.genitive.chain) ? v.genitive.chain : [];
    if (chainArr.length > 0) {
      const [root, ...rest] = chainArr;
      let curr =
        root === "this"
          ? state.currentEvokeRef || state.currentEvoke
          : (typeof root === "string" && remember ? remember(root) : null);
      for (const part of rest) {
        if (typeof curr === "number") {
          if (part === "num") continue;
          curr = undefined;
          break;
        }
        if (curr && typeof curr === "object" && curr.thisRef) {
          const reg = state.currentEvokeRef?.[curr.thisRef] ?? state.currentEvoke?.[curr.thisRef];
          const regNum = typeof reg === "number" ? reg : reg?.num;
          if (regNum !== undefined) {
            curr = regNum;
            if (part === "num") continue;
          }
        }
        if (curr && typeof curr === "object" && curr.name && remember) {
          const fact = remember(curr.name);
          if (fact) curr = part === "ob" ? fact : (fact.ob ?? fact);
        }
        if (curr && typeof curr === "object" && curr.thisRef) {
          const reg = state.currentEvokeRef?.[curr.thisRef] ?? state.currentEvoke?.[curr.thisRef];
          const regNum = typeof reg === "number" ? reg : reg?.num;
          if (regNum !== undefined) {
            curr = regNum;
            if (part === "num") continue;
          }
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
  if (typeof v.name === "string") {
    const found = remember(v.name);
    if (typeof found?.ob?.num === "number") return found.ob.num;
    if (typeof found?.ob === "number") return found.ob;
  }
  return undefined;
}

function getOperand(v, label, remember) {
  const n = resolveNumber(v, remember);
  if (n === undefined) throw new Error(`multiply: ${label} is required`);
  return n;
}

export async function multiply_by_num_from_name_num_to_name_num(sentence, { remember }) {
  if (!sentence.ob && !sentence.from) throw new Error("multiply: ob or from is required");
  if (!sentence.by) throw new Error("multiply: by is required");
  const lhs = getOperand(sentence.ob ?? sentence.from, "ob", remember);
  const rhs = getOperand(sentence.by, "by", remember);
  const product = lhs * rhs;

  return { ob: product, be: sentence?.be ?? "number" };
}

export const multiply = multiply_by_num_from_name_num_to_name_num;

export const signatures = [
  {
    signatureWords: ["be", "multiply", "by", "num", "from", "name", "num", "to", "name", "num"],
    handler: multiply_by_num_from_name_num_to_name_num
  },
  {
    signatureWords: ["be", "multiply", "by", "num", "ob", "num"],
    handler: multiply_by_num_from_name_num_to_name_num
  },
  {
    signatureWords: ["be", "multiply", "by", "num", "ob", "name", "num"],
    handler: multiply_by_num_from_name_num_to_name_num
  },
  {
    signatureWords: ["be", "multiply", "by", "name", "num", "ob", "num"],
    handler: multiply_by_num_from_name_num_to_name_num
  },
  {
    signatureWords: ["be", "multiply", "by", "name", "num", "ob", "name", "num"],
    handler: multiply_by_num_from_name_num_to_name_num
  },
  {
    signatureWords: ["be", "multiply", "by", "num"],
    handler: multiply_by_num_from_name_num_to_name_num
  },
  {
    signatureWords: ["be", "multiply", "by", "name", "num"],
    handler: multiply_by_num_from_name_num_to_name_num
  },
  {
    signatureWords: ["be", "multiply", "ob", "num"],
    handler: multiply_by_num_from_name_num_to_name_num
  },
  {
    signatureWords: ["be", "multiply", "ob", "name", "num"],
    handler: multiply_by_num_from_name_num_to_name_num
  },
  {
    signatureWords: ["be", "multiply", "by", "num", "ob", "name", "num", "to", "name", "num"],
    handler: multiply_by_num_from_name_num_to_name_num
  },
  {
    signatureWords: ["be", "multiply", "by", "name", "num", "from", "name", "num", "to", "name", "num"],
    handler: multiply_by_num_from_name_num_to_name_num
  }
];

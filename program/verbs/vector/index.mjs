import { remember as doRememberHelper } from "../../remember/index.mjs";
import { state } from "../../bridge/state.mjs";

function getVector(name, remember) {
  const fact = remember(name);
  if (!fact?.ob?.ve?.values) {
    throw new Error(`vector: ${name} not found or has no values`);
  }
  return fact;
}

function resolveGenitiveValue(genitive, { remember } = {}) {
  const chainArr = Array.isArray(genitive?.chain) ? genitive.chain : [];
  if (chainArr.length === 0) return null;
  const [root, ...rest] = chainArr;
  let curr =
    root === "this"
      ? (state.currentEvokeRef || state.currentEvoke)
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
  if (typeof curr?.text === "string") return curr.text;
  if (typeof curr?.boolean === "boolean") return curr.boolean ? "truth" : "lie";
  return curr;
}

function indexFromAt(at, remember) {
  if (at?.genitive) {
    const chainArr = Array.isArray(at.genitive.chain) ? at.genitive.chain : [];
    if (chainArr.length >= 2) {
      const [root, ...rest] = chainArr;
      if (root === "this") {
        if (chainArr.length === 3 && chainArr[2] === "num") {
          const reg = state.currentEvokeRef?.[chainArr[1]] ?? state.currentEvoke?.[chainArr[1]];
          const n = typeof reg === "number" ? reg : reg?.num;
          if (typeof n === "number" && !Number.isNaN(n)) return Math.trunc(n);
        }
      } else if (typeof root === "string" && remember) {
        let curr = remember(root);
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
        if (curr && typeof curr === "object" && curr.name) {
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
        const n = typeof curr === "number" ? curr : curr?.num;
        if (typeof n === "number" && !Number.isNaN(n)) return Math.trunc(n);
      }
    }
  }
  const raw = at?.num ?? at;
  const n = Number(raw);
  if (Number.isNaN(n)) return null;
  return Math.trunc(n);
}

export async function read_obj_name_num_at_num_num_to_name_num(sentence, { remember }) {
  const ob = sentence.ob || {};
  const vecName = ob.name ?? ob.vec?.name ?? ob.vec ?? ob.name?.name;
  const idx = indexFromAt(ob.at ?? sentence.at, remember);
  if (!vecName || idx == null || idx < 0) throw new Error("read: ob vec name and at num are required");
  const vec = getVector(vecName, remember);
  const value = vec.ob.ve.values[idx];
  const isNum = typeof value === "number";
  if (isNum) return { ob: { num: value }, be: "number" };
  if (typeof value === "boolean") return { ob: { text: value ? "truth" : "lie" }, be: "text" };
  if (value === "truth" || value === "lie") return { ob: { text: value }, be: "text" };
  return { ob: { text: value }, be: "text" };
}

export async function invert_obj_name_num_at_num_num(sentence, { remember }) {
  const ob = sentence.ob || {};
  const vecName = ob.name ?? ob.vec?.name ?? ob.vec ?? ob.name?.name;
  const idx = indexFromAt(ob.at ?? sentence.at, remember);
  if (!vecName || idx == null || idx < 0) throw new Error("invert: ob vec name and at num are required");
  const vec = getVector(vecName, remember);
  const curr = vec.ob.ve.values[idx];
  const truthy = curr === "truth" || curr === true || curr === 1;
  vec.ob.ve.values[idx] = truthy ? (typeof curr === "boolean" ? false : "lie") : (typeof curr === "boolean" ? true : "truth");
  return { ob: vec.ob, be: "vector" };
}

export async function write_obj_to_name_vec_at_num(sentence, { remember }) {
  const ob = sentence.ob || {};
  const vecName = sentence.to?.name ?? ob.name ?? ob.vec?.name ?? ob.vec ?? ob.name?.name;
  const atSlot = sentence.to?.at ?? ob.at ?? sentence.at;
  const idx = indexFromAt(atSlot, remember);
  if (!vecName || idx == null || idx < 0) throw new Error("write: ob value, vec name, and at num are required");

  const vec = getVector(vecName, remember);
  let value;
  if (ob.num !== undefined) {
    value = Number(ob.num);
  } else if (ob.boolean !== undefined) {
    value = ob.boolean ? "truth" : "lie";
  } else if (ob.text !== undefined) {
    value = ob.text;
  } else if (ob.genitive) {
    const resolved = resolveGenitiveValue(ob.genitive, { remember });
    if (typeof resolved === "number") {
      value = resolved;
    } else if (typeof resolved === "string") {
      value = resolved;
    } else {
      throw new Error("write: ob genitive did not resolve");
    }
  } else {
    throw new Error("write: ob num/text/boolean is required");
  }

  vec.ob.ve.values[idx] = value;
  return { ob: vec.ob, be: "vector" };
}

export default {
  read_obj_name_num_at_num_num_to_name_num,
  invert_obj_name_num_at_num_num,
  write_obj_to_name_vec_at_num,
};

export const signatures = [
  { signatureWords: ["be", "read", "at", "num", "ob", "name", "num", "to", "name", "num"], handler: read_obj_name_num_at_num_num_to_name_num },
  { signatureWords: ["be", "read", "at", "num", "ob", "name", "vec", "num", "to", "name", "num"], handler: read_obj_name_num_at_num_num_to_name_num },
  { signatureWords: ["be", "read", "at", "num", "ob", "name", "vec", "text", "to", "name", "num"], handler: read_obj_name_num_at_num_num_to_name_num },
  { signatureWords: ["be", "read", "at", "num", "ob", "name", "vec", "text", "to", "name", "text"], handler: read_obj_name_num_at_num_num_to_name_num },
  { signatureWords: ["be", "read", "at", "num", "ob", "name", "vec", "bool", "to", "name", "num"], handler: read_obj_name_num_at_num_num_to_name_num },
  { signatureWords: ["be", "read", "at", "num", "ob", "name", "vec", "bool", "to", "name", "boolean"], handler: read_obj_name_num_at_num_num_to_name_num },
  { signatureWords: ["be", "read", "at", "num", "ob", "name", "vec", "bool", "to", "name", "text"], handler: read_obj_name_num_at_num_num_to_name_num },
  { signatureWords: ["be", "invert", "at", "num", "ob", "name", "vec", "bool"], handler: invert_obj_name_num_at_num_num },
  { signatureWords: ["be", "invert", "at", "num", "ob", "name", "vec", "text"], handler: invert_obj_name_num_at_num_num },
  { signatureWords: ["be", "write", "ob", "num", "to", "name", "vec", "at", "num"], handler: write_obj_to_name_vec_at_num },
  { signatureWords: ["be", "write", "ob", "num", "at", "num", "to", "name", "vec"], handler: write_obj_to_name_vec_at_num },
  { signatureWords: ["be", "write", "at", "num", "ob", "num", "to", "name", "vec", "num"], handler: write_obj_to_name_vec_at_num },
  { signatureWords: ["be", "write", "ob", "text", "to", "name", "vec", "at", "num"], handler: write_obj_to_name_vec_at_num },
  { signatureWords: ["be", "write", "ob", "text", "at", "num", "to", "name", "vec"], handler: write_obj_to_name_vec_at_num },
  { signatureWords: ["be", "write", "at", "num", "ob", "text", "to", "name", "vec", "text"], handler: write_obj_to_name_vec_at_num },
  { signatureWords: ["be", "write", "at", "num", "ob", "text", "to", "name", "vec", "bool"], handler: write_obj_to_name_vec_at_num },
  { signatureWords: ["be", "write", "ob", "boolean", "to", "name", "vec", "at", "num"], handler: write_obj_to_name_vec_at_num },
  { signatureWords: ["be", "write", "ob", "boolean", "at", "num", "to", "name", "vec"], handler: write_obj_to_name_vec_at_num },
  { signatureWords: ["be", "write", "at", "num", "ob", "boolean", "to", "name", "vec", "bool"], handler: write_obj_to_name_vec_at_num },
];

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
          : typeof root === "string" && remember
            ? remember(root)
            : null;

      for (const part of rest) {
        if (typeof curr === "number") {
          if (part === "num") continue;
          curr = undefined;
          break;
        }
        if (curr && typeof curr === "object" && curr.name && remember) {
          const fact = remember(curr.name);
          if (fact) curr = fact.ob ?? fact;
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
    const ev = state.currentEvokeRef || state.currentEvoke;
    const reg = ev?.[v.thisRef];
    if (typeof reg === "number") return reg;
    if (typeof reg?.num === "number") return reg.num;
  }
  if (typeof v.name === "string") {
    const found = remember(v.name);
    if (typeof found?.ob?.num === "number") return found.ob.num;
    if (typeof found?.ob === "number") return found.ob;
  }
  return undefined;
}

export async function invert_obj_num_to_name_num(sentence, { remember }) {
  const value = resolveNumber(sentence.ob, remember);
  if (value === undefined) {
    if (sentence.ob?.thisRef) {
      const ev = state.currentEvokeRef || state.currentEvoke;
      const reg = ev?.[sentence.ob.thisRef];
      if (reg && typeof reg === "object" && (reg.text !== undefined || reg.boolean !== undefined)) {
        return invert_obj_text({ ...sentence, ob: reg });
      }
      if (typeof reg === "string") {
        return invert_obj_text({ ...sentence, ob: { text: reg } });
      }
      if (typeof reg === "boolean") {
        return invert_obj_text({ ...sentence, ob: { boolean: reg } });
      }
    }
    if (sentence.ob?.name && remember(sentence.ob.name)?.ob?.ve?.values) {
      return invert_obj_name_vec_at_num(sentence, { remember });
    }
    throw new Error("invert: ob is required");
  }

  return { ob: -value, be: sentence?.be ?? "number" };
}

async function invert_obj_text(sentence) {
  const val = sentence.ob?.text ?? sentence.ob?.boolean ?? sentence.ob;
  let next = val;
  if (val === "truth") next = "lie";
  else if (val === "lie") next = "truth";
  else if (typeof val === "boolean") next = !val;
  else if (typeof val === "number") next = -val;
  return { ob: { text: next }, be: sentence?.be ?? "text" };
}

async function invert_obj_name_vec_at_num(sentence, { remember }) {
  const vecName = sentence.ob?.name;
  const idx = resolveNumber(sentence.at, remember);
  if (!vecName || idx === undefined) throw new Error("invert: ob name vec at num <index> required");
  const vecFact = remember(vecName);
  const values = vecFact?.ob?.ve?.values;
  if (!Array.isArray(values)) throw new Error("invert: target is not a vector");
  const pos = idx;
  const current = values[pos];
  let next = current;
  const vecType = String(vecFact?.ob?.ve?.type ?? "").toLowerCase();
  const isBoolVec = vecType === "bool" || vecType === "boolean";
  if (isBoolVec) {
    if (current === "truth" || current === true || current === 1) next = "lie";
    else if (current === "lie" || current === false || current === 0) next = "truth";
    else if (typeof current === "boolean") next = !current;
  } else if (typeof current === "number") {
    next = current * -1;
  } else if (current === "truth") {
    next = "lie";
  } else if (current === "lie") {
    next = "truth";
  } else if (typeof current === "boolean") {
    next = !current;
  }
  values[pos] = next;
  return { su: { name: vecName }, ob: { ve: { values } }, be: vecFact?.be ?? "vector", mood: "ya" };
}

export const invert = invert_obj_num_to_name_num;

export const signatures = [
  { signatureWords: ["be", "invert", "ob", "num", "to", "name", "num"], handler: invert_obj_num_to_name_num },
  { signatureWords: ["be", "invert", "ob", "name", "num", "to", "name", "num"], handler: invert_obj_num_to_name_num },
  { signatureWords: ["be", "invert", "ob", "num"], handler: invert_obj_num_to_name_num },
  { signatureWords: ["be", "invert", "ob", "name", "num"], handler: invert_obj_num_to_name_num },
  { signatureWords: ["be", "invert", "at", "num", "ob", "num"], handler: invert_obj_num_to_name_num },
  { signatureWords: ["be", "invert", "ob", "num", "at", "num"], handler: invert_obj_num_to_name_num },
  { signatureWords: ["be", "invert", "at", "num", "ob", "num", "to", "name", "num"], handler: invert_obj_num_to_name_num },
  { signatureWords: ["be", "invert", "ob", "num", "at", "num", "to", "name", "num"], handler: invert_obj_num_to_name_num },
  { signatureWords: ["be", "invert", "ob", "text"], handler: invert_obj_text },
  { signatureWords: ["be", "invert", "ob", "name", "text"], handler: invert_obj_text },
  { signatureWords: ["be", "invert", "ob", "text", "at", "num"], handler: invert_obj_text },
  { signatureWords: ["be", "invert", "at", "num", "ob", "text"], handler: invert_obj_text },
  { signatureWords: ["be", "invert", "ob", "bool"], handler: invert_obj_text },
  { signatureWords: ["be", "invert", "ob", "name", "bool"], handler: invert_obj_text },
  { signatureWords: ["be", "invert", "ob", "bool", "at", "num"], handler: invert_obj_text },
  { signatureWords: ["be", "invert", "at", "num", "ob", "bool"], handler: invert_obj_text },
  // vector element toggle: invert ob name vec at num <idx>
  { signatureWords: ["be", "invert", "ob", "name", "vec", "at", "num"], handler: invert_obj_name_vec_at_num },
  { signatureWords: ["be", "invert", "at", "num", "ob", "name", "vec"], handler: invert_obj_name_vec_at_num },
  { signatureWords: ["be", "invert", "ob", "name", "vec", "at", "num", "to", "name", "vec"], handler: invert_obj_name_vec_at_num },
  { signatureWords: ["be", "invert", "at", "num", "ob", "name", "vec", "to", "name", "vec"], handler: invert_obj_name_vec_at_num },
  { signatureWords: ["be", "invert", "ob", "name", "vec", "num", "at", "num"], handler: invert_obj_name_vec_at_num },
  { signatureWords: ["be", "invert", "at", "num", "ob", "name", "vec", "num"], handler: invert_obj_name_vec_at_num }
];

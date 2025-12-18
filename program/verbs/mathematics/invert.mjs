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
          if (fact) curr = fact.obj ?? fact;
        }
        if (curr == null) break;
        curr = curr[part];
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
    if (typeof found?.obj?.num === "number") return found.obj.num;
    if (typeof found?.obj === "number") return found.obj;
  }
  return undefined;
}

export async function invert_obj_num_to_name_num(sentence, { remember }) {
  const value = resolveNumber(sentence.obj, remember);
  if (value === undefined) {
    if (sentence.obj?.thisRef) {
      const ev = state.currentEvokeRef || state.currentEvoke;
      const reg = ev?.[sentence.obj.thisRef];
      if (reg && typeof reg === "object" && (reg.text !== undefined || reg.boolean !== undefined)) {
        return invert_obj_text({ ...sentence, obj: reg });
      }
      if (typeof reg === "string") {
        return invert_obj_text({ ...sentence, obj: { text: reg } });
      }
      if (typeof reg === "boolean") {
        return invert_obj_text({ ...sentence, obj: { boolean: reg } });
      }
    }
    if (sentence.obj?.name && remember(sentence.obj.name)?.obj?.ve?.values) {
      return invert_obj_name_vec_at_num(sentence, { remember });
    }
    throw new Error("invert: obj is required");
  }

  return { obj: -value, be: sentence?.be ?? "number" };
}

async function invert_obj_text(sentence) {
  const val = sentence.obj?.text ?? sentence.obj?.boolean ?? sentence.obj;
  let next = val;
  if (val === "truth") next = "lie";
  else if (val === "lie") next = "truth";
  else if (typeof val === "boolean") next = !val;
  else if (typeof val === "number") next = -val;
  return { obj: { text: next }, be: sentence?.be ?? "text" };
}

async function invert_obj_name_vec_at_num(sentence, { remember }) {
  const vecName = sentence.obj?.name;
  const idx = resolveNumber(sentence.at, remember);
  if (!vecName || idx === undefined) throw new Error("invert: obj name vec at num <index> required");
  const vecFact = remember(vecName);
  const values = vecFact?.obj?.ve?.values;
  if (!Array.isArray(values)) throw new Error("invert: target is not a vector");
  const pos = idx;
  const current = values[pos];
  let next = current;
  const vecType = String(vecFact?.obj?.ve?.type ?? "").toLowerCase();
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
  return { subj: { name: vecName }, obj: { ve: { values } }, be: vecFact?.be ?? "vector", mood: "ya" };
}

export const invert = invert_obj_num_to_name_num;

export const signatures = [
  { signatureWords: ["be", "invert", "obj", "num", "to", "name", "num"], handler: invert_obj_num_to_name_num },
  { signatureWords: ["be", "invert", "obj", "name", "num", "to", "name", "num"], handler: invert_obj_num_to_name_num },
  { signatureWords: ["be", "invert", "obj", "num"], handler: invert_obj_num_to_name_num },
  { signatureWords: ["be", "invert", "obj", "name", "num"], handler: invert_obj_num_to_name_num },
  { signatureWords: ["be", "invert", "at", "num", "obj", "num"], handler: invert_obj_num_to_name_num },
  { signatureWords: ["be", "invert", "obj", "num", "at", "num"], handler: invert_obj_num_to_name_num },
  { signatureWords: ["be", "invert", "at", "num", "obj", "num", "to", "name", "num"], handler: invert_obj_num_to_name_num },
  { signatureWords: ["be", "invert", "obj", "num", "at", "num", "to", "name", "num"], handler: invert_obj_num_to_name_num },
  { signatureWords: ["be", "invert", "obj", "text"], handler: invert_obj_text },
  { signatureWords: ["be", "invert", "obj", "name", "text"], handler: invert_obj_text },
  { signatureWords: ["be", "invert", "obj", "text", "at", "num"], handler: invert_obj_text },
  { signatureWords: ["be", "invert", "at", "num", "obj", "text"], handler: invert_obj_text },
  // vector element toggle: invert obj name vec at num <idx>
  { signatureWords: ["be", "invert", "obj", "name", "vec", "at", "num"], handler: invert_obj_name_vec_at_num },
  { signatureWords: ["be", "invert", "at", "num", "obj", "name", "vec"], handler: invert_obj_name_vec_at_num },
  { signatureWords: ["be", "invert", "obj", "name", "vec", "at", "num", "to", "name", "vec"], handler: invert_obj_name_vec_at_num },
  { signatureWords: ["be", "invert", "at", "num", "obj", "name", "vec", "to", "name", "vec"], handler: invert_obj_name_vec_at_num },
  { signatureWords: ["be", "invert", "obj", "name", "vec", "num", "at", "num"], handler: invert_obj_name_vec_at_num },
  { signatureWords: ["be", "invert", "at", "num", "obj", "name", "vec", "num"], handler: invert_obj_name_vec_at_num }
];

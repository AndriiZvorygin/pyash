import { state } from "../../bridge/state.mjs";

function resolveNumber(v, remember) {
  if (v == null) return undefined;
  if (typeof v === "number") return v;
  if (typeof v.num === "number") return v.num;
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
    if (sentence.obj?.name && remember(sentence.obj.name)?.obj?.ve?.values) {
      return invert_obj_name_vec_at_num(sentence, { remember });
    }
    throw new Error("invert: obj is required");
  }

  return { obj: -value, be: sentence?.be ?? "number" };
}

async function invert_obj_text(sentence) {
  const val = sentence.obj?.text ?? sentence.obj;
  let next = val;
  if (val === "truth") next = "lie";
  else if (val === "lie") next = "truth";
  else if (typeof val === "boolean") next = !val;
  else if (typeof val === "number") next = -val;
  return { obj: { text: next }, be: sentence?.be ?? "text" };
}

async function invert_obj_name_vec_at_num(sentence, { remember }) {
  const vecName = sentence.obj?.name;
  const idxRaw = sentence.at?.num ?? sentence.at;
  const idx = Number.isInteger(idxRaw) ? idxRaw : Number(idxRaw);
  if (!vecName || Number.isNaN(idx)) throw new Error("invert: obj name vec at num <index> required");
  const vecFact = remember(vecName);
  const values = vecFact?.obj?.ve?.values;
  if (!Array.isArray(values)) throw new Error("invert: target is not a vector");
  const pos = idx;
  const current = values[pos];
  let next = current;
  if (current === "truth" || current === true || current === 1) next = "lie";
  else if (current === "lie" || current === false || current === 0) next = "truth";
  else if (typeof current === "number") next = current * -1;
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

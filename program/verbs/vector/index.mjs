import { remember as doRememberHelper } from "../../remember/index.mjs";

function getVector(name, remember) {
  const fact = remember(name);
  if (!fact?.obj?.ve?.values) {
    throw new Error(`vector: ${name} not found or has no values`);
  }
  return fact;
}

function indexFromAt(at) {
  const raw = at?.num ?? at;
  const n = Number(raw);
  if (Number.isNaN(n)) return null;
  return Math.trunc(n);
}

export async function read_obj_name_num_at_num_num_to_name_num(sentence, { remember }) {
  const obj = sentence.obj || {};
  const vecName = obj.name ?? obj.vec?.name ?? obj.vec ?? obj.name?.name;
  const idx = indexFromAt(obj.at ?? sentence.at);
  if (!vecName || idx == null || idx < 0) throw new Error("read: obj vec name and at num are required");
  const vec = getVector(vecName, remember);
  const value = vec.obj.ve.values[idx];
  const isNum = typeof value === "number";
  return isNum ? { obj: { num: value }, be: "number" } : { obj: { text: value }, be: "text" };
}

export async function invert_obj_name_num_at_num_num(sentence, { remember }) {
  const obj = sentence.obj || {};
  const vecName = obj.name ?? obj.vec?.name ?? obj.vec ?? obj.name?.name;
  const idx = indexFromAt(obj.at ?? sentence.at);
  if (!vecName || idx == null || idx < 0) throw new Error("invert: obj vec name and at num are required");
  const vec = getVector(vecName, remember);
  const curr = vec.obj.ve.values[idx];
  const truthy = curr === "truth" || curr === true || curr === 1;
  vec.obj.ve.values[idx] = truthy ? "lie" : "truth";
  return { obj: vec.obj, be: "vector" };
}

export default {
  read_obj_name_num_at_num_num_to_name_num,
  invert_obj_name_num_at_num_num,
};

export const signatures = [
  { signatureWords: ["be", "read", "at", "num", "obj", "name", "num", "to", "name", "num"], handler: read_obj_name_num_at_num_num_to_name_num },
  { signatureWords: ["be", "read", "at", "num", "obj", "name", "vec", "num", "to", "name", "num"], handler: read_obj_name_num_at_num_num_to_name_num },
  { signatureWords: ["be", "read", "at", "num", "obj", "name", "vec", "text", "to", "name", "num"], handler: read_obj_name_num_at_num_num_to_name_num },
  { signatureWords: ["be", "read", "at", "num", "obj", "name", "vec", "text", "to", "name", "text"], handler: read_obj_name_num_at_num_num_to_name_num },
  { signatureWords: ["be", "invert", "at", "num", "obj", "name", "vec", "bool"], handler: invert_obj_name_num_at_num_num },
  { signatureWords: ["be", "invert", "at", "num", "obj", "name", "vec", "text"], handler: invert_obj_name_num_at_num_num },
];

// Simplified add: only supports numeric addition for now.
import { state } from "../../bridge/state.mjs";

function toNumber(v) {
  if (v == null) return 0;
  if (typeof v === "number") return v;
  if (typeof v.num === "number") return v.num;
  return 0;
}

function resolveGenitiveTarget(genitive, remember) {
  const chainArr = Array.isArray(genitive?.chain) ? genitive.chain : [];
  if (chainArr.length === 0) return null;

  let curr =
    chainArr[0] === "this"
      ? state.currentEvokeRef || state.currentEvoke
      : typeof chainArr[0] === "string" && remember
        ? remember(chainArr[0])
        : null;

  let parent = null;
  let key = null;

  for (const part of chainArr.slice(1)) {
    if (curr && typeof curr === "object" && curr.name && remember) {
      const fact = remember(curr.name);
      if (fact) curr = fact.obj ?? fact;
    }
    if (curr && typeof curr === "object" && curr.obj?.map && Object.prototype.hasOwnProperty.call(curr.obj.map, part)) {
      parent = curr.obj.map;
      key = part;
      curr = curr.obj.map[part];
      continue;
    }
    if (curr && typeof curr === "object" && curr.obj && curr.obj[part] !== undefined) {
      parent = curr.obj;
      key = part;
      curr = curr.obj[part];
      continue;
    }
    parent = curr;
    key = part;
    curr = curr?.[part];
  }

  if (!parent || !key) return null;
  return { parent, key, value: curr };
}

function resolveScalarValue(v, remember) {
  if (v == null) return undefined;
  if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") return v;
  if (typeof v.text === "string") return v.text;
  if (typeof v.num === "number") return v.num;
  if (typeof v.boolean === "boolean") return v.boolean;
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
        if (curr && typeof curr === "object" && curr.name && remember) {
          const fact = remember(curr.name);
          if (fact) curr = fact.obj ?? fact;
        }
        if (curr && typeof curr === "object" && curr.obj?.map && Object.prototype.hasOwnProperty.call(curr.obj.map, part)) {
          curr = curr.obj.map[part];
          continue;
        }
        if (curr && typeof curr === "object" && curr.obj && curr.obj[part] !== undefined) {
          curr = curr.obj[part];
          continue;
        }
        curr = curr?.[part];
      }

      if (typeof curr === "string" || typeof curr === "number" || typeof curr === "boolean") return curr;
      if (typeof curr?.text === "string") return curr.text;
      if (typeof curr?.num === "number") return curr.num;
      if (typeof curr?.boolean === "boolean") return curr.boolean;
    }
  }
  if (v.thisRef) {
    const ev = state.currentEvokeRef || state.currentEvoke;
    const reg = ev?.[v.thisRef];
    if (typeof reg === "string" || typeof reg === "number" || typeof reg === "boolean") return reg;
    if (typeof reg?.text === "string") return reg.text;
    if (typeof reg?.num === "number") return reg.num;
    if (typeof reg?.boolean === "boolean") return reg.boolean;
  }
  if (typeof v.name === "string") return v.name;
  return undefined;
}

export async function add_obj_num_to_name_num(sentence, { remember }) {
  if (sentence.obj == null) throw new Error("add: obj is required");
  if (sentence.to == null) throw new Error("add: to is required");

  const targetName = typeof sentence.to?.name === "string" ? sentence.to.name : null;
  const targetFact = targetName && remember ? remember(targetName) : null;
  const mapEntries = targetFact?.obj?.map ?? sentence.to?.map;
  if (mapEntries && typeof mapEntries === "object") {
    let keyVal = resolveScalarValue(sentence.subj, remember);
    if (keyVal === undefined) {
      const evokeObj = state.currentEvokeRef?.obj;
      if (typeof evokeObj?.text === "string") keyVal = evokeObj.text;
      else if (typeof evokeObj?.num === "number") keyVal = evokeObj.num;
      else if (typeof evokeObj?.boolean === "boolean") keyVal = evokeObj.boolean;
    }
    if (keyVal !== undefined) {
      const key = String(keyVal);
      const current = mapEntries[key];
      const currentNum = typeof current?.num === "number" ? current.num : 0;
      const delta = toNumber(sentence.obj);
      mapEntries[key] = { num: currentNum + delta };
      return { obj: { map: mapEntries }, be: targetFact?.be ?? "map" };
    }
  }

  // Text concatenation: obj text "..." to name <textVar> be add do
  if (typeof sentence.obj?.text === "string") {
    if (typeof sentence.to === "string") {
      return { obj: { text: sentence.to + sentence.obj.text }, be: "text" };
    }
    if (typeof sentence.to?.text === "string") {
      return { obj: { text: sentence.to.text + sentence.obj.text }, be: "text" };
    }
    const rawTo = sentence.to;
    const targetName = typeof rawTo?.name === "string" ? rawTo.name : null;
    if (!targetName || !remember) throw new Error("add: to name is required for text");
    const fact = remember(targetName);
    const current = typeof fact?.obj?.text === "string" ? fact.obj.text : "";
    return { obj: { text: current + sentence.obj.text }, be: "text" };
  }

  if (sentence.obj?.name && remember) {
    const source = remember(sentence.obj.name);
    if (typeof source?.obj?.text === "string") {
      if (typeof sentence.to === "string") {
        return { obj: { text: sentence.to + source.obj.text }, be: "text" };
      }
      if (typeof sentence.to?.text === "string") {
        return { obj: { text: sentence.to.text + source.obj.text }, be: "text" };
      }
      const targetName = typeof sentence.to?.name === "string" ? sentence.to.name : null;
      if (!targetName) throw new Error("add: to name is required for text");
      const fact = remember(targetName);
      const current = typeof fact?.obj?.text === "string" ? fact.obj.text : "";
      return { obj: { text: current + source.obj.text }, be: "text" };
    }
  }

  if (sentence.obj?.num !== undefined) {
    if (typeof sentence.to?.text === "string") {
      return { obj: { text: sentence.to.text + String(sentence.obj.num) }, be: "text" };
    }
    const targetName = typeof sentence.to?.name === "string" ? sentence.to.name : null;
    if (targetName && remember) {
      const fact = remember(targetName);
      if (typeof fact?.obj?.text === "string") {
        return { obj: { text: fact.obj.text + String(sentence.obj.num) }, be: "text" };
      }
    }
  }

  if (sentence.to.genitive) {
    const target = resolveGenitiveTarget(sentence.to.genitive, remember);
    if (target) {
      const delta = toNumber(sentence.obj);
      const current = toNumber(target.value ?? target.parent?.[target.key]);
      target.parent[target.key] = current + delta;
      return { obj: target.parent, be: "number" };
    }
  }

  const a = toNumber(sentence.obj);
  const b = toNumber(sentence.to);
  return { obj: a + b, be: "number" };
}

// Vector element add: obj num X to name vec at num idx
export async function add_obj_num_to_name_vec_at_num(sentence, { remember }) {
  const vecName = sentence.to?.name ?? sentence.obj?.name;
  const idx = sentence.to?.at?.num ?? sentence.at?.num;
  if (!vecName || idx == null) throw new Error("add: vector name and index required");

  const fact = remember ? remember(vecName) : null;
  if (!fact?.obj?.ve?.values) throw new Error("add: target is not a vector");
  const i = Number(idx) - 1;
  if (!Number.isInteger(i) || i < 0 || i >= fact.obj.ve.values.length) throw new Error("add: index out of range");

  const delta = Number(sentence.obj?.num ?? 0);
  const curr = Number(fact.obj.ve.values[i] ?? 0);
  fact.obj.ve.values[i] = curr + delta;
  return { obj: fact.obj };
}

// Vector element add: be add obj name vec from num X at num idx
export async function add_obj_name_vec_from_num_at_num(sentence, { remember }) {
  const vecName = sentence.obj?.name;
  const idx = sentence.at?.num;
  const delta = Number(sentence.from?.num ?? 0);
  if (!vecName || idx == null) throw new Error("add: vector name, from num, and at index are required");

  const fact = remember ? remember(vecName) : null;
  if (!fact?.obj?.ve?.values) throw new Error("add: target is not a vector");
  const i = Number(idx) - 1;
  if (!Number.isInteger(i) || i < 0 || i >= fact.obj.ve.values.length) throw new Error("add: index out of range");

  const curr = Number(fact.obj.ve.values[i] ?? 0);
  fact.obj.ve.values[i] = curr + delta;
  return { obj: fact.obj };
}

// Vector element add: be add obj num X from name vec at num idx
export async function add_obj_num_from_name_vec_at_num(sentence, { remember }) {
  const vecName = sentence.from?.name;
  const idx = sentence.at?.num;
  const delta = Number(sentence.obj?.num ?? 0);
  if (!vecName || idx == null) throw new Error("add: vector name, obj num, and at index are required");

  const fact = remember ? remember(vecName) : null;
  if (!fact?.obj?.ve?.values) throw new Error("add: target is not a vector");
  const i = Number(idx) - 1;
  if (!Number.isInteger(i) || i < 0 || i >= fact.obj.ve.values.length) throw new Error("add: index out of range");

  const curr = Number(fact.obj.ve.values[i] ?? 0);
  fact.obj.ve.values[i] = curr + delta;
  return { obj: fact.obj };
}

// Backwards-compatible export until dispatch switches to signature names.
export const add = add_obj_num_to_name_num;

export const signatures = [
  { signatureWords: ["be", "add", "obj", "num", "to", "name", "num"], handler: add_obj_num_to_name_num },
  { signatureWords: ["be", "add", "obj", "name", "num", "to", "name", "num"], handler: add_obj_num_to_name_num },
  { signatureWords: ["be", "add", "obj", "text", "to", "name", "text"], handler: add_obj_num_to_name_num },
  { signatureWords: ["be", "add", "obj", "text", "to", "name", "num"], handler: add_obj_num_to_name_num },
  { signatureWords: ["be", "add", "obj", "num", "to", "name", "text"], handler: add_obj_num_to_name_num },
  { signatureWords: ["be", "add", "obj", "name", "text", "to", "name", "text"], handler: add_obj_num_to_name_num },
  { signatureWords: ["be", "add", "obj", "num", "to", "num"], handler: add_obj_num_to_name_num },
  { signatureWords: ["be", "add", "obj", "num"], handler: add_obj_num_to_name_num },
  { signatureWords: ["be", "add", "to", "name", "num"], handler: add_obj_num_to_name_num },
  // Vector element: obj num ... to vec at idx
  { signatureWords: ["be", "add", "obj", "num", "to", "name", "vec", "at", "num"], handler: add_obj_num_to_name_vec_at_num },
  { signatureWords: ["be", "add", "obj", "num", "at", "num", "to", "name", "vec"], handler: add_obj_num_to_name_vec_at_num },
  // Vector element: obj vec ... from num ... at idx
  { signatureWords: ["be", "add", "obj", "name", "vec", "from", "num", "at", "num"], handler: add_obj_name_vec_from_num_at_num },
  { signatureWords: ["be", "add", "at", "num", "from", "num", "obj", "name", "vec"], handler: add_obj_name_vec_from_num_at_num },
  { signatureWords: ["be", "add", "at", "num", "from", "num", "obj", "name", "num"], handler: add_obj_name_vec_from_num_at_num },
  { signatureWords: ["be", "add", "at", "num", "from", "num", "obj", "name", "vec", "num"], handler: add_obj_name_vec_from_num_at_num },
  // Vector element: obj num ... from vec ... at idx
  { signatureWords: ["be", "add", "at", "num", "from", "name", "vec", "obj", "num"], handler: add_obj_num_from_name_vec_at_num },
  { signatureWords: ["be", "add", "at", "num", "from", "name", "vec", "num", "obj", "num"], handler: add_obj_num_from_name_vec_at_num },
  { signatureWords: ["be", "add", "obj", "num", "at", "num", "from", "name", "vec"], handler: add_obj_num_from_name_vec_at_num },
  { signatureWords: ["be", "add", "obj", "num", "from", "name", "vec", "at", "num"], handler: add_obj_num_from_name_vec_at_num }
];

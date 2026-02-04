// Simplified plus: only supports numeric addition for now.
import { state } from "../../bridge/state.mjs";
import { toNumber, resolveGenitiveTarget, resolveScalarValue, resolveDateSlot, extractDuration, addDurationToDate } from "./plus_helpers.mjs";

export async function plus_obj_num_to_name_num(sentence, { remember }) {
  if (sentence.ob == null) throw new Error("plus: ob is required");
  if (sentence.to == null && sentence.from == null) throw new Error("plus: to or from is required");

  const duration = extractDuration(sentence.ob);
  if (duration) {
    const dateValue = resolveDateSlot(sentence.to ?? sentence.from, remember);
    const date = addDurationToDate(dateValue, duration, 1);
    const targetName = typeof sentence.to?.name === "string"
      ? sentence.to.name
      : (typeof sentence.from?.name === "string" ? sentence.from.name : null);
    const targetFact = targetName && remember ? remember(targetName) : null;
    return { ob: { date }, be: targetFact?.be ?? "date" };
  }

  const targetName = typeof sentence.to?.name === "string" ? sentence.to.name : null;
  const targetFact = targetName && remember ? remember(targetName) : null;
  const mapEntries = targetFact?.ob?.map ?? sentence.to?.map;
  if (mapEntries && typeof mapEntries === "object") {
    let keyVal = resolveScalarValue(sentence.su, remember);
    if (keyVal === undefined) {
      const evokeObj = state.currentEvokeRef?.ob;
      if (typeof evokeObj?.text === "string") keyVal = evokeObj.text;
      else if (typeof evokeObj?.num === "number") keyVal = evokeObj.num;
      else if (typeof evokeObj?.boolean === "boolean") keyVal = evokeObj.boolean;
    }
    if (keyVal !== undefined) {
      const key = String(keyVal);
      const current = mapEntries[key];
      const currentNum = typeof current?.ob?.num === "number"
        ? current.ob.num
        : (typeof current?.num === "number" ? current.num : 0);
      const delta = toNumber(sentence.ob);
      const base = (current && typeof current === "object") ? current : { mood: "ya", su: { name: key } };
      base.ob = base.ob ?? {};
      base.ob.num = currentNum + delta;
      mapEntries[key] = base;
      return { ob: { map: mapEntries }, be: targetFact?.be ?? "map" };
    }
  }

  // Text concatenation: ob text "..." to name <textVar> be plus do
  const obText =
    typeof sentence.ob?.text === "string"
      ? sentence.ob.text
      : (sentence.ob?.genitive ? resolveScalarValue(sentence.ob, remember) : undefined);
  if (typeof obText === "string") {
    if (typeof sentence.to === "string") {
      return { ob: { text: sentence.to + obText }, be: "text" };
    }
    if (typeof sentence.to?.text === "string") {
      return { ob: { text: sentence.to.text + obText }, be: "text" };
    }
    if (sentence.to?.genitive) {
      const target = resolveGenitiveTarget(sentence.to.genitive, remember);
      if (target) {
        const current = typeof target.value === "string"
          ? target.value
          : (typeof target.value?.text === "string" ? target.value.text : "");
        target.parent[target.key] = current + obText;
        return { ob: { text: target.parent[target.key] }, be: "text" };
      }
    }
    const rawTo = sentence.to;
    const targetName = typeof rawTo?.name === "string" ? rawTo.name : null;
    if (!targetName || !remember) throw new Error("plus: to name is required for text");
    const fact = remember(targetName);
    const current = typeof fact?.ob?.text === "string" ? fact.ob.text : "";
    return { ob: { text: current + obText }, be: "text" };
  }

  if (sentence.ob?.name && remember) {
    const source = remember(sentence.ob.name);
    if (typeof source?.ob?.text === "string") {
      if (typeof sentence.to === "string") {
        return { ob: { text: sentence.to + source.ob.text }, be: "text" };
      }
      if (typeof sentence.to?.text === "string") {
        return { ob: { text: sentence.to.text + source.ob.text }, be: "text" };
      }
      const targetName = typeof sentence.to?.name === "string" ? sentence.to.name : null;
      if (!targetName) throw new Error("plus: to name is required for text");
      const fact = remember(targetName);
      const current = typeof fact?.ob?.text === "string" ? fact.ob.text : "";
      return { ob: { text: current + source.ob.text }, be: "text" };
    }
  }

  if (sentence.ob?.num !== undefined) {
    if (typeof sentence.to?.text === "string") {
      return { ob: { text: sentence.to.text + String(sentence.ob.num) }, be: "text" };
    }
    const targetName = typeof sentence.to?.name === "string" ? sentence.to.name : null;
    if (targetName && remember) {
      const fact = remember(targetName);
      if (typeof fact?.ob?.text === "string") {
        return { ob: { text: fact.ob.text + String(sentence.ob.num) }, be: "text" };
      }
    }
  }

  if (sentence.to?.genitive) {
    const target = resolveGenitiveTarget(sentence.to.genitive, remember);
    if (target) {
      const delta = toNumber(sentence.ob);
      const current = toNumber(target.value ?? target.parent?.[target.key]);
      target.parent[target.key] = current + delta;
      return { ob: target.parent, be: "number" };
    }
  }

  const a = toNumber(sentence.ob);
  const b = toNumber(sentence.to ?? sentence.from);
  return { ob: a + b, be: "number" };
}

// Vector element plus: ob num X to name vec at num idx
export async function plus_obj_num_to_name_vec_at_num(sentence, { remember }) {
  const vecName = sentence.to?.name ?? sentence.ob?.name;
  const idx = sentence.to?.at?.num ?? sentence.at?.num;
  if (!vecName || idx == null) throw new Error("plus: vector name and index required");

  const fact = remember ? remember(vecName) : null;
  if (!fact?.ob?.ve?.values) throw new Error("plus: target is not a vector");
  const i = Number(idx) - 1;
  if (!Number.isInteger(i) || i < 0 || i >= fact.ob.ve.values.length) throw new Error("plus: index out of range");

  const delta = Number(sentence.ob?.num ?? 0);
  const curr = Number(fact.ob.ve.values[i] ?? 0);
  fact.ob.ve.values[i] = curr + delta;
  return { ob: fact.ob };
}

// Vector element plus: be plus ob name vec from num X at num idx
export async function plus_obj_name_vec_from_num_at_num(sentence, { remember }) {
  const vecName = sentence.ob?.name;
  const idx = sentence.at?.num;
  const delta = Number(sentence.from?.num ?? 0);
  if (!vecName || idx == null) throw new Error("plus: vector name, from num, and at index are required");

  const fact = remember ? remember(vecName) : null;
  if (!fact?.ob?.ve?.values) throw new Error("plus: target is not a vector");
  const i = Number(idx) - 1;
  if (!Number.isInteger(i) || i < 0 || i >= fact.ob.ve.values.length) throw new Error("plus: index out of range");

  const curr = Number(fact.ob.ve.values[i] ?? 0);
  fact.ob.ve.values[i] = curr + delta;
  return { ob: fact.ob };
}

// Vector element plus: be plus ob num X from name vec at num idx
export async function plus_obj_num_from_name_vec_at_num(sentence, { remember }) {
  const vecName = sentence.from?.name;
  const idx = sentence.at?.num;
  const delta = Number(sentence.ob?.num ?? 0);
  if (!vecName || idx == null) throw new Error("plus: vector name, ob num, and at index are required");

  const fact = remember ? remember(vecName) : null;
  if (!fact?.ob?.ve?.values) throw new Error("plus: target is not a vector");
  const i = Number(idx) - 1;
  if (!Number.isInteger(i) || i < 0 || i >= fact.ob.ve.values.length) throw new Error("plus: index out of range");

  const curr = Number(fact.ob.ve.values[i] ?? 0);
  fact.ob.ve.values[i] = curr + delta;
  return { ob: fact.ob };
}

// Backwards-compatible export until dispatch switches to signature names.
export const plus = plus_obj_num_to_name_num;

export const signatures = [
  { signatureWords: ["be", "plus", "ob", "second", "from", "date"], handler: plus_obj_num_to_name_num },
  { signatureWords: ["be", "plus", "ob", "month", "from", "date"], handler: plus_obj_num_to_name_num },
  { signatureWords: ["be", "plus", "ob", "minute", "from", "date"], handler: plus_obj_num_to_name_num },
  { signatureWords: ["be", "plus", "ob", "hour", "from", "date"], handler: plus_obj_num_to_name_num },
  { signatureWords: ["be", "plus", "ob", "day", "from", "date"], handler: plus_obj_num_to_name_num },
  { signatureWords: ["be", "plus", "ob", "week", "from", "date"], handler: plus_obj_num_to_name_num },
  { signatureWords: ["be", "plus", "ob", "second", "from", "name", "date"], handler: plus_obj_num_to_name_num },
  { signatureWords: ["be", "plus", "ob", "month", "from", "name", "date"], handler: plus_obj_num_to_name_num },
  { signatureWords: ["be", "plus", "ob", "minute", "from", "name", "date"], handler: plus_obj_num_to_name_num },
  { signatureWords: ["be", "plus", "ob", "hour", "from", "name", "date"], handler: plus_obj_num_to_name_num },
  { signatureWords: ["be", "plus", "ob", "day", "from", "name", "date"], handler: plus_obj_num_to_name_num },
  { signatureWords: ["be", "plus", "ob", "week", "from", "name", "date"], handler: plus_obj_num_to_name_num },
  { signatureWords: ["be", "plus", "ob", "second", "to", "date"], handler: plus_obj_num_to_name_num },
  { signatureWords: ["be", "plus", "ob", "month", "to", "date"], handler: plus_obj_num_to_name_num },
  { signatureWords: ["be", "plus", "ob", "minute", "to", "date"], handler: plus_obj_num_to_name_num },
  { signatureWords: ["be", "plus", "ob", "hour", "to", "date"], handler: plus_obj_num_to_name_num },
  { signatureWords: ["be", "plus", "ob", "day", "to", "date"], handler: plus_obj_num_to_name_num },
  { signatureWords: ["be", "plus", "ob", "week", "to", "date"], handler: plus_obj_num_to_name_num },
  { signatureWords: ["be", "plus", "ob", "second", "to", "name", "date"], handler: plus_obj_num_to_name_num },
  { signatureWords: ["be", "plus", "ob", "month", "to", "name", "date"], handler: plus_obj_num_to_name_num },
  { signatureWords: ["be", "plus", "ob", "minute", "to", "name", "date"], handler: plus_obj_num_to_name_num },
  { signatureWords: ["be", "plus", "ob", "hour", "to", "name", "date"], handler: plus_obj_num_to_name_num },
  { signatureWords: ["be", "plus", "ob", "day", "to", "name", "date"], handler: plus_obj_num_to_name_num },
  { signatureWords: ["be", "plus", "ob", "week", "to", "name", "date"], handler: plus_obj_num_to_name_num },
  { signatureWords: ["be", "plus", "ob", "num", "to", "name", "num"], handler: plus_obj_num_to_name_num },
  { signatureWords: ["be", "plus", "ob", "name", "num", "to", "name", "num"], handler: plus_obj_num_to_name_num },
  { signatureWords: ["be", "plus", "ob", "num", "to", "name", "map"], handler: plus_obj_num_to_name_num },
  { signatureWords: ["be", "plus", "ob", "text", "to", "name", "text"], handler: plus_obj_num_to_name_num },
  { signatureWords: ["be", "plus", "ob", "text", "to", "text"], handler: plus_obj_num_to_name_num },
  { signatureWords: ["be", "plus", "ob", "text", "to", "name", "num"], handler: plus_obj_num_to_name_num },
  { signatureWords: ["be", "plus", "ob", "num", "to", "name", "text"], handler: plus_obj_num_to_name_num },
  { signatureWords: ["be", "plus", "ob", "name", "text", "to", "name", "text"], handler: plus_obj_num_to_name_num },
  { signatureWords: ["be", "plus", "ob", "num", "to", "num"], handler: plus_obj_num_to_name_num },
  { signatureWords: ["be", "plus", "ob", "num"], handler: plus_obj_num_to_name_num },
  { signatureWords: ["be", "plus", "from", "num", "ob", "num"], handler: plus_obj_num_to_name_num },
  { signatureWords: ["be", "plus", "ob", "num", "from", "num"], handler: plus_obj_num_to_name_num },
  { signatureWords: ["be", "plus", "from", "name", "num", "ob", "num"], handler: plus_obj_num_to_name_num },
  { signatureWords: ["be", "plus", "ob", "num", "from", "name", "num"], handler: plus_obj_num_to_name_num },
  { signatureWords: ["be", "plus", "to", "name", "num"], handler: plus_obj_num_to_name_num },
  // Vector element: ob num ... to vec at idx
  { signatureWords: ["be", "plus", "ob", "num", "to", "name", "vec", "at", "num"], handler: plus_obj_num_to_name_vec_at_num },
  { signatureWords: ["be", "plus", "ob", "num", "at", "num", "to", "name", "vec"], handler: plus_obj_num_to_name_vec_at_num },
  // Vector element: ob vec ... from num ... at idx
  { signatureWords: ["be", "plus", "ob", "name", "vec", "from", "num", "at", "num"], handler: plus_obj_name_vec_from_num_at_num },
  { signatureWords: ["be", "plus", "at", "num", "from", "num", "ob", "name", "vec"], handler: plus_obj_name_vec_from_num_at_num },
  { signatureWords: ["be", "plus", "at", "num", "from", "num", "ob", "name", "num"], handler: plus_obj_name_vec_from_num_at_num },
  { signatureWords: ["be", "plus", "at", "num", "from", "num", "ob", "name", "vec", "num"], handler: plus_obj_name_vec_from_num_at_num },
  // Vector element: ob num ... from vec ... at idx
  { signatureWords: ["be", "plus", "at", "num", "from", "name", "vec", "ob", "num"], handler: plus_obj_num_from_name_vec_at_num },
  { signatureWords: ["be", "plus", "at", "num", "from", "name", "vec", "num", "ob", "num"], handler: plus_obj_num_from_name_vec_at_num },
  { signatureWords: ["be", "plus", "ob", "num", "at", "num", "from", "name", "vec"], handler: plus_obj_num_from_name_vec_at_num },
  { signatureWords: ["be", "plus", "ob", "num", "from", "name", "vec", "at", "num"], handler: plus_obj_num_from_name_vec_at_num }
];

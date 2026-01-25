// Simplified plus: only supports numeric addition for now.
import { state } from "../../bridge/state.mjs";

const DURATION_UNITS = {
  second: 1000,
  minute: 60 * 1000,
  hour: 60 * 60 * 1000,
  day: 24 * 60 * 60 * 1000,
  week: 7 * 24 * 60 * 60 * 1000
};

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
      if (fact) curr = fact.ob ?? fact;
    }
    if (curr && typeof curr === "object" && curr.ob?.map && Object.prototype.hasOwnProperty.call(curr.ob.map, part)) {
      parent = curr.ob.map;
      key = part;
      curr = curr.ob.map[part];
      continue;
    }
    if (curr && typeof curr === "object" && curr.ob && curr.ob[part] !== undefined) {
      parent = curr.ob;
      key = part;
      curr = curr.ob[part];
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
          if (fact) curr = fact.ob ?? fact;
        }
        if (curr && typeof curr === "object" && curr.ob?.map && Object.prototype.hasOwnProperty.call(curr.ob.map, part)) {
          curr = curr.ob.map[part];
          continue;
        }
        if (curr && typeof curr === "object" && curr.ob && curr.ob[part] !== undefined) {
          curr = curr.ob[part];
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

function resolveDateSlot(slot, remember) {
  if (!slot) return null;
  if (typeof slot.date === "string") return slot.date;
  if (typeof slot.name === "string" && remember) {
    const fact = remember(slot.name);
    if (typeof fact?.ob?.date === "string") return fact.ob.date;
    if (typeof fact?.date === "string") return fact.date;
  }
  return null;
}

function parseDateValue(value) {
  if (!value) return null;
  if (value === "now") return new Date();
  if (value === "today") {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new Error("plus: date defective");
  return parsed;
}

function extractDuration(ob) {
  if (!ob || typeof ob !== "object") return null;
  if (ob.month !== undefined) {
    const raw = Number(ob.month);
    if (Number.isNaN(raw)) throw new Error("plus: duration must be numeric");
    return { unit: "month", value: raw };
  }
  for (const unit of Object.keys(DURATION_UNITS)) {
    if (ob[unit] !== undefined) {
      const raw = Number(ob[unit]);
      if (Number.isNaN(raw)) throw new Error("plus: duration must be numeric");
      return { unit, value: raw };
    }
  }
  return null;
}

function addDurationToDate(dateValue, duration, direction = 1) {
  const base = parseDateValue(dateValue);
  if (!base) throw new Error("plus: date target required");
  if (duration.unit === "month") {
    if (!Number.isInteger(duration.value)) {
      throw new Error("plus: month duration must be an integer");
    }
    const copy = new Date(base.getTime());
    copy.setMonth(copy.getMonth() + duration.value * direction);
    return copy.toISOString();
  }
  const ms = DURATION_UNITS[duration.unit] * duration.value * direction;
  return new Date(base.getTime() + ms).toISOString();
}

export async function plus_obj_num_to_name_num(sentence, { remember }) {
  if (sentence.ob == null) throw new Error("plus: ob is required");
  if (sentence.to == null) throw new Error("plus: to is required");

  const duration = extractDuration(sentence.ob);
  if (duration) {
    const dateValue = resolveDateSlot(sentence.to, remember);
    const date = addDurationToDate(dateValue, duration, 1);
    const targetName = typeof sentence.to?.name === "string" ? sentence.to.name : null;
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

  if (sentence.to.genitive) {
    const target = resolveGenitiveTarget(sentence.to.genitive, remember);
    if (target) {
      const delta = toNumber(sentence.ob);
      const current = toNumber(target.value ?? target.parent?.[target.key]);
      target.parent[target.key] = current + delta;
      return { ob: target.parent, be: "number" };
    }
  }

  const a = toNumber(sentence.ob);
  const b = toNumber(sentence.to);
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

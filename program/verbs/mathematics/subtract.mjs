const DURATION_UNITS = {
  second: 1000,
  minute: 60 * 1000,
  hour: 60 * 60 * 1000,
  day: 24 * 60 * 60 * 1000,
  week: 7 * 24 * 60 * 60 * 1000
};

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
    const local = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    return local;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new Error("subtract: date defective");
  return parsed;
}

function extractDuration(ob) {
  if (!ob || typeof ob !== "object") return null;
  if (ob.month !== undefined) {
    const raw = Number(ob.month);
    if (Number.isNaN(raw)) throw new Error("subtract: duration must be numeric");
    return { unit: "month", value: raw };
  }
  for (const unit of Object.keys(DURATION_UNITS)) {
    if (ob[unit] !== undefined) {
      const raw = Number(ob[unit]);
      if (Number.isNaN(raw)) throw new Error("subtract: duration must be numeric");
      return { unit, value: raw };
    }
  }
  return null;
}

function addDurationToDate(dateValue, duration, direction = 1) {
  const base = parseDateValue(dateValue);
  if (!base) throw new Error("subtract: date target required");
  if (duration.unit === "month") {
    if (!Number.isInteger(duration.value)) {
      throw new Error("subtract: month duration must be an integer");
    }
    const copy = new Date(base.getTime());
    copy.setMonth(copy.getMonth() + duration.value * direction);
    return copy.toISOString();
  }
  const ms = DURATION_UNITS[duration.unit] * duration.value * direction;
  return new Date(base.getTime() + ms).toISOString();
}

function detectValue(v, remember) {
  if (v == null) return 0;
  if (typeof v === "number") return v;
  if (typeof v.num === "number") return v.num;
  if (typeof v.name === "string") {
    const found = remember(v.name);
    if (found?.ob?.num !== undefined) return found.ob.num;
    if (typeof found?.ob === "number") return found.ob;
  }
  return 0;
}

export async function subtract_by_num_from_name_num_to_name_num(sentence, { remember }) {
  const duration = extractDuration(sentence.ob);
  if (duration) {
    const dateValue = resolveDateSlot(sentence.from, remember);
    const date = addDurationToDate(dateValue, duration, -1);
    return { ob: { date }, be: "date" };
  }

  const targetName = sentence?.to?.name || sentence?.from?.name;
  if (!targetName) throw new Error("subtract: target name required (to name ... or from name ...)");

  const target = remember(targetName);
  const targetVal = detectValue(target?.ob ?? sentence.to, remember);
  const subtrahend = detectValue(sentence.ob, remember);
  const result = targetVal - subtrahend;

  return { ob: result, be: sentence?.be ?? "number" };
}

// Vector element subtract: be subtract ob num X from name vec at num idx
export async function subtract_obj_num_from_name_vec_at_num(sentence, { remember }) {
  const vecName = sentence.from?.name ?? sentence.ob?.name;
  const idx = sentence.at?.num;
  const delta = Number(sentence.ob?.num ?? 0);
  if (!vecName || idx == null) throw new Error("subtract: vector name, ob num, and at index are required");

  const fact = remember ? remember(vecName) : null;
  if (!fact?.ob?.ve?.values) throw new Error("subtract: target is not a vector");
  const i = Number(idx) - 1;
  if (!Number.isInteger(i) || i < 0 || i >= fact.ob.ve.values.length) throw new Error("subtract: index out of range");

  const curr = Number(fact.ob.ve.values[i] ?? 0);
  fact.ob.ve.values[i] = curr - delta;
  return { ob: fact.ob };
}

export const subtract = subtract_by_num_from_name_num_to_name_num;

export const signatures = [
  {
    signatureWords: ["be", "subtract", "ob", "second", "from", "date"],
    handler: subtract_by_num_from_name_num_to_name_num
  },
  {
    signatureWords: ["be", "subtract", "ob", "month", "from", "date"],
    handler: subtract_by_num_from_name_num_to_name_num
  },
  {
    signatureWords: ["be", "subtract", "from", "date", "ob", "second"],
    handler: subtract_by_num_from_name_num_to_name_num
  },
  {
    signatureWords: ["be", "subtract", "from", "date", "ob", "month"],
    handler: subtract_by_num_from_name_num_to_name_num
  },
  {
    signatureWords: ["be", "subtract", "ob", "minute", "from", "date"],
    handler: subtract_by_num_from_name_num_to_name_num
  },
  {
    signatureWords: ["be", "subtract", "from", "date", "ob", "minute"],
    handler: subtract_by_num_from_name_num_to_name_num
  },
  {
    signatureWords: ["be", "subtract", "ob", "hour", "from", "date"],
    handler: subtract_by_num_from_name_num_to_name_num
  },
  {
    signatureWords: ["be", "subtract", "from", "date", "ob", "hour"],
    handler: subtract_by_num_from_name_num_to_name_num
  },
  {
    signatureWords: ["be", "subtract", "ob", "day", "from", "date"],
    handler: subtract_by_num_from_name_num_to_name_num
  },
  {
    signatureWords: ["be", "subtract", "from", "date", "ob", "day"],
    handler: subtract_by_num_from_name_num_to_name_num
  },
  {
    signatureWords: ["be", "subtract", "ob", "week", "from", "date"],
    handler: subtract_by_num_from_name_num_to_name_num
  },
  {
    signatureWords: ["be", "subtract", "from", "date", "ob", "week"],
    handler: subtract_by_num_from_name_num_to_name_num
  },
  {
    signatureWords: ["be", "subtract", "ob", "month", "from", "name", "date"],
    handler: subtract_by_num_from_name_num_to_name_num
  },
  {
    signatureWords: ["be", "subtract", "from", "name", "date", "ob", "month"],
    handler: subtract_by_num_from_name_num_to_name_num
  },
  {
    signatureWords: ["be", "subtract", "ob", "second", "from", "name", "date"],
    handler: subtract_by_num_from_name_num_to_name_num
  },
  {
    signatureWords: ["be", "subtract", "from", "name", "date", "ob", "second"],
    handler: subtract_by_num_from_name_num_to_name_num
  },
  {
    signatureWords: ["be", "subtract", "ob", "minute", "from", "name", "date"],
    handler: subtract_by_num_from_name_num_to_name_num
  },
  {
    signatureWords: ["be", "subtract", "from", "name", "date", "ob", "minute"],
    handler: subtract_by_num_from_name_num_to_name_num
  },
  {
    signatureWords: ["be", "subtract", "ob", "hour", "from", "name", "date"],
    handler: subtract_by_num_from_name_num_to_name_num
  },
  {
    signatureWords: ["be", "subtract", "from", "name", "date", "ob", "hour"],
    handler: subtract_by_num_from_name_num_to_name_num
  },
  {
    signatureWords: ["be", "subtract", "ob", "day", "from", "name", "date"],
    handler: subtract_by_num_from_name_num_to_name_num
  },
  {
    signatureWords: ["be", "subtract", "from", "name", "date", "ob", "day"],
    handler: subtract_by_num_from_name_num_to_name_num
  },
  {
    signatureWords: ["be", "subtract", "ob", "week", "from", "name", "date"],
    handler: subtract_by_num_from_name_num_to_name_num
  },
  {
    signatureWords: ["be", "subtract", "from", "name", "date", "ob", "week"],
    handler: subtract_by_num_from_name_num_to_name_num
  },
  {
    signatureWords: ["be", "subtract", "by", "num", "from", "name", "num", "to", "name", "num"],
    handler: subtract_by_num_from_name_num_to_name_num
  },
  {
    signatureWords: ["be", "subtract", "from", "name", "num", "ob", "num"],
    handler: subtract_by_num_from_name_num_to_name_num
  },
  {
    signatureWords: ["be", "subtract", "from", "name", "num", "ob", "name", "num"],
    handler: subtract_by_num_from_name_num_to_name_num
  },
  {
    signatureWords: ["be", "subtract", "from", "name", "num", "ob", "name", "num", "to", "name", "num"],
    handler: subtract_by_num_from_name_num_to_name_num
  },
  {
    signatureWords: ["be", "subtract", "from", "name", "num", "ob", "num", "to", "name", "num"],
    handler: subtract_by_num_from_name_num_to_name_num
  },
  {
    signatureWords: ["be", "subtract", "from", "name", "num", "to", "name", "num"],
    handler: subtract_by_num_from_name_num_to_name_num
  },
  {
    signatureWords: ["be", "subtract", "ob", "num"],
    handler: subtract_by_num_from_name_num_to_name_num
  },
  {
    signatureWords: ["be", "subtract", "ob", "name", "num"],
    handler: subtract_by_num_from_name_num_to_name_num
  },
  {
    signatureWords: ["be", "subtract", "ob", "num", "from", "name", "vec", "at", "num"],
    handler: subtract_obj_num_from_name_vec_at_num
  },
  {
    signatureWords: ["be", "subtract", "at", "num", "from", "name", "vec", "ob", "num"],
    handler: subtract_obj_num_from_name_vec_at_num
  },
  {
    signatureWords: ["be", "subtract", "at", "num", "from", "name", "num", "ob", "num"],
    handler: subtract_obj_num_from_name_vec_at_num
  },
  {
    signatureWords: ["be", "subtract", "at", "num", "from", "name", "vec", "num", "ob", "num"],
    handler: subtract_obj_num_from_name_vec_at_num
  }
];

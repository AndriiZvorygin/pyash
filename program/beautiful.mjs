// beautiful.mjs

import { compositionalGrid } from "./library/compositionalCases.mjs";
import { orderVyahModifiers } from "./library/grammar/vyah.mjs";

const COMPOSITIONAL_CONTEXT_ORDER = [
  "space",
  "interior",
  "surface",
  "under",
  "time",
  "state",
  "person",
  "social",
  "discourse",
  "quantity",
  "limit"
];

const COMPOSITIONAL_PREPS = [];
for (const ctxKey of COMPOSITIONAL_CONTEXT_ORDER) {
  const ctx = compositionalGrid[ctxKey];
  if (!ctx) continue;
  for (const axis of ["source", "way", "destination"]) {
    const prep = ctx[axis]?.prep;
    if (prep && !COMPOSITIONAL_PREPS.includes(prep)) COMPOSITIONAL_PREPS.push(prep);
  }
}

const CASE_ORDER = ["su", "ob", "vyah", "fromindex", "atindex", "toindex", ...COMPOSITIONAL_PREPS];

// Render a NP like { name: "collector" } or { num: 7 }
export function npToPyash(np = {}) {
  if (np.la) {
    const embedded = sentenceToPyash(np.la);
    return `la ${embedded} ko`;
  }
  if (np.name !== undefined) {
    if (Array.isArray(np.nameTypeWords) && np.nameTypeWords.length > 0) {
      return `name ${np.nameTypeWords.join(" ")} ${np.name}`;
    }
    return `name ${np.name}`;
  }
  if (np.hollow) return "hollow";
  if (np.boolean !== undefined) return `bool ${np.boolean ? "truth" : "lie"}`;
  if (np.second !== undefined) return `second ${np.second}`;
  if (np.minute !== undefined) return `minute ${np.minute}`;
  if (np.hour !== undefined) return `hour ${np.hour}`;
  if (np.day !== undefined) return `day ${np.day}`;
  if (np.week !== undefined) return `week ${np.week}`;
  if (np.num !== undefined) return `num ${np.num}`;
  if (np.date !== undefined) return `date ${np.date}`;
  if (np.text !== undefined) {
    const quotedBlockMatch = typeof np.text === "string" && np.text.match(/^quoted\.([^.]+)\.[\s\S]*\.\1\.quoted$/);
    if (quotedBlockMatch) {
      return `text ${np.text}`;
    }
    if (typeof np.text === "string" && /[\n\r]/.test(np.text)) {
      return `text quoted.text.${np.text}.text.quoted`;
    }
    return `text ${JSON.stringify(np.text)}`;
  }
  if (np.filename !== undefined) return `filename ${np.filename}`;
  if (np.ve) {
    const type = np.ve.type || "num";
    const values = Array.isArray(np.ve.values) ? np.ve.values : [];
    const rendered = values.map((value) => {
      if (typeof value === "number") return String(value);
      if (typeof value === "boolean") return value ? "truth" : "lie";
      if (typeof value === "string") {
        if (/^[A-Za-z0-9_.-]+$/.test(value)) return value;
        return JSON.stringify(value);
      }
      return String(value);
    });
    return ["ve", type, ...rendered].join(" ");
  }
  return ""; // can refine later
}

// Render a full sentence object into surface Pyash
export function sentenceToPyash(s = {}) {
  const parts = [];

  if (s.exists) {
    parts.push("exists");
  }

  for (const key of CASE_ORDER) {
    if (s[key] === undefined) continue;
    if (key === "vyah") {
      const values = Array.isArray(s.vyah?.ve?.values) ? s.vyah.ve.values : [];
      const ordered = orderVyahModifiers(values);
      parts.push("vyah");
      if (ordered.length) parts.push(ordered);
    } else {
      parts.push(key);
      const np = npToPyash(s[key]);
      if (np) parts.push(np.split(" "));
    }
  }

  if (s.be) {
    parts.push("be", s.be);
  }

  if (s.consequence) {
    parts.push("then");
    const rendered = sentenceToPyash(s.consequence);
    if (rendered) parts.push(rendered);
  }

  if (s.mood && !s.consequence) {
    parts.push(s.mood);
  }

  // flatten, because we sometimes push arrays
  return parts.flat().join(" ");
}

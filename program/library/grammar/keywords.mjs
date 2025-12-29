export const MOODS = ["ya", "do", "def", "prah", "que", "then", "ret"];

export const ROLE_KEYS = [
  "su",
  "subj",
  "ob",
  "obj",
  "to",
  "from",
  "fromstate",
  "with",
  "via",
  "times",
  "by",
  "per",
  "at",
  "fromindex",
  "atindex",
  "toindex",
  "vyah"
];

export const TYPE_TOKENS = ["name", "num", "number", "text", "filename", "bool", "boolean", "ord"];

export const CONTEXT_KEYS = [
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
  "sequence"
];

export const AXIS_CONTEXT_TO_KEYWORD = {
  space: { source: "from", way: "at", destination: "to" },
  interior: { source: "outof", way: "inside", destination: "into" },
  surface: { source: "offof", way: "along", destination: "onto" },
  under: { source: "fromunder", way: "under", destination: "beneath" },
  time: { source: "since", way: "during", destination: "until" },
  state: { source: "fromstate", way: "as", destination: "become" },
  person: { source: "fromperson", way: "with", destination: "for" },
  social: { source: "fromgroup", way: "among", destination: "intogroup" },
  discourse: { source: "fromtext", way: "accordingto", destination: "totext" },
  quantity: { source: "times", way: "by", destination: "per" },
  sequence: { source: "fromindex", way: "atindex", destination: "toindex" }
};

import {
  AXIS_ORDER,
  COMPOSITIONAL_CONTEXT_ORDER,
  compositionalGrid
} from "../compositionalCases.mjs";

export const MOODS = ["ya", "do", "def", "prah", "que", "then", "ret", "can", "pe", "pi7"];

export const COMPOSITIONAL_ALIASES = {
  inside: "in",
  along: "on",
  tostate: "become",
  every: "per"
};

export const COMPOSITIONAL_KEYWORDS = Array.from(
  new Set(
    COMPOSITIONAL_CONTEXT_ORDER.flatMap(context =>
      AXIS_ORDER.map(axis => compositionalGrid[context]?.[axis]?.keyword)
    )
      .filter(Boolean)
  )
);

const COMPOSITIONAL_ALIAS_KEYS = Object.keys(COMPOSITIONAL_ALIASES);

export const ROLE_KEYS = [
  "su",
  "subj",
  "ob",
  "obj",
  "vyah",
  "via",
  ...COMPOSITIONAL_KEYWORDS,
  ...COMPOSITIONAL_ALIAS_KEYS
];

export const TYPE_TOKENS = [
  "name",
  "num",
  "number",
  "text",
  "filename",
  "bool",
  "boolean",
  "ord",
  "wo",
  "date",
  "month",
  "months",
  "second",
  "seconds",
  "minute",
  "minutes",
  "hour",
  "hours",
  "day",
  "days",
  "week",
  "weeks",
  "sentence",
  "sentences",
  "line",
  "lines",
  "byte",
  "bytes"
];

export const CONTEXT_KEYS = [...COMPOSITIONAL_CONTEXT_ORDER];

export const AXIS_CONTEXT_TO_KEYWORD = Object.fromEntries(
  COMPOSITIONAL_CONTEXT_ORDER.map(context => [
    context,
    Object.fromEntries(AXIS_ORDER.map(axis => [
      axis,
      compositionalGrid[context]?.[axis]?.keyword
    ]))
  ])
);

export const VYAH_ASPECT_MODIFIERS = [
  "eval",
  "start",
  "stream",
  "await",
  "finish",
  "cancel",
  "timebox",
  "dweh",
  "schedule",
  "habit",
  "poll",
  "init",
  "status",
  "rule",
  "emit",
  "step"
];

export const VYAH_ASPECT_ALIASES = {
  cron: "habit"
};

export const VYAH_TENSE_MODIFIERS = [
  "now",
  "past",
  "future",
  "today",
  "yesterday",
  "recent",
  "long_ago",
  "soon",
  "far_future",
  "tomorrow"
];

export const VYAH_OUTCOME_MODIFIERS = ["success", "fail"];

export const VYAH_ATTITUDINAL_MODIFIERS = [
  "satisfied",
  "success",
  "fail",
  "hope",
  "doubt",
  "fear",
  "love",
  "anger",
  "curious",
  "enthusiasm",
  "patience",
  "wonder",
  "despair",
  "pride",
  "equanimity",
  "melancholy",
  "joy",
  "shame",
  "surprise"
];

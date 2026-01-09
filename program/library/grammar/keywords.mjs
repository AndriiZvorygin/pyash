import { compositionalGrid } from "../compositionalCases.mjs";

export const MOODS = ["ya", "do", "def", "prah", "que", "then", "ret", "can"];

const EXTRA_CONTEXT_KEYWORDS = {
  sequence: { source: "fromindex", way: "atindex", destination: "toindex" }
};

export const COMPOSITIONAL_KEYWORDS = Array.from(
  new Set(
    Object.values(compositionalGrid)
      .flatMap((ctx) => ["source", "way", "destination"].map((axis) => ctx?.[axis]?.prep))
      .concat(
        Object.values(EXTRA_CONTEXT_KEYWORDS).flatMap((ctx) => Object.values(ctx))
      )
      .filter(Boolean)
  )
);

export const ROLE_KEYS = [
  "su",
  "subj",
  "ob",
  "obj",
  "vyah",
  "via",
  ...COMPOSITIONAL_KEYWORDS
];

export const TYPE_TOKENS = ["name", "num", "number", "text", "filename", "bool", "boolean", "ord", "wo", "date"];

export const CONTEXT_KEYS = [...Object.keys(compositionalGrid), ...Object.keys(EXTRA_CONTEXT_KEYWORDS)];

export const AXIS_CONTEXT_TO_KEYWORD = {
  ...Object.fromEntries(
    Object.entries(compositionalGrid).map(([context, ctx]) => [
      context,
      {
        source: ctx?.source?.prep,
        way: ctx?.way?.prep,
        destination: ctx?.destination?.prep
      }
    ])
  ),
  ...EXTRA_CONTEXT_KEYWORDS
};

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
  "cron",
  "poll",
  "init",
  "status",
  "rule",
  "emit",
  "step"
];

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

export const VYAH_OUTCOME_MODIFIERS = ["sloh"];

export const VYAH_ATTITUDINAL_MODIFIERS = [
  "satisfied",
  "success",
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

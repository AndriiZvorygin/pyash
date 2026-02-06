import {
  VYAH_ASPECT_MODIFIERS,
  VYAH_ASPECT_ALIASES,
  VYAH_TENSE_MODIFIERS,
  VYAH_OUTCOME_MODIFIERS,
  VYAH_ATTITUDINAL_MODIFIERS
} from "./keywords.mjs";
import { throwErrorSentence } from "../../error.mjs";

const ASPECT_SET = new Set(VYAH_ASPECT_MODIFIERS);
const ASPECT_ALIAS_MAP = new Map(
  Object.entries(VYAH_ASPECT_ALIASES).map(([alias, canonical]) => [
    String(alias).toLowerCase(),
    String(canonical).toLowerCase()
  ])
);
const TENSE_SET = new Set(VYAH_TENSE_MODIFIERS);
const OUTCOME_SET = new Set(VYAH_OUTCOME_MODIFIERS);
const ATTITUDE_SET = new Set(VYAH_ATTITUDINAL_MODIFIERS);

export function normalizeVyahAspectToken(token) {
  const lower = String(token ?? "").toLowerCase();
  return ASPECT_ALIAS_MAP.get(lower) ?? lower;
}

export function splitVyahModifiers(values = []) {
  const aspects = [];
  const tenses = [];
  const outcomes = [];
  const attitudinal = [];
  const other = [];

  for (const raw of values) {
    const tokenRaw = typeof raw === "string" ? raw : String(raw ?? "");
    const token = normalizeVyahAspectToken(tokenRaw);
    if (!token) continue;
    if (ASPECT_SET.has(token)) aspects.push(token);
    else if (TENSE_SET.has(token)) tenses.push(token);
    else if (OUTCOME_SET.has(token)) outcomes.push(token);
    else if (ATTITUDE_SET.has(token)) attitudinal.push(token);
    else other.push(token);
  }

  return { aspects, tenses, outcomes, attitudinal, other };
}

export function getEffectiveVyahAspect(values = [], { verb = "", caseKey = "vyah" } = {}) {
  const { aspects } = splitVyahModifiers(values);
  if (aspects.length > 1) {
    throwErrorSentence({
      name: "vyah aspect invalid",
      message: `vyah allows at most one aspect modifier; got ${aspects.join(", ")}`,
      from: { name: "signature" },
      raw: { verb, case: caseKey, modifiers: values }
    });
  }
  return aspects[0] ?? "eval";
}

export function orderVyahModifiers(values = []) {
  const { aspects, tenses, other, outcomes, attitudinal } = splitVyahModifiers(values);
  return [...aspects, ...tenses, ...other, ...outcomes, ...attitudinal];
}

import { throwErrorSentence } from "../error.mjs";
import { splitVyahModifiers } from "./grammar/vyah.mjs";

export const ASYNC_LANE_FAST = "fast";
export const ASYNC_LANE_DURABLE = "durable";

function vyahValues(sentence = {}) {
  return Array.isArray(sentence?.vyah?.ve?.values) ? sentence.vyah.ve.values : [];
}

export function resolveAsyncLane(sentence = {}, { defaultLane = ASYNC_LANE_DURABLE, verb = "" } = {}) {
  const { tenses } = splitVyahModifiers(vyahValues(sentence));
  const hasSoon = tenses.includes("soon");
  const hasFuture = tenses.includes("future");
  if (hasSoon && hasFuture) {
    throwErrorSentence({
      name: "vyah tense invalid",
      message: "vyah tense invalid: soon and future cannot both be present",
      from: { name: verb || "runtime" },
      raw: { sentence }
    });
  }
  if (hasSoon) return { lane: ASYNC_LANE_FAST, tense: "soon" };
  if (hasFuture) return { lane: ASYNC_LANE_DURABLE, tense: "future" };
  return { lane: defaultLane, tense: "" };
}

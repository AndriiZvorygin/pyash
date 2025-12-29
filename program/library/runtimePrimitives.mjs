import { buildErrorSentence } from "../error.mjs";

export function makeVyah(values = []) {
  return { ve: { type: "name", values } };
}

export function makeDuty({ name, state }) {
  return { su: { name }, as: { name: state }, be: "duty", mood: "ya" };
}

export function makeStream({ name, state, ob }) {
  const sentence = { su: { name }, as: { name: state }, be: "stream", mood: "ya" };
  if (ob) sentence.ob = ob;
  return sentence;
}

export function makeChip({ streamName, index, ob, final, vyahValues }) {
  const sentence = {
    su: { name: streamName },
    atindex: { num: index },
    as: { name: final ? "final" : "notfinal" },
    be: "chip",
    mood: "ya"
  };
  if (ob) sentence.ob = ob;
  if (vyahValues?.length) sentence.vyah = makeVyah(vyahValues);
  return sentence;
}

export function makeAck({ subject, verb, aspect }) {
  return {
    su: { name: subject },
    vyah: makeVyah([aspect, "sloh"]),
    be: verb,
    mood: "ya"
  };
}

export function makeRuntimeError({ name, message, from = "runtime" }) {
  return buildErrorSentence({ name, message, from: { name: from } });
}

export function getState(sentence) {
  return sentence?.as?.name;
}

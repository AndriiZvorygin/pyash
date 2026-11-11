import {
  buildLiteralCodelet,
  decodeLiteralCodelet,
  encodingError,
  normalizeLiteralName
} from "./literal_layout.mjs";
import { uintQuoteWord } from "./quotes.mjs";

// A date is a uint64 count of milliseconds since the Unix epoch. The legacy
// quote format reserves the 64-bit scalar thickness for exactly this, so the
// value travels in a uint quote with four payload words.
export const DATE_QUOTE_WORD = uintQuoteWord({ vectorThick: 0, scalarBytes: 8 });
export const DATE_PAYLOAD_WORDS = 4;

const MILLISECONDS_PER_DAY = 86400000;

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(Z|[+-]\d{2}:\d{2}))?$/;

export const dateCompatibility = Object.freeze({
  quote: DATE_QUOTE_WORD,
  payloadWords: DATE_PAYLOAD_WORDS,
  scalarBytes: 8
});

export function dateToEpoch(value) {
  if (typeof value !== "string" || value.trim() === "") {
    throw encodingError("unsupported-date", "date literals require an ISO-8601 string", { value });
  }
  const match = DATE_PATTERN.exec(value.trim());
  if (!match) {
    throw encodingError(
      "unsupported-date",
      "date literals must be ISO-8601 with an explicit timezone",
      { value }
    );
  }
  const [, year, month, day, hour, minute, second, millis, zone] = match;
  if (hour !== undefined && zone === undefined) {
    throw encodingError(
      "unsupported-date",
      "date-times require an explicit timezone so the lowering stays reproducible",
      { value }
    );
  }
  const milliseconds = Number((millis ?? "").padEnd(3, "0"));
  const utc = Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour ?? 0),
    Number(minute ?? 0),
    Number(second ?? 0),
    milliseconds
  );
  if (!Number.isFinite(utc)) {
    throw encodingError("unsupported-date", "date literal is not a real date", { value });
  }
  const canonicalDay = new Date(utc).toISOString().slice(0, 10);
  if (canonicalDay !== `${year}-${month}-${day}`) {
    throw encodingError("unsupported-date", "date literal is not a real date", { value });
  }
  let epoch = BigInt(utc);
  if (zone && zone !== "Z") {
    const sign = zone[0] === "-" ? -1n : 1n;
    const [offsetHours, offsetMinutes] = zone.slice(1).split(":").map(Number);
    epoch -= sign * (BigInt(offsetHours) * 3600000n + BigInt(offsetMinutes) * 60000n);
  }
  if (epoch < 0n) {
    throw encodingError("date-range", "date literals must be at or after the Unix epoch", { value });
  }
  return epoch;
}

export function epochToDate(epoch) {
  const milliseconds = Number(epoch);
  const iso = new Date(milliseconds).toISOString();
  if (milliseconds % MILLISECONDS_PER_DAY === 0) {
    return iso.slice(0, 10);
  }
  return iso;
}

function epochToPayload(epoch) {
  const payload = [];
  let remaining = epoch;
  for (let index = 0; index < DATE_PAYLOAD_WORDS; index += 1) {
    payload.push(Number(remaining & 0xffffn));
    remaining >>= 16n;
  }
  if (remaining !== 0n) {
    throw encodingError("date-range", "the date does not fit in a uint64", { epoch: epoch.toString() });
  }
  return payload;
}

function payloadToEpoch(payload) {
  let epoch = 0n;
  for (let index = payload.length - 1; index >= 0; index -= 1) {
    epoch = (epoch << 16n) | BigInt(payload[index]);
  }
  return epoch;
}

export function isDateSentence(sentence) {
  return sentence?.mood === "ya" && sentence?.be === "date";
}

export function normalizeDateSentence(sentence) {
  if (!sentence || typeof sentence !== "object") {
    throw encodingError("unsupported-sentence", "date literals require a sentence object");
  }
  const keys = Object.keys(sentence).sort();
  const allowed = sentence.su === undefined
    ? ["be", "mood", "ob"]
    : ["be", "mood", "ob", "su"];
  if (keys.length !== allowed.length || keys.some((key, index) => key !== allowed[index])) {
    throw encodingError("unsupported-sentence", "date literals have an unsupported shape", {
      keys,
      expected: allowed
    });
  }
  if (sentence.mood !== "ya" || sentence.be !== "date") {
    throw encodingError("unsupported-sentence", "date literals require mood ya and type date", {
      mood: sentence.mood,
      be: sentence.be
    });
  }
  if (!sentence.ob || typeof sentence.ob !== "object") {
    throw encodingError("unsupported-sentence", "date literal object is required");
  }
  const obKeys = Object.keys(sentence.ob).sort();
  if (obKeys.length !== 1 || obKeys[0] !== "date") {
    throw encodingError("unsupported-sentence", "date literals carry a single date value", {
      keys: obKeys
    });
  }

  const epoch = dateToEpoch(sentence.ob.date);
  const normalized = {
    mood: "ya",
    ob: { date: epochToDate(epoch) },
    be: "date"
  };
  if (sentence.su !== undefined) {
    const name = normalizeLiteralName(sentence.su);
    normalized.su = { name: name.name };
  }
  return { normalized, epoch };
}

export function lowerDateSentence(sentence) {
  const { normalized, epoch } = normalizeDateSentence(sentence);
  const nameWords = normalized.su
    ? normalizeLiteralName(normalized.su).words
    : [];
  const codelet = buildLiteralCodelet({
    nameWords,
    regions: [{ quoteWord: DATE_QUOTE_WORD, payloadWords: epochToPayload(epoch) }]
  });
  return {
    sentence: normalized,
    words: codelet.words,
    bytes: codelet.bytes,
    usedWords: codelet.usedWords
  };
}

export function decodeDateCodelet(input) {
  const literal = decodeLiteralCodelet(input, {
    quoteWord: DATE_QUOTE_WORD,
    payloadWordCount: () => DATE_PAYLOAD_WORDS
  });
  const epoch = payloadToEpoch(literal.payloadWords);
  const sentence = {
    mood: "ya",
    ob: { date: epochToDate(epoch) },
    be: "date"
  };
  if (literal.name) {
    sentence.su = { name: literal.name };
  }
  return sentence;
}

export async function executeDateCodelet(input) {
  return decodeDateCodelet(input);
}

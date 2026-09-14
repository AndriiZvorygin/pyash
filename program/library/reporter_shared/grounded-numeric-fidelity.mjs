const NUMERIC_TOKEN = /\b\d[\d,]*(?:\.\d+)?(?:st|nd|rd|th|%|[kmb])?\b/giu;
const CARDINAL_VALUES = new Map(Object.entries({
  zero: 0,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
  sixty: 60,
  seventy: 70,
  eighty: 80,
  ninety: 90,
}));
const ORDINAL_VALUES = new Map(Object.entries({
  first: 1,
  second: 2,
  third: 3,
  fourth: 4,
  fifth: 5,
  sixth: 6,
  seventh: 7,
  eighth: 8,
  ninth: 9,
  tenth: 10,
  eleventh: 11,
  twelfth: 12,
  thirteenth: 13,
  fourteenth: 14,
  fifteenth: 15,
  sixteenth: 16,
  seventeenth: 17,
  eighteenth: 18,
  nineteenth: 19,
  twentieth: 20,
  thirtieth: 30,
}));
const NUMBER_WORDS = [
  ...CARDINAL_VALUES.keys(),
  ...ORDINAL_VALUES.keys(),
  "hundred",
  "thousand",
  "million",
  "billion",
].join("|");
const NUMBER_WORD_PHRASE = new RegExp(
  `\\b(?:${NUMBER_WORDS})(?:[\\s-]+(?:(?:and)[\\s-]+)?(?:${NUMBER_WORDS}))*\\b`,
  "giu",
);

function numericTokens(text = "") {
  return Array.from(String(text || "").matchAll(NUMERIC_TOKEN), (match) =>
    match[0].toLowerCase().replaceAll(",", ""));
}

function ordinalBase(token = "") {
  return String(token || "").replace(/(?<=\d)(?:st|nd|rd|th)$/u, "");
}

function numberWordValue(phrase = "") {
  const words = String(phrase || "").toLowerCase().split(/[\s-]+/u).filter((word) => word !== "and");
  let total = 0;
  let current = 0;
  for (const word of words) {
    if (CARDINAL_VALUES.has(word)) {
      current += CARDINAL_VALUES.get(word);
      continue;
    }
    if (ORDINAL_VALUES.has(word)) {
      current += ORDINAL_VALUES.get(word);
      continue;
    }
    if (word === "hundred") {
      current = Math.max(1, current) * 100;
      continue;
    }
    const scale = word === "thousand"
      ? 1_000
      : word === "million"
        ? 1_000_000
        : word === "billion"
          ? 1_000_000_000
          : 0;
    if (!scale) return null;
    total += Math.max(1, current) * scale;
    current = 0;
  }
  return total + current;
}

function numberWordTokens(text = "") {
  const source = String(text || "");
  const ordinary = Array.from(source.matchAll(NUMBER_WORD_PHRASE), (match) => {
    const value = numberWordValue(match[0]);
    return Number.isFinite(value) ? String(value) : "";
  }).filter(Boolean);
  const spokenYears = Array.from(
    source.matchAll(/\b(nineteen|twenty)\s+(ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)(?:[-\s]+(one|two|three|four|five|six|seven|eight|nine))?\b/giu),
    (match) => {
      const century = CARDINAL_VALUES.get(match[1].toLowerCase());
      const decade = CARDINAL_VALUES.get(match[2].toLowerCase());
      const unit = match[3] ? CARDINAL_VALUES.get(match[3].toLowerCase()) : 0;
      return String((century * 100) + decade + unit);
    },
  );
  const spokenDigitSequences = Array.from(
    source.matchAll(/\b(?:zero|one|two|three|four|five|six|seven|eight|nine)(?:[\s-]+(?:zero|one|two|three|four|five|six|seven|eight|nine))+\b/giu),
    (match) => match[0]
      .toLowerCase()
      .split(/[\s-]+/u)
      .map((word) => CARDINAL_VALUES.get(word))
      .join(""),
  );
  const leadingZeroSequences = Array.from(
    source.matchAll(/\bzero(?:[\s-]+(?:zero|one|two|three|four|five|six|seven|eight|nine))+\b/giu),
    (match) => match[0]
      .toLowerCase()
      .split(/[\s-]+/u)
      .map((word) => CARDINAL_VALUES.get(word))
      .join(""),
  );
  return [...ordinary, ...spokenYears, ...spokenDigitSequences, ...leadingZeroSequences];
}

export function normalizeUnambiguousSpokenNumbers(text = "") {
  return String(text || "")
    .replace(
      /\b(nineteen|twenty)\s+(ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)(?:-(one|two|three|four|five|six|seven|eight|nine))?\b/giu,
      (phrase, centuryWord, decadeWord, unitWord) => {
        const century = CARDINAL_VALUES.get(centuryWord.toLowerCase());
        const decade = CARDINAL_VALUES.get(decadeWord.toLowerCase());
        const unit = unitWord ? CARDINAL_VALUES.get(unitWord.toLowerCase()) : 0;
        return String((century * 100) + decade + unit);
      },
    )
    .replace(
      /\b(twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)-(one|two|three|four|five|six|seven|eight|nine)\b/giu,
      (phrase) => String(numberWordValue(phrase)),
    );
}

export function unsupportedNumericTokens(generated = "", groundedSource = "") {
  const supported = new Set(
    [...numericTokens(groundedSource), ...numberWordTokens(groundedSource)]
      .flatMap((token) => [token, ordinalBase(token)]),
  );
  return [...new Set(
    numericTokens(generated).filter((token) => (
      !supported.has(token) && !supported.has(ordinalBase(token))
    )),
  )];
}

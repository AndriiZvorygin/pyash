export const FIXED16_SCALE = 46_656;
export const FIXED16_MAX_NUMERATOR = 0xffff;
export const FIXED16_QUOTE_WORD = 0xc81d;

export class Fixed16Error extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "Fixed16Error";
    this.code = code;
    this.details = details;
  }
}

function fixed16Error(code, message, details) {
  return new Fixed16Error(code, message, details);
}

export function fixed16NumeratorFromNumber(value) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw fixed16Error("fixed16-range", "fixed16 value must be a finite non-negative number", { value });
  }
  const scaled = value * FIXED16_SCALE;
  if (scaled > FIXED16_MAX_NUMERATOR + 0.5) {
    throw fixed16Error("fixed16-range", "fixed16 value exceeds its u16 numerator range", { value });
  }
  const floor = Math.floor(scaled);
  const fraction = scaled - floor;
  const rounded = fraction > 0.5 || (fraction === 0.5 && floor % 2 !== 0)
    ? floor + 1
    : floor;
  if (rounded > FIXED16_MAX_NUMERATOR) {
    throw fixed16Error("fixed16-range", "fixed16 value exceeds its u16 numerator range", { value });
  }
  return rounded;
}

export function fixed16NumeratorQuoteWords(numerator) {
  if (!Number.isInteger(numerator) || numerator < 0 || numerator > FIXED16_MAX_NUMERATOR) {
    throw fixed16Error("fixed16-range", "fixed16 numerator must be an unsigned 16-bit integer", {
      numerator
    });
  }
  return [FIXED16_QUOTE_WORD, numerator];
}

export function fixed16QuoteWords(value) {
  return fixed16NumeratorQuoteWords(fixed16NumeratorFromNumber(value));
}

export function fixed16NumeratorFromBase6(source) {
  if (typeof source !== "string" || source.length > 128 || !/^[0-5]+(?:\.[0-5]+)?$/u.test(source)) {
    throw fixed16Error("fixed16-base6", "base-6 fixed16 source must contain only digits 0 through 5", {
      source
    });
  }
  const [whole, fraction = ""] = source.split(".");
  const denominator = 6n ** BigInt(fraction.length);
  const wholeValue = parseBase6Integer(whole || "0");
  const fractionalValue = fraction ? parseBase6Integer(fraction) : 0n;
  const base6Numerator = wholeValue * denominator + fractionalValue;
  const scaledNumerator = base6Numerator * BigInt(FIXED16_SCALE);
  const quotient = scaledNumerator / denominator;
  const remainder = scaledNumerator % denominator;
  const doubledRemainder = remainder * 2n;
  const rounded = doubledRemainder > denominator ||
    (doubledRemainder === denominator && quotient % 2n !== 0n)
    ? quotient + 1n
    : quotient;
  if (rounded > BigInt(FIXED16_MAX_NUMERATOR)) {
    throw fixed16Error("fixed16-range", "base-6 fixed16 value exceeds its u16 numerator range", { source });
  }
  return Number(rounded);
}

function parseBase6Integer(digits) {
  let value = 0n;
  for (const digit of digits) value = value * 6n + BigInt(digit);
  return value;
}

export function fixed16QuoteWordsFromBase6(source) {
  return fixed16NumeratorQuoteWords(fixed16NumeratorFromBase6(source));
}

export function fixed16ValueFromNumerator(numerator) {
  return numerator / FIXED16_SCALE;
}

export function roundRatioTiesToEven(numerator, denominator) {
  const quotient = Math.floor(numerator / denominator);
  const remainder = numerator % denominator;
  const doubled = remainder * 2;
  return doubled > denominator || (doubled === denominator && quotient % 2 !== 0)
    ? quotient + 1
    : quotient;
}

export function calculateFixed16Numerator(be, left, right) {
  if (be === "plus") return requireInRange(left + right, be);
  if (be === "subtract") {
    if (left < right) {
      throw fixed16Error("fixed16-underflow", "fixed16 subtraction result is below zero", { left, right });
    }
    return left - right;
  }
  if (be === "multiply") return requireInRange(roundRatioTiesToEven(left * right, FIXED16_SCALE), be);
  if (be === "divide") {
    if (right === 0) throw fixed16Error("division-by-zero", "fixed16 division cannot divide by zero");
    return requireInRange(roundRatioTiesToEven(left * FIXED16_SCALE, right), be);
  }
  throw fixed16Error("unsupported-operator", `fixed16 operator ${be} is unsupported`);
}

function requireInRange(value, operator) {
  if (value < 0 || value > FIXED16_MAX_NUMERATOR) {
    throw fixed16Error("fixed16-overflow", `fixed16 ${operator} result is outside the u16 numerator range`, {
      value
    });
  }
  return value;
}

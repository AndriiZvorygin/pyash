import {
  QUOTE_DENOTE,
  QUOTE_DENOTE_MASK,
  PARAGRAPH_LETTER_QUOTE_WORD,
  decodeQuoteHeader
} from "./quotes.mjs";

export function freshQuoteScan() {
  return {
    explicitLength: null,
    payloadWords: 0,
    textArrayRemaining: 0,
    textArrayMember: null
  };
}

export function scanQuoteWord(word, state, makeError) {
  if (state.payloadWords > 0) {
    state.payloadWords -= 1;
    if (state.payloadWords === 0 && state.textArrayMember === "payload") {
      state.textArrayRemaining -= 1;
      state.textArrayMember = state.textArrayRemaining > 0 ? "header" : null;
    }
    return null;
  }
  if (state.textArrayRemaining > 0) {
    if (state.textArrayMember === "length") {
      state.payloadWords = word;
      state.textArrayMember = "payload";
      if (word === 0) {
        state.textArrayRemaining -= 1;
        state.textArrayMember = state.textArrayRemaining > 0 ? "header" : null;
      }
      return null;
    }
    if (state.textArrayMember === "header") {
      let header;
      try {
        header = decodeQuoteHeader(word);
      } catch {
        throw makeError("malformed-codelet", "text array member is missing its quote header", { word });
      }
      if (header.sortName !== "letter" || header.scalarBytes !== 2 || header.sequence) {
        throw makeError("malformed-codelet", "text array member must be a letter quote", { word });
      }
      if (header.explicitVectorLength) {
        state.textArrayMember = "length";
      } else if (header.vectorWords === 1) {
        state.payloadWords = 1;
        state.textArrayMember = "payload";
      } else {
        throw makeError("malformed-codelet", "text array member has an unsupported quote width", { word });
      }
      return null;
    }
  }
  if (state.explicitLength) {
    const quote = state.explicitLength;
    state.explicitLength = null;
    if (quote.sequence && quote.sortName === "letter") {
      state.textArrayRemaining = word;
      state.textArrayMember = word > 0 ? "header" : null;
      return null;
    }
    if (quote.word === PARAGRAPH_LETTER_QUOTE_WORD && word > 14) return word;
    state.payloadWords = word * (quote.scalarBytes / 2);
    return null;
  }
  if ((word & QUOTE_DENOTE_MASK) !== QUOTE_DENOTE) return null;

  let header;
  try {
    header = decodeQuoteHeader(word);
  } catch {
    return null;
  }
  if (header.explicitVectorLength) {
    state.explicitLength = header;
  } else if (header.vectorWords !== null && header.scalarBytes !== null) {
    state.payloadWords = header.vectorWords * (header.scalarBytes / 2);
  }
  return null;
}

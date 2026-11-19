export function encodeTextArrayMembers(values, { letterQuoteWord, paragraphQuoteWord }) {
  const words = [];
  for (const value of values) {
    if (typeof value !== "string" || value.length === 0) {
      throw new TypeError("text array members must be non-empty strings");
    }
    if (value.length === 1) {
      words.push(letterQuoteWord, value.charCodeAt(0));
      continue;
    }
    words.push(paragraphQuoteWord, value.length);
    for (let index = 0; index < value.length; index += 1) {
      words.push(value.charCodeAt(index));
    }
  }
  return words;
}

export function decodeTextArrayMembers(words, offset, count, decodeQuote) {
  const values = [];
  let cursor = offset;
  for (let index = 0; index < count; index += 1) {
    const quote = decodeQuote(words, cursor);
    if (quote.family !== "letter" && quote.family !== "paragraph-letter") {
      return { invalidIndex: index, quote };
    }
    values.push(quote.value);
    cursor = quote.nextOffset;
  }
  return { values, nextOffset: cursor };
}

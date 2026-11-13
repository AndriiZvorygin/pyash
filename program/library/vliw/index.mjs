import {
  decodeLegacyCodelet,
  decodeLegacyCodeletSequence,
  VliwCodeletError
} from "./codelets.mjs";
import {
  decodeNumericPlusCodelet,
  executeNumericPlusCodelet,
  lowerNumericPlusSentence,
  VliwEncodingError
} from "./plus.mjs";
import {
  decodeTypedLiteralCodelet,
  executeTypedLiteralCodelet,
  isTypedLiteralSentence,
  lowerTypedLiteralSentence,
  typedLiteralCompatibility
} from "./literal.mjs";
import {
  decodeNamedLiteralCodelet,
  executeNamedLiteralCodelet,
  isNamedLiteralSentence,
  lowerNamedLiteralSentence,
  namedLiteralCompatibility
} from "./named_literal.mjs";
import {
  booleanLiteralCompatibility,
  decodeBooleanLiteralCodelet,
  executeBooleanLiteralCodelet,
  isBooleanLiteralSentence,
  lowerBooleanLiteralSentence
} from "./boolean_literal.mjs";
import {
  decodeNumericArithmeticCodelet,
  executeNumericArithmeticCodelet,
  isNumericArithmeticSentence,
  lowerNumericArithmeticSentence,
  numericArithmeticCompatibility
} from "./arithmetic.mjs";
import {
  decodeNumericInvertCodelet,
  executeNumericInvertCodelet,
  isNumericInvertSentence,
  lowerNumericInvertSentence,
  numericInvertCompatibility
} from "./invert.mjs";
import {
  dateCompatibility,
  decodeDateCodelet,
  executeDateCodelet,
  isDateSentence,
  lowerDateSentence
} from "./date.mjs";
import {
  decodeVectorCodelet,
  executeVectorCodelet,
  isVectorSentence,
  lowerVectorSentence
} from "./vector.mjs";
import {
  isIntVectorQuoteWord,
  isLetterQuoteWord,
  isUintVectorQuoteWord
} from "./quotes.mjs";
import { sentenceToPyash } from "../../beautiful.mjs";
import { deriveSentenceEffects, scheduleCodeletDependencies } from "./effects.mjs";

function semanticDecode(decoded, semantic, sentence) {
  return {
    ...decoded,
    semantic,
    sentence,
    effects: deriveSentenceEffects(sentence)
  };
}

export function lowerSentence(sentence) {
  if (isDateSentence(sentence)) {
    return [lowerDateSentence(sentence)];
  }
  if (isVectorSentence(sentence)) {
    return [lowerVectorSentence(sentence)];
  }
  if (isBooleanLiteralSentence(sentence)) {
    return [lowerBooleanLiteralSentence(sentence)];
  }
  if (isNamedLiteralSentence(sentence)) {
    return [lowerNamedLiteralSentence(sentence)];
  }
  if (isTypedLiteralSentence(sentence)) {
    return [lowerTypedLiteralSentence(sentence)];
  }
  if (isNumericInvertSentence(sentence)) {
    return [lowerNumericInvertSentence(sentence)];
  }
  if (isNumericArithmeticSentence(sentence) && sentence.be !== "plus") {
    return [lowerNumericArithmeticSentence(sentence)];
  }
  return [lowerNumericPlusSentence(sentence)];
}

export function lowerParagraph(paragraph) {
  if (!Array.isArray(paragraph)) {
    throw new VliwEncodingError("invalid-paragraph", "VLIW paragraph must be an array of sentences");
  }
  return paragraph.flatMap((sentence) => lowerSentence(sentence));
}

export function decodeCodelet(input) {
  const decoded = decodeLegacyCodelet(input);
  const quoteItems = decoded.items.filter((item) => item.kind === "quote");
  const quoteItem = quoteItems[0];
  if (quoteItem?.quote.word === dateCompatibility.quote) {
    try {
      return semanticDecode(
        decoded,
        "date",
        decodeDateCodelet(decoded.words)
      );
    } catch (error) {
      if (error instanceof VliwEncodingError && error.code === "malformed-codelet") {
        throw new VliwCodeletError("unsupported-codelet", "date codelet is malformed", {
          cause: error.code,
          details: error.details,
          items: decoded.items
        });
      }
      throw error;
    }
  }
  if (
    quoteItem &&
    (isUintVectorQuoteWord(quoteItem.quote.word) ||
      isIntVectorQuoteWord(quoteItem.quote.word) ||
      (quoteItems.length > 1 && isLetterQuoteWord(quoteItem.quote.word)))
  ) {
    try {
      return semanticDecode(
        decoded,
        "vector",
        decodeVectorCodelet(decoded.words)
      );
    } catch (error) {
      if (error instanceof VliwEncodingError && error.code === "malformed-codelet") {
        throw new VliwCodeletError("unsupported-codelet", "vector codelet is malformed", {
          cause: error.code,
          details: error.details,
          items: decoded.items
        });
      }
      throw error;
    }
  }
  if (decoded.words[0] === namedLiteralCompatibility.head) {
    const namedNominative = decoded.items.find((candidate) => (
      candidate.kind === "word" && candidate.word === booleanLiteralCompatibility.nominativeCase
    ));
    const namedValue = namedNominative ? decoded.words[namedNominative.offset + 1] : null;
    if (
      namedValue === booleanLiteralCompatibility.truth ||
      namedValue === booleanLiteralCompatibility.lie
    ) {
      try {
        return semanticDecode(
          decoded,
          "boolean-literal",
          decodeBooleanLiteralCodelet(decoded.words)
        );
      } catch (error) {
        if (error instanceof VliwEncodingError && error.code === "malformed-codelet") {
          throw new VliwCodeletError("unsupported-codelet", "named boolean codelet is malformed", {
            cause: error.code,
            details: error.details,
            items: decoded.items
          });
        }
        throw error;
      }
    }
    try {
      return semanticDecode(
        decoded,
        "named-literal",
        decodeNamedLiteralCodelet(decoded.words)
      );
    } catch (error) {
      if (error instanceof VliwEncodingError && error.code === "malformed-codelet") {
        throw new VliwCodeletError("unsupported-codelet", "named literal codelet is malformed", {
          cause: error.code,
          details: error.details,
          items: decoded.items
        });
      }
      throw error;
    }
  }
  if (
    decoded.words[0] === booleanLiteralCompatibility.anonymousHead &&
    [booleanLiteralCompatibility.truth, booleanLiteralCompatibility.lie].includes(decoded.words[1])
  ) {
    try {
      return semanticDecode(
        decoded,
        "boolean-literal",
        decodeBooleanLiteralCodelet(decoded.words)
      );
    } catch (error) {
      if (error instanceof VliwEncodingError && error.code === "malformed-codelet") {
        throw new VliwCodeletError("unsupported-codelet", "boolean codelet is malformed", {
          cause: error.code,
          details: error.details,
          items: decoded.items
        });
      }
      throw error;
    }
  }
  if (decoded.words[0] === typedLiteralCompatibility.head) {
    try {
      return semanticDecode(
        decoded,
        "typed-literal",
        decodeTypedLiteralCodelet(decoded.words)
      );
    } catch (error) {
      if (error instanceof VliwEncodingError && error.code === "malformed-codelet") {
        throw new VliwCodeletError("unsupported-codelet", "typed literal codelet is malformed", {
          cause: error.code,
          details: error.details,
          items: decoded.items
        });
      }
      throw error;
    }
  }
  if (
    decoded.words[0] === numericArithmeticCompatibility.head &&
    decoded.words[7] === numericInvertCompatibility.invert
  ) {
    try {
      return semanticDecode(
        decoded,
        "numeric-invert",
        decodeNumericInvertCodelet(decoded.words)
      );
    } catch (error) {
      if (error instanceof VliwEncodingError && error.code === "malformed-codelet") {
        throw new VliwCodeletError("unsupported-codelet", "numeric invert codelet is malformed", {
          cause: error.code,
          details: error.details,
          items: decoded.items
        });
      }
      throw error;
    }
  }
  if (
    decoded.words[0] === numericArithmeticCompatibility.head &&
    decoded.words[7] !== numericArithmeticCompatibility.operators.plus
  ) {
    try {
      return semanticDecode(
        decoded,
        "numeric-arithmetic",
        decodeNumericArithmeticCodelet(decoded.words)
      );
    } catch (error) {
      if (error instanceof VliwEncodingError && error.code === "malformed-codelet") {
        throw new VliwCodeletError("unsupported-codelet", "numeric arithmetic codelet is malformed", {
          cause: error.code,
          details: error.details,
          items: decoded.items
        });
      }
      throw error;
    }
  }
  try {
    return semanticDecode(
      decoded,
      "numeric-plus",
      decodeNumericPlusCodelet(decoded.words)
    );
  } catch (error) {
    if (error instanceof VliwEncodingError && error.code === "malformed-codelet") {
      throw new VliwCodeletError("unsupported-codelet", "no semantic adapter exists for this codelet", {
        cause: error.code,
        details: error.details,
        items: decoded.items
      });
    }
    throw error;
  }
}

export function renderPyashCodelet(input) {
  const decoded = decodeCodelet(input);
  return sentenceToPyash(decoded.sentence);
}

export async function executeCodelets(codelets) {
  if (!Array.isArray(codelets)) {
    throw new VliwEncodingError("invalid-program", "VLIW execution requires an array of codelets");
  }

  const scheduled = scheduleCodeletDependencies(codelets);
  const results = new Array(codelets.length);
  for (const entry of scheduled) {
    const codelet = entry.instruction;
    const words = codelet?.words ?? codelet;
    const decoded = decodeCodelet(words);
    let result;
    if (decoded.semantic === "named-literal") {
      result = await executeNamedLiteralCodelet(words);
    } else if (decoded.semantic === "boolean-literal") {
      result = await executeBooleanLiteralCodelet(words);
    } else if (decoded.semantic === "typed-literal") {
      result = await executeTypedLiteralCodelet(words);
    } else if (decoded.semantic === "numeric-arithmetic") {
      result = await executeNumericArithmeticCodelet(words);
    } else if (decoded.semantic === "numeric-invert") {
      result = await executeNumericInvertCodelet(words);
    } else if (decoded.semantic === "date") {
      result = await executeDateCodelet(words);
    } else if (decoded.semantic === "vector") {
      result = await executeVectorCodelet(words);
    } else {
      result = await executeNumericPlusCodelet(words);
    }
    results[entry.index] = result;
  }
  return results;
}

export {
  decodeLegacyCodelet,
  decodeLegacyCodeletSequence,
  VliwCodeletError
};
export {
  analyzeCodeletDependencies,
  deriveSentenceEffects,
  scheduleCodeletDependencies
} from "./effects.mjs";
export {
  decodePyashProgram,
  decodePyashProgramOrNull,
  lowerPyashProgram,
  lowerPyashSentence
} from "./sentence.mjs";
export {
  PYAC_MAGIC,
  PYAC_FORMAT_VERSION,
  PYAC_WORD_BITS,
  PYAC_WORDS_PER_CODELET,
  PYAC_HEADER_BYTES,
  PYAC_CODELET_BYTES,
  PyacDatabaseError,
  encodePyacPack,
  decodePyacPack,
  buildVliwDatabase,
  buildVliwDatabaseFromTranslation,
  queryVliwCatalog,
  replayVliwDatabase,
  renderVliwCatalogPya,
  parseVliwCatalogPya,
  writeVliwDatabaseFiles,
  readVliwDatabaseFiles
} from "./database.mjs";

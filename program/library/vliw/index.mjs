import {
  decodeLegacyCodelet,
  decodeLegacyCodeletSequence,
  VliwCodeletError
} from "./codelets.mjs";
import {
  decodeNumericPlusCodelet,
  executeNumericPlusCodelet,
  VliwEncodingError
} from "./plus.mjs";
import {
  decodeTypedLiteralCodelet,
  executeTypedLiteralCodelet,
  typedLiteralCompatibility
} from "./literal.mjs";
import {
  decodeNamedLiteralCodelet,
  executeNamedLiteralCodelet,
  namedLiteralCompatibility
} from "./named_literal.mjs";
import {
  booleanLiteralCompatibility,
  decodeBooleanLiteralCodelet,
  executeBooleanLiteralCodelet
} from "./boolean_literal.mjs";
import {
  decodeNumericArithmeticCodelet,
  executeNumericArithmeticCodelet,
  isNumericArithmeticCodelet,
  numericArithmeticCompatibility
} from "./arithmetic.mjs";
import {
  decodeNamedQueryCodelet,
  executeNamedQueryCodelet,
  namedQueryCompatibility
} from "./named_query.mjs";
import {
  decodeNumericInvertCodelet,
  executeNumericInvertCodelet,
  numericInvertCompatibility
} from "./invert.mjs";
import {
  dateCompatibility,
  decodeDateCodelet,
  executeDateCodelet
} from "./date.mjs";
import {
  decodeVectorCodelet,
  executeVectorCodelet
} from "./vector.mjs";
import { decodeVectorSequence } from "./vector_sequence.mjs";
import {
  isIntVectorQuoteWord,
  isFloatVectorQuoteWord,
  isLetterQuoteWord,
  isUintVectorQuoteWord
} from "./quotes.mjs";
import { sentenceToPyash } from "../../beautiful.mjs";
import { decodePyashProgram } from "./sentence.mjs";
import { deriveSentenceEffects, scheduleCodeletDependencies } from "./effects.mjs";
import { executeVectorProgram, hasVectorCodelets } from "./vector_program.mjs";

const TYPED_LITERAL_QUOTE_FAMILIES = new Set(["number", "letter", "paragraph-letter", "float32", "fixed16"]);

function semanticDecode(decoded, semantic, sentence) {
  return {
    ...decoded,
    semantic,
    sentence,
    effects: deriveSentenceEffects(sentence)
  };
}

export { lowerSentence, lowerParagraph } from "./lower_sentence.mjs";

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
  if (quoteItem && (isUintVectorQuoteWord(quoteItem.quote.word) || isFloatVectorQuoteWord(quoteItem.quote.word)) &&
      isNumericArithmeticCodelet(decoded.words, decoded.usedWords)) {
    try {
      return semanticDecode(
        decoded,
        "numeric-arithmetic",
        decodeNumericArithmeticCodelet(decoded.words)
      );
    } catch (error) {
      if (error instanceof VliwEncodingError && error.code === "malformed-codelet") {
        throw new VliwCodeletError("unsupported-codelet", "numeric vector arithmetic codelet is malformed", {
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
      isFloatVectorQuoteWord(quoteItem.quote.word) ||
      quoteItem.quote.family === "text-array" ||
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
  if (decoded.words[decoded.usedWords - 1] === namedQueryCompatibility.interrogativeMood) {
    try {
      return semanticDecode(decoded, "named-query", decodeNamedQueryCodelet(decoded.words));
    } catch (error) {
      if (error instanceof VliwEncodingError && error.code === "malformed-codelet") {
        throw new VliwCodeletError("unsupported-codelet", "named query codelet is malformed", {
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
  const literalQuote = decoded.items.find((candidate) => candidate.offset === 1);
  const typedLiteralCaseOffset = literalQuote?.quote?.nextOffset;
  const hasTypedLiteralBoundaries = decoded.items.some((item) => (
    item.offset === typedLiteralCaseOffset
    && item.kind === "word"
    && item.word === typedLiteralCompatibility.accusativeCase
  )) && decoded.items.some((item) => (
    item.offset === typedLiteralCaseOffset + 1
    && item.kind === "word"
    && item.word === typedLiteralCompatibility.realisMood
  ));
  if (
    literalQuote?.kind === "quote"
    && TYPED_LITERAL_QUOTE_FAMILIES.has(literalQuote.quote.family)
    && hasTypedLiteralBoundaries
  ) {
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
  if (isNumericArithmeticCodelet(decoded.words, decoded.usedWords)) {
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

async function executeOneCodelet(codelet, state) {
  const words = codelet?.words ?? codelet;
  const decoded = decodeCodelet(words);
  if (decoded.semantic === "named-literal") {
    const result = await executeNamedLiteralCodelet(words);
    state.set(result.su.name, structuredClone(result));
    return result;
  }
  if (decoded.semantic === "named-query") return executeNamedQueryCodelet(words, state);
  if (decoded.semantic === "boolean-literal") return executeBooleanLiteralCodelet(words);
  if (decoded.semantic === "typed-literal") return executeTypedLiteralCodelet(words);
  if (decoded.semantic === "numeric-arithmetic") {
    return executeNumericArithmeticCodelet(words, { state });
  }
  if (decoded.semantic === "numeric-invert") return executeNumericInvertCodelet(words);
  if (decoded.semantic === "date") return executeDateCodelet(words);
  if (decoded.semantic === "vector") return executeVectorCodelet(words);
  return executeNumericPlusCodelet(words);
}

async function executeScheduledCodelets(codelets, state) {
  const scheduled = scheduleCodeletDependencies(codelets);
  const results = new Array(codelets.length);
  for (const entry of scheduled) {
    results[entry.index] = await executeOneCodelet(entry.instruction, state);
  }
  return results;
}

export async function executeCodelets(codelets) {
  if (!Array.isArray(codelets)) {
    throw new VliwEncodingError("invalid-program", "VLIW execution requires an array of codelets");
  }

  if (hasVectorCodelets(codelets)) {
    return executeVectorProgram(codelets, {
      executeOneCodelet,
      decodePyashProgram,
      decodeVectorSequence
    });
  }

  return executeScheduledCodelets(codelets, new Map());
}

export {
  decodeLegacyCodelet,
  decodeLegacyCodeletSequence,
  VliwCodeletError
};
export {
  decodeVectorCodelet,
  lowerVectorSentence,
  normalizeVectorSentence,
  vectorCompatibility
} from "./vector.mjs";
export { decodeVectorSequence, lowerVectorSequence } from "./vector_sequence.mjs";
export {
  analyzeCodeletDependencies,
  deriveSentenceEffects,
  scheduleCodeletDependencies
} from "./effects.mjs";
export {
  parseVliwFunctionSource,
  renderVliwFunctionSource,
  VliwFunctionSourceError
} from "./source.mjs";
export { createHousekeeperVliwPackExecutor } from "./rust_gpu_pack.mjs";
export {
  decodePyashProgram,
  decodePyashProgramOrNull,
  lowerPyashProgram,
  lowerPyashSentence
} from "./sentence.mjs";
export {
  DEFAULT_PYASH_PROGRAMLET_STEP_BUDGET,
  MAX_PYASH_PROGRAMLET_STEP_BUDGET,
  compilePyashProgramSource,
  decodePyashProgramPack,
  decodePyashProgramSections,
  executePyashProgramPack,
  evolvePyashProgramSource,
  mutatePyashProgramSource
} from "./programlet.mjs";
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

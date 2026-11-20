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
  isNumericArithmeticCodelet,
  isNumericArithmeticSentence,
  lowerNumericArithmeticSentence,
  numericArithmeticCompatibility
} from "./arithmetic.mjs";
import {
  decodeNamedQueryCodelet,
  executeNamedQueryCodelet,
  isNamedQuerySentence,
  lowerNamedQuerySentence,
  namedQueryCompatibility
} from "./named_query.mjs";
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
  lowerVectorSentence,
  normalizeVectorSentence
} from "./vector.mjs";
import { decodeVectorSequence, lowerVectorSequence } from "./vector_sequence.mjs";
import { normalizeScalarProductSentence, isScalarProductSentence } from "./scalar_product.mjs";
import { isPlukTlasSentence, lowerPlukTlasSentence } from "./pluk_tlas.mjs";
import {
  isIntVectorQuoteWord,
  isFloatVectorQuoteWord,
  isLetterQuoteWord,
  isUintVectorQuoteWord
} from "./quotes.mjs";
import { sentenceToPyash } from "../../beautiful.mjs";
import { decodePyashProgram, lowerPyashSentence } from "./sentence.mjs";
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

export function lowerSentence(sentence) {
  if (isPlukTlasSentence(sentence)) {
    return lowerPlukTlasSentence(sentence);
  }
  if (isScalarProductSentence(sentence)) {
    const normalized = normalizeScalarProductSentence(sentence);
    return lowerPyashSentence(normalized).vectors.map((words) => ({
      sentence: normalized,
      words,
      semantic: "scalar-product"
    }));
  }
  if (["not", "and", "or"].includes(sentence?.be) && sentence?.mood === "do") {
    return lowerPyashSentence(sentence).vectors.map((words) => ({
      sentence,
      words,
      semantic: "boolean-composition"
    }));
  }
  if (
    ["equally", "tiny", "giant"].includes(sentence?.be)
    && sentence?.mood === "do"
    && !sentence.consequence
    && !sentence.alternative
  ) {
    return lowerPyashSentence(sentence).vectors.map((words) => ({
      sentence,
      words,
      semantic: "boolean-comparison"
    }));
  }
  if (isNamedQuerySentence(sentence)) {
    return [lowerNamedQuerySentence(sentence)];
  }
  if (isDateSentence(sentence)) {
    return [lowerDateSentence(sentence)];
  }
  if (isVectorSentence(sentence)) {
    const { type, payload } = normalizeVectorSentence(sentence);
    if (type === "text" && payload.length === 1) {
      return lowerVectorSequence(sentence);
    }
    try {
      return [lowerVectorSentence(sentence)];
    } catch (error) {
      if (error.code !== "literal-width") throw error;
    }
    try {
      return lowerVectorSequence(sentence);
    } catch (error) {
      if (error.code !== "literal-width") throw error;
    }
    const lowered = lowerPyashSentence(sentence);
    return lowered.vectors.map((words) => ({
      sentence,
      words,
      semantic: "vector"
    }));
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
  const hasNonU16Number = [sentence?.ob, sentence?.to, sentence?.from, sentence?.with, sentence?.by]
    .some((value) => typeof value?.num === "number" && (!Number.isInteger(value.num) || value.num < 0 || value.num > 0xffff));
  if (isNumericArithmeticSentence(sentence) && (
    sentence.as?.name === "rational" ||
    sentence.be !== "plus" || sentence.ob?.ve !== undefined || hasNonU16Number
  )) {
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

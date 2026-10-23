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

function rejectUnprovenSemanticSentence(sentence) {
  const unsupportedVerb = {
    remains: "unsupported-remains",
    invert: "unsupported-invert",
    exponential: "unsupported-exponential"
  }[sentence?.be];
  if (sentence?.mood === "do" && unsupportedVerb) {
    throw new VliwEncodingError(
      unsupportedVerb,
      `${sentence.be} sentence lowering requires a recovered legacy sentence fixture`,
      { sentence }
    );
  }
  if (sentence?.be === "vector" && sentence?.ob?.ve !== undefined) {
    throw new VliwEncodingError(
      "unsupported-vector",
      "vector sentence lowering requires a recovered legacy sentence fixture",
      { sentence }
    );
  }
  if (sentence?.be === "date" && sentence?.ob?.date !== undefined) {
    throw new VliwEncodingError(
      "unsupported-date",
      "date sentence lowering requires a recovered legacy date encoding",
      { sentence }
    );
  }
}

export function lowerSentence(sentence) {
  rejectUnprovenSemanticSentence(sentence);
  if (isBooleanLiteralSentence(sentence)) {
    return [lowerBooleanLiteralSentence(sentence)];
  }
  if (isNamedLiteralSentence(sentence)) {
    return [lowerNamedLiteralSentence(sentence)];
  }
  if (isTypedLiteralSentence(sentence)) {
    return [lowerTypedLiteralSentence(sentence)];
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

import {
  decodeLegacyCodelet,
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

export function lowerSentence(sentence) {
  if (isTypedLiteralSentence(sentence)) {
    return [lowerTypedLiteralSentence(sentence)];
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
  if (decoded.words[0] === typedLiteralCompatibility.head) {
    try {
      return {
        ...decoded,
        semantic: "typed-literal",
        sentence: decodeTypedLiteralCodelet(decoded.words)
      };
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
  try {
    return {
      ...decoded,
      semantic: "numeric-plus",
      sentence: decodeNumericPlusCodelet(decoded.words)
    };
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

export async function executeCodelets(codelets) {
  if (!Array.isArray(codelets)) {
    throw new VliwEncodingError("invalid-program", "VLIW execution requires an array of codelets");
  }

  const results = [];
  for (const codelet of codelets) {
    const words = codelet?.words ?? codelet;
    const decoded = decodeCodelet(words);
    if (decoded.semantic === "typed-literal") {
      results.push(await executeTypedLiteralCodelet(words));
    } else {
      results.push(await executeNumericPlusCodelet(words));
    }
  }
  return results;
}

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
  queryVliwCatalog,
  replayVliwDatabase,
  renderVliwCatalogPya,
  parseVliwCatalogPya,
  writeVliwDatabaseFiles,
  readVliwDatabaseFiles
} from "./database.mjs";

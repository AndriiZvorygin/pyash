import { lowerNumericPlusSentence, VliwEncodingError } from "./plus.mjs";
import {
  isTypedLiteralSentence,
  lowerTypedLiteralSentence
} from "./literal.mjs";
import {
  isNamedLiteralSentence,
  lowerNamedLiteralSentence
} from "./named_literal.mjs";
import {
  isBooleanLiteralSentence,
  lowerBooleanLiteralSentence
} from "./boolean_literal.mjs";
import {
  isNumericArithmeticSentence,
  lowerNumericArithmeticSentence
} from "./arithmetic.mjs";
import { isNamedQuerySentence, lowerNamedQuerySentence } from "./named_query.mjs";
import { isNumericInvertSentence, lowerNumericInvertSentence } from "./invert.mjs";
import { isDateSentence, lowerDateSentence } from "./date.mjs";
import { isVectorSentence, lowerVectorSentence, normalizeVectorSentence } from "./vector.mjs";
import { lowerVectorSequence } from "./vector_sequence.mjs";
import { isScalarProductSentence, normalizeScalarProductSentence } from "./scalar_product.mjs";
import { isMutableVectorSentence, lowerMutableVectorSentence } from "./mutable_vector.mjs";
import { isPlukTlasSentence, lowerPlukTlasSentence } from "./pluk_tlas.mjs";
import { lowerPyashSentence } from "./sentence.mjs";

function isIwspFloatVectorOperation(sentence) {
  if (sentence?.mood !== "do") return false;
  const left = sentence.ob;
  const isFloatVector = (value) => ["float32", "float64"].includes(value?.ve?.type);
  const isNamedVector = (value) => typeof value?.name === "string";
  if (sentence.be === "gjat bwit") {
    return isFloatVector(left) || isNamedVector(left);
  }
  if (sentence.be === "tfo2t") {
    return isFloatVector(left) || isNamedVector(left);
  }
  if (!["plus", "multiply"].includes(sentence.be)) return false;
  if (!isFloatVector(left) && !isNamedVector(left)) return false;
  return sentence.to !== undefined && sentence.from === undefined && sentence.with === undefined;
}

export function lowerSentence(sentence) {
  if (isMutableVectorSentence(sentence)) {
    return lowerMutableVectorSentence(sentence);
  }
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
  if (isIwspFloatVectorOperation(sentence)) {
    return lowerPyashSentence(sentence).vectors.map((words) => ({
      sentence,
      words,
      semantic: "iwsp-float-vector-operation"
    }));
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

function firstValue(row, keys, fallback = null) {
  for (const key of keys) {
    if (row?.[key] !== undefined && row?.[key] !== null) return row[key];
  }
  return fallback;
}

function textValues(value) {
  if (Array.isArray(value)) return value.flatMap(textValues).filter(Boolean);
  if (value && typeof value === "object") return textValues(firstValue(value, ["text", "value", "target", "translation"], ""));
  const text = String(value ?? "").trim();
  return text ? [text] : [];
}

function normalizeText(value) {
  return String(value ?? "").normalize("NFC").trim().replace(/\s+/gu, " ");
}

function characterSequence(value, includeWhitespace = false) {
  const text = normalizeText(value);
  return includeWhitespace ? text : text.replace(/\s/gu, "");
}

function ngramCounts(text, order) {
  const counts = new Map();
  for (let index = 0; index <= text.length - order; index += 1) {
    const ngram = text.slice(index, index + order);
    counts.set(ngram, (counts.get(ngram) ?? 0) + 1);
  }
  return counts;
}

function chrfPair(reference, hypothesis, { charOrder = 6, beta = 2, whitespace = false } = {}) {
  const referenceText = characterSequence(reference, whitespace);
  const hypothesisText = characterSequence(hypothesis, whitespace);
  if (!referenceText || !hypothesisText) return referenceText === hypothesisText ? 100 : 0;

  let precision = 0;
  let recall = 0;
  let orders = 0;
  for (let order = 1; order <= charOrder; order += 1) {
    const referenceCounts = ngramCounts(referenceText, order);
    const hypothesisCounts = ngramCounts(hypothesisText, order);
    const referenceTotal = [...referenceCounts.values()].reduce((sum, count) => sum + count, 0);
    const hypothesisTotal = [...hypothesisCounts.values()].reduce((sum, count) => sum + count, 0);
    if (!referenceTotal || !hypothesisTotal) continue;
    const overlap = [...hypothesisCounts.entries()].reduce((sum, [ngram, count]) => sum + Math.min(count, referenceCounts.get(ngram) ?? 0), 0);
    precision += overlap / hypothesisTotal;
    recall += overlap / referenceTotal;
    orders += 1;
  }
  if (!orders) return 0;
  precision /= orders;
  recall /= orders;
  if (precision + recall === 0) return 0;
  const betaSquared = beta ** 2;
  return ((1 + betaSquared) * precision * recall / (betaSquared * precision + recall)) * 100;
}

export function chrfScore(references, hypothesis, options = {}) {
  const candidates = textValues(references);
  if (!candidates.length) return 0;
  return Math.max(...candidates.map(reference => chrfPair(reference, hypothesis, options)));
}

export function normalizeTranslationSample(row, index, benchmark = "FLORES-200") {
  const suiteName = typeof benchmark === "string" ? benchmark : "FLORES-200";
  const sourceLanguage = String(firstValue(row, ["source_language", "sourceLanguage", "src_lang", "srcLang", "source_lang"], "")).trim();
  const targetLanguage = String(firstValue(row, ["target_language", "targetLanguage", "tgt_lang", "tgtLang", "target_lang"], "")).trim();
  const source = String(firstValue(row, ["source", "source_text", "sourceText", "input", "sentence"], "")).trim();
  const references = textValues(firstValue(row, ["references", "reference", "target", "target_text", "targetText", "translation", "translations"], ""));
  const direction = sourceLanguage && targetLanguage ? `${sourceLanguage}→${targetLanguage}` : "unspecified";
  const languagePrompt = sourceLanguage && targetLanguage
    ? ` from ${sourceLanguage} to ${targetLanguage}`
    : "";
  return {
    id: String(row?.id ?? row?.sentence_id ?? row?.sentenceId ?? `${suiteName.toLowerCase().replace(/[^a-z0-9]+/gu, "-")}-${index + 1}`),
    prompt: `Translate the following sentence${languagePrompt}. Return only the translation.\n\nSOURCE:\n${source}`,
    input: source,
    source,
    reference: references[0] ?? "",
    references,
    metadata: {
      source: suiteName,
      sourceLanguage: sourceLanguage || null,
      targetLanguage: targetLanguage || null,
      direction,
      referenceAvailable: references.length > 0,
      referenceCount: references.length
    }
  };
}

export function scoreTranslationSample(sample, output, options = {}) {
  const text = String(output ?? "").trim();
  return {
    chrf: chrfScore(sample.references ?? sample.reference, text, options),
    translationLength: text.length,
    schemaValidity: text ? 1 : 0
  };
}

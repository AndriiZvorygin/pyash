import { readFile } from "node:fs/promises";

import { buildProgram } from "../../../program.mjs";

export const TRANSLATION_MODEL_CARDS_FORMAT = "translation-model-cards-v1";
export const TRANSLATION_MODEL_CARDS_NAME = "translation_model_cards";
export const TRANSLATION_MODEL_CARDS_URL = new URL("./translation_model_cards.pya", import.meta.url);
export const DEFAULT_TRANSLATION_MODEL = "qwen3.5:9b";

const CARD_FIELDS = [
  "provider",
  "context-window-tokens",
  "safe-input-tokens",
  "safe-output-tokens",
  "card-source"
];

function invalid(message, details = {}) {
  const error = new Error(message);
  error.code = "invalid-translation-model-cards";
  error.details = details;
  return error;
}

function text(value) {
  return typeof value === "string" ? value.normalize("NFC").trim() : "";
}

function scalar(sentence) {
  if (Number.isInteger(sentence?.ob?.num)) return sentence.ob.num;
  if (typeof sentence?.ob?.text === "string") return sentence.ob.text;
  return null;
}

export function parseTranslationModelCards(source) {
  if (typeof source !== "string") throw invalid("model-card source must be text");
  const sentences = buildProgram(source).sentences;
  const header = sentences.find((sentence) => (
    sentence?.mood === "def"
      && sentence?.be === "map"
      && sentence?.su?.name === TRANSLATION_MODEL_CARDS_NAME
  ));
  if (!header) throw invalid("model-card source has no canonical map header");
  const metadata = {};
  const cards = new Map();
  for (const sentence of sentences) {
    if (sentence?.mood !== "ya" || typeof sentence.su?.text !== "string") continue;
    const key = sentence.su.text;
    const value = scalar(sentence);
    if (key === "format") {
      metadata.format = value;
      continue;
    }
    if (value === null || !key.startsWith("model:")) continue;
    for (const field of CARD_FIELDS) {
      const suffix = `:${field}`;
      if (!key.endsWith(suffix)) continue;
      const model = key.slice("model:".length, -suffix.length);
      if (!model) throw invalid("model-card row has an empty model id", { key });
      const card = cards.get(model) ?? { model };
      card[field] = value;
      cards.set(model, card);
      break;
    }
  }
  if (metadata.format !== TRANSLATION_MODEL_CARDS_FORMAT) {
    throw invalid("model-card source has an unsupported format", { format: metadata.format });
  }
  return { format: metadata.format, cards };
}

export function selectTranslationModelCard(cards, model = DEFAULT_TRANSLATION_MODEL) {
  const modelId = text(model) || DEFAULT_TRANSLATION_MODEL;
  const card = cards?.get(modelId);
  if (!card) throw invalid("no translation model card is configured", { model: modelId });
  const contextWindowTokens = Math.max(1, Math.trunc(Number(card["context-window-tokens"]) || 1));
  const safeInputTokens = Math.max(1, Math.trunc(Number(card["safe-input-tokens"]) || 1));
  const safeOutputTokens = Math.max(1, Math.trunc(Number(card["safe-output-tokens"]) || 1));
  if (safeInputTokens + safeOutputTokens >= contextWindowTokens) {
    throw invalid("model-card input and output budgets must fit inside its context window", {
      model: modelId,
      contextWindowTokens,
      safeInputTokens,
      safeOutputTokens
    });
  }
  return {
    model: modelId,
    provider: text(card.provider),
    contextWindowTokens,
    safeInputTokens,
    safeOutputTokens,
    cardSource: text(card["card-source"])
  };
}

export async function loadTranslationModelCard({
  model = DEFAULT_TRANSLATION_MODEL,
  url = TRANSLATION_MODEL_CARDS_URL
} = {}) {
  const parsed = parseTranslationModelCards(await readFile(url, "utf8"));
  return selectTranslationModelCard(parsed.cards, model);
}

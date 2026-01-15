import { englishLineToSentence, sentenceToEnglish } from "./english.mjs";
import { frenchLineToSentence, sentenceToFrench } from "./french.mjs";
import { javascriptLineToSentence } from "./javascript.mjs";
import { russianLineToSentence, sentenceToRussian } from "./russian.mjs";
import { whisperEnglishLineToSentence } from "./whisper_english.mjs";

const adapters = [];

function normalizeLang(name) {
  return String(name || "").trim().toLowerCase();
}

function registerTranslationAdapter(adapter) {
  if (!adapter?.name) return;
  adapters.push({
    ...adapter,
    name: normalizeLang(adapter.name),
    aliases: (adapter.aliases || []).map(normalizeLang)
  });
}

function findAdapter(lang) {
  const normalized = normalizeLang(lang);
  if (!normalized) return null;
  return adapters.find(adapter =>
    adapter.name === normalized || adapter.aliases.includes(normalized)
  ) ?? null;
}

export function resolveTranslationSource(lang) {
  const adapter = findAdapter(lang);
  return adapter?.fromLine ? adapter : null;
}

export function resolveTranslationTarget(lang) {
  const adapter = findAdapter(lang);
  return adapter?.toSentence ? adapter : null;
}

registerTranslationAdapter({
  name: "english",
  aliases: ["en"],
  fromLine: englishLineToSentence,
  toSentence: sentenceToEnglish
});

registerTranslationAdapter({
  name: "whisper-english",
  aliases: ["whisperenglish", "whisper_english"],
  fromLine: whisperEnglishLineToSentence
});

registerTranslationAdapter({
  name: "javascript",
  aliases: ["js"],
  fromLine: javascriptLineToSentence
});

registerTranslationAdapter({
  name: "russian",
  aliases: ["ru"],
  fromLine: russianLineToSentence,
  toSentence: sentenceToRussian
});

registerTranslationAdapter({
  name: "french",
  aliases: ["fr"],
  fromLine: frenchLineToSentence,
  toSentence: sentenceToFrench
});

export function listTranslationAdapters() {
  return [...adapters];
}

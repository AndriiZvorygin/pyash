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
  return adapter?.toPyash ? adapter : null;
}

export function resolveTranslationTarget(lang) {
  const adapter = findAdapter(lang);
  return adapter?.fromPyash ? adapter : null;
}

registerTranslationAdapter({
  name: "english",
  aliases: ["en"],
  toPyash: englishLineToSentence,
  fromPyash: sentenceToEnglish
});

registerTranslationAdapter({
  name: "whisper-english",
  aliases: ["whisperenglish", "whisper_english"],
  toPyash: whisperEnglishLineToSentence
});

registerTranslationAdapter({
  name: "javascript",
  aliases: ["js"],
  toPyash: javascriptLineToSentence
});

registerTranslationAdapter({
  name: "russian",
  aliases: ["ru"],
  toPyash: russianLineToSentence,
  fromPyash: sentenceToRussian
});

registerTranslationAdapter({
  name: "french",
  aliases: ["fr"],
  toPyash: frenchLineToSentence,
  fromPyash: sentenceToFrench
});

export function listTranslationAdapters() {
  return [...adapters];
}

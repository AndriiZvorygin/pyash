import { replaceQuotedTextBlocks } from "./quotedTextBlock.mjs";

const BASE_MOODS = new Set(["ya", "def", "do", "que", "prah", "ret", "can", "pi7"]);

export function splitSentences(text, { includeThen = false } = {}) {
  const moods = includeThen ? new Set([...BASE_MOODS, "then"]) : BASE_MOODS;
  const { working, replacements } = replaceQuotedTextBlocks(text);

  const sentences = [];
  let sentenceTokens = [];
  let clauseDepth = 0;

  let current = "";
  let inQuote = false;

  const pushToken = (token) => {
    if (!token) return;
    if (token === "la") clauseDepth += 1;
    if (token === "ko") clauseDepth = Math.max(0, clauseDepth - 1);
    sentenceTokens.push(token);
    if (clauseDepth === 0 && moods.has(token)) {
      sentences.push(sentenceTokens.join(" "));
      sentenceTokens = [];
    }
  };

  for (let i = 0; i < working.length; i++) {
    const ch = working[i];

    if (inQuote) {
      if (ch === "\\" && i + 1 < working.length) {
        current += ch + working[i + 1];
        i++;
        continue;
      }

      if (ch === '"') {
        current += ch;
        pushToken(current);
        current = "";
        inQuote = false;
      } else {
        current += ch;
      }
      continue;
    }

    if (ch === '"') {
      pushToken(current);
      current = '"';
      inQuote = true;
      continue;
    }

    if (/\s/.test(ch)) {
      pushToken(current);
      current = "";
      if (ch === "\n" && clauseDepth === 0 && sentenceTokens.length > 0) {
        sentences.push(sentenceTokens.join(" "));
        sentenceTokens = [];
      }
      continue;
    }

    current += ch;
  }

  pushToken(current);

  if (sentenceTokens.length > 0) {
    sentences.push(sentenceTokens.join(" "));
  }

  if (replacements.length === 0) return sentences;

  return sentences.map(sentence => {
    let restored = sentence;
    for (const { placeholder, block } of replacements) {
      restored = restored.replace(placeholder, () => block);
    }
    return restored;
  });
}

export function splitSentencesWithLines(text, { includeThen = false } = {}) {
  const moods = includeThen ? new Set([...BASE_MOODS, "then"]) : BASE_MOODS;
  const { working, replacements } = replaceQuotedTextBlocks(text);

  const sentences = [];
  let sentenceTokens = [];
  let clauseDepth = 0;
  let sentenceLine = null;

  let current = "";
  let inQuote = false;
  let line = 1;

  const pushToken = (token) => {
    if (!token) return;
    if (sentenceTokens.length === 0 && sentenceLine == null) sentenceLine = line;
    if (token === "la") clauseDepth += 1;
    if (token === "ko") clauseDepth = Math.max(0, clauseDepth - 1);
    sentenceTokens.push(token);
    if (clauseDepth === 0 && moods.has(token)) {
      sentences.push({ text: sentenceTokens.join(" "), line: sentenceLine ?? line });
      sentenceTokens = [];
      sentenceLine = null;
    }
  };

  for (let i = 0; i < working.length; i++) {
    const ch = working[i];

    if (ch === "\n") line += 1;

    if (inQuote) {
      if (ch === "\\" && i + 1 < working.length) {
        current += ch + working[i + 1];
        i++;
        continue;
      }

      if (ch === '"') {
        current += ch;
        pushToken(current);
        current = "";
        inQuote = false;
      } else {
        current += ch;
      }
      continue;
    }

    if (ch === '"') {
      pushToken(current);
      current = '"';
      inQuote = true;
      continue;
    }

    if (/\s/.test(ch)) {
      pushToken(current);
      current = "";
      if (ch === "\n" && clauseDepth === 0 && sentenceTokens.length > 0) {
        sentences.push({ text: sentenceTokens.join(" "), line: sentenceLine ?? line });
        sentenceTokens = [];
        sentenceLine = null;
      }
      continue;
    }

    current += ch;
  }

  pushToken(current);

  if (sentenceTokens.length > 0) {
    sentences.push({ text: sentenceTokens.join(" "), line: sentenceLine ?? line });
  }

  if (replacements.length === 0) return sentences;

  return sentences.map(({ text: sentence, line: lineNum }) => {
    let restored = sentence;
    for (const { placeholder, block } of replacements) {
      restored = restored.replace(placeholder, () => block);
    }
    return { text: restored, line: lineNum };
  });
}

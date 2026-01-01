const MOODS = new Set(["ya", "def", "do", "que", "prah", "ret", "can"]);

export function splitSentences(text) {
  const replacements = [];
  const blockRegex = /quoted\.([^.]+)\.(?:contents\s*)?([\s\S]*?)\.\1\.quoted/g;
  let working = text;
  let match;
  let blockIndex = 0;
  while ((match = blockRegex.exec(text)) !== null) {
    const placeholder = `__QUOTED_BLOCK_${blockIndex++}__`;
    replacements.push({ placeholder, block: match[0] });
    working = working.replace(match[0], placeholder);
  }

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
    if (clauseDepth === 0 && MOODS.has(token)) {
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
      restored = restored.replace(placeholder, block);
    }
    return restored;
  });
}

export function splitSentencesWithLines(text) {
  const replacements = [];
  const blockRegex = /quoted\.([^.]+)\.(?:contents\s*)?([\s\S]*?)\.\1\.quoted/g;
  let working = text;
  let match;
  let blockIndex = 0;
  while ((match = blockRegex.exec(text)) !== null) {
    const placeholder = `__QUOTED_BLOCK_${blockIndex++}__`;
    replacements.push({ placeholder, block: match[0] });
    working = working.replace(match[0], placeholder);
  }

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
    if (clauseDepth === 0 && MOODS.has(token)) {
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
      restored = restored.replace(placeholder, block);
    }
    return { text: restored, line: lineNum };
  });
}

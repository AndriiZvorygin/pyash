const MOODS = new Set(["ya", "def", "do", "que", "then", "prah"]);

export function splitSentences(text) {
  const sentences = [];
  let sentenceTokens = [];

  let current = "";
  let inQuote = false;

  const pushToken = (token) => {
    if (!token) return;
    sentenceTokens.push(token);
    if (MOODS.has(token)) {
      sentences.push(sentenceTokens.join(" "));
      sentenceTokens = [];
    }
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (inQuote) {
      if (ch === "\\" && i + 1 < text.length) {
        current += ch + text[i + 1];
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

  return sentences;
}

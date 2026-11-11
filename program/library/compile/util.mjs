function sanitizeName(name = "") {
  const cleaned = String(name)
    .trim()
    .replace(/[^A-Za-z0-9_]+/g, "_")
    .replace(/^([0-9])/, "_$1");
  // Avoid reserved identifiers across generated JS/C output.
  if (/^(?:this|function|return|class|default|const|let|var|if|for|while|switch|case|break|continue|do|new|try|catch|finally|auto|extern|register|static|typedef|volatile|char|short|int|long|float|double|signed|unsigned|void|struct|union|enum|sizeof|goto|abs)$/.test(cleaned)) {
    return `_${cleaned}`;
  }
  return cleaned;
}

function sentenceIdForText(text, index = 0) {
  const idx = Number.isFinite(index) ? Number(index) : 0;
  return `evoke-${idx}`;
}

function markDeclared(declared, name) {
  if (!declared || !name) return;
  const clean = sanitizeName(name);
  declared.add(name);
  declared.add(clean);
}

function compareUtf8(a, b) {
  if (a === b) return 0;
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  const len = Math.min(bufA.length, bufB.length);
  for (let i = 0; i < len; i += 1) {
    if (bufA[i] !== bufB[i]) return bufA[i] < bufB[i] ? -1 : 1;
  }
  return bufA.length < bufB.length ? -1 : 1;
}

export { compareUtf8, markDeclared, sanitizeName, sentenceIdForText };

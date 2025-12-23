export function vectorFormatHelper() {
  return [
    "function formatVector(values = [], type = \"num\") {",
    "  const tokens = [\"ve\", type];",
    "  for (const value of values) {",
    "    if (typeof value === \"number\") tokens.push(String(value));",
    "    else if (typeof value === \"boolean\") tokens.push(value ? \"truth\" : \"lie\");",
    "    else if (typeof value === \"string\") {",
    "      if (/^[A-Za-z0-9_.-]+$/.test(value)) tokens.push(value);",
    "      else tokens.push(JSON.stringify(value));",
    "    } else tokens.push(String(value));",
    "  }",
    "  return tokens.join(\" \");",
    "}",
    "function formatVectorSentence(name, vec) {",
    "  const v = vec || {};",
    "  return `su name ${name} ob ${formatVector(v.values || [], v.type || \"num\")} be vector ya`;",
    "}"
  ].join("\n");
}

function newspaperRuntimeHelper() {
  return [
    "const PYA_NEWSPAPER_PREFIX = \"PYA_NEWSPAPER:\";",
    "function pyaNewspaperEnabled() {",
    "  return typeof process !== \"undefined\" && process?.env?.PYA_NEWSPAPER === \"1\";",
    "}",
    "function pyaEmitNewspaper(line) {",
    "  if (!pyaNewspaperEnabled() || !line) return;",
    "  const text = String(line);",
    "  const payload = text.includes(\"\\n\")",
    "    ? `${PYA_NEWSPAPER_PREFIX}BEGIN\\n${text}\\n${PYA_NEWSPAPER_PREFIX}END\\n`",
    "    : `${PYA_NEWSPAPER_PREFIX}${text}\\n`;",
    "  if (typeof process !== \"undefined\" && process.stdout && typeof process.stdout.write === \"function\") {",
    "    process.stdout.write(payload);",
    "  } else {",
    "    console.log(payload.trimEnd());",
    "  }",
    "}",
    "let pyaToolCounter = 0;",
    "function pyaNextToolEventId() {",
    "  pyaToolCounter += 1;",
    "  return String(pyaToolCounter).padStart(6, \"0\");",
    "}"
  ].join("\n");
}

export { newspaperRuntimeHelper };

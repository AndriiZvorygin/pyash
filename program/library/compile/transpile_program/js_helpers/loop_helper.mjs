export function loopHelperSource({ propagateErrors = false } = {}) {
  const nextSentence = propagateErrors
    ? [
      "const nextSentence = fn(callFrame);",
      "    if (nextSentence?.be === \"error\") return nextSentence;"
    ].join("\n")
    : "const nextSentence = fn(callFrame);";
  return [
    "function runLoop(sentence, fn) {",
    "  const initialHasOb = Object.prototype.hasOwnProperty.call(sentence, \"ob\");",
    "  for (;;) {",
    "    const currIdx = sentence?.fromindex?.num ?? sentence?.fromindex ?? 0;",
    "    const hasUntil = sentence?.toindex !== undefined;",
    "    const currUntil = sentence?.toindex?.num ?? sentence?.toindex;",
    "    sentence.fromindex = currIdx;",
    "    if (hasUntil) sentence.toindex = currUntil;",
    "    if (hasUntil ? currIdx === currUntil : currIdx === 0) break;",
    "    const prevIdx = sentence?.fromindex;",
    "    const prevUntil = sentence?.toindex;",
    "    const callFrame = initialHasOb ? sentence : new Proxy(sentence, {",
    "      ownKeys(target) { return Reflect.ownKeys(target).filter((key) => key !== \"ob\"); },",
    "      getOwnPropertyDescriptor(target, key) {",
    "        if (key === \"ob\") return undefined;",
    "        return Reflect.getOwnPropertyDescriptor(target, key);",
    "      }",
    "    });",
    `    ${nextSentence}`,
    "    const nextOb = nextSentence?.ob;",
    "    sentence = { ...sentence, ...(nextSentence || {}) };",
    "    if (nextOb !== undefined) sentence.ob = nextOb;",
    "    if (sentence.fromindex === undefined) sentence.fromindex = prevIdx;",
    "    if (sentence.toindex === undefined) sentence.toindex = prevUntil;",
    "    let nextIdx;",
    "    if (hasUntil) {",
    "      nextIdx = currIdx + (currUntil > currIdx ? 1 : -1);",
    "    } else {",
    "      nextIdx = currIdx - 1;",
    "    }",
    "    sentence.fromindex = nextIdx;",
    "  }",
    "  return sentence;",
    "}"
  ].join("\n");
}

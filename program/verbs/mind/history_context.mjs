import { remember } from "../../remember/index.mjs";
import { throwErrorSentence } from "../../error.mjs";
import { buildHistoryMessages } from "./history.mjs";

export function resolveHistoryContext({
  sentence,
  configSentence,
  historyWindow,
  dialogue,
  rememberFn = remember,
  resolveGenitiveText,
  resolvePromptFromName
} = {}) {
  const historySeriesName =
    sentence?.accordingto?.name ??
    sentence?.accordingto?.text ??
    configSentence?.accordingto?.name ??
    configSentence?.accordingto?.text ??
    null;
  let historyMessages = [];
  if (historySeriesName) {
    const historyFact = rememberFn(historySeriesName);
    if (!historyFact || historyFact.be !== "series" || !Array.isArray(historyFact.ob?.series)) {
      throwErrorSentence({
        name: "series defective",
        message: `series history missing: ${historySeriesName}`,
        from: { name: "mind" },
        raw: { historySeriesName }
      });
    }
    historyMessages = historyFact.ob.series
      .map((entry) => {
        if (!entry || typeof entry !== "object") return null;
        const role = entry?.role ?? entry?.su?.name ?? entry?.su?.text ?? entry?.from?.name ?? null;
        const content =
          entry?.content ??
          entry?.ob?.text ??
          (entry?.ob?.genitive ? resolveGenitiveText(entry.ob.genitive, { rememberFn }) : null) ??
          (entry?.ob?.name ? (resolvePromptFromName(entry.ob.name, { rememberFn }) ?? entry.ob.name) : null) ??
          (typeof entry?.ob?.num === "number" ? String(entry.ob.num) : null);
        if (!role || content == null) return null;
        return { role: String(role).toLowerCase(), content: String(content) };
      })
      .filter(Boolean);
    if (historyWindow > 0) {
      const max = historyWindow * 2;
      historyMessages = historyMessages.slice(-max);
    }
  } else {
    historyMessages = buildHistoryMessages(dialogue, { window: historyWindow });
  }
  return { historySeriesName, historyMessages };
}

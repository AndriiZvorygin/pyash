import { throwErrorSentence } from "../../error.mjs";
import { remember } from "../../remember/index.mjs";
import { resolveConfigText } from "../../configure/env.mjs";
import { callPromptMind, buildPromptifyPacket, buildDistinctFullScript } from "../../../command/itinerary_promptify.mjs";
import { emitExchangeSentence } from "../../bridge/exchange.mjs";
import { renderSayValue } from "../say.mjs";
import { resolveTextModel } from "../../runtime/gpu/text-model.mjs";
import { persistItineraryManifest, resolveItineraryCuts } from "./manifest.mjs";
import { findCharacterDrawRoute } from "./routes.mjs";
import { resolveFromTextPrompt } from "./media.mjs";

function resolvePromptifyPacketTemplate(sentence, rememberFn) {
  if (typeof sentence?.ob?.text === "string") return sentence.ob.text;
  if (typeof sentence?.ob?.name === "string" && rememberFn) {
    const fact = rememberFn(sentence.ob.name);
    if (typeof fact?.ob?.text === "string") return fact.ob.text;
  }
  if (sentence?.ob?.genitive) {
    const rendered = renderSayValue({ genitive: sentence.ob.genitive }, { rememberFn });
    if (rendered !== undefined && rendered !== null) return String(rendered);
  }
  return "";
}

function promptifyModel(sentence, rememberFn) {
  const callModel = String(sentence?.as?.name ?? sentence?.as?.text ?? "").trim();
  if (callModel) return callModel;
  const mindName = String(sentence?.for?.name ?? "mind").trim();
  const mindFact = rememberFn?.(mindName);
  const model = String(mindFact?.as?.name ?? "").trim();
  if (model) return model;
  return resolveTextModel(resolveConfigText("mind model", { rememberFn }) || process.env.PYA_MIND_MODEL || "");
}

function promptifyHost(sentence, rememberFn) {
  const callHost = String(sentence?.fromstate?.text ?? "").trim();
  if (callHost) return callHost;
  const hostFact = String(rememberFn?.("mind host")?.ob?.text ?? "").trim();
  if (hostFact) return hostFact;
  return process.env.OLLAMA_HOST || "http://localhost:11434";
}

export async function promptifyFromNameItinerary(sentence, { remember: rememberFn = remember } = {}) {
  const cuts = await resolveItineraryCuts(sentence?.from, { rememberFn });
  const targetName = String(sentence?.to?.name ?? "").trim();
  if (!targetName) {
    throwErrorSentence({
      name: "promptify defective",
      message: "promptify defective: requires to name itinerary",
      from: { name: "promptify" },
      raw: { sentence }
    });
  }
  const packetTemplate = resolvePromptifyPacketTemplate(sentence, rememberFn);
  const instruction = "Turn this transcript cut into one concise image prompt.";
  const systemPrompt = resolveFromTextPrompt(sentence?.fromtext, rememberFn)
    || "Convert this transcript cut into one concise visual image prompt for generation. Return only the prompt text. No markdown, no quotes, no explanation.";
  const host = promptifyHost(sentence, rememberFn);
  const model = promptifyModel(sentence, rememberFn);
  const continuityWindowRaw = Number(sentence?.by?.num ?? sentence?.by?.quantity?.num);
  const continuityWindow = Number.isFinite(continuityWindowRaw) && continuityWindowRaw >= 0
    ? Math.floor(continuityWindowRaw)
    : 1;
  const fullScript = buildDistinctFullScript(cuts);
  const series = [];
  const promptHistory = [];
  for (let i = 0; i < cuts.length; i += 1) {
    const cut = cuts[i];
    const index = Number(cut?.index ?? (series.length + 1));
    const previousPrompts = continuityWindow > 0
      ? promptHistory.slice(-continuityWindow)
      : [];
    const promptInput = buildPromptifyPacket({
      cuts,
      index: i,
      instruction,
      fullScript,
      previousPrompts,
      packetTemplate
    });
    emitExchangeSentence({
      mood: "do",
      su: { name: `promptify request ${String(index).padStart(3, "0")}` },
      ob: { text: promptInput },
      fromtext: { text: systemPrompt },
      fromstate: { text: host },
      as: { text: model },
      by: { num: index },
      be: "promptify"
    });
    const prompt = await callPromptMind({
      host,
      model,
      systemPrompt,
      cutText: promptInput
    });
    promptHistory.push(prompt);
    const sourceCutText = String(cut?.obText ?? "");
    const promptRow = {
      mood: "ya",
      su: { name: `cut ${String(index).padStart(3, "0")}` },
      since: { num: Number(cut?.since ?? 0) },
      until: { num: Number(cut?.until ?? cut?.since ?? 0) },
      ob: { text: prompt },
      fromtext: { text: sourceCutText },
      be: "cut"
    };
    const characterRoute = findCharacterDrawRoute(sourceCutText, rememberFn) || findCharacterDrawRoute(prompt, rememberFn);
    if (characterRoute?.workflowName) promptRow.as = { text: characterRoute.workflowName };
    series.push(promptRow);
    emitExchangeSentence({
      mood: "ya",
      su: { name: `promptify result ${String(index).padStart(3, "0")}` },
      ob: { text: prompt },
      fromstate: { text: host },
      as: { text: model },
      by: { num: index },
      be: "promptify"
    });
  }

  const manifestFilename = await persistItineraryManifest({
    sentence,
    itineraryName: targetName || "draw prompts",
    series,
    rememberFn,
    fallbackPrefix: "promptify"
  });
  return { ob: { series, filename: manifestFilename }, be: "itinerary" };
}

export const promptify = promptifyFromNameItinerary;

export const signatures = [
  { signatureWords: ["be", "promptify", "from", "name", "itinerary", "ob", "text", "to", "name", "itinerary"], handler: promptifyFromNameItinerary },
  { signatureWords: ["be", "promptify", "by", "num", "from", "name", "itinerary", "ob", "text", "to", "name", "itinerary"], handler: promptifyFromNameItinerary },
  { signatureWords: ["be", "promptify", "from", "name", "itinerary", "ob", "text", "to", "name", "itinerary", "fromtext", "text"], handler: promptifyFromNameItinerary },
  { signatureWords: ["be", "promptify", "by", "num", "from", "name", "itinerary", "ob", "text", "to", "name", "itinerary", "fromtext", "text"], handler: promptifyFromNameItinerary },
  { signatureWords: ["be", "promptify", "from", "name", "itinerary", "ob", "text", "to", "name", "itinerary", "fromtext", "name", "text"], handler: promptifyFromNameItinerary },
  { signatureWords: ["be", "promptify", "by", "num", "from", "name", "itinerary", "ob", "text", "to", "name", "itinerary", "fromtext", "name", "text"], handler: promptifyFromNameItinerary },
  { signatureWords: ["be", "promptify", "from", "name", "itinerary", "fromtext", "text", "ob", "text", "to", "name", "itinerary"], handler: promptifyFromNameItinerary },
  { signatureWords: ["be", "promptify", "by", "num", "from", "name", "itinerary", "fromtext", "text", "ob", "text", "to", "name", "itinerary"], handler: promptifyFromNameItinerary },
  { signatureWords: ["be", "promptify", "from", "name", "itinerary", "fromtext", "name", "text", "ob", "text", "to", "name", "itinerary"], handler: promptifyFromNameItinerary },
  { signatureWords: ["be", "promptify", "by", "num", "from", "name", "itinerary", "fromtext", "name", "text", "ob", "text", "to", "name", "itinerary"], handler: promptifyFromNameItinerary },
  { signatureWords: ["be", "promptify", "for", "name", "mind", "from", "name", "itinerary", "ob", "text", "to", "name", "itinerary"], handler: promptifyFromNameItinerary },
  { signatureWords: ["be", "promptify", "by", "num", "for", "name", "mind", "from", "name", "itinerary", "ob", "text", "to", "name", "itinerary"], handler: promptifyFromNameItinerary },
  { signatureWords: ["be", "promptify", "for", "name", "mind", "from", "name", "itinerary", "ob", "text", "to", "name", "itinerary", "fromtext", "text"], handler: promptifyFromNameItinerary },
  { signatureWords: ["be", "promptify", "by", "num", "for", "name", "mind", "from", "name", "itinerary", "ob", "text", "to", "name", "itinerary", "fromtext", "text"], handler: promptifyFromNameItinerary },
  { signatureWords: ["be", "promptify", "for", "name", "mind", "from", "name", "itinerary", "ob", "text", "to", "name", "itinerary", "fromtext", "name", "text"], handler: promptifyFromNameItinerary },
  { signatureWords: ["be", "promptify", "by", "num", "for", "name", "mind", "from", "name", "itinerary", "ob", "text", "to", "name", "itinerary", "fromtext", "name", "text"], handler: promptifyFromNameItinerary },
  { signatureWords: ["be", "promptify", "for", "name", "mind", "from", "name", "itinerary", "fromtext", "text", "ob", "text", "to", "name", "itinerary"], handler: promptifyFromNameItinerary },
  { signatureWords: ["be", "promptify", "by", "num", "for", "name", "mind", "from", "name", "itinerary", "fromtext", "text", "ob", "text", "to", "name", "itinerary"], handler: promptifyFromNameItinerary },
  { signatureWords: ["be", "promptify", "for", "name", "mind", "from", "name", "itinerary", "fromtext", "name", "text", "ob", "text", "to", "name", "itinerary"], handler: promptifyFromNameItinerary },
  { signatureWords: ["be", "promptify", "by", "num", "for", "name", "mind", "from", "name", "itinerary", "fromtext", "name", "text", "ob", "text", "to", "name", "itinerary"], handler: promptifyFromNameItinerary },
];


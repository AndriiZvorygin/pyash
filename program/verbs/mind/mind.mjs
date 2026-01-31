// pyash/verbs/mind.mjs
import { remember, doRemember } from "../../remember/index.mjs";
import { throwErrorSentence } from "../../error.mjs";
import { getEffectiveVyahAspect } from "../../library/grammar/vyah.mjs";
import { historyDialogueName, resetMindLogs as resetMindHistory, buildHistoryMessages } from "./history.mjs";
import { resetMindDebugCounters } from "./logging.mjs";
import { buildToolSchemas } from "./tooling.mjs";
import { resolveConfigBool, resolveConfigText } from "../../configure/env.mjs";
import { recordMindAnswer } from "./series.mjs";
import { resolveMindPrompt, resolveGenitiveText, resolvePromptFromName } from "./resolve_prompt.mjs";
import { resolveHistoryContext } from "./history_context.mjs";
import { runToolChat } from "./tool_chat.mjs";
import { runGenerate } from "./generate.mjs";
import { mindSignatureWords } from "./signatures.mjs";

export async function mind_to_name_text(sentence, { inputs = [] } = {}) {
  const ob = sentence?.ob ?? {};
  const mindName = sentence?.for?.name ?? sentence?.to?.name ?? sentence?.su?.name ?? "mind";
  const outputName = sentence?.for?.name ? sentence?.to?.name : sentence?.totext?.name;
  const config = mindName ? remember(mindName) : null;
  const configSentence = config?.be === "mind" ? config : null;
  const vyahValues = Array.isArray(sentence?.vyah?.ve?.values)
    ? sentence.vyah.ve.values
    : (Array.isArray(configSentence?.vyah?.ve?.values) ? configSentence.vyah.ve.values : []);
  const aspect = getEffectiveVyahAspect(vyahValues, { verb: "mind", caseKey: "vyah" });
  const dialogue = historyDialogueName({ callSentence: sentence, configSentence, targetName: mindName });
  const historyWindow =
    sentence?.by?.num ??
    sentence?.by?.quantity?.num ??
    configSentence?.ob?.window?.num ??
    configSentence?.ob?.historyWindow?.num ??
    configSentence?.window ??
    configSentence?.historyWindow ??
    ob?.window?.num ??
    8;

  // Model resolution: explicit on call or from config via state (keyword "as")
  const explicitModel = sentence?.ob?.model ?? ob?.model ?? null;
  const configModel = configSentence?.as?.name ?? null;
  const model = explicitModel ?? configModel ?? "qwen3-vl:8b-instruct";

  // Prompt resolution: config/call fromtext (discourse source) + call prompt/text
  const configPromptValue = configSentence?.fromtext ?? null;
  const callPromptValue = sentence?.fromtext ?? null;

  const { callPrompt, resolvedConfigPrompt } = resolveMindPrompt({
    sentence,
    ob,
    configSentence,
    rememberFn: remember
  });

  const toolMapName = sentence?.with?.name ?? null;
  const { tools, toolMap, toolBlock } = buildToolSchemas(toolMapName);

  const { historySeriesName, historyMessages } = resolveHistoryContext({
    sentence,
    configSentence,
    historyWindow,
    dialogue,
    rememberFn: remember,
    resolveGenitiveText,
    resolvePromptFromName
  });
  const backendName = resolveConfigText("mind backend", { rememberFn: remember }) ?? null;
  const ollamaHost = resolveConfigText("ollama host", { rememberFn: remember }) ?? null;
  const mindDebug = resolveConfigBool("mind debug", { rememberFn: remember }) === true;

  const debugMind = (label, payload) => {
    if (!mindDebug) return;
    const mode = payload?.mode ?? "generate";
    const host = payload?.host ?? "(unset)";
    const endpoint = typeof payload?.host === "string"
      ? `${payload.host.replace(/\/$/, "")}/api/${mode === "chat" ? "chat" : "generate"}`
      : "(unset)";
    const summary = {
      label,
      mode,
      model: payload?.model ?? null,
      stream: !!payload?.stream,
      host,
      endpoint
    };
    // eslint-disable-next-line no-console
    console.error(`[mind debug] ${JSON.stringify(summary)}`);
  };

  // Combine upstream inputs into a context string
  let inputText = "";
  for (const inp of inputs) {
    if (typeof inp === "string") {
      inputText += inp + "\n";
    } else if (inp?.text) {
      inputText += inp.text + "\n";
    } else if (inp != null) {
      inputText += JSON.stringify(inp) + "\n";
    }
  }

  let responseText = "";
  if (toolMapName) {
    if (aspect === "stream") {
      throwErrorSentence({
        name: "mind aspect invalid",
        message: "mind stream is not supported with tools",
        from: { name: "mind" },
        raw: { aspect }
      });
    }
    const mockResponseRaw = resolveConfigText("mind response", { rememberFn: remember });
    responseText = await runToolChat({
      sentence,
      ob,
      mindName,
      model,
      dialogue,
      callPrompt,
      resolvedConfigPrompt,
      historyMessages,
      toolMapName,
      toolMap,
      tools,
      toolBlock,
      backendName,
      ollamaHost,
      mindDebug,
      debugMind,
      inputs: { inputText, mockResponseRaw }
    });
  } else {
    const { responseText: text, stream } = await runGenerate({
      sentence,
      ob,
      mindName,
      model,
      dialogue,
      historyMessages,
      callPrompt,
      resolvedConfigPrompt,
      toolMapName,
      backendName,
      ollamaHost,
      mindDebug,
      debugMind,
      outputName,
      historySeriesName,
      aspect,
      inputText
    });
    if (stream) return stream;
    responseText = text ?? "";
  }

  // Record turn so future calls have context
  const answerSentence = recordMindAnswer({ mindName, dialogue, callPrompt, responseText, outputName, historySeriesName });
  return answerSentence;
}

export default mind_to_name_text;

export { buildHistoryMessages };
export function resetMindLogs() {
  resetMindHistory();
  resetMindDebugCounters();
}

export const signatures = mindSignatureWords.map(signatureWords => ({ signatureWords, handler: mind_to_name_text }));

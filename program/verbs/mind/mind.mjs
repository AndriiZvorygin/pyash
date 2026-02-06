// pyash/verbs/mind.mjs
import { remember, doRemember } from "../../remember/index.mjs";
import { throwErrorSentence } from "../../error.mjs";
import { getEffectiveVyahAspect } from "../../library/grammar/vyah.mjs";
import { historyDialogueName, resetMindLogs as resetMindHistory, buildHistoryMessages } from "./history.mjs";
import { resetMindDebugCounters } from "./logging.mjs";
import { buildToolSchemas } from "./tooling.mjs";
import { buildAgentSystemPrompt, buildAgentNamingPrompt } from "../../agent/context.mjs";
import {
  resolveAgentHouse,
  ensureAgentDirs,
  generateSessionName,
  ensureSessionFile,
  readSessionMessages,
  appendSessionEntry,
  pickLatestSessionFile,
  buildSessionNamePrefix,
  buildSessionNameForDate,
  readSessionMessagesWithFallback
} from "../../agent/session.mjs";
import { resolveConfigBool, resolveConfigText } from "../../configure/env.mjs";
import { recordMindAnswer } from "./series.mjs";
import { resolveMindPrompt, resolveGenitiveText, resolvePromptFromName } from "./resolve_prompt.mjs";
import { resolveHistoryContext } from "./history_context.mjs";
import { runToolChat } from "./tool_chat.mjs";
import { runGenerate } from "./generate.mjs";
import { mindSignatureWords } from "./signatures.mjs";

export async function mind_to_name_text(sentence, { inputs = [], onToolCall } = {}) {
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
  const toolMapFact = toolMapName ? remember(toolMapName) : null;
  const toolMapCwd = toolMapFact?.at?.filename ?? toolMapFact?.at?.text ?? toolMapFact?.at?.name ?? null;
  const agentCwd = sentence?.at?.filename ?? sentence?.at?.text ?? sentence?.at?.name ?? toolMapCwd;
  const toolMapSandpit = toolMapFact?.as?.wo === "sandpit" || toolMapFact?.as?.text === "sandpit";
  const toolMapWorld = toolMapFact?.as?.wo === "world" || toolMapFact?.as?.text === "world";
  if (toolMapName && agentCwd) {
    doRemember({
      mood: "ya",
      be: "cwd",
      su: { name: "agent cwd" },
      ob: { filename: String(agentCwd) }
    });
    if (toolMapSandpit) {
      doRemember({
        mood: "ya",
        be: "truth",
        su: { name: "agent sandbox" },
        ob: { boolean: true }
      });
    }
  }
  if (toolMapName && toolMapWorld) {
    const worldRoot = agentCwd ?? "world";
    doRemember({
      mood: "ya",
      be: "truth",
      su: { name: "world tools" },
      ob: { boolean: true }
    });
    doRemember({
      mood: "ya",
      be: "root",
      su: { name: "world root" },
      ob: { filename: String(worldRoot) }
    });
    doRemember({
      mood: "ya",
      be: "text",
      su: { name: "world agent" },
      ob: { text: String(mindName) }
    });
  }
  const { tools, toolMap, toolBlock } = buildToolSchemas(toolMapName);
  const agentEnabled = (() => {
    if (!toolMapFact || toolMapFact.be !== "map") return false;
    const entries = toolMapFact.ob?.map ?? {};
    for (const entry of Object.values(entries)) {
      if (!entry || entry.su?.name !== "agent") continue;
      if (entry?.ob?.boolean === true) return true;
      if (entry?.ob?.text && String(entry.ob.text).toLowerCase() === "truth") return true;
    }
    return false;
  })();
  const sessionNameHint = (() => {
    if (!toolMapFact || toolMapFact.be !== "map") return null;
    const entries = toolMapFact.ob?.map ?? {};
    for (const entry of Object.values(entries)) {
      if (!entry || entry.su?.name !== "session name") continue;
      if (typeof entry?.ob?.text === "string") return entry.ob.text;
      if (typeof entry?.ob?.name === "string") return entry.ob.name;
    }
    return null;
  })();
  const globalSessionNameHint = (() => {
    const fact = remember("session name");
    if (!fact) return null;
    if (typeof fact?.ob?.text === "string") return fact.ob.text;
    if (typeof fact?.ob?.name === "string") return fact.ob.name;
    return null;
  })();

  let { historySeriesName, historyMessages } = resolveHistoryContext({
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
  let sessionFile = null;
  let agentSystemPrompt = resolvedConfigPrompt;
  const systemLogPrompt = resolvedConfigPrompt ?? "";
  if (agentEnabled) {
    const agentHouse = resolveAgentHouse({ mindName, rememberFn: remember });
    const { sessionDir } = await ensureAgentDirs(agentHouse);
    agentSystemPrompt = await buildAgentSystemPrompt({
      agentHouse,
      mindName,
      configPrompt: resolvedConfigPrompt
    });
    const namingPrompt = resolvedConfigPrompt ?? "";
    if (!historySeriesName) {
      const promptText = namingPrompt || [callPrompt, inputText.trim()].filter(Boolean).join("\n\n");
      const datePrefix = buildSessionNamePrefix();
      const sessionNameSeed = sessionNameHint ?? globalSessionNameHint;
      if (sessionNameSeed) {
        const baseName = String(sessionNameSeed).trim();
        const sessionName = buildSessionNameForDate({
          baseName,
          dateCompact: datePrefix.replace(/-$/, "")
        });
        sessionFile = sessionName ? await ensureSessionFile({
          sessionDir,
          sessionName,
          systemPrompt: systemLogPrompt,
          model
        }) : null;
      } else {
        sessionFile = await pickLatestSessionFile(sessionDir, { datePrefix });
        if (!sessionFile) {
          const generated = await generateSessionName({
            promptText,
            model,
            backendName,
            ollamaHost,
            mindDebug,
            debugMind,
            rememberFn: remember
          });
          const sessionName = `${datePrefix}${generated}`;
          sessionFile = await ensureSessionFile({
            sessionDir,
            sessionName,
            systemPrompt: systemLogPrompt,
            model
          });
        }
      }
      if (sessionFile) {
        const sessionHistory = sessionNameSeed
          ? await readSessionMessagesWithFallback({
            sessionDir,
            baseName: String(sessionNameSeed).trim(),
            historyWindow
          })
          : await readSessionMessages({ sessionFile, historyWindow });
        historyMessages = sessionHistory.messages;
        if (sessionHistory.lastSystemModel && sessionHistory.lastSystemModel !== model) {
          await appendSessionEntry({
            sessionFile,
            role: "system",
            content: systemLogPrompt,
            model
          });
        }
        if (!sessionHistory.lastSystemModel) {
          await appendSessionEntry({
            sessionFile,
            role: "system",
            content: systemLogPrompt,
            model
          });
        }
      }
    }
  }
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
      resolvedConfigPrompt: agentSystemPrompt,
      historyMessages,
      toolMapName,
      toolMap,
      tools,
      toolBlock,
      backendName,
      ollamaHost,
      mindDebug,
      debugMind,
      inputs: { inputText, mockResponseRaw },
      onToolCall
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
      resolvedConfigPrompt: agentSystemPrompt,
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

  if (agentEnabled && sessionFile && !historySeriesName) {
    await appendSessionEntry({ sessionFile, role: "user", content: callPrompt || "" });
    await appendSessionEntry({ sessionFile, role: "assistant", content: responseText || "" });
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

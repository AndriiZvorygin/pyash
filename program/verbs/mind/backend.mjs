import { throwErrorSentence } from "../../error.mjs";

async function resolveInterpret() {
  const mod = await import("../../bridge/index.mjs");
  return mod.interpret;
}

async function callMindBackend({ backendName, payload, debug }) {
  if (!backendName) return null;
  const interpret = await resolveInterpret();
  const response = await interpret({
    mood: "do",
    be: backendName,
    ob: { text: JSON.stringify(payload) }
  });
  if (debug) {
    const obText = response?.ob?.text;
    const valueText = response?.value?.text;
    const resultText = response?.result?.text ?? response?.result?.ob?.text;
    const summary = {
      label: "backend-raw",
      type: typeof response,
      keys: response && typeof response === "object" ? Object.keys(response) : [],
      obTextLength: typeof obText === "string" ? obText.length : null,
      valueTextLength: typeof valueText === "string" ? valueText.length : null,
      resultTextLength: typeof resultText === "string" ? resultText.length : null
    };
    // eslint-disable-next-line no-console
    console.error(`[mind debug] ${JSON.stringify(summary)}`);
  }
  const rawText =
    response?.ob?.text ??
    response?.value?.text ??
    response?.result?.text ??
    response?.result?.ob?.text ??
    response?.ob?.name ??
    "";
  if (!rawText) return null;
  try {
    return JSON.parse(rawText);
  } catch {
    return { response: rawText };
  }
}

async function callMindBackendStream({ backendName, payload }) {
  if (!backendName) {
    throwErrorSentence({
      name: "mind defective",
      message: "mind backend missing",
      from: { name: "mind" }
    });
  }
  const interpret = await resolveInterpret();
  return interpret({
    mood: "do",
    be: backendName,
    ob: { text: JSON.stringify(payload) },
    vyah: { ve: { type: "name", values: ["stream"] } }
  });
}

export { resolveInterpret, callMindBackend, callMindBackendStream };

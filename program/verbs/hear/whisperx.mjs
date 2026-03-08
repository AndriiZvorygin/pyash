function normalizeHost(host) {
  const raw = String(host ?? "").trim();
  if (!raw) return "http://localhost:8000";
  return raw.endsWith("/") ? raw.slice(0, -1) : raw;
}

async function parseJsonResponse(response) {
  let payload = {};
  try {
    payload = await response.json();
  } catch {
    payload = {};
  }
  return payload;
}

async function transcribeWithWhisperxStream({
  host,
  inputPath,
  outputPath,
  language = "en",
  model = "large-v3",
  device = "cpu",
  diarize = false,
  hfToken = "",
  onLog = null
} = {}) {
  const endpoint = `${normalizeHost(host)}/transcribe_stream`;
  const normalizedLanguage = String(language ?? "").trim().toLowerCase();
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      input: inputPath,
      output_srt: outputPath,
      language: !normalizedLanguage || normalizedLanguage === "auto" ? undefined : language,
      model,
      device,
      diarize,
      hf_token: hfToken || undefined
    })
  });
  if (!response.ok) {
    const payload = await parseJsonResponse(response);
    const message = payload?.error || `${response.status} ${response.statusText}`;
    throw new Error(`whisperx defective: ${message}`);
  }
  if (!response.body) {
    throw new Error("whisperx defective: stream body missing");
  }
  const decoder = new TextDecoder("utf-8");
  const reader = response.body.getReader();
  let buffer = "";
  let result = null;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let lineBreak = buffer.indexOf("\n");
    while (lineBreak >= 0) {
      const line = buffer.slice(0, lineBreak).trim();
      buffer = buffer.slice(lineBreak + 1);
      if (line) {
        let event = null;
        try {
          event = JSON.parse(line);
        } catch {
          event = null;
        }
        if (event?.type === "log") {
          if (typeof onLog === "function") onLog(String(event.text ?? ""));
        } else if (event?.type === "error") {
          const code = Number(event?.code);
          const codeSuffix = Number.isFinite(code) ? ` code=${code}` : "";
          const detailText = String(event?.detail ?? "").trim();
          const detailSuffix = detailText ? ` detail=${JSON.stringify(detailText.slice(-1200))}` : "";
          throw new Error(`whisperx defective: ${event?.error || "whisperx failed"}${codeSuffix}${detailSuffix}`);
        } else if (event?.type === "result") {
          result = event;
        }
      }
      lineBreak = buffer.indexOf("\n");
    }
  }
  if (!result) {
    throw new Error("whisperx defective: missing result");
  }
  return result;
}

export async function transcribeWithWhisperx({
  host,
  inputPath,
  outputPath,
  language = "en",
  model = "large-v3",
  device = "cpu",
  diarize = false,
  hfToken = "",
  streamLogs = false,
  onLog = null
} = {}) {
  if (streamLogs) {
    return transcribeWithWhisperxStream({
      host,
      inputPath,
      outputPath,
      language,
      model,
      device,
      diarize,
      hfToken,
      onLog
    });
  }
  const endpoint = `${normalizeHost(host)}/transcribe`;
  const normalizedLanguage = String(language ?? "").trim().toLowerCase();
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      input: inputPath,
      output_srt: outputPath,
      language: !normalizedLanguage || normalizedLanguage === "auto" ? undefined : language,
      model,
      device,
      diarize,
      hf_token: hfToken || undefined
    })
  });

  const payload = await parseJsonResponse(response);
  if (!response.ok) {
    const detailText = typeof payload?.detail === "string" ? payload.detail.trim() : "";
    const detail = detailText ? ` detail=${JSON.stringify(detailText.slice(-600))}` : "";
    const message = `${payload?.error || `${response.status} ${response.statusText}`}${detail}`;
    throw new Error(`whisperx defective: ${message}`);
  }
  return payload;
}

export async function dischargeWhisperx({ host } = {}) {
  const endpoint = `${normalizeHost(host)}/discharge`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}"
  });
  let payload = {};
  try {
    payload = await response.json();
  } catch {
    payload = {};
  }
  if (!response.ok) {
    const message = payload?.error || `${response.status} ${response.statusText}`;
    throw new Error(`whisperx discharge defective: ${message}`);
  }
  return payload;
}

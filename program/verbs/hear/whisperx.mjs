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
  diarize = false,
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
      diarize
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
          const status = Number(event?.status);
          const suffix = Number.isFinite(status) ? ` status=${status}` : "";
          const stderr = String(event?.stderr ?? "").trim();
          const detail = stderr ? ` stderr=${JSON.stringify(stderr.slice(-1200))}` : "";
          throw new Error(`whisperx defective: ${event?.error || "whisperx failed"}${suffix}${detail}`);
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
  diarize = false,
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
      diarize,
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
      diarize
    })
  });

  const payload = await parseJsonResponse(response);
  if (!response.ok) {
    const stderr = typeof payload?.stderr === "string" ? payload.stderr.trim() : "";
    const status = payload?.status !== undefined ? ` status=${payload.status}` : "";
    const detail = stderr ? ` stderr=${JSON.stringify(stderr.slice(-600))}` : "";
    const message = `${payload?.error || `${response.status} ${response.statusText}`}${status}${detail}`;
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
